"""Server-side generators for `.drawio` Purdue Topology, ReportLab Compliance `.pdf`, and `.zip` Cutover Kit."""

from __future__ import annotations

import html
import io
import json
import zipfile

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.agents.architect_sizing_agent import generate_switch_cutover_cli
from app.state import ConduitArchitecturePlan, ModalTwinVerificationResult


def export_drawio_xml(plan: ConduitArchitecturePlan) -> str:
    """Generate a valid diagrams.net `.drawio` XML diagram of the Target IEC 62443 Conduit."""
    fac = html.escape(plan.executive_summary.facility_name)
    sl = html.escape(plan.executive_summary.target_security_posture_sl)
    sizing = plan.conduit_sizing_recommendations[0]
    arch = html.escape(
        f"{sizing.quantity}x {sizing.recommended_archetype_id} ({sizing.mounting_selection})"
    )
    ot_zone = plan.reconciled_zones[0] if plan.reconciled_zones else None
    it_zone = plan.reconciled_zones[-1] if len(plan.reconciled_zones) > 1 else None
    ot_label = html.escape(ot_zone.zone_name if ot_zone else "OT Control Zone (L1-L3)")
    it_label = html.escape(it_zone.zone_name if it_zone else "Enterprise IT Zone (L4)")

    proxy_cells: list[str] = []
    for idx, prx in enumerate(plan.tx_rx_proxy_translation_table[:5]):
        x_pos = 80 + idx * 205
        label = html.escape(
            f"{prx.proxy_rule_id}: {prx.target_protocol}\n"
            f"OT {prx.ot_source_ip}:{prx.ot_source_port}\n"
            f"RX {prx.rx_outer_vip}:{prx.rx_exposed_port}"
        )
        proxy_cells.append(
            f'        <mxCell id="prx_{idx}" value="{label}" '
            f'style="rounded=1;whiteSpace=wrap;fillColor=#eff6ff;strokeColor=#2563eb;fontColor=#1e3a8a;fontSize=10;" '
            f'vertex="1" parent="1">\n'
            f'          <mxGeometry x="{x_pos}" y="580" width="190" height="70" as="geometry" />\n'
            f"        </mxCell>"
        )

    proxy_block = "\n".join(proxy_cells)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="ConduitAI" agent="ConduitAI-Exporter" version="24.7.0">
  <diagram id="{html.escape(sizing.conduit_id)}" name="{fac} — Target {sl}">
    <mxGraphModel dx="1280" dy="860" grid="1" gridSize="10" page="1" pageScale="1" pageWidth="1169" pageHeight="827">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="title_banner" value="ConduitAI Target Hardware Isolation Architecture — {fac} (IEC 62443 {sl})" style="rounded=1;fillColor=#0f172a;strokeColor=#0f172a;fontColor=#ffffff;fontStyle=1;fontSize=14;" vertex="1" parent="1">
          <mxGeometry x="80" y="30" width="1000" height="50" as="geometry" />
        </mxCell>
        <mxCell id="it_zone" value="Purdue L4 — {it_label} (Read-Only Replica Consumers)" style="rounded=1;fillColor=#f8fafc;strokeColor=#2563eb;strokeWidth=2;fontColor=#0f172a;fontStyle=1;fontSize=12;" vertex="1" parent="1">
          <mxGeometry x="220" y="120" width="720" height="90" as="geometry" />
        </mxCell>
        <mxCell id="diode_barrier" value="HARDWARE DATA DIODE CONDUIT ({sizing.conduit_id}): {arch}&#xa;Peak {sizing.observed_peak_mbps} Mbps | Sized {sizing.sized_capacity_with_headroom_mbps} Mbps (1.25x Headroom) | {plan.executive_summary.critical_violations_severed} Inbound Violations Severed" style="rounded=1;fillColor=#ecfdf5;strokeColor=#059669;strokeWidth=3;fontColor=#065f46;fontStyle=1;fontSize=12;" vertex="1" parent="1">
          <mxGeometry x="180" y="275" width="800" height="100" as="geometry" />
        </mxCell>
        <mxCell id="ot_zone" value="Purdue L0–L3 — {ot_label} ({plan.executive_summary.total_discovered_assets} Reconciled Endpoints | {plan.executive_summary.undocumented_shadow_asset_count} Shadow OT Flagged)" style="rounded=1;fillColor=#f0fdf4;strokeColor=#16a34a;strokeWidth=2;fontColor=#0f172a;fontStyle=1;fontSize=12;" vertex="1" parent="1">
          <mxGeometry x="220" y="440" width="720" height="100" as="geometry" />
        </mxCell>
        <mxCell id="edge_ot_diode" value="TX Local Poller / Unidirectional Optical Push" style="edgeStyle=orthogonalEdgeStyle;strokeColor=#059669;strokeWidth=3;fontColor=#065f46;fontStyle=1;" edge="1" parent="1" source="ot_zone" target="diode_barrier">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="edge_diode_it" value="RX Outer Replica Stream (0-Bit Inbound Physical Lock)" style="edgeStyle=orthogonalEdgeStyle;strokeColor=#2563eb;strokeWidth=3;fontColor=#1d4ed8;fontStyle=1;" edge="1" parent="1" source="diode_barrier" target="it_zone">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
{proxy_block}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
"""


def export_executive_pdf(
    plan: ConduitArchitecturePlan,
    twin: ModalTwinVerificationResult,
) -> bytes:
    """Render an executive & regulatory compliance PDF report via ReportLab."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=40,
        rightMargin=40,
        topMargin=40,
        bottomMargin=40,
        title=f"ConduitAI Cutover Report — {plan.executive_summary.facility_name}",
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "ConduitTitle",
        parent=styles["Heading1"],
        fontSize=16,
        textColor=colors.HexColor("#0f172a"),
        spaceAfter=6,
    )
    sec_style = ParagraphStyle(
        "ConduitSec",
        parent=styles["Heading2"],
        fontSize=12,
        textColor=colors.HexColor("#1d4ed8"),
        spaceBefore=12,
        spaceAfter=6,
    )
    body_style = ParagraphStyle(
        "ConduitBody",
        parent=styles["BodyText"],
        fontSize=9.5,
        leading=13,
        textColor=colors.HexColor("#1e293b"),
    )

    story = []
    es = plan.executive_summary
    story.append(
        Paragraph(
            f"ConduitAI — Hardware Data Diode Sizing & IEC 62443 Cutover Package",
            title_style,
        )
    )
    story.append(
        Paragraph(
            f"<b>Facility:</b> {html.escape(es.facility_name)} &nbsp;|&nbsp; "
            f"<b>Security Posture:</b> {es.current_security_posture_sl} &rarr; {es.target_security_posture_sl} &nbsp;|&nbsp; "
            f"<b>Hardware BoM:</b> ${es.estimated_hardware_bom_usd:,.2f} USD",
            body_style,
        )
    )
    story.append(Spacer(1, 8))
    story.append(Paragraph(html.escape(es.headline_synthesis), body_style))

    # Section 1: Hardware Sizing & BoM
    story.append(Paragraph("1. Deterministic Hardware Diode Sizing & Bill of Materials", sec_style))
    bom_data = [["Line", "Archetype Code", "Description", "Qty", "Unit USD", "Extended USD"]]
    for item in plan.bill_of_materials:
        bom_data.append(
            [
                str(item.line_item),
                item.item_code,
                item.description[:44],
                str(item.quantity),
                f"${item.estimated_unit_cost_usd:,.0f}",
                f"${item.estimated_extended_cost_usd:,.0f}",
            ]
        )
    bom_tbl = Table(bom_data, colWidths=[35, 135, 195, 35, 65, 70])
    bom_tbl.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
            ]
        )
    )
    story.append(bom_tbl)

    # Section 2: Protocol Cutover Matrix
    story.append(Paragraph("2. Green / Amber / Red Protocol Cutover Matrix", sec_style))
    cut_data = [["Flow", "Protocol", "Port", "Direction", "Tier", "Action"]]
    for row in plan.protocol_cutover_matrix[:10]:
        cut_data.append(
            [
                row.flow_id,
                row.protocol[:22],
                str(row.port),
                row.observed_initiator,
                row.cutover_tier,
                row.cutover_action_type[:28],
            ]
        )
    cut_tbl = Table(cut_data, colWidths=[52, 110, 42, 70, 55, 206])
    cut_tbl.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a8a")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
            ]
        )
    )
    story.append(cut_tbl)

    # Section 3: Verifiable Socket Digital Twin Proof
    story.append(Paragraph("3. Layer-1/2 Unidirectional Socket Digital Twin Verification", sec_style))
    story.append(
        Paragraph(
            f"<b>Sandbox ID:</b> {html.escape(twin.sandbox_id)} ({twin.execution_backend}) &nbsp;|&nbsp; "
            f"<b>Telemetry Continuity:</b> {twin.telemetry_continuity_pct:.1f}% &nbsp;|&nbsp; "
            f"<b>Inbound Exploit Drop Rate:</b> {twin.inbound_exploit_block_rate_pct:.1f}% &nbsp;|&nbsp; "
            f"<b>Verdict:</b> {twin.overall_verdict}",
            body_style,
        )
    )

    # Section 4: Regulatory Compliance Mapping
    story.append(Paragraph("4. Multi-Framework Regulatory Compliance Mapping", sec_style))
    comp_data = [["Framework", "Clause", "Pre-Cutover", "Post-Cutover"]]
    for c in plan.compliance_mapping:
        comp_data.append(
            [c.framework[:28], c.clause_id[:28], c.pre_cutover_status, c.post_cutover_status]
        )
    comp_tbl = Table(comp_data, colWidths=[155, 155, 110, 115])
    comp_tbl.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#065f46")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
            ]
        )
    )
    story.append(comp_tbl)

    doc.build(story)
    return buffer.getvalue()


def export_cutover_zip_bundle(
    plan: ConduitArchitecturePlan,
    twin: ModalTwinVerificationResult,
    *,
    switch_hostname: str = "OT-CORE-SW01",
) -> bytes:
    """Package Cisco/Hirschmann CLI, TX/RX proxy JSONs, Digital Twin log, and `.drawio` into `.zip`."""
    buf = io.BytesIO()
    cli_script = generate_switch_cutover_cli(plan, switch_hostname=switch_hostname)
    tx_config = {
        "role": "DIODE_TX_INNER_OT_SIDE",
        "facility": plan.executive_summary.facility_name,
        "rules": [
            {
                "proxy_rule_id": r.proxy_rule_id,
                "vlan_id": r.vlan_id,
                "ot_source_ip": r.ot_source_ip,
                "ot_source_port": r.ot_source_port,
                "tx_inner_vip": r.tx_inner_vip,
                "tx_operating_mode": r.tx_operating_mode,
                "polling_interval_ms": r.polling_interval_ms,
                "target_protocol": r.target_protocol,
            }
            for r in plan.tx_rx_proxy_translation_table
        ],
    }
    rx_config = {
        "role": "DIODE_RX_OUTER_IT_REPLICA",
        "facility": plan.executive_summary.facility_name,
        "rules": [
            {
                "proxy_rule_id": r.proxy_rule_id,
                "rx_outer_vip": r.rx_outer_vip,
                "rx_exposed_port": r.rx_exposed_port,
                "it_consumer_ip": r.it_consumer_ip,
                "target_protocol": r.target_protocol,
                "repointing_instruction": r.it_repointing_instruction,
            }
            for r in plan.tx_rx_proxy_translation_table
        ],
    }

    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("01_switch_vlan_port_security_cutover.ios.conf", cli_script)
        zf.writestr("02_diode_tx_inner_poller.json", json.dumps(tx_config, indent=2))
        zf.writestr("03_diode_rx_outer_replica.json", json.dumps(rx_config, indent=2))
        zf.writestr("04_architecture_plan.json", plan.model_dump_json(indent=2))
        zf.writestr(
            "05_digital_twin_verification.log",
            f"Sandbox: {twin.sandbox_id} ({twin.execution_backend})\n"
            f"Verdict: {twin.overall_verdict}\n"
            f"Continuity: {twin.telemetry_continuity_pct}% | Block Rate: {twin.inbound_exploit_block_rate_pct}%\n\n"
            f"{twin.sandbox_stdout_log}\n",
        )
        zf.writestr("06_target_purdue_conduit.drawio", export_drawio_xml(plan))

    return buf.getvalue()

