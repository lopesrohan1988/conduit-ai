"""Replay real ICS command packets from a compromised IT network against today's and the proposed design.

Threat model: the attacker controls every IT host that talks to the plant today, plus any bypass
device. Each attempt sends real command frames (taken from public captures and decoded here) down
a path the client's traffic actually uses.

- Today: a path the firewall already permits carries any frame on that port. A port-based rule that
  lets a SCADA master poll an RTU over IEC-104 cannot tell a poll from a breaker command.
- Proposed: each frame is checked against the verified cutover plan. A one-way diode has no inbound
  path, an OT-locked gateway only accepts plant-initiated sessions, and a bypass device stops only
  if the plan physically removes it. A plan that leaves a bypass in place therefore fails this check.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from scapy.utils import RawPcapReader

from app.agents.switch_config_agent import SwitchAuditResult, is_enterprise_it_ip
from app.agents.telemetry_duckdb_agent import (
    TelemetryAuditResult,
    _inspect_l7_payload,
    zone_map_from_assets,
    zone_of,
)
from app.config import get_settings
from app.state import ConduitArchitecturePlan

SEVER = "SEVER_CRITICAL_VIOLATION_AT_L1"
ARCH_D_ROUTE = "ROUTE_VIA_ARCH_D_OT_LOCKED_GATEWAY"
_FRAMES_PER_LABEL = 3


@dataclass(frozen=True)
class CommandFrame:
    port: int
    label: str
    payload: bytes
    source_capture: str


def _client_payloads(pcap: Path) -> list[tuple[int, bytes]]:
    """(server_port, L7 payload) for every TCP segment sent toward a known ICS service port."""
    out: list[tuple[int, bytes]] = []
    for data, _ in RawPcapReader(str(pcap)):
        if len(data) < 54:
            continue
        eth_type, off = struct.unpack("!H", data[12:14])[0], 14
        if eth_type == 0x8100:
            eth_type, off = struct.unpack("!H", data[16:18])[0], 18
        if eth_type != 0x0800 or data[off + 9] != 6:
            continue
        l4 = off + (data[off] & 0x0F) * 4
        dport = struct.unpack("!H", data[l4 + 2 : l4 + 4])[0]
        payload = data[l4 + (data[l4 + 12] >> 4) * 4 :]
        if payload:
            out.append((dport, bytes(payload)))
    return out


@lru_cache(maxsize=1)
def load_command_library() -> dict[int, tuple[CommandFrame, ...]]:
    """Real write/command frames from the public captures in `data/real_ics_captures`, by port."""
    root = get_settings().real_ics_captures_dir
    found: dict[int, list[CommandFrame]] = {}
    per_label: dict[tuple[int, str], int] = {}
    for pcap in sorted(root.glob("*.pcap*")):
        try:
            payloads = _client_payloads(pcap)
        except Exception:
            continue
        for port, payload in payloads:
            label, is_write = _inspect_l7_payload(port, payload)
            if not (label and is_write):
                continue
            key = (port, label)
            if per_label.get(key, 0) >= _FRAMES_PER_LABEL:
                continue
            per_label[key] = per_label.get(key, 0) + 1
            found.setdefault(port, []).append(CommandFrame(port, label, payload, pcap.name))
    return {port: tuple(frames) for port, frames in found.items()}


def replay_attacks(
    *,
    plan: ConduitArchitecturePlan,
    telemetry_audit: TelemetryAuditResult | None,
    switch_audit: SwitchAuditResult | None,
) -> dict[str, Any]:
    library = load_command_library()
    flows = {f.flow_id: f for f in (telemetry_audit.flows if telemetry_audit else [])}
    zones = zone_map_from_assets(switch_audit.assets) if switch_audit else {}
    bypass_ips = {f.src_ip for f in flows.values() if f.direction == "BYPASS_TO_OT"} | {
        ip
        for a in plan.shadow_assets_and_bypasses
        if a.anomaly_type in {"ROGUE_IT_BRIDGE", "DUAL_HOMED_BYPASS_ASSET"}
        for ip in a.ip_addresses
    }

    def is_ot(ip: str) -> bool:
        z = zone_of(ip, zones)
        return z != "IT" if z else not is_enterprise_it_ip(ip, None)

    paths: list[dict[str, Any]] = []
    for row in plan.protocol_cutover_matrix:
        src, dst = row.observed_src_ip, row.observed_dst_ip
        flow = flows.get(row.flow_id)
        from_bypass = src in bypass_ips
        inbound = from_bypass or (flow.direction == "IT_TO_OT" if flow else row.observed_initiator == "IT_TO_OT")
        if not inbound or not is_ot(dst):
            continue

        frames = library.get(row.port, ())
        attempts = [
            {"label": f.label, "source_capture": f.source_capture, "bytes": len(f.payload)} for f in frames
        ] or [{"label": f"{row.protocol} session attempt (no public command sample)", "source_capture": None, "bytes": 0}]

        if from_bypass:
            blocked = row.cutover_action_type == SEVER
            why = (
                "bypass device physically removed"
                if blocked
                else "bypass device left in place: it does not pass through the diode"
            )
        elif row.cutover_action_type == ARCH_D_ROUTE:
            blocked, why = True, "OT-locked gateway accepts only plant-initiated sessions"
        else:
            blocked, why = True, "one-way diode has no inbound path"

        paths.append(
            {
                "flow_id": row.flow_id,
                "attacker": src,
                "target": dst,
                "port": row.port,
                "protocol": row.protocol,
                "via": "bypass device" if from_bypass else "compromised IT host",
                "frames": attempts,
                "real_command_frames": len(frames),
                "reached_plant_today": len(attempts),
                "reached_plant_proposed": 0 if blocked else len(attempts),
                "proposed_outcome": why,
            }
        )

    feeds = [r for r in plan.protocol_cutover_matrix if r.cutover_action_type != SEVER]
    total = sum(len(p["frames"]) for p in paths)
    return {
        "threat_model": "Attacker controls every IT host that talks to the plant today, plus any bypass device.",
        "command_frame_sources": sorted(
            {f.source_capture for frames in library.values() for f in frames}
        ),
        "today": {"attempts": total, "reached_plant": sum(p["reached_plant_today"] for p in paths)},
        "proposed": {"attempts": total, "reached_plant": sum(p["reached_plant_proposed"] for p in paths)},
        "real_command_frames": sum(p["real_command_frames"] for p in paths),
        "paths": paths,
        "feeds_kept": len(feeds),
        "caveat": (
            "Today's result assumes port-based firewall rules, as in the supplied rule set; a firewall "
            "doing deep inspection of ICS function codes could stop some command frames."
        ),
    }
