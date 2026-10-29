"""Score a pipeline-generated `ConduitArchitecturePlan` against benchmark ground truth.

The plan under test must be produced from the scenario's raw artifacts; ground truth is
only read here, after the fact. Every metric is computed — nothing is asserted.
"""

from __future__ import annotations

from typing import Any

from app.agents.switch_config_agent import SwitchAuditResult
from app.agents.telemetry_duckdb_agent import TelemetryAuditResult
from app.state import ConduitArchitecturePlan

GT_TIER = {
    "GREEN": "GREEN",
    "AMBER": "AMBER",
    "RED": "RED",
    "RED_BLOCKER": "RED",
    "CRITICAL_VIOLATION": "RED",
}


def expand_gt_ips(spec: str) -> set[str]:
    """Expand `10.0.0.11-16,10.0.0.20` style ground-truth IP specs into a set."""
    ips: set[str] = set()
    for part in str(spec).split(","):
        part = part.strip()
        if not part:
            continue
        head, _, tail = part.rpartition(".")
        if "-" in tail and head:
            lo, hi = tail.split("-", 1)
            if lo.isdigit() and hi.isdigit():
                ips.update(f"{head}.{n}" for n in range(int(lo), int(hi) + 1))
                continue
        ips.add(part)
    return ips


def _bom_signature(items: list[tuple[str, int]]) -> list[tuple[str, int]]:
    return sorted(items)


def score_scenario(
    sc_gt: dict[str, Any],
    plan: ConduitArchitecturePlan,
    switch_audit: SwitchAuditResult,
    telemetry_audit: TelemetryAuditResult,
) -> dict[str, Any]:
    """Compute per-scenario accuracy metrics for one pipeline run."""
    # 1. Asset discovery & shadow OT (by IP)
    exp_assets = int(sc_gt["total_discovered_assets"])
    det_assets = int(switch_audit.total_discovered_assets)
    gt_shadow_ips = {str(a["ip_address"]) for a in sc_gt.get("undocumented_shadow_assets", [])}
    det_shadow_ips = {ip for a in switch_audit.shadow_anomalies for ip in a.ip_addresses}
    shadow_tp = len(gt_shadow_ips & det_shadow_ips)

    # 2. Bandwidth (None when the answer key has no reference value, e.g. a public dataset)
    raw_peak = sc_gt["telemetry_metrics"].get("peak_bandwidth_mbps")
    exp_peak = float(raw_peak) if raw_peak is not None else None
    det_peak = float(telemetry_audit.peak_bandwidth_mbps)

    # 3. Hardware BoM — primary or any accepted alternative, archetypes AND quantities
    bom_gt = sc_gt.get("expected_hardware_bom")
    det_bom = _bom_signature([(b.item_code, b.quantity) for b in plan.bill_of_materials])
    if bom_gt:
        acceptable = [
            _bom_signature([(i["archetype_id"], int(i["quantity"])) for i in bom_gt["primary_recommendation"]])
        ] + [
            _bom_signature([(i["archetype_id"], int(i["quantity"])) for i in alt["items"]])
            for alt in bom_gt.get("accepted_alternative_boms", [])
        ]
        bom_exact: bool | None = det_bom in acceptable
        primary_archs = sorted({a for a, _ in acceptable[0]})
        archetypes_match: bool | None = sorted({a for a, _ in det_bom}) == primary_archs or bom_exact
    else:
        acceptable, bom_exact, archetypes_match = [None], None, None

    # 4. Flow classification — each GT flow is matched to plan rows on port + endpoint IPs
    rows = plan.protocol_cutover_matrix
    flow_results: list[dict[str, Any]] = []
    for gf in sc_gt.get("flow_classifications", []):
        endpoints = expand_gt_ips(gf.get("dst_ip", "")) | expand_gt_ips(gf.get("src_ip", ""))
        port = int(gf["dst_port"])
        candidates = [
            r
            for r in rows
            if r.port == port and (r.observed_dst_ip in endpoints or r.observed_src_ip in endpoints)
        ]
        classification = str(gf["classification"]).upper()
        is_critical = classification == "CRITICAL_VIOLATION"
        severed = any(r.cutover_action_type == "SEVER_CRITICAL_VIOLATION_AT_L1" for r in candidates)
        if classification == "KEEP":
            # Legitimate operation (e.g. labelled NORMAL in a public dataset): it must keep
            # working, whatever route the plan gives it. Only rows from this flow's own source
            # count, so cutting an attacker that targets the same devices is not held against it.
            own = [r for r in candidates if r.observed_src_ip in expand_gt_ips(gf.get("src_ip", ""))]
            exp_tier = "KEEP"
            severed = any(r.cutover_action_type == "SEVER_CRITICAL_VIOLATION_AT_L1" for r in own)
            tier_ok = bool(own) and not severed
        else:
            exp_tier = GT_TIER.get(classification, "RED")
            tier_ok = any(r.cutover_tier == exp_tier for r in candidates)
        # Unsafe = a flow that must be blocked/remediated was only ever passed as GREEN
        unsafe = exp_tier == "RED" and bool(candidates) and all(r.cutover_tier == "GREEN" for r in candidates)
        flow_results.append(
            {
                "flow_id": gf["flow_id"],
                "protocol": gf["protocol"],
                "expected_tier": exp_tier,
                "detected": bool(candidates),
                "tier_ok": tier_ok,
                "critical": is_critical,
                "critical_severed": is_critical and severed,
                "unsafe_pass": unsafe,
                "observed_tiers": sorted({r.cutover_tier for r in candidates}),
            }
        )

    n_flows = len(flow_results)
    n_critical = sum(1 for f in flow_results if f["critical"])
    return {
        "assets_expected": exp_assets,
        "assets_detected": det_assets,
        "shadow_expected": len(gt_shadow_ips),
        "shadow_detected": len(det_shadow_ips),
        "shadow_true_positive": shadow_tp,
        "peak_expected_mbps": exp_peak,
        "peak_detected_mbps": det_peak,
        "peak_ok": None if exp_peak is None else abs(det_peak - exp_peak) <= max(0.2, exp_peak * 0.005),
        "bom_detected": det_bom,
        "bom_expected": acceptable[0],
        "bom_exact": bom_exact,
        "archetypes_match": archetypes_match,
        "bom_cost_usd": plan.executive_summary.estimated_hardware_bom_usd,
        "flows_total": n_flows,
        "flows_detected": sum(1 for f in flow_results if f["detected"]),
        "flows_tier_correct": sum(1 for f in flow_results if f["tier_ok"]),
        "critical_total": n_critical,
        "critical_severed": sum(1 for f in flow_results if f["critical_severed"]),
        "unsafe_passes": sum(1 for f in flow_results if f["unsafe_pass"]),
        "flow_results": flow_results,
    }


def pct(num: float, den: float) -> str:
    return "n/a" if den == 0 else f"{100.0 * num / den:.1f}%"
