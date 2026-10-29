"""SAM 3.1 + Muse Spark reading of the customer's network drawing, compared with the network."""

from __future__ import annotations

import asyncio

from app.agents.switch_config_agent import SwitchAuditResult
from app.agents.telemetry_duckdb_agent import TelemetryAuditResult
from app.agents.vision_sam31_agent import inspect_network_diagram, reconcile_diagram
from app.clients.meta_models import MetaModelGateway
from app.config import get_settings
from app.state import AssetNode


def _water_reading() -> dict:
    path = get_settings().resolved_data_dir / "scenarios" / "scenario_4_water_treatment" / "water_treatment_blueprint_diagram.png"
    seg, mode, reading = asyncio.run(inspect_network_diagram(path, gateway=MetaModelGateway(), use_live_llm=False))
    assert mode == "recorded_sam31" and reading["read_source_mode"] == "recorded_muse_spark"
    assert any(n.semantic_class == "FIREWALL" for n in seg.detected_diagram_nodes)
    return reading


def test_drawing_is_read_from_recorded_model_output() -> None:
    reading = _water_reading()
    by_host = {g["hostname"]: g for g in reading["regions"] if g["hostname"]}
    # Ranges written as ".21-24" are expanded by the reader
    assert by_host["PLC-NAOCL-CHLORINE01"]["ips"] == [f"192.168.25.{i}" for i in range(21, 25)]
    assert by_host["FG100F-WATER-PERIM"]["kind"] == "firewall"


def test_reconcile_flags_hosts_missing_from_the_drawing() -> None:
    reading = _water_reading()
    switch = SwitchAuditResult(
        assets=[
            AssetNode(asset_id="A1", ip_address="192.168.25.21"),
            AssetNode(asset_id="A2", ip_address="192.168.25.254", is_dual_homed_bypass=True),
            AssetNode(asset_id="A3", ip_address="172.16.9.9"),  # subnet not on the drawing
        ]
    )
    rec = reconcile_diagram(reading, switch, TelemetryAuditResult())
    assert rec["drawn_seen"] == 1
    assert rec["drawn_not_seen"] == rec["drawn_devices"] - 1
    assert rec["missing_from_drawing"] == [
        {"ip": "192.168.25.254", "hostname": None, "vendor": "Unknown", "undocumented": True}
    ]
