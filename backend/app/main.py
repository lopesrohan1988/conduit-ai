"""FastAPI application entrypoint for ConduitAI."""

from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import time
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from starlette.datastructures import UploadFile as StarletteUploadFile

from app import __version__
from app.agents.architect_llm_planner import challenge_verifier
from app.agents.architect_sizing_agent import generate_switch_cutover_cli
from app.agents.langgraph_workflow import (
    build_conduit_langgraph,
    build_scenario_initial_state,
)
from app.catalog_loader import (
    get_scenario_preview,
    list_capture_sites,
    list_real_ics_captures,
    list_scenarios,
    list_walkthrough_videos,
    load_hardware_catalog,
    load_iec62443_controls,
)
from app.clients.meta_models import MetaModelGateway
from app.config import get_settings
from app.exporters.deliverables import (
    export_cutover_zip_bundle,
    export_drawio_xml,
    export_executive_pdf,
)
from app.state import (
    ConduitArchitecturePlan,
    ConduitGraphState,
    InferenceMode,
    VoiceFieldNoteTranscript,
)
from app.attack_replay import replay_attacks
from app.topology_view import build_topology_view
from app.twin.modal_cutover_twin import verify_cutover_in_digital_twin

settings = get_settings()
gateway = MetaModelGateway(settings=settings)

# Most recent pipeline-computed plan per scenario, so exports match what the user just saw
_LATEST_SCENARIO_PLANS: dict[str, ConduitArchitecturePlan] = {}
# The evidence behind each of those plans, so the rule checker can be challenged on them
_LATEST_SCENARIO_EVIDENCE: dict[str, dict[str, Any]] = {}
# The switch cutover config built with that plan, so the bundle carries the ports the UI showed
_LATEST_SCENARIO_CLI: dict[str, str] = {}


async def _resolve_scenario_plan(scenario_id: str) -> ConduitArchitecturePlan:
    """Return the last streamed plan for a scenario, or compute one with the rule engine."""
    if get_scenario_preview(scenario_id) is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found.")
    cached = _LATEST_SCENARIO_PLANS.get(scenario_id)
    if cached is not None:
        return cached
    compiled_graph, scratch = build_conduit_langgraph(
        settings=settings, gateway=gateway, use_live_llm=False
    )
    final_state = await compiled_graph.ainvoke(
        build_scenario_initial_state(scenario_id, settings=settings)
    )
    plan: ConduitArchitecturePlan = final_state["architecture_plan"]
    _LATEST_SCENARIO_PLANS[scenario_id] = plan
    if cli := scratch.get("architect_meta", {}).get("switch_cutover_cli"):
        _LATEST_SCENARIO_CLI[scenario_id] = cli
    return plan

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


class RackCardRequest(BaseModel):
    """Request body for generating an annotated rack/DIN installation card via `muse-image-1.0`."""

    scenario_id: str | None = "scenario_2_substation"
    prompt_override: str | None = None
    size: str = "1024x1024"


class TwinVerifyRequest(BaseModel):
    """Request body for on-demand Layer-1/2 Digital Twin verification."""

    scenario_id: str = "scenario_2_substation"
    use_modal_cloud: bool = False


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


@app.get("/api/v1/capture-sites", tags=["Scenarios"])
async def get_capture_sites() -> dict[str, Any]:
    """Public ICS captures the pipeline can analyse as a never-seen site, from the packets alone."""
    return {"capture_sites": list_capture_sites()}


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
    """Transcribe an OT engineer's field audio note via Meta `muse-voice-transcribe-1.0`."""
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


_PROGRESS_BY_STAGE: dict[str, int] = {
    "sam_3_1_vision": 15,
    "muse_voice_asr": 28,
    "baseten_switch_cli": 44,
    "duckdb_telemetry": 58,
    "muse_spark_reconcile": 72,
    "muse_wonder_or_glimmer_architect": 88,
    "modal_socket_twin": 96,
}


def _measured_payload(state: dict[str, Any], scratch: dict[str, Any]) -> dict[str, Any]:
    """SAM 3.1 measurements, video tracks and the today-vs-proposed map built from the run."""
    video = state.get("video_walkthrough_result")
    plan = state.get("architecture_plan")
    return {
        "cabinet_inspections": [c.model_dump() for c in state.get("cabinet_inspections") or []],
        "video_walkthrough": video.model_dump() if video else None,
        "diagram_reading": scratch.get("diagram_reading"),
        "attack_replay": (
            replay_attacks(
                plan=plan,
                telemetry_audit=scratch.get("telemetry_audit"),
                switch_audit=scratch.get("switch_audit"),
            )
            if plan
            else None
        ),
        "topology": (
            build_topology_view(
                plan=plan,
                switch_audit=scratch.get("switch_audit"),
                telemetry_audit=scratch.get("telemetry_audit"),
                cabinet_inspections=state.get("cabinet_inspections"),
            )
            if plan
            else None
        ),
    }


@app.get("/api/v1/assessments/{scenario_id}/stream", tags=["Assessments"])
async def stream_scenario_assessment(
    scenario_id: str,
    inference_mode: str | None = Query(default=None),
    step_delay_ms: int = Query(default=40, ge=0, le=1000),
    live_llm: bool | None = Query(default=None),
    use_modal_cloud: bool = Query(default=False),
) -> EventSourceResponse:
    """Stream real-time LangGraph multi-agent OT discovery, sizing, and Digital Twin SSE events."""
    preview = get_scenario_preview(scenario_id)
    if preview is None:
        raise HTTPException(
            status_code=404,
            detail=f"Scenario '{scenario_id}' not found.",
        )

    effective_mode: InferenceMode = _normalize_inference_mode(inference_mode)
    effective_live_llm = (
        live_llm
        if live_llm is not None
        # Interactive runs always try the models; without a key each call replays its recorded
        # output (or reports it unavailable), so a keyless public demo still shows model results
        else step_delay_ms > 0
    )

    initial_state = build_scenario_initial_state(
        scenario_id, inference_mode=effective_mode, settings=settings
    )
    compiled_graph, scratch = build_conduit_langgraph(
        settings=settings,
        gateway=gateway,
        use_live_llm=effective_live_llm,
        use_modal_cloud=use_modal_cloud,
    )

    async def _event_generator() -> AsyncGenerator[dict[str, str], None]:
        started = time.perf_counter()
        delay_sec = step_delay_ms / 1000.0
        accumulated_state: dict[str, Any] = dict(initial_state)
        step_idx = 0

        async for chunk in compiled_graph.astream(initial_state, stream_mode="updates"):
            for node_name, update_dict in chunk.items():
                accumulated_state.update(update_dict)
                events = update_dict.get("agent_events") or []
                ev_meta = events[-1] if events else {}

                if delay_sec > 0:
                    await asyncio.sleep(delay_sec)

                headline = str(ev_meta.get("headline") or f"Completed {node_name}")
                model_used = str(ev_meta.get("model") or node_name)
                source_mode = str(ev_meta.get("source_mode") or "deterministic")

                details: dict[str, Any] = {"source_mode": source_mode}
                if node_name == "sam_3_1_vision":
                    cabs = accumulated_state.get("cabinet_inspections") or []
                    details.update(
                        {
                            "topology_diagram_url": preview["media_urls"]["topology_diagram_url"],
                            "site_photo_urls": preview["media_urls"]["site_photo_urls"],
                            "walkthrough_video_url": preview["media_urls"]["walkthrough_video_url"],
                            "cabinet_inspections": [c.model_dump() for c in cabs],
                        }
                    )
                elif node_name == "muse_voice_asr" and accumulated_state.get("voice_transcript"):
                    details.update(accumulated_state["voice_transcript"].model_dump())
                elif node_name == "baseten_switch_cli":
                    sw = scratch.get("switch_audit")
                    if sw:
                        details.update(
                            {
                                "switch_hostname": sw.switch_hostname,
                                "total_discovered_assets": sw.total_discovered_assets,
                                "documented_assets": sw.documented_assets_count,
                                "undocumented_count": len(sw.shadow_anomalies),
                            }
                        )
                elif node_name == "duckdb_telemetry":
                    tel = scratch.get("telemetry_audit")
                    if tel:
                        details.update(
                            {
                                "pcap_packet_count": tel.pcap_packet_count,
                                "firewall_vendor": tel.firewall_vendor,
                                "firewall_row_count": tel.firewall_row_count,
                                "peak_bandwidth_mbps": tel.peak_bandwidth_mbps,
                                "sized_bandwidth_with_1_25x_headroom_mbps": tel.sized_bandwidth_with_1_25x_headroom_mbps,
                                "flow_tier_counts": tel.flow_tier_counts,
                            }
                        )
                elif node_name == "muse_wonder_or_glimmer_architect" and accumulated_state.get("architecture_plan"):
                    plan_obj = accumulated_state["architecture_plan"]
                    details.update(
                        {
                            "conduit_sizing_recommendations": [
                                s.model_dump() for s in plan_obj.conduit_sizing_recommendations
                            ],
                            "bill_of_materials": [
                                b.model_dump() for b in plan_obj.bill_of_materials
                            ],
                            "switch_cutover_cli": scratch.get("architect_meta", {}).get(
                                "switch_cutover_cli", ""
                            ),
                            "planner_trace": scratch.get("architect_meta", {}).get("planner_trace"),
                        }
                    )
                elif node_name == "modal_socket_twin" and accumulated_state.get("twin_verification"):
                    details.update(accumulated_state["twin_verification"].model_dump())

                payload = {
                    "stage": node_name,
                    "status": "completed",
                    "step_index": step_idx,
                    "model": model_used,
                    "inference_mode": effective_mode,
                    "progress_pct": _PROGRESS_BY_STAGE.get(node_name, 90),
                    "headline": headline,
                    "message": headline,
                    "scenario_id": scenario_id,
                    "elapsed_ms": round((time.perf_counter() - started) * 1000.0, 1),
                    "details": details,
                }
                step_idx += 1
                yield {
                    "id": str(step_idx),
                    "event": node_name,
                    "data": json.dumps(payload),
                }

        if delay_sec > 0:
            await asyncio.sleep(delay_sec)

        plan_final = accumulated_state["architecture_plan"]
        _LATEST_SCENARIO_PLANS[scenario_id] = plan_final
        if cli := scratch.get("architect_meta", {}).get("switch_cutover_cli"):
            _LATEST_SCENARIO_CLI[scenario_id] = cli
        if scratch.get("telemetry_audit") is not None:
            _LATEST_SCENARIO_EVIDENCE[scenario_id] = {
                "telemetry_audit": scratch["telemetry_audit"],
                "cabinet_inspections": accumulated_state.get("cabinet_inspections") or [],
                "video_walkthrough": accumulated_state.get("video_walkthrough_result"),
            }
        twin_final = accumulated_state["twin_verification"]
        voice_final = accumulated_state["voice_transcript"]
        architect_model = scratch.get("architect_meta", {}).get(
            "architect_model",
            settings.open_weights_model
            if effective_mode == "air_gapped_open_weights"
            else settings.muse_wonder_model,
        )

        complete_payload = {
            "stage": "complete",
            "type": "complete",
            "done": True,
            "status": "completed",
            "scenario_id": scenario_id,
            "facility_name": preview["facility_name"],
            "inference_mode": effective_mode,
            "architect_model_used": architect_model,
            "live_llm_executed": effective_live_llm,
            "architect_source_mode": scratch.get("architect_meta", {}).get(
                "source_mode", "deterministic_rule_engine"
            ),
            "planner_trace": scratch.get("architect_meta", {}).get("planner_trace"),
            "progress_pct": 100,
            "total_elapsed_ms": round((time.perf_counter() - started) * 1000.0, 1),
            "architecture_plan": plan_final.model_dump(),
            "twin_verification": twin_final.model_dump(),
            "voice_transcript": voice_final.model_dump(),
            **_measured_payload(accumulated_state, scratch),
            "switch_cutover_cli": scratch.get("architect_meta", {}).get(
                "switch_cutover_cli", ""
            ),
        }
        yield {
            "id": str(step_idx + 1),
            "event": "complete",
            "data": json.dumps(complete_payload),
        }

    return EventSourceResponse(_event_generator())


@app.post("/api/v1/assessments/{scenario_id}/challenge-verifier", tags=["Assessments"])
async def challenge_scenario_verifier(scenario_id: str) -> dict[str, Any]:
    """Reopen the most dangerous connection the latest plan cut and show the verifier's verdict."""
    plan = _LATEST_SCENARIO_PLANS.get(scenario_id)
    evidence = _LATEST_SCENARIO_EVIDENCE.get(scenario_id)
    if plan is None or evidence is None:
        raise HTTPException(status_code=409, detail="Run the analysis for this site first.")
    return {"challenge": challenge_verifier(plan, **evidence)}


@app.post("/api/v1/assessments/custom/analyze", tags=["Assessments"])
async def analyze_custom_uploaded_site(
    request: Request,
    facility_name: str = Query(default="Custom Critical Infrastructure Site"),
    inference_mode: str | None = Query(default=None),
    live_llm: bool = Query(default=False),
) -> dict[str, Any]:
    """Execute the full LangGraph discovery, sizing, and socket twin pipeline on uploaded files."""
    effective_mode = _normalize_inference_mode(inference_mode)
    form = await request.form()

    with tempfile.TemporaryDirectory(prefix="conduitai_intake_") as tmp_str:
        tmp_dir = Path(tmp_str)
        saved_paths: dict[str, Path] = {}
        voice_bytes: bytes | None = None
        voice_name = "custom_walkdown.wav"

        for key in (
            "diagram_file",
            "cabinet_file",
            "video_file",
            "pcap_file",
            "firewall_csv_file",
            "switch_dump_file",
            "asset_inventory_file",
            "voice_file",
        ):
            item = form.get(key)
            if isinstance(item, StarletteUploadFile):
                raw_bytes = await item.read()
                safe_name = Path(item.filename or f"{key}.bin").name
                if key == "voice_file":
                    voice_bytes = raw_bytes
                    voice_name = safe_name
                else:
                    dest = tmp_dir / safe_name
                    dest.write_bytes(raw_bytes)
                    saved_paths[key] = dest

        custom_state: ConduitGraphState = {
            "facility_name": str(form.get("facility_name") or facility_name),
            "inference_mode": effective_mode,
            "diagram_image_path": str(saved_paths["diagram_file"])
            if "diagram_file" in saved_paths
            else None,
            "cabinet_image_paths": [str(saved_paths["cabinet_file"])]
            if "cabinet_file" in saved_paths
            else [],
            "video_walkthrough_path": str(saved_paths["video_file"])
            if "video_file" in saved_paths
            else None,
            "pcap_path": str(saved_paths["pcap_file"])
            if "pcap_file" in saved_paths
            else None,
            "firewall_csv_path": str(saved_paths["firewall_csv_file"])
            if "firewall_csv_file" in saved_paths
            else None,
            "switch_dump_path": str(saved_paths["switch_dump_file"])
            if "switch_dump_file" in saved_paths
            else None,
            "asset_inventory_csv_path": str(saved_paths["asset_inventory_file"])
            if "asset_inventory_file" in saved_paths
            else None,
            "voice_audio_bytes": voice_bytes,
            "voice_audio_filename": voice_name,
            "agent_events": [],
            "errors": [],
        }

        compiled_graph, scratch = build_conduit_langgraph(
            settings=settings,
            gateway=gateway,
            use_live_llm=live_llm,
        )
        final_state = await compiled_graph.ainvoke(custom_state)

    plan = final_state["architecture_plan"]
    twin = final_state["twin_verification"]
    voice = final_state["voice_transcript"]
    return {
        "status": "completed",
        "facility_name": custom_state["facility_name"],
        "inference_mode": effective_mode,
        "architecture_plan": plan.model_dump(),
        "twin_verification": twin.model_dump(),
        "voice_transcript": voice.model_dump() if voice else None,
        "switch_cutover_cli": scratch.get("architect_meta", {}).get(
            "switch_cutover_cli", generate_switch_cutover_cli(plan)
        ),
        "architect_source_mode": scratch.get("architect_meta", {}).get(
            "source_mode", "deterministic_rule_engine"
        ),
        "planner_trace": scratch.get("architect_meta", {}).get("planner_trace"),
        "agent_events": final_state.get("agent_events", []),
        **_measured_payload(final_state, scratch),
    }


@app.get(
    "/api/v1/assessments/{scenario_id}/export/{export_format}",
    tags=["Deliverable Exports"],
)
async def export_scenario_deliverable(
    scenario_id: str,
    export_format: str,
) -> Response:
    """Download `.drawio` topology XML, ReportLab `.pdf` report, or `.zip` cutover bundle."""
    plan = await _resolve_scenario_plan(scenario_id)

    twin = verify_cutover_in_digital_twin(plan, scenario_id=scenario_id)
    fmt = export_format.strip().lower()

    if fmt == "drawio":
        xml_str = export_drawio_xml(plan)
        return Response(
            content=xml_str.encode("utf-8"),
            media_type="application/xml",
            headers={
                "Content-Disposition": f'attachment; filename="conduitai_{scenario_id}_target_sl4.drawio"'
            },
        )
    if fmt == "pdf":
        pdf_bytes = export_executive_pdf(plan, twin)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="conduitai_{scenario_id}_compliance_report.pdf"'
            },
        )
    if fmt == "zip":
        zip_bytes = export_cutover_zip_bundle(plan, twin, cli_script=_LATEST_SCENARIO_CLI.get(scenario_id))
        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="conduitai_{scenario_id}_cutover_bundle.zip"'
            },
        )

    raise HTTPException(
        status_code=422,
        detail=f"Unsupported export format '{export_format}'. Expected 'drawio', 'pdf', or 'zip'.",
    )


@app.post("/api/v1/twin/verify", tags=["Digital Twin"])
async def verify_scenario_digital_twin(req: TwinVerifyRequest) -> dict[str, Any]:
    """Execute on-demand Layer-1/2 `os.pipe()` + TCP socket Digital Twin verification."""
    plan = await _resolve_scenario_plan(req.scenario_id)

    twin = await asyncio.to_thread(
        verify_cutover_in_digital_twin,
        plan,
        scenario_id=req.scenario_id,
        use_modal_cloud=req.use_modal_cloud,
    )
    return twin.model_dump()


@app.post("/api/v1/visuals/rack-card", tags=["Visual Synthesis"])
async def generate_rack_installation_card(req: RackCardRequest) -> dict[str, Any]:
    """Generate an annotated hardware diode rack/DIN installation visual via `muse-image-1.0`."""
    if req.prompt_override:
        prompt = req.prompt_override
    else:
        sc_id = req.scenario_id or "scenario_2_substation"
        try:
            plan = await _resolve_scenario_plan(sc_id)
            rec = plan.conduit_sizing_recommendations[0]
            prompt = (
                f"Clean industrial engineering elevation diagram of {rec.quantity}x "
                f"{rec.recommended_archetype_id} optical hardware data diode mounted in "
                f"{rec.mounting_selection} for {plan.executive_summary.facility_name}, "
                f"showing green TX fiber output to blue RX replica switch, high-contrast technical blueprint style"
            )
        except HTTPException:
            prompt = (
                "Clean technical blueprint elevation of a 1U hardware data diode optical isolation "
                "appliance in a 19-inch OT server rack with green TX to RX fiber link"
            )

    return await gateway.generate_muse_image(prompt, size=req.size)

