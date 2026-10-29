"""Build the client-facing "today vs. proposed" network map from what the pipeline measured.

Every node is a host seen in the cutover matrix (plus rogue bypass devices), and every edge is a
real IT<->OT conversation. Nothing here is hand-placed per site.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from app.agents.switch_config_agent import SwitchAuditResult, is_enterprise_it_ip
from app.agents.telemetry_duckdb_agent import TelemetryAuditResult, zone_map_from_assets, zone_of
from app.state import CabinetVisionInspection, ConduitArchitecturePlan

SEVER = "SEVER_CRITICAL_VIOLATION_AT_L1"

# Plain-language outcome of each cutover action, as shown on the proposed map
_AFTER_LABEL = {
    "DROP_IN_PROXY_MAPPING": "one-way out through diode",
    "PULL_TO_PUSH_PROXY_REVERSAL": "diode reads plant, pushes copy out",
    "DEPLOY_OPC_UA_WRAPPER_THEN_PROXY": "adapter, then one-way out",
    "REPLACE_SMB_WITH_SFTP_RELAY": "file push out only",
    "ROUTE_VIA_ARCH_D_OT_LOCKED_GATEWAY": "plant-initiated only (locked gateway)",
    SEVER: "cut",
}
# Worst-first ordering used when one host pair carries several flows
_SEVERITY = ["CRITICAL_VIOLATION", "RED_BLOCKER", "AMBER", "GREEN", "LOCAL"]

_CANVAS_W = 1100.0
_IT_Y, _BOUNDARY_Y, _OT_Y = 20.0, 230.0, 440.0


def _classification(tier: str, action: str) -> str:
    if action == SEVER:
        return "CRITICAL_VIOLATION"
    return {"GREEN": "GREEN", "AMBER": "AMBER"}.get(tier, "RED_BLOCKER")


_NODE_W = 230.0


_PER_ROW, _ROW_GAP = 6, 105.0


def _spread(count: int, y: float) -> list[tuple[float, float]]:
    """Evenly spaced positions; a long row wraps onto extra rows below so the map stays readable."""
    if count <= 0:
        return []
    out: list[tuple[float, float]] = []
    for start in range(0, count, _PER_ROW):
        n = min(_PER_ROW, count - start)
        step = max(_NODE_W + 20, _CANVAS_W / n)
        offset = (_CANVAS_W - step * n) / 2 if step * n < _CANVAS_W else 0.0
        row_y = y + (start // _PER_ROW) * _ROW_GAP
        out += [(round(offset + step * i + (step - _NODE_W) / 2, 1), row_y) for i in range(n)]
    return out


def _after_action(direction: str, actions: list[str]) -> str:
    """How a connection crosses the boundary once the plan is in place.

    Every office<->plant connection that survives goes through the diode (or the OT-locked
    gateway); one that is cut stops there. Bypass paths never reach the boundary.
    """
    # A connection the plan cuts is cut wherever it runs, inside the plant included
    if all(a == SEVER for a in actions):
        return "cut"
    if direction == "LOCAL":
        return "local"
    if direction == "BYPASS_TO_OT":
        return "cut"
    if any(a == "ROUTE_VIA_ARCH_D_OT_LOCKED_GATEWAY" for a in actions):
        return "via_gateway"
    return "via_diode"


def build_topology_view(
    *,
    plan: ConduitArchitecturePlan,
    switch_audit: SwitchAuditResult | None,
    telemetry_audit: TelemetryAuditResult | None,
    cabinet_inspections: list[CabinetVisionInspection] | None = None,
) -> dict[str, Any]:
    """Nodes and edges in the frontend's `TopologyNodeSpec` / `TopologyEdgeSpec` shapes, plus counts."""
    assets = {a.ip_address: a for a in (switch_audit.assets if switch_audit else [])}
    zones = zone_map_from_assets(list(assets.values())) if assets else {}
    flows = {f.flow_id: f for f in (telemetry_audit.flows if telemetry_audit else [])}
    rogue_ips = {
        ip
        for a in plan.shadow_assets_and_bypasses
        if a.anomaly_type in {"ROGUE_IT_BRIDGE", "DUAL_HOMED_BYPASS_ASSET"}
        for ip in a.ip_addresses
    }
    shadow_ips = {ip for a in plan.shadow_assets_and_bypasses for ip in a.ip_addresses}
    rogue_ips |= {f.src_ip for f in flows.values() if f.direction == "BYPASS_TO_OT"}

    def zone(ip: str) -> str:
        if ip in rogue_ips:
            return "BYPASS"
        z = zone_of(ip, zones)
        if z in {"IT", "OT", "BYPASS"}:
            return z
        if z == "UNDOCUMENTED":
            return "OT"
        return "IT" if is_enterprise_it_ip(ip, None) else "OT"

    # One edge per (IT-or-bypass host, OT host) pair; flows inside OT keep their own pair
    pairs: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in plan.protocol_cutover_matrix:
        flow = flows.get(row.flow_id)
        # A merged row stands for many hosts (one master polling seven RTUs): draw each of them
        srcs = (flow.merged_src_ips if flow and flow.merged_src_ips else None) or [row.observed_src_ip]
        dsts = (flow.merged_dst_ips if flow and flow.merged_dst_ips else None) or [row.observed_dst_ip]
        for src in srcs:
            for dst in dsts:
                zs, zd = zone(src), zone(dst)
                if zs == "OT" and zd != "OT":
                    outer, inner = dst, src
                elif zd == "OT" and zs != "OT":
                    outer, inner = src, dst
                elif zs == "OT" and zd == "OT":
                    outer, inner = src, dst
                else:
                    continue
                if zs == "BYPASS":
                    direction = "BYPASS_TO_OT"
                elif zs == "OT" and zd == "OT":
                    direction = "LOCAL"
                else:
                    direction = flow.direction if flow else row.observed_initiator
                local_unchanged = direction == "LOCAL" and row.cutover_action_type != SEVER
                pairs[(outer, inner)].append(
                    {
                        "row": row,
                        "pair": (src, dst),
                        "direction": direction,
                        "writes": bool(flow and flow.has_write_operations),
                        "classification": (
                            "LOCAL" if local_unchanged else _classification(row.cutover_tier, row.cutover_action_type)
                        ),
                    }
                )

    hosts_by_zone: dict[str, list[str]] = defaultdict(list)
    for outer, inner in pairs:
        for ip in (outer, inner):
            z = zone(ip)
            if ip not in hosts_by_zone[z]:
                hosts_by_zone[z].append(ip)

    positions: dict[str, tuple[float, float]] = {}
    for ip, pos in zip(sorted(hosts_by_zone["IT"]), _spread(len(hosts_by_zone["IT"]), _IT_Y)):
        positions[ip] = pos
    for ip, pos in zip(sorted(hosts_by_zone["OT"]), _spread(len(hosts_by_zone["OT"]), _OT_Y)):
        positions[ip] = pos
    right_edge = max([x for x, _ in positions.values()] + [_CANVAS_W - _NODE_W]) + _NODE_W + 40
    for i, ip in enumerate(sorted(hosts_by_zone["BYPASS"])):
        positions[ip] = (right_edge, _BOUNDARY_Y + i * 110)

    def node_spec(ip: str) -> dict[str, Any]:
        a = assets.get(ip)
        z = zone(ip)
        level = "BYPASS" if z == "BYPASS" else (a.purdue_level if a else ("L4" if z == "IT" else "L1"))
        if level == "L0":
            level = "L1"
        role = (a.device_category.replace("_", " ").title() if a and a.device_category != "UNKNOWN" else None) or (
            "Corporate IT host" if z == "IT" else "Plant device"
        )
        x, y = positions[ip]
        return {
            "id": f"n-{ip}",
            "hostname": (a.hostname if a and a.hostname else ip),
            "ip": ip,
            "vendor": a.vendor if a else "Unknown",
            "role": "Rogue bypass device" if z == "BYPASS" else role,
            "purdueLevel": level,
            "vlan": f"VLAN {a.vlan}" if a and a.vlan else "",
            "isShadowAsset": ip in shadow_ips and z != "BYPASS",
            "isRogueBypass": z == "BYPASS",
            "anomalyBadge": "Bypasses firewall" if z == "BYPASS" else ("Unlisted" if ip in shadow_ips else None),
            "x": x,
            "y": y,
        }

    nodes = [node_spec(ip) for ip in positions]
    nodes.append(
        {
            "id": "n-boundary",
            "hostname": "Plant boundary",
            "ip": "",
            "vendor": (telemetry_audit.firewall_vendor if telemetry_audit else "Firewall"),
            "role": "IT / OT boundary",
            "purdueLevel": "L3.5",
            "vlan": "",
            "isBoundaryNode": True,
            # Centered under the host rows; the boundary card is ~300 px wide
            "x": round((max([x for x, y in positions.values() if y != _BOUNDARY_Y] + [0.0]) + _NODE_W) / 2 - 150, 1),
            "y": _BOUNDARY_Y,
        }
    )

    edges: list[dict[str, Any]] = []
    for (outer, inner), items in pairs.items():
        worst = min(items, key=lambda i: _SEVERITY.index(i["classification"]))
        protocols = sorted({i["row"].protocol for i in items})
        ports = sorted({i["row"].port for i in items})
        direction = worst["direction"] if worst["direction"] in {"OT_TO_IT", "IT_TO_OT", "BYPASS_TO_OT"} else "LOCAL"
        arrow = {"OT_TO_IT": "plant → IT", "IT_TO_OT": "IT → plant", "BYPASS_TO_OT": "outside → plant"}.get(
            direction, "inside plant"
        )
        before = f"{', '.join(protocols)} ({arrow}{', sends commands' if any(i['writes'] for i in items) else ''})"
        edges.append(
            {
                "id": f"e-{outer}-{inner}",
                "source": f"n-{outer}" if direction != "OT_TO_IT" else f"n-{inner}",
                "target": f"n-{inner}" if direction != "OT_TO_IT" else f"n-{outer}",
                "protocol": ", ".join(protocols),
                "port": ", ".join(str(p) for p in ports),
                "classification": worst["classification"],
                "directionBefore": direction,
                "beforeLabel": before,
                "afterLabel": (
                    "inside plant, unchanged"
                    if worst["classification"] == "LOCAL"
                    else _AFTER_LABEL.get(worst["row"].cutover_action_type, "reviewed")
                ),
                "afterAction": _after_action(direction, [i["row"].cutover_action_type for i in items]),
            }
        )

    rows = [i for items in pairs.values() for i in items]
    inbound = [i for i in rows if i["direction"] in {"IT_TO_OT", "BYPASS_TO_OT"}]
    rogue_modem_photo = any(
        d.semantic_class == "ROGUE_CELLULAR_BYPASS_MODEM" for c in (cabinet_inspections or []) for d in c.detections
    )
    # Counted per host pair, so the numbers match the lines on the map
    summary = {
        "it_to_ot_paths_today": len({i["pair"] for i in inbound}),
        "command_paths_today": len({i["pair"] for i in inbound if i["writes"]}),
        "bypass_paths_today": len({i["pair"][0] for i in rows if i["direction"] == "BYPASS_TO_OT"}),
        "rogue_modem_in_photo": rogue_modem_photo,
        # After cutover an IT host can only reach OT through an OT-locked gateway, never directly
        "it_to_ot_paths_after": len(
            {i["pair"] for i in inbound if i["row"].cutover_action_type == "ROUTE_VIA_ARCH_D_OT_LOCKED_GATEWAY"}
        ),
        "feeds_kept": len(
            {i["pair"] for i in rows if i["row"].cutover_action_type != SEVER and i["direction"] != "LOCAL"}
        ),
        "connections_cut": len({i["pair"] for i in rows if i["row"].cutover_action_type == SEVER}),
        # Monitoring kept through the diode while the same source's commands stop
        "remote_commands_dropped": len(
            {
                i["pair"]
                for i in inbound
                if i["writes"] and i["row"].cutover_action_type not in {SEVER, "ROUTE_VIA_ARCH_D_OT_LOCKED_GATEWAY"}
            }
        ),
    }
    return {"nodes": nodes, "edges": edges, "summary": summary}
