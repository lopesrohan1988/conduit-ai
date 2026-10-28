"""The today-vs-proposed map is built from the run, not hand-drawn."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.agents.langgraph_workflow import build_conduit_langgraph, build_scenario_initial_state
from app.config import get_settings
from app.topology_view import build_topology_view


def _topology(scenario_id: str) -> dict[str, Any]:
    cfg = get_settings()
    graph, scratch = build_conduit_langgraph(settings=cfg, use_live_llm=False)
    state = asyncio.run(graph.ainvoke(build_scenario_initial_state(scenario_id, settings=cfg)))
    return build_topology_view(
        plan=state["architecture_plan"],
        switch_audit=scratch["switch_audit"],
        telemetry_audit=scratch["telemetry_audit"],
        cabinet_inspections=state.get("cabinet_inspections"),
    )


@pytest.mark.parametrize("scenario_id", ["scenario_2_substation", "scenario_4_water_treatment"])
def test_every_edge_connects_real_nodes_and_no_inbound_path_survives(scenario_id: str) -> None:
    topo = _topology(scenario_id)
    ids = {n["id"] for n in topo["nodes"]}
    assert any(n.get("isBoundaryNode") for n in topo["nodes"])
    assert all(e["source"] in ids and e["target"] in ids for e in topo["edges"])
    s = topo["summary"]
    assert s["it_to_ot_paths_today"] > 0
    assert s["it_to_ot_paths_after"] == 0
    assert s["feeds_kept"] > 0 and s["connections_cut"] > 0


def test_substation_breaker_command_from_it_is_cut() -> None:
    topo = _topology("scenario_2_substation")
    commands = [e for e in topo["edges"] if "sends commands" in e["beforeLabel"]]
    assert commands and all(e["afterLabel"] == "cut" for e in commands)
    assert topo["summary"]["command_paths_today"] >= 1


def test_water_plant_rogue_bypass_is_shown_and_cut() -> None:
    topo = _topology("scenario_4_water_treatment")
    rogue = [n for n in topo["nodes"] if n.get("isRogueBypass")]
    assert len(rogue) == 1
    bypass_edges = [e for e in topo["edges"] if e["directionBefore"] == "BYPASS_TO_OT"]
    assert bypass_edges and all(e["afterLabel"] == "cut" for e in bypass_edges)
    assert topo["summary"]["bypass_paths_today"] == 1
    assert topo["summary"]["rogue_modem_in_photo"] is True
    # Plant-internal traffic is drawn but never routed through the diode
    assert any(e["classification"] == "LOCAL" for e in topo["edges"])
