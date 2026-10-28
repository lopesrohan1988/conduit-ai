"""SAM 3.1 box geometry -> physical measurements, and the recorded-response cabinet pipeline."""

from __future__ import annotations

import asyncio

import pytest

from app.agents.sam_geometry import (
    Box,
    classify_enclosure,
    find_rogue_modems,
    measure_din_rail,
    measure_rack,
    track_boxes,
)
from app.agents.vision_sam31_agent import inspect_cabinet_photos
from app.clients.meta_models import MetaModelGateway
from app.config import get_settings


def test_rack_gap_counts_units_from_panel_width() -> None:
    # 19-inch panels 900 px wide -> 1U = 900 / 482.6 * 44.45 ~= 82.9 px
    devices = [Box(100, 0, 1000, 83), Box(100, 83, 1000, 166), Box(100, 166 + 2 * 83, 1000, 166 + 4 * 83)]
    rack = measure_rack(devices, 1200, 900)
    assert rack is not None
    assert rack.empty_1u_slots == 2
    assert rack.rack_unit_px == pytest.approx(82.9, abs=0.1)


def test_rack_ignores_narrow_boxes_and_needs_wide_gear() -> None:
    assert measure_rack([Box(10, 10, 80, 60)], 1200, 900) is None
    rack = measure_rack([Box(100, 0, 1000, 83), Box(500, 100, 560, 160), Box(100, 300, 1000, 383)], 1200, 900)
    assert rack is not None and rack.empty_1u_slots == 2


def test_sub_unit_gap_is_not_a_slot() -> None:
    rack = measure_rack([Box(100, 0, 1000, 83), Box(100, 83 + 40, 1000, 206)], 1200, 900)
    assert rack is not None and rack.empty_1u_slots == 0


def test_din_rail_length_scaled_by_35mm_height() -> None:
    din = measure_din_rail([Box(500, 300, 900, 340), Box(0, 0, 30, 300)], 1200, 900, None)
    # 400 px long at 40 px = 35 mm -> 350 mm; the vertical bar is rejected
    assert [round(mm) for _, mm in din.free_segments] == [350]
    outside = measure_din_rail([Box(500, 300, 900, 340)], 1200, 900, Box(0, 0, 400, 400))
    assert outside.free_segments == []


def test_modem_needs_an_enclosure_to_classify_a_photo() -> None:
    modems = find_rogue_modems([Box(700, 300, 800, 500)], [Box(720, 100, 740, 310), Box(770, 120, 790, 310)])
    assert modems[0][1] == 2
    empty = measure_din_rail([], 1200, 900, None)
    assert classify_enclosure(None, [], empty) is None
    assert classify_enclosure(None, [Box(0, 0, 1100, 880)], empty) == "INDUSTRIAL_DIN_RAIL_CABINET"


def test_tracker_links_moving_box_across_frames() -> None:
    frames = [[Box(100, 100, 200, 200)], [Box(130, 100, 230, 200)], [], [Box(600, 100, 700, 200)]]
    tracks = track_boxes(frames)
    assert sorted(len(t) for t in tracks) == [1, 2]


def test_recorded_sam_responses_measure_builtin_photos() -> None:
    cfg = get_settings()
    root = cfg.resolved_data_dir / "scenarios"
    photos = [
        root / "scenario_2_substation" / "server_rack_open_1u.jpg",
        root / "scenario_1_manufacturing" / "plc_cabinet_din_rail.jpg",
        root / "scenario_4_water_treatment" / "rogue_5g_modem_bypass.jpg",
        root / "scenario_5_oil_gas_pipeline" / "whiteboard_pipeline_topology.jpg",
    ]
    insps, mode = asyncio.run(
        inspect_cabinet_photos(photos, gateway=MetaModelGateway(cfg), use_live_llm=False)
    )
    assert mode == "recorded_sam31"
    by_name = {i.source_image: i for i in insps}
    assert "whiteboard_pipeline_topology.jpg" not in by_name
    assert by_name["server_rack_open_1u.jpg"].empty_1u_slots == 2
    assert by_name["plc_cabinet_din_rail.jpg"].din_rail_available_mm > 250
    rogue = by_name["rogue_5g_modem_bypass.jpg"]
    assert any(d.semantic_class == "ROGUE_CELLULAR_BYPASS_MODEM" for d in rogue.detections)
    assert not any(
        d.semantic_class == "ROGUE_CELLULAR_BYPASS_MODEM" for d in by_name["plc_cabinet_din_rail.jpg"].detections
    )
