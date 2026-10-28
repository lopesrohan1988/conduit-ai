"""Flow-detection behaviour: fan-out collapsing, lateral-movement flagging, zone-aware direction."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.agents.telemetry_duckdb_agent import (
    _classify_flow_tier,
    _collapse_fan_out,
    _determine_flow_direction,
    run_telemetry_duckdb_agent,
    zone_map_from_assets,
)
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


def _fortigate_csv(tmp_path: Path, rows: list[tuple[str, str, int, str]]) -> Path:
    lines = ["srcip,dstip,dstport,proto,service,policyname,sentbyte,rcvdbyte,duration_sec"]
    lines += [f"{src},{dst},{port},6,{svc},TEST,5000,500,10" for src, dst, port, svc in rows]
    path = tmp_path / "fortigate_traffic_24h.csv"
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def test_camera_pivot_is_flagged_and_camera_streams_collapse(tmp_path: Path) -> None:
    cams = [(f"172.16.40.{i}", "10.80.10.20", 554, "RTSP") for i in range(10, 16)]
    pivot = [
        ("172.16.40.13", dst, port, svc)
        for dst in ("10.80.10.20", "10.80.10.25", "10.80.20.15", "172.16.30.10")
        for port, svc in ((445, "SMB"), (502, "MODBUS"), (22, "SSH"))
    ]
    tel = run_telemetry_duckdb_agent(None, _fortigate_csv(tmp_path, cams + pivot))
    lateral = [f for f in tel.flows if f.lateral_movement_suspected]
    assert lateral and all(f.src_ip == "172.16.40.13" and f.preliminary_tier == "RED" for f in lateral)
    assert {445, 502, 22} == {f.dst_port for f in lateral}
    # The scanning camera's own RTSP stream is normal peer behaviour and merges with the other cameras
    rtsp = [f for f in tel.flows if f.dst_port == 554]
    assert len(rtsp) == 1 and not rtsp[0].lateral_movement_suspected
