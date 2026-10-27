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
} from "lucide-react";
import {
  AgentTimelineStep,
  InferenceMode,
  ModelServiceHealth,
  ScenarioDataset,
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
import WorkbenchHeader from "@/components/WorkbenchHeader";
import IntakeVisionTab from "@/components/IntakeVisionTab";
import PurdueTopologyTab from "@/components/PurdueTopologyTab";
import CutoverMatrixTab from "@/components/CutoverMatrixTab";
import BomComplianceTab from "@/components/BomComplianceTab";

export default function ConduitWorkbenchPage() {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(
    FALLBACK_SCENARIOS[0].id
  );
  const [inferenceMode, setInferenceMode] =
    useState<InferenceMode>("cloud_frontier");
  const [activeTab, setActiveTab] = useState<WorkbenchTabId>("intake_vision");

  const [backendConnected, setBackendConnected] = useState<boolean>(false);
  const [modelStack, setModelStack] = useState<ModelServiceHealth[]>(() =>
    getDefaultModelStack("cloud_frontier")
  );

  const selectedScenario: ScenarioDataset = getScenarioById(selectedScenarioId);

  const [timelineSteps, setTimelineSteps] = useState<AgentTimelineStep[]>(() =>
    buildTimelineTemplate(FALLBACK_SCENARIOS[0], "cloud_frontier").map((s) => ({
      ...s,
      status: s.detail.includes("ALERT") || s.detail.includes("CRITICAL")
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

      base.forEach((step, idx) => {
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

  const tabs: Array<{
    id: WorkbenchTabId;
    label: string;
    shortBadge: string;
    icon: React.ReactNode;
  }> = [
    {
      id: "intake_vision",
      label: "1. SAM 3.1 Vision, .mp4 Video & Muse Voice",
      shortBadge: `${selectedScenario.samCabinetDetections.length} Masks · ASR`,
      icon: <Eye className="w-4 h-4" />,
    },
    {
      id: "purdue_topology",
      label: "2. Purdue L0–L5 Topology & Diode Cutover",
      shortBadge: `${selectedScenario.preCutoverSl} → ${selectedScenario.postCutoverSl}`,
      icon: <Network className="w-4 h-4" />,
    },
    {
      id: "cutover_matrix",
      label: "3. Green/Amber/Red Matrix & Modal Twin",
      shortBadge: `${selectedScenario.flows.length} Flows · 0% Down`,
      icon: <GitCompareArrows className="w-4 h-4" />,
    },
    {
      id: "bom_compliance",
      label: "4. Hardware BoM, IEC/NERC/CEA & Exports",
      shortBadge: `$${selectedScenario.bom.totalHardwareCostUsd.toLocaleString()}`,
      icon: <Server className="w-4 h-4" />,
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Top Mission-Control Header */}
      <WorkbenchHeader
        scenarios={FALLBACK_SCENARIOS}
        selectedScenario={selectedScenario}
        onSelectScenario={setSelectedScenarioId}
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
        {/* Scenario Telemetry Banner */}
        <section className="rounded-md bg-slate-900/75 border border-slate-800 p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[11px] font-mono text-sky-300">
                SCENARIO 0{selectedScenario.shortIndex} ·{" "}
                {selectedScenario.vertical.toUpperCase()}
              </span>
              {selectedScenario.isCriticalRogueScenario && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500 text-slate-950 text-[11px] font-mono font-bold">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  ACTIVE ROGUE 5G CELLULAR BYPASS DETECTED
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
            <p className="text-xs font-mono text-slate-400">
              Conduit <span className="text-slate-200">{selectedScenario.conduitId}</span>:{" "}
              {selectedScenario.conduitName}
            </p>
          </div>

          {/* High-Density Telemetry Readouts */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 shrink-0">
            <div className="px-3 py-2 rounded bg-zinc-950 border border-slate-800">
              <div className="text-[10px] font-mono uppercase text-slate-500">
                Peak / 1.25× Sized
              </div>
              <div className="text-sm font-mono font-bold text-slate-100 mt-0.5">
                {selectedScenario.telemetry.peakBandwidthMbps}M{" "}
                <span className="text-emerald-400">
                  → {selectedScenario.telemetry.sizedHeadroomMbps}M
                </span>
              </div>
            </div>

            <div className="px-3 py-2 rounded bg-zinc-950 border border-slate-800">
              <div className="text-[10px] font-mono uppercase text-slate-500">
                PCAP / FW Rows
              </div>
              <div className="text-sm font-mono font-bold text-sky-300 mt-0.5">
                {(selectedScenario.telemetry.pcapPacketCount / 1000).toFixed(0)}k
                pkts ·{" "}
                {(selectedScenario.telemetry.firewallRowCount / 1000).toFixed(0)}k
                rows
              </div>
            </div>

            <div className="px-3 py-2 rounded bg-zinc-950 border border-slate-800">
              <div className="text-[10px] font-mono uppercase text-slate-500">
                Shadow OT Drift
              </div>
              <div className="text-sm font-mono font-bold text-rose-400 mt-0.5">
                +{selectedScenario.telemetry.shadowAssetCount} Undocumented
              </div>
            </div>

            <div className="px-3 py-2 rounded bg-emerald-950/30 border border-emerald-500/40">
              <div className="text-[10px] font-mono uppercase text-emerald-300/80">
                IEC 62443 Posture
              </div>
              <div className="text-sm font-mono font-bold text-emerald-400 mt-0.5 flex items-center gap-1">
                <ShieldCheck className="w-4 h-4" />
                <span>
                  {selectedScenario.preCutoverSl} →{" "}
                  {selectedScenario.postCutoverSl}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* 4-Tab Consultant Workbench Navigation */}
        <nav
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2"
          aria-label="Consultant Workbench Tabs"
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-md text-left transition-all border ${
                  isActive
                    ? "bg-slate-900 text-slate-100 border-emerald-500/60 shadow-[0_0_18px_rgba(16,185,129,0.12)]"
                    : "bg-slate-900/40 text-slate-400 border-slate-800 hover:bg-slate-900/75 hover:text-slate-200"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={
                      isActive ? "text-emerald-400" : "text-slate-500"
                    }
                  >
                    {tab.icon}
                  </span>
                  <span className="text-xs font-semibold truncate">
                    {tab.label}
                  </span>
                </div>
                <span
                  className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono ${
                    isActive
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      : "bg-slate-950 text-slate-400 border border-slate-800"
                  }`}
                >
                  {tab.shortBadge}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Active Tab Viewport */}
        <section>
          {activeTab === "intake_vision" && (
            <IntakeVisionTab scenario={selectedScenario} />
          )}
          {activeTab === "purdue_topology" && (
            <PurdueTopologyTab scenario={selectedScenario} />
          )}
          {activeTab === "cutover_matrix" && (
            <CutoverMatrixTab scenario={selectedScenario} />
          )}
          {activeTab === "bom_compliance" && (
            <BomComplianceTab scenario={selectedScenario} />
          )}
        </section>
      </main>

      {/* Industrial Footer Telemetry Bar */}
      <footer className="border-t border-slate-800/90 bg-zinc-950 py-2.5 px-4 lg:px-6 mt-6">
        <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-500">
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-emerald-500" />
            <span>
              ConduitAI · Meta Global AI Developer Hackathon 2026 · Vendor-Neutral
              Hardware Diode Sizing (ARCH_A..D)
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 text-slate-400">
              <Upload className="w-3 h-3 text-sky-400" />
              Out-of-Band Sneakernet Artifacts: PCAP · Switch CLI · Diagram · Rack
              MP4 · Voice ASR
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
