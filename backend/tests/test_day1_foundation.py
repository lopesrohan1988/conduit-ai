"""Day 1 Foundation Test Suite for ConduitAI Backend."""

from __future__ import annotations

import json
import re
from typing import Any

import httpx
import pytest

from app.catalog_loader import (
    build_scenario_architecture_plan,
    list_real_ics_captures,
    list_scenarios,
    list_walkthrough_videos,
    load_sam31_vision_prompts,
    lookup_oui_vendor,
)
from app.clients.meta_models import MetaModelGateway
from app.config import Settings, get_settings
from app.main import app
from app.state import (
    CabinetVisionInspection,
    ConduitArchitecturePlan,
    DiagramSegmentationResult,
    ModalTwinVerificationResult,
    VoiceFieldNoteTranscript,
)


def _parse_sse_frames(raw_sse_text: str) -> list[dict[str, Any]]:
    """Parse standard SSE response stream into `[{id, event, data}, ...]`."""
    normalized = raw_sse_text.replace("\r\n", "\n")
    blocks = [blk.strip() for blk in normalized.split("\n\n") if blk.strip()]
    parsed: list[dict[str, Any]] = []
    for blk in blocks:
        event_name = "message"
        event_id = None
        data_lines: list[str] = []
        for line in blk.split("\n"):
            if line.startswith("event:"):
                event_name = line.split(":", 1)[1].strip()
            elif line.startswith("id:"):
                event_id = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                data_lines.append(line.split(":", 1)[1].strip())
        if data_lines:
            parsed.append(
                {
                    "id": event_id,
                    "event": event_name,
                    "data": json.loads("\n".join(data_lines)),
                }
            )
    return parsed


def test_settings_paths_and_defaults() -> None:
    """Verify Settings resolves all catalog, prompt, PCAP, video, and scenario paths."""
    cfg = get_settings()
    assert isinstance(cfg, Settings)

    assert cfg.meta_api_base_url == "https://api.meta.ai/v1"
    assert cfg.muse_spark_model == "muse-spark-1.3"
    assert cfg.muse_wonder_model == "muse-wonder-1.0"
    assert cfg.sam_3_1_model == "sam-3.1"
    assert cfg.muse_image_model == "muse-image-1.0"
    assert cfg.muse_voice_transcribe_model == "muse-voice-transcribe-1.0"
    assert cfg.muse_code_model == "muse-code"
    assert cfg.baseten_api_base_url == "https://inference.baseten.co/v1"
    assert cfg.baseten_model == "meta-models/muse-spark-open-1026"
    assert cfg.modal_profile == "lopesrohan1988"
    assert cfg.modal_sandbox_timeout == 60
    assert cfg.muse_glimmer_model == "meta-models/Muse-Glimmer-30B"
    assert cfg.demo_cache_fallback is True

    # Resolved paths must exist on disk
    assert cfg.resolved_data_dir.is_dir()
    assert cfg.resolved_hardware_catalog_path.is_file()
    assert cfg.resolved_oui_vendors_path.is_file()
    assert cfg.resolved_iec62443_controls_path.is_file()
    assert cfg.resolved_benchmark_ground_truth_path.is_file()
    assert cfg.real_pcap_manifest_path.is_file()
    assert cfg.sam31_vision_prompts_path.is_file()
    assert cfg.muse_spark_architect_prompt_path.is_file()
    assert cfg.scenarios_dir.is_dir()
    assert cfg.videos_dir.is_dir()


def test_parse_muse_spark_prompt_fewshot_and_sam31_schemas() -> None:
    """Extract the exact few-shot JSON from `muse_spark_architect_prompt.md` and validate strictly."""
    cfg = get_settings()
    md_text = cfg.muse_spark_architect_prompt_path.read_text(encoding="utf-8")

    marker = "**Expected Muse Spark JSON Output:**"
    assert marker in md_text
    after_marker = md_text.split(marker, 1)[1]
    json_match = re.search(r"```json\s*(\{.*?\})\s*```", after_marker, flags=re.DOTALL)
    assert json_match is not None, "Could not locate Few-Shot Example 1 JSON block"

    raw_plan_dict = json.loads(json_match.group(1))
    plan = ConduitArchitecturePlan.model_validate(raw_plan_dict)

    assert plan.executive_summary.facility_name == "Apex Automotive Stamping Plant"
    assert plan.executive_summary.target_security_posture_sl == "SL-4"
    assert (
        plan.conduit_sizing_recommendations[0].recommended_archetype_id
        == "ARCH_C_ENTERPRISE_1U_DIODE"
    )
    assert len(plan.protocol_cutover_matrix) == 5
    assert len(plan.tx_rx_proxy_translation_table) == 4

    # Validate SAM 3.1 Mode 1 & Mode 2 few-shot outputs against Pydantic models
    sam_prompts = load_sam31_vision_prompts()
    diag_example = sam_prompts["mode_1_network_diagram"]["few_shot_example_output"]
    diag_model = DiagramSegmentationResult.model_validate(diag_example)
    assert diag_model.source_image_type == "CAD_VISIO_DIAGRAM"
    assert len(diag_model.detected_diagram_nodes) == 2

    for cab_ex in sam_prompts["mode_2_cabinet_rack_sizer"]["few_shot_examples"]:
        cab_model = CabinetVisionInspection.model_validate(cab_ex["expected_output"])
        assert len(cab_model.detections) >= 1

    # Reference plans exist only for plants whose answer key names a hardware kit
    for card in list_scenarios():
        if not card["primary_recommended_archetype_ids"]:
            continue
        synth_plan = build_scenario_architecture_plan(card["scenario_id"])
        assert isinstance(synth_plan, ConduitArchitecturePlan)
        assert len(synth_plan.conduit_sizing_recommendations) >= 1


def test_catalog_and_oui_helpers() -> None:
    """Verify OUI MAC normalization lookup, 6 scenarios, 15 real PCAPs, and 2 videos."""
    siemens = lookup_oui_vendor("00-1b-1b-9f-10-15")
    assert siemens is not None
    assert siemens["vendor"] == "Siemens AG"

    moxa = lookup_oui_vendor("0090.e899.8877")
    assert moxa is not None
    assert "Moxa" in moxa["vendor"]

    assert len(list_scenarios()) == 3
    assert len(list_real_ics_captures()) == 15
    assert len(list_walkthrough_videos()) == 2


@pytest.mark.asyncio
async def test_gateway_routing_and_secret_redaction() -> None:
    """Verify Cloud vs. Air-Gapped routing and ensure stack status leaks zero secrets."""
    custom_cfg = Settings(
        meta_model_api_key="your_meta_model_api_key_here",
        baseten_api_key="secret_baseten_live_token_do_not_leak",
        demo_cache_fallback=True,
    )
    gw = MetaModelGateway(settings=custom_cfg)

    cloud_res = await gw.route_architect_reasoning(
        [{"role": "user", "content": "size diode"}],
        inference_mode="cloud_meta_api",
    )
    assert cloud_res["model"] == "muse-wonder-1.0"

    airgap_res = await gw.route_architect_reasoning(
        [{"role": "user", "content": "size diode"}],
        inference_mode="air_gapped_open_weights",
    )
    # With a Baseten key and no self-hosted Glimmer endpoint, air-gapped mode uses Muse Spark Open
    assert airgap_res["model"] == "meta-models/muse-spark-open-1026"
    assert airgap_res["provider"] == "baseten_open_weights"

    stack = gw.get_stack_status()
    serialized = json.dumps(stack)
    assert "secret_baseten_live_token_do_not_leak" not in serialized
    assert stack["integrations"]["sam_3_1"]["api_key_configured"] is False
    assert (
        stack["integrations"]["baseten_muse_spark_open_1026"]["api_key_configured"]
        is True
    )


@pytest.mark.asyncio
async def test_fastapi_rest_endpoints_and_static_files() -> None:
    """Verify all Day 1 REST endpoints and static media mounting."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as client:
        # 1. Health
        r_health = await client.get("/api/v1/health")
        assert r_health.status_code == 200
        h_data = r_health.json()
        assert h_data["status"] == "ok"
        assert h_data["catalog_counts"]["archetypes"] == 4
        assert h_data["catalog_counts"]["scenarios"] == 3
        assert h_data["catalog_counts"]["real_ics_captures"] == 15

        # 2. Model stack health (all 7 integrations)
        r_models = await client.get("/api/v1/health/models")
        assert r_models.status_code == 200
        m_data = r_models.json()
        expected_keys = {
            "sam_3_1",
            "muse_spark",
            "muse_wonder",
            "muse_image",
            "muse_voice_transcribe",
            "baseten_muse_spark_open_1026",
            "open_weights_architect",
            "modal_glimmer_and_twin",
        }
        assert set(m_data["integrations"].keys()) == expected_keys
        assert m_data["all_integrations_operational"] is True

        # 3. Archetypes catalog
        r_arch = await client.get("/api/v1/catalogs/archetypes")
        assert r_arch.status_code == 200
        arch_data = r_arch.json()
        assert len(arch_data["archetypes"]) == 4
        assert set(arch_data["protocol_compatibility_rules"].keys()) == {
            "GREEN",
            "AMBER",
            "RED",
        }

        # 4. Scenarios listing
        r_scen = await client.get("/api/v1/scenarios")
        assert r_scen.status_code == 200
        s_data = r_scen.json()
        assert set(s_data.keys()) == {"scenarios", "real_ics_captures", "videos"}
        assert len(s_data["scenarios"]) == 3
        assert len(s_data["real_ics_captures"]) == 15
        assert len(s_data["videos"]) == 2

        # 5. Scenario 1 preview + static image check + 404 check
        r_prev = await client.get(
            "/api/v1/scenarios/scenario_2_substation/preview"
        )
        assert r_prev.status_code == 200
        prev_data = r_prev.json()
        assert prev_data["facility_name"] == "GridCore 220kV North Transmission Substation"
        assert all(prev_data["files_verified_on_disk"].values())

        diag_url = prev_data["media_urls"]["topology_diagram_url"]
        r_static = await client.get(diag_url)
        assert r_static.status_code == 200
        assert len(r_static.content) > 1000

        r_404 = await client.get("/api/v1/scenarios/nonexistent_plant/preview")
        assert r_404.status_code == 404

        # 6. Voice transcribe (query param mode + multipart upload mode)
        r_voice_q = await client.post(
            "/api/v1/voice/transcribe?scenario_id=scenario_4_water_treatment"
        )
        assert r_voice_q.status_code == 200
        vt_q = VoiceFieldNoteTranscript.model_validate(r_voice_q.json())
        assert vt_q.scenario_id == "scenario_4_water_treatment"
        assert "5G" in vt_q.raw_transcript

        r_voice_mp = await client.post(
            "/api/v1/voice/transcribe",
            data={"scenario_id": "scenario_2_substation"},
            files={"file": ("walkdown.wav", b"RIFF\x24\x00\x00\x00WAVEfmt ", "audio/wav")},
        )
        assert r_voice_mp.status_code == 200
        vt_mp = VoiceFieldNoteTranscript.model_validate(r_voice_mp.json())
        assert vt_mp.audio_filename == "walkdown.wav"
        assert len(vt_mp.structured_observations) >= 1


@pytest.mark.asyncio
async def test_sse_assessment_stream_cloud_and_airgapped() -> None:
    """Verify SSE streaming pipeline for Scenario 4 across both inference modes."""
    expected_stages = [
        "sam_3_1_vision",
        "muse_voice_asr",
        "baseten_switch_cli",
        "duckdb_telemetry",
        "muse_spark_reconcile",
        "muse_wonder_or_glimmer_architect",
        "modal_socket_twin",
        "complete",
    ]

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as client:
        # Cloud Meta API mode
        resp_cloud = await client.get(
            "/api/v1/assessments/scenario_4_water_treatment/stream",
            params={"inference_mode": "cloud_meta_api", "step_delay_ms": 0},
        )
        assert resp_cloud.status_code == 200
        assert "text/event-stream" in resp_cloud.headers.get("content-type", "")

        frames_cloud = _parse_sse_frames(resp_cloud.text)
        assert [f["event"] for f in frames_cloud] == expected_stages
        assert frames_cloud[5]["data"]["model"] == "muse-wonder-1.0"

        complete_data = frames_cloud[-1]["data"]
        assert complete_data["inference_mode"] == "cloud_meta_api"
        plan = ConduitArchitecturePlan.model_validate(
            complete_data["architecture_plan"]
        )
        twin = ModalTwinVerificationResult.model_validate(
            complete_data["twin_verification"]
        )
        assert (
            plan.executive_summary.facility_name
            == "AquaPure Municipal Water Treatment Facility"
        )
        assert twin.overall_verdict == "VERIFIED_ZERO_DOWNTIME_LOCKDOWN"
        assert twin.inbound_exploit_block_rate_pct == 100.0

        # Air-gapped open-weights mode via the frontend's alias
        resp_airgap = await client.get(
            "/api/v1/assessments/scenario_4_water_treatment/stream",
            params={"inference_mode": "airgapped_glimmer", "step_delay_ms": 0},
        )
        assert resp_airgap.status_code == 200
        frames_airgap = _parse_sse_frames(resp_airgap.text)
        assert [f["event"] for f in frames_airgap] == expected_stages
        assert [f["data"]["step_index"] for f in frames_airgap[:-1]] == list(range(7))
        # Whichever open-weights endpoint is configured (self-hosted Glimmer, else Muse Spark Open)
        open_model = get_settings().open_weights_model
        assert frames_airgap[5]["data"]["model"] == open_model
        assert frames_airgap[-1]["data"]["architect_model_used"] == open_model
        assert frames_airgap[-1]["data"]["done"] is True
