"""Unified async gateway for Meta Frontier Models, Baseten Open-Weights, and Modal Air-Gapped Glimmer."""

from __future__ import annotations

import base64
import re
from pathlib import Path
from typing import Any

import httpx
from openai import AsyncOpenAI

from app.catalog_loader import load_sam31_vision_prompts
from app.config import Settings, get_settings
from app.state import (
    InferenceMode,
    VoiceFieldNoteTranscript,
    VoiceFieldObservation,
)

_SCENARIO_DEMO_TRANSCRIPTS: dict[str, dict[str, Any]] = {
    "scenario_1_manufacturing": {
        "raw_transcript": (
            "Field walkdown at Apex Automotive Stamping Line 4: the press-side PLC enclosure only has "
            "35 millimeter DIN rail space, zero 19-inch rack rails, so any 1U enterprise diode has to "
            "mount upstairs in the Level 3 OT control room rack RU-14 where we confirmed two empty 1U "
            "slots and six spare RJ45 ports. Also note three retrofitted S7-1200 and CompactLogix skids "
            "on ports 15 through 17 were never added to the 2021 Visio diagram."
        ),
        "observations": [
            {
                "observation_id": "VOBS-01",
                "category": "PHYSICAL_MOUNTING",
                "extracted_entity": "Level 3 Control Room 19-inch Rack (RU-14, 2 empty 1U slots)",
                "engineering_impact": "Mount ARCH_C_ENTERPRISE_1U_DIODE in L3 control room rack rather than DIN-only press skid.",
                "severity": "WARNING",
                "timestamp_offset_sec": 2.4,
            },
            {
                "observation_id": "VOBS-02",
                "category": "ROGUE_ASSET",
                "extracted_entity": "3x Retrofitted PLCs on Stratix Gi1/0/15-17 (.15, .16, .17)",
                "engineering_impact": "Reconcile undocumented shadow PLCs and include their Modbus/S7comm reads in TX local poller.",
                "severity": "WARNING",
                "timestamp_offset_sec": 9.8,
            },
        ],
    },
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
    "scenario_3_smart_building": {
        "raw_transcript": (
            "MetroCorp Tower MDF closet check: 48 Hikvision PoE cameras on VLAN 40 are streaming 420 "
            "megabits sustained into Corporate Milestone VMS, plus two loading-dock cameras on ports "
            "47 and 48 aren't on the riser sheet. We have one open 1U slot in the MDF rack—need a "
            "1-gigabit video diode to stop compromised camera firmware from pivoting into BMS chillers."
        ),
        "observations": [
            {
                "observation_id": "VOBS-01",
                "category": "PROTOCOL_REQUIREMENT",
                "extracted_entity": "48x RTSP 1080p camera feeds (420 Mbps sustained) + BACnet/MQTT",
                "engineering_impact": "Select ARCH_B_VIDEO_IOT_DIODE (800 Mbps sustained, 64x 1080p RTSP ceiling) in 1U half-rack slot.",
                "severity": "INFO",
                "timestamp_offset_sec": 3.0,
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
    "scenario_5_oil_gas_pipeline": {
        "raw_transcript": (
            "PermianStream Compressor Station CS-04 walkdown: NEMA-4X compressor house enclosure runs "
            "from minus 20 to plus 65 Celsius with DIN-rail mounting only. Houston Gas Control polls "
            "ROC800 RTUs over DNP3 and Triconex ESD status registers read-only over Ku-band VSAT, "
            "and we spotted an undocumented Lantronix RS-485 serial box on the odorizer skid with Telnet open."
        ),
        "observations": [
            {
                "observation_id": "VOBS-01",
                "category": "PHYSICAL_MOUNTING",
                "extracted_entity": "NEMA-4X wide-temp (-40 to +75C) DIN-rail compressor cabinet",
                "engineering_impact": "Select ruggedized fanless ARCH_A_FIELD_DIODE (DIN_RAIL, 65mm width).",
                "severity": "WARNING",
                "timestamp_offset_sec": 2.1,
            },
            {
                "observation_id": "VOBS-02",
                "category": "ROGUE_ASSET",
                "extracted_entity": "Undocumented Lantronix XPort serial server (.48) with cleartext Telnet/23",
                "engineering_impact": "Sever inbound TCP/23 at Layer 1/2 and disable Telnet on serial gateway.",
                "severity": "CRITICAL",
                "timestamp_offset_sec": 10.4,
            },
        ],
    },
    "scenario_6_pharma_cleanroom": {
        "raw_transcript": (
            "BioVance ISO-5 sterile biologics interstitial rack audit: 19-inch GMP server rack has "
            "two open 1U slots. Important operational constraint—Werum PAS-X MES in VLAN 90 must "
            "dispatch X.509-signed ISA-88 master batch recipes into the bioreactor batch executive on "
            "VLAN 60, so a pure one-way diode will break batch startup unless we use an OT-polled "
            "controlled gateway for VLAN 60 while keeping Grade-A particle counters strictly unidirectional."
        ),
        "observations": [
            {
                "observation_id": "VOBS-01",
                "category": "PROTOCOL_REQUIREMENT",
                "extracted_entity": "Mandatory Werum PAS-X MES X.509-signed ISA-88 Master Batch Recipe download",
                "engineering_impact": "Deploy ARCH_D_BIDIRECTIONAL_GATEWAY (OT-originated TCP SYN lock + schema guard) for VLAN 60 and ARCH_C_ENTERPRISE_1U_DIODE for VLAN 65.",
                "severity": "WARNING",
                "timestamp_offset_sec": 4.7,
            },
        ],
    },
}


def _split_reasoning_tags(raw_text: str) -> tuple[str, str | None]:
    """Extract inline `<think>...</think>` reasoning blocks if present."""
    match = re.search(r"<think>(.*?)</think>", raw_text, flags=re.DOTALL)
    if not match:
        return raw_text.strip(), None
    reasoning = match.group(1).strip()
    cleaned = re.sub(r"<think>.*?</think>", "", raw_text, flags=re.DOTALL).strip()
    return cleaned, reasoning


class MetaModelGateway:
    """Async client gateway across Meta Model API, Baseten Open-Weights, and Modal Glimmer."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    def _meta_openai_client(self) -> AsyncOpenAI:
        return AsyncOpenAI(
            base_url=self.settings.meta_api_base_url,
            api_key=self.settings.meta_model_api_key or "unconfigured-meta-key",
        )

    def _baseten_openai_client(self) -> AsyncOpenAI:
        return AsyncOpenAI(
            base_url=self.settings.baseten_api_base_url,
            api_key=self.settings.baseten_api_key or "unconfigured-baseten-key",
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
        """Invoke Meta `muse-spark` for multimodal reconciliation & structured extraction."""
        if not self.settings.meta_api_configured:
            return {
                "content": "",
                "model": self.settings.muse_spark_model,
                "provider": "meta_model_api",
                "source_mode": "demo_cache_fallback",
            }

        client = self._meta_openai_client()
        kwargs: dict[str, Any] = {
            "model": self.settings.muse_spark_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if response_format is not None:
            kwargs["response_format"] = response_format

        completion = await client.chat.completions.create(**kwargs)
        content = completion.choices[0].message.content or ""
        return {
            "content": content,
            "model": completion.model,
            "provider": "meta_model_api",
            "source_mode": "live",
        }

    async def chat_muse_wonder(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float = 0.1,
        max_tokens: int = 8192,
        response_format: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Invoke Meta `muse-wonder` frontier reasoning model for OT architecture synthesis."""
        if not self.settings.meta_api_configured:
            return {
                "content": "",
                "reasoning": None,
                "model": self.settings.muse_wonder_model,
                "provider": "meta_model_api",
                "source_mode": "demo_cache_fallback",
            }

        client = self._meta_openai_client()
        kwargs: dict[str, Any] = {
            "model": self.settings.muse_wonder_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
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

    async def chat_baseten_open(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float = 0.0,
        max_tokens: int = 4096,
    ) -> dict[str, Any]:
        """Invoke Baseten `meta-models/muse-spark-open-1026` for high-speed switch CLI parsing."""
        if not self.settings.baseten_api_configured:
            return {
                "content": "",
                "reasoning": None,
                "model": self.settings.baseten_model,
                "provider": "baseten_open_weights",
                "source_mode": "demo_cache_fallback",
            }

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
        explicit_reasoning = getattr(msg, "reasoning_content", None) or inline_reasoning
        return {
            "content": cleaned_content,
            "reasoning": explicit_reasoning,
            "model": completion.model,
            "provider": "baseten_open_weights",
            "source_mode": "live",
        }

    async def chat_air_gapped_glimmer(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float = 0.1,
        max_tokens: int = 8192,
    ) -> dict[str, Any]:
        """Route reasoning to Modal vLLM `meta-models/Muse-Glimmer-30B` (Apache 2.0 on-prem mode)."""
        if not self.settings.glimmer_endpoint_configured:
            return {
                "content": "",
                "reasoning": (
                    "Air-gapped open-weights fallback active: Muse-Glimmer-30B endpoint URL "
                    "not spun up; using deterministic rule-verified synthesis."
                ),
                "model": self.settings.muse_glimmer_model,
                "provider": "modal_vllm_air_gapped",
                "source_mode": "offline_air_gapped_fallback",
            }

        try:
            client = self._glimmer_openai_client()
            completion = await client.chat.completions.create(
                model=self.settings.muse_glimmer_model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            msg = completion.choices[0].message
            raw_content = msg.content or ""
            cleaned_content, inline_reasoning = _split_reasoning_tags(raw_content)
            return {
                "content": cleaned_content,
                "reasoning": getattr(msg, "reasoning_content", None) or inline_reasoning,
                "model": completion.model,
                "provider": "modal_vllm_air_gapped",
                "source_mode": "live",
            }
        except Exception as exc:
            if not self.settings.demo_cache_fallback:
                raise
            return {
                "content": "",
                "reasoning": f"Offline fallback engaged ({type(exc).__name__}).",
                "model": self.settings.muse_glimmer_model,
                "provider": "modal_vllm_air_gapped",
                "source_mode": "offline_air_gapped_fallback",
            }

    async def route_architect_reasoning(
        self,
        messages: list[dict[str, Any]],
        *,
        inference_mode: InferenceMode | None = None,
        temperature: float = 0.1,
        max_tokens: int = 8192,
    ) -> dict[str, Any]:
        """Switch architect reasoning between Cloud `Muse Wonder` and Air-Gapped `Muse Glimmer 30B`."""
        effective_mode: InferenceMode = inference_mode or (
            "air_gapped_open_weights"
            if self.settings.air_gapped_open_weights_mode
            else "cloud_meta_api"
        )
        if effective_mode == "air_gapped_open_weights":
            return await self.chat_air_gapped_glimmer(
                messages, temperature=temperature, max_tokens=max_tokens
            )
        return await self.chat_muse_wonder(
            messages, temperature=temperature, max_tokens=max_tokens
        )

    async def segment_sam31(
        self,
        image_path: str | Path,
        prompts: list[str] | None = None,
        *,
        mode: str = "mode_1_network_diagram",
    ) -> dict[str, Any]:
        """Execute Meta `sam-3.1` text-prompted segmentation with deterministic fallback."""
        path = Path(image_path)
        prompt_pack = load_sam31_vision_prompts()

        if self.settings.meta_api_configured and path.exists():
            try:
                encoded_image = base64.b64encode(path.read_bytes()).decode("ascii")
                payload = {
                    "model": self.settings.sam_3_1_model,
                    "image_base64": encoded_image,
                    "text_prompts": prompts or [],
                    "mode": mode,
                }
                async with httpx.AsyncClient(timeout=30.0) as http:
                    resp = await http.post(
                        f"{self.settings.meta_api_base_url.rstrip('/')}/images/segmentations",
                        headers={
                            "Authorization": f"Bearer {self.settings.meta_model_api_key}"
                        },
                        json=payload,
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    data["source_mode"] = "live_sam31"
                    return data
            except Exception:
                if not self.settings.demo_cache_fallback:
                    raise

        if mode == "mode_2_cabinet_rack_sizer":
            examples = prompt_pack.get("mode_2_cabinet_rack_sizer", {}).get(
                "few_shot_examples", []
            )
            is_din = "din" in path.name.lower() or "rogue" in path.name.lower()
            chosen = (
                examples[1]["expected_output"]
                if is_din and len(examples) > 1
                else examples[0]["expected_output"]
            )
            return {
                "model": self.settings.sam_3_1_model,
                "mode": mode,
                "source_mode": "demo_cache_fallback",
                "result": chosen,
            }

        return {
            "model": self.settings.sam_3_1_model,
            "mode": mode,
            "source_mode": "demo_cache_fallback",
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
        """Generate an engineering visual / rack mounting diagram card via `muse-image`."""
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
                return {
                    "model": self.settings.muse_image_model,
                    "source_mode": "live",
                    "image_url": getattr(first, "url", None),
                    "b64_json": getattr(first, "b64_json", None),
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
        """Transcribe OT field audio notes via `POST {meta_api_base_url}/asr` (`muse-voice-transcribe`)."""
        if audio_bytes and self.settings.meta_api_configured:
            try:
                asr_url = f"{self.settings.meta_api_base_url.rstrip('/')}/asr"
                async with httpx.AsyncClient(timeout=30.0) as http:
                    resp = await http.post(
                        asr_url,
                        headers={
                            "Authorization": f"Bearer {self.settings.meta_model_api_key}"
                        },
                        data={"model": self.settings.muse_voice_transcribe_model},
                        files={"file": (filename, audio_bytes, "audio/wav")},
                    )
                    resp.raise_for_status()
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
                if not self.settings.demo_cache_fallback:
                    raise

        effective_scenario = scenario_id or "scenario_1_manufacturing"
        demo_entry = _SCENARIO_DEMO_TRANSCRIPTS.get(
            effective_scenario,
            _SCENARIO_DEMO_TRANSCRIPTS["scenario_1_manufacturing"],
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
                "endpoint_base_url": self.settings.meta_api_base_url,
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
                "endpoint_base_url": self.settings.meta_api_base_url,
                "api_key_configured": meta_ready,
                "demo_fallback_ready": fallback,
                "operational_status": _status_label(meta_ready),
            },
            "muse_voice_transcribe": {
                "model_id": self.settings.muse_voice_transcribe_model,
                "provider": "Meta Model API",
                "role": "Hands-free OT plant walkdown voice field note ASR (`POST /v1/asr`)",
                "endpoint_base_url": f"{self.settings.meta_api_base_url.rstrip('/')}/asr",
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
                "demo_fallback_ready": fallback,
                "operational_status": _status_label(baseten_ready),
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
                else ("sandbox_profile_ready" if self.settings.modal_profile else _status_label(False)),
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
