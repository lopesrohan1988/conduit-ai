"use client";

import React from "react";
import {
  ShieldCheck,
  Zap,
  Cloud,
  Lock,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Activity,
  Radio,
} from "lucide-react";
import {
  AgentTimelineStep,
  InferenceMode,
  ModelServiceHealth,
  ScenarioDataset,
} from "@/types/conduit";

interface WorkbenchHeaderProps {
  scenarios: ScenarioDataset[];
  selectedScenario: ScenarioDataset;
  onSelectScenario: (id: string) => void;
  inferenceMode: InferenceMode;
  onToggleInferenceMode: (mode: InferenceMode) => void;
  modelStack: ModelServiceHealth[];
  backendConnected: boolean;
  isAssessing: boolean;
  assessmentCompleted: boolean;
  onRunAssessment: () => void;
  timelineSteps: AgentTimelineStep[];
  timelineExpanded: boolean;
  onToggleTimeline: () => void;
}

export default function WorkbenchHeader({
  scenarios,
  selectedScenario,
  onSelectScenario,
  inferenceMode,
  onToggleInferenceMode,
  modelStack,
  backendConnected,
  isAssessing,
  assessmentCompleted,
  onRunAssessment,
  timelineSteps,
  timelineExpanded,
  onToggleTimeline,
}: WorkbenchHeaderProps) {
  const completedSteps = timelineSteps.filter(
    (s) => s.status === "completed" || s.status === "alert"
  ).length;

  return (
    <header className="border-b border-slate-800 bg-slate-950/95 backdrop-blur sticky top-0 z-30">
      {/* Row 1: Brand Emblem + Mode Switch + Primary Autonomous Cutover CTA */}
      <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80">
        {/* Brand Identity */}
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-md bg-slate-900 border border-emerald-500/40 shadow-[0_0_20px_rgba(16,185,129,0.12)]">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <span className="absolute -bottom-1 -right-1 px-1 py-[1px] text-[9px] font-mono font-bold bg-emerald-500 text-slate-950 rounded">
              SL4
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-slate-100">
                Conduit<span className="text-emerald-400">AI</span>
              </h1>
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-slate-900 text-slate-300 border border-slate-800">
                IEC 62443 SL-4 Autonomous Data Diode Workbench
              </span>
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono border ${
                  backendConnected
                    ? "bg-emerald-950/60 text-emerald-300 border-emerald-500/40"
                    : "bg-slate-900 text-amber-300 border-amber-500/30"
                }`}
                title={
                  backendConnected
                    ? "Connected to FastAPI + LangGraph Backend (:8000)"
                    : "Running with Deterministic 6-Vertical Ground-Truth Cache (Backend :8000 Offline)"
                }
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    backendConnected
                      ? "bg-emerald-400 animate-pulse"
                      : "bg-amber-400"
                  }`}
                />
                {backendConnected ? "API LIVE :8000" : "OFFLINE TWIN READY"}
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Out-of-Band OT Isolation Sizing · SAM 3.1 Physical Fit · TX/RX
              Pull-to-Push Reversal · Modal{" "}
              <code className="text-slate-300">os.pipe()</code> Verification
            </p>
          </div>
        </div>

        {/* Right Controls: Runtime Mode Toggle + Primary CTA */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Runtime Mode Segmented Toggle */}
          <div
            className="inline-flex rounded-md bg-slate-900 p-0.5 border border-slate-800"
            role="group"
            aria-label="Inference Runtime Mode"
          >
            <button
              type="button"
              onClick={() => onToggleInferenceMode("cloud_frontier")}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                inferenceMode === "cloud_frontier"
                  ? "bg-sky-500/15 text-sky-300 border border-sky-500/40"
                  : "text-slate-400 hover:text-slate-200 border border-transparent"
              }`}
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>☁️ Cloud Frontier</span>
              <span className="hidden xl:inline text-[10px] font-mono text-sky-400/80">
                (Muse Spark + Wonder)
              </span>
            </button>
            <button
              type="button"
              onClick={() => onToggleInferenceMode("airgapped_glimmer")}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                inferenceMode === "airgapped_glimmer"
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
                  : "text-slate-400 hover:text-slate-200 border border-transparent"
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              <span>🔒 Air-Gapped On-Prem</span>
              <span className="hidden xl:inline text-[10px] font-mono text-emerald-400/80">
                (Muse Glimmer 30B)
              </span>
            </button>
          </div>

          {/* Primary CTA */}
          <button
            type="button"
            onClick={onRunAssessment}
            disabled={isAssessing}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs sm:text-sm font-semibold tracking-tight transition-all border ${
              isAssessing
                ? "bg-amber-500/20 text-amber-200 border-amber-500/50 cursor-wait"
                : "bg-emerald-500 hover:bg-emerald-400 text-slate-950 border-emerald-400 shadow-[0_0_24px_rgba(16,185,129,0.28)] active:scale-[0.99]"
            }`}
          >
            {isAssessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>
                  Running Pipeline ({completedSteps}/{timelineSteps.length})...
                </span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 fill-slate-950" />
                <span>⚡ Run Autonomous Cutover Assessment</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Row 2: 1-Click Critical Infrastructure Scenario Bar (6 Verticals) */}
      <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-2 border-b border-slate-800/80 bg-zinc-950/70">
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 shrink-0 mr-1">
            6-Vertical Benchmark:
          </span>
          {scenarios.map((sc) => {
            const active = sc.id === selectedScenario.id;
            const isRogue = Boolean(sc.isCriticalRogueScenario);
            return (
              <button
                key={sc.id}
                type="button"
                onClick={() => onSelectScenario(sc.id)}
                className={`group shrink-0 flex items-center gap-2 px-2.5 py-1.5 rounded text-xs transition-all border ${
                  active
                    ? isRogue
                      ? "bg-rose-950/50 text-rose-200 border-rose-500/60 shadow-[0_0_14px_rgba(244,63,94,0.18)]"
                      : "bg-slate-800/90 text-slate-100 border-emerald-500/50 shadow-[0_0_14px_rgba(16,185,129,0.12)]"
                    : "bg-slate-900/60 text-slate-400 border-slate-800 hover:bg-slate-900 hover:text-slate-200 hover:border-slate-700"
                }`}
              >
                <span
                  className={`inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-mono font-bold ${
                    active
                      ? isRogue
                        ? "bg-rose-500 text-slate-950"
                        : "bg-emerald-500 text-slate-950"
                      : "bg-slate-800 text-slate-400 group-hover:text-slate-200"
                  }`}
                >
                  {sc.shortIndex}
                </span>
                <span className="font-medium whitespace-nowrap">
                  {sc.shortLabel}
                </span>
                {isRogue && (
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Row 3: Meta & Open-Weights Stack Status Strip + Timeline Collapse Toggle */}
      <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-1.5 flex flex-wrap items-center justify-between gap-2 bg-slate-950">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-slate-500 shrink-0 mr-1">
            <Radio className="w-3 h-3 text-emerald-400" />
            Model Stack:
          </span>
          {modelStack.map((m) => {
            const dotClass =
              m.status === "online"
                ? "bg-emerald-400"
                : m.status === "airgapped"
                  ? "bg-sky-400"
                  : m.status === "simulated"
                    ? "bg-amber-400"
                    : "bg-slate-500";
            return (
              <div
                key={m.id}
                className="shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-900/90 border border-slate-800 text-[11px] font-mono"
                title={`${m.label} — ${m.sublabel} (${m.provider})`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
                <span className="text-slate-200 font-semibold">{m.label}</span>
                <span className="hidden 2xl:inline text-slate-500 text-[10px]">
                  {m.sublabel}
                </span>
              </div>
            );
          })}
        </div>

        {/* Execution Timeline Drawer Toggle */}
        <button
          type="button"
          onClick={onToggleTimeline}
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] font-mono text-slate-300 transition-colors"
        >
          <Activity className="w-3.5 h-3.5 text-emerald-400" />
          <span>
            Agent Trace ({completedSteps}/{timelineSteps.length})
          </span>
          {assessmentCompleted && !isAssessing && (
            <span className="px-1.5 py-[1px] rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px]">
              VERIFIED
            </span>
          )}
          {timelineExpanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          )}
        </button>
      </div>

      {/* Collapsible Live Multi-Agent Execution Timeline */}
      {timelineExpanded && (
        <div className="border-t border-slate-800 bg-zinc-950/95">
          <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
                <span className="uppercase tracking-wider text-slate-400">
                  LangGraph Multi-Agent Cutover Execution Trace
                </span>
                <span className="text-slate-600">|</span>
                <span className="text-emerald-400">
                  {inferenceMode === "airgapped_glimmer"
                    ? "Mode: Air-Gapped On-Prem (Muse Glimmer 30B Enclave)"
                    : "Mode: Cloud Frontier (Muse Spark + Muse Wonder + SAM 3.1)"}
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                Target: {selectedScenario.conduitId} (
                {selectedScenario.preCutoverSl} → {selectedScenario.postCutoverSl}
                )
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-2">
              {timelineSteps.map((step) => {
                const isRunning = step.status === "running";
                const isDone = step.status === "completed";
                const isAlert = step.status === "alert";
                return (
                  <div
                    key={step.id}
                    className={`p-2.5 rounded border transition-all ${
                      isRunning
                        ? "bg-amber-950/25 border-amber-500/60"
                        : isAlert
                          ? "bg-rose-950/30 border-rose-500/60"
                          : isDone
                            ? "bg-slate-900/90 border-emerald-500/40"
                            : "bg-slate-900/40 border-slate-800/80 opacity-75"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="text-[10px] font-mono text-slate-400">
                        0{step.stepNumber} · {step.modelTag}
                      </span>
                      {isRunning ? (
                        <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
                      ) : isAlert ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      ) : isDone ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-slate-700 shrink-0" />
                      )}
                    </div>
                    <div className="text-xs font-semibold text-slate-100 leading-snug line-clamp-1">
                      {step.agentName}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 leading-tight line-clamp-2">
                      {step.status === "idle" ? step.headline : step.detail}
                    </p>
                    {step.durationMs && (isDone || isAlert) && (
                      <div className="mt-1.5 text-[10px] font-mono text-emerald-400/90">
                        ✓ {step.durationMs}ms
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
