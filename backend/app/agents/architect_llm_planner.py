"""Muse Wonder / Muse Glimmer Architecture Planner with a Deterministic Engineering Verifier.

The frontier model *proposes* the cutover design (per-flow Green/Amber/Red tier and action,
hardware BoM, mounting, target SL) from a compact evidence pack. A rule-based verifier then
checks every proposal against hard OT safety, capacity, physical-fit, and catalog
constraints. Violations are fed back to the model for revision; a proposal is accepted only
when the verifier returns zero violations. The verifier never knows the benchmark answers —
it only encodes general engineering invariants.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any

from app.agents.switch_config_agent import SwitchAuditResult
from app.agents.telemetry_duckdb_agent import TelemetryAuditResult
from app.catalog_loader import load_hardware_catalog
from app.clients.meta_models import MetaModelGateway, extract_json_object
from app.state import (
    CabinetVisionInspection,
    InferenceMode,
    VideoWalkthroughResult,
    VoiceFieldNoteTranscript,
)

VALID_TIERS = {"GREEN", "AMBER", "RED"}
VALID_INITIATORS = {"OT_TO_IT", "IT_TO_OT", "BYPASS_TO_OT"}
VALID_TARGET_SL = {"SL-3", "SL-4"}

ACTIONS_BY_TIER: dict[str, set[str]] = {
    "GREEN": {"DROP_IN_PROXY_MAPPING"},
    "AMBER": {"PULL_TO_PUSH_PROXY_REVERSAL", "ROUTE_VIA_ARCH_D_OT_LOCKED_GATEWAY"},
    "RED": {
        "DEPLOY_OPC_UA_WRAPPER_THEN_PROXY",
        "REPLACE_SMB_WITH_SFTP_RELAY",
        "SEVER_CRITICAL_VIOLATION_AT_L1",
    },
}
ALL_ACTIONS = set().union(*ACTIONS_BY_TIER.values())

# Interactive remote-administration protocols never cross an OT boundary diode
REMOTE_ADMIN_PORTS = {23, 3389, 5900}
# Ports whose OT-originated sessions are legitimate one-way pushes (mirrors telemetry agent)
OT_PUSH_PORTS = {514, 554, 1883, 4840, 8443, 443, 47808, 22, 2404}
# Well-known service port -> catalog protocol id the diode TX/RX proxy must implement
PORT_TO_CATALOG_PROTOCOL = {
    502: "MODBUS_TCP",
    2404: "IEC_104",
    20000: "DNP3",
    4840: "OPC_UA",
    1433: "SQL_REPLICATION_PUSH",
    1521: "SQL_REPLICATION_PUSH",
    3306: "SQL_REPLICATION_PUSH",
    5432: "SQL_REPLICATION_PUSH",
    514: "SYSLOG_UDP",
    1514: "SYSLOG_UDP",
    554: "RTSP",
    8554: "RTSP",
    1883: "MQTT",
    8883: "MQTT",
    22: "SFTP",
    443: "HTTPS_PUSH",
    8443: "HTTPS_PUSH",
    47808: "BACNET_TELEMETRY",
    25: "SMTP",
    587: "SMTP",
}
CARRIED_ACTIONS = {"DROP_IN_PROXY_MAPPING", "PULL_TO_PUSH_PROXY_REVERSAL"}
SEVER = "SEVER_CRITICAL_VIOLATION_AT_L1"
ARCH_D = "ARCH_D_BIDIRECTIONAL_GATEWAY"
RACK_MOUNTS = {"1U_19INCH_RACK", "1U_HALF_RACK"}

MAX_ATTEMPTS = 3
PLANNER_TIMEOUT_SEC = 180.0
# Reasoning tokens count against the budget; 8k is exhausted before any answer is written
PLANNER_MAX_TOKENS = 32000


@dataclass
class BomDecision:
    archetype_id: str
    quantity: int
    mounting: str
    purpose: str = ""


@dataclass
class FlowDecision:
    flow_id: str
    initiator: str
    tier: str
    action: str
    rationale: str = ""


@dataclass
class ArchitectureDecision:
    """A verifier-accepted design proposal from the frontier model."""

    bill_of_materials: list[BomDecision]
    flow_decisions: dict[str, FlowDecision]
    target_sl: str
    design_rationale: str


@dataclass
class PlannerTrace:
    """Auditable record of every propose -> verify -> revise round."""

    model: str
    inference_mode: str
    attempts: list[dict[str, Any]] = field(default_factory=list)
    accepted: bool = False
    final_source_mode: str = "deterministic_rule_engine"
    total_latency_ms: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "model": self.model,
            "inference_mode": self.inference_mode,
            "accepted": self.accepted,
            "final_source_mode": self.final_source_mode,
            "attempt_count": len(self.attempts),
            "total_latency_ms": self.total_latency_ms,
            "attempts": self.attempts,
        }


# ---------------------------------------------------------------------------
# Evidence pack
# ---------------------------------------------------------------------------


def build_evidence_pack(
    *,
    facility_name: str,
    switch_audit: SwitchAuditResult,
    telemetry_audit: TelemetryAuditResult,
    cabinet_inspections: list[CabinetVisionInspection],
    video_walkthrough: VideoWalkthroughResult | None,
    voice_transcript: VoiceFieldNoteTranscript | None,
) -> dict[str, Any]:
    """Condense every agent's measured output into the facts the architect may reason over."""
    flows = [
        {
            "flow_id": f.flow_id,
            "src_ip": f.src_ip,
            "dst_ip": f.dst_ip,
            "dst_port": f.dst_port,
            "transport": f.transport,
            "protocol": f.protocol,
            "observed_direction": f.direction,
            "function_detail": f.function_detail,
            "has_write_operations": f.has_write_operations,
            "uses_dynamic_ephemeral_ports": f.uses_dynamic_ephemeral_ports,
            "lateral_movement_suspected": f.lateral_movement_suspected,
            "peak_mbps": f.peak_mbps,
            "rule_engine_hint_tier": f.preliminary_tier,
        }
        for f in telemetry_audit.flows
    ]
    peak = telemetry_audit.peak_bandwidth_mbps or 25.0
    physical = {
        "cabinets": [
            {
                "enclosure_type": c.enclosure_type,
                "has_19inch_rack": c.has_19inch_rack,
                "empty_1u_slots": c.empty_1u_slots,
                "din_rail_available_mm": c.din_rail_available_mm,
            }
            for c in cabinet_inspections
        ],
        "video_walkthrough": (
            {
                "enclosure_type": video_walkthrough.enclosure_type,
                "verified_empty_1u_slots": video_walkthrough.verified_empty_1u_slots,
                "verified_din_rail_mm": video_walkthrough.verified_din_rail_mm,
                "rogue_bypass_detected": video_walkthrough.rogue_bypass_detected,
            }
            if video_walkthrough
            else None
        ),
    }
    voice = (
        {
            "transcript": voice_transcript.raw_transcript,
            "observations": [
                {"category": o.category, "entity": o.extracted_entity, "impact": o.engineering_impact}
                for o in voice_transcript.structured_observations
            ],
        }
        if voice_transcript
        else None
    )
    return {
        "facility_name": facility_name,
        "peak_bandwidth_mbps": peak,
        "sized_bandwidth_with_1_25x_headroom_mbps": round(peak * 1.25, 2),
        "vlans_observed": switch_audit.vlans_observed,
        "discovered_assets": switch_audit.total_discovered_assets,
        "shadow_anomalies": [
            {"type": a.anomaly_type, "ips": a.ip_addresses} for a in switch_audit.shadow_anomalies
        ],
        "flows": flows,
        "physical_constraints": physical,
        "field_voice_note": voice,
    }


def _catalog_brief(catalog: dict[str, Any]) -> list[dict[str, Any]]:
    brief = []
    for a in catalog.get("archetypes", []):
        limits = a.get("capacity_limits", {})
        brief.append(
            {
                "archetype_id": a["archetype_id"],
                "name": a.get("name"),
                "directionality": a.get("directionality"),
                "recommended_sustained_mbps": a.get("recommended_sustained_mbps"),
                "reverse_throughput_mbps": a.get("reverse_throughput_mbps", 0),
                "mounting_options": a.get("mounting_options", []),
                "din_rail_width_mm": a.get("physical_requirements", {}).get("din_rail_width_mm"),
                "max_vlans": limits.get("max_vlans"),
                "supports_8021q_vlan_trunk": limits.get("supports_8021q_vlan_trunk"),
                "max_rtsp_streams_1080p": limits.get("max_rtsp_streams_1080p"),
                "supported_protocols": a.get("supported_protocols", []),
                "unit_cost_usd": a.get("estimated_bom_unit_cost_usd"),
            }
        )
    return brief


def _build_prompt(evidence: dict[str, Any], catalog: dict[str, Any]) -> str:
    heuristics = catalog.get("sizing_heuristics", {}).get("selection_priority_order", [])
    return (
        "You are a principal OT security architect designing a hardware data-diode cutover.\n"
        "Decide, for EVERY flow, who really initiates it (the observed_direction is a subnet "
        "heuristic and may be wrong — e.g. a DNP3 master polling an outstation on port 20000 is "
        "IT_TO_OT), its tier and its action. Then choose the hardware BoM.\n\n"
        "Tier/action rules:\n"
        "- GREEN + DROP_IN_PROXY_MAPPING: OT-initiated one-way push (syslog, MQTT publish, OPC-UA "
        "push, SFTP push, RTSP pulled locally by the diode TX).\n"
        "- AMBER + PULL_TO_PUSH_PROXY_REVERSAL: inbound IT read polling the diode TX can perform "
        "locally and push one-way. AMBER + ROUTE_VIA_ARCH_D_OT_LOCKED_GATEWAY only for verified "
        "closed-loop writes (e.g. signed MES recipes) and only if ARCH_D is in the BoM.\n"
        "- RED + DEPLOY_OPC_UA_WRAPPER_THEN_PROXY: OPC-DA/DCOM or dynamic ports. RED + "
        "REPLACE_SMB_WITH_SFTP_RELAY: SMB file shares. RED + SEVER_CRITICAL_VIOLATION_AT_L1: "
        "unauthorized writes, remote admin (RDP/SSH/Telnet/VNC inbound), rogue bypass paths.\n\n"
        f"Hardware selection priorities: {json.dumps(heuristics)}\n"
        "You may combine several archetypes when different conduits or cabinets need different "
        "hardware. Mounting must exist in the inspected cabinets.\n\n"
        f"HARDWARE CATALOG:\n{json.dumps(_catalog_brief(catalog))}\n\n"
        f"SITE EVIDENCE:\n{json.dumps(evidence)}\n\n"
        "Return ONLY strict JSON:\n"
        '{"flow_decisions": [{"flow_id": str, "initiator": "OT_TO_IT|IT_TO_OT|BYPASS_TO_OT", '
        '"tier": "GREEN|AMBER|RED", "action": str, "rationale": "<= 15 words"}], '
        '"bill_of_materials": [{"archetype_id": str, "quantity": int, "mounting": str, '
        '"purpose": "which conduit/flows it carries"}], "target_sl": "SL-3|SL-4", '
        '"design_rationale": "2-3 sentences"}'
    )


# ---------------------------------------------------------------------------
# Deterministic verifier
# ---------------------------------------------------------------------------


def _parse_proposal(raw: dict[str, Any]) -> tuple[ArchitectureDecision | None, list[str]]:
    errors: list[str] = []
    flows_raw = raw.get("flow_decisions")
    bom_raw = raw.get("bill_of_materials")
    if not isinstance(flows_raw, list):
        errors.append("SCHEMA: `flow_decisions` must be a list.")
        flows_raw = []
    if not isinstance(bom_raw, list) or not bom_raw:
        errors.append("SCHEMA: `bill_of_materials` must be a non-empty list.")
        bom_raw = []

    flow_decisions: dict[str, FlowDecision] = {}
    for item in flows_raw:
        if not isinstance(item, dict) or "flow_id" not in item:
            errors.append("SCHEMA: every flow decision needs a `flow_id`.")
            continue
        fid = str(item["flow_id"])
        if fid in flow_decisions:
            errors.append(f"SCHEMA: flow {fid} decided more than once.")
            continue
        flow_decisions[fid] = FlowDecision(
            flow_id=fid,
            initiator=str(item.get("initiator", "")).upper(),
            tier=str(item.get("tier", "")).upper(),
            action=str(item.get("action", "")).upper(),
            rationale=str(item.get("rationale", ""))[:200],
        )

    bom: list[BomDecision] = []
    for item in bom_raw:
        if not isinstance(item, dict):
            errors.append("SCHEMA: BoM entries must be objects.")
            continue
        try:
            qty = int(item.get("quantity", 0))
        except (TypeError, ValueError):
            qty = 0
        bom.append(
            BomDecision(
                archetype_id=str(item.get("archetype_id", "")),
                quantity=qty,
                mounting=str(item.get("mounting", "")).upper(),
                purpose=str(item.get("purpose", ""))[:300],
            )
        )

    target_sl = str(raw.get("target_sl", "SL-4")).upper()
    decision = ArchitectureDecision(
        bill_of_materials=bom,
        flow_decisions=flow_decisions,
        target_sl=target_sl,
        design_rationale=str(raw.get("design_rationale", ""))[:1200],
    )
    return decision, errors


def verify_architecture_proposal(
    decision: ArchitectureDecision,
    *,
    telemetry_audit: TelemetryAuditResult,
    cabinet_inspections: list[CabinetVisionInspection],
    video_walkthrough: VideoWalkthroughResult | None,
    catalog: dict[str, Any] | None = None,
) -> list[str]:
    """Return every hard-constraint violation in a proposal (empty list == accepted)."""
    cat = catalog or load_hardware_catalog()
    arch_by_id = {a["archetype_id"]: a for a in cat.get("archetypes", [])}
    violations: list[str] = []
    # Services the diode TX pulls locally inside OT (e.g. RTSP) stay GREEN even though the
    # observed session is IT-initiated: the IT session terminates on the RX replica.
    local_pull_ports = {
        port
        for p in cat.get("protocol_compatibility_rules", {}).get("GREEN", {}).get("protocols", [])
        if p.get("expected_initiator") == "OT_LOCAL_PROXY_PULL"
        for port in p.get("default_ports", [])
    }

    if decision.target_sl not in VALID_TARGET_SL:
        violations.append(f"SCHEMA: target_sl `{decision.target_sl}` must be SL-3 or SL-4.")

    # 1. Coverage — every observed flow decided exactly once
    observed = {f.flow_id: f for f in telemetry_audit.flows}
    missing = sorted(set(observed) - set(decision.flow_decisions))
    unknown = sorted(set(decision.flow_decisions) - set(observed))
    if missing:
        violations.append(f"COVERAGE: no decision for flows {', '.join(missing)}.")
    if unknown:
        violations.append(f"COVERAGE: unknown flow ids {', '.join(unknown)}.")

    bom_ids = {b.archetype_id for b in decision.bill_of_materials}

    # 2. Per-flow schema, tier/action consistency, and OT safety invariants
    for fid, d in decision.flow_decisions.items():
        fl = observed.get(fid)
        if fl is None:
            continue
        if d.tier not in VALID_TIERS:
            violations.append(f"SCHEMA: {fid} tier `{d.tier}` invalid.")
            continue
        if d.action not in ALL_ACTIONS:
            violations.append(f"SCHEMA: {fid} action `{d.action}` invalid.")
            continue
        if d.initiator not in VALID_INITIATORS:
            violations.append(f"SCHEMA: {fid} initiator `{d.initiator}` invalid.")
            continue
        if d.action not in ACTIONS_BY_TIER[d.tier]:
            violations.append(
                f"CONSISTENCY: {fid} action {d.action} is not a {d.tier} action "
                f"(allowed: {sorted(ACTIONS_BY_TIER[d.tier])})."
            )

        observed_dir = fl.direction
        # The model may tighten the observed direction freely, but may only loosen an inbound
        # session to OT-initiated when the port is a recognised one-way push service.
        if observed_dir == "BYPASS_TO_OT" and d.initiator != "BYPASS_TO_OT":
            violations.append(f"SAFETY: {fid} was observed on a rogue bypass path; initiator must stay BYPASS_TO_OT.")
        if (
            observed_dir == "IT_TO_OT"
            and d.initiator == "OT_TO_IT"
            and fl.dst_port not in OT_PUSH_PORTS
        ):
            violations.append(
                f"SAFETY: {fid} observed IT_TO_OT on port {fl.dst_port}; reclassifying it as "
                "OT-initiated needs a recognised push service port."
            )

        inbound = d.initiator in {"IT_TO_OT", "BYPASS_TO_OT"}
        if d.initiator == "BYPASS_TO_OT" and d.action != SEVER:
            violations.append(f"SAFETY: {fid} rides a rogue bypass path and must be {SEVER}.")
        if fl.dst_port in REMOTE_ADMIN_PORTS and d.action != SEVER:
            violations.append(
                f"SAFETY: {fid} is interactive remote admin (port {fl.dst_port}) and must be {SEVER}."
            )
        if fl.dst_port == 22 and inbound and d.action != SEVER:
            violations.append(f"SAFETY: {fid} is inbound SSH into OT and must be {SEVER}.")
        if fl.lateral_movement_suspected and d.action != SEVER:
            violations.append(
                f"SAFETY: {fid} source {fl.src_ip} is scanning many hosts across many service ports "
                f"(lateral movement); it must be {SEVER}, not proxied or relayed."
            )
        if inbound and d.tier == "GREEN" and not (
            d.initiator == "IT_TO_OT" and fl.dst_port in local_pull_ports
        ):
            violations.append(
                f"SAFETY: {fid} is inbound ({d.initiator}); a one-way diode drops inbound sessions, so it cannot be GREEN."
            )
        if fl.has_write_operations and inbound and d.action not in {SEVER, "ROUTE_VIA_ARCH_D_OT_LOCKED_GATEWAY"}:
            violations.append(
                f"SAFETY: {fid} carries inbound write operations ({fl.function_detail}); only {SEVER} "
                "or an OT-locked ARCH_D route is safe."
            )
        if inbound and (fl.dst_port == 135 or fl.uses_dynamic_ephemeral_ports) and d.action not in {
            "DEPLOY_OPC_UA_WRAPPER_THEN_PROXY",
            SEVER,
        }:
            violations.append(f"PROTOCOL: {fid} uses DCOM/dynamic ports and needs an OPC-UA wrapper or severing.")
        if inbound and fl.dst_port in {139, 445} and d.action not in {"REPLACE_SMB_WITH_SFTP_RELAY", SEVER}:
            violations.append(f"PROTOCOL: {fid} is SMB and needs an SFTP relay or severing.")
        if d.action == "ROUTE_VIA_ARCH_D_OT_LOCKED_GATEWAY" and ARCH_D not in bom_ids:
            violations.append(f"CONSISTENCY: {fid} is routed via ARCH_D but ARCH_D is not in the BoM.")

    # 3. BoM catalog, mounting, capacity, and physical fit
    if not decision.bill_of_materials:
        return violations
    for b in decision.bill_of_materials:
        arch = arch_by_id.get(b.archetype_id)
        if arch is None:
            violations.append(f"CATALOG: unknown archetype `{b.archetype_id}`.")
            continue
        if not 1 <= b.quantity <= 8:
            violations.append(f"CATALOG: {b.archetype_id} quantity {b.quantity} outside 1..8.")
        if b.mounting not in arch.get("mounting_options", []):
            violations.append(
                f"CATALOG: {b.archetype_id} cannot mount as {b.mounting} (options: {arch.get('mounting_options')})."
            )
    if any(b.archetype_id not in arch_by_id for b in decision.bill_of_materials):
        return violations

    sized = round((telemetry_audit.peak_bandwidth_mbps or 25.0) * 1.25, 2)
    capacity = sum(
        float(arch_by_id[b.archetype_id].get("recommended_sustained_mbps", 0)) * max(b.quantity, 0)
        for b in decision.bill_of_materials
    )
    if capacity < sized:
        violations.append(
            f"CAPACITY: BoM sustains {capacity:.0f} Mbps but peak x 1.25 headroom needs {sized} Mbps."
        )

    if ARCH_D in bom_ids and not any(
        d.action == "ROUTE_VIA_ARCH_D_OT_LOCKED_GATEWAY" for d in decision.flow_decisions.values()
    ):
        violations.append(
            "POSTURE: ARCH_D (bidirectional) is in the BoM but no flow requires the OT-locked return path; prefer pure unidirectional hardware."
        )

    # A diode can only proxy protocols its TX/RX subsystems implement
    bom_protocols = {
        p for b in decision.bill_of_materials for p in arch_by_id[b.archetype_id].get("supported_protocols", [])
    }
    unsupported: dict[str, list[str]] = {}
    for fid, d in decision.flow_decisions.items():
        fl = observed.get(fid)
        proto = PORT_TO_CATALOG_PROTOCOL.get(fl.dst_port) if fl else None
        if proto and d.action in CARRIED_ACTIONS and proto not in bom_protocols:
            unsupported.setdefault(proto, []).append(fid)
    for proto, fids in sorted(unsupported.items()):
        violations.append(
            f"PROTOCOL: flows {', '.join(fids)} need {proto} proxying but no BoM archetype supports it."
        )

    has_rtsp = any(f.dst_port in {554, 8554} or "RTSP" in f.protocol.upper() for f in telemetry_audit.flows)
    if has_rtsp and not any(
        (arch_by_id[b.archetype_id].get("capacity_limits", {}).get("max_rtsp_streams_1080p") or 0) > 0
        for b in decision.bill_of_materials
    ):
        violations.append("PROTOCOL: RTSP video flows observed but no BoM archetype supports RTSP streams.")

    ot_vlans = {v for v in telemetry_audit_vlans(telemetry_audit) if v not in {50, 70, 80, 90, 100}}
    vlan_capacity = sum(
        int(arch_by_id[b.archetype_id].get("capacity_limits", {}).get("max_vlans") or 1) * b.quantity
        for b in decision.bill_of_materials
    )
    if ot_vlans and len(ot_vlans) > vlan_capacity:
        violations.append(
            f"CAPACITY: {len(ot_vlans)} OT VLANs cross the boundary but the BoM terminates only {vlan_capacity}."
        )

    # Physical fit against SAM 3.1 cabinet + video evidence
    if cabinet_inspections or video_walkthrough:
        empty_slots = sum(c.empty_1u_slots for c in cabinet_inspections if c.has_19inch_rack)
        if video_walkthrough:
            empty_slots = max(empty_slots, video_walkthrough.verified_empty_1u_slots)
        din_mm = max([c.din_rail_available_mm for c in cabinet_inspections] or [0.0])
        if video_walkthrough:
            din_mm = max(din_mm, video_walkthrough.verified_din_rail_mm)

        rack_units = sum(b.quantity for b in decision.bill_of_materials if b.mounting in RACK_MOUNTS)
        if rack_units > empty_slots:
            violations.append(
                f"PHYSICAL: BoM needs {rack_units} rack unit(s) but inspections verified only {empty_slots} empty 1U slot(s)."
            )
        din_needed = sum(
            float(arch_by_id[b.archetype_id].get("physical_requirements", {}).get("din_rail_width_mm") or 0)
            * b.quantity
            for b in decision.bill_of_materials
            if b.mounting == "DIN_RAIL"
        )
        # DIN-rail units also fit a spare 1U slot via a DIN-rail rack shelf
        if din_needed > 0 and din_needed > din_mm and empty_slots - rack_units < 1:
            violations.append(
                f"PHYSICAL: BoM needs {din_needed:.0f} mm of DIN rail but inspections verified only "
                f"{din_mm:.0f} mm and no spare 1U slot for a DIN-rail shelf."
            )

    return violations


def telemetry_audit_vlans(telemetry_audit: TelemetryAuditResult) -> list[int]:
    vlans: set[int] = set()
    for c in telemetry_audit.conduits:
        vlans.update(c.vlans_observed)
    return sorted(vlans)


# ---------------------------------------------------------------------------
# Propose -> verify -> revise loop
# ---------------------------------------------------------------------------


async def propose_and_verify_architecture(
    *,
    facility_name: str,
    switch_audit: SwitchAuditResult,
    telemetry_audit: TelemetryAuditResult,
    cabinet_inspections: list[CabinetVisionInspection],
    video_walkthrough: VideoWalkthroughResult | None,
    voice_transcript: VoiceFieldNoteTranscript | None,
    gateway: MetaModelGateway,
    inference_mode: InferenceMode,
    max_attempts: int = MAX_ATTEMPTS,
) -> tuple[ArchitectureDecision | None, PlannerTrace]:
    """Ask the frontier model for a design and iterate until the verifier accepts it."""
    catalog = load_hardware_catalog()
    evidence = build_evidence_pack(
        facility_name=facility_name,
        switch_audit=switch_audit,
        telemetry_audit=telemetry_audit,
        cabinet_inspections=cabinet_inspections,
        video_walkthrough=video_walkthrough,
        voice_transcript=voice_transcript,
    )
    model_name = (
        gateway.settings.muse_glimmer_model
        if inference_mode == "air_gapped_open_weights"
        else gateway.settings.muse_wonder_model
    )
    trace = PlannerTrace(model=model_name, inference_mode=inference_mode)
    messages: list[dict[str, Any]] = [{"role": "user", "content": _build_prompt(evidence, catalog)}]
    started = time.perf_counter()

    for attempt in range(1, max_attempts + 1):
        t0 = time.perf_counter()
        res = await gateway.route_architect_reasoning(
            messages,
            inference_mode=inference_mode,
            temperature=0.1,
            max_tokens=PLANNER_MAX_TOKENS,
            timeout=PLANNER_TIMEOUT_SEC,
            reasoning_effort=gateway.settings.architect_reasoning_effort,
        )
        latency_ms = round((time.perf_counter() - t0) * 1000.0, 1)
        record: dict[str, Any] = {
            "attempt": attempt,
            "source_mode": res.get("source_mode"),
            "model": res.get("model"),
            "latency_ms": latency_ms,
            "reasoning_excerpt": (str(res.get("reasoning") or "")[:600] or None),
        }
        if res.get("source_mode") != "live":
            record["violations"] = ["MODEL_UNAVAILABLE: no live response; using deterministic rule engine."]
            trace.attempts.append(record)
            break
        trace.model = str(res.get("model") or model_name)

        content = str(res.get("content") or "")
        parsed = extract_json_object(content)
        if parsed is None:
            violations = [
                "SCHEMA: reasoning budget exhausted before an answer was written."
                if not content and res.get("finish_reason") == "length"
                else "SCHEMA: response was not a parseable JSON object."
            ]
            decision = None
        else:
            decision, violations = _parse_proposal(parsed)
            if decision is not None:
                violations += verify_architecture_proposal(
                    decision,
                    telemetry_audit=telemetry_audit,
                    cabinet_inspections=cabinet_inspections,
                    video_walkthrough=video_walkthrough,
                    catalog=catalog,
                )
        record["violations"] = violations
        if decision is not None:
            record["proposed_bom"] = [
                f"{b.quantity}x {b.archetype_id} ({b.mounting})" for b in decision.bill_of_materials
            ]
        trace.attempts.append(record)

        if decision is not None and not violations:
            trace.accepted = True
            trace.final_source_mode = "live_verified"
            trace.total_latency_ms = round((time.perf_counter() - started) * 1000.0, 1)
            return decision, trace

        messages.append({"role": "assistant", "content": content or "{}"})
        messages.append(
            {
                "role": "user",
                "content": (
                    "The engineering verifier REJECTED this design. Fix every violation and return "
                    "the complete corrected JSON (all flows, full BoM):\n- " + "\n- ".join(violations)
                ),
            }
        )

    trace.final_source_mode = (
        "deterministic_fallback_after_rejection"
        if any(a.get("source_mode") == "live" for a in trace.attempts)
        else "deterministic_rule_engine"
    )
    trace.total_latency_ms = round((time.perf_counter() - started) * 1000.0, 1)
    return None, trace
