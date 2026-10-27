"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Eye,
  Network,
  GitCompareArrows,
  Server,
  AlertTriangle,
  ShieldCheck,
  Activity,
  Upload,
  FolderCheck,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import {
  AgentTimelineStep,
  InferenceMode,
  ModelServiceHealth,
  ScenarioDataset,
  UserLensMode,
  WorkbenchTabId,
} from "@/types/conduit";
import {
  buildTimelineTemplate,
  FALLBACK_SCENARIOS,
  getDefaultModelStack,
  getScenarioById,
} from "@/lib/fallbackData";
import {
  API_BASE,
  fetchBackendModelHealth,
  fetchBackendScenariosList,
  fetchScenarioPreview,
} from "@/lib/api";
import { getGuidedNarrative } from "@/lib/guidedCopy";
import WorkbenchHeader from "@/components/WorkbenchHeader";
import SiteIntakeStep from "@/components/SiteIntakeStep";
import IntakeVisionTab from "@/components/IntakeVisionTab";
import PurdueTopologyTab from "@/components/PurdueTopologyTab";
import CutoverMatrixTab from "@/components/CutoverMatrixTab";
import BomComplianceTab from "@/components/BomComplianceTab";

interface WorkflowStepMeta {
  id: WorkbenchTabId;
  stepNum: number;
  title: string;
  roleSubtitle: string;
  engineerSubtitle: string;
  shortBadge: string;
  verifiedTakeaway: string;
  icon: React.ReactNode;
}

export default function ConduitWorkbenchPage() {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(
    FALLBACK_SCENARIOS[0].id
  );
  const [userLens, setUserLens] = useState<UserLensMode>("guided_collab");
  const [inferenceMode, setInferenceMode] =
    useState<InferenceMode>("cloud_frontier");
  const [activeTab, setActiveTab] = useState<WorkbenchTabId>("site_setup");

  const [backendConnected, setBackendConnected] = useState<boolean>(false);
  const [modelStack, setModelStack] = useState<ModelServiceHealth[]>(() =>
    getDefaultModelStack("cloud_frontier")
  );

  const selectedScenario: ScenarioDataset = getScenarioById(selectedScenarioId);
  const narrative = getGuidedNarrative(selectedScenario);
  const isGuided = userLens === "guided_collab";

  const [timelineSteps, setTimelineSteps] = useState<AgentTimelineStep[]>(() =>
    buildTimelineTemplate(FALLBACK_SCENARIOS[0], "cloud_frontier").map((s) => ({
      ...s,
      status:
        s.detail.includes("ALERT") || s.detail.includes("CRITICAL")
          ? "alert"
          : "completed",
    }))
  );
  const [timelineExpanded, setTimelineExpanded] = useState<boolean>(false);
  const [isAssessing, setIsAssessing] = useState<boolean>(false);
  const [assessmentCompleted, setAssessmentCompleted] = useState<boolean>(true);
  const [previewSyncedTag, setPreviewSyncedTag] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const fallbackTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const clearRunningStreams = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    fallbackTimersRef.current.forEach((t) => clearTimeout(t));
    fallbackTimersRef.current = [];
  }, []);

  // Sync /api/v1/health/models and /api/v1/scenarios dynamically
  useEffect(() => {
    let active = true;
    setModelStack(getDefaultModelStack(inferenceMode));

    fetchBackendModelHealth(inferenceMode).then((health) => {
      if (!active) return;
      setBackendConnected(health.backendConnected);
      setModelStack(health.models);
    });

    fetchBackendScenariosList().then((ids) => {
      if (!active || !ids) return;
      if (ids.length > 0) {
        setBackendConnected(true);
      }
    });

    return () => {
      active = false;
    };
  }, [inferenceMode]);

  // Sync /api/v1/scenarios/{id}/preview when scenario or mode changes
  useEffect(() => {
    clearRunningStreams();
    setIsAssessing(false);
    setAssessmentCompleted(true);

    const scenario = getScenarioById(selectedScenarioId);
    const freshTemplate = buildTimelineTemplate(scenario, inferenceMode).map(
      (step) => ({
        ...step,
        status:
          step.detail.includes("ALERT") || step.detail.includes("CRITICAL")
            ? ("alert" as const)
            : ("completed" as const),
      })
    );
    setTimelineSteps(freshTemplate);

    let active = true;
    fetchScenarioPreview(selectedScenarioId).then((preview) => {
      if (!active) return;
      if (preview) {
        setBackendConnected(true);
        setPreviewSyncedTag(`Synced /scenarios/${selectedScenarioId}/preview`);
      } else {
        setPreviewSyncedTag(null);
      }
    });

    return () => {
      active = false;
    };
  }, [selectedScenarioId, inferenceMode, clearRunningStreams]);

  // Client-side multi-agent trace fallback when SSE backend is unreachable
  const runClientFallbackTrace = useCallback(
    (scenario: ScenarioDataset, mode: InferenceMode) => {
      const base = buildTimelineTemplate(scenario, mode);
      setTimelineSteps(
        base.map((step, idx) => ({
          ...step,
          status: idx === 0 ? "running" : "idle",
        }))
      );

      base.forEach((_, idx) => {
        const timer = setTimeout(() => {
          setTimelineSteps((prev) =>
            prev.map((item, i) => {
              if (i < idx) {
                return item;
              }
              if (i === idx) {
                const isCriticalStep =
                  item.detail.includes("ALERT") ||
                  item.detail.includes("CRITICAL");
                return {
                  ...item,
                  status: isCriticalStep ? "alert" : "completed",
                };
              }
              if (i === idx + 1) {
                return { ...item, status: "running" };
              }
              return item;
            })
          );

          if (idx === base.length - 1) {
            setIsAssessing(false);
            setAssessmentCompleted(true);
          }
        }, (idx + 1) * 340);

        fallbackTimersRef.current.push(timer);
      });
    },
    []
  );

  // Primary CTA: Connect to SSE GET /api/v1/assessments/{id}/stream?inference_mode=...
  const handleRunAssessment = useCallback(() => {
    clearRunningStreams();
    setIsAssessing(true);
    setAssessmentCompleted(false);
    setTimelineExpanded(true);

    const scenario = getScenarioById(selectedScenarioId);
    const initialSteps = buildTimelineTemplate(scenario, inferenceMode).map(
      (s, i) => ({
        ...s,
        status: i === 0 ? ("running" as const) : ("idle" as const),
      })
    );
    setTimelineSteps(initialSteps);

    const sseUrl = `${API_BASE}/api/v1/assessments/${encodeURIComponent(
      selectedScenarioId
    )}/stream?inference_mode=${encodeURIComponent(inferenceMode)}`;

    try {
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;
      let receivedAnyServerEvent = false;
      let currentIdx = 0;

      const handleIncomingPayload = (rawData: string) => {
        receivedAnyServerEvent = true;
        setBackendConnected(true);
        try {
          const parsed = JSON.parse(rawData) as Record<string, unknown>;
          const stageName = String(
            parsed.stage ?? parsed.event ?? parsed.type ?? ""
          ).toLowerCase();

          if (
            stageName === "complete" ||
            stageName === "done" ||
            parsed.done === true
          ) {
            setTimelineSteps((prev) =>
              prev.map((s) => ({
                ...s,
                status:
                  s.detail.includes("ALERT") || s.detail.includes("CRITICAL")
                    ? "alert"
                    : "completed",
              }))
            );
            setIsAssessing(false);
            setAssessmentCompleted(true);
            es.close();
            eventSourceRef.current = null;
            return;
          }

          const stepIndexFromPayload =
            typeof parsed.step_index === "number"
              ? parsed.step_index
              : currentIdx;
          const summaryMsg =
            typeof parsed.headline === "string"
              ? parsed.headline
              : typeof parsed.message === "string"
                ? parsed.message
                : typeof parsed.detail === "string"
                  ? parsed.detail
                  : undefined;

          setTimelineSteps((prev) =>
            prev.map((item, idx) => {
              if (idx === stepIndexFromPayload) {
                const updatedDetail = summaryMsg ?? item.detail;
                return {
                  ...item,
                  detail: updatedDetail,
                  status:
                    updatedDetail.includes("CRITICAL") ||
                    updatedDetail.includes("ALERT") ||
                    item.detail.includes("CRITICAL") ||
                    item.detail.includes("ALERT")
                      ? "alert"
                      : "completed",
                };
              }
              if (idx === stepIndexFromPayload + 1) {
                return { ...item, status: "running" };
              }
              return item;
            })
          );
          currentIdx = Math.min(stepIndexFromPayload + 1, 6);
        } catch {
          // Non-JSON keepalive ignored
        }
      };

      es.onmessage = (ev) => handleIncomingPayload(ev.data);
      [
        "step",
        "agent_update",
        "sam_3_1_vision",
        "muse_voice_asr",
        "baseten_switch_cli",
        "duckdb_telemetry",
        "muse_spark_reconcile",
        "muse_wonder_or_glimmer_architect",
        "modal_socket_twin",
      ].forEach((evtName) => {
        es.addEventListener(evtName, (ev) =>
          handleIncomingPayload((ev as MessageEvent).data)
        );
      });
      es.addEventListener("complete", (ev) =>
        handleIncomingPayload((ev as MessageEvent).data || '{"done":true}')
      );

      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;
        if (!receivedAnyServerEvent) {
          runClientFallbackTrace(scenario, inferenceMode);
        } else {
          setTimelineSteps((prev) =>
            prev.map((s) => ({
              ...s,
              status:
                s.detail.includes("ALERT") || s.detail.includes("CRITICAL")
                  ? "alert"
                  : "completed",
            }))
          );
          setIsAssessing(false);
          setAssessmentCompleted(true);
        }
      };
    } catch {
      runClientFallbackTrace(scenario, inferenceMode);
    }
  }, [
    clearRunningStreams,
    inferenceMode,
    runClientFallbackTrace,
    selectedScenarioId,
  ]);

  useEffect(() => {
    return () => clearRunningStreams();
  }, [clearRunningStreams]);

  const navigateToStep = useCallback((stepId: WorkbenchTabId) => {
    setActiveTab(stepId);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const handleAnalyzeAndAdvanceFromStep1 = useCallback(() => {
    handleRunAssessment();
    navigateToStep("intake_vision");
  }, [handleRunAssessment, navigateToStep]);

  const workflowSteps: WorkflowStepMeta[] = [
    {
      id: "site_setup",
      stepNum: 1,
      title: "Site Setup & File Request",
      roleSubtitle: "Sales + Customer IT Intake",
      engineerSubtitle: "Offline PCAP/CLI/Photo Bundle",
      shortBadge: "5 Files Ready",
      verifiedTakeaway:
        "Selected customer site & prepared safe read-only file request for the Network Engineer.",
      icon: <FolderCheck className="w-4 h-4" />,
    },
    {
      id: "intake_vision",
      stepNum: 2,
      title: "Cabinet Fit & Hidden Risks",
      roleSubtitle: "Physical Space + Unlisted Floor Gear",
      engineerSubtitle: "SAM 3.1 + Muse Voice + 3-Way Diff",
      shortBadge: selectedScenario.isCriticalRogueScenario
        ? "🚨 5G Bypass"
        : `${selectedScenario.shadowAssets.length} Unlisted`,
      verifiedTakeaway: `Confirmed physical rack/DIN space via SAM 3.1 & uncovered ${selectedScenario.shadowAssets.length} unlisted floor devices.`,
      icon: <Eye className="w-4 h-4" />,
    },
    {
      id: "purdue_topology",
      stepNum: 3,
      title: "Before vs. After Security Map",
      roleSubtitle: "Visual Customer Protection Story",
      engineerSubtitle: `Purdue L0–L5 (${selectedScenario.preCutoverSl} → ${selectedScenario.postCutoverSl})`,
      shortBadge: `${selectedScenario.preCutoverSl} → ${selectedScenario.postCutoverSl}`,
      verifiedTakeaway:
        "Showed visually how one-way hardware cuts off inbound attacks while keeping dashboards live.",
      icon: <Network className="w-4 h-4" />,
    },
    {
      id: "cutover_matrix",
      stepNum: 4,
      title: "Zero-Downtime Proof",
      roleSubtitle: '"Will Anything Break?" Answered',
      engineerSubtitle: "TX/RX Proxy Rules + Modal Twin",
      shortBadge: "0% Downtime",
      verifiedTakeaway: `Verified all ${selectedScenario.flows.length} site connections in the Digital Twin with 0% plant downtime & 100% attack drop.`,
      icon: <GitCompareArrows className="w-4 h-4" />,
    },
    {
      id: "bom_compliance",
      stepNum: 5,
      title: "Quote, ROI & Engineer Kit",
      roleSubtitle: "Sales Proposal + IT Handoff",
      engineerSubtitle: "ARCH_A..D BoM + CLI + Exports",
      shortBadge: `$${selectedScenario.bom.totalHardwareCostUsd.toLocaleString()}`,
      verifiedTakeaway: `Ready to close: $${selectedScenario.bom.totalHardwareCostUsd.toLocaleString()} hardware quote, executive email & IT cutover scripts ready.`,
      icon: <Server className="w-4 h-4" />,
    },
  ];

  const activeStepIndex = workflowSteps.findIndex((s) => s.id === activeTab);
  const currentStepMeta = workflowSteps[activeStepIndex] ?? workflowSteps[0];
  const prevStep =
    activeStepIndex > 0 ? workflowSteps[activeStepIndex - 1] : null;
  const nextStep =
    activeStepIndex < workflowSteps.length - 1
      ? workflowSteps[activeStepIndex + 1]
      : null;

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Top Mission-Control Header */}
      <WorkbenchHeader
        scenarios={FALLBACK_SCENARIOS}
        selectedScenario={selectedScenario}
        onSelectScenario={setSelectedScenarioId}
        userLens={userLens}
        onChangeUserLens={setUserLens}
        inferenceMode={inferenceMode}
        onToggleInferenceMode={setInferenceMode}
        modelStack={modelStack}
        backendConnected={backendConnected}
        isAssessing={isAssessing}
        assessmentCompleted={assessmentCompleted}
        onRunAssessment={handleRunAssessment}
        timelineSteps={timelineSteps}
        timelineExpanded={timelineExpanded}
        onToggleTimeline={() => setTimelineExpanded((v) => !v)}
      />

      {/* Main Consultant Workbench Workspace */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 lg:px-6 py-4 space-y-4">
        {/* Scenario Telemetry & Plain-English Situation Banner */}
        <section className="rounded-md bg-slate-900/75 border border-slate-800 p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="space-y-1 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[11px] font-mono text-sky-300">
                SITE 0{selectedScenario.shortIndex} ·{" "}
                {selectedScenario.vertical.toUpperCase()}
              </span>
              {selectedScenario.isCriticalRogueScenario && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500 text-slate-950 text-[11px] font-mono font-bold">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  ROGUE 5G CELLULAR BYPASS DETECTED
                </span>
              )}
              {previewSyncedTag && (
                <span className="text-[10px] font-mono text-emerald-400">
                  ● {previewSyncedTag}
                </span>
              )}
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-100 tracking-tight">
              {selectedScenario.facilityName}
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              {isGuided ? (
                <>
                  <strong className="text-emerald-400">Customer Goal: </strong>
                  {narrative.businessGoal}
                </>
              ) : (
                <span className="font-mono text-slate-400">
                  Conduit{" "}
                  <span className="text-slate-200">
                    {selectedScenario.conduitId}
                  </span>
                  : {selectedScenario.conduitName}
                </span>
              )}
            </p>
          </div>

          {/* Role-Aware KPI Cards (Plain-English in Guided Mode, Technical in Engineer Deep-Dive) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 shrink-0">
            <div
              className="px-3 py-2 rounded bg-zinc-950 border border-slate-800"
              title="Observed peak site traffic plus a 25% safety margin so the diode never bottlenecks"
            >
              <div className="text-[10px] font-mono uppercase text-slate-400">
                {isGuided
                  ? "Required Speed (+25% Buffer)"
                  : "Peak / 1.25× Sized"}
              </div>
              <div className="text-sm font-mono font-bold text-slate-100 mt-0.5">
                {selectedScenario.telemetry.peakBandwidthMbps}M{" "}
                <span className="text-emerald-400">
                  → {selectedScenario.telemetry.sizedHeadroomMbps} Mbps
                </span>
              </div>
            </div>

            <div
              className="px-3 py-2 rounded bg-zinc-950 border border-slate-800"
              title="Read-only network packets and firewall log rows analyzed offline"
            >
              <div className="text-[10px] font-mono uppercase text-slate-400">
                {isGuided ? "Site Traffic Analyzed" : "PCAP / FW Rows"}
              </div>
              <div className="text-sm font-mono font-bold text-sky-300 mt-0.5">
                {(selectedScenario.telemetry.pcapPacketCount / 1000).toFixed(0)}k
                pkts ·{" "}
                {(selectedScenario.telemetry.firewallRowCount / 1000).toFixed(0)}k
                logs
              </div>
            </div>

            <div
              className="px-3 py-2 rounded bg-zinc-950 border border-slate-800"
              title="Active machines found on the floor that were missing from the customer's diagram"
            >
              <div className="text-[10px] font-mono uppercase text-slate-400">
                {isGuided ? "Hidden Unlisted Devices" : "Shadow OT Drift"}
              </div>
              <div className="text-sm font-mono font-bold text-rose-400 mt-0.5">
                {selectedScenario.telemetry.shadowAssetCount} Found on Floor
              </div>
            </div>

            <div
              className="px-3 py-2 rounded bg-emerald-950/30 border border-emerald-500/40"
              title="Upgrades software firewall protection to IEC 62443 SL-4 physical one-way hardware isolation"
            >
              <div className="text-[10px] font-mono uppercase text-emerald-300/90">
                {isGuided ? "Protection Upgrade" : "IEC 62443 Posture"}
              </div>
              <div className="text-xs sm:text-sm font-mono font-bold text-emerald-400 mt-0.5 flex items-center gap-1">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>
                  {isGuided
                    ? `Firewall → 1-Way Lock (${selectedScenario.postCutoverSl})`
                    : `${selectedScenario.preCutoverSl} → ${selectedScenario.postCutoverSl}`}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* 5-Step Guided Workflow Stepper */}
        <nav
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2"
          aria-label="5-Step Guided Workflow"
        >
          {workflowSteps.map((step, idx) => {
            const isActive = activeTab === step.id;
            const isCompletedStep = idx < activeStepIndex;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => navigateToStep(step.id)}
                className={`p-3 rounded-md text-left transition-all border flex flex-col justify-between gap-1.5 ${
                  isActive
                    ? "bg-slate-900 text-slate-100 border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.16)]"
                    : isCompletedStep
                      ? "bg-slate-900/70 text-slate-200 border-emerald-500/30 hover:border-emerald-500/60"
                      : "bg-slate-900/40 text-slate-400 border-slate-800 hover:bg-slate-900/75 hover:text-slate-200"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-mono font-bold shrink-0 ${
                        isActive
                          ? "bg-emerald-400 text-slate-950"
                          : isCompletedStep
                            ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/50"
                            : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {isCompletedStep ? "✓" : step.stepNum}
                    </span>
                    <span className="text-xs font-bold truncate">
                      {step.title}
                    </span>
                  </div>

                  <span
                    className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono ${
                      isActive
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                        : "bg-slate-950 text-slate-400 border border-slate-800"
                    }`}
                  >
                    {step.shortBadge}
                  </span>
                </div>

                <div className="text-[11px] text-slate-400 pl-7 truncate">
                  {isGuided ? step.roleSubtitle : step.engineerSubtitle}
                </div>
              </button>
            );
          })}
        </nav>

        {/* Active Step Viewport */}
        <section>
          {activeTab === "site_setup" && (
            <SiteIntakeStep
              scenarios={FALLBACK_SCENARIOS}
              selectedScenario={selectedScenario}
              onSelectScenario={setSelectedScenarioId}
              userLens={userLens}
              onAnalyzeAndAdvance={handleAnalyzeAndAdvanceFromStep1}
            />
          )}
          {activeTab === "intake_vision" && (
            <IntakeVisionTab
              scenario={selectedScenario}
              userLens={userLens}
            />
          )}
          {activeTab === "purdue_topology" && (
            <PurdueTopologyTab
              scenario={selectedScenario}
              userLens={userLens}
            />
          )}
          {activeTab === "cutover_matrix" && (
            <CutoverMatrixTab
              scenario={selectedScenario}
              userLens={userLens}
            />
          )}
          {activeTab === "bom_compliance" && (
            <BomComplianceTab
              scenario={selectedScenario}
              userLens={userLens}
            />
          )}
        </section>

        {/* Bottom Guided Stepper Wizard Bar (Prev / Step Summary / Next) */}
        <section className="rounded-md bg-slate-900/90 border border-slate-800 p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            {prevStep ? (
              <button
                type="button"
                onClick={() => navigateToStep(prevStep.id)}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md bg-slate-950 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  Step {prevStep.stepNum}: {prevStep.title}
                </span>
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-mono text-emerald-400 px-1">
                <CheckCircle2 className="w-4 h-4" />
                <span>Start Here: Guided 5-Step Workflow</span>
              </span>
            )}
          </div>

          <div className="text-center px-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              Step {currentStepMeta.stepNum} of 5 Summary
            </div>
            <div className="text-xs text-slate-200 mt-0.5">
              {currentStepMeta.verifiedTakeaway}
            </div>
          </div>

          <div>
            {nextStep ? (
              <button
                type="button"
                onClick={() => navigateToStep(nextStep.id)}
                className="w-full md:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-[0_0_20px_rgba(16,185,129,0.25)] transition-all"
              >
                <span>
                  Continue to Step {nextStep.stepNum}: {nextStep.title}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigateToStep("site_setup")}
                className="w-full md:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/50 text-sky-200 text-xs font-semibold transition-all"
              >
                <span>↺ Assess Another Customer Site (Back to Step 1)</span>
              </button>
            )}
          </div>
        </section>
      </main>

      {/* Industrial Footer Telemetry Bar */}
      <footer className="border-t border-slate-800/90 bg-zinc-950 py-2.5 px-4 lg:px-6 mt-4">
        <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-500">
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-emerald-500" />
            <span>
              ConduitAI · Sales + Network Engineer Guided Workbench ·
              Vendor-Neutral Hardware Diode Sizing (ARCH_A..D)
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 text-slate-400">
              <Upload className="w-3 h-3 text-sky-400" />
              100% Offline Safe Artifacts: Diagram · Cabinet Photo/MP4 · Voice
              Memo · Read-Only Switch &amp; PCAP
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
