"use client";

import React, { useEffect, useState } from "react";
import {
  Briefcase,
  Check,
  Clock,
  Copy,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileText,
  HardDrive,
  Mail,
  Scale,
  Server,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import { ArchetypeId, ScenarioDataset, UserLensMode } from "@/types/conduit";
import { getExportEndpointUrl } from "@/lib/api";
import { buildCustomerProposalEmail } from "@/lib/guidedCopy";

interface BomComplianceTabProps {
  scenario: ScenarioDataset;
  userLens?: UserLensMode;
}

type QuoteSubTab = "sales_proposal" | "engineer_kit";

const CATALOG_REFERENCE: Array<{
  id: ArchetypeId;
  code: string;
  title: string;
  ceiling: string;
  mount: string;
  cost: string;
}> = [
  {
    id: "ARCH_A_FIELD_DIODE",
    code: "ARCH_A",
    title: "Industrial Field Protocol Diode",
    ceiling: "80M Sust / 100M Max",
    mount: "DIN_RAIL (65mm)",
    cost: "$4,500",
  },
  {
    id: "ARCH_B_VIDEO_IOT_DIODE",
    code: "ARCH_B",
    title: "Edge Video & IoT Proxy Diode",
    ceiling: "800M Sust / 1G Max",
    mount: "1U_HALF / DIN (110mm)",
    cost: "$8,500",
  },
  {
    id: "ARCH_C_ENTERPRISE_1U_DIODE",
    code: "ARCH_C",
    title: "Enterprise 1U Multi-VLAN Diode",
    ceiling: "850M Sust / 16 VLANs",
    mount: "1U_19INCH_RACK",
    cost: "$21,000",
  },
  {
    id: "ARCH_D_BIDIRECTIONAL_GATEWAY",
    code: "ARCH_D",
    title: "Controlled Bi-Directional Gateway",
    ceiling: "800M Fwd / 50M OT-Lock",
    mount: "1U_19INCH_RACK",
    cost: "$29,500",
  },
];

function triggerBrowserDownload(
  filename: string,
  content: string,
  mimeType: string
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function BomComplianceTab({
  scenario,
  userLens = "guided_collab",
}: BomComplianceTabProps) {
  const [subTab, setSubTab] = useState<QuoteSubTab>(
    userLens === "engineer_deep" ? "engineer_kit" : "sales_proposal"
  );
  const [copiedCli, setCopiedCli] = useState(false);
  const [copiedProposalEmail, setCopiedProposalEmail] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  useEffect(() => {
    setSubTab(userLens === "engineer_deep" ? "engineer_kit" : "sales_proposal");
  }, [userLens]);

  const selectedIds = new Set(scenario.bom.items.map((i) => i.archetypeId));
  const utilizationPct = Math.min(
    100,
    Math.round(
      (scenario.bom.sizedBandwidthWithHeadroomMbps /
        scenario.bom.sustainedCapacityMbps) *
        100
    )
  );
  const peakPct = Math.min(
    100,
    Math.round(
      (scenario.bom.peakBandwidthMbps / scenario.bom.sustainedCapacityMbps) *
        100
    )
  );

  const proposalEmailText = buildCustomerProposalEmail(scenario);

  const handleCopyProposalEmail = async () => {
    try {
      await navigator.clipboard.writeText(proposalEmailText);
      setCopiedProposalEmail(true);
      setTimeout(() => setCopiedProposalEmail(false), 2600);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleCopyCli = async () => {
    try {
      await navigator.clipboard.writeText(scenario.bom.switchCutoverCli);
      setCopiedCli(true);
      setTimeout(() => setCopiedCli(false), 2000);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleExport = async (kind: "drawio" | "pdf" | "zip") => {
    const endpoint = getExportEndpointUrl(scenario.id, kind);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1600);
      const res = await fetch(endpoint, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const ext =
          kind === "drawio" ? "drawio" : kind === "pdf" ? "pdf" : "zip";
        a.download = `conduitai_${scenario.id}_cutover.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setExportNotice(
          `Downloaded live backend ${kind.toUpperCase()} deliverable package.`
        );
        setTimeout(() => setExportNotice(null), 3500);
        return;
      }
    } catch {
      // Backend offline -> generate deterministic local engineering export
    }

    if (kind === "drawio") {
      const drawioXml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="ConduitAI" modified="2026-10-27T00:00:00.000Z" version="24.7.0">
  <diagram id="${scenario.conduitId}" name="${scenario.facilityName}">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" page="1" pageScale="1" pageWidth="1100" pageHeight="850">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="it_zone" value="Purdue L4 Enterprise IT (${scenario.conduitName})" style="rounded=1;fillColor=#0f172a;strokeColor=#38bdf8;fontColor=#e2e8f0;" vertex="1" parent="1">
          <mxGeometry x="260" y="60" width="520" height="90" as="geometry" />
        </mxCell>
        <mxCell id="diode_conduit" value="IEC 62443 ${scenario.postCutoverSl} Hardware Isolation: ${scenario.bom.items.map((i) => i.archetypeId).join(" + ")} (${scenario.bom.sizedBandwidthWithHeadroomMbps} Mbps @ 1.25x)" style="rounded=1;fillColor=#022c22;strokeColor=#10b981;fontColor=#a7f3d0;fontStyle=1" vertex="1" parent="1">
          <mxGeometry x="260" y="230" width="520" height="90" as="geometry" />
        </mxCell>
        <mxCell id="ot_zone" value="Purdue L1-L3 Isolated OT Zone (${scenario.telemetry.totalDiscoveredAssets} Reconciled Endpoints)" style="rounded=1;fillColor=#0f172a;strokeColor=#10b981;fontColor=#e2e8f0;" vertex="1" parent="1">
          <mxGeometry x="260" y="400" width="520" height="110" as="geometry" />
        </mxCell>
        <mxCell id="edge_up" value="Unidirectional TX -> RX Stream (0-Bit Inbound)" style="edgeStyle=orthogonalEdgeStyle;strokeColor=#10b981;strokeWidth=3;fontColor=#10b981;" edge="1" parent="1" source="ot_zone" target="diode_conduit">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="edge_rx" value="DMZ Replica Read-Only Poll" style="edgeStyle=orthogonalEdgeStyle;strokeColor=#38bdf8;strokeWidth=2;fontColor=#38bdf8;" edge="1" parent="1" source="diode_conduit" target="it_zone">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
      triggerBrowserDownload(
        `${scenario.id}_target_sl4_conduit.drawio`,
        drawioXml,
        "application/xml"
      );
      setExportNotice(
        `Exported ${scenario.id}_target_sl4_conduit.drawio (diagrams.net XML).`
      );
    } else if (kind === "pdf") {
      const proposalMd = `# CONDUITAI — EXECUTIVE HARDWARE DATA DIODE CUTOVER PROPOSAL
Facility: ${scenario.facilityName}
Vertical: ${scenario.vertical}
Conduit: ${scenario.conduitId} (${scenario.preCutoverSl} -> ${scenario.postCutoverSl})

## 1. Bandwidth & Deterministic Hardware BoM
- Peak Observed Traffic: ${scenario.bom.peakBandwidthMbps} Mbps
- 1.25x Safety Margin Sized Throughput: ${scenario.bom.sizedBandwidthWithHeadroomMbps} Mbps
- Recommended Hardware: ${scenario.bom.items.map((i) => `${i.quantity}x ${i.name} (${i.archetypeId}) @ $${i.unitCostUsd.toLocaleString()}`).join(", ")}
- Total Hardware BoM Cost: $${scenario.bom.totalHardwareCostUsd.toLocaleString()} USD
- SAM 3.1 Physical Fit: ${scenario.bom.physicalFitStatus}

## 2. Modal Socket Digital Twin Verification
- Sandbox: ${scenario.digitalTwin.sandboxId}
- Operational Downtime: ${scenario.digitalTwin.operationalDowntimePct}%
- Physical Inbound Exploit Drop: ${scenario.digitalTwin.inboundExploitDropPct}%

## 3. Regulatory Compliance Satisfaction
${scenario.compliance.map((c) => `- [${c.standard} ${c.clauseId}] ${c.findingCode}: ${c.preCutoverState} -> ${c.postCutoverState}`).join("\n")}
`;
      triggerBrowserDownload(
        `${scenario.id}_executive_cutover_proposal.md`,
        proposalMd,
        "text/markdown"
      );
      setExportNotice(
        `Exported ${scenario.id}_executive_cutover_proposal.md sign-off report.`
      );
    } else {
      const bundleTxt = `# CONDUITAI CUTOVER AUTOMATION BUNDLE — ${scenario.id.toUpperCase()}
# Generated for ${scenario.facilityName}

=== 1. SWITCH VLAN / PORT-SECURITY CUTOVER CLI ===
${scenario.bom.switchCutoverCli}

=== 2. TX INNER PROXY & RX OUTER REPLICA CONFIGS ===
${scenario.flows
  .map(
    (f) => `[${f.flowId}] ${f.protocol} (${f.classification})
  TX_INNER: ${f.txInnerConfig}
  RX_OUTER: ${f.rxOuterConfig}`
  )
  .join("\n\n")}
`;
      triggerBrowserDownload(
        `${scenario.id}_cutover_scripts_bundle.conf`,
        bundleTxt,
        "text/plain"
      );
      setExportNotice(
        `Downloaded ${scenario.id}_cutover_scripts_bundle.conf TX/RX & Switch CLI bundle.`
      );
    }
    setTimeout(() => setExportNotice(null), 4000);
  };

  return (
    <div className="space-y-4">
      {/* 2 Clean Sub-Tabs: Sales Quote, ROI & Compliance vs. Network Engineer Deployment Kit */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-md p-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab("sales_proposal")}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded text-xs font-semibold transition-all border ${
              subTab === "sales_proposal"
                ? "bg-emerald-500/20 text-emerald-200 border-emerald-500/50"
                : "text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-800/70"
            }`}
          >
            <Briefcase className="w-4 h-4 text-emerald-400" />
            <span>💼 Sales Quote, ROI & Audit Compliance</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab("engineer_kit")}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded text-xs font-semibold transition-all border ${
              subTab === "engineer_kit"
                ? "bg-sky-500/20 text-sky-200 border-sky-500/50"
                : "text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-800/70"
            }`}
          >
            <Wrench className="w-4 h-4 text-sky-400" />
            <span>🛠️ Network Engineer Deployment Handoff Kit</span>
          </button>
        </div>

        <span className="text-[11px] font-mono text-slate-400 px-2">
          {subTab === "sales_proposal"
            ? "Ready-to-send customer hardware quote, ROI & regulatory sign-off"
            : "Hardware specs, copy-paste Switch CLI & downloadable .drawio/.zip"}
        </span>
      </div>

      {/* SUB-TAB 1: Sales Quote, ROI & Audit Compliance */}
      {subTab === "sales_proposal" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            {/* Left: Customer Hardware Quote + Time-to-Value ROI Card (7 cols) */}
            <div className="xl:col-span-7 space-y-4">
              {/* Customer Hardware Quote Card */}
              <div className="bg-slate-900/90 border border-emerald-500/45 rounded-md p-4 space-y-3 shadow-[0_0_25px_rgba(16,185,129,0.08)]">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400">
                      Customer-Ready Hardware Quote (Vendor-Neutral)
                    </span>
                    <h3 className="text-base font-bold text-slate-100 mt-0.5">
                      {scenario.facilityName}
                    </h3>
                    <p className="text-xs font-mono text-emerald-300 mt-0.5">
                      ✓ {scenario.bom.physicalFitStatus}
                    </p>
                  </div>
                  <div className="text-right bg-emerald-950/50 border border-emerald-500/40 rounded px-3.5 py-2">
                    <div className="text-[10px] font-mono uppercase text-emerald-300">
                      Total Hardware Price
                    </div>
                    <div className="text-2xl font-mono font-bold text-emerald-400">
                      ${scenario.bom.totalHardwareCostUsd.toLocaleString()} USD
                    </div>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {scenario.bom.items.map((item) => (
                    <div
                      key={item.archetypeId}
                      className="p-3 rounded bg-zinc-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-mono font-bold">
                            Qty {item.quantity}
                          </span>
                          <span className="text-sm font-semibold text-slate-100">
                            {item.name}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          Mounts in: {item.mountingOption} · Supports up to{" "}
                          {item.sustainedCeilingMbps} Mbps sustained (Site needs{" "}
                          {scenario.bom.sizedBandwidthWithHeadroomMbps} Mbps w/
                          25% buffer)
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-mono font-bold text-slate-100">
                          ${item.extendedCostUsd.toLocaleString()}
                        </div>
                        <div className="text-[10px] font-mono text-slate-500">
                          ${item.unitCostUsd.toLocaleString()} / unit
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <p className="text-xs text-slate-300 bg-slate-950/70 border border-slate-800 rounded p-2.5 leading-relaxed">
                  <strong className="text-emerald-400">
                    Why this exact model:{" "}
                  </strong>
                  {scenario.bom.sizingJustification}
                </p>
              </div>

              {/* Time-to-Value / Consulting ROI Comparison Card */}
              <div className="bg-slate-900/85 border border-slate-800 rounded-md p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span>
                    Why Customers Say Yes Faster — Time &amp; Consulting Cost
                    Saved
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded bg-rose-950/20 border border-rose-500/35">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-rose-300">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Traditional Manual OT Audit</span>
                    </div>
                    <div className="text-lg font-mono font-bold text-slate-100 mt-1">
                      2–3 Weeks · ~$25,000
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                      Fly senior consultants on-site, manually read firewall
                      spreadsheets, risk quoting 19&quot; hardware that won&apos;t
                      fit or breaking Historian polls.
                    </p>
                  </div>

                  <div className="p-3 rounded bg-emerald-950/30 border border-emerald-500/45">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>ConduitAI Guided Assessment</span>
                    </div>
                    <div className="text-lg font-mono font-bold text-emerald-400 mt-1">
                      60 Seconds · Ready Today
                    </div>
                    <p className="text-[11px] text-slate-300 mt-1 leading-snug">
                      Physical cabinet fit measured by SAM 3.1, unlisted floor
                      PLCs caught, 0% downtime proven in Modal Twin, and switch
                      scripts ready for IT.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Copy Executive Customer Proposal Email + Quick Exports (5 cols) */}
            <div className="xl:col-span-5 bg-slate-900/85 border border-sky-500/35 rounded-md p-4 flex flex-col justify-between gap-3">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-sky-400" />
                    <h4 className="text-sm font-bold text-slate-100">
                      Executive Customer Proposal Email
                    </h4>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-400">
                    1-CLICK COPY
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  Send this plain-English quote, risk summary &amp; 0% downtime
                  guarantee directly to the Plant Manager, CISO, or Procurement
                  lead:
                </p>

                <div className="rounded bg-zinc-950 border border-slate-800 p-3">
                  <pre className="text-[11px] font-sans text-slate-300 whitespace-pre-wrap max-h-56 overflow-y-auto leading-relaxed">
                    {proposalEmailText}
                  </pre>
                </div>
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleCopyProposalEmail}
                  className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-xs font-bold transition-all border ${
                    copiedProposalEmail
                      ? "bg-emerald-500 text-slate-950 border-emerald-400"
                      : "bg-emerald-500 hover:bg-emerald-400 text-slate-950 border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.25)]"
                  }`}
                >
                  {copiedProposalEmail ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>✓ Executive Proposal Email Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>📧 Copy Executive Customer Proposal Email</span>
                    </>
                  )}
                </button>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleExport("pdf")}
                    className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded bg-slate-950 hover:bg-slate-800 border border-slate-700 text-[11px] font-medium text-slate-200"
                  >
                    <FileText className="w-3.5 h-3.5 text-emerald-400" />
                    <span>PDF Proposal</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport("drawio")}
                    className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded bg-slate-950 hover:bg-slate-800 border border-slate-700 text-[11px] font-medium text-slate-200"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-sky-400" />
                    <span>.drawio Map</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport("zip")}
                    className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded bg-slate-950 hover:bg-slate-800 border border-slate-700 text-[11px] font-medium text-slate-200"
                  >
                    <FileCode2 className="w-3.5 h-3.5 text-amber-400" />
                    <span>IT Script Kit</span>
                  </button>
                </div>

                {exportNotice && (
                  <div className="p-2 rounded bg-emerald-950/60 border border-emerald-500/40 text-[11px] font-mono text-emerald-300">
                    ✓ {exportNotice}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Compliance & Cyber-Insurance Checklist */}
          <div className="bg-slate-900/85 border border-slate-800 rounded-md overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-950/80 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Scale className="w-4 h-4 text-sky-400" />
                <h3 className="text-xs font-semibold text-slate-100">
                  Cyber-Insurance &amp; Regulatory Audit Checklist (Before vs.
                  After Hardware Diode)
                </h3>
              </div>
              <span className="text-[11px] font-mono text-emerald-400">
                Upgrades Site from {scenario.preCutoverSl} →{" "}
                {scenario.postCutoverSl}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/60 text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    <th className="py-2.5 px-3">Regulation / Standard</th>
                    <th className="py-2.5 px-3">Today (Software Firewall)</th>
                    <th className="py-2.5 px-3">After ConduitAI Diode</th>
                    <th className="py-2.5 px-3">
                      Plain-English Auditor &amp; Insurance Proof
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 text-xs">
                  {scenario.compliance.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-900/90">
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="font-semibold text-slate-100">
                          {row.standard}
                        </div>
                        <div className="text-[11px] font-mono text-sky-300">
                          {row.clauseId}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="inline-block px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/40 font-mono text-[11px]">
                          {row.preCutoverState}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <span className="inline-block px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 font-mono text-[11px]">
                          {row.postCutoverState}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-300 max-w-md">
                        {row.diodeSatisfactionNote}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: Network Engineer Deployment Handoff Kit */}
      {subTab === "engineer_kit" && (
        <div className="space-y-4">
          {/* Vendor-Neutral 4-Archetype Catalog Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
            {CATALOG_REFERENCE.map((arch) => {
              const isSelected = selectedIds.has(arch.id);
              return (
                <div
                  key={arch.id}
                  className={`p-3 rounded-md border transition-all ${
                    isSelected
                      ? "bg-emerald-950/35 border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.16)]"
                      : "bg-slate-900/50 border-slate-800/80 opacity-65"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                        isSelected
                          ? "bg-emerald-400 text-slate-950"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {arch.code} {isSelected ? "· SELECTED" : ""}
                    </span>
                    <span className="text-xs font-mono font-bold text-slate-200">
                      {arch.cost}
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-slate-100 mt-1.5">
                    {arch.title}
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 mt-1">
                    {arch.ceiling} · {arch.mount}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8 bg-slate-900/85 border border-slate-800 rounded-md p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Server className="w-4 h-4 text-emerald-400" />
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">
                      Hardware Isolation Engineering Specification &amp; 1.25×
                      Headroom Envelope
                    </h3>
                    <p className="text-[11px] font-mono text-emerald-400">
                      {scenario.bom.physicalFitStatus}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-mono uppercase text-slate-400">
                    Total Hardware CapEx
                  </div>
                  <div className="text-xl font-mono font-bold text-emerald-400">
                    ${scenario.bom.totalHardwareCostUsd.toLocaleString()} USD
                  </div>
                </div>
              </div>

              {/* 1.25x Deterministic Headroom Bar */}
              <div className="p-3.5 rounded bg-zinc-950 border border-slate-800 space-y-2">
                <div className="flex flex-wrap items-center justify-between text-xs font-mono">
                  <span className="text-slate-300">
                    1.25× Peak Bandwidth Sizing:{" "}
                    <strong className="text-white">
                      {scenario.bom.peakBandwidthMbps.toFixed(1)} Mbps
                    </strong>{" "}
                    × 1.25 ={" "}
                    <strong className="text-emerald-400">
                      {scenario.bom.sizedBandwidthWithHeadroomMbps.toFixed(2)}{" "}
                      Mbps
                    </strong>
                  </span>
                  <span className="text-slate-400">
                    Sustained Ceiling:{" "}
                    <strong className="text-sky-300">
                      {scenario.bom.sustainedCapacityMbps} Mbps
                    </strong>{" "}
                    ({utilizationPct}% Utilized)
                  </span>
                </div>

                <div className="relative h-3.5 rounded-full bg-slate-900 border border-slate-800 overflow-hidden">
                  <div
                    style={{ width: `${utilizationPct}%` }}
                    className="h-full bg-emerald-500/85 transition-all duration-500"
                  />
                  <div
                    style={{ width: `${peakPct}%` }}
                    className="absolute top-0 left-0 h-full bg-sky-400/80 border-r border-white/60"
                  />
                </div>

                <div className="flex justify-between text-[10px] font-mono text-slate-500">
                  <span>0 Mbps</span>
                  <span className="text-sky-400">
                    ■ Observed Peak ({scenario.bom.peakBandwidthMbps} Mbps)
                  </span>
                  <span className="text-emerald-400">
                    ■ 1.25× Headroom Envelope (
                    {scenario.bom.sizedBandwidthWithHeadroomMbps} Mbps)
                  </span>
                  <span>{scenario.bom.sustainedCapacityMbps} Mbps Ceiling</span>
                </div>
              </div>

              {/* Hardware Technical Spec Cards */}
              <div className="space-y-3">
                {scenario.bom.items.map((item) => (
                  <div
                    key={item.archetypeId}
                    className="p-3.5 rounded bg-slate-950/90 border border-slate-800 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-mono font-bold">
                          {item.quantity}× {item.archetypeId}
                        </span>
                        <span className="text-sm font-semibold text-slate-100">
                          {item.name}
                        </span>
                      </div>
                      <span className="text-sm font-mono font-bold text-slate-100">
                        ${item.extendedCostUsd.toLocaleString()}
                      </span>
                    </div>

                    <p className="text-xs text-slate-400">
                      {item.isolationLayer}
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[11px] font-mono">
                      <div className="text-slate-300">
                        <span className="text-slate-500">Mounting:</span>{" "}
                        {item.mountingOption}
                      </div>
                      <div className="text-slate-300">
                        <span className="text-slate-500">Max IEC SL:</span>{" "}
                        <span className="text-emerald-400">{item.maxIecSl}</span>
                      </div>
                      <div className="text-slate-300">
                        <span className="text-slate-500">Interfaces:</span>{" "}
                        {item.interfaces}
                      </div>
                      <div className="text-slate-300">
                        <span className="text-slate-500">Env / Power:</span>{" "}
                        {item.operatingTempC} · {item.powerSupply}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded bg-slate-950/60 border border-slate-800">
                  <div className="text-[10px] font-mono uppercase text-sky-400 mb-1 flex items-center gap-1">
                    <HardDrive className="w-3.5 h-3.5" />
                    <span>SAM 3.1 Physical Mounting Constraint Check</span>
                  </div>
                  <p className="text-slate-300 leading-relaxed">
                    {scenario.bom.physicalMountingNote}
                  </p>
                </div>
                <div className="p-3 rounded bg-slate-950/60 border border-slate-800">
                  <div className="text-[10px] font-mono uppercase text-emerald-400 mb-1 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Deterministic Catalog Selection Proof</span>
                  </div>
                  <p className="text-slate-300 leading-relaxed">
                    {scenario.bom.sizingJustification}
                  </p>
                </div>
              </div>
            </div>

            {/* Right: Exports + Switch Cutover CLI (4 cols) */}
            <div className="lg:col-span-4 space-y-4 flex flex-col">
              <div className="bg-slate-900/85 border border-slate-800 rounded-md p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Download className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-semibold text-slate-100 uppercase tracking-wider font-mono">
                    Network Engineer Handoff Files
                  </h3>
                </div>

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => handleExport("drawio")}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 rounded bg-slate-950 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-100 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-sky-400" />
                      <span>Export Editable Topology (.drawio)</span>
                    </span>
                    <span className="text-[10px] font-mono text-sky-400">
                      XML
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExport("pdf")}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 rounded bg-slate-950 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-100 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-emerald-400" />
                      <span>Export Executive PDF Proposal</span>
                    </span>
                    <span className="text-[10px] font-mono text-emerald-400">
                      REPORT
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExport("zip")}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/50 text-xs font-semibold text-emerald-200 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <FileCode2 className="w-4 h-4 text-emerald-400" />
                      <span>Download .zip Cutover Scripts</span>
                    </span>
                    <span className="text-[10px] font-mono text-emerald-300">
                      CLI + PROXY
                    </span>
                  </button>
                </div>

                {exportNotice && (
                  <div className="p-2 rounded bg-emerald-950/60 border border-emerald-500/40 text-[11px] font-mono text-emerald-300">
                    ✓ {exportNotice}
                  </div>
                )}
              </div>

              <div className="bg-slate-900/85 border border-slate-800 rounded-md overflow-hidden flex-1 flex flex-col">
                <div className="px-3.5 py-2.5 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200 font-mono">
                    Switch VLAN &amp; Port Lockdown CLI
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyCli}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300"
                  >
                    {copiedCli ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy CLI</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-3.5 bg-zinc-950 text-[11px] font-mono text-emerald-300/95 overflow-x-auto flex-1 leading-relaxed">
                  {scenario.bom.switchCutoverCli}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
