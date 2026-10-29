"use client";

import React from "react";
import {
  ShieldCheck,
  Play,
  Cloud,
  Lock,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Activity,
} from "lucide-react";
import {
  AgentTimelineStep,
  InferenceMode,
  ModelServiceHealth,
  ScenarioDataset,
  UserLensMode,
} from "@/types/conduit";
import { getGuidedNarrative } from "@/lib/guidedCopy";

interface WorkbenchHeaderProps {
  scenarios: ScenarioDataset[];
  selectedScenario: ScenarioDataset;
  onSelectScenario: (id: string) => void;
  userLens: UserLensMode;
  onChangeUserLens: (lens: UserLensMode) => void;
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
  userLens,
  onChangeUserLens,
  inferenceMode,
  onToggleInferenceMode,
  modelStack,
  backendConnected,
  isAssessing,
  onRunAssessment,
  timelineSteps,
  timelineExpanded,
  onToggleTimeline,
}: WorkbenchHeaderProps) {
  const completedSteps = timelineSteps.filter(
    (s) => s.status === "completed" || s.status === "alert"
  ).length;
  const isGuided = userLens === "guided_collab";
  const drawerOpen = timelineExpanded || isAssessing;

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
      {/* Single Clean 60px Top Bar */}
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 min-h-[60px] py-2 flex flex-wrap items-center justify-between gap-3">
        {/* Left: Brand + Facility Dropdown + API Status */}
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <span className="text-base font-bold tracking-tight text-slate-900">
              ConduitAI
            </span>
          </div>

          <div className="h-5 w-px bg-slate-200 hidden sm:block" />

          {/* Facility Selector Dropdown */}
          <select
            aria-label="Select Customer Facility"
            value={selectedScenario.id}
            onChange={(e) => onSelectScenario(e.target.value)}
            className="bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-3 py-1.5 text-xs sm:text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors cursor-pointer"
          >
            {scenarios.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {getGuidedNarrative(sc).selectLabel}
              </option>
            ))}
          </select>

          {/* Subtle API Status Pill */}
          <span
            className={`hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
              backendConnected
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-amber-50 text-amber-800 border-amber-200"
            }`}
            title={
              backendConnected
                ? "Connected to ConduitAI Backend (:8008)"
                : "Running deterministic offline benchmark dataset (:8008)"
            }
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                backendConnected ? "bg-emerald-500" : "bg-amber-500"
              }`}
            />
            {backendConnected ? "API Live" : "Offline Demo"}
          </span>
        </div>

        {/* Right: Mode Toggle + View Toggle + AI Pipeline Drawer Button + Run CTA */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Runtime Mode: Cloud AI vs Air-Gapped */}
          <div
            className="inline-flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200/80"
            role="group"
            aria-label="AI Runtime Mode"
          >
            <button
              type="button"
              onClick={() => onToggleInferenceMode("cloud_frontier")}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                inferenceMode === "cloud_frontier"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              title="Cloud Frontier AI (SAM 3.1, Muse Spark, Muse Wonder, Baseten)"
            >
              <Cloud className="w-3.5 h-3.5 text-blue-600" />
              <span>Cloud AI</span>
            </button>
            <button
              type="button"
              onClick={() => onToggleInferenceMode("airgapped_glimmer")}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                inferenceMode === "airgapped_glimmer"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              title="Air-gapped mode: reasoning runs on Meta open weights (Muse Spark Open), which a plant can host on its own hardware"
            >
              <Lock className="w-3.5 h-3.5 text-emerald-600" />
              <span>Air-Gapped</span>
            </button>
          </div>

          {/* View Lens: Simple View vs Engineer View */}
          <div
            className="inline-flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200/80"
            role="group"
            aria-label="Detail Level"
          >
            <button
              type="button"
              onClick={() => onChangeUserLens("guided_collab")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                isGuided
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Simple story
            </button>
            <button
              type="button"
              onClick={() => onChangeUserLens("engineer_deep")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                !isGuided
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Engineer detail
            </button>
          </div>

          {/* AI Pipeline (7/7) Drawer Toggle */}
          <button
            type="button"
            onClick={onToggleTimeline}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              drawerOpen
                ? "bg-slate-100 text-slate-900 border-slate-300"
                : "bg-white hover:bg-slate-50 text-slate-700 border-slate-200"
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-blue-600" />
            <span>
              AI Pipeline ({completedSteps}/{timelineSteps.length})
            </span>
            {drawerOpen ? (
              <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
            )}
          </button>

          {/* Primary Run Analysis Button */}
          <button
            type="button"
            onClick={onRunAssessment}
            disabled={isAssessing}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium shadow-sm transition-colors ${
              isAssessing
                ? "bg-blue-100 text-blue-800 border border-blue-200 cursor-wait"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            {isAssessing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Running...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Run Analysis</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Collapsible Clean Light AI Pipeline Drawer (Closed by Default; Auto-Opens While Running) */}
      {drawerOpen && (
        <div className="border-t border-slate-200 bg-slate-50/95">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-3 space-y-2.5">
            {/* 7 Meta & Open-Weights Model Pills */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-slate-500 mr-1">
                  Active Engines:
                </span>
                {modelStack.map((m) => {
                  const dotClass =
                    m.status === "online"
                      ? "bg-emerald-500"
                      : m.status === "airgapped"
                        ? "bg-blue-500"
                        : m.status === "simulated"
                          ? "bg-amber-500"
                          : m.status === "recorded"
                            ? "bg-violet-500"
                            : "bg-slate-300";
                  const statusNote =
                    m.status === "simulated"
                      ? "simulated (no credentials)"
                      : m.status === "recorded"
                        ? "no key on this server: replaying this model's recorded outputs"
                      : m.status === "standby"
                        ? "status unknown"
                        : m.status;
                  return (
                    <span
                      key={m.id}
                      title={`${m.label} — ${m.sublabel} (${m.provider}) · ${statusNote}`}
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white border border-slate-200 text-xs text-slate-700"
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
                      <span className="font-medium">{m.label}</span>
                      {m.status === "simulated" && (
                        <span className="text-[10px] text-amber-700">sim</span>
                      )}
                      {m.status === "recorded" && (
                        <span className="text-[10px] text-violet-700">rec</span>
                      )}
                    </span>
                  );
                })}
              </div>
              {!isAssessing && (
                <button
                  type="button"
                  onClick={onToggleTimeline}
                  className="text-xs text-slate-500 hover:text-slate-800 font-medium"
                >
                  Hide drawer
                </button>
              )}
            </div>

            {/* 7 Compact Pipeline Stage Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
              {timelineSteps.map((step) => {
                const isRunning = step.status === "running";
                const isDone = step.status === "completed";
                const isAlert = step.status === "alert";
                return (
                  <div
                    key={step.id}
                    className={`p-2.5 rounded-lg border bg-white transition-all ${
                      isRunning
                        ? "border-blue-400 ring-1 ring-blue-500/20"
                        : isAlert
                          ? "border-rose-200 bg-rose-50/40"
                          : isDone
                            ? "border-slate-200"
                            : "border-slate-200/70 opacity-65"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="text-[11px] font-mono text-slate-500 truncate">
                        {step.stepNumber}. {step.modelTag}
                      </span>
                      {isRunning ? (
                        <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin shrink-0" />
                      ) : isAlert ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                      ) : isDone ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-slate-300 shrink-0" />
                      )}
                    </div>
                    <div className="text-xs font-semibold text-slate-900 truncate">
                      {step.agentName}
                    </div>
                    <p className="text-[11px] text-slate-600 mt-0.5 line-clamp-2 leading-snug">
                      {step.status === "idle" ? step.headline : step.detail}
                    </p>
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
