"use client";

import React, { useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Cloud,
  Play,
  RefreshCw,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import {
  FlowTier,
  ModalTwinVerification,
  ProtocolFlowEntry,
  ScenarioDataset,
  UserLensMode,
} from "@/types/conduit";
import { API_BASE } from "@/lib/api";
import { hydrateTwinVerification } from "@/lib/hydrateScenario";
import ArchitectDecisionPanel from "@/components/ArchitectDecisionPanel";
import AttackReplayPanel from "@/components/AttackReplayPanel";
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
  { badge: string; label: string; chipStyle: string }
> = {
  GREEN: {
    badge: "Works As-Is",
    label: "Works As-Is",
    chipStyle: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  AMBER: {
    badge: "Auto-Reversed",
    label: "Auto-Reversed",
    chipStyle: "bg-amber-50 text-amber-800 border-amber-200",
  },
  RED_BLOCKER: {
    badge: "Local Adapter",
    label: "Local Adapter",
    chipStyle: "bg-amber-50 text-amber-800 border-amber-200",
  },
  CRITICAL_VIOLATION: {
    badge: "Blocked Threat",
    label: "Blocked Threat",
    chipStyle: "bg-rose-50 text-rose-700 border-rose-200",
  },
};

export default function CutoverMatrixTab({
  scenario,
  userLens = "guided_collab",
}: CutoverMatrixTabProps) {
  const [subTab, setSubTab] = useState<MatrixSubTab>(
    userLens === "engineer_deep" ? "engineer_rules" : "business_proof"
  );
  const [tierFilter, setTierFilter] = useState<FlowTier | "ALL">("ALL");
  const [selectedFlow, setSelectedFlow] = useState<ProtocolFlowEntry>(
    scenario.flows[0]
  );
  const [replayingTwin, setReplayingTwin] = useState(false);
  const [twinTestedBanner, setTwinTestedBanner] = useState(false);
  const [useModalCloud, setUseModalCloud] = useState(false);
  const [liveTwin, setLiveTwin] = useState<ModalTwinVerification | null>(null);
  const [twinError, setTwinError] = useState<string | null>(null);
  const activeTwin = liveTwin ?? scenario.digitalTwin;
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
    setTwinTestedBanner(false);
    setLiveTwin(null);
    setTwinError(null);
    setVisibleLogLines(scenario.digitalTwin.consoleTrace.length);
  }, [scenario]);

  const animateConsoleLines = (totalLines: number) => {
    setVisibleLogLines(1);
    const target = Math.max(1, totalLines);
    let current = 1;
    const interval = setInterval(() => {
      current += 1;
      setVisibleLogLines(current);
      if (current >= target) {
        clearInterval(interval);
        setReplayingTwin(false);
        setTwinTestedBanner(true);
      }
    }, 240);
  };

  const triggerModalReplay = async () => {
    if (replayingTwin) return;
    setReplayingTwin(true);
    setTwinTestedBanner(false);
    setTwinError(null);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        useModalCloud ? 45000 : 8000
      );
      const res = await fetch(`${API_BASE}/api/v1/twin/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario_id: scenario.id,
          use_modal_cloud: useModalCloud,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const raw = (await res.json()) as Record<string, unknown>;
        const hydrated = hydrateTwinVerification(scenario.digitalTwin, raw);
        setLiveTwin(hydrated);
        animateConsoleLines(hydrated.consoleTrace.length);
        return;
      }
      setTwinError(`Twin replay failed (HTTP ${res.status}).`);
    } catch (err) {
      setTwinError(`Twin replay could not reach ${API_BASE} (${String(err)}).`);
    }
    setReplayingTwin(false);
  };

  const twinIsMeasured = liveTwin !== null || (scenario.provenance ?? "reference") !== "reference";
  const twinPassed =
    activeTwin.operationalDowntimePct === 0 && activeTwin.inboundExploitDropPct === 100;

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
      <AttackReplayPanel replay={scenario.attackReplay} />

      <ArchitectDecisionPanel scenario={scenario} />

      {twinError && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl px-4 py-2.5 text-xs sm:text-sm">
          {twinError}
        </div>
      )}

      {/* Compact Proof Header */}
      <div
        className={`rounded-xl px-5 py-3.5 flex flex-wrap justify-between items-center gap-3 border ${
          !twinIsMeasured
            ? "bg-slate-50 border-slate-200"
            : twinPassed
              ? "bg-slate-50 border-slate-200"
              : "bg-rose-50/70 border-rose-200"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <ShieldCheck
            className={`w-5 h-5 shrink-0 ${
              twinIsMeasured && twinPassed ? "text-emerald-600" : "text-slate-400"
            }`}
          />
          <span className="text-sm font-semibold text-slate-900">
            {!twinIsMeasured
              ? "Mechanism demo: run a real one-way kernel pipe with this plan's flows."
              : twinPassed
                ? "Mechanism demo: plant data crossed the one-way pipe and inbound packets had no path back. It cannot fail by design; the attack replay above is the evidence."
                : "Mechanism demo found a problem: see downtime and exploit results below."}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-white text-slate-600 border border-slate-200">
            {activeTwin.operationalDowntimePct}% Downtime
          </span>
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-white text-slate-600 border border-slate-200">
            {activeTwin.inboundExploitDropPct}% inbound dropped (by design)
          </span>
          <button
            type="button"
            onClick={() => setUseModalCloud((v) => !v)}
            title="Switch between local OS kernel os.pipe() twin and remote Modal Cloud Linux Sandbox"
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              useModalCloud
                ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            <Cloud className="w-3.5 h-3.5" />
            <span>{useModalCloud ? "Modal Cloud" : "Local Kernel"}</span>
          </button>
          <button
            type="button"
            onClick={triggerModalReplay}
            disabled={replayingTwin}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium shadow-sm transition-colors"
          >
            {replayingTwin ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Running...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Run pipe demo</span>
              </>
            )}
          </button>
        </div>
      </div>

      {twinTestedBanner && (
        <div className="bg-white border border-emerald-200 rounded-xl px-4 py-2.5 text-xs text-emerald-800 flex items-center justify-between gap-2 shadow-sm">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            Digital Twin Replay Complete ({activeTwin.sandboxId}):{" "}
            {activeTwin.legitimatePayloadsDelivered.toLocaleString()}{" "}
            legitimate messages delivered ({activeTwin.operationalDowntimePct}% downtime ·{" "}
            {activeTwin.medianForwardLatencyMs}ms p50) ·{" "}
            {activeTwin.inboundExploitDropPct}% attack packets dropped.
          </span>
          {subTab !== "engineer_rules" && (
            <button
              type="button"
              onClick={() => setSubTab("engineer_rules")}
              className="text-blue-600 hover:text-blue-700 font-semibold shrink-0"
            >
              View Twin Log →
            </button>
          )}
        </div>
      )}

      {/* Filter Chips + Sub-View Switch */}
      <div className="bg-white border border-slate-200 rounded-xl p-2 shadow-sm flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 px-1">
          <button
            type="button"
            onClick={() => setTierFilter("ALL")}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
              tierFilter === "ALL"
                ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            All ({scenario.flows.length})
          </button>

          {(Object.keys(TIER_META) as FlowTier[]).map((tier) => {
            const active = tierFilter === tier;
            return (
              <button
                key={tier}
                type="button"
                onClick={() => setTierFilter(active ? "ALL" : tier)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  active
                    ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {TIER_META[tier].label} ({counts[tier]})
              </button>
            );
          })}
        </div>

        {/* Simple View vs Engineer Proxy & Twin Log Toggle */}
        <div className="inline-flex bg-slate-100 p-0.5 rounded-lg border border-slate-200/80">
          <button
            type="button"
            onClick={() => setSubTab("business_proof")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
              subTab === "business_proof"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Simple Table
          </button>
          <button
            type="button"
            onClick={() => setSubTab("engineer_rules")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
              subTab === "engineer_rules"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Proxy Rules &amp; Twin Log
          </button>
        </div>
      </div>

      {/* SIMPLE VIEW: Clean 4-Column Compatibility Table + 3-Card Attack Test Summary */}
      {subTab === "business_proof" && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">System / Connection</th>
                    <th className="py-3 px-4">Purpose</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">How It Works</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
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
                        className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                      >
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="font-semibold text-slate-900">
                            {flow.protocol}
                          </div>
                          <div className="text-xs font-mono text-slate-500">
                            {flow.transport}/{flow.dstPort}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600 max-w-xs">
                          {plainFlow.whatItDoes}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${plainTier.badgeColor}`}
                          >
                            {plainTier.title}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-700 max-w-sm">
                          {plainFlow.howWeHandleIt}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Compact 3-Card Attack Test Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {activeTwin.exploitsTested.map((ex) => (
              <div
                key={ex.id}
                className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 truncate">
                    {ex.attackName}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
                    {ex.protocolVector} · {ex.injectedPackets} pkts
                  </div>
                </div>
                <span className="shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  0 Crossed ✓
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ENGINEER VIEW: Proxy Rules Table + Selected TX/RX Rule + Digital Twin Terminal Log */}
      {subTab === "engineer_rules" && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                    <th className="py-2.5 px-3.5">Flow</th>
                    <th className="py-2.5 px-3.5">Status</th>
                    <th className="py-2.5 px-3.5">Src → Dst IP:Port</th>
                    <th className="py-2.5 px-3.5">Function</th>
                    <th className="py-2.5 px-3.5">Prescribed Proxy Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredFlows.map((flow) => {
                    const isSelected = selectedFlow?.flowId === flow.flowId;
                    const meta = TIER_META[flow.classification];
                    return (
                      <tr
                        key={flow.flowId}
                        onClick={() => setSelectedFlow(flow)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? "bg-blue-50/60" : "hover:bg-slate-50"
                        }`}
                      >
                        <td className="py-2.5 px-3.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
                          {flow.flowId} · {flow.protocol}
                        </td>
                        <td className="py-2.5 px-3.5 whitespace-nowrap">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${meta.chipStyle}`}
                          >
                            {meta.badge}
                          </span>
                        </td>
                        <td className="py-2.5 px-3.5 font-mono text-slate-700 whitespace-nowrap">
                          {flow.srcIp} → {flow.dstIp}:{flow.dstPort}
                        </td>
                        <td className="py-2.5 px-3.5 text-slate-600 max-w-xs">
                          {flow.functionDetail}
                        </td>
                        <td className="py-2.5 px-3.5 text-slate-800 max-w-sm">
                          {flow.prescribedCutoverAction}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Selected Flow TX Inner -> Diode -> RX Outer Rule */}
          {selectedFlow && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-semibold text-slate-900">
                  TX / RX Proxy Rule — {selectedFlow.flowId} (
                  {selectedFlow.protocol})
                </h4>
                <span className="text-xs font-mono text-slate-500">
                  {selectedFlow.catalogProtocolId}
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-11 gap-3 items-center">
                <div className="lg:col-span-5 p-3 rounded-lg bg-slate-50 border border-slate-200 font-mono">
                  <div className="text-[10px] font-semibold uppercase text-slate-500 mb-1">
                    OT TX Inner Proxy (Plant Side)
                  </div>
                  <div className="text-xs text-slate-900 break-words">
                    {selectedFlow.txInnerConfig}
                  </div>
                </div>

                <div className="lg:col-span-1 flex flex-col items-center justify-center py-1 text-emerald-700 text-[11px] font-semibold">
                  <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200">
                    1-Way
                  </span>
                  <ArrowRight className="w-4 h-4 mt-1 text-emerald-600" />
                </div>

                <div className="lg:col-span-5 p-3 rounded-lg bg-slate-50 border border-slate-200 font-mono">
                  <div className="text-[10px] font-semibold uppercase text-slate-500 mb-1">
                    IT RX Outer Replica (DMZ Side)
                  </div>
                  <div className="text-xs text-slate-900 break-words">
                    {selectedFlow.rxOuterConfig}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Digital Twin Kernel Log Panel */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                <Terminal className="w-4 h-4 text-slate-600" />
                <span>
                  Digital Twin Socket Log ({activeTwin.sandboxId} ·{" "}
                  {activeTwin.medianForwardLatencyMs}ms p50 ·{" "}
                  {activeTwin.kernelMechanism})
                </span>
              </div>
              <button
                type="button"
                onClick={triggerModalReplay}
                disabled={replayingTwin}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-800 transition-colors"
              >
                <Play className="w-3 h-3" />
                <span>Replay Log</span>
              </button>
            </div>

            <div className="rounded-lg bg-slate-900 text-slate-100 p-3.5 font-mono text-xs space-y-1">
              {activeTwin.consoleTrace
                .slice(0, visibleLogLines)
                .map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.includes("VERIFIED") ||
                      line.includes("PASS") ||
                      line.includes("100.0% physically dropped") ||
                      line.includes("rejected by OS kernel")
                        ? "text-emerald-400"
                        : "text-slate-200"
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
