"""End-to-End Integration & Benchmark Tests for ConduitAI Multi-Agent Pipeline & Exports."""

from __future__ import annotations

import io
import zipfile

import httpx
import pytest

from app.agents.switch_config_agent import parse_switch_cli_dump
from app.agents.telemetry_duckdb_agent import (
    dissect_pcap_file,
    run_telemetry_duckdb_agent,
)
from app.catalog_loader import load_benchmark_ground_truth
from app.config import get_settings
from app.main import app
from app.state import ConduitArchitecturePlan, ModalTwinVerificationResult


def test_six_vertical_benchmark_100pct_telemetry_and_shadow_accuracy() -> None:
    """Verify real Switch CLI + Scapy PCAP + DuckDB SQL parsers match 100% of ground truth."""
    cfg = get_settings()
    gt_scenarios = load_benchmark_ground_truth()["scenarios"]

    total_pkts = 0
    total_fw_rows = 0
    total_assets = 0
    total_shadows = 0

    for sc_id, sc in gt_scenarios.items():
        files = sc["files"]
        sw = parse_switch_cli_dump(
            cfg.resolved_data_dir / files["switch_dump"],
            cfg.resolved_data_dir / files["asset_inventory_csv"],
        )
        tel = run_telemetry_duckdb_agent(
            cfg.resolved_data_dir / files["pcap"],
            cfg.resolved_data_dir / files["firewall_csv"],
        )

        assert sw.total_discovered_assets == sc["total_discovered_assets"], sc_id
        assert len(sw.shadow_anomalies) == len(sc["undocumented_shadow_assets"]), sc_id
        assert tel.pcap_packet_count == sc["telemetry_metrics"]["pcap_packet_count"], sc_id
        assert tel.firewall_row_count == sc["telemetry_metrics"]["firewall_row_count"], sc_id
        assert tel.peak_bandwidth_mbps == pytest.approx(
            sc["telemetry_metrics"]["peak_bandwidth_mbps"], abs=0.2
        ), sc_id
        assert tel.sized_bandwidth_with_1_25x_headroom_mbps == pytest.approx(
            sc["telemetry_metrics"]["sized_bandwidth_with_1_25x_headroom_mbps"], abs=0.25
        ), sc_id

        total_pkts += tel.pcap_packet_count
        total_fw_rows += tel.firewall_row_count
        total_assets += sw.total_discovered_assets
        total_shadows += len(sw.shadow_anomalies)

    assert total_pkts == 183000
    assert total_fw_rows == 120000
    assert total_assets == 264
    assert total_shadows == 13


def test_real_cisa_and_iti_ics_pcaps_dissect_cleanly() -> None:
    """Verify binary L7 dissector parses real public CISA/ITI/DigitalBond ICS captures."""
    cfg = get_settings()
    pcap_dir = cfg.real_ics_captures_dir
    for fname in (
        "modbus_digitalbond_quickdraw_plc.pcap",
        "dnp3_substation_relay_cisa.pcap",
        "iec104_substation_rtu_polling.pcap",
        "opcua_binary_session_handshake_cisa.pcap",
        "iec61850_substation_mms_and_goose.pcap",
    ):
        pkt_cnt, byte_cnt, flows = dissect_pcap_file(pcap_dir / fname)
        assert pkt_cnt > 0, fname
        assert byte_cnt > 0, fname
        assert len(flows) >= 1, fname


@pytest.mark.asyncio
async def test_deliverable_exports_drawio_pdf_and_zip() -> None:
    """Verify `.drawio` XML, ReportLab `.pdf`, and `.zip` cutover bundle endpoints."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as client:
        # 1. drawio XML
        r_xml = await client.get(
            "/api/v1/assessments/scenario_1_manufacturing/export/drawio"
        )
        assert r_xml.status_code == 200
        assert "<mxfile" in r_xml.text
        assert "ARCH_C_ENTERPRISE_1U_DIODE" in r_xml.text

        # 2. ReportLab PDF
        r_pdf = await client.get(
            "/api/v1/assessments/scenario_4_water_treatment/export/pdf"
        )
        assert r_pdf.status_code == 200
        assert r_pdf.headers["content-type"] == "application/pdf"
        assert r_pdf.content.startswith(b"%PDF-")
        assert len(r_pdf.content) > 1500

        # 3. Cutover ZIP bundle
        r_zip = await client.get(
            "/api/v1/assessments/scenario_6_pharma_cleanroom/export/zip"
        )
        assert r_zip.status_code == 200
        with zipfile.ZipFile(io.BytesIO(r_zip.content), "r") as zf:
            names = set(zf.namelist())
            assert {
                "01_switch_vlan_port_security_cutover.ios.conf",
                "02_diode_tx_inner_poller.json",
                "03_diode_rx_outer_replica.json",
                "04_architecture_plan.json",
                "05_digital_twin_verification.log",
                "06_target_purdue_conduit.drawio",
            }.issubset(names)


@pytest.mark.asyncio
async def test_custom_multipart_site_upload_pipeline() -> None:
    """Verify `POST /api/v1/assessments/custom/analyze` runs full LangGraph + Twin on uploaded files."""
    cfg = get_settings()
    sc4 = cfg.scenarios_dir / "scenario_4_water_treatment"
    pcap_bytes = (sc4 / "boundary_capture.pcap").read_bytes()
    sw_bytes = (sc4 / "stratix_water_switch_dump.txt").read_bytes()
    inv_bytes = (sc4 / "asset_inventory.csv").read_bytes()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as client:
        resp = await client.post(
            "/api/v1/assessments/custom/analyze?facility_name=CustomWaterPlant&live_llm=false",
            files={
                "pcap_file": ("boundary_capture.pcap", pcap_bytes, "application/octet-stream"),
                "switch_dump_file": ("stratix.txt", sw_bytes, "text/plain"),
                "asset_inventory_file": ("asset_inventory.csv", inv_bytes, "text/csv"),
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        plan = ConduitArchitecturePlan.model_validate(body["architecture_plan"])
        twin = ModalTwinVerificationResult.model_validate(body["twin_verification"])
        assert plan.executive_summary.facility_name == "CustomWaterPlant"
        assert plan.executive_summary.total_discovered_assets == 38
        assert plan.executive_summary.undocumented_shadow_asset_count == 2
        assert twin.overall_verdict == "VERIFIED_ZERO_DOWNTIME_LOCKDOWN"
        assert twin.inbound_exploit_block_rate_pct == 100.0
        assert "configure terminal" in body["switch_cutover_cli"]


@pytest.mark.asyncio
async def test_on_demand_digital_twin_verify_endpoint() -> None:
    """Verify `POST /api/v1/twin/verify` executes kernel `os.pipe()` + TCP socket replay."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as client:
        resp = await client.post(
            "/api/v1/twin/verify",
            json={"scenario_id": "scenario_2_substation", "use_modal_cloud": False},
        )
        assert resp.status_code == 200
        twin = ModalTwinVerificationResult.model_validate(resp.json())
        assert twin.overall_verdict == "VERIFIED_ZERO_DOWNTIME_LOCKDOWN"
        assert twin.telemetry_continuity_pct == 100.0
        assert twin.inbound_exploit_block_rate_pct == 100.0
        assert "rejected by OS kernel" in twin.sandbox_stdout_log


@pytest.mark.asyncio
async def test_live_meta_api_sse_and_rack_card_smoke() -> None:
    """Smoke-test live Meta API (`sam-3.1`, `muse-spark-1.3`, `muse-wonder-1.0`, `muse-image-1.0`) when configured."""
    cfg = get_settings()
    if not cfg.meta_api_configured:
        pytest.skip("META_MODEL_API_KEY not configured")

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver", timeout=90.0
    ) as client:
        # 1. Live SSE assessment with `live_llm=true`
        r_sse = await client.get(
            "/api/v1/assessments/scenario_4_water_treatment/stream",
            params={"inference_mode": "cloud_meta_api", "step_delay_ms": 0, "live_llm": "true"},
        )
        assert r_sse.status_code == 200
        assert "live_sam31" in r_sse.text
        assert '"done": true' in r_sse.text.lower()

        # 2. Live `muse-image-1.0` rack card generation
        r_card = await client.post(
            "/api/v1/visuals/rack-card",
            json={"scenario_id": "scenario_1_manufacturing"},
        )
        assert r_card.status_code == 200
        card_data = r_card.json()
        assert card_data["model"] == "muse-image-1.0"
        assert card_data["image_url"]

