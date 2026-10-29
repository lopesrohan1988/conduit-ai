"""Unified async gateway for Meta Frontier Models, Baseten Open-Weights, and Modal Air-Gapped Glimmer."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import mimetypes
import re
from pathlib import Path
from typing import Any

import httpx
from openai import AsyncOpenAI
from PIL import Image

from app.catalog_loader import load_sam31_vision_prompts
from app.config import Settings, get_settings
from app.state import (
    InferenceMode,
    VoiceFieldNoteTranscript,
    VoiceFieldObservation,
)

_SAM31_BOX_PATTERN = re.compile(
    r"<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)\|>"
)

_SCENARIO_DEMO_TRANSCRIPTS: dict[str, dict[str, Any]] = {
    "scenario_2_substation": {
        "raw_transcript": (
            "GridCore 220kV North Substation relay house inspection: Bay 4 still has two temporary "
            "SEL-751 and GE Multilin T60 commissioning relays active on Hirschmann VLAN 220. Regional "
            "SLDC only needs read-only IEC-104 and DNP3 telemetry—no remote breaker trip commands are "
            "permitted across the Electronic Security Perimeter under NERC CIP-005 and CEA Article 9."
        ),
        "observations": [
            {
                "observation_id": "VOBS-01",
                "category": "SAFETY_CONSTRAINT",
                "extracted_entity": "Zero inbound IEC-104 breaker trip commands allowed across ESP",
                "engineering_impact": "Enforce pure unidirectional ARCH_A_FIELD_DIODE (SL-4) and sever TypeID 45 single commands.",
                "severity": "CRITICAL",
                "timestamp_offset_sec": 6.1,
            },
            {
                "observation_id": "VOBS-02",
                "category": "ROGUE_ASSET",
                "extracted_entity": "Temporary Bay 4 SEL-751 (.29) & Multilin T60 (.49) relays",
                "engineering_impact": "Flag commissioning relays violating NERC CIP-010 baseline inventory.",
                "severity": "WARNING",
                "timestamp_offset_sec": 1.8,
            },
        ],
    },
    "scenario_4_water_treatment": {
        "raw_transcript": (
            "Emergency field note at AquaPure chemical dosing building: inside the stainless DIN-rail "
            "PLC cabinet, a contractor left an unauthorized Moxa 5G cellular modem with magnetic paddle "
            "antennas plugged straight into Stratix port Gi1/24 on VLAN 25! There is zero 19-inch rack "
            "space here—only 250 millimeters of free 35mm DIN rail—and someone has been hitting the "
            "sodium hypochlorite HMI over VNC port 5900."
        ),
        "observations": [
            {
                "observation_id": "VOBS-01",
                "category": "ROGUE_ASSET",
                "extracted_entity": "Unauthorized Moxa OnCell 5G Modem on Stratix Gi1/24 (192.168.25.254)",
                "engineering_impact": "CRITICAL AIR-GAP BYPASS: Physically disconnect Gi1/24 immediately and sever VNC/5900 + Modbus FC 06 dosing writes.",
                "severity": "CRITICAL",
                "timestamp_offset_sec": 3.2,
            },
            {
                "observation_id": "VOBS-02",
                "category": "PHYSICAL_MOUNTING",
                "extracted_entity": "DIN-rail-only field cabinet (250mm free 35mm DIN track, 0U rack)",
                "engineering_impact": "Prohibit 1U_19INCH_RACK appliances; deploy DIN-rail ARCH_A_FIELD_DIODE + ARCH_B_VIDEO_IOT_DIODE.",
                "severity": "WARNING",
                "timestamp_offset_sec": 9.5,
            },
        ],
    },
}


def region_key(box: list[float] | tuple[float, ...]) -> str:
    """Stable id for an image region, used to record and look up per-region model reads."""
    return ",".join(str(round(v)) for v in box)


def _split_reasoning_tags(raw_text: str) -> tuple[str, str | None]:
    """Extract inline `<think>...</think>` reasoning blocks if present."""
    match = re.search(r"<think>(.*?)</think>", raw_text, flags=re.DOTALL)
    if not match:
        return raw_text.strip(), None
    reasoning = match.group(1).strip()
    cleaned = re.sub(r"<think>.*?</think>", "", raw_text, flags=re.DOTALL).strip()
    return cleaned, reasoning


def extract_json_object(raw_text: str) -> dict[str, Any] | None:
    """Safely extract a JSON object from raw LLM output (handling markdown code fences)."""
    if not raw_text:
        return None
    cleaned, _ = _split_reasoning_tags(raw_text)
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", cleaned, flags=re.DOTALL)
    candidate = fenced.group(1) if fenced else cleaned
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        parsed = json.loads(candidate[start : end + 1])
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


def parse_sam31_response_boxes(raw_output_text: str) -> list[dict[str, Any]]:
    """Parse Meta `sam-3.1` `/v1/responses` `<|box;x1=...;y1=...;x2=...;y2=...;w=...;h=...|>` tokens."""
    boxes: list[dict[str, Any]] = []
    for idx, match in enumerate(_SAM31_BOX_PATTERN.finditer(raw_output_text), start=1):
        x1, y1, x2, y2, w, h = (int(g) for g in match.groups())
        safe_w = max(w, 1)
        safe_h = max(h, 1)
        boxes.append(
            {
                "box_index": idx,
                "bbox_xyxy": [float(x1), float(y1), float(x2), float(y2)],
                "image_width": safe_w,
                "image_height": safe_h,
                "pct_xywh": [
                    round((x1 / safe_w) * 100.0, 2),
                    round((y1 / safe_h) * 100.0, 2),
                    round(((x2 - x1) / safe_w) * 100.0, 2),
                    round(((y2 - y1) / safe_h) * 100.0, 2),
                ],
            }
        )
    return boxes


class MetaModelGateway:
    """Async client gateway across Meta Model API, Baseten Open-Weights, and Modal Glimmer."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    def _meta_openai_client(self) -> AsyncOpenAI:
        return AsyncOpenAI(
            base_url=self.settings.meta_api_base_url,
            api_key=self.settings.meta_model_api_key or "unconfigured-meta-key",
            timeout=25.0,
            max_retries=1,
        )

    def _baseten_openai_client(self) -> AsyncOpenAI:
        return AsyncOpenAI(
            base_url=self.settings.baseten_api_base_url,
            api_key=self.settings.baseten_api_key or "unconfigured-baseten-key",
            timeout=20.0,
            max_retries=1,
        )

    def _glimmer_openai_client(self) -> AsyncOpenAI:
        return AsyncOpenAI(
            base_url=self.settings.muse_glimmer_endpoint_url.rstrip("/"),
            api_key=self.settings.meta_model_api_key or "air-gapped-local-vllm",
        )

    async def chat_muse_spark(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float = 0.1,
        max_tokens: int = 4096,
        response_format: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Invoke Meta `muse-spark-1.3` for multimodal reconciliation & structured extraction."""
        if not self.settings.meta_api_configured:
            return {
                "content": "",
                "reasoning": None,
                "model": self.settings.muse_spark_model,
                "provider": "meta_model_api",
                "source_mode": "demo_cache_fallback",
            }

        try:
            client = self._meta_openai_client()
            # Ensure enough token headroom for internal reasoning tokens before `content`
            effective_max_tokens = max(max_tokens, 1024)
            kwargs: dict[str, Any] = {
                "model": self.settings.muse_spark_model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": effective_max_tokens,
            }
            if response_format is not None:
                kwargs["response_format"] = response_format

            completion = await client.chat.completions.create(**kwargs)
            msg = completion.choices[0].message
            raw_content = msg.content or ""
            cleaned_content, inline_reasoning = _split_reasoning_tags(raw_content)
            explicit_reasoning = getattr(msg, "reasoning_content", None) or inline_reasoning
            return {
                "content": cleaned_content,
                "reasoning": explicit_reasoning,
                "model": completion.model,
                "provider": "meta_model_api",
                "source_mode": "live",
            }
        except Exception as exc:
            if not self.settings.demo_cache_fallback:
                raise
            return {
                "content": "",
                "reasoning": f"Fallback engaged ({type(exc).__name__})",
                "model": self.settings.muse_spark_model,
                "provider": "meta_model_api",
                "source_mode": "demo_cache_fallback",
            }

    async def chat_muse_wonder(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float = 0.1,
        max_tokens: int = 8192,
        response_format: dict[str, Any] | None = None,
        timeout: float | None = None,
        reasoning_effort: str | None = None,
    ) -> dict[str, Any]:
        """Invoke Meta `muse-wonder-1.0` frontier reasoning model for OT architecture synthesis."""
        if not self.settings.meta_api_configured:
            return {
                "content": "",
                "reasoning": None,
                "model": self.settings.muse_wonder_model,
                "provider": "meta_model_api",
                "source_mode": "demo_cache_fallback",
            }

        try:
            client = self._meta_openai_client()
            effective_max_tokens = max(max_tokens, 1536)
            kwargs: dict[str, Any] = {
                "model": self.settings.muse_wonder_model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": effective_max_tokens,
            }
            if response_format is not None:
                kwargs["response_format"] = response_format
            if timeout is not None:
                kwargs["timeout"] = timeout
            if reasoning_effort:
                kwargs["reasoning_effort"] = reasoning_effort

            completion = await client.chat.completions.create(**kwargs)
            msg = completion.choices[0].message
            raw_content = msg.content or ""
            cleaned_content, inline_reasoning = _split_reasoning_tags(raw_content)
            explicit_reasoning = getattr(msg, "reasoning_content", None) or inline_reasoning
            return {
                "content": cleaned_content,
                "reasoning": explicit_reasoning,
                "model": completion.model,
                "provider": "meta_model_api",
                "source_mode": "live",
                "finish_reason": completion.choices[0].finish_reason,
            }
        except Exception as exc:
            if not self.settings.demo_cache_fallback:
                raise
            return {
                "content": "",
                "reasoning": f"Fallback engaged ({type(exc).__name__})",
                "model": self.settings.muse_wonder_model,
                "provider": "meta_model_api",
                "source_mode": "demo_cache_fallback",
            }

    async def chat_baseten_open(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float = 0.0,
        max_tokens: int = 4096,
    ) -> dict[str, Any]:
        """Invoke Baseten `meta-models/muse-spark-open-1026` (or live Meta Spark fallback) for CLI parsing."""
        if self.settings.baseten_api_configured:
            try:
                client = self._baseten_openai_client()
                completion = await client.chat.completions.create(
                    model=self.settings.baseten_model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                msg = completion.choices[0].message
                raw_content = msg.content or ""
                cleaned_content, inline_reasoning = _split_reasoning_tags(raw_content)
                explicit_reasoning = (
                    getattr(msg, "reasoning_content", None) or inline_reasoning
                )
                return {
                    "content": cleaned_content,
                    "reasoning": explicit_reasoning,
                    "model": completion.model,
                    "provider": "baseten_open_weights",
                    "source_mode": "live",
                }
            except Exception:
                if not self.settings.demo_cache_fallback:
                    raise

        # Seamless live fallback to Meta `muse-spark-1.3` when Baseten key is not yet populated
        if self.settings.meta_api_configured:
            spark_res = await self.chat_muse_spark(
                messages, temperature=temperature, max_tokens=max_tokens
            )
            if spark_res.get("source_mode") == "live":
                return {
                    "content": spark_res.get("content", ""),
                    "reasoning": spark_res.get("reasoning"),
                    "model": spark_res.get("model", self.settings.muse_spark_model),
                    "provider": "meta_spark_live_fallback",
                    "source_mode": "live",
                }

        return {
            "content": "",
            "reasoning": None,
            "model": self.settings.baseten_model,
            "provider": "baseten_open_weights",
            "source_mode": "demo_cache_fallback",
        }

    async def chat_air_gapped_glimmer(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float = 0.1,
        max_tokens: int = 8192,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        """Run on Meta open weights: a self-hosted Muse Glimmer endpoint, else Muse Spark Open on Baseten.

        This is the mode for plants that can't send their data to a cloud API: the same open
        model can be served on the site's own hardware.
        """
        if self.settings.glimmer_endpoint_configured:
            client, model, provider = self._glimmer_openai_client(), self.settings.muse_glimmer_model, "self_hosted_open_weights"
        elif self.settings.baseten_api_configured:
            client, model, provider = self._baseten_openai_client(), self.settings.baseten_model, "baseten_open_weights"
        else:
            return {
                "content": "",
                "reasoning": "No open-weights endpoint configured (Muse Glimmer URL or Baseten key).",
                "model": self.settings.muse_glimmer_model,
                "provider": "none",
                "source_mode": "offline_air_gapped_fallback",
            }

        try:
            completion = await client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                timeout=timeout,
            )
            msg = completion.choices[0].message
            raw_content = msg.content or ""
            cleaned_content, inline_reasoning = _split_reasoning_tags(raw_content)
            return {
                "content": cleaned_content,
                "reasoning": getattr(msg, "reasoning_content", None) or inline_reasoning,
                "model": completion.model,
                "provider": provider,
                "source_mode": "live",
                "finish_reason": completion.choices[0].finish_reason,
            }
        except Exception as exc:
            if not self.settings.demo_cache_fallback:
                raise
            return {
                "content": "",
                "reasoning": f"Open-weights call failed ({type(exc).__name__}).",
                "model": model,
                "provider": provider,
                "source_mode": "offline_air_gapped_fallback",
            }

    async def route_architect_reasoning(
        self,
        messages: list[dict[str, Any]],
        *,
        inference_mode: InferenceMode | None = None,
        temperature: float = 0.1,
        max_tokens: int = 8192,
        timeout: float | None = None,
        reasoning_effort: str | None = None,
    ) -> dict[str, Any]:
        """Switch architect reasoning between Cloud `Muse Wonder` and Air-Gapped `Muse Glimmer 30B`."""
        effective_mode: InferenceMode = inference_mode or (
            "air_gapped_open_weights"
            if self.settings.air_gapped_open_weights_mode
            else "cloud_meta_api"
        )
        if effective_mode == "air_gapped_open_weights":
            return await self.chat_air_gapped_glimmer(
                messages, temperature=temperature, max_tokens=max_tokens, timeout=timeout
            )
        return await self.chat_muse_wonder(
            messages,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=timeout,
            reasoning_effort=reasoning_effort,
        )

    async def _sam31_boxes(self, data_url: str, prompt: str) -> list[dict[str, Any]]:
        """One SAM 3.1 concept call: a single noun phrase against one image."""
        payload = {
            "model": self.settings.sam_3_1_model,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": prompt},
                        {"type": "input_image", "image_url": data_url},
                    ],
                }
            ],
        }
        async with httpx.AsyncClient(timeout=35.0) as http:
            resp = await http.post(
                f"{self.settings.meta_api_base_url.rstrip('/')}/responses",
                headers={"Authorization": f"Bearer {self.settings.meta_model_api_key}"},
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
        texts = [
            str(block["text"])
            for item in data.get("output", [])
            for block in item.get("content", [])
            if isinstance(block, dict) and block.get("text")
        ]
        return parse_sam31_response_boxes("\n".join(texts))

    def _sam31_cache_path(self, image_sha: str) -> Path:
        return self.settings.resolved_data_dir / "cache" / "sam31" / f"{image_sha[:20]}.json"

    async def sam31_concepts(
        self,
        image_bytes: bytes,
        prompts: list[str] | tuple[str, ...],
        *,
        live: bool,
        mime_type: str = "image/jpeg",
    ) -> dict[str, Any]:
        """Run every concept prompt against one image and return boxes per prompt.

        Live responses are recorded by image hash; without live access the recorded SAM 3.1
        output is replayed (`recorded_sam31`). Nothing is synthesised: unknown images with no
        recording come back empty (`unavailable`).
        """
        image_sha = hashlib.sha256(image_bytes).hexdigest()
        with Image.open(io.BytesIO(image_bytes)) as img:
            width, height = img.size
        cache_path = self._sam31_cache_path(image_sha)
        cached: dict[str, Any] = (
            json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
        )
        recorded: dict[str, list[list[float]]] = cached.get("prompts", {})

        boxes: dict[str, list[list[float]]] = {}
        source_mode = "unavailable"
        missing = [p for p in prompts if p not in recorded]
        if live and self.settings.meta_api_configured and missing:
            data_url = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"
            sem = asyncio.Semaphore(8)

            async def _one(p: str) -> tuple[str, list[list[float]] | None]:
                async with sem:
                    try:
                        return p, [b["bbox_xyxy"] for b in await self._sam31_boxes(data_url, p)]
                    except Exception:
                        return p, None

            for p, got in await asyncio.gather(*(_one(p) for p in missing)):
                if got is not None:
                    recorded[p] = got
                    source_mode = "live_sam31"
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(
                json.dumps(
                    {
                        "image_sha256": image_sha,
                        "image_width": width,
                        "image_height": height,
                        "model": self.settings.sam_3_1_model,
                        "prompts": recorded,
                    },
                    indent=1,
                ),
                encoding="utf-8",
            )
        for p in prompts:
            if p in recorded:
                boxes[p] = recorded[p]
                if source_mode == "unavailable":
                    source_mode = "recorded_sam31"
        return {
            "model": self.settings.sam_3_1_model,
            "source_mode": source_mode,
            "image_width": width,
            "image_height": height,
            "boxes": boxes,
        }

    async def muse_spark_read_regions(
        self,
        image_bytes: bytes,
        boxes: list[list[float]],
        prompt: str,
        *,
        live: bool,
        open_weights: bool = False,
    ) -> dict[str, Any]:
        """Ask Muse Spark to read each cropped region and return its JSON answer per box.

        With `open_weights`, the reads run on Muse Spark Open / Muse Glimmer instead of the
        cloud API. Recorded like `sam31_concepts`, keyed by image hash, prompt, box and model
        family, so a run without live access replays earlier answers and never invents one.
        """
        image_sha = hashlib.sha256(image_bytes).hexdigest()
        prompt_sha = hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:12]
        suffix = "_open" if open_weights else ""
        cache_path = (
            self.settings.resolved_data_dir
            / "cache"
            / "muse_spark_read"
            / f"{image_sha[:20]}_{prompt_sha}{suffix}.json"
        )
        configured = (
            self.settings.glimmer_endpoint_configured or self.settings.baseten_api_configured
            if open_weights
            else self.settings.meta_api_configured
        )
        chat = self.chat_air_gapped_glimmer if open_weights else self.chat_muse_spark
        model_name = self.settings.baseten_model if open_weights else self.settings.muse_spark_model
        cached: dict[str, Any] = (
            json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
        )
        recorded: dict[str, Any] = cached.get("reads", {})
        key = region_key

        source_mode = "unavailable"
        missing = [b for b in boxes if key(b) not in recorded]
        if live and configured and missing:
            with Image.open(io.BytesIO(image_bytes)) as img:
                rgb = img.convert("RGB")
                crops = {}
                for b in missing:
                    buf = io.BytesIO()
                    rgb.crop(tuple(round(v) for v in b)).save(buf, "PNG")
                    crops[key(b)] = base64.b64encode(buf.getvalue()).decode("ascii")
            sem = asyncio.Semaphore(8)

            async def _one(k: str) -> tuple[str, dict[str, Any] | None]:
                async with sem:
                    res = await chat(
                        [
                            {
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": prompt},
                                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{crops[k]}"}},
                                ],
                            }
                        ],
                        max_tokens=4096,
                    )
                    if res.get("source_mode") != "live":
                        return k, None
                    return k, extract_json_object(str(res.get("content") or "")) or {}

            for k, got in await asyncio.gather(*(_one(k) for k in crops)):
                if got is not None:
                    recorded[k] = got
                    source_mode = "live_open_weights" if open_weights else "live_muse_spark"
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(
                json.dumps(
                    {"image_sha256": image_sha, "model": model_name, "prompt_sha": prompt_sha, "reads": recorded},
                    indent=1,
                ),
                encoding="utf-8",
            )
        reads = {key(b): recorded[key(b)] for b in boxes if key(b) in recorded}
        if reads and source_mode == "unavailable":
            source_mode = "recorded_open_weights" if open_weights else "recorded_muse_spark"
        return {"model": model_name, "source_mode": source_mode, "reads": reads}

    async def segment_sam31(
        self,
        image_path: str | Path,
        prompts: list[str] | None = None,
        *,
        mode: str = "mode_1_network_diagram",
    ) -> dict[str, Any]:
        """Execute Meta `sam-3.1` text-prompted segmentation via `POST /v1/responses`."""
        path = Path(image_path)
        prompt_pack = load_sam31_vision_prompts()

        if self.settings.meta_api_configured and path.exists():
            try:
                mime_type = mimetypes.guess_type(path.name)[0] or "image/jpeg"
                encoded_image = base64.b64encode(path.read_bytes()).decode("ascii")
                default_prompts = (
                    ["server rack slot, DIN rail, industrial switch, cellular modem"]
                    if mode == "mode_2_cabinet_rack_sizer"
                    else [
                        "security zone box, firewall icon, PLC controller, network switch, server"
                    ]
                )
                prompt_text = ", ".join(prompts) if prompts else default_prompts[0]
                payload = {
                    "model": self.settings.sam_3_1_model,
                    "input": [
                        {
                            "role": "user",
                            "content": [
                                {"type": "input_text", "text": prompt_text},
                                {
                                    "type": "input_image",
                                    "image_url": f"data:{mime_type};base64,{encoded_image}",
                                },
                            ],
                        }
                    ],
                }
                async with httpx.AsyncClient(timeout=35.0) as http:
                    resp = await http.post(
                        f"{self.settings.meta_api_base_url.rstrip('/')}/responses",
                        headers={
                            "Authorization": f"Bearer {self.settings.meta_model_api_key}"
                        },
                        json=payload,
                    )
                    resp.raise_for_status()
                    data = resp.json()

                output_texts: list[str] = []
                for item in data.get("output", []):
                    for block in item.get("content", []):
                        if isinstance(block, dict) and block.get("text"):
                            output_texts.append(str(block["text"]))
                combined_raw = "\n".join(output_texts)
                parsed_boxes = parse_sam31_response_boxes(combined_raw)
                return {
                    "model": self.settings.sam_3_1_model,
                    "mode": mode,
                    "source_mode": "live_sam31",
                    "response_id": data.get("id"),
                    "boxes": parsed_boxes,
                    "raw_segmentation_tokens": combined_raw[:1000],
                }
            except Exception:
                if not self.settings.demo_cache_fallback:
                    raise

        return {
            "model": self.settings.sam_3_1_model,
            "mode": mode,
            "source_mode": "demo_cache_fallback",
            "boxes": [],
            "result": prompt_pack.get("mode_1_network_diagram", {}).get(
                "few_shot_example_output", {}
            ),
        }

    async def generate_muse_image(
        self,
        prompt: str,
        *,
        size: str = "1024x1024",
    ) -> dict[str, Any]:
        """Generate an engineering visual / rack mounting diagram card via `muse-image-1.0`."""
        if self.settings.meta_api_configured:
            try:
                client = self._meta_openai_client()
                result = await client.images.generate(
                    model=self.settings.muse_image_model,
                    prompt=prompt,
                    size=size,  # type: ignore[arg-type]
                    n=1,
                )
                first = result.data[0] if result.data else None
                direct_url = getattr(first, "url", None)
                b64_payload = getattr(first, "b64_json", None)
                if not direct_url and b64_payload:
                    mime = "image/webp" if b64_payload.startswith("UklGR") else "image/png"
                    direct_url = f"data:{mime};base64,{b64_payload}"
                return {
                    "model": self.settings.muse_image_model,
                    "source_mode": "live",
                    "image_url": direct_url,
                    "b64_json": b64_payload,
                }
            except Exception:
                if not self.settings.demo_cache_fallback:
                    raise

        return {
            "model": self.settings.muse_image_model,
            "source_mode": "demo_cache_fallback",
            "image_url": "/static/data/visuals/server_rack_open_1u.jpg",
            "b64_json": None,
        }

    async def transcribe_muse_voice(
        self,
        audio_bytes: bytes | None = None,
        filename: str = "field_walkdown_note.wav",
        *,
        scenario_id: str | None = None,
    ) -> VoiceFieldNoteTranscript:
        """Transcribe OT field audio notes via Meta API (`/asr`, `/audio/transcriptions`, or multimodal audio)."""
        # Only dispatch live network ASR when non-trivial real audio bytes (> 256 bytes) are uploaded
        if audio_bytes and len(audio_bytes) > 256 and self.settings.meta_api_configured:
            base = self.settings.meta_api_base_url.rstrip("/")
            headers = {"Authorization": f"Bearer {self.settings.meta_model_api_key}"}

            # 1. Try dedicated multipart ASR / audio transcription endpoints
            for suffix in ("/audio/transcriptions", "/asr"):
                try:
                    async with httpx.AsyncClient(timeout=25.0) as http:
                        resp = await http.post(
                            f"{base}{suffix}",
                            headers=headers,
                            data={"model": self.settings.muse_voice_transcribe_model},
                            files={"file": (filename, audio_bytes, "audio/wav")},
                        )
                        if resp.status_code == 200:
                            payload = resp.json()
                            transcript_text = str(
                                payload.get("text") or payload.get("transcript") or ""
                            ).strip()
                            if transcript_text:
                                return VoiceFieldNoteTranscript(
                                    scenario_id=scenario_id,
                                    audio_filename=filename,
                                    model_used=self.settings.muse_voice_transcribe_model,
                                    source_mode="live_meta_asr",
                                    duration_sec=float(payload.get("duration", 12.0)),
                                    language=str(payload.get("language", "en")),
                                    raw_transcript=transcript_text,
                                    structured_observations=[
                                        VoiceFieldObservation(
                                            observation_id="VOBS-LIVE-01",
                                            category="GENERAL_NOTE",
                                            extracted_entity="Live Field Audio Walkdown Note",
                                            engineering_impact=transcript_text[:240],
                                            severity="INFO",
                                            timestamp_offset_sec=0.0,
                                        )
                                    ],
                                )
                except Exception:
                    pass

            # 2. Live multimodal audio transcription + observation extraction via `muse-spark-1.3`
            try:
                ext = Path(filename).suffix.lower().lstrip(".") or "wav"
                audio_fmt = "mp3" if ext == "mp3" else "wav"
                b64_audio = base64.b64encode(audio_bytes).decode("ascii")
                spark_res = await self.chat_muse_spark(
                    [
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "text",
                                    "text": (
                                        "Transcribe this OT field engineer audio note verbatim and extract "
                                        "structured engineering observations as JSON: "
                                        '{"raw_transcript": "...", "observations": [{"observation_id": "VOBS-01", '
                                        '"category": "PHYSICAL_MOUNTING|ROGUE_ASSET|PROTOCOL_REQUIREMENT|SAFETY_CONSTRAINT|GENERAL_NOTE", '
                                        '"extracted_entity": "...", "engineering_impact": "...", '
                                        '"severity": "INFO|WARNING|CRITICAL"}]}'
                                    ),
                                },
                                {
                                    "type": "input_audio",
                                    "input_audio": {
                                        "data": b64_audio,
                                        "format": audio_fmt,
                                    },
                                },
                            ],
                        }
                    ],
                    max_tokens=2048,
                )
                parsed_json = extract_json_object(spark_res.get("content", ""))
                if parsed_json and parsed_json.get("raw_transcript"):
                    raw_obs = parsed_json.get("observations", [])
                    obs_models = [
                        VoiceFieldObservation.model_validate(o)
                        for o in raw_obs
                        if isinstance(o, dict)
                    ]
                    return VoiceFieldNoteTranscript(
                        scenario_id=scenario_id,
                        audio_filename=filename,
                        model_used=self.settings.muse_voice_transcribe_model,
                        source_mode="live_meta_asr",
                        duration_sec=12.0,
                        language="en",
                        raw_transcript=str(parsed_json["raw_transcript"]),
                        structured_observations=obs_models
                        or [
                            VoiceFieldObservation(
                                observation_id="VOBS-LIVE-01",
                                category="GENERAL_NOTE",
                                extracted_entity="Live Field Audio Walkdown Note",
                                engineering_impact=str(parsed_json["raw_transcript"])[:240],
                                severity="INFO",
                                timestamp_offset_sec=0.0,
                            )
                        ],
                    )
            except Exception:
                if not self.settings.demo_cache_fallback:
                    raise

        effective_scenario = scenario_id or "scenario_2_substation"
        demo_entry = _SCENARIO_DEMO_TRANSCRIPTS.get(
            effective_scenario,
            _SCENARIO_DEMO_TRANSCRIPTS["scenario_2_substation"],
        )
        return VoiceFieldNoteTranscript(
            scenario_id=effective_scenario,
            audio_filename=filename,
            model_used=self.settings.muse_voice_transcribe_model,
            source_mode="demo_fallback_transcript",
            duration_sec=14.5,
            language="en",
            raw_transcript=demo_entry["raw_transcript"],
            structured_observations=[
                VoiceFieldObservation.model_validate(obs)
                for obs in demo_entry["observations"]
            ],
        )

    def get_stack_status(self) -> dict[str, Any]:
        """Return readiness of all 7 model/partner integrations without leaking any secrets."""
        meta_ready = self.settings.meta_api_configured
        baseten_ready = self.settings.baseten_api_configured
        glimmer_ready = self.settings.glimmer_endpoint_configured
        fallback = self.settings.demo_cache_fallback

        def _status_label(live_configured: bool) -> str:
            if live_configured:
                return "live_ready"
            return "demo_fallback_ready" if fallback else "missing_credentials"

        integrations: dict[str, dict[str, Any]] = {
            "sam_3_1": {
                "model_id": self.settings.sam_3_1_model,
                "provider": "Meta Model API",
                "role": "Dual-mode network diagram segmentation, rack/DIN physical fit & 24fps video bypass tracking",
                "endpoint_base_url": f"{self.settings.meta_api_base_url.rstrip('/')}/responses",
                "api_key_configured": meta_ready,
                "demo_fallback_ready": fallback,
                "operational_status": _status_label(meta_ready),
            },
            "muse_spark": {
                "model_id": self.settings.muse_spark_model,
                "provider": "Meta Model API",
                "role": "Multimodal diagram OCR crop extraction & shadow OT reconciliation",
                "endpoint_base_url": self.settings.meta_api_base_url,
                "api_key_configured": meta_ready,
                "demo_fallback_ready": fallback,
                "operational_status": _status_label(meta_ready),
            },
            "muse_wonder": {
                "model_id": self.settings.muse_wonder_model,
                "provider": "Meta Model API",
                "role": "Cloud frontier OT Solutions Architect sizing, protocol cutover & IEC 62443 synthesis",
                "endpoint_base_url": self.settings.meta_api_base_url,
                "api_key_configured": meta_ready,
                "demo_fallback_ready": fallback,
                "operational_status": _status_label(meta_ready),
            },
            "muse_image": {
                "model_id": self.settings.muse_image_model,
                "provider": "Meta Model API",
                "role": "Visual rack/DIN-rail hardware diode cutover installation card generation",
                "endpoint_base_url": f"{self.settings.meta_api_base_url.rstrip('/')}/images/generations",
                "api_key_configured": meta_ready,
                "demo_fallback_ready": fallback,
                "operational_status": _status_label(meta_ready),
            },
            "muse_voice_transcribe": {
                "model_id": self.settings.muse_voice_transcribe_model,
                "provider": "Meta Model API",
                "role": "Hands-free OT plant walkdown voice field note ASR & multimodal audio extraction",
                "endpoint_base_url": self.settings.meta_api_base_url,
                "api_key_configured": meta_ready,
                "demo_fallback_ready": fallback,
                "operational_status": _status_label(meta_ready),
            },
            "baseten_muse_spark_open_1026": {
                "model_id": self.settings.baseten_model,
                "provider": "Baseten Serverless Inference",
                "role": "High-speed switch CLI (`show arp` / MAC / 802.1Q VLAN) & firewall rule extraction",
                "endpoint_base_url": self.settings.baseten_api_base_url,
                "api_key_configured": baseten_ready,
                "live_meta_spark_fallback_ready": meta_ready,
                "demo_fallback_ready": fallback,
                "operational_status": (
                    "live_ready"
                    if baseten_ready
                    else "live_via_muse_spark"
                    if meta_ready
                    else _status_label(False)
                ),
            },
            "open_weights_architect": {
                "model_id": self.settings.muse_glimmer_model if glimmer_ready else self.settings.baseten_model,
                "provider": "Self-hosted Muse Glimmer" if glimmer_ready else "Baseten (Muse Spark Open)",
                "role": "Air-gapped mode: architect, drawing reads and rack-gap checks on Meta open weights",
                "ready": glimmer_ready or baseten_ready,
                "operational_status": "live_ready" if (glimmer_ready or baseten_ready) else _status_label(False),
            },
            "modal_glimmer_and_twin": {
                "model_id": self.settings.muse_glimmer_model,
                "provider": "Modal Serverless Sandboxes & GPU",
                "role": "Layer-1/2 Socket Replay Digital Twin + Air-Gapped On-Prem `Muse-Glimmer-30B` (Apache 2.0)",
                "modal_profile": self.settings.modal_profile,
                "glimmer_endpoint_configured": glimmer_ready,
                "sandbox_timeout_sec": self.settings.modal_sandbox_timeout,
                "api_key_configured": bool(self.settings.modal_profile) or glimmer_ready,
                "demo_fallback_ready": fallback,
                "operational_status": "live_ready"
                if glimmer_ready
                else (
                    "sandbox_profile_ready"
                    if self.settings.modal_profile
                    else _status_label(False)
                ),
            },
        }

        default_mode: InferenceMode = (
            "air_gapped_open_weights"
            if self.settings.air_gapped_open_weights_mode
            else "cloud_meta_api"
        )

        return {
            "active_default_inference_mode": default_mode,
            "air_gapped_open_weights_mode": self.settings.air_gapped_open_weights_mode,
            "demo_cache_fallback_enabled": fallback,
            "integration_count": len(integrations),
            "all_integrations_operational": all(
                item["operational_status"] != "missing_credentials"
                for item in integrations.values()
            ),
            "integrations": integrations,
        }
