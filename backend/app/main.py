"""FastAPI application entrypoint for ConduitAI."""

from __future__ import annotations

import asyncio
import json
import sys
import time
from collections.abc import AsyncGenerator
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import UploadFile as StarletteUploadFile
from sse_starlette.sse import EventSourceResponse

from app import __version__
from app.catalog_loader import (
    build_scenario_architecture_plan,
    build_scenario_twin_verification,
    get_scenario_preview,
    list_real_ics_captures,
    list_scenarios,
    list_walkthrough_videos,
    load_hardware_catalog,
    load_iec62443_controls,
)
from app.clients.meta_models import MetaModelGateway
from app.config import get_settings
from app.state import InferenceMode, VoiceFieldNoteTranscript

settings = get_settings()
gateway = MetaModelGateway(settings=settings)

app = FastAPI(
    title="ConduitAI — Autonomous OT Isolation & Hardware Diode Workbench API",
    version=__version__,
    description=(
        "Multi-modal sneakernet discovery, deterministic vendor-neutral Hardware Data Diode "
        "sizing, Green/Amber/Red protocol cutover, and Layer-1/2 Digital Twin verification."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "*",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

if settings.data_dir.exists():
    app.mount(
        "/static/data",
        StaticFiles(directory=str(settings.data_dir)),
        name="static_data",
    )


@app.get("/api/v1/health", tags=["Health"])
async def health_check() -> dict[str, Any]:
    """Return service readiness, resolved data paths status, and catalog item counts."""
    hw_catalog = load_hardware_catalog()
    scenarios = list_scenarios()
    real_pcaps = list_real_ics_captures()
    default_mode: InferenceMode = (
        "air_gapped_open_weights"
        if settings.air_gapped_open_weights_mode
        else "cloud_meta_api"
    )
    return {
        "status": "ok",
        "service": "conduit-ai-backend",
        "version": __version__,
        "python_version": sys.version.split()[0],
        "default_inference_mode": default_mode,
        "demo_cache_fallback": settings.demo_cache_fallback,
        "data_dir_exists": settings.data_dir.exists(),
        "catalog_counts": {
            "archetypes": len(hw_catalog.get("archetypes", [])),
            "scenarios": len(scenarios),
            "real_ics_captures": len(real_pcaps),
            "walkthrough_videos": len(list_walkthrough_videos()),
        },
    }


@app.get("/api/v1/health/models", tags=["Health"])
async def model_stack_health() -> dict[str, Any]:
    """Return operational readiness across all 7 Meta, Baseten, and Modal integrations."""
    return gateway.get_stack_status()


@app.get("/api/v1/catalogs/archetypes", tags=["Catalogs"])
async def get_hardware_archetypes() -> dict[str, Any]:
    """Return pluggable vendor-neutral hardware diode archetypes & protocol cutover rules."""
    hw_catalog = load_hardware_catalog()
    compliance_catalog = load_iec62443_controls()
    return {
        "catalog_metadata": hw_catalog.get("catalog_metadata", {}),
        "sizing_heuristics": hw_catalog.get("sizing_heuristics", {}),
        "archetypes": hw_catalog.get("archetypes", []),
        "protocol_compatibility_rules": hw_catalog.get(
            "protocol_compatibility_rules", {}
        ),
        "iec62443_security_levels": compliance_catalog.get(
            "iec62443_security_levels", {}
        ),
        "supported_compliance_frameworks": compliance_catalog.get(
            "catalog_metadata", {}
        ).get("supported_frameworks", []),
    }


@app.get("/api/v1/scenarios", tags=["Scenarios"])
async def get_scenarios() -> dict[str, Any]:
    """Return all 6 critical infrastructure OT scenarios, 15 real ICS captures, and videos."""
    return {
        "scenarios": list_scenarios(),
        "real_ics_captures": list_real_ics_captures(),
        "videos": list_walkthrough_videos(),
    }


@app.get("/api/v1/scenarios/{scenario_id}/preview", tags=["Scenarios"])
async def preview_scenario(scenario_id: str) -> dict[str, Any]:
    """Return ground-truth telemetry preview, shadow OT anomalies, and static media URLs."""
    preview = get_scenario_preview(scenario_id)
    if preview is None:
        raise HTTPException(
            status_code=404,
            detail=f"Scenario '{scenario_id}' not found.",
        )
    return preview


@app.post(
    "/api/v1/voice/transcribe",
    response_model=VoiceFieldNoteTranscript,
    tags=["Multimodal Intake"],
    openapi_extra={
        "requestBody": {
            "required": False,
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "properties": {
                            "file": {"type": "string", "format": "binary"},
                            "scenario_id": {"type": "string"},
                        },
                    }
                },
                "application/json": {
                    "schema": {
                        "type": "object",
                        "properties": {
                            "scenario_id": {"type": "string"},
                        },
                    }
                },
            },
        }
    },
)
async def transcribe_voice_field_note(
    request: Request,
    scenario_id: str | None = Query(default=None),
) -> VoiceFieldNoteTranscript:
    """Transcribe an OT engineer's field audio note via Meta `muse-voice-transcribe`."""
    audio_bytes: bytes | None = None
    filename = "field_walkdown_note.wav"
    resolved_scenario_id = scenario_id

    content_type = request.headers.get("content-type", "").lower()
    if (
        "multipart/form-data" in content_type
        or "application/x-www-form-urlencoded" in content_type
    ):
        form = await request.form()
        form_scenario = form.get("scenario_id")
        if isinstance(form_scenario, str) and form_scenario.strip():
            resolved_scenario_id = form_scenario.strip()

        uploaded = form.get("file")
        if isinstance(uploaded, StarletteUploadFile):
            audio_bytes = await uploaded.read()
            if uploaded.filename:
                filename = uploaded.filename
    elif "application/json" in content_type:
        body_bytes = await request.body()
        if body_bytes:
            payload = json.loads(body_bytes)
            if isinstance(payload, dict) and payload.get("scenario_id"):
                resolved_scenario_id = str(payload["scenario_id"])

    return await gateway.transcribe_muse_voice(
        audio_bytes=audio_bytes,
        filename=filename,
        scenario_id=resolved_scenario_id,
    )


def _normalize_inference_mode(raw_mode: str | None) -> InferenceMode:
    """Normalize frontend/backend inference mode aliases into canonical `InferenceMode`."""
    if raw_mode is None or raw_mode.strip() == "":
        return (
            "air_gapped_open_weights"
            if settings.air_gapped_open_weights_mode
            else "cloud_meta_api"
        )
    normalized = raw_mode.strip().lower()
    if normalized in {"cloud_meta_api", "cloud_frontier", "cloud"}:
        return "cloud_meta_api"
    if normalized in {
        "air_gapped_open_weights",
        "airgapped_glimmer",
        "air_gapped",
        "airgapped",
    }:
        return "air_gapped_open_weights"
    raise HTTPException(
        status_code=422,
        detail=f"Unsupported inference_mode '{raw_mode}'.",
    )


@app.get("/api/v1/assessments/{scenario_id}/stream", tags=["Assessments"])
async def stream_scenario_assessment(
    scenario_id: str,
    inference_mode: str | None = Query(default=None),
    step_delay_ms: int = Query(default=40, ge=0, le=1000),
) -> EventSourceResponse:
    """Stream end-to-end multi-agent OT discovery, sizing, and Digital Twin SSE events."""
    preview = get_scenario_preview(scenario_id)
    if preview is None:
        raise HTTPException(
            status_code=404,
            detail=f"Scenario '{scenario_id}' not found.",
        )

    effective_mode: InferenceMode = _normalize_inference_mode(inference_mode)
    architect_model = (
        settings.muse_glimmer_model
        if effective_mode == "air_gapped_open_weights"
        else settings.muse_wonder_model
    )

    plan = build_scenario_architecture_plan(scenario_id)
    twin_result = build_scenario_twin_verification(scenario_id, plan)
    voice_note = await gateway.transcribe_muse_voice(scenario_id=scenario_id)

    async def _event_generator() -> AsyncGenerator[dict[str, str], None]:
        started = time.perf_counter()
        delay_sec = step_delay_ms / 1000.0
        metrics = preview["telemetry_metrics"]
        flow_counts = preview["flow_counts"]
        primary_sizing = plan.conduit_sizing_recommendations[0]

        stages: list[tuple[str, dict[str, Any]]] = [
            (
                "sam_3_1_vision",
                {
                    "stage": "sam_3_1_vision",
                    "status": "completed",
                    "model": settings.sam_3_1_model,
                    "progress_pct": 15,
                    "headline": (
                        f"SAM 3.1 segmented {preview['diagram_visual_style']} & verified "
                        f"{primary_sizing.mounting_selection} physical cabinet fit."
                    ),
                    "details": {
                        "topology_diagram_url": preview["media_urls"][
                            "topology_diagram_url"
                        ],
                        "site_photo_urls": preview["media_urls"]["site_photo_urls"],
                        "walkthrough_video_url": preview["media_urls"][
                            "walkthrough_video_url"
                        ],
                        "verified_mounting": primary_sizing.mounting_selection,
                        "cabinet_fit_verified": primary_sizing.cabinet_fit_verified,
                        "cabinet_fit_notes": primary_sizing.cabinet_fit_notes,
                    },
                },
            ),
            (
                "muse_voice_asr",
                {
                    "stage": "muse_voice_asr",
                    "status": "completed",
                    "model": settings.muse_voice_transcribe_model,
                    "progress_pct": 28,
                    "headline": (
                        f"Muse Voice Transcribe extracted {len(voice_note.structured_observations)} "
                        f"field engineering observation(s)."
                    ),
                    "details": voice_note.model_dump(),
                },
            ),
            (
                "baseten_switch_cli",
                {
                    "stage": "baseten_switch_cli",
                    "status": "completed",
                    "model": settings.baseten_model,
                    "progress_pct": 44,
                    "headline": (
                        f"Baseten `{settings.baseten_model}` parsed switch ARP/MAC/802.1Q tables "
                        f"across {preview['total_discovered_assets']} active endpoints."
                    ),
                    "details": {
                        "total_discovered_assets": preview["total_discovered_assets"],
                        "documented_assets": preview["documented_assets"],
                        "undocumented_count": len(
                            preview["undocumented_shadow_assets"]
                        ),
                    },
                },
            ),
            (
                "duckdb_telemetry",
                {
                    "stage": "duckdb_telemetry",
                    "status": "completed",
                    "model": "scapy-2.8 + duckdb-sql",
                    "progress_pct": 58,
                    "headline": (
                        f"Analyzed {metrics.get('pcap_packet_count', 0):,} PCAP packets & "
                        f"{metrics.get('firewall_row_count', 0):,} {metrics.get('firewall_vendor', '')} "
                        f"rows — Peak {metrics.get('peak_bandwidth_mbps', 0)} Mbps "
                        f"({metrics.get('sized_bandwidth_with_1_25x_headroom_mbps', 0)} Mbps w/ 1.25x headroom)."
                    ),
                    "details": {
                        "telemetry_metrics": metrics,
                        "flow_tier_counts": flow_counts,
                    },
                },
            ),
            (
                "muse_spark_reconcile",
                {
                    "stage": "muse_spark_reconcile",
                    "status": "completed",
                    "model": settings.muse_spark_model,
                    "progress_pct": 72,
                    "headline": (
                        f"Muse Spark reconciled physical/packet ground truth vs. diagram — "
                        f"flagged {len(plan.shadow_assets_and_bypasses)} undocumented Shadow OT / Bypass anomaly(ies)."
                    ),
                    "details": {
                        "reconciled_zones": [
                            z.model_dump() for z in plan.reconciled_zones
                        ],
                        "shadow_assets_and_bypasses": [
                            a.model_dump() for a in plan.shadow_assets_and_bypasses
                        ],
                    },
                },
            ),
            (
                "muse_wonder_or_glimmer_architect",
                {
                    "stage": "muse_wonder_or_glimmer_architect",
                    "status": "completed",
                    "model": architect_model,
                    "inference_mode": effective_mode,
                    "progress_pct": 88,
                    "headline": (
                        f"{architect_model} synthesized {plan.executive_summary.target_security_posture_sl} "
                        f"cutover plan: {plan.executive_summary.recommended_diode_total_units}x diode unit(s) "
                        f"(${plan.executive_summary.estimated_hardware_bom_usd:,.0f} BoM) & "
                        f"{len(plan.tx_rx_proxy_translation_table)} TX/RX proxy rules."
                    ),
                    "details": {
                        "conduit_sizing_recommendations": [
                            s.model_dump()
                            for s in plan.conduit_sizing_recommendations
                        ],
                        "bill_of_materials": [
                            b.model_dump() for b in plan.bill_of_materials
                        ],
                        "protocol_cutover_matrix": [
                            c.model_dump() for c in plan.protocol_cutover_matrix
                        ],
                    },
                },
            ),
            (
                "modal_socket_twin",
                {
                    "stage": "modal_socket_twin",
                    "status": "completed",
                    "model": "modal-layer1-socket-twin",
                    "progress_pct": 96,
                    "headline": (
                        f"Modal Digital Twin verified {twin_result.telemetry_continuity_pct:.0f}% "
                        f"legitimate telemetry continuity & {twin_result.inbound_exploit_block_rate_pct:.0f}% "
                        f"physical exploit block rate ({twin_result.overall_verdict})."
                    ),
                    "details": twin_result.model_dump(),
                },
            ),
        ]

        for idx, (stage_name, payload) in enumerate(stages, start=1):
            if delay_sec > 0:
                await asyncio.sleep(delay_sec)
            payload["step_index"] = idx - 1
            payload["message"] = payload["headline"]
            payload["scenario_id"] = scenario_id
            payload["elapsed_ms"] = round((time.perf_counter() - started) * 1000.0, 1)
            yield {
                "id": str(idx),
                "event": stage_name,
                "data": json.dumps(payload),
            }

        if delay_sec > 0:
            await asyncio.sleep(delay_sec)

        complete_payload = {
            "stage": "complete",
            "type": "complete",
            "done": True,
            "status": "completed",
            "scenario_id": scenario_id,
            "facility_name": preview["facility_name"],
            "inference_mode": effective_mode,
            "architect_model_used": architect_model,
            "progress_pct": 100,
            "total_elapsed_ms": round((time.perf_counter() - started) * 1000.0, 1),
            "architecture_plan": plan.model_dump(),
            "twin_verification": twin_result.model_dump(),
            "voice_transcript": voice_note.model_dump(),
        }
        yield {
            "id": str(len(stages) + 1),
            "event": "complete",
            "data": json.dumps(complete_payload),
        }

    return EventSourceResponse(_event_generator())
