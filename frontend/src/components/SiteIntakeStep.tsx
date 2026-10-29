"use client";

import React, { useEffect, useRef, useState } from "react";
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
import { CaptureSiteInfo, InferenceMode, ScenarioDataset, UserLensMode } from "@/types/conduit";
import { API_BASE } from "@/lib/api";
import { encodeAudioBlobToWav } from "@/lib/hydrateScenario";
import { fetchCaptureSites, registerCaptureSite } from "@/lib/captureSites";
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
  onCustomAnalysisComplete?: (payload: Record<string, unknown>) => void;
  inferenceMode?: InferenceMode;
}

/** Route an uploaded file to the multipart field the custom-analyze endpoint expects */
function formFieldForUpload(slot: string, file: File): string {
  const lower = file.name.toLowerCase();
  if (slot === "diagram") return "diagram_file";
  if (slot === "cabinet") return "cabinet_file";
  if (slot === "video") return "video_file";
  if (slot === "voice") return "voice_file";
  if (lower.endsWith(".csv")) {
    return lower.includes("inventory") || lower.includes("asset")
      ? "asset_inventory_file"
      : "firewall_csv_file";
  }
  if (lower.endsWith(".txt") || lower.endsWith(".conf") || lower.endsWith(".cfg")) {
    return "switch_dump_file";
  }
  return "pcap_file";
}

export default function SiteIntakeStep({
  scenarios,
  selectedScenario,
  onSelectScenario,
  userLens,
  onAnalyzeAndAdvance,
  onLivePayloadHydrate,
  onCustomAnalysisComplete,
  inferenceMode,
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
  // Uploaded files are staged per form field and sent together in one analyze request
  const [stagedFiles, setStagedFiles] = useState<Record<string, File>>({});
  const [isAnalyzingCustom, setIsAnalyzingCustom] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [captureSites, setCaptureSites] = useState<CaptureSiteInfo[]>([]);
  useEffect(() => {
    fetchCaptureSites().then(setCaptureSites);
  }, []);

  useEffect(() => {
    setStagedFiles({});
    setCustomAttachedNames({});
    setUploadError(null);
  }, [selectedScenario.id]);

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
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0 || !pendingSlotKey) return;

    const slot = pendingSlotKey;
    setUploadError(null);
    setCustomAttachedNames((prev) => ({
      ...prev,
      [slot]: files.map((f) => f.name).join(", "),
    }));
    setStagedFiles((prev) => {
      const next = { ...prev };
      files.forEach((f) => {
        next[formFieldForUpload(slot, f)] = f;
      });
      return next;
    });

    // Voice memos also get an immediate transcript preview
    if (slot === "voice") {
      setUploadingSlot("voice");
      const form = new FormData();
      form.append("file", files[0]);
      form.append("scenario_id", selectedScenario.id);
      try {
        const res = await fetch(`${API_BASE}/api/v1/voice/transcribe`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const vt = (await res.json()) as Record<string, unknown>;
        onLivePayloadHydrate?.({ voice_transcript: vt }, false);
      } catch (err) {
        setUploadError(`Voice transcription failed: ${String(err)}`);
      } finally {
        setUploadingSlot(null);
      }
    }
  };

  const stagedCount = Object.keys(stagedFiles).length;
  const hasTrafficEvidence = Boolean(
    stagedFiles.pcap_file || stagedFiles.firewall_csv_file
  );

  const handleAnalyzeCustomFiles = async () => {
    setIsAnalyzingCustom(true);
    setUploadError(null);
    const form = new FormData();
    Object.entries(stagedFiles).forEach(([field, file]) => form.append(field, file));
    form.append("facility_name", `${selectedScenario.shortLabel} (Custom Intake)`);
    const mode = inferenceMode === "airgapped_glimmer" ? "air_gapped_open_weights" : "cloud_meta_api";
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/assessments/custom/analyze?live_llm=true&inference_mode=${mode}`,
        { method: "POST", body: form }
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${detail.slice(0, 200)}`);
      }
      const body = (await res.json()) as Record<string, unknown>;
      onCustomAnalysisComplete?.(body);
    } catch (err) {
      setUploadError(
        `Analysis of uploaded files failed (${String(err)}). Is the backend running at ${API_BASE}?`
      );
    } finally {
      setIsAnalyzingCustom(false);
    }
  };

  const artifacts = [
    {
      key: "diagram",
      title: "Network Diagram",
      filename:
        customAttachedNames.diagram ??
        (selectedScenario.mediaPaths.topologyDiagramRel.split("/").pop() || "not supplied"),
      engineTag: "SAM 3.1",
      icon: <FileText className="w-4 h-4 text-slate-600" />,
    },
    {
      key: "cabinet",
      title: "Rack / Cabinet Photo",
      filename:
        customAttachedNames.cabinet ??
        (selectedScenario.mediaPaths.cabinetPhotoRel.split("/").pop() || "not supplied"),
      engineTag: "SAM 3.1",
      icon: <Camera className="w-4 h-4 text-slate-600" />,
    },
    {
      key: "video",
      title: "Rack Walkthrough Video",
      filename:
        customAttachedNames.video ??
        (selectedScenario.mediaPaths.walkthroughVideoRel.split("/").pop() || "not supplied"),
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
        (selectedScenario.captureSite
          ? `${selectedScenario.captureSite.filename} (${selectedScenario.captureSite.packetCount} pkts)`
          : `boundary_capture.pcap (${(selectedScenario.telemetry.pcapPacketCount / 1000).toFixed(0)}k pkts)`),
      engineTag: "Baseten 1026 + DuckDB",
      icon: <FileSpreadsheet className="w-4 h-4 text-slate-600" />,
    },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      <input
        ref={fileInputRef}
        type="file"
        multiple={pendingSlotKey === "logs"}
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Left Card (7 cols): Plant Picker + 5-Row Offline Files Checklist + CTA */}
      <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between gap-5">
        {/* Demo Plant Picker */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              Customer Site
            </h3>
            <span className="text-xs text-slate-500">
              Select a pre-loaded sample site or upload custom files
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
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

        {/* Public captures: sites the pipeline has never seen, analysed from the packets alone */}
        {captureSites.length > 0 && (
          <div className="border-t border-slate-100 pt-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-900">
                Or try a capture it has never seen
              </h4>
              <span className="text-xs text-slate-500">
                Real public ICS traffic · packets only, no asset list
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {captureSites.map((site) => {
                const isSelected = site.scenarioId === selectedScenario.id;
                return (
                  <button
                    key={site.scenarioId}
                    type="button"
                    onClick={() => {
                      registerCaptureSite(site);
                      onSelectScenario(site.scenarioId);
                    }}
                    className={`text-left px-3 py-2 rounded-lg border transition-all ${
                      isSelected
                        ? "bg-blue-50/60 border-blue-600 ring-1 ring-blue-600/20"
                        : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/70"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900 truncate">
                        {site.protocolFamily}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500 shrink-0">
                        {site.packetCount} pkts
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 leading-snug mt-0.5">{site.story}</div>
                    <div className="text-[10px] text-slate-400 mt-1 truncate">
                      {site.sourceRepo} · {site.license}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

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
                  <span
                    className={`hidden sm:inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                      customAttachedNames[art.key]
                        ? "bg-blue-50 text-blue-700 border-blue-200"
                        : "bg-slate-50 text-slate-600 border-slate-200"
                    }`}
                  >
                    {uploadingSlot === art.key
                      ? "Transcribing..."
                      : customAttachedNames[art.key]
                        ? "Your file"
                        : "Sample"}
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
        {uploadError && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-lg px-3 py-2 text-xs">
            {uploadError}
          </div>
        )}
        {stagedCount > 0 ? (
          <div className="space-y-2">
            {!hasTrafficEvidence && (
              <p className="text-xs text-amber-800">
                Add a pcap or firewall CSV under &quot;Switch &amp; Traffic Logs&quot; — without
                traffic there are no flows to size or classify.
              </p>
            )}
            <button
              type="button"
              onClick={handleAnalyzeCustomFiles}
              disabled={isAnalyzingCustom}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium shadow-sm transition-colors"
            >
              <span>
                {isAnalyzingCustom
                  ? "Analyzing your files (the architect model can take ~30 s)..."
                  : `Analyze ${stagedCount} Uploaded File${stagedCount === 1 ? "" : "s"}`}
              </span>
              {!isAnalyzingCustom && <ArrowRight className="w-4 h-4" />}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onAnalyzeAndAdvance}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium shadow-sm transition-colors"
          >
            <span>Analyze Sample Site &amp; Continue to Step 2</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
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
