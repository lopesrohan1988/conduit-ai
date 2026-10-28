"""Real command frames replayed against today's network and the proposed plan; the check can fail."""

from __future__ import annotations

import asyncio
from typing import Any

from app.agents.langgraph_workflow import build_conduit_langgraph, build_scenario_initial_state
from app.attack_replay import load_command_library, replay_attacks
from app.config import get_settings


def _run(scenario_id: str) -> tuple[Any, dict[str, Any]]:
    cfg = get_settings()
    graph, scratch = build_conduit_langgraph(settings=cfg, use_live_llm=False)
    state = asyncio.run(graph.ainvoke(build_scenario_initial_state(scenario_id, settings=cfg)))
    return state["architecture_plan"], scratch


def test_library_holds_real_decoded_command_frames() -> None:
    lib = load_command_library()
    labels = {f.label for frames in lib.values() for f in frames}
    assert any("TypeID 45" in label for label in labels)  # IEC-104 breaker command
    assert any("Operate" in label for label in labels)  # DNP3 operate
    assert any(label.startswith("FC 0") or label.startswith("FC 1") for label in labels)  # Modbus write
    assert all(f.payload and f.source_capture for frames in lib.values() for f in frames)


def test_substation_breaker_commands_reach_plant_today_but_not_after_cutover() -> None:
    plan, scratch = _run("scenario_2_substation")
    r = replay_attacks(plan=plan, telemetry_audit=scratch["telemetry_audit"], switch_audit=scratch["switch_audit"])
    assert r["today"]["reached_plant"] == r["today"]["attempts"] > 0
    assert r["proposed"]["reached_plant"] == 0
    assert r["real_command_frames"] > 0
    assert r["feeds_kept"] > 0


def test_plan_that_leaves_the_bypass_in_place_fails_the_replay() -> None:
    plan, scratch = _run("scenario_4_water_treatment")
    bypass_rows = {
        f.flow_id for f in scratch["telemetry_audit"].flows if f.direction == "BYPASS_TO_OT"
    }
    assert bypass_rows
    weakened = plan.model_copy(deep=True)
    for row in weakened.protocol_cutover_matrix:
        if row.flow_id in bypass_rows:
            row.cutover_action_type = "PULL_TO_PUSH_PROXY_REVERSAL"
    r = replay_attacks(plan=weakened, telemetry_audit=scratch["telemetry_audit"], switch_audit=scratch["switch_audit"])
    assert r["proposed"]["reached_plant"] > 0
    assert any("left in place" in p["proposed_outcome"] for p in r["paths"])
