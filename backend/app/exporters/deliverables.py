"""Server-side generators for `.drawio` Purdue Topology, ReportLab Compliance `.pdf`, and `.zip` Cutover Kit."""

from __future__ import annotations

import html
import io
import json
import zipfile
from typing import Any

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


# Plain-language wording for the report; the enum names stay in the JSON bundle
_PDF_ACTION = {
    "DROP_IN_PROXY_MAPPING": "Keep: one-way out through the diode",
    "PULL_TO_PUSH_PROXY_REVERSAL": "Keep: diode polls the plant and pushes a copy out",
    "DEPLOY_OPC_UA_WRAPPER_THEN_PROXY": "Keep: protocol adapter, then one-way out",
    "REPLACE_SMB_WITH_SFTP_RELAY": "Keep: file push out only",
    "ROUTE_VIA_ARCH_D_OT_LOCKED_GATEWAY": "Keep: plant-initiated only, through a locked gateway",
    "SEVER_CRITICAL_VIOLATION_AT_L1": "Cut",
}
_PDF_DIRECTION = {
    "IT_TO_OT": "Office to plant",
    "OT_TO_IT": "Plant to office",
    "BYPASS_TO_OT": "Bypass into plant",
    "LOCAL": "Inside plant",
}


_PDF_LABEL = {
    "ROGUE_IT_BRIDGE": "Rogue IT bridge (bypasses the firewall)",
    "DUAL_HOMED_BYPASS_ASSET": "Dual-homed host bridging IT and OT",
    "UNDOCUMENTED_SHADOW_ASSET": "Device missing from the asset list",
    "COMPLIANT_SL4": "Compliant (SL-4)",
    "COMPLIANT_SL3": "Compliant (SL-3)",
}


def _plain(value: str) -> str:
    return _PDF_LABEL.get(value) or value.replace("_", " ").capitalize()


def export_executive_pdf(
    plan: ConduitArchitecturePlan,
    twin: ModalTwinVerificationResult,
    *,
    review: dict[str, Any] | None = None,
    manifest: dict[str, Any] | None = None,
    conflicts: list[dict[str, Any]] | None = None,
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

    cell_style = ParagraphStyle("ConduitCell", parent=body_style, fontSize=8, leading=10)

    def cell(text: str) -> Paragraph:
        # Wrapped table cell, so long values are never cut off
        return Paragraph(html.escape(text), cell_style)

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
    signoff = (review or {}).get("signoff")
    status = (
        f"<b>Signed off</b> by {html.escape(signoff['reviewer'])} at {signoff['at']} "
        f"(plan {signoff['plan_fingerprint']})"
        if signoff
        else "<b>DRAFT</b>: not yet signed off by an engineer"
    )
    story.append(Paragraph(status, body_style))
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
                cell(item.description),
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
    cut_data = [["Flow", "Connection", "Protocol / port", "Direction", "Tier", "Decision"]]
    for row in plan.protocol_cutover_matrix:
        cut_data.append(
            [
                row.flow_id,
                cell(f"{row.observed_src_ip} to {row.observed_dst_ip}"),
                cell(f"{row.protocol} / {row.port}"),
                cell(_PDF_DIRECTION.get(row.observed_initiator, _plain(row.observed_initiator))),
                row.cutover_tier,
                cell(_PDF_ACTION.get(row.cutover_action_type, _plain(row.cutover_action_type))),
            ]
        )
    cut_tbl = Table(cut_data, colWidths=[48, 112, 100, 72, 45, 158], repeatRows=1)
    cut_tbl.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a8a")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
            ]
        )
    )
    story.append(cut_tbl)

    if plan.shadow_assets_and_bypasses:
        story.append(Paragraph("Unlisted devices and bypass paths", sec_style))
        shadow_data = [["Finding", "Addresses", "Severity", "Action"]]
        for a in plan.shadow_assets_and_bypasses:
            shadow_data.append(
                [cell(_plain(a.anomaly_type)), cell(", ".join(a.ip_addresses)), a.severity, cell(a.remediation_action)]
            )
        shadow_tbl = Table(shadow_data, colWidths=[110, 95, 60, 270], repeatRows=1)
        shadow_tbl.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#7f1d1d")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                ]
            )
        )
        story.append(shadow_tbl)

    # Section 3: Verifiable Socket Digital Twin Proof
    story.append(Paragraph("3. Layer-1/2 Unidirectional Socket Digital Twin Verification", sec_style))
    story.append(
        Paragraph(
            f"<b>Sandbox ID:</b> {html.escape(twin.sandbox_id)} ({twin.execution_backend}) &nbsp;|&nbsp; "
            f"<b>Telemetry Continuity:</b> {twin.telemetry_continuity_pct:.1f}% &nbsp;|&nbsp; "
            f"<b>Inbound Exploit Drop Rate:</b> {twin.inbound_exploit_block_rate_pct:.1f}% &nbsp;|&nbsp; "
            f"<b>Verdict:</b> {_plain(twin.overall_verdict)}",
            body_style,
        )
    )

    # Section 4: Regulatory Compliance Mapping
    story.append(Paragraph("4. Multi-Framework Regulatory Compliance Mapping", sec_style))
    comp_data = [["Framework", "Clause", "Pre-Cutover", "Post-Cutover"]]
    for c in plan.compliance_mapping:
        comp_data.append(
            [cell(c.framework), cell(c.clause_id), cell(_plain(c.pre_cutover_status)), cell(_plain(c.post_cutover_status))]
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

    def table(data: list[list[Any]], widths: list[int], header: str) -> Table:
        tbl = Table(data, colWidths=widths, repeatRows=1)
        tbl.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(header)),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                ]
            )
        )
        return tbl

    if conflicts:
        story.append(Paragraph("5. Questions for the site (sources disagree)", sec_style))
        rows: list[list[Any]] = [["Topic", "What each source says", "Question"]]
        for c in conflicts:
            said = "; ".join(f"{x['source']}: {x['value']}" for x in c["sources"])
            rows.append([cell(c["topic"]), cell(said), cell(c["question"])])
        story.append(table(rows, [100, 215, 220], "#92400e"))

    if review is not None:
        story.append(Paragraph("6. Engineer review", sec_style))
        overrides = review.get("overrides") or []
        if overrides:
            rows = [["Connection", "Change", "Reason", "Reviewer", "Verifier"]]
            for o in overrides:
                rows.append(
                    [
                        cell(f"{o['flow_id']}: {o['connection']}"),
                        cell(f"{_PDF_ACTION.get(o['from_action'], o['from_action'])} to "
                             f"{_PDF_ACTION.get(o['to_action'], o['to_action'])}"),
                        cell(o["reason"]),
                        cell(f"{o['reviewer']} ({o['at']})"),
                        cell("Accepted" if o["accepted"] else "Refused: " + "; ".join(o["violations"])),
                    ]
                )
            story.append(table(rows, [110, 110, 110, 85, 120], "#334155"))
        else:
            story.append(Paragraph("No decisions were changed by an engineer.", body_style))
        story.append(Spacer(1, 4))
        story.append(Paragraph(status, body_style))

    if manifest:
        story.append(Paragraph("7. Evidence and chain of custody", sec_style))
        story.append(
            Paragraph(
                f"Generated {manifest['generated_at']} for plan {manifest.get('plan_fingerprint')}. "
                "Each input is identified by its SHA-256, so the report can be matched to the exact files supplied.",
                body_style,
            )
        )
        rows = [["Input", "File", "Bytes", "SHA-256"]]
        for f in manifest.get("inputs") or []:
            rows.append([cell(f["role"]), cell(f["file"]), f"{f['bytes']:,}", cell(f["sha256"])])
        story.append(table(rows, [85, 130, 55, 265], "#1e293b"))
        story.append(Spacer(1, 6))
        arch = manifest.get("architect") or {}
        rows = [["Stage", "Model", "How it ran"]]
        for m in manifest.get("models") or []:
            rows.append([cell(m["stage"]), cell(m["model"]), cell(m["source_mode"])])
        story.append(table(rows, [170, 180, 185], "#1e293b"))
        story.append(
            Paragraph(
                f"Architect: {html.escape(str(arch.get('model')))} ({arch.get('source_mode')}), "
                f"{arch.get('drafts', 0)} draft(s), {arch.get('drafts_rejected', 0)} rejected by the verifier. "
                f"Voice transcript source: {manifest.get('voice_transcript_source') or 'none'}.",
                body_style,
            )
        )
        rows = [["Finding", "What was seen", "Evidence"]]
        for f in manifest.get("findings") or []:
            rows.append([f["id"], cell(f["finding"]), cell(f["evidence"])])
        story.append(table(rows, [60, 265, 210], "#1e293b"))

    doc.build(story)
    return buffer.getvalue()


def export_cutover_zip_bundle(
    plan: ConduitArchitecturePlan,
    twin: ModalTwinVerificationResult,
    *,
    switch_hostname: str = "OT-CORE-SW01",
    cli_script: str | None = None,
    review: dict[str, Any] | None = None,
    manifest: dict[str, Any] | None = None,
    conflicts: list[dict[str, Any]] | None = None,
) -> bytes:
    """Package Cisco/Hirschmann CLI, TX/RX proxy JSONs, Digital Twin log, and `.drawio` into `.zip`."""
    buf = io.BytesIO()
    cli_script = cli_script or generate_switch_cutover_cli(plan, switch_hostname=switch_hostname)
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
        if manifest:
            zf.writestr("07_evidence_manifest.json", json.dumps(manifest, indent=2))
        if review is not None or conflicts:
            zf.writestr(
                "08_engineer_review.json",
                json.dumps({"review": review, "questions_for_site": conflicts or []}, indent=2),
            )

    return buf.getvalue()

