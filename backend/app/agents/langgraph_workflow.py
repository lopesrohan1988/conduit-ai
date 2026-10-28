"""LangGraph Multi-Agent State Machine for ConduitAI Discovery, Sizing & Twin Verification.

Orchestrates the 7-stage `ConduitGraphState` pipeline:
1. `sam_3_1_vision`: Mode 1 Diagram + Mode 2 Rack/DIN Sizer + Mode 3 24fps `.mp4` Tracker
2. `muse_voice_asr`: Field Engineer Audio Walkdown Transcription & Constraint Extraction
3. `baseten_switch_cli`: Multi-Vendor Switch CLI + IEEE OUI + Shadow OT Inventory Audit
4. `duckdb_telemetry`: Scapy 10-Protocol Binary L7 Dissector + DuckDB 24h Firewall SQL
5. `muse_spark_reconcile`: Multimodal 3-Way Visual + Logical + Packet Graph Reconciliation
6. `muse_wonder_or_glimmer_architect`: Deterministic `1.25x` Diode Sizing + Proxy Synthesis
7. `modal_socket_twin`: Layer-1/2 Unidirectional `os.pipe()` + Loopback TCP Socket Twin
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from langgraph.graph import END, START, StateGraph

from app.agents.architect_sizing_agent import run_architect_sizing_agent
from app.agents.switch_config_agent import SwitchAuditResult, run_switch_config_agent
from app.agents.telemetry_duckdb_agent import (
    TelemetryAuditResult,
    run_telemetry_duckdb_agent,
    zone_map_from_assets,
)
from app.agents.vision_sam31_agent import (
    inspect_cabinet_photos,
    inspect_network_diagram,
    track_walkthrough_video,
)
from app.catalog_loader import get_scenario_preview
from app.clients.meta_models import MetaModelGateway, extract_json_object
from app.config import Settings, get_settings
from app.state import ConduitGraphState, InferenceMode
from app.twin.modal_cutover_twin import verify_cutover_in_digital_twin


def build_conduit_langgraph(
    *,
    settings: Settings | None = None,
    gateway: MetaModelGateway | None = None,
    use_live_llm: bool = False,
    use_modal_cloud: bool = False,
):
    """Compile the executable LangGraph `StateGraph(ConduitGraphState)` pipeline."""
    cfg = settings or get_settings()
    gw = gateway or MetaModelGateway(settings=cfg)

    # Shared per-invocation scratchpad for rich dataclass intermediates
    scratch: dict[str, Any] = {}

    async def sam_3_1_vision_node(state: ConduitGraphState) -> dict[str, Any]:
        diag_path = state.get("diagram_image_path")
        cab_paths = state.get("cabinet_image_paths") or []
        vid_path = state.get("video_walkthrough_path")
        scenario_id = state.get("scenario_id")

        diag_seg, diag_mode = await inspect_network_diagram(
            diag_path, gateway=gw, use_live_llm=use_live_llm
        )
        cab_insps, cab_mode = await inspect_cabinet_photos(
            cab_paths, gateway=gw, use_live_llm=use_live_llm
        )
        vid_res = track_walkthrough_video(vid_path, scenario_id=scenario_id)

        primary_cab = cab_insps[0]
        mount_str = (
            primary_cab.compatible_mounting_types[0]
            if primary_cab.compatible_mounting_types
            else "DIN_RAIL"
        )
        headline = (
            f"SAM 3.1 ({cab_mode}) segmented {diag_seg.source_image_type} & verified "
            f"{mount_str} physical enclosure clearance."
        )
        if vid_res and vid_res.rogue_bypass_detected:
            headline += " CRITICAL ALERT: Rogue 5G cellular modem tracked in cabinet!"

        return {
            "diagram_segmentation": diag_seg,
            "cabinet_inspections": cab_insps,
            "video_walkthrough_result": vid_res,
            "agent_events": [
                {
                    "stage": "sam_3_1_vision",
                    "model": cfg.sam_3_1_model,
                    "source_mode": cab_mode if cab_mode == "live_sam31" else diag_mode,
                    "headline": headline,
                }
            ],
        }

    async def muse_voice_asr_node(state: ConduitGraphState) -> dict[str, Any]:
        transcript = await gw.transcribe_muse_voice(
            audio_bytes=state.get("voice_audio_bytes"),
            filename=state.get("voice_audio_filename") or "field_walkdown_note.wav",
            scenario_id=state.get("scenario_id"),
        )
        return {
            "voice_transcript": transcript,
            "agent_events": [
                {
                    "stage": "muse_voice_asr",
                    "model": cfg.muse_voice_transcribe_model,
                    "source_mode": transcript.source_mode,
                    "headline": (
                        f"Muse Voice Transcribe extracted {len(transcript.structured_observations)} "
                        f"field engineering observation(s)."
                        if transcript.source_mode.startswith("live")
                        else f"Sample field-note transcript loaded ({len(transcript.structured_observations)} "
                        f"observation(s)); upload or record audio to transcribe live."
                    ),
                }
            ],
        }

    async def baseten_switch_cli_node(state: ConduitGraphState) -> dict[str, Any]:
        # Run live Baseten LLM enrichment when BASETEN_API_KEY is configured
        sw_audit = await run_switch_config_agent(
            state.get("switch_dump_path"),
            state.get("asset_inventory_csv_path"),
            gateway=gw,
            use_live_llm=(use_live_llm and cfg.baseten_api_configured),
        )
        scratch["switch_audit"] = sw_audit
        active_model = sw_audit.llm_model_used or "deterministic CLI parser"
        return {
            "discovered_assets": sw_audit.assets,
            "agent_events": [
                {
                    "stage": "baseten_switch_cli",
                    "model": active_model,
                    "source_mode": sw_audit.llm_source_mode,
                    "headline": (
                        f"Switch CLI parser (`{active_model}`) reconciled {sw_audit.total_discovered_assets} "
                        f"ARP/MAC/802.1Q endpoints on `{sw_audit.switch_hostname}` "
                        f"({len(sw_audit.shadow_anomalies)} shadow/bypass flagged)."
                    ),
                }
            ],
        }

    async def duckdb_telemetry_node(state: ConduitGraphState) -> dict[str, Any]:
        sw_audit: SwitchAuditResult | None = scratch.get("switch_audit")
        tel_audit = run_telemetry_duckdb_agent(
            state.get("pcap_path"),
            state.get("firewall_csv_path"),
            vlans_observed=sw_audit.vlans_observed if sw_audit else None,
            zone_map=zone_map_from_assets(sw_audit.assets) if sw_audit else None,
        )
        scratch["telemetry_audit"] = tel_audit
        return {
            "protocol_flows": tel_audit.flows,
            "traffic_conduits": tel_audit.conduits,
            "agent_events": [
                {
                    "stage": "duckdb_telemetry",
                    "model": "scapy-2.8 + duckdb-sql",
                    "source_mode": "live_packet_sql",
                    "headline": (
                        f"Dissected {tel_audit.pcap_packet_count:,} binary PCAP packets & "
                        f"{tel_audit.firewall_row_count:,} {tel_audit.firewall_vendor} rows — "
                        f"Peak {tel_audit.peak_bandwidth_mbps} Mbps "
                        f"({tel_audit.sized_bandwidth_with_1_25x_headroom_mbps} Mbps w/ 1.25x headroom)."
                    ),
                }
            ],
        }

    async def muse_spark_reconcile_node(state: ConduitGraphState) -> dict[str, Any]:
        sw_audit: SwitchAuditResult = scratch.get("switch_audit") or SwitchAuditResult()
        tel_audit: TelemetryAuditResult = (
            scratch.get("telemetry_audit") or TelemetryAuditResult()
        )
        reconcile_mode = "deterministic_graph_reconciler"
        reconcile_note = ""

        if use_live_llm and cfg.meta_api_configured:
            spark_res = await gw.chat_muse_spark(
                [
                    {
                        "role": "user",
                        "content": (
                            f"Reconcile OT facility `{state.get('facility_name', 'OT Plant')}`: "
                            f"{sw_audit.total_discovered_assets} ARP endpoints, "
                            f"{len(sw_audit.shadow_anomalies)} shadow anomalies, "
                            f"{tel_audit.flow_tier_counts} protocol tiers. "
                            'Return strict JSON: {"reconciliation_alert": "short 1-line summary"}'
                        ),
                    }
                ],
                max_tokens=2048,
            )
            if spark_res.get("source_mode") == "live":
                reconcile_mode = "live"
                parsed = extract_json_object(spark_res.get("content", ""))
                if parsed and parsed.get("reconciliation_alert"):
                    reconcile_note = f" — {parsed['reconciliation_alert']}"

        return {
            "agent_events": [
                {
                    "stage": "muse_spark_reconcile",
                    "model": cfg.muse_spark_model,
                    "source_mode": reconcile_mode,
                    "headline": (
                        f"Muse Spark reconciled diagram vs. switch/PCAP ground truth — "
                        f"flagged {len(sw_audit.shadow_anomalies)} undocumented Shadow OT / Bypass anomaly(ies)"
                        f"{reconcile_note}"
                    ),
                }
            ]
        }

    async def architect_sizing_node(state: ConduitGraphState) -> dict[str, Any]:
        sw_audit: SwitchAuditResult = scratch.get("switch_audit") or SwitchAuditResult()
        tel_audit: TelemetryAuditResult = (
            scratch.get("telemetry_audit") or TelemetryAuditResult()
        )
        mode: InferenceMode = state.get("inference_mode") or "cloud_meta_api"

        plan, arch_meta = await run_architect_sizing_agent(
            scenario_id=state.get("scenario_id"),
            facility_name=state.get("facility_name") or "Industrial OT Facility",
            inference_mode=mode,
            switch_audit=sw_audit,
            telemetry_audit=tel_audit,
            cabinet_inspections=state.get("cabinet_inspections") or [],
            video_walkthrough=state.get("video_walkthrough_result"),
            voice_transcript=state.get("voice_transcript"),
            gateway=gw,
            use_live_llm=use_live_llm,
        )
        scratch["architect_meta"] = arch_meta
        trace = arch_meta.get("planner_trace") or {}
        rejected = sum(1 for a in trace.get("attempts", []) if a.get("violations"))
        if arch_meta["source_mode"] == "live_verified":
            author = (
                f"{arch_meta['architect_model']} proposed & verifier accepted (attempt "
                f"{trace.get('attempt_count')}, {rejected} rejected revision(s))"
            )
        elif arch_meta["source_mode"] == "deterministic_fallback_after_rejection":
            author = (
                f"Verifier rejected all {trace.get('attempt_count')} {arch_meta['architect_model']} "
                "proposals — deterministic rule engine"
            )
        else:
            author = "Deterministic rule engine"
        bom_str = " + ".join(f"{b.quantity}x {b.item_code}" for b in plan.bill_of_materials)
        return {
            "architecture_plan": plan,
            "agent_events": [
                {
                    "stage": "muse_wonder_or_glimmer_architect",
                    "model": arch_meta["architect_model"],
                    "source_mode": arch_meta["source_mode"],
                    "headline": (
                        f"{author}: {plan.executive_summary.target_security_posture_sl} cutover with "
                        f"{bom_str} (${plan.executive_summary.estimated_hardware_bom_usd:,.0f} BoM) & "
                        f"{len(plan.tx_rx_proxy_translation_table)} TX/RX proxy rules."
                    ),
                }
            ],
        }

    async def modal_socket_twin_node(state: ConduitGraphState) -> dict[str, Any]:
        plan = state["architecture_plan"]
        assert plan is not None
        twin = verify_cutover_in_digital_twin(
            plan,
            scenario_id=state.get("scenario_id") or "custom",
            use_modal_cloud=use_modal_cloud,
        )
        return {
            "twin_verification": twin,
            "agent_events": [
                {
                    "stage": "modal_socket_twin",
                    "model": "modal-layer1-socket-twin",
                    "source_mode": twin.execution_backend,
                    "headline": (
                        f"Digital Twin ({twin.execution_backend}) verified {twin.telemetry_continuity_pct:.0f}% "
                        f"legitimate telemetry continuity & {twin.inbound_exploit_block_rate_pct:.0f}% "
                        f"physical exploit block rate ({twin.overall_verdict})."
                    ),
                }
            ],
        }

    workflow = StateGraph(ConduitGraphState)
    workflow.add_node("sam_3_1_vision", sam_3_1_vision_node)
    workflow.add_node("muse_voice_asr", muse_voice_asr_node)
    workflow.add_node("baseten_switch_cli", baseten_switch_cli_node)
    workflow.add_node("duckdb_telemetry", duckdb_telemetry_node)
    workflow.add_node("muse_spark_reconcile", muse_spark_reconcile_node)
    workflow.add_node("muse_wonder_or_glimmer_architect", architect_sizing_node)
    workflow.add_node("modal_socket_twin", modal_socket_twin_node)

    # Sequential deterministic topological order matching SSE timeline indices 0..6
    workflow.add_edge(START, "sam_3_1_vision")
    workflow.add_edge("sam_3_1_vision", "muse_voice_asr")
    workflow.add_edge("muse_voice_asr", "baseten_switch_cli")
    workflow.add_edge("baseten_switch_cli", "duckdb_telemetry")
    workflow.add_edge("duckdb_telemetry", "muse_spark_reconcile")
    workflow.add_edge("muse_spark_reconcile", "muse_wonder_or_glimmer_architect")
    workflow.add_edge("muse_wonder_or_glimmer_architect", "modal_socket_twin")
    workflow.add_edge("modal_socket_twin", END)

    return workflow.compile(), scratch


def build_scenario_initial_state(
    scenario_id: str,
    *,
    inference_mode: InferenceMode = "cloud_meta_api",
    settings: Settings | None = None,
) -> ConduitGraphState:
    """Resolve on-disk artifact paths for any of the 6 benchmark scenarios into `ConduitGraphState`."""
    cfg = settings or get_settings()
    preview = get_scenario_preview(scenario_id)
    if preview is None:
        raise KeyError(f"Scenario '{scenario_id}' not found.")

    from app.catalog_loader import _SCENARIO_VIDEO_MAP, load_benchmark_ground_truth

    sc = load_benchmark_ground_truth()["scenarios"][scenario_id]
    files = sc["files"]
    data_dir = cfg.resolved_data_dir
    vid_file = _SCENARIO_VIDEO_MAP.get(scenario_id, "rack_1u_slot_walkthrough.mp4")

    return {
        "scenario_id": scenario_id,
        "facility_name": sc["facility_name"],
        "inference_mode": inference_mode,
        "diagram_image_path": str((data_dir / files["topology_diagram"]).resolve()),
        "cabinet_image_paths": [
            str((data_dir / rel).resolve()) for rel in files.get("site_photos", [])
        ],
        "video_walkthrough_path": str((cfg.videos_dir / vid_file).resolve()),
        "pcap_path": str((data_dir / files["pcap"]).resolve()),
        "firewall_csv_path": str((data_dir / files["firewall_csv"]).resolve()),
        "switch_dump_path": str((data_dir / files["switch_dump"]).resolve()),
        "asset_inventory_csv_path": str(
            (data_dir / files["asset_inventory_csv"]).resolve()
        ),
        "agent_events": [],
        "errors": [],
    }
