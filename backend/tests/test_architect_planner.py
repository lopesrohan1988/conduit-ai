"""Muse Wonder propose -> deterministic verify loop and ground-truth-free scoring tests."""

from __future__ import annotations

import json
from typing import Any

import pytest

from app.agents.architect_llm_planner import (
    ArchitectureDecision,
    BomDecision,
    FlowDecision,
    decision_from_plan,
    propose_and_verify_architecture,
    verify_architecture_proposal,
)
from app.agents.architect_sizing_agent import synthesize_custom_architecture_plan
from app.agents.switch_config_agent import SwitchAuditResult
from app.agents.telemetry_duckdb_agent import TelemetryAuditResult
from app.config import get_settings
from app.evaluation import expand_gt_ips, score_scenario
from app.state import CabinetVisionInspection, ProtocolFlowAnalysis


def _flow(fid: str, dst_port: int, direction: str, **kw: Any) -> ProtocolFlowAnalysis:
    return ProtocolFlowAnalysis(
        flow_id=fid,
        src_ip=kw.pop("src_ip", "10.50.1.10" if direction == "IT_TO_OT" else "192.168.10.11"),
        dst_ip=kw.pop("dst_ip", "192.168.10.11" if direction == "IT_TO_OT" else "10.50.1.10"),
        dst_port=dst_port,
        protocol=kw.pop("protocol", f"PORT/{dst_port}"),
        direction=direction,
        **kw,
    )


TELEMETRY = TelemetryAuditResult(
    peak_bandwidth_mbps=40.0,
    flows=[
        _flow("F-SYSLOG", 514, "OT_TO_IT", protocol="Syslog UDP", transport="UDP", preliminary_tier="GREEN"),
        _flow("F-MODBUS-POLL", 502, "IT_TO_OT", protocol="Modbus TCP"),
        _flow("F-RDP", 3389, "IT_TO_OT", protocol="RDP", preliminary_tier="RED"),
    ],
)
DIN_CABINET = CabinetVisionInspection(
    enclosure_type="INDUSTRIAL_DIN_RAIL_CABINET",
    has_19inch_rack=False,
    empty_1u_slots=0,
    din_rail_available_mm=200.0,
    occupied_rj45_ports=4,
    free_rj45_ports=4,
    free_sfp_ports=0,
    requires_aggregation_switch=False,
)

GOOD = {
    "flow_decisions": [
        {"flow_id": "F-SYSLOG", "initiator": "OT_TO_IT", "tier": "GREEN", "action": "DROP_IN_PROXY_MAPPING"},
        {"flow_id": "F-MODBUS-POLL", "initiator": "IT_TO_OT", "tier": "AMBER", "action": "PULL_TO_PUSH_PROXY_REVERSAL"},
        {"flow_id": "F-RDP", "initiator": "IT_TO_OT", "tier": "RED", "action": "SEVER_CRITICAL_VIOLATION_AT_L1"},
    ],
    "bill_of_materials": [{"archetype_id": "ARCH_A_FIELD_DIODE", "quantity": 1, "mounting": "DIN_RAIL"}],
    "target_sl": "SL-4",
    "design_rationale": "Single DIN-rail field diode; RDP severed.",
}


def _decision(raw: dict[str, Any]) -> ArchitectureDecision:
    return ArchitectureDecision(
        bill_of_materials=[BomDecision(b["archetype_id"], b["quantity"], b["mounting"]) for b in raw["bill_of_materials"]],
        flow_decisions={
            f["flow_id"]: FlowDecision(f["flow_id"], f["initiator"], f["tier"], f["action"])
            for f in raw["flow_decisions"]
        },
        target_sl=raw["target_sl"],
        design_rationale=raw["design_rationale"],
    )


def _verify(raw: dict[str, Any]) -> list[str]:
    return verify_architecture_proposal(
        _decision(raw), telemetry_audit=TELEMETRY, cabinet_inspections=[DIN_CABINET], video_walkthrough=None
    )


def _mutate(**changes: Any) -> dict[str, Any]:
    raw = json.loads(json.dumps(GOOD))
    for fid, patch in changes.get("flows", {}).items():
        next(f for f in raw["flow_decisions"] if f["flow_id"] == fid).update(patch)
    if "bom" in changes:
        raw["bill_of_materials"] = changes["bom"]
    return raw


def test_verifier_accepts_a_sound_design() -> None:
    assert _verify(GOOD) == []


@pytest.mark.parametrize(
    ("raw", "expected_tag"),
    [
        (_mutate(flows={"F-RDP": {"tier": "GREEN", "action": "DROP_IN_PROXY_MAPPING"}}), "SAFETY"),
        (_mutate(flows={"F-MODBUS-POLL": {"tier": "GREEN", "action": "DROP_IN_PROXY_MAPPING"}}), "SAFETY"),
        (_mutate(flows={"F-SYSLOG": {"tier": "GREEN", "action": "PULL_TO_PUSH_PROXY_REVERSAL"}}), "CONSISTENCY"),
        (_mutate(bom=[{"archetype_id": "ARCH_C_ENTERPRISE_1U_DIODE", "quantity": 1, "mounting": "1U_19INCH_RACK"}]), "PHYSICAL"),
        (_mutate(bom=[{"archetype_id": "ARCH_A_FIELD_DIODE", "quantity": 1, "mounting": "1U_19INCH_RACK"}]), "CATALOG"),
        (_mutate(bom=[{"archetype_id": "ARCH_Z_MADE_UP", "quantity": 1, "mounting": "DIN_RAIL"}]), "CATALOG"),
        (
            _mutate(
                bom=[
                    {"archetype_id": "ARCH_A_FIELD_DIODE", "quantity": 1, "mounting": "DIN_RAIL"},
                    {"archetype_id": "ARCH_D_BIDIRECTIONAL_GATEWAY", "quantity": 1, "mounting": "1U_19INCH_RACK"},
                ]
            ),
            "POSTURE",
        ),
    ],
)
def test_verifier_rejects_unsafe_or_infeasible_designs(raw: dict[str, Any], expected_tag: str) -> None:
    violations = _verify(raw)
    assert any(v.startswith(expected_tag) for v in violations), violations


def test_verifier_requires_every_flow_and_enough_capacity() -> None:
    raw = json.loads(json.dumps(GOOD))
    raw["flow_decisions"] = raw["flow_decisions"][:2]
    assert any(v.startswith("COVERAGE") for v in _verify(raw))

    heavy = TelemetryAuditResult(peak_bandwidth_mbps=300.0, flows=TELEMETRY.flows)
    violations = verify_architecture_proposal(
        _decision(GOOD), telemetry_audit=heavy, cabinet_inspections=[DIN_CABINET], video_walkthrough=None
    )
    assert any(v.startswith("CAPACITY") for v in violations)


class _ScriptedGateway:
    """Returns pre-baked model responses in order, like a deterministic Muse Wonder."""

    def __init__(self, responses: list[dict[str, Any]]) -> None:
        self.settings = get_settings()
        self._responses = responses
        self.calls: list[list[dict[str, Any]]] = []

    async def route_architect_reasoning(self, messages: list[dict[str, Any]], **_: Any) -> dict[str, Any]:
        self.calls.append(list(messages))
        return self._responses[len(self.calls) - 1]


def _live(content: dict[str, Any]) -> dict[str, Any]:
    return {"content": json.dumps(content), "source_mode": "live", "model": "muse-wonder-1.0"}


async def test_planner_feeds_violations_back_and_accepts_revision() -> None:
    unsafe = _mutate(flows={"F-RDP": {"tier": "GREEN", "action": "DROP_IN_PROXY_MAPPING"}})
    gw = _ScriptedGateway([_live(unsafe), _live(GOOD)])

    decision, trace = await propose_and_verify_architecture(
        facility_name="Test Plant",
        switch_audit=SwitchAuditResult(),
        telemetry_audit=TELEMETRY,
        cabinet_inspections=[DIN_CABINET],
        video_walkthrough=None,
        voice_transcript=None,
        gateway=gw,  # type: ignore[arg-type]
        inference_mode="cloud_meta_api",
    )

    assert decision is not None and trace.accepted
    assert trace.final_source_mode == "live_verified"
    assert len(trace.attempts) == 2 and trace.attempts[0]["violations"]
    # The rejection reasons were sent back to the model
    assert "F-RDP" in gw.calls[1][-1]["content"]

    plan = synthesize_custom_architecture_plan(
        facility_name="Test Plant",
        switch_audit=SwitchAuditResult(),
        telemetry_audit=TELEMETRY,
        cabinet_inspections=[DIN_CABINET],
        video_walkthrough=None,
        voice_transcript=None,
        decision=decision,
    )
    tiers = {r.flow_id: r.cutover_tier for r in plan.protocol_cutover_matrix}
    assert tiers == {"F-SYSLOG": "GREEN", "F-MODBUS-POLL": "AMBER", "F-RDP": "RED"}
    assert [b.item_code for b in plan.bill_of_materials] == ["ARCH_A_FIELD_DIODE"]


async def test_planner_falls_back_when_model_never_complies() -> None:
    unsafe = _mutate(flows={"F-RDP": {"tier": "GREEN", "action": "DROP_IN_PROXY_MAPPING"}})
    gw = _ScriptedGateway([_live(unsafe)] * 3)
    decision, trace = await propose_and_verify_architecture(
        facility_name="Test Plant",
        switch_audit=SwitchAuditResult(),
        telemetry_audit=TELEMETRY,
        cabinet_inspections=[DIN_CABINET],
        video_walkthrough=None,
        voice_transcript=None,
        gateway=gw,  # type: ignore[arg-type]
        inference_mode="cloud_meta_api",
    )
    assert decision is None and not trace.accepted
    assert trace.final_source_mode == "deterministic_fallback_after_rejection"


def test_expand_gt_ips_and_scoring_never_read_plan_from_ground_truth() -> None:
    assert expand_gt_ips("10.0.0.11-13,10.0.0.20") == {"10.0.0.11", "10.0.0.12", "10.0.0.13", "10.0.0.20"}

    plan = synthesize_custom_architecture_plan(
        facility_name="Test Plant",
        switch_audit=SwitchAuditResult(),
        telemetry_audit=TELEMETRY,
        cabinet_inspections=[DIN_CABINET],
        video_walkthrough=None,
        voice_transcript=None,
    )
    sc_gt = {
        "total_discovered_assets": 0,
        "undocumented_shadow_assets": [],
        "telemetry_metrics": {"peak_bandwidth_mbps": 40.0},
        "expected_hardware_bom": {
            "primary_recommendation": [{"archetype_id": "ARCH_B_VIDEO_IOT_DIODE", "quantity": 1}]
        },
        "flow_classifications": [
            {"flow_id": "G1", "protocol": "RDP", "dst_ip": "192.168.10.11", "src_ip": "", "dst_port": 3389, "classification": "CRITICAL_VIOLATION"},
        ],
    }
    s = score_scenario(sc_gt, plan, SwitchAuditResult(), TELEMETRY)
    assert s["peak_ok"] and not s["bom_exact"]
    assert s["flows_tier_correct"] == 1 and s["critical_severed"] == 1


def test_verifier_rejects_bom_that_cannot_proxy_an_observed_protocol() -> None:
    # ARCH_B (video/IoT) cannot locally poll Modbus TCP for the pull-to-push reversal
    raw = _mutate(bom=[{"archetype_id": "ARCH_B_VIDEO_IOT_DIODE", "quantity": 1, "mounting": "DIN_RAIL"}])
    assert any("MODBUS_TCP" in v for v in _verify(raw))


def test_verifier_allows_locally_pulled_rtsp_to_stay_green() -> None:
    tel = TelemetryAuditResult(
        peak_bandwidth_mbps=200.0,
        flows=[_flow("F-RTSP", 554, "IT_TO_OT", protocol="RTSP Video", preliminary_tier="GREEN")],
    )
    raw = {
        "flow_decisions": [
            {"flow_id": "F-RTSP", "initiator": "IT_TO_OT", "tier": "GREEN", "action": "DROP_IN_PROXY_MAPPING"}
        ],
        "bill_of_materials": [{"archetype_id": "ARCH_B_VIDEO_IOT_DIODE", "quantity": 1, "mounting": "DIN_RAIL"}],
        "target_sl": "SL-4",
        "design_rationale": "",
    }
    assert verify_architecture_proposal(
        _decision(raw), telemetry_audit=tel, cabinet_inspections=[DIN_CABINET], video_walkthrough=None
    ) == []


def test_verifier_requires_lateral_movement_to_be_severed() -> None:
    tel = TelemetryAuditResult(
        peak_bandwidth_mbps=10.0,
        flows=[
            _flow(
                "F-PIVOT", 445, "OT_TO_IT", protocol="SMBv1 / CIFS", preliminary_tier="RED",
                lateral_movement_suspected=True,
            )
        ],
    )
    raw = {
        "flow_decisions": [
            {"flow_id": "F-PIVOT", "initiator": "OT_TO_IT", "tier": "RED", "action": "REPLACE_SMB_WITH_SFTP_RELAY"}
        ],
        "bill_of_materials": [{"archetype_id": "ARCH_A_FIELD_DIODE", "quantity": 1, "mounting": "DIN_RAIL"}],
        "target_sl": "SL-4",
        "design_rationale": "",
    }
    violations = verify_architecture_proposal(
        _decision(raw), telemetry_audit=tel, cabinet_inspections=[DIN_CABINET], video_walkthrough=None
    )
    assert any("lateral movement" in v for v in violations), violations


def test_rule_engine_plan_is_held_to_the_same_verifier() -> None:
    tel = TelemetryAuditResult(
        peak_bandwidth_mbps=10.0,
        flows=[
            *TELEMETRY.flows,
            _flow("F-MODEM", 502, "BYPASS_TO_OT", src_ip="192.168.10.254", protocol="Modbus TCP", preliminary_tier="RED"),
        ],
    )
    plan = synthesize_custom_architecture_plan(
        facility_name="Test Plant",
        switch_audit=SwitchAuditResult(),
        telemetry_audit=tel,
        cabinet_inspections=[DIN_CABINET],
        video_walkthrough=None,
        voice_transcript=None,
    )
    decision = decision_from_plan(plan, tel)
    assert decision.flow_decisions["F-MODEM"].initiator == "BYPASS_TO_OT"
    kwargs = {"telemetry_audit": tel, "cabinet_inspections": [DIN_CABINET], "video_walkthrough": None}
    assert verify_architecture_proposal(decision, **kwargs) == []

    # A rule-engine plan that left the bypass in service would be rejected
    row = next(r for r in plan.protocol_cutover_matrix if r.flow_id == "F-MODEM")
    row.cutover_tier, row.cutover_action_type = "AMBER", "PULL_TO_PUSH_PROXY_REVERSAL"
    violations = verify_architecture_proposal(decision_from_plan(plan, tel), **kwargs)
    assert any("bypass" in v for v in violations), violations
