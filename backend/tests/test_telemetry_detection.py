"""Flow-detection behaviour: fan-out collapsing, lateral-movement flagging, zone-aware direction."""

from __future__ import annotations

from typing import Any

from app.agents.switch_config_agent import parse_switch_cli_dump
from app.agents.telemetry_duckdb_agent import (
    _classify_flow_tier,
    _collapse_fan_out,
    _determine_flow_direction,
    run_telemetry_duckdb_agent,
    zone_map_from_assets,
)
from app.config import get_settings
from app.state import AssetNode


def _item(src: str, dst: str, port: int, **kw: Any) -> dict[str, Any]:
    base = {
        "src_ip": src,
        "dst_ip": dst,
        "dst_port": port,
        "transport": "TCP",
        "protocol": f"TCP/{port}",
        "fcs": [],
        "has_write": False,
        "ephemeral_dcom": False,
        "packet_count": 10,
        "bytes": 1000,
        "peak_mbps": 1.0,
        "fw_note": "",
        "direction": "OT_TO_IT",
        "lateral": False,
    }
    return {**base, **kw}


def test_fan_in_collapses_but_keeps_other_subnets_and_writes_apart() -> None:
    cams = [_item(f"172.16.40.{i}", "10.80.10.20", 554) for i in range(10, 58)]
    rogue = _item("172.16.99.5", "10.80.10.20", 554)
    write = _item("172.16.40.10", "10.80.10.20", 554, has_write=True)
    rows = _collapse_fan_out([*cams, rogue, write])
    assert len(rows) == 3
    merged = next(r for r in rows if r.get("peer_summary"))
    assert merged["bytes"] == 48 * 1000
    assert merged["peer_summary"].startswith("48 sources")


def test_lateral_flag_survives_only_when_whole_group_is_lateral() -> None:
    cams = [_item(f"172.16.40.{i}", "10.80.10.20", 554) for i in range(10, 14)]
    cams[0]["lateral"] = True  # the scanner's own RTSP stream is normal peer behaviour
    probes = [_item("172.16.40.10", f"10.80.20.{i}", 445, lateral=True) for i in range(1, 5)]
    rows = _collapse_fan_out([*cams, *probes])
    by_port = {r["dst_port"]: r for r in rows}
    assert by_port[554]["lateral"] is False
    assert by_port[445]["lateral"] is True


def test_zone_map_drives_direction_over_static_prefixes() -> None:
    assets = [
        AssetNode(asset_id="a", ip_address="10.120.10.20", purdue_level="L4"),
        AssetNode(asset_id="b", ip_address="10.185.30.11", purdue_level="L1"),
        AssetNode(asset_id="c", ip_address="10.185.30.1", purdue_level="L3.5"),
    ]
    zones = zone_map_from_assets(assets)
    assert zones == {"10.120.10": "IT", "10.185.30": "OT"}
    assert _determine_flow_direction("10.120.10.20", "10.185.30.11", zones) == "IT_TO_OT"
    assert _determine_flow_direction("10.185.30.11", "10.120.10.20", zones) == "OT_TO_IT"


def test_inbound_ssh_is_red_even_when_labelled_sftp() -> None:
    common = dict(dst_port=22, protocol_label="SSH / SFTP", has_write_ops=False, uses_ephemeral_dcom=False)
    assert _classify_flow_tier(src_ip="10.1.1.1", dst_ip="10.2.2.2", direction="IT_TO_OT", **common) == "RED"
    assert _classify_flow_tier(src_ip="10.2.2.2", dst_ip="10.1.1.1", direction="OT_TO_IT", **common) == "GREEN"


def test_smart_building_camera_pivot_is_detected_and_streams_collapsed() -> None:
    cfg = get_settings()
    sc = cfg.resolved_data_dir / "scenarios" / "scenario_3_smart_building"
    sw = parse_switch_cli_dump(sc / "aruba_switch_dump.txt", sc / "asset_inventory.csv")
    tel = run_telemetry_duckdb_agent(
        sc / "boundary_capture.pcap",
        sc / "fortigate_traffic_24h.csv",
        zone_map=zone_map_from_assets(sw.assets),
    )
    lateral = [f for f in tel.flows if f.lateral_movement_suspected]
    assert lateral and all(f.src_ip == "172.16.40.33" and f.preliminary_tier == "RED" for f in lateral)
    assert {445, 22} <= {f.dst_port for f in lateral}
    rtsp = [f for f in tel.flows if f.dst_port == 554]
    assert len(rtsp) == 1 and not rtsp[0].lateral_movement_suspected
    assert {47808, 1883} <= {f.dst_port for f in tel.flows}
