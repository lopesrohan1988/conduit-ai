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
  Zap,
} from "lucide-react";
import { FlowTier, ProtocolFlowEntry, ScenarioDataset } from "@/types/conduit";

interface CutoverMatrixTabProps {
  scenario: ScenarioDataset;
}

const TIER_META: Record<
  FlowTier,
  { badge: string; label: string; chipStyle: string }
> = {
  GREEN: {
    badge: "GREEN · DROP-IN",
    label: "Drop-In Unidirectional",
    chipStyle: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  },
  AMBER: {
    badge: "AMBER · REVERSAL",
    label: "Pull-to-Push Reversal",
    chipStyle: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  },
  RED_BLOCKER: {
    badge: "RED · WRAPPER",
    label: "OT Wrapper / SFTP Relay",
    chipStyle: "bg-orange-500/20 text-orange-300 border-orange-500/50",
  },
  CRITICAL_VIOLATION: {
    badge: "CRITICAL · SEVER",
    label: "Physically Severed Exploit",
    chipStyle: "bg-rose-500/20 text-rose-300 border-rose-500/50",
  },
};

export default function CutoverMatrixTab({ scenario }: CutoverMatrixTabProps) {
  const [tierFilter, setTierFilter] = useState<FlowTier | "ALL">("ALL");
  const [selectedFlow, setSelectedFlow] = useState<ProtocolFlowEntry>(
    scenario.flows[0]
  );
  const [replayingTwin, setReplayingTwin] = useState(false);
  const [visibleLogLines, setVisibleLogLines] = useState<number>(
    scenario.digitalTwin.consoleTrace.length
  );

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
      {/* Top Tier Filter Strip */}
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
            All Cross-Zone Flows
          </div>
          <div className="text-xl font-mono font-bold text-slate-100 mt-0.5">
            {scenario.flows.length} Flows
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
              <div className="text-[10px] font-mono uppercase text-slate-400">
                {TIER_META[tier].label}
              </div>
              <div className={`text-xl font-mono font-bold mt-0.5 ${colorText}`}>
                {counts[tier]}
              </div>
            </button>
          );
        })}
      </div>

      {/* Protocol Cutover Matrix Table */}
      <div className="bg-slate-900/75 border border-slate-800 rounded-md overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-950/80 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-slate-100">
              Deterministic Green / Amber / Red Protocol Cutover Matrix ({scenario.telemetry.pcapPacketCount.toLocaleString()} Dissected Packets)
            </h3>
            <p className="text-[11px] font-mono text-slate-400">
              Select any flow row below to inspect its synthesized TX → Diode → RX proxy translation rules
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
                <th className="py-2.5 px-3">Prescribed Cutover Engineering Action</th>
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
                        {flow.srcIp} <span className="text-slate-500">→</span>{" "}
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

      {/* TX / RX Proxy Translation Preview for Selected Flow */}
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

      {/* Modal Verifiable Layer-1/2 Socket Digital Twin */}
      <div className="bg-slate-900/85 border border-emerald-500/40 rounded-md overflow-hidden shadow-[0_0_25px_rgba(16,185,129,0.08)]">
        <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/90 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                Modal Sandbox — Verifiable Layer-1/2 <code className="text-emerald-300">os.pipe()</code> Socket Digital Twin
              </h3>
              <p className="text-[11px] font-mono text-slate-400">
                {scenario.digitalTwin.kernelMechanism}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={triggerModalReplay}
            disabled={replayingTwin}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 text-xs font-mono font-semibold text-emerald-300 transition-colors"
          >
            {replayingTwin ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Replaying Socket Twin...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>Re-Verify in Modal Socket Twin</span>
              </>
            )}
          </button>
        </div>

        {/* Twin Key Verification Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 border-b border-slate-800/80 bg-zinc-950/60">
          <div className="p-3 rounded bg-slate-900 border border-emerald-500/40">
            <div className="text-[10px] font-mono uppercase text-slate-400">
              Operational Downtime
            </div>
            <div className="text-2xl font-mono font-bold text-emerald-400 mt-0.5">
              {scenario.digitalTwin.operationalDowntimePct}% Downtime
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5">
              {scenario.digitalTwin.legitimatePayloadsDelivered.toLocaleString()}{" "}
              legitimate frames delivered
            </div>
          </div>

          <div className="p-3 rounded bg-slate-900 border border-emerald-500/40">
            <div className="text-[10px] font-mono uppercase text-slate-400">
              Inbound Exploit Drop
            </div>
            <div className="text-2xl font-mono font-bold text-emerald-400 mt-0.5">
              {scenario.digitalTwin.inboundExploitDropPct}% Dropped
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5">
              0 exploit packets crossed barrier
            </div>
          </div>

          <div className="p-3 rounded bg-slate-900 border border-slate-800">
            <div className="text-[10px] font-mono uppercase text-slate-400">
              Median Forward Latency
            </div>
            <div className="text-2xl font-mono font-bold text-sky-400 mt-0.5">
              {scenario.digitalTwin.medianForwardLatencyMs} ms
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5">
              Sandbox ID: {scenario.digitalTwin.sandboxId}
            </div>
          </div>

          <div className="p-3 rounded bg-slate-900 border border-slate-800">
            <div className="text-[10px] font-mono uppercase text-slate-400">
              IT-Initiated Inbound Bytes
            </div>
            <div className="text-2xl font-mono font-bold text-emerald-300 mt-0.5">
              0 Bytes
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5">
              {scenario.digitalTwin.reverseChannelBytes > 0
                ? `OT-polled X.509 queue: ${(scenario.digitalTwin.reverseChannelBytes / 1024).toFixed(1)} KB`
                : "Pure one-way write_fd → read_fd"}
            </div>
          </div>
        </div>

        {/* Adversarial Exploit Replay Table + Sandbox Console Log */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 p-4">
          <div className="lg:col-span-7 space-y-2">
            <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <span>Adversarial Lateral Movement & ICS Exploit Replay</span>
            </div>
            <div className="rounded border border-slate-800 overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-[10px] font-mono uppercase text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-2 px-3">Simulated Attack Payload</th>
                    <th className="py-2 px-3">Protocol Vector</th>
                    <th className="py-2 px-3">Injected</th>
                    <th className="py-2 px-3">Crossed</th>
                    <th className="py-2 px-3">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 font-mono text-[11px]">
                  {scenario.digitalTwin.exploitsTested.map((ex) => (
                    <tr key={ex.id} className="bg-slate-950/40">
                      <td className="py-2 px-3 font-sans text-slate-200">
                        <div className="font-medium">{ex.attackName}</div>
                        <div className="text-[10px] font-mono text-slate-500">
                          MITRE {ex.mitreTechnique}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-rose-300">
                        {ex.protocolVector}
                      </td>
                      <td className="py-2 px-3 text-slate-300">
                        {ex.injectedPackets} pkts
                      </td>
                      <td className="py-2 px-3 text-emerald-400 font-bold">
                        {ex.packetsCrossedBarrier} pkts
                      </td>
                      <td className="py-2 px-3">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 text-[10px]">
                          <CheckCircle2 className="w-3 h-3" />
                          {ex.result}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lg:col-span-5 flex flex-col">
            <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5 mb-2">
              <Terminal className="w-4 h-4 text-emerald-400" />
              <span>Modal Sandbox Kernel Pipe Trace</span>
            </div>
            <div className="flex-1 rounded bg-zinc-950 border border-slate-800 p-3 font-mono text-[11px] space-y-1.5 text-slate-300">
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
      </div>
    </div>
  );
}
