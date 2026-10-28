"use client";

import React, { useRef, useState } from "react";
import {
  ArrowRight,
  Camera,
  Check,
  ClipboardCopy,
  FileSpreadsheet,
  FileText,
  Mic,
  Square,
  Upload,
  Video,
} from "lucide-react";
import { ScenarioDataset, UserLensMode } from "@/types/conduit";
import { API_BASE } from "@/lib/api";
import { encodeAudioBlobToWav } from "@/lib/hydrateScenario";
import {
  buildNetworkEngineerRequestTemplate,
  getGuidedNarrative,
} from "@/lib/guidedCopy";

interface SiteIntakeStepProps {
  scenarios: ScenarioDataset[];
  selectedScenario: ScenarioDataset;
  onSelectScenario: (id: string) => void;
  userLens: UserLensMode;
  onAnalyzeAndAdvance: () => void;
  onLivePayloadHydrate?: (
    payload: Record<string, unknown>,
    isCustomUpload?: boolean
  ) => void;
}

export default function SiteIntakeStep({
  scenarios,
  selectedScenario,
  onSelectScenario,
  userLens,
  onAnalyzeAndAdvance,
  onLivePayloadHydrate,
}: SiteIntakeStepProps) {
  const [copiedChecklist, setCopiedChecklist] = useState(false);
  const [customAttachedNames, setCustomAttachedNames] = useState<
    Record<string, string>
  >({});
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [isRecordingMic, setIsRecordingMic] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingSlotKey, setPendingSlotKey] = useState<string | null>(null);

  const isGuided = userLens === "guided_collab";
  const requestEmailText = buildNetworkEngineerRequestTemplate(selectedScenario);

  const handleCopyEngineerRequest = async () => {
    try {
      await navigator.clipboard.writeText(requestEmailText);
      setCopiedChecklist(true);
      setTimeout(() => setCopiedChecklist(false), 2400);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const triggerSlotUpload = (slotKey: string) => {
    setPendingSlotKey(slotKey);
    fileInputRef.current?.click();
  };

  const toggleMicRecording = async () => {
    if (isRecordingMic && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecordingMic(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const rawBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        setUploadingSlot("voice");
        const wavBlob = await encodeAudioBlobToWav(rawBlob);
        const recName = `live_walkdown_${Date.now().toString().slice(-4)}.wav`;
        setCustomAttachedNames((prev) => ({ ...prev, voice: recName }));

        const form = new FormData();
        form.append("file", wavBlob, recName);
        form.append("scenario_id", selectedScenario.id);
        try {
          const res = await fetch(`${API_BASE}/api/v1/voice/transcribe`, {
            method: "POST",
            body: form,
          });
          if (res.ok) {
            const vt = (await res.json()) as Record<string, unknown>;
            onLivePayloadHydrate?.({ voice_transcript: vt }, false);
          }
        } catch {
          // Offline fallback preserved
        } finally {
          setUploadingSlot(null);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecordingMic(true);
    } catch {
      setIsRecordingMic(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !pendingSlotKey) return;

    const slot = pendingSlotKey;
    setCustomAttachedNames((prev) => ({
      ...prev,
      [slot]: file.name,
    }));
    setUploadingSlot(slot);

    const form = new FormData();
    try {
      if (slot === "voice") {
        form.append("file", file);
        form.append("scenario_id", selectedScenario.id);
        const res = await fetch(`${API_BASE}/api/v1/voice/transcribe`, {
          method: "POST",
          body: form,
        });
        if (res.ok) {
          const vt = (await res.json()) as Record<string, unknown>;
          onLivePayloadHydrate?.({ voice_transcript: vt }, false);
        }
      } else {
        const lower = file.name.toLowerCase();
        const fieldMap: Record<string, string> = {
          diagram: "diagram_file",
          cabinet: "cabinet_file",
          video: "video_file",
          logs: lower.endsWith(".csv")
            ? lower.includes("inventory")
              ? "asset_inventory_file"
              : "firewall_csv_file"
            : lower.endsWith(".txt") || lower.endsWith(".conf")
              ? "switch_dump_file"
              : "pcap_file",
        };
        form.append(fieldMap[slot] ?? "pcap_file", file);
        form.append("facility_name", `${selectedScenario.shortLabel} (Custom Intake)`);
        const res = await fetch(
          `${API_BASE}/api/v1/assessments/custom/analyze?live_llm=true`,
          {
            method: "POST",
            body: form,
          }
        );
        if (res.ok) {
          const body = (await res.json()) as Record<string, unknown>;
          onLivePayloadHydrate?.(body, true);
        }
      }
    } catch {
      // Offline mode fallback preserved
    } finally {
      setUploadingSlot(null);
    }
  };

  const artifacts = [
    {
      key: "diagram",
      title: "Network Diagram",
      filename:
        customAttachedNames.diagram ??
        selectedScenario.mediaPaths.topologyDiagramRel.split("/").pop(),
      engineTag: "SAM 3.1",
      icon: <FileText className="w-4 h-4 text-slate-600" />,
    },
    {
      key: "cabinet",
      title: "Rack / Cabinet Photo",
      filename:
        customAttachedNames.cabinet ??
        selectedScenario.mediaPaths.cabinetPhotoRel.split("/").pop(),
      engineTag: "SAM 3.1",
      icon: <Camera className="w-4 h-4 text-slate-600" />,
    },
    {
      key: "video",
      title: "Rack Walkthrough Video",
      filename:
        customAttachedNames.video ??
        selectedScenario.mediaPaths.walkthroughVideoRel.split("/").pop(),
      engineTag: "SAM 3.1 24fps",
      icon: <Video className="w-4 h-4 text-slate-600" />,
    },
    {
      key: "voice",
      title: "Technician Voice Memo",
      filename:
        customAttachedNames.voice ?? selectedScenario.voiceNote.audioFilename,
      engineTag: "Muse Voice",
      icon: <Mic className="w-4 h-4 text-slate-600" />,
    },
    {
      key: "logs",
      title: "Switch & Traffic Logs",
      filename:
        customAttachedNames.logs ??
        `boundary_capture.pcap (${(selectedScenario.telemetry.pcapPacketCount / 1000).toFixed(0)}k pkts)`,
      engineTag: "Baseten 1026 + DuckDB",
      icon: <FileSpreadsheet className="w-4 h-4 text-slate-600" />,
    },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Left Card (7 cols): Compact 2x3 Site Picker + 5-Row Offline Files Checklist + CTA */}
      <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between gap-5">
        {/* 2x3 Sample Facility Grid */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              Customer Site
            </h3>
            <span className="text-xs text-slate-500">
              Select a pre-loaded sample site or upload custom files
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {scenarios.map((sc) => {
              const isSelected = sc.id === selectedScenario.id;
              const narrative = getGuidedNarrative(sc);
              const isRogue = Boolean(sc.isCriticalRogueScenario);
              return (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => onSelectScenario(sc.id)}
                  className={`text-left p-3 rounded-lg border transition-all flex flex-col justify-between gap-2 ${
                    isSelected
                      ? "bg-blue-50/60 border-blue-600 ring-1 ring-blue-600/20"
                      : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/70"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-[11px] font-medium text-slate-500 truncate">
                        {narrative.industryBadge}
                      </span>
                      <span className="text-xs font-semibold text-slate-900 font-mono shrink-0">
                        ${sc.bom.totalHardwareCostUsd.toLocaleString()}
                      </span>
                    </div>
                    <div className="text-xs sm:text-sm font-semibold text-slate-900 mt-0.5 truncate">
                      {sc.shortLabel}
                    </div>
                  </div>

                  <div>
                    {isRogue ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200">
                        Rogue 5G Alert
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                        {sc.telemetry.shadowAssetCount} Unlisted Gear
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 5-Row Site Files Checklist */}
        <div className="border-t border-slate-100 pt-4 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-slate-900">
              Site Files Checklist
            </h4>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
              100% Offline · Read-Only
            </span>
          </div>

          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
            {artifacts.map((art) => (
              <div
                key={art.key}
                className="px-3.5 py-2.5 bg-white hover:bg-slate-50/80 flex items-center justify-between gap-3 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 rounded-lg bg-slate-100 shrink-0">
                    {art.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs sm:text-sm font-medium text-slate-900">
                        {art.title}
                      </span>
                      {!isGuided && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 text-slate-700 border border-slate-200">
                          {art.engineTag}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 font-mono truncate">
                      {art.filename}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                    {uploadingSlot === art.key
                      ? "Analyzing..."
                      : customAttachedNames[art.key]
                        ? "Live Synced"
                        : "Ready"}
                  </span>
                  {art.key === "voice" && (
                    <button
                      type="button"
                      onClick={toggleMicRecording}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${
                        isRecordingMic
                          ? "bg-rose-600 text-white border-rose-600 animate-pulse"
                          : "bg-white hover:bg-slate-50 border-slate-200 text-slate-700"
                      }`}
                    >
                      {isRecordingMic ? (
                        <>
                          <Square className="w-3 h-3 fill-current" />
                          <span>Stop Mic</span>
                        </>
                      ) : (
                        <>
                          <Mic className="w-3 h-3 text-rose-600" />
                          <span>Record</span>
                        </>
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => triggerSlotUpload(art.key)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white hover:bg-slate-50 border border-slate-200 text-xs font-medium text-slate-700 transition-colors"
                  >
                    <Upload className="w-3 h-3 text-slate-500" />
                    <span>Upload</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Primary Step 1 CTA */}
        <button
          type="button"
          onClick={onAnalyzeAndAdvance}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium shadow-sm transition-colors"
        >
          <span>Analyze Site &amp; Continue to Step 2</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Right Card (5 cols): Ask the Network Engineer (1-Click Request) */}
      <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between gap-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              Ask the Network Engineer
            </h3>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
              1-Click Request
            </span>
          </div>

          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
            Need files from a real customer? Send this read-only checklist to
            their IT / Network Engineer.
          </p>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-slate-700 text-xs max-h-64 overflow-y-auto whitespace-pre-wrap leading-relaxed">
            {requestEmailText}
          </div>
        </div>

        <button
          type="button"
          onClick={handleCopyEngineerRequest}
          className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium shadow-sm transition-colors ${
            copiedChecklist
              ? "bg-emerald-600 text-white"
              : "bg-blue-600 hover:bg-blue-700 text-white"
          }`}
        >
          {copiedChecklist ? (
            <>
              <Check className="w-4 h-4" />
              <span>Copied Request to Clipboard</span>
            </>
          ) : (
            <>
              <ClipboardCopy className="w-4 h-4" />
              <span>Copy Email / Slack Request</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
