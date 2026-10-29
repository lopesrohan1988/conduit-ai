"""The real-traffic plant (UOWM IEC-104 dataset) and the detection rules it relies on."""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

from app.agents.switch_config_agent import SwitchAuditResult, discover_assets_from_pcap, parse_switch_cli_dump
from app.agents.telemetry_duckdb_agent import TelemetryAuditResult, run_telemetry_duckdb_agent, zone_map_from_assets
from app.clients.meta_models import MetaModelGateway
from app.config import get_settings
from app.evaluation import score_scenario
from app.state import ProtocolCutoverRow

PLANT = get_settings().resolved_data_dir / "scenarios" / "scenario_5_uowm_iec104"
ATTACKERS = {"192.168.1.27", "192.168.1.28", "192.168.1.29"}


def test_hosts_are_discovered_from_the_capture_without_a_switch_dump() -> None:
    sw = discover_assets_from_pcap(PLANT / "rtu_span_capture.pcap", PLANT / "asset_inventory.csv")
    assert sw.total_discovered_assets == 11
    undocumented = {ip for a in sw.shadow_anomalies for ip in a.ip_addresses}
    # Two RTUs the dataset's figure draws without addresses, and the three attack machines
    assert undocumented == {"192.168.1.19", "192.168.1.22", *ATTACKERS}


def test_flat_network_zones_and_undocumented_command_senders() -> None:
    sw = discover_assets_from_pcap(PLANT / "rtu_span_capture.pcap", PLANT / "asset_inventory.csv")
    zones = zone_map_from_assets(sw.assets)
    assert zones["192.168.1.20"] == "IT"  # the control centre master, outside the plant boundary
    assert zones["192.168.1.21"] == "OT"
    tel = run_telemetry_duckdb_agent(PLANT / "rtu_span_capture.pcap", None, zone_map=zones)
    by_src = {f.src_ip: f for f in tel.flows}
    assert by_src["192.168.1.20"].direction == "IT_TO_OT"
    # Undocumented hosts inside the plant that send commands skip the boundary entirely
    assert {ip for ip, f in by_src.items() if f.direction == "BYPASS_TO_OT"} == ATTACKERS
    assert all(by_src[ip].has_write_operations for ip in ATTACKERS)
    # No firewall log: the peak comes from the capture's busiest second
    assert 0 < tel.peak_bandwidth_mbps < 1


def test_cellular_router_is_recognised_from_its_lldp_name(tmp_path: Path) -> None:
    dump = tmp_path / "switch.txt"
    dump.write_text(
        "CORE# show ip arp\n"
        "Internet  192.168.25.30   1   0050.5660.0030  ARPA   Vlan25\n"
        "Internet  192.168.25.77   2   0090.e899.8877  ARPA   Vlan25\n"
        "CORE# show lldp neighbors detail\n"
        "Chassis id: 00:90:E8:99:88:77 | Local Intf: Fa1/24 | SysName: OnCell-G4302-LTE4 | IP: 192.168.25.77\n",
        encoding="utf-8",
    )
    inventory = tmp_path / "inventory.csv"
    inventory.write_text("asset_id,hostname,ip_address,purdue_level\nA1,hmi,192.168.25.30,L2\n", encoding="utf-8")
    sw = parse_switch_cli_dump(dump, inventory)
    assert [(a.anomaly_type, a.ip_addresses) for a in sw.shadow_anomalies] == [("ROGUE_IT_BRIDGE", ["192.168.25.77"])]


def test_a_site_without_a_voice_note_gets_no_borrowed_observations() -> None:
    transcript = asyncio.run(MetaModelGateway().transcribe_muse_voice(scenario_id="scenario_5_uowm_iec104"))
    assert transcript.source_mode == "not_supplied"
    assert transcript.structured_observations == []


def _row(fid: str, src: str, dst: str, action: str, tier: str = "RED") -> ProtocolCutoverRow:
    return ProtocolCutoverRow(
        flow_id=fid, observed_src_ip=src, observed_dst_ip=dst, port=2404, protocol="IEC-104",
        observed_initiator="IT_TO_OT", function_code_detail="", cutover_tier=tier,
        cutover_action_type=action, engineering_prescription="",
    )


def test_a_kept_flow_is_judged_only_by_its_own_source() -> None:
    gt = {
        "total_discovered_assets": 0,
        "telemetry_metrics": {"peak_bandwidth_mbps": None},
        "expected_hardware_bom": None,
        "flow_classifications": [
            {"flow_id": "K", "src_ip": "192.168.1.20", "dst_ip": "192.168.1.21", "dst_port": 2404, "protocol": "IEC_104", "classification": "KEEP"},
            {"flow_id": "A", "src_ip": "192.168.1.28", "dst_ip": "192.168.1.21", "dst_port": 2404, "protocol": "IEC_104", "classification": "CRITICAL_VIOLATION"},
        ],
    }

    def score(hmi_action: str) -> dict[str, bool]:
        plan = SimpleNamespace(
            bill_of_materials=[],
            executive_summary=SimpleNamespace(estimated_hardware_bom_usd=0),
            protocol_cutover_matrix=[
                _row("F1", "192.168.1.20", "192.168.1.21", hmi_action),
                _row("F2", "192.168.1.28", "192.168.1.21", "SEVER_CRITICAL_VIOLATION_AT_L1"),
            ],
        )
        res = score_scenario(gt, plan, SwitchAuditResult(), TelemetryAuditResult())  # type: ignore[arg-type]
        return {f["flow_id"]: f["tier_ok"] for f in res["flow_results"]}

    # Cutting the attacker that hits the same RTU must not count against the control centre
    assert score("ROUTE_VIA_ARCH_D_OT_LOCKED_GATEWAY")["K"] is True
    assert score("SEVER_CRITICAL_VIOLATION_AT_L1")["K"] is False
