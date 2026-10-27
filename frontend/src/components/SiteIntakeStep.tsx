"use client";

import React, { useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  ClipboardCopy,
  FileSpreadsheet,
  FileText,
  Mic,
  ShieldCheck,
  Upload,
  Users,
  Video,
  Zap,
} from "lucide-react";
import { ScenarioDataset, UserLensMode } from "@/types/conduit";
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
}

export default function SiteIntakeStep({
  scenarios,
  selectedScenario,
  onSelectScenario,
  userLens,
  onAnalyzeAndAdvance,
}: SiteIntakeStepProps) {
  const [copiedChecklist, setCopiedChecklist] = useState(false);
  const [customAttachedNames, setCustomAttachedNames] = useState<
    Record<string, string>
  >({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingSlotKey, setPendingSlotKey] = useState<string | null>(null);

  const isGuided = userLens === "guided_collab";
  const requestEmailText = buildNetworkEngineerRequestTemplate(selectedScenario);

  const handleCopyEngineerRequest = async () => {
    try {
      await navigator.clipboard.writeText(requestEmailText);
      setCopiedChecklist(true);
      setTimeout(() => setCopiedChecklist(false), 2600);
    } catch {
      // Fallback ignored
    }
  };

  const triggerSlotUpload = (slotKey: string) => {
    setPendingSlotKey(slotKey);
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && pendingSlotKey) {
      setCustomAttachedNames((prev) => ({
        ...prev,
        [pendingSlotKey]: file.name,
      }));
    }
    e.target.value = "";
  };

  const artifacts = [
    {
      key: "diagram",
      title: "1. Topology Diagram or Whiteboard Photo",
      loadedFile:
        customAttachedNames.diagram ??
        selectedScenario.mediaPaths.topologyDiagramRel.split("/").pop(),
      whatAiLearns:
        "Maps which office systems and factory zones are supposed to talk to each other.",
      engineTag: "Meta SAM 3.1",
      icon: <FileText className="w-4 h-4 text-sky-400" />,
    },
    {
      key: "cabinet",
      title: "2. Physical Server Rack or Cabinet Photo",
      loadedFile:
        customAttachedNames.cabinet ??
        selectedScenario.mediaPaths.cabinetPhotoRel.split("/").pop(),
      whatAiLearns:
        "Measures open 19\" rack slots vs. 35mm DIN rails & spare switch ports so you never quote hardware that won't fit.",
      engineTag: "Meta SAM 3.1",
      icon: <Camera className="w-4 h-4 text-emerald-400" />,
    },
    {
      key: "video",
      title: "3. Short Smartphone Rack Walkthrough (.mp4)",
      loadedFile:
        customAttachedNames.video ??
        selectedScenario.mediaPaths.walkthroughVideoRel.split("/").pop(),
      whatAiLearns:
        "Tracks ports & slots across a vertical phone pan without double-counting and spots hidden rogue 5G modems.",
      engineTag: "SAM 3.1 24fps",
      icon: <Video className="w-4 h-4 text-emerald-400" />,
    },
    {
      key: "voice",
      title: "4. Field Technician Voice Memo (.wav / .mp3)",
      loadedFile:
        customAttachedNames.voice ?? selectedScenario.voiceNote.audioFilename,
      whatAiLearns:
        "Captures spoken floor notes (heat limits, unlisted PLCs, suspicious cables) even in loud 85 dBA rooms.",
      engineTag: "Muse Voice ASR",
      icon: <Mic className="w-4 h-4 text-amber-400" />,
    },
    {
      key: "logs",
      title: "5. Read-Only Switch ARP & Traffic Sample (.pcap / .csv)",
      loadedFile:
        customAttachedNames.logs ??
        `boundary_capture.pcap (${(selectedScenario.telemetry.pcapPacketCount / 1000).toFixed(0)}k pkts) + ${selectedScenario.telemetry.firewallVendor} CSV`,
      whatAiLearns:
        "Measures true peak speed (Mbps), finds unlisted Shadow machines, and checks which flows need Pull-to-Push reversal.",
      engineTag: "Baseten 1026 + DuckDB",
      icon: <FileSpreadsheet className="w-4 h-4 text-sky-400" />,
    },
  ];

  return (
    <div className="space-y-5">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Step 1 Intro Banner */}
      <div className="rounded-md bg-slate-900/90 border border-slate-800 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 text-xs font-mono text-emerald-400">
            <ShieldCheck className="w-4 h-4" />
            <span>
              STEP 1 OF 5 · 100% OFFLINE &quot;SNEAKERNET&quot; INTAKE — ZERO PLANT RISK
            </span>
          </div>
          <h3 className="text-base sm:text-lg font-bold text-slate-100">
            {isGuided
              ? "Pick a Sample Customer Site Below — or Request 4 Simple Read-Only Files from the Customer's Network Engineer"
              : "Out-of-Band Multi-Modal Site Artifact Selection & Network Engineer Request Protocol"}
          </h3>
          <p className="text-xs text-slate-300 max-w-4xl leading-relaxed">
            You do <strong className="text-white">not</strong> need to be a
            network expert or install software inside the customer&apos;s plant.
            Select any of the 6 real-world customer sites below to explore a
            complete assessment, or copy the ready-made email checklist on the
            right for your customer&apos;s IT/Network contact.
          </p>
        </div>

        <div className="shrink-0">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-950/60 border border-emerald-500/40 text-xs font-mono font-semibold text-emerald-300">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            Safe: 100% Offline / Zero Plant Disruption
          </span>
        </div>
      </div>

      {/* Visual 6-Card Customer Scenario Picker */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400">
            Choose a Customer Site Scenario (6 Critical Infrastructure Industries)
          </h4>
          <span className="text-[11px] font-mono text-slate-400">
            Click any card to load its photos, video, voice memo & traffic logs
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {scenarios.map((sc) => {
            const isSelected = sc.id === selectedScenario.id;
            const narrative = getGuidedNarrative(sc);
            const isRogue = Boolean(sc.isCriticalRogueScenario);
            return (
              <button
                key={sc.id}
                type="button"
                onClick={() => onSelectScenario(sc.id)}
                className={`text-left p-3.5 rounded-md border transition-all flex flex-col justify-between gap-2.5 ${
                  isSelected
                    ? isRogue
                      ? "bg-rose-950/35 border-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.18)]"
                      : "bg-slate-800/95 border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.16)]"
                    : "bg-slate-900/65 border-slate-800 hover:bg-slate-900 hover:border-slate-700"
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-sky-300 truncate">
                      {sc.shortIndex}. {sc.vertical.split("(")[0].trim()}
                    </span>
                    <span className="text-xs font-mono font-bold text-emerald-400 shrink-0">
                      ${sc.bom.totalHardwareCostUsd.toLocaleString()} Quote
                    </span>
                  </div>

                  <div className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
                    <span>{sc.shortLabel}</span>
                    {isRogue && (
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    )}
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed line-clamp-2">
                    {narrative.customerSituation}
                  </p>
                </div>

                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2 text-[11px] font-mono">
                  <span
                    className={
                      isRogue ? "text-rose-300 font-semibold" : "text-amber-300"
                    }
                  >
                    {isRogue
                      ? "🚨 Hidden Rogue 5G Modem!"
                      : `⚠ ${sc.telemetry.shadowAssetCount} Unlisted Floor Devices`}
                  </span>
                  <span className="text-slate-400">
                    {sc.telemetry.peakBandwidthMbps} Mbps Peak
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Split: Left 5-Artifact Checklist + Right Sales-to-Network-Engineer Co-Pilot */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Left: 5 Loaded Site Artifacts & What AI Learns (7 cols) */}
        <div className="xl:col-span-7 bg-slate-900/80 border border-slate-800 rounded-md overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/80 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-semibold text-slate-100">
                Site Files Loaded for {selectedScenario.facilityName}
              </h4>
              <p className="text-[11px] text-slate-400">
                All 5 sample files are pre-loaded so you can test immediately—or
                click &quot;Replace&quot; on any row to attach a custom file
              </p>
            </div>
            <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 text-[10px] font-mono font-semibold">
              5 / 5 ARTIFACTS READY
            </span>
          </div>

          <div className="divide-y divide-slate-800/80 flex-1">
            {artifacts.map((art) => (
              <div
                key={art.key}
                className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-900/90 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 p-2 rounded bg-slate-950 border border-slate-800 shrink-0">
                    {art.icon}
                  </div>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-slate-100">
                        {art.title}
                      </span>
                      <span className="px-1.5 py-[1px] rounded bg-slate-950 border border-slate-800 text-[10px] font-mono text-slate-400">
                        {art.engineTag}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300">
                      <span className="text-emerald-400 font-medium">
                        What AI learns:{" "}
                      </span>
                      {art.whatAiLearns}
                    </p>
                    <div className="text-[11px] font-mono text-sky-300">
                      ✓ Loaded: {art.loadedFile}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => triggerSlotUpload(art.key)}
                  className="shrink-0 self-start sm:self-center inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-slate-950 hover:bg-slate-800 border border-slate-700 text-[11px] font-mono text-slate-300 transition-colors"
                >
                  <Upload className="w-3 h-3 text-sky-400" />
                  <span>Replace</span>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Right: "Working with Customer's Network Engineer" Co-Pilot Card (5 cols) */}
        <div className="xl:col-span-5 bg-slate-900/85 border border-sky-500/35 rounded-md p-4 flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-start gap-2.5">
              <div className="p-2 rounded bg-sky-500/15 border border-sky-500/30 shrink-0">
                <Users className="w-4 h-4 text-sky-300" />
              </div>
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-sky-400">
                  Sales + Network Engineer Collaboration Guide
                </span>
                <h4 className="text-sm font-bold text-slate-100 mt-0.5">
                  Not a Network Expert? Here&apos;s How You Work Together
                </h4>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              On a customer call, <strong className="text-white">Sales</strong>{" "}
              never needs to memorize port numbers or switch commands. Simply
              send the checklist below to the customer&apos;s{" "}
              <strong className="text-sky-300">Network / OT Engineer</strong>:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded bg-slate-950/90 border border-slate-800">
                <div className="font-semibold text-emerald-300 mb-0.5">
                  👔 What You (Sales / PM) Do
                </div>
                <p className="text-[11px] text-slate-400 leading-snug">
                  Walk through physical fit, hidden risk alerts, 0% downtime
                  proof, and the hardware quote in Steps 2–5.
                </p>
              </div>
              <div className="p-2.5 rounded bg-slate-950/90 border border-slate-800">
                <div className="font-semibold text-sky-300 mb-0.5">
                  🛠️ What Network Eng. Does
                </div>
                <p className="text-[11px] text-slate-400 leading-snug">
                  Provides 4 read-only files up front, then reviews our
                  ready-to-paste Switch CLI & proxy rules in Step 4–5.
                </p>
              </div>
            </div>

            {/* Email / Slack Template Preview */}
            <div className="rounded bg-zinc-950 border border-slate-800 p-3 space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                <span>READY-TO-SEND EMAIL / SLACK TEMPLATE</span>
                <span className="text-emerald-400">READ-ONLY · SAFE</span>
              </div>
              <pre className="text-[11px] font-sans text-slate-300 whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed">
                {requestEmailText}
              </pre>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCopyEngineerRequest}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-xs font-semibold transition-all border ${
              copiedChecklist
                ? "bg-emerald-500 text-slate-950 border-emerald-400"
                : "bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 border-sky-500/50"
            }`}
          >
            {copiedChecklist ? (
              <>
                <Check className="w-4 h-4" />
                <span>✓ Copied Email / Slack Checklist to Clipboard!</span>
              </>
            ) : (
              <>
                <ClipboardCopy className="w-4 h-4" />
                <span>📋 Copy Email / Slack Checklist for Network Engineer</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Primary Step 1 CTA Card */}
      <div className="rounded-md bg-emerald-950/30 border border-emerald-500/50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-[0_0_25px_rgba(16,185,129,0.1)]">
        <div>
          <div className="text-xs font-mono text-emerald-300 uppercase">
            Ready to Inspect {selectedScenario.facilityName}
          </div>
          <p className="text-sm font-semibold text-slate-100 mt-0.5">
            Run all 7 AI inspection & verification engines on these site files
            and see physical cabinet fit + hidden floor risks next.
          </p>
        </div>

        <button
          type="button"
          onClick={onAnalyzeAndAdvance}
          className="shrink-0 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-md bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm shadow-[0_0_24px_rgba(16,185,129,0.35)] transition-all"
        >
          <Zap className="w-4 h-4 fill-slate-950" />
          <span>⚡ Analyze Site & Go to Step 2 (Cabinet Fit & Risks)</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
