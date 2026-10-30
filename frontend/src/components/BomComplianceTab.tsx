"use client";

import React, { useEffect, useState } from "react";
import {
  Check,
  Copy,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mail,
  Sparkles,
} from "lucide-react";
import { ArchetypeId, ScenarioDataset, UserLensMode } from "@/types/conduit";
import { API_BASE, getExportEndpointUrl } from "@/lib/api";
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
    mount: "35mm DIN (65mm)",
    cost: "$4,500",
  },
  {
    id: "ARCH_B_VIDEO_IOT_DIODE",
    code: "ARCH_B",
    title: "Edge Video & IoT Proxy Diode",
    ceiling: "800M Sust / 1G Max",
    mount: "1U Half / DIN (110mm)",
    cost: "$8,500",
  },
  {
    id: "ARCH_C_ENTERPRISE_1U_DIODE",
    code: "ARCH_C",
    title: "Enterprise 1U Multi-VLAN Diode",
    ceiling: "850M Sust / 16 VLANs",
    mount: '1U 19" Rack',
    cost: "$21,000",
  },
  {
    id: "ARCH_D_BIDIRECTIONAL_GATEWAY",
    code: "ARCH_D",
    title: "Controlled Bi-Directional Gateway",
    ceiling: "800M Fwd / 50M OT-Lock",
    mount: '1U 19" Rack',
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
  const [rackCardUrl, setRackCardUrl] = useState<string | null>(null);
  const [rackCardSource, setRackCardSource] = useState<string | null>(null);
  const [generatingRackCard, setGeneratingRackCard] = useState(false);

  useEffect(() => {
    setSubTab(userLens === "engineer_deep" ? "engineer_kit" : "sales_proposal");
  }, [userLens]);

  useEffect(() => {
    setRackCardUrl(null);
    setRackCardSource(null);
    setGeneratingRackCard(false);
  }, [scenario.id]);

  const handleGenerateRackCard = async () => {
    if (generatingRackCard) return;
    setGeneratingRackCard(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/visuals/rack-card`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario_id: scenario.id }),
      });
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        if (typeof data.image_url === "string" && data.image_url.length > 0) {
          setRackCardUrl(data.image_url);
          setRackCardSource(
            `${String(data.model ?? "muse-image-1.0")} (${String(
              data.source ?? "live"
            )})`
          );
          setExportNotice("Generated rack/DIN elevation card via muse-image-1.0");
          setTimeout(() => setExportNotice(null), 3500);
        }
      }
    } catch {
      setExportNotice("Backend offline — start FastAPI on :8008 for muse-image-1.0");
      setTimeout(() => setExportNotice(null), 3500);
    } finally {
      setGeneratingRackCard(false);
    }
  };

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
      setTimeout(() => setCopiedProposalEmail(false), 2400);
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
      const timer = setTimeout(() => controller.abort(), 5000);
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
        setExportNotice(`Downloaded ${kind.toUpperCase()} package.`);
        setTimeout(() => setExportNotice(null), 3200);
        return;
      }
    } catch {
      // Offline local export fallback
    }

    if (kind === "drawio") {
      const drawioXml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="ConduitAI" modified="2026-10-27T00:00:00.000Z" version="24.7.0">
  <diagram id="${scenario.conduitId}" name="${scenario.facilityName}">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" page="1" pageScale="1" pageWidth="1100" pageHeight="850">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="it_zone" value="Purdue L4 Enterprise IT (${scenario.conduitName})" style="rounded=1;fillColor=#f8fafc;strokeColor=#2563eb;fontColor=#0f172a;" vertex="1" parent="1">
          <mxGeometry x="260" y="60" width="520" height="90" as="geometry" />
        </mxCell>
        <mxCell id="diode_conduit" value="IEC 62443 ${scenario.postCutoverSl} Hardware Isolation: ${scenario.bom.items.map((i) => i.archetypeId).join(" + ")} (${scenario.bom.sizedBandwidthWithHeadroomMbps} Mbps @ 1.25x)" style="rounded=1;fillColor=#ecfdf5;strokeColor=#059669;fontColor=#065f46;fontStyle=1" vertex="1" parent="1">
          <mxGeometry x="260" y="230" width="520" height="90" as="geometry" />
        </mxCell>
        <mxCell id="ot_zone" value="Purdue L1-L3 Isolated OT Zone (${scenario.telemetry.totalDiscoveredAssets} Reconciled Endpoints)" style="rounded=1;fillColor=#f8fafc;strokeColor=#059669;fontColor=#0f172a;" vertex="1" parent="1">
          <mxGeometry x="260" y="400" width="520" height="110" as="geometry" />
        </mxCell>
        <mxCell id="edge_up" value="Unidirectional TX -> RX Stream (0-Bit Inbound)" style="edgeStyle=orthogonalEdgeStyle;strokeColor=#059669;strokeWidth=3;fontColor=#065f46;" edge="1" parent="1" source="ot_zone" target="diode_conduit">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="edge_rx" value="DMZ Replica Read-Only Poll" style="edgeStyle=orthogonalEdgeStyle;strokeColor=#2563eb;strokeWidth=2;fontColor=#1d4ed8;" edge="1" parent="1" source="diode_conduit" target="it_zone">
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
      setExportNotice(`Downloaded ${scenario.id}_target_sl4_conduit.drawio`);
    } else if (kind === "pdf") {
      const proposalMd = `# CONDUITAI — EXECUTIVE HARDWARE DATA DIODE CUTOVER PROPOSAL
Facility: ${scenario.facilityName} (${scenario.vertical})
Conduit: ${scenario.conduitId} (${scenario.preCutoverSl} -> ${scenario.postCutoverSl})

## 1. Bandwidth & Hardware Quote
- Peak Observed Traffic: ${scenario.bom.peakBandwidthMbps} Mbps (Sized w/ 25% buffer: ${scenario.bom.sizedBandwidthWithHeadroomMbps} Mbps)
- Recommended Hardware: ${scenario.bom.items.map((i) => `${i.quantity}x ${i.name} (${i.archetypeId}) @ $${i.unitCostUsd.toLocaleString()}`).join(", ")}
- Total Hardware Quote: $${scenario.bom.totalHardwareCostUsd.toLocaleString()} USD
- Physical Fit: ${scenario.bom.physicalFitStatus}

## 2. Digital Twin Verification
- Sandbox: ${scenario.digitalTwin.sandboxId}
- Operational Downtime: ${scenario.digitalTwin.operationalDowntimePct}%
- Inbound Exploit Drop: ${scenario.digitalTwin.inboundExploitDropPct}%

## 3. Compliance Standards
${scenario.compliance.map((c) => `- [${c.standard} ${c.clauseId}]: ${c.preCutoverState} -> ${c.postCutoverState}`).join("\n")}
`;
      triggerBrowserDownload(
        `${scenario.id}_executive_cutover_proposal.md`,
        proposalMd,
        "text/markdown"
      );
      setExportNotice(`Downloaded ${scenario.id}_executive_cutover_proposal.md`);
    } else {
      const bundleTxt = `# CONDUITAI CUTOVER SCRIPTS — ${scenario.id.toUpperCase()}
# Facility: ${scenario.facilityName}

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
      setExportNotice(`Downloaded ${scenario.id}_cutover_scripts_bundle.conf`);
    }
    setTimeout(() => setExportNotice(null), 3500);
  };

  return (
    <div className="space-y-4">
      {/* Clean 2-Tab Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-1.5 shadow-sm flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSubTab("sales_proposal")}
            className={`px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              subTab === "sales_proposal"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            Quote &amp; Compliance
          </button>

          <button
            type="button"
            onClick={() => setSubTab("engineer_kit")}
            className={`px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              subTab === "engineer_kit"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            Engineer Handoff
          </button>
        </div>

        {exportNotice && (
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            ✓ {exportNotice}
          </span>
        )}
      </div>

      {/* TAB 1: Quote & Compliance */}
      {subTab === "sales_proposal" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left (7 cols): Clean Hardware Quote Card */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between gap-4">
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-100">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-slate-500">
                        Recommended Hardware Quote
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                        3 Weeks Manual Audit → 60 Seconds
                      </span>
                    </div>
                    <h3 className="text-base font-semibold text-slate-900">
                      {scenario.facilityName}
                    </h3>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {scenario.bom.physicalFitStatus}
                    </span>
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-slate-500">Total Quote</div>
                    <div className="text-2xl font-bold text-slate-900 font-mono">
                      ${scenario.bom.totalHardwareCostUsd.toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* Line Items */}
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                  {scenario.bom.items.map((item) => (
                    <div
                      key={item.archetypeId}
                      className="p-3.5 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 border border-slate-200 text-xs font-mono font-semibold">
                            {item.quantity}x
                          </span>
                          <span className="text-sm font-semibold text-slate-900">
                            {item.name}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          {item.mountingOption} · Up to {item.sustainedCeilingMbps} Mbps sustained
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-sm font-semibold text-slate-900 font-mono">
                          ${item.extendedCostUsd.toLocaleString()}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          ${item.unitCostUsd.toLocaleString()} / unit
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Capacity is judged for the whole kit, so one diode is never compared with the site total */}
                <div className="mt-2 text-xs text-slate-600">
                  Kit carries {scenario.bom.sustainedCapacityMbps} Mbps sustained · site needs{" "}
                  {scenario.bom.sizedBandwidthWithHeadroomMbps} Mbps (peak × 1.25)
                </div>
              </div>

              <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 leading-relaxed">
                <span className="font-semibold text-slate-800">
                  Sizing Note:{" "}
                </span>
                {scenario.bom.sizingJustification}
              </p>
            </div>

            {/* Right (5 cols): Customer Proposal Email */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between gap-4">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-slate-600" />
                    <h4 className="text-sm font-semibold text-slate-900">
                      Customer Proposal Email
                    </h4>
                  </div>
                  <span className="text-xs text-slate-500">Ready to send</span>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs text-slate-700 max-h-52 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                  {proposalEmailText}
                </div>
              </div>

              <button
                type="button"
                onClick={handleCopyProposalEmail}
                className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium shadow-sm transition-colors ${
                  copiedProposalEmail
                    ? "bg-emerald-600 text-white"
                    : "bg-blue-600 hover:bg-blue-700 text-white"
                }`}
              >
                {copiedProposalEmail ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Copied Proposal Email</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copy Proposal Email</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Clean Compliance Standards Table */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-900">
                Compliance Standards Satisfied
              </h4>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                {scenario.preCutoverSl} → {scenario.postCutoverSl}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                    <th className="py-2.5 px-4">Standard</th>
                    <th className="py-2.5 px-4">Clause</th>
                    <th className="py-2.5 px-4">Before</th>
                    <th className="py-2.5 px-4">After</th>
                    <th className="py-2.5 px-4">Verification Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {scenario.compliance.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                        {row.standard}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                        {row.clauseId}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="inline-block px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 font-medium">
                          {row.preCutoverState}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="inline-block px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                          {row.postCutoverState}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-600 min-w-[18rem]">
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

      {/* TAB 2: Engineer Handoff */}
      {subTab === "engineer_kit" && (
        <div className="space-y-4">
          {/* 3 Clean Export Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <button
              type="button"
              onClick={() => handleExport("drawio")}
              className="bg-white hover:bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm text-left flex items-center justify-between gap-3 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2.5 rounded-lg bg-slate-100 text-slate-700 shrink-0">
                  <FileSpreadsheet className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">
                    .drawio Diagram
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    Editable architecture XML
                  </div>
                </div>
              </div>
              <Download className="w-4 h-4 text-slate-400 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => handleExport("pdf")}
              className="bg-white hover:bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm text-left flex items-center justify-between gap-3 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2.5 rounded-lg bg-slate-100 text-slate-700 shrink-0">
                  <FileText className="w-4 h-4" />
                </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      Executive Report (.pdf)
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      IEC 62443 compliance sign-off
                    </div>
                  </div>
                </div>
                <Download className="w-4 h-4 text-slate-400 shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => handleExport("zip")}
                className="bg-white hover:bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm text-left flex items-center justify-between gap-3 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2.5 rounded-lg bg-blue-50 text-blue-600 shrink-0">
                    <FileCode2 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      Cutover Bundle (.zip)
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      Switch CLI + TX/RX proxy configs
                    </div>
                  </div>
              </div>
              <Download className="w-4 h-4 text-blue-600 shrink-0" />
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left (7 cols): 4-Model Hardware Spec Table + 1.25x Headroom Bar */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
              {/* 1.25x Headroom Bar */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between text-xs">
                  <span className="font-semibold text-slate-900">
                    1.25× Throughput Sizing: {scenario.bom.peakBandwidthMbps}{" "}
                    Mbps peak →{" "}
                    <span className="text-blue-600 font-mono">
                      {scenario.bom.sizedBandwidthWithHeadroomMbps} Mbps
                    </span>
                  </span>
                  <span className="text-slate-500 font-mono">
                    {scenario.bom.sustainedCapacityMbps} Mbps capacity (
                    {utilizationPct}%)
                  </span>
                </div>

                <div className="relative h-2.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    style={{ width: `${utilizationPct}%` }}
                    className="h-full bg-emerald-500 transition-all duration-500"
                  />
                  <div
                    style={{ width: `${peakPct}%` }}
                    className="absolute top-0 left-0 h-full bg-blue-600"
                  />
                </div>
              </div>

              {/* Compact 4-Model Catalog Comparison Table */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-2.5 px-3">Archetype</th>
                      <th className="py-2.5 px-3">Hardware Class</th>
                      <th className="py-2.5 px-3">Capacity / Mount</th>
                      <th className="py-2.5 px-3 text-right">Unit Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {CATALOG_REFERENCE.map((arch) => {
                      const isSelected = selectedIds.has(arch.id);
                      return (
                        <tr
                          key={arch.id}
                          className={
                            isSelected ? "bg-emerald-50/60" : "bg-white"
                          }
                        >
                          <td className="py-2.5 px-3 font-mono font-semibold whitespace-nowrap">
                            <span className="text-slate-900">{arch.code}</span>
                            {isSelected && (
                              <span className="ml-1.5 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px]">
                                Selected
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-medium text-slate-900">
                            {arch.title}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 font-mono">
                            {arch.ceiling} · {arch.mount}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900">
                            {arch.cost}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right (5 cols): Copyable Switch Cutover CLI */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between gap-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">
                    Switch Cutover CLI
                  </h4>
                  <p className="text-xs text-slate-500">
                    VLAN isolation &amp; port lockdown commands
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleCopyCli}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-800 transition-colors"
                >
                  {copiedCli ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy CLI</span>
                    </>
                  )}
                </button>
              </div>

              <pre className="flex-1 rounded-lg bg-slate-900 text-slate-100 p-3.5 font-mono text-xs overflow-x-auto max-h-64 overflow-y-auto leading-relaxed">
                {scenario.bom.switchCutoverCli}
              </pre>
            </div>
          </div>

          {/* Live Meta muse-image-1.0 Rack / DIN Elevation Card Generator */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
                  <ImageIcon className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">
                    Hardware Rack / DIN-Rail Installation Card (Meta{" "}
                    <span className="font-mono text-xs text-indigo-700">
                      muse-image-1.0
                    </span>
                    )
                  </h4>
                  <p className="text-xs text-slate-500">
                    Synthesize an annotated field installation card for{" "}
                    {scenario.bom.items.map((i) => i.name).join(" + ")} (
                    {scenario.bom.physicalFitStatus})
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {rackCardUrl && (
                  <a
                    href={rackCardUrl}
                    download={`conduitai_${scenario.id}_rack_elevation.webp`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-800 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Save Image</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={handleGenerateRackCard}
                  disabled={generatingRackCard}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-medium shadow-sm transition-colors"
                >
                  {generatingRackCard ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Generating via muse-image-1.0...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>
                        {rackCardUrl
                          ? "Regenerate Rack Card"
                          : "Generate Rack Elevation Card"}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {rackCardUrl && (
              <div className="border border-slate-200 rounded-xl bg-slate-50 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500 px-1">
                  <span>
                    Target Conduit: {scenario.conduitId} ({scenario.postCutoverSl})
                  </span>
                  {rackCardSource && (
                    <span className="font-mono text-indigo-700">
                      {rackCardSource}
                    </span>
                  )}
                </div>
                <div className="flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={rackCardUrl}
                    alt={`${scenario.facilityName} Diode Installation Elevation`}
                    className="max-h-96 rounded-lg border border-slate-200 shadow-sm object-contain bg-white"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
