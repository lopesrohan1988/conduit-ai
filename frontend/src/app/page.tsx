"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
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
import { hydrateScenarioFromBackendPayload } from "@/lib/hydrateScenario";
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
  shortName: string;
}

const WORKFLOW_STEPS: WorkflowStepMeta[] = [
  { id: "site_setup", stepNum: 1, shortName: "Site & Files" },
  { id: "intake_vision", stepNum: 2, shortName: "Space & Risks" },
  { id: "purdue_topology", stepNum: 3, shortName: "Security Map" },
  { id: "cutover_matrix", stepNum: 4, shortName: "Compatibility" },
  { id: "bom_compliance", stepNum: 5, shortName: "Quote & Kit" },
];

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
  const [liveOverrides, setLiveOverrides] = useState<
    Record<string, ScenarioDataset>
  >({});

  const baseScenario: ScenarioDataset = getScenarioById(selectedScenarioId);
  const selectedScenario: ScenarioDataset =
    liveOverrides[selectedScenarioId] ?? baseScenario;
  const narrative = getGuidedNarrative(selectedScenario);
  const isGuided = userLens === "guided_collab";

  const handleLivePayloadHydrate = useCallback(
    (payload: Record<string, unknown>, isCustomUpload?: boolean) => {
      setBackendConnected(true);
      setLiveOverrides((prev) => {
        const current =
          prev[selectedScenarioId] ?? getScenarioById(selectedScenarioId);
        return {
          ...prev,
          [selectedScenarioId]: hydrateScenarioFromBackendPayload(
            current,
            payload,
            { isCustomUpload }
          ),
        };
      });
    },
    [selectedScenarioId]
  );

  const [timelineSteps, setTimelineSteps] = useState<AgentTimelineStep[]>(() =>
    buildTimelineTemplate(FALLBACK_SCENARIOS[0], "cloud_frontier")
  );
  const [timelineExpanded, setTimelineExpanded] = useState<boolean>(false);
  const [isAssessing, setIsAssessing] = useState<boolean>(false);
  const [assessmentCompleted, setAssessmentCompleted] = useState<boolean>(false);
  const [runError, setRunError] = useState<string | null>(null);

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
    setRunError(null);

    const scenario = getScenarioById(selectedScenarioId);
    setTimelineSteps(buildTimelineTemplate(scenario, inferenceMode));

    let active = true;
    fetchScenarioPreview(selectedScenarioId).then((preview) => {
      if (!active) return;
      if (preview) {
        setBackendConnected(true);
      }
    });

    return () => {
      active = false;
    };
  }, [selectedScenarioId, inferenceMode, clearRunningStreams]);

  // Backend unreachable: say so instead of animating a pipeline that never ran
  const markBackendUnreachable = useCallback(
    (scenario: ScenarioDataset, mode: InferenceMode) => {
      setTimelineSteps(buildTimelineTemplate(scenario, mode));
      setIsAssessing(false);
      setBackendConnected(false);
      setRunError(
        `Backend unreachable at ${API_BASE}. Start it with "uv run uvicorn app.main:app --port 8008" — the screens below show reference data until a run completes.`
      );
    },
    []
  );

  // Primary CTA: Connect to SSE GET /api/v1/assessments/{id}/stream?inference_mode=...
  const handleRunAssessment = useCallback(() => {
    clearRunningStreams();
    setIsAssessing(true);
    setAssessmentCompleted(false);
    setRunError(null);
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
            if (
              parsed.architecture_plan ||
              parsed.twin_verification ||
              parsed.voice_transcript
            ) {
              setLiveOverrides((prev) => ({
                ...prev,
                [selectedScenarioId]: hydrateScenarioFromBackendPayload(
                  getScenarioById(selectedScenarioId),
                  parsed
                ),
              }));
            }
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
          markBackendUnreachable(scenario, inferenceMode);
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
      markBackendUnreachable(scenario, inferenceMode);
    }
  }, [
    clearRunningStreams,
    inferenceMode,
    markBackendUnreachable,
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

  const handleCustomAnalysisComplete = useCallback(
    (payload: Record<string, unknown>) => {
      clearRunningStreams();
      handleLivePayloadHydrate(payload, true);
      setIsAssessing(false);
      setAssessmentCompleted(true);
      setRunError(null);
      navigateToStep("intake_vision");
    },
    [clearRunningStreams, handleLivePayloadHydrate, navigateToStep]
  );

  const provenance = selectedScenario.provenance ?? "reference";
  const twin = selectedScenario.digitalTwin;

  const activeStepIndex = WORKFLOW_STEPS.findIndex((s) => s.id === activeTab);
  const currentStepMeta = WORKFLOW_STEPS[activeStepIndex] ?? WORKFLOW_STEPS[0];
  const prevStep =
    activeStepIndex > 0 ? WORKFLOW_STEPS[activeStepIndex - 1] : null;
  const nextStep =
    activeStepIndex < WORKFLOW_STEPS.length - 1
      ? WORKFLOW_STEPS[activeStepIndex + 1]
      : null;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Single 60px Clean White Top Bar */}
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

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-5 space-y-4">
        {/* Compact Site Summary Bar */}
        <section className="bg-white border border-slate-200 rounded-xl px-5 py-3.5 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base sm:text-lg font-semibold text-slate-900 tracking-tight">
                {selectedScenario.facilityName}
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                {narrative.industryBadge}
              </span>
              {selectedScenario.isCriticalRogueScenario && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
                  Rogue 5G Modem Detected
                </span>
              )}
              {!isGuided && (
                <span className="text-xs font-mono text-slate-500">
                  {selectedScenario.conduitId} · {selectedScenario.preCutoverSl}{" "}
                  → {selectedScenario.postCutoverSl}
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-slate-600 truncate">
              {narrative.businessGoal}
            </p>
          </div>

          {/* 4 Clean Key Numbers */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 lg:border-l lg:border-slate-200 lg:pl-6 shrink-0">
            <div>
              <div className="text-xs text-slate-500">Peak Traffic</div>
              <div className="text-sm font-semibold text-slate-900 font-mono">
                {selectedScenario.telemetry.peakBandwidthMbps} Mbps
              </div>
              <div className="text-[11px] text-slate-500 font-mono">
                {selectedScenario.telemetry.sizedHeadroomMbps} Mbps sized
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500">Unlisted Devices</div>
              <div
                className={`text-sm font-semibold font-mono ${
                  selectedScenario.isCriticalRogueScenario
                    ? "text-rose-700"
                    : "text-amber-700"
                }`}
              >
                {selectedScenario.telemetry.shadowAssetCount} Found
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500">Downtime</div>
              <div
                className={`text-sm font-semibold font-mono ${
                  twin.operationalDowntimePct === 0
                    ? "text-emerald-700"
                    : "text-rose-700"
                }`}
              >
                {twin.operationalDowntimePct}%
              </div>
              <div className="text-[11px] text-slate-500">
                {provenance === "reference" ? "reference" : "twin replay"}
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500">Est. Quote</div>
              <div className="text-sm font-semibold text-slate-900 font-mono">
                ${selectedScenario.bom.totalHardwareCostUsd.toLocaleString()}
              </div>
            </div>
          </div>
        </section>

        {runError ? (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl px-4 py-2.5 text-xs sm:text-sm">
            {runError}
          </div>
        ) : provenance === "reference" ? (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-2.5 text-xs sm:text-sm">
            {isAssessing
              ? "Pipeline running — results replace the reference data when the architect and twin finish."
              : "Showing hand-authored reference data for this sample site. Run Analysis to compute every number live from its pcap, firewall log, switch dump and photos."}
          </div>
        ) : (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl px-4 py-2.5 text-xs sm:text-sm">
            {provenance === "custom_upload"
              ? "Computed from your uploaded files"
              : "Computed live by the pipeline"}
            {" · architect: "}
            {selectedScenario.architectTrace?.accepted
              ? `${selectedScenario.architectTrace.model} proposed, verifier accepted (attempt ${selectedScenario.architectTrace.attempts.length})`
              : "deterministic rule engine"}
            {". Topology layout and the video overlay remain illustrative."}
          </div>
        )}

        {/* Simple 5-Step Stepper */}
        <nav
          className="bg-white border border-slate-200 rounded-xl p-1.5 shadow-sm grid grid-cols-2 sm:grid-cols-5 gap-1"
          aria-label="Workflow Steps"
        >
          {WORKFLOW_STEPS.map((step, idx) => {
            const isActive = activeTab === step.id;
            const isCompleted = idx < activeStepIndex;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => navigateToStep(step.id)}
                className={`px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all flex items-center justify-center gap-1.5 ${
                  isActive
                    ? "bg-blue-600 text-white shadow-sm"
                    : isCompleted
                      ? "text-slate-700 hover:bg-slate-50"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                {isCompleted && (
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                )}
                <span className="truncate">
                  {step.stepNum}. {step.shortName}
                </span>
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
              onLivePayloadHydrate={handleLivePayloadHydrate}
              onCustomAnalysisComplete={handleCustomAnalysisComplete}
              inferenceMode={inferenceMode}
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

        {/* Clean Bottom Step Navigation */}
        <section className="pt-2 pb-4 flex items-center justify-between gap-3">
          <div>
            {prevStep ? (
              <button
                type="button"
                onClick={() => navigateToStep(prevStep.id)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-xs sm:text-sm font-medium text-slate-700 shadow-sm transition-colors"
              >
                <ArrowLeft className="w-4 h-4 text-slate-500" />
                <span>Previous</span>
              </button>
            ) : (
              <span className="w-20 inline-block" />
            )}
          </div>

          <div className="text-xs font-medium text-slate-500">
            Step {currentStepMeta.stepNum} of 5
          </div>

          <div>
            {nextStep ? (
              <button
                type="button"
                onClick={() => navigateToStep(nextStep.id)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-medium shadow-sm transition-colors"
              >
                <span>Next: {nextStep.shortName}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigateToStep("site_setup")}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-xs sm:text-sm font-medium text-slate-700 shadow-sm transition-colors"
              >
                <span>← Back to Step 1</span>
              </button>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
