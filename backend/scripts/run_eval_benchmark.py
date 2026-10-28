"""Reproducible Multi-Vertical OT & Real ICS PCAP Benchmark Evaluator for ConduitAI.

For each of the 6 vertical scenarios, runs the real LangGraph pipeline on the raw artifacts
(switch dumps, SPAN pcaps, firewall CSVs, cabinet photos, videos, field notes) and scores the
resulting plan against `benchmark_ground_truth.json`. Ground truth is read only by the scorer.

Architect variants, scored on identical perception outputs:
- `rules`: deterministic rule engine only (default, no API calls).
- `muse_wonder+verifier` (`--live`): Muse Wonder proposes, the deterministic verifier must
  accept; rejected proposals are revised, and unrecoverable ones fall back to the rules.

Also dissects the 15 real public ICS captures and reports how many yield Layer-7 decodes.

Usage:
    cd backend
    uv run python scripts/run_eval_benchmark.py          # rules only
    uv run python scripts/run_eval_benchmark.py --live   # + Muse Wonder / verifier
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.agents.architect_sizing_agent import run_architect_sizing_agent  # noqa: E402
from app.agents.langgraph_workflow import (  # noqa: E402
    build_conduit_langgraph,
    build_scenario_initial_state,
)
from app.agents.telemetry_duckdb_agent import dissect_pcap_file  # noqa: E402
from app.catalog_loader import list_real_ics_captures, load_benchmark_ground_truth  # noqa: E402
from app.clients.meta_models import MetaModelGateway  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.evaluation import pct, score_scenario  # noqa: E402

RULES = "rules"
LIVE = "muse_wonder+verifier"


async def _run_scenario(sc_id: str, gateway: MetaModelGateway, live: bool) -> dict[str, Any]:
    graph, scratch = build_conduit_langgraph(gateway=gateway, use_live_llm=False)
    t0 = time.perf_counter()
    state = await graph.ainvoke(build_scenario_initial_state(sc_id))
    out: dict[str, Any] = {
        "state": state,
        "scratch": scratch,
        "plans": {RULES: state["architecture_plan"]},
        "runtime_ms": {RULES: round((time.perf_counter() - t0) * 1000.0, 1)},
        "traces": {},
    }
    if live:
        t1 = time.perf_counter()
        plan, meta = await run_architect_sizing_agent(
            scenario_id=sc_id,
            facility_name=state["facility_name"],
            inference_mode="cloud_meta_api",
            switch_audit=scratch["switch_audit"],
            telemetry_audit=scratch["telemetry_audit"],
            cabinet_inspections=state.get("cabinet_inspections") or [],
            video_walkthrough=state.get("video_walkthrough_result"),
            voice_transcript=state.get("voice_transcript"),
            gateway=gateway,
            use_live_llm=True,
        )
        out["plans"][LIVE] = plan
        out["runtime_ms"][LIVE] = round((time.perf_counter() - t1) * 1000.0, 1)
        out["traces"][LIVE] = meta.get("planner_trace") or {}
    return out


def _summary_rows(scores: dict[str, list[dict[str, Any]]], variants: list[str]) -> list[str]:
    def agg(v: str, key: str) -> int:
        return sum(int(s[key]) for s in scores[v])

    def row(label: str, fn) -> str:
        return f"| {label} | " + " | ".join(fn(v) for v in variants) + " |"

    n = len(scores[variants[0]])
    lines = [
        "| Metric | " + " | ".join(f"`{v}`" for v in variants) + " |",
        "| :--- |" + " :--- |" * len(variants),
        row(
            "Asset count exact (switch CLI + OUI)",
            lambda v: f"{sum(s['assets_detected'] == s['assets_expected'] for s in scores[v])}/{n} scenarios",
        ),
        row(
            "Shadow / rogue asset recall",
            lambda v: f"{agg(v, 'shadow_true_positive')}/{agg(v, 'shadow_expected')} ({pct(agg(v, 'shadow_true_positive'), agg(v, 'shadow_expected'))})",
        ),
        row(
            "Shadow / rogue asset precision",
            lambda v: f"{agg(v, 'shadow_true_positive')}/{agg(v, 'shadow_detected')} ({pct(agg(v, 'shadow_true_positive'), agg(v, 'shadow_detected'))})",
        ),
        row("Peak Mbps within 0.5%", lambda v: f"{agg(v, 'peak_ok')}/{n} scenarios"),
        row(
            "Hardware BoM exact (archetypes + qty; accepted alternatives allowed)",
            lambda v: f"**{agg(v, 'bom_exact')}/{n}**",
        ),
        row("Archetype set matches primary design", lambda v: f"{agg(v, 'archetypes_match')}/{n}"),
        row(
            "Ground-truth flows detected",
            lambda v: f"{agg(v, 'flows_detected')}/{agg(v, 'flows_total')} ({pct(agg(v, 'flows_detected'), agg(v, 'flows_total'))})",
        ),
        row(
            "Flow Green/Amber/Red tier correct",
            lambda v: f"**{agg(v, 'flows_tier_correct')}/{agg(v, 'flows_total')} ({pct(agg(v, 'flows_tier_correct'), agg(v, 'flows_total'))})**",
        ),
        row(
            "Critical violations severed at L1",
            lambda v: f"{agg(v, 'critical_severed')}/{agg(v, 'critical_total')} ({pct(agg(v, 'critical_severed'), agg(v, 'critical_total'))})",
        ),
        row("Unsafe passes (must-block flow graded GREEN) — lower is better", lambda v: str(agg(v, "unsafe_passes"))),
    ]
    return lines


def run_benchmark(live: bool) -> str:
    started = time.perf_counter()
    cfg = get_settings()
    gateway = MetaModelGateway(settings=cfg)
    gt_scenarios: dict[str, dict[str, Any]] = load_benchmark_ground_truth()["scenarios"]
    variants = [RULES, LIVE] if live else [RULES]

    scores: dict[str, list[dict[str, Any]]] = {v: [] for v in variants}
    per_scenario: list[dict[str, Any]] = []
    totals = {"packets": 0, "fw_rows": 0}

    for sc_id, sc in gt_scenarios.items():
        print(f"[bench] {sc_id} ...", flush=True)
        run = asyncio.run(_run_scenario(sc_id, gateway, live))
        sw, tel = run["scratch"]["switch_audit"], run["scratch"]["telemetry_audit"]
        totals["packets"] += tel.pcap_packet_count
        totals["fw_rows"] += tel.firewall_row_count
        entry: dict[str, Any] = {"scenario_id": sc_id, "facility": sc["facility_name"], "variants": {}}
        for v in variants:
            s = score_scenario(sc, run["plans"][v], sw, tel)
            s["runtime_ms"] = run["runtime_ms"][v]
            s["trace"] = run["traces"].get(v)
            scores[v].append(s)
            entry["variants"][v] = s
        per_scenario.append(entry)

    # Real public ICS captures — "decoded" means at least one Layer-7 signature was extracted
    pcap_rows: list[dict[str, Any]] = []
    for cap in list_real_ics_captures():
        fname = str(cap["filename"])
        t_p0 = time.perf_counter()
        pkt_cnt, byte_cnt, flows = dissect_pcap_file(cfg.real_ics_captures_dir / fname)
        p_ms = round((time.perf_counter() - t_p0) * 1000.0, 2)
        sigs: set[str] = set()
        for fmeta in flows.values():
            sigs.update(str(x) for x in (fmeta.get("fcs") or set()))
        pcap_rows.append(
            {
                "filename": fname,
                "family": cap.get("protocol_family", ""),
                "source": cap.get("source_repo", ""),
                "packets": pkt_cnt,
                "flows": len(flows),
                "l7": ", ".join(sorted(sigs)[:3]) if sigs else "— (transport only)",
                "decoded": bool(sigs),
                "ms": p_ms,
            }
        )

    total_sec = round(time.perf_counter() - started, 2)
    decoded = sum(r["decoded"] for r in pcap_rows)

    lines: list[str] = [
        "# ConduitAI — Reproducible Benchmark Scorecard",
        "",
        f"> **Generated by:** `cd backend && uv run python scripts/run_eval_benchmark.py{' --live' if live else ''}`  ",
        f"> **Runtime:** `{total_sec}s` · **Architect variants:** {', '.join(f'`{v}`' for v in variants)}",
        "",
        "Every plan below is produced by the pipeline from the scenario's raw artifacts. "
        "`benchmark_ground_truth.json` is read only by the scorer (`app/evaluation.py`). "
        "Both architect variants see identical perception outputs (switch, telemetry, vision, voice), "
        "so differences isolate the architect.",
        "",
        "## 1. Aggregate Accuracy",
        "",
        *_summary_rows(scores, variants),
        "",
        f"Corpus processed: `{totals['packets']:,}` SPAN packets and `{totals['fw_rows']:,}` firewall rows across 6 verticals.",
        "",
    ]

    if live:
        traces = [s["trace"] or {} for s in scores[LIVE]]
        accepted = sum(1 for t in traces if t.get("accepted"))
        attempts = [t.get("attempt_count", 0) for t in traces if t.get("accepted")]
        rejected_total = sum(
            1 for t in traces for a in t.get("attempts", []) if a.get("violations")
        )
        lines += [
            "### Muse Wonder propose → verify loop",
            "",
            f"- Proposals accepted by the verifier: **{accepted}/{len(traces)}** scenarios"
            + (f" (mean {sum(attempts) / len(attempts):.1f} attempts)" if attempts else ""),
            f"- Proposals rejected and sent back for revision: **{rejected_total}**",
            "",
        ]

    lines += [
        "## 2. Per-Scenario Results",
        "",
        "| Scenario | Variant | Assets | Shadow TP | Peak (det / GT) | BoM | Exact | Tier correct | Critical severed | Unsafe | Architect ms |",
        "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
    ]
    for e in per_scenario:
        for v, s in e["variants"].items():
            bom = " + ".join(f"{q}x {a}" for a, q in s["bom_detected"])
            lines.append(
                f"| `{e['scenario_id']}` | `{v}` | {s['assets_detected']}/{s['assets_expected']} | "
                f"{s['shadow_true_positive']}/{s['shadow_expected']} | "
                f"{s['peak_detected_mbps']:.1f} / {s['peak_expected_mbps']:.1f} | `{bom}` | "
                f"{'✅' if s['bom_exact'] else '❌'} | {s['flows_tier_correct']}/{s['flows_total']} | "
                f"{s['critical_severed']}/{s['critical_total']} | {s['unsafe_passes']} | {s['runtime_ms']} |"
            )

    lines += ["", "## 3. Flow-Level Misses", ""]
    for e in per_scenario:
        for v, s in e["variants"].items():
            misses = [f for f in s["flow_results"] if not f["tier_ok"] or (f["critical"] and not f["critical_severed"])]
            if not misses:
                continue
            lines.append(f"**`{e['scenario_id']}` · `{v}`**")
            for f in misses:
                why = (
                    "not detected in telemetry"
                    if not f["detected"]
                    else f"graded {'/'.join(f['observed_tiers'])}, expected {f['expected_tier']}"
                    + (" (critical not severed)" if f["critical"] and not f["critical_severed"] else "")
                )
                lines.append(f"- `{f['flow_id']}` {f['protocol']}: {why}")
            lines.append("")

    if live:
        lines += ["## 4. Verifier Rejections (what the model got wrong before revising)", ""]
        rejection_lines = [
            f"- `{e['scenario_id']}` attempt {a['attempt']}: " + "; ".join(a["violations"][:4])
            for e in per_scenario
            for a in (e["variants"][LIVE]["trace"] or {}).get("attempts", [])
            if a.get("violations")
        ]
        lines += rejection_lines or ["None — every first proposal passed all verifier rules."]
        lines.append("")

    lines += [
        f"## {5 if live else 4}. Real Public ICS Captures ({decoded}/{len(pcap_rows)} with Layer-7 decodes)",
        "",
        "| Capture | Protocol Family | Source | Packets | Flows | Layer-7 Signatures | Time |",
        "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
    ]
    for r in pcap_rows:
        lines.append(
            f"| `{r['filename']}` | {r['family']} | {r['source']} | `{r['packets']:,}` | `{r['flows']}` | "
            f"{r['l7']} | `{r['ms']}ms` |"
        )

    lines += [
        "",
        "## Caveats",
        "",
        "- The six vertical scenarios are synthetic and were authored alongside the parsers; treat "
        "perception scores (assets, shadows, peak) as regression tests, not generalisation evidence.",
        "- The kernel `os.pipe()` twin is a mechanism demo and is not counted as an accuracy metric.",
        "- Live results vary run to run; re-run with `--live` to reproduce.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="also score the Muse Wonder + verifier architect")
    args = parser.parse_args()
    markdown = run_benchmark(live=args.live)
    out_path = BACKEND_ROOT.parent / "docs" / "BENCHMARK_SCORECARD.md"
    out_path.write_text(markdown, encoding="utf-8")
    print(f"Wrote benchmark scorecard to: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
