"""Public captures run as never-seen sites, and the architect's checker shown and challenged."""

from __future__ import annotations

import asyncio

from app.agents.architect_llm_planner import challenge_verifier, verifier_checklist
from app.agents.langgraph_workflow import build_conduit_langgraph, build_scenario_initial_state
from app.agents.switch_config_agent import discover_assets_from_pcap
from app.agents.telemetry_duckdb_agent import TelemetryAuditResult, capture_roles, zone_map_from_assets
from app.catalog_loader import get_scenario_preview, list_capture_sites
from app.clients.meta_models import MetaModelGateway
from app.config import get_settings

CAPTURES = get_settings().resolved_data_dir / "real_ics_captures"


def _run(scenario_id: str) -> tuple[dict, dict]:
    graph, scratch = build_conduit_langgraph(settings=get_settings(), gateway=MetaModelGateway(), use_live_llm=False)
    state = asyncio.run(graph.ainvoke(build_scenario_initial_state(scenario_id)))
    return state, scratch


def test_masters_and_devices_are_read_from_the_industrial_sessions() -> None:
    roles = capture_roles(CAPTURES / "modbus_schneider_modicon_plc.pcap")
    assert roles == {"192.168.63.100": "master", "192.168.63.253": "device"}
    # Without an asset list nothing can be called undocumented, and the master is the far side
    sw = discover_assets_from_pcap(CAPTURES / "modbus_schneider_modicon_plc.pcap")
    assert sw.shadow_anomalies == []
    zones = zone_map_from_assets(sw.assets)
    assert (zones["192.168.63.100"], zones["192.168.63.253"]) == ("IT", "OT")


def test_routed_hosts_sharing_a_router_mac_are_not_called_bypasses() -> None:
    sw = discover_assets_from_pcap(CAPTURES / "bacnet_ip_building_controllers_cisa.pcap")
    assert not any(a.is_dual_homed_bypass for a in sw.assets)


def test_every_capture_site_runs_from_the_packets_alone() -> None:
    sites = list_capture_sites()
    assert len(sites) == 6
    for site in sites:
        preview = get_scenario_preview(site["scenario_id"])
        assert preview and preview["capture_site"]["filename"] == site["filename"]
        state, scratch = _run(site["scenario_id"])
        assert state["architecture_plan"].protocol_cutover_matrix, site["filename"]
        # The rule-engine plan passes the same verifier a model proposal must pass
        assert scratch["architect_meta"]["planner_trace"]["fallback_check"]["violations"] == []


def test_a_command_session_from_an_unlisted_master_is_cut() -> None:
    state, _ = _run("capture__iec104_rtu_breaker_commands_iti")
    rows = state["architecture_plan"].protocol_cutover_matrix
    assert [(r.observed_initiator, r.cutover_action_type) for r in rows] == [
        ("IT_TO_OT", "SEVER_CRITICAL_VIOLATION_AT_L1")
    ]


def test_checklist_files_every_violation_under_a_rule() -> None:
    violations = [
        "COVERAGE: no decision for flows FLOW-02.",
        "SAFETY: FLOW-01 carries inbound write operations (FC 05); only ... is safe.",
        "SAFETY: FLOW-03 is inbound (IT_TO_OT); a one-way diode drops inbound sessions, so it cannot be GREEN.",
        "CAPACITY: BoM sustains 10 Mbps but peak x 1.25 headroom needs 20 Mbps.",
        "SOMETHING NEW",
    ]
    checks = verifier_checklist(
        telemetry_audit=TelemetryAuditResult(), cabinet_inspections=[], video_walkthrough=None, violations=violations
    )
    filed = [v for c in checks for v in c["violations"]]
    assert sorted(filed) == sorted(violations)
    assert checks[-1]["rule"] == "Other hard rules"


def test_the_checker_rejects_a_reopened_command_path() -> None:
    state, scratch = _run("capture__modbus_schneider_modicon_plc")
    result = challenge_verifier(
        state["architecture_plan"],
        telemetry_audit=scratch["telemetry_audit"],
        cabinet_inspections=[],
        video_walkthrough=None,
    )
    assert result is not None and result["connection"].startswith("192.168.63.100 -> 192.168.63.253:502")
    assert any("write operations" in v for v in result["violations"])
    assert any("cannot be GREEN" in v for v in result["violations"])
    failed = {c["rule"] for c in result["checks"] if c["violations"]}
    assert {"Commands into the plant are cut", "Nothing inbound is left working as-is"} <= failed
