"""What turns a drafted plan into a deliverable a consultant can sign.

* Engineer overrides: any connection's decision can be changed, with a reason. The same verifier
  that checks the model re-checks the change, and only an accepted change reaches the plan.
* Sign-off: who approved which exact plan (by fingerprint). Any later change voids it.
* Evidence manifest: every input file by SHA-256, every model and how it ran, and the evidence
  behind each finding, so the report can be traced back to what was supplied.
* Evidence conflicts: places where two sources disagree, turned into questions for the site.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.agents.architect_llm_planner import (
    FlowDecision,
    decision_from_plan,
    verifier_checklist,
    verify_architecture_proposal,
)
from app.agents.architect_sizing_agent import _ACTION_PRESCRIPTIONS
from app.agents.switch_config_agent import SwitchAuditResult
from app.agents.telemetry_duckdb_agent import TelemetryAuditResult
from app.state import CabinetVisionInspection, ConduitArchitecturePlan, VideoWalkthroughResult

SEVER = "SEVER_CRITICAL_VIOLATION_AT_L1"

# Tier an action carries in the cutover matrix (the rule engine's own pairing)
ACTION_TIER = {
    "DROP_IN_PROXY_MAPPING": "GREEN",
    "PULL_TO_PUSH_PROXY_REVERSAL": "AMBER",
    "ROUTE_VIA_ARCH_D_OT_LOCKED_GATEWAY": "AMBER",
    "DEPLOY_OPC_UA_WRAPPER_THEN_PROXY": "RED",
    "REPLACE_SMB_WITH_SFTP_RELAY": "RED",
    SEVER: "RED",
}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def plan_fingerprint(plan: ConduitArchitecturePlan) -> str:
    """Short hash of the exact plan a sign-off refers to."""
    return hashlib.sha256(plan.model_dump_json().encode("utf-8")).hexdigest()[:16]


def new_review() -> dict[str, Any]:
    return {"overrides": [], "signoff": None}


# ---------------------------------------------------------------------------
# Engineer overrides
# ---------------------------------------------------------------------------


def apply_override(
    plan: ConduitArchitecturePlan,
    *,
    flow_id: str,
    action: str,
    reason: str,
    reviewer: str,
    telemetry_audit: TelemetryAuditResult,
    cabinet_inspections: list[CabinetVisionInspection],
    video_walkthrough: VideoWalkthroughResult | None,
) -> tuple[dict[str, Any], ConduitArchitecturePlan | None]:
    """Check one engineer change with the verifier. Returns the log entry and, if accepted, the new plan.

    Only the violations the change adds are held against it, so a plan that already carried a
    finding does not block every later edit.
    """
    if action not in ACTION_TIER:
        raise ValueError(f"Unknown action '{action}'.")
    row = next((r for r in plan.protocol_cutover_matrix if r.flow_id == flow_id), None)
    if row is None:
        raise KeyError(flow_id)
    observed = {f.flow_id: f for f in telemetry_audit.flows}
    fl = observed.get(flow_id)

    def verify(decision: Any) -> list[str]:
        return verify_architecture_proposal(
            decision,
            telemetry_audit=telemetry_audit,
            cabinet_inspections=cabinet_inspections,
            video_walkthrough=video_walkthrough,
        )

    decision = decision_from_plan(plan, telemetry_audit)
    baseline = set(verify(decision))
    original = decision.flow_decisions[flow_id]
    decision.flow_decisions[flow_id] = FlowDecision(
        flow_id=flow_id, initiator=original.initiator, tier=ACTION_TIER[action], action=action
    )
    added = [v for v in verify(decision) if v not in baseline]
    entry = {
        "id": f"OVR-{flow_id}-{_now()}",
        "flow_id": flow_id,
        "connection": f"{row.observed_src_ip} -> {row.observed_dst_ip}:{row.port} ({row.protocol})",
        "from_action": row.cutover_action_type,
        "to_action": action,
        "reason": reason,
        "reviewer": reviewer,
        "at": _now(),
        "accepted": not added,
        "violations": added,
        "checks": verifier_checklist(
            telemetry_audit=telemetry_audit,
            cabinet_inspections=cabinet_inspections,
            video_walkthrough=video_walkthrough,
            violations=added,
        ),
    }
    if added or action == row.cutover_action_type:
        return entry, None

    new_plan = plan.model_copy(deep=True)
    new_row = next(r for r in new_plan.protocol_cutover_matrix if r.flow_id == flow_id)
    arch = new_plan.conduit_sizing_recommendations[0].recommended_archetype_id
    detail = fl.function_detail if fl else row.function_code_detail
    new_row.cutover_tier = ACTION_TIER[action]  # type: ignore[assignment]
    new_row.cutover_action_type = action  # type: ignore[assignment]
    new_row.engineering_prescription = (
        _ACTION_PRESCRIPTIONS[action].format(
            proto=row.protocol, arch=arch, dst=f"{row.observed_dst_ip}:{row.port}", detail=detail
        )
        + f" Engineer override by {reviewer}: {reason}"
    )
    if action == SEVER:
        # A cut connection no longer needs a diode proxy rule on its plant-side end
        ot_ip = row.observed_src_ip if row.observed_initiator == "OT_TO_IT" else row.observed_dst_ip
        new_plan.tx_rx_proxy_translation_table = [
            r for r in new_plan.tx_rx_proxy_translation_table if r.ot_source_ip != ot_ip or r.ot_source_port != row.port
        ]
    return entry, new_plan


def sign_off(plan: ConduitArchitecturePlan, review: dict[str, Any], *, reviewer: str, note: str) -> dict[str, Any]:
    accepted = [o for o in review["overrides"] if o["accepted"]]
    return {
        "reviewer": reviewer,
        "note": note,
        "at": _now(),
        "plan_fingerprint": plan_fingerprint(plan),
        "overrides_applied": len(accepted),
    }


# ---------------------------------------------------------------------------
# Evidence manifest
# ---------------------------------------------------------------------------

_INPUT_ROLES = [
    ("pcap_path", "Packet capture"),
    ("firewall_csv_path", "Firewall log"),
    ("switch_dump_path", "Switch CLI dump"),
    ("asset_inventory_csv_path", "Asset list"),
    ("diagram_image_path", "Network drawing"),
    ("video_walkthrough_path", "Cabinet walkthrough video"),
]


def _file_entry(role: str, path: str | Path) -> dict[str, Any] | None:
    p = Path(path)
    if not p.is_file():
        return None
    digest = hashlib.sha256()
    with p.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return {"role": role, "file": p.name, "bytes": p.stat().st_size, "sha256": digest.hexdigest()}


def build_evidence_manifest(state: dict[str, Any], scratch: dict[str, Any]) -> dict[str, Any]:
    """Inputs by hash, models by stage, and the evidence behind every finding."""
    inputs = [e for key, role in _INPUT_ROLES if state.get(key) for e in [_file_entry(role, state[key])] if e]
    inputs += [e for p in state.get("cabinet_image_paths") or [] for e in [_file_entry("Cabinet photo", p)] if e]
    voice = state.get("voice_transcript")
    if state.get("voice_audio_bytes"):
        inputs.append(
            {
                "role": "Voice note",
                "file": state.get("voice_audio_filename") or "voice note",
                "bytes": len(state["voice_audio_bytes"]),
                "sha256": hashlib.sha256(state["voice_audio_bytes"]).hexdigest(),
            }
        )

    models = [
        {"stage": e.get("stage", ""), "model": e.get("model", ""), "source_mode": e.get("source_mode", "")}
        for e in state.get("agent_events") or []
        if isinstance(e, dict)
    ]
    trace = (scratch.get("architect_meta") or {}).get("planner_trace") or {}
    attempts = trace.get("attempts") or []
    architect = {
        # No drafts means no model call: the rule engine wrote the plan
        "model": (trace.get("model") or (scratch.get("architect_meta") or {}).get("architect_model"))
        if attempts
        else "rule engine (no model call)",
        "source_mode": trace.get("final_source_mode") or (scratch.get("architect_meta") or {}).get("source_mode"),
        "drafts": len(attempts),
        "drafts_rejected": sum(1 for a in attempts if a.get("violations")),
        "accepted": bool(trace.get("accepted")),
    }

    plan: ConduitArchitecturePlan | None = state.get("architecture_plan")
    telemetry: TelemetryAuditResult | None = scratch.get("telemetry_audit")
    flows = {f.flow_id: f for f in (telemetry.flows if telemetry else [])}
    pcap_file = Path(state["pcap_path"]).name if state.get("pcap_path") else None
    fw_file = Path(state["firewall_csv_path"]).name if state.get("firewall_csv_path") else None

    def seen_in(fl: Any) -> str:
        # Each number is credited to the file it came from: packets to the capture, bytes to the log
        parts = []
        if fl.pcap_packets and pcap_file:
            parts.append(f"{pcap_file}: {fl.pcap_packets:,} packets")
        if fl.in_firewall_log and fw_file:
            parts.append(f"{fw_file}: {fl.bytes_transferred:,} bytes logged")
        elif pcap_file and fl.pcap_packets:
            parts[-1] += f", {fl.bytes_transferred:,} bytes"
        return "; ".join(parts) or (pcap_file or fw_file or "traffic evidence")

    findings: list[dict[str, str]] = []
    for row in plan.protocol_cutover_matrix if plan else []:
        fl = flows.get(row.flow_id)
        seen = seen_in(fl) if fl else (pcap_file or fw_file or "traffic evidence")
        findings.append(
            {
                "id": row.flow_id,
                "finding": f"{row.protocol} {row.observed_src_ip} -> {row.observed_dst_ip}:{row.port} "
                f"({row.function_code_detail})",
                "decision": row.cutover_action_type,
                "evidence": seen,
            }
        )
    for a in plan.shadow_assets_and_bypasses if plan else []:
        findings.append(
            {
                "id": a.anomaly_id,
                "finding": f"{a.anomaly_type}: {', '.join(a.ip_addresses)} ({a.vendor})",
                "decision": a.severity,
                "evidence": a.evidence_source,
            }
        )

    return {
        "generated_at": _now(),
        "facility": state.get("facility_name"),
        "plan_fingerprint": plan_fingerprint(plan) if plan else None,
        "inputs": inputs,
        "voice_transcript_source": voice.source_mode if voice else None,
        "models": models,
        "architect": architect,
        "findings": findings,
    }


# ---------------------------------------------------------------------------
# Evidence conflicts
# ---------------------------------------------------------------------------

_MM_RE = re.compile(r"(\d{2,4})\s*(?:millimet(?:er|re)s?|mm)\b[^.]{0,40}?DIN", re.IGNORECASE)
_RACK_RE = re.compile(r"\b(zero|no|\d+)\s+(?:free\s+|empty\s+|open\s+)?(?:19-inch rack space|rack units?|1U slots?)", re.IGNORECASE)
_PORT_RE = re.compile(r"\b((?:Gi|Fa|Te|Eth|GigabitEthernet|FastEthernet)\d+(?:/\d+)+)\b")


def _port_suffix(port: str) -> str:
    return re.sub(r"^[A-Za-z]+", "", port)


def find_evidence_conflicts(state: dict[str, Any], scratch: dict[str, Any]) -> list[dict[str, Any]]:
    """Places two sources disagree, each phrased as the question to put to the site."""
    conflicts: list[dict[str, Any]] = []
    voice = state.get("voice_transcript")
    voice_text = ""
    if voice is not None and voice.source_mode != "not_supplied":
        voice_text = " ".join(
            [voice.raw_transcript] + [o.extracted_entity for o in voice.structured_observations]
        )
    voice_file = voice.audio_filename if voice is not None else "voice note"
    cabinets: list[CabinetVisionInspection] = state.get("cabinet_inspections") or []
    measured = [c for c in cabinets if c.source_image]

    # 1. Free DIN rail: what the engineer said against what SAM 3.1 measured
    said_mm = _MM_RE.search(voice_text)
    best_rail = max(measured, key=lambda c: c.din_rail_available_mm, default=None)
    if said_mm and best_rail is not None and best_rail.din_rail_available_mm > 0:
        said, seen = float(said_mm.group(1)), best_rail.din_rail_available_mm
        if abs(said - seen) > max(20.0, 0.1 * max(said, seen)):
            conflicts.append(
                {
                    "topic": "Free DIN rail",
                    "sources": [
                        {"source": f"Voice note ({voice_file})", "value": f"{said:.0f} mm"},
                        {"source": f"SAM 3.1 on {best_rail.source_image}", "value": f"{seen:.0f} mm"},
                    ],
                    "question": f"Is there {min(said, seen):.0f} mm or {max(said, seen):.0f} mm of free DIN rail? "
                    f"The kit is sized to the smaller figure until someone confirms.",
                }
            )

    # 2. Empty rack units
    said_rack = _RACK_RE.search(voice_text)
    racks = [c for c in measured if c.has_19inch_rack]
    if said_rack and racks:
        said_u = 0 if said_rack.group(1).lower() in {"zero", "no"} else int(said_rack.group(1))
        seen_u = max(c.empty_1u_slots for c in racks)
        if said_u != seen_u:
            conflicts.append(
                {
                    "topic": "Empty rack space",
                    "sources": [
                        {"source": f"Voice note ({voice_file})", "value": f"{said_u} U"},
                        {"source": "SAM 3.1 on the rack photo", "value": f"{seen_u} U"},
                    ],
                    "question": "How many empty 1U slots does the rack have?",
                }
            )

    # 3. A switch port named in the voice note that the switch dump does not have
    switch: SwitchAuditResult | None = scratch.get("switch_audit")
    dump_ports = {a.switch_port: a for a in (switch.assets if switch else []) if a.switch_port}
    if voice_text and dump_ports and state.get("switch_dump_path"):
        for said_port in sorted(set(_PORT_RE.findall(voice_text))):
            if said_port in dump_ports:
                continue
            match = next((a for p, a in dump_ports.items() if _port_suffix(p) == _port_suffix(said_port)), None)
            conflicts.append(
                {
                    "topic": f"Switch port {said_port}",
                    "sources": [
                        {"source": f"Voice note ({voice_file})", "value": said_port},
                        {
                            "source": f"{Path(state['switch_dump_path']).name} MAC table",
                            "value": (
                                f"{match.switch_port} ({match.hostname or match.ip_address})"
                                if match
                                else "no such port"
                            ),
                        },
                    ],
                    "question": (
                        f"The voice note says {said_port}, the switch has {match.switch_port}. "
                        f"Confirm the port before the cutover config shuts it."
                        if match
                        else f"The switch dump has no port {said_port}. Which port did the engineer mean?"
                    ),
                }
            )

    # 4. Devices on the drawing that never appeared on the network
    reading = scratch.get("diagram_reading") or {}
    drawing = reading.get("source_image") or "network drawing"
    for region in reading.get("regions") or []:
        if region.get("kind") == "device" and region.get("status") == "not_seen":
            name = region.get("hostname") or region.get("name") or "device"
            ips = ", ".join(region.get("ips") or []) or "no address"
            conflicts.append(
                {
                    "topic": f"{name} on the drawing",
                    "sources": [
                        {"source": drawing, "value": f"drawn ({ips})"},
                        {"source": "Traffic and switch evidence", "value": "never seen"},
                    ],
                    "question": f"Is {name} ({ips}) decommissioned, or on a segment the capture did not cover?",
                }
            )
    return conflicts
