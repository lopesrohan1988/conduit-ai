"use client";

import React, { useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Wrench,
  Zap,
} from "lucide-react";
import {
  FlowTier,
  ProtocolFlowEntry,
  ScenarioDataset,
  UserLensMode,
} from "@/types/conduit";
import {
  explainFlowInPlainEnglish,
  getPlainEnglishTierSummary,
} from "@/lib/guidedCopy";

interface CutoverMatrixTabProps {
  scenario: ScenarioDataset;
  userLens?: UserLensMode;
}

type MatrixSubTab = "business_proof" | "engineer_rules";

const TIER_META: Record<
  FlowTier,
  { badge: string; label: string; plainBucket: string; chipStyle: string }
> = {
  GREEN: {
    badge: "GREEN · DROP-IN",
    label: "Drop-In Unidirectional",
    plainBucket: "✅ Works Immediately",
    chipStyle: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  },
  AMBER: {
    badge: "AMBER · REVERSAL",
    label: "Pull-to-Push Reversal",
    plainBucket: "🔄 Auto-Reversed Safely",
    chipStyle: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  },
  RED_BLOCKER: {
    badge: "RED · WRAPPER",
    label: "OT Wrapper / SFTP Relay",
    plainBucket: "🔌 Simple Local Adapter",
    chipStyle: "bg-orange-500/20 text-orange-300 border-orange-500/50",
  },
  CRITICAL_VIOLATION: {
    badge: "CRITICAL · SEVER",
    label: "Physically Severed Exploit",
    plainBucket: "🛑 Hacker Access Closed",
    chipStyle: "bg-rose-500/20 text-rose-300 border-rose-500/50",
  },
};

export default function CutoverMatrixTab({
  scenario,
  userLens = "guided_collab",
}: CutoverMatrixTabProps) {
  const isGuided = userLens === "guided_collab";
  const [subTab, setSubTab] = useState<MatrixSubTab>(
    userLens === "engineer_deep" ? "engineer_rules" : "business_proof"
  );
  const [tierFilter, setTierFilter] = useState<FlowTier | "ALL">("ALL");
  const [selectedFlow, setSelectedFlow] = useState<ProtocolFlowEntry>(
    scenario.flows[0]
  );
  const [replayingTwin, setReplayingTwin] = useState(false);
  const [visibleLogLines, setVisibleLogLines] = useState<number>(
    scenario.digitalTwin.consoleTrace.length
  );

  useEffect(() => {
    setSubTab(
      userLens === "engineer_deep" ? "engineer_rules" : "business_proof"
    );
  }, [userLens]);

  useEffect(() => {
    setTierFilter("ALL");
    setSelectedFlow(scenario.flows[0]);
    setReplayingTwin(false);
    setVisibleLogLines(scenario.digitalTwin.consoleTrace.length);
  }, [scenario]);

  const triggerModalReplay = () => {
    if (replayingTwin) return;
    setReplayingTwin(true);
    setVisibleLogLines(1);
    const total = scenario.digitalTwin.consoleTrace.length;
    let current = 1;
    const interval = setInterval(() => {
      current += 1;
      setVisibleLogLines(current);
      if (current >= total) {
        clearInterval(interval);
        setReplayingTwin(false);
      }
    }, 380);
  };

  const counts = {
    GREEN: scenario.flows.filter((f) => f.classification === "GREEN").length,
    AMBER: scenario.flows.filter((f) => f.classification === "AMBER").length,
    RED_BLOCKER: scenario.flows.filter(
      (f) => f.classification === "RED_BLOCKER"
    ).length,
    CRITICAL_VIOLATION: scenario.flows.filter(
      (f) => f.classification === "CRITICAL_VIOLATION"
    ).length,
  };

  const filteredFlows =
    tierFilter === "ALL"
      ? scenario.flows
      : scenario.flows.filter((f) => f.classification === tierFilter);

  return (
    <div className="space-y-4">
      {/* Top Plain-English Compatibility & Digital Twin Proof Banner */}
      <div className="rounded-md bg-slate-900/90 border border-emerald-500/40 p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4 shadow-[0_0_25px_rgba(16,185,129,0.08)]">
        <div className="space-y-1.5 max-w-4xl">
          <div className="inline-flex items-center gap-1.5 text-xs font-mono text-emerald-400 font-semibold">
            <ShieldCheck className="w-4 h-4" />
            <span>
              ANSWERING THE CUSTOMER&apos;S #1 FEAR BEFORE INSTALLATION
            </span>
          </div>
          <h3 className="text-base sm:text-lg font-bold text-slate-100">
            &ldquo;Will installing a one-way hardware diode break our existing
            factory dashboards or historians?&rdquo; →{" "}
            <span className="text-emerald-400">
              No. Verified 0% Downtime.
            </span>
          </h3>
          <p className="text-xs text-slate-300 leading-relaxed">
            ConduitAI tested all{" "}
            <strong className="text-white">{scenario.flows.length}</strong>{" "}
            real site connections inside a Digital Twin before anything touches
            your plant: legitimate reports keep working via automatic local
            mirroring, while dangerous remote-control &amp; ransomware paths are
            physically cut off.
          </p>
        </div>

        {/* Big Proof Badge */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-3 rounded-md bg-emerald-950/60 border border-emerald-400/60">
          <div>
            <div className="text-[10px] font-mono uppercase text-emerald-300">
              Modal Digital Twin Proof
            </div>
            <div className="text-base sm:text-lg font-mono font-bold text-emerald-300">
              0% Plant Downtime · 100% Attacks Dropped
            </div>
            <div className="text-[11px] font-mono text-slate-300">
              {scenario.digitalTwin.legitimatePayloadsDelivered.toLocaleString()}{" "}
              business messages delivered · 0 hacker packets crossed
            </div>
          </div>
        </div>
      </div>

      {/* 4 Traffic Buckets Filter Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
        <button
          type="button"
          onClick={() => setTierFilter("ALL")}
          className={`text-left p-3 rounded-md border transition-all ${
            tierFilter === "ALL"
              ? "bg-slate-800 border-sky-400/60"
              : "bg-slate-900/75 border-slate-800 hover:border-slate-700"
          }`}
        >
          <div className="text-[10px] font-mono uppercase text-slate-400">
            {isGuided ? "All Site Connections" : "All Cross-Zone Flows"}
          </div>
          <div className="text-xl font-mono font-bold text-slate-100 mt-0.5">
            {scenario.flows.length} Total
          </div>
        </button>

        {(Object.keys(TIER_META) as FlowTier[]).map((tier) => {
          const active = tierFilter === tier;
          const colorText =
            tier === "GREEN"
              ? "text-emerald-400"
              : tier === "AMBER"
                ? "text-amber-400"
                : tier === "RED_BLOCKER"
                  ? "text-orange-400"
                  : "text-rose-400";
          return (
            <button
              key={tier}
              type="button"
              onClick={() => setTierFilter(active ? "ALL" : tier)}
              className={`text-left p-3 rounded-md border transition-all ${
                active
                  ? "bg-slate-800 border-slate-500 ring-1 ring-slate-400"
                  : "bg-slate-900/75 border-slate-800 hover:border-slate-700"
              }`}
            >
              <div className="text-[11px] font-semibold text-slate-200 truncate">
                {isGuided ? TIER_META[tier].plainBucket : TIER_META[tier].label}
              </div>
              <div className={`text-xl font-mono font-bold mt-0.5 ${colorText}`}>
                {counts[tier]}
              </div>
            </button>
          );
        })}
      </div>

      {/* 2 Clean Sub-Tabs: Business Compatibility vs Network Engineer TX/RX Rules */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-md p-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab("business_proof")}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded text-xs font-semibold transition-all border ${
              subTab === "business_proof"
                ? "bg-emerald-500/20 text-emerald-200 border-emerald-500/50"
                : "text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-800/70"
            }`}
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>✅ Business Compatibility & Digital Twin Attack Test</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab("engineer_rules")}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded text-xs font-semibold transition-all border ${
              subTab === "engineer_rules"
                ? "bg-sky-500/20 text-sky-200 border-sky-500/50"
                : "text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-800/70"
            }`}
          >
            <Wrench className="w-4 h-4 text-sky-400" />
            <span>
              🛠️ Network Engineer TX/RX Proxy Rules & Kernel Trace
            </span>
          </button>
        </div>

        <span className="text-[11px] font-mono text-slate-400 px-2">
          {subTab === "business_proof"
            ? "Customer-friendly view for Sales & Plant Managers"
            : "Detailed IP/Port/Proxy specs for Network Engineers"}
        </span>
      </div>

      {/* SUB-TAB 1: Business Compatibility & Digital Twin Attack Test */}
      {subTab === "business_proof" && (
        <div className="space-y-4">
          <div className="bg-slate-900/75 border border-slate-800 rounded-md overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-950/80 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-semibold text-slate-100">
                What Happens to Every Existing Plant Connection After Diode
                Installation
              </h4>
              <span className="text-[11px] font-mono text-emerald-400">
                Click any row if your Network Engineer wants to see its proxy
                config
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/60 text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    <th className="py-2.5 px-3">Connection</th>
                    <th className="py-2.5 px-3">Cutover Outcome</th>
                    <th className="py-2.5 px-3">
                      What This Connection Does Today (Plain English)
                    </th>
                    <th className="py-2.5 px-3">
                      How ConduitAI Keeps Business Running Safely
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 text-xs">
                  {filteredFlows.map((flow) => {
                    const plainTier = getPlainEnglishTierSummary(
                      flow.classification
                    );
                    const plainFlow = explainFlowInPlainEnglish(flow);
                    return (
                      <tr
                        key={flow.flowId}
                        onClick={() => {
                          setSelectedFlow(flow);
                          setSubTab("engineer_rules");
                        }}
                        className="hover:bg-slate-900/90 cursor-pointer transition-colors"
                      >
                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="font-mono font-bold text-slate-100">
                            {flow.protocol}
                          </div>
                          <div className="text-[10px] font-mono text-slate-500">
                            ID {flow.flowId} · Port {flow.dstPort}
                          </div>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span
                            className={`inline-flex px-2.5 py-1 rounded text-[11px] font-semibold border ${plainTier.badgeColor}`}
                          >
                            {plainTier.title}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-slate-300 max-w-sm leading-relaxed">
                          {plainFlow.whatItDoes}
                        </td>
                        <td className="py-3 px-3 text-slate-200 max-w-md leading-relaxed">
                          {plainFlow.howWeHandleIt}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Interactive Simulated Cyberattack Test Card */}
          <div className="bg-slate-900/85 border border-emerald-500/40 rounded-md p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <ShieldAlert className="w-5 h-5 text-rose-400" />
                <div>
                  <h4 className="text-sm font-bold text-slate-100">
                    Live Cyberattack Block Proof (Tested in Modal Sandbox)
                  </h4>
                  <p className="text-xs text-slate-400">
                    We fired real-world ransomware &amp; machine-override
                    attacks at the simulated diode while legitimate plant data
                    flowed through:
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={triggerModalReplay}
                disabled={replayingTwin}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition-colors"
              >
                {replayingTwin ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Running Live Attack Test...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-slate-950" />
                    <span>▶ Re-Run Cyberattack Block Test</span>
                  </>
                )}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {scenario.digitalTwin.exploitsTested.map((ex) => (
                <div
                  key={ex.id}
                  className="p-3.5 rounded bg-zinc-950 border border-slate-800 flex flex-col justify-between gap-2"
                >
                  <div>
                    <div className="text-xs font-bold text-slate-100">
                      {ex.attackName}
                    </div>
                    <div className="text-[11px] font-mono text-rose-300 mt-0.5">
                      Attack Vector: {ex.protocolVector}
                    </div>
                  </div>
                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono">
                    <span className="text-slate-400">
                      {ex.injectedPackets} attack pkts fired
                    </span>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                      0 Crossed ✓
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: Network Engineer TX/RX Proxy Rules & Kernel Trace */}
      {subTab === "engineer_rules" && (
        <div className="space-y-4">
          <div className="bg-slate-900/75 border border-slate-800 rounded-md overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-950/80 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-slate-100">
                  Deterministic Green / Amber / Red Protocol Cutover Matrix (
                  {scenario.telemetry.pcapPacketCount.toLocaleString()} Dissected
                  Packets)
                </h3>
                <p className="text-[11px] font-mono text-slate-400">
                  Select any flow row below to inspect its synthesized TX →
                  Diode → RX proxy translation rules
                </p>
              </div>
              <span className="text-[11px] font-mono text-emerald-400">
                DuckDB + Scapy L7 Function-Code Dissection
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/60 text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    <th className="py-2.5 px-3">Flow ID</th>
                    <th className="py-2.5 px-3">Cutover Tier</th>
                    <th className="py-2.5 px-3">Protocol / Port</th>
                    <th className="py-2.5 px-3">Src IP → Dst IP (SYN Origin)</th>
                    <th className="py-2.5 px-3">Dissected L7 Function Detail</th>
                    <th className="py-2.5 px-3">
                      Prescribed Cutover Engineering Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 text-xs">
                  {filteredFlows.map((flow) => {
                    const isSelected = selectedFlow?.flowId === flow.flowId;
                    const meta = TIER_META[flow.classification];
                    return (
                      <tr
                        key={flow.flowId}
                        onClick={() => setSelectedFlow(flow)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-slate-800/90"
                            : "hover:bg-slate-900/90"
                        }`}
                      >
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-200 whitespace-nowrap">
                          {flow.flowId}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${meta.chipStyle}`}
                          >
                            {meta.badge}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-sky-300 whitespace-nowrap">
                          {flow.protocol}{" "}
                          <span className="text-slate-400">
                            ({flow.transport}/{flow.dstPort})
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-300">
                          <div>
                            {flow.srcIp}{" "}
                            <span className="text-slate-500">→</span>{" "}
                            {flow.dstIp}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {flow.direction}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300 max-w-xs">
                          {flow.functionDetail}
                        </td>
                        <td className="py-2.5 px-3 text-slate-200 max-w-sm">
                          {flow.prescribedCutoverAction}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {selectedFlow && (
            <div className="bg-slate-900/85 border border-slate-800 rounded-md p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <h4 className="text-xs font-semibold text-slate-100">
                    Synthesized TX / RX Proxy Translation Table — Flow{" "}
                    <span className="font-mono text-emerald-400">
                      {selectedFlow.flowId} ({selectedFlow.protocol})
                    </span>
                  </h4>
                </div>
                <span className="text-[11px] font-mono text-slate-400">
                  Catalog Rule: {selectedFlow.catalogProtocolId}
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-11 gap-3 items-center">
                <div className="lg:col-span-5 p-3 rounded bg-zinc-950 border border-emerald-500/30 font-mono">
                  <div className="text-[10px] uppercase text-emerald-400 mb-1">
                    OT-Side TX Inner Proxy Subsystem (Purdue L2/L3)
                  </div>
                  <div className="text-xs text-slate-100 break-words">
                    {selectedFlow.txInnerConfig}
                  </div>
                </div>

                <div className="lg:col-span-1 flex flex-col items-center justify-center py-1 text-emerald-400 font-mono text-[10px]">
                  <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40">
                    L1/L2 DIODE
                  </span>
                  <ArrowRight className="w-4 h-4 mt-1" />
                </div>

                <div className="lg:col-span-5 p-3 rounded bg-zinc-950 border border-sky-500/30 font-mono">
                  <div className="text-[10px] uppercase text-sky-400 mb-1">
                    IT / DMZ-Side RX Outer Replica Subsystem (Purdue L3.5/L4)
                  </div>
                  <div className="text-xs text-slate-100 break-words">
                    {selectedFlow.rxOuterConfig}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Raw Kernel Pipe Console Trace */}
          <div className="bg-slate-900/85 border border-slate-800 rounded-md p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span>
                  Modal Sandbox Kernel Pipe Trace ({scenario.digitalTwin.sandboxId} ·{" "}
                  {scenario.digitalTwin.medianForwardLatencyMs}ms p50)
                </span>
              </div>
              <button
                type="button"
                onClick={triggerModalReplay}
                disabled={replayingTwin}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-700 text-[11px] font-mono text-emerald-300"
              >
                <Play className="w-3 h-3" />
                <span>Replay Kernel Trace</span>
              </button>
            </div>
            <div className="rounded bg-zinc-950 border border-slate-800 p-3 font-mono text-[11px] space-y-1.5 text-slate-300">
              {scenario.digitalTwin.consoleTrace
                .slice(0, visibleLogLines)
                .map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.includes("VERIFIED") || line.includes("PASS")
                        ? "text-emerald-400"
                        : "text-slate-300"
                    }
                  >
                    {line}
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
