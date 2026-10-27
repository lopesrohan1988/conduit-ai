"use client";

import React, { useEffect, useState } from "react";
import {
  Eye,
  Video,
  Mic,
  AlertOctagon,
  Layers,
  Play,
  Pause,
  CheckSquare,
  Square,
  Cpu,
  HardDrive,
  RadioTower,
  PackageCheck,
  MessageSquareQuote,
  LayoutGrid,
  Camera,
} from "lucide-react";
import {
  SamOverlayCategory,
  ScenarioDataset,
  UserLensMode,
} from "@/types/conduit";
import { getStaticDataUrl } from "@/lib/api";
import { getGuidedNarrative } from "@/lib/guidedCopy";

interface IntakeVisionTabProps {
  scenario: ScenarioDataset;
  userLens?: UserLensMode;
}

type VisionSubTab =
  | "cabinet_photo"
  | "rack_video"
  | "diagram_check"
  | "voice_and_shadow"
  | "all_grid";

const OVERLAY_META: Record<
  SamOverlayCategory,
  { label: string; plainLabel: string; stroke: string; fill: string; badgeBg: string }
> = {
  EMPTY_1U_RACK_SLOT: {
    label: "EMPTY_1U_RACK_SLOT",
    plainLabel: "Open 1U Rack Space",
    stroke: "#22c55e",
    fill: "rgba(34, 197, 94, 0.14)",
    badgeBg: "#15803d",
  },
  DIN_RAIL_TRACK: {
    label: "DIN_RAIL_TRACK",
    plainLabel: "Clip-On DIN Rail Space",
    stroke: "#38bdf8",
    fill: "rgba(56, 189, 248, 0.14)",
    badgeBg: "#0369a1",
  },
  FREE_RJ45_PORT: {
    label: "FREE_RJ45_PORT",
    plainLabel: "Spare Network Ports",
    stroke: "#4ade80",
    fill: "rgba(74, 222, 128, 0.14)",
    badgeBg: "#166534",
  },
  ROGUE_CELLULAR_BYPASS_MODEM: {
    label: "ROGUE_CELLULAR_BYPASS_MODEM",
    plainLabel: "Rogue 5G Bypass Modem!",
    stroke: "#f43f5e",
    fill: "rgba(244, 63, 94, 0.20)",
    badgeBg: "#be123c",
  },
};

export default function IntakeVisionTab({
  scenario,
  userLens = "guided_collab",
}: IntakeVisionTabProps) {
  const isGuided = userLens === "guided_collab";
  const narrative = getGuidedNarrative(scenario);

  const [subTab, setSubTab] = useState<VisionSubTab>(
    userLens === "engineer_deep" ? "all_grid" : "cabinet_photo"
  );

  useEffect(() => {
    setSubTab(userLens === "engineer_deep" ? "all_grid" : "cabinet_photo");
  }, [userLens]);

  const [enabledOverlays, setEnabledOverlays] = useState<
    Record<SamOverlayCategory, boolean>
  >({
    EMPTY_1U_RACK_SLOT: true,
    DIN_RAIL_TRACK: true,
    FREE_RJ45_PORT: true,
    ROGUE_CELLULAR_BYPASS_MODEM: true,
  });
  const [showDiagramHud, setShowDiagramHud] = useState(true);
  const [diagramLoadFailed, setDiagramLoadFailed] = useState(false);
  const [cabinetLoadFailed, setCabinetLoadFailed] = useState(false);
  const [videoLoadFailed, setVideoLoadFailed] = useState(false);
  const [useSecondaryPhoto, setUseSecondaryPhoto] = useState(false);
  const [videoOverride, setVideoOverride] = useState<
    "videos/rack_1u_slot_walkthrough.mp4" | "videos/cabinet_rogue_modem_pan.mp4"
  >(scenario.mediaPaths.walkthroughVideoRel);

  const [simPlaying, setSimPlaying] = useState(true);
  const [simFrame, setSimFrame] = useState(42);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [activeVoiceIndex, setActiveVoiceIndex] = useState(0);

  useEffect(() => {
    setDiagramLoadFailed(false);
    setCabinetLoadFailed(false);
    setVideoLoadFailed(false);
    setUseSecondaryPhoto(false);
    setVideoOverride(scenario.mediaPaths.walkthroughVideoRel);
    setActiveVoiceIndex(0);
    setVoicePlaying(false);
  }, [scenario.id, scenario.mediaPaths.walkthroughVideoRel]);

  useEffect(() => {
    if (!simPlaying) return;
    const id = setInterval(() => {
      setSimFrame((f) => (f + 1) % 144);
    }, 85);
    return () => clearInterval(id);
  }, [simPlaying]);

  useEffect(() => {
    if (!voicePlaying) return;
    const id = setInterval(() => {
      setActiveVoiceIndex((prev) => {
        if (prev + 1 >= scenario.voiceNote.entries.length) {
          setVoicePlaying(false);
          return 0;
        }
        return prev + 1;
      });
    }, 2600);
    return () => clearInterval(id);
  }, [voicePlaying, scenario.voiceNote.entries.length]);

  const toggleOverlay = (cat: SamOverlayCategory) => {
    setEnabledOverlays((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  const activePhotoRel =
    useSecondaryPhoto && scenario.mediaPaths.secondaryPhotoRel
      ? scenario.mediaPaths.secondaryPhotoRel
      : scenario.mediaPaths.cabinetPhotoRel;

  const diagramUrl = getStaticDataUrl(scenario.mediaPaths.topologyDiagramRel);
  const cabinetUrl = getStaticDataUrl(activePhotoRel);
  const videoUrl = getStaticDataUrl(videoOverride);

  const visibleDetections = scenario.samCabinetDetections.filter(
    (d) => enabledOverlays[d.category]
  );

  const isRoguePanVideo = videoOverride.includes("cabinet_rogue_modem_pan");

  const showCabinetPanel = subTab === "cabinet_photo" || subTab === "all_grid";
  const showDiagramPanel = subTab === "diagram_check" || subTab === "all_grid";
  const showVideoPanel = subTab === "rack_video" || subTab === "all_grid";
  const showVoiceAndShadow =
    subTab === "voice_and_shadow" || subTab === "all_grid";

  return (
    <div className="space-y-4">
      {/* Top Plain-English Discovery Summary Banner (2 Side-by-Side Human Verdict Cards) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Card 1: Will the Hardware Physically Fit? */}
        <div className="rounded-md bg-slate-900/90 border border-emerald-500/40 p-4 flex flex-col justify-between gap-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-xs font-mono font-semibold text-emerald-300">
                <PackageCheck className="w-3.5 h-3.5" />
                📦 Will the Hardware Physically Fit? (Meta SAM 3.1)
              </span>
              <span className="text-[11px] font-mono text-emerald-400">
                ✓ MEASURED FROM PHOTO & VIDEO
              </span>
            </div>

            <h3 className="text-sm sm:text-base font-bold text-slate-100">
              {narrative.cabinetFitHeadline}
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              {narrative.cabinetFitPlainText}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 text-center">
            <div className="p-2 rounded bg-zinc-950 border border-slate-800">
              <div className="text-[10px] font-mono text-slate-400">
                Open 19&quot; Rack Slots
              </div>
              <div className="text-sm font-mono font-bold text-emerald-400">
                {scenario.samCabinetMetrics.empty1uSlots} U Open
              </div>
            </div>
            <div className="p-2 rounded bg-zinc-950 border border-slate-800">
              <div className="text-[10px] font-mono text-slate-400">
                Free DIN-Rail Space
              </div>
              <div className="text-sm font-mono font-bold text-sky-400">
                {scenario.samCabinetMetrics.dinRailFreeMm} mm
              </div>
            </div>
            <div className="p-2 rounded bg-zinc-950 border border-slate-800">
              <div className="text-[10px] font-mono text-slate-400">
                Spare Switch Ports
              </div>
              <div className="text-sm font-mono font-bold text-emerald-300">
                {scenario.samCabinetMetrics.freeRj45Ports} RJ45 ·{" "}
                {scenario.samCabinetMetrics.freeSfpPorts} Fiber
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: Hidden Floor Risks Uncovered + Sales Talking Point */}
        <div
          className={`rounded-md p-4 border flex flex-col justify-between gap-3 ${
            scenario.isCriticalRogueScenario
              ? "bg-rose-950/35 border-rose-500/70 shadow-[0_0_24px_rgba(244,63,94,0.18)]"
              : "bg-slate-900/90 border-amber-500/45"
          }`}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-mono font-semibold border ${
                  scenario.isCriticalRogueScenario
                    ? "bg-rose-500 text-slate-950 border-rose-400"
                    : "bg-amber-500/15 text-amber-300 border-amber-500/40"
                }`}
              >
                <AlertOctagon className="w-3.5 h-3.5" />
                🚨 Hidden Floor Risks Uncovered ({scenario.shadowAssets.length}{" "}
                Unlisted Devices)
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                3-Way Check: Diagram + Switch + Traffic
              </span>
            </div>

            <h3 className="text-sm sm:text-base font-bold text-slate-100">
              {narrative.hiddenRiskHeadline}
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              {narrative.hiddenRiskPlainText}
            </p>
          </div>

          {/* Sales Talking Point Callout */}
          <div className="p-3 rounded bg-slate-950/90 border border-sky-500/35 space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-sky-400 font-semibold">
              <MessageSquareQuote className="w-3.5 h-3.5" />
              <span>💬 How Sales Explains This to the Customer</span>
            </div>
            <p className="text-xs text-sky-100 italic leading-relaxed">
              {narrative.salesTalkingPoint}
            </p>
          </div>
        </div>
      </div>

      {/* Clean 4-Sub-Tab Selector Bar (+ Engineer All-Panels View) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-md p-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSubTab("cabinet_photo")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all border ${
              subTab === "cabinet_photo"
                ? "bg-emerald-500/20 text-emerald-200 border-emerald-500/50"
                : "text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-800/70"
            }`}
          >
            <Camera className="w-3.5 h-3.5 text-emerald-400" />
            <span>📸 Cabinet Photo & Rack Fit (SAM 3.1)</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab("rack_video")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all border ${
              subTab === "rack_video"
                ? "bg-emerald-500/20 text-emerald-200 border-emerald-500/50"
                : "text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-800/70"
            }`}
          >
            <Video className="w-3.5 h-3.5 text-emerald-400" />
            <span>🎥 Handheld Rack Video Tracker (.mp4)</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab("diagram_check")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all border ${
              subTab === "diagram_check"
                ? "bg-sky-500/20 text-sky-200 border-sky-500/50"
                : "text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-800/70"
            }`}
          >
            <Eye className="w-3.5 h-3.5 text-sky-400" />
            <span>🗺️ Customer Diagram Check</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab("voice_and_shadow")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all border ${
              subTab === "voice_and_shadow"
                ? "bg-amber-500/20 text-amber-200 border-amber-500/50"
                : "text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-800/70"
            }`}
          >
            <Mic className="w-3.5 h-3.5 text-amber-400" />
            <span>
              🎙️ Technician Voice Memo & Hidden Devices (
              {scenario.shadowAssets.length})
            </span>
          </button>
        </div>

        <button
          type="button"
          onClick={() =>
            setSubTab(subTab === "all_grid" ? "cabinet_photo" : "all_grid")
          }
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-mono border transition-colors ${
            subTab === "all_grid"
              ? "bg-sky-500/20 text-sky-300 border-sky-500/50"
              : "bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200"
          }`}
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          <span>
            {subTab === "all_grid"
              ? "Showing All Panels"
              : "Show All 4 Panels Side-by-Side"}
          </span>
        </button>
      </div>

      {/* SAM 3.1 Bounding-Box HUD Overlay Filter Controls (shown when Cabinet Photo is visible) */}
      {showCabinetPanel && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-md px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-sky-400" />
            <span className="text-xs font-semibold text-slate-200">
              {isGuided
                ? "Highlight Measured Spaces on Cabinet Photo:"
                : "Meta SAM 3.1 SVG HUD Segmentation Overlays:"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(OVERLAY_META) as SamOverlayCategory[]).map((cat) => {
              const active = enabledOverlays[cat];
              const meta = OVERLAY_META[cat];
              const isRogueCat = cat === "ROGUE_CELLULAR_BYPASS_MODEM";
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleOverlay(cat)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono transition-colors border ${
                    active
                      ? isRogueCat
                        ? "bg-rose-950/60 text-rose-200 border-rose-500/60"
                        : "bg-slate-800 text-slate-100 border-slate-600"
                      : "bg-slate-950 text-slate-500 border-slate-800"
                  }`}
                >
                  {active ? (
                    <CheckSquare
                      className="w-3.5 h-3.5"
                      style={{ color: meta.stroke }}
                    />
                  ) : (
                    <Square className="w-3.5 h-3.5 text-slate-600" />
                  )}
                  <span>{isGuided ? meta.plainLabel : meta.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Diagram + Cabinet Photo Section */}
      {(showDiagramPanel || showCabinetPanel) && (
        <div
          className={`grid grid-cols-1 ${
            subTab === "all_grid" ? "lg:grid-cols-2" : "max-w-5xl mx-auto"
          } gap-4`}
        >
          {/* Panel B: Mode 2 Physical Cabinet & Rack Sizer */}
          {showCabinetPanel && (
            <div className="bg-slate-900/75 border border-slate-800 rounded-md overflow-hidden flex flex-col">
              <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-emerald-400" />
                  <div>
                    <h3 className="text-xs font-semibold text-slate-100">
                      {isGuided
                        ? "Physical Rack / Cabinet Space Measurement (Meta SAM 3.1)"
                        : "SAM 3.1 Mode 2 — Physical Rack / DIN Cabinet Sizer"}
                    </h3>
                    <p className="text-[11px] font-mono text-slate-400 truncate max-w-[380px]">
                      {activePhotoRel}
                    </p>
                  </div>
                </div>
                {scenario.mediaPaths.secondaryPhotoRel && (
                  <button
                    type="button"
                    onClick={() => {
                      setCabinetLoadFailed(false);
                      setUseSecondaryPhoto((v) => !v);
                    }}
                    className="px-2.5 py-1 rounded text-[11px] font-mono bg-slate-900 hover:bg-slate-800 border border-slate-700 text-emerald-300"
                  >
                    {useSecondaryPhoto
                      ? "Switch to Primary Photo"
                      : "Switch to Alternate Site Photo"}
                  </button>
                )}
              </div>

              <div className="relative aspect-[16/10] bg-zinc-950 overflow-hidden">
                {!cabinetLoadFailed ? (
                  <img
                    src={cabinetUrl}
                    alt={`${scenario.facilityName} Physical Cabinet`}
                    onError={() => setCabinetLoadFailed(true)}
                    className="w-full h-full object-cover bg-slate-950"
                  />
                ) : (
                  <div className="w-full h-full bg-hud-dots bg-zinc-950 p-5 flex flex-col justify-between select-none">
                    <div className="flex justify-between text-[10px] font-mono text-slate-500">
                      <span>PHYSICAL ENCLOSURE ELEVATION CAD</span>
                      <span>35mm DIN / EIA-310 CALIBRATED</span>
                    </div>
                    {scenario.mediaPaths.enclosureType ===
                    "19INCH_SERVER_RACK" ? (
                      <div className="mx-auto w-4/5 border-x-4 border-slate-700 bg-slate-900/70 p-3 space-y-2">
                        <div className="h-7 rounded bg-slate-800 border border-slate-700 px-2.5 flex items-center justify-between text-[10px] font-mono text-slate-300">
                          <span>RU-20 · OT CORE SWITCH (48P)</span>
                          <span className="text-emerald-400">
                            12x FREE RJ45
                          </span>
                        </div>
                        <div className="h-6 rounded bg-slate-950/90 border border-dashed border-emerald-500/60 px-2.5 flex items-center justify-between text-[10px] font-mono text-emerald-300">
                          <span>RU-14 · UNOCCUPIED 1U RACKBAY</span>
                          <span>44.45mm VERIFIED</span>
                        </div>
                        <div className="h-10 rounded bg-slate-800 border border-slate-700 px-2.5 flex items-center justify-between text-[10px] font-mono text-slate-300">
                          <span>RU-09..08 · 2U OT HISTORIAN</span>
                          <span>DUAL PSU</span>
                        </div>
                      </div>
                    ) : (
                      <div className="my-auto relative flex items-center gap-2 border-y-2 border-slate-700 py-5 px-3 bg-slate-900/50">
                        <div className="w-1/4 h-24 rounded bg-slate-800 border border-slate-600 p-2 text-[10px] font-mono text-slate-300">
                          DIN SWITCH
                          <div className="text-emerald-400 mt-2">
                            PORTS 11–15 FREE
                          </div>
                        </div>
                        <div className="w-1/4 h-12 rounded border border-dashed border-sky-400/70 bg-sky-950/20 flex items-center justify-center text-[10px] font-mono text-sky-300 text-center px-1">
                          250mm FREE 35mm DIN RAIL
                        </div>
                        {scenario.samCabinetMetrics.rogueModemDetected && (
                          <div className="w-2/5 h-28 rounded bg-rose-950/50 border-2 border-rose-500 p-2 text-[10px] font-mono text-rose-200">
                            <div className="font-bold">CELLGATE 5G MODEM</div>
                            <div className="text-rose-400 mt-1">
                              DUAL PADDLE ANTENNAS · GI1/24 RED PATCH
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="text-[10px] font-mono text-slate-500 flex justify-between">
                      <span>CALIBRATION: 0.547 mm/px</span>
                      <span>META SAM 3.1 MASK ENGINE</span>
                    </div>
                  </div>
                )}

                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  className="absolute inset-0 w-full h-full pointer-events-none"
                >
                  {visibleDetections.map((det) => {
                    const meta = OVERLAY_META[det.category];
                    return (
                      <g key={det.id}>
                        <rect
                          x={det.x}
                          y={det.y}
                          width={det.w}
                          height={det.h}
                          fill={meta.fill}
                          stroke={meta.stroke}
                          strokeWidth="0.65"
                        />
                      </g>
                    );
                  })}
                </svg>

                {visibleDetections.map((det) => {
                  const meta = OVERLAY_META[det.category];
                  const isRogue =
                    det.category === "ROGUE_CELLULAR_BYPASS_MODEM";
                  return (
                    <div
                      key={`${det.id}-tag`}
                      style={{
                        left: `${det.x}%`,
                        top: `${Math.max(2, det.y - 7)}%`,
                      }}
                      className={`absolute pointer-events-none px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold text-white shadow-lg flex items-center gap-1.5 ${
                        isRogue ? "animate-pulse ring-2 ring-rose-400" : ""
                      }`}
                    >
                      <span
                        style={{ backgroundColor: meta.badgeBg }}
                        className="px-1.5 py-0.5 rounded border border-white/20"
                      >
                        [{det.trackId}] {det.measurement} ·{" "}
                        {Math.round(det.confidence * 100)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Panel A: Mode 1 Multi-Style Topology Diagram */}
          {showDiagramPanel && (
            <div className="bg-slate-900/75 border border-slate-800 rounded-md overflow-hidden flex flex-col">
              <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-sky-400" />
                  <div>
                    <h3 className="text-xs font-semibold text-slate-100">
                      {isGuided
                        ? "Customer's Provided Network Diagram (Zone Check)"
                        : "SAM 3.1 Mode 1 — Customer Topology Diagram Parser"}
                    </h3>
                    <p className="text-[11px] font-mono text-slate-400">
                      {scenario.diagramStyle}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDiagramHud((v) => !v)}
                  className="px-2 py-1 rounded text-[10px] font-mono bg-slate-900 hover:bg-slate-800 border border-slate-700 text-sky-300"
                >
                  {showDiagramHud ? "DETECTED ZONES: ON" : "DETECTED ZONES: OFF"}
                </button>
              </div>

              <div className="relative aspect-[16/10] bg-zinc-950 overflow-hidden">
                {!diagramLoadFailed ? (
                  <img
                    src={diagramUrl}
                    alt={`${scenario.facilityName} Topology Diagram`}
                    onError={() => setDiagramLoadFailed(true)}
                    className="w-full h-full object-contain bg-slate-950"
                  />
                ) : (
                  <div className="w-full h-full bg-industrial-grid flex flex-col justify-between p-5 select-none">
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 border-b border-slate-800/80 pb-1.5">
                      <span>
                        BLUEPRINT CAD RENDER // {scenario.id.toUpperCase()}
                      </span>
                      <span>REV 2026.10 · PURDUE L0–L4</span>
                    </div>
                    <div className="my-auto space-y-3 px-2">
                      <div className="p-2.5 rounded border border-sky-500/30 bg-sky-950/15 flex items-center justify-between">
                        <span className="text-xs font-mono text-sky-300">
                          L4 CORPORATE IT / WAN ZONE
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">
                          Historian · MES · SIEM
                        </span>
                      </div>
                      <div className="mx-auto w-2/3 p-2 rounded border border-amber-500/40 bg-amber-950/20 text-center text-xs font-mono text-amber-300">
                        L3.5 {scenario.telemetry.firewallVendor.toUpperCase()} (
                        {scenario.preCutoverSl})
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 rounded border border-emerald-500/30 bg-emerald-950/15">
                          <div className="text-xs font-mono text-emerald-300">
                            L2/L3 SCADA & HMI
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 mt-1">
                            Peak: {scenario.telemetry.peakBandwidthMbps} Mbps
                          </div>
                        </div>
                        <div className="p-3 rounded border border-emerald-500/30 bg-emerald-950/15">
                          <div className="text-xs font-mono text-emerald-300">
                            L1 PLCs / RTUs / IEDs
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 mt-1">
                            {scenario.telemetry.documentedAssets} Documented
                            Endpoints
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="text-[10px] font-mono text-amber-400/90 flex items-center justify-between border-t border-slate-800/80 pt-1.5">
                      <span>
                        ⚠ {scenario.telemetry.shadowAssetCount} Undocumented
                        Shadow Assets Missing From Diagram
                      </span>
                      <span>SAM 3.1 OCR + Swimlane Mask</span>
                    </div>
                  </div>
                )}

                {showDiagramHud && (
                  <svg
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    className="absolute inset-0 w-full h-full pointer-events-none"
                  >
                    {scenario.samDiagramZones.map((z) => (
                      <g key={z.id}>
                        <rect
                          x={z.x}
                          y={z.y}
                          width={z.w}
                          height={z.h}
                          fill="rgba(56, 189, 248, 0.08)"
                          stroke="#38bdf8"
                          strokeWidth="0.45"
                          strokeDasharray="1.8 1.2"
                        />
                      </g>
                    ))}
                  </svg>
                )}

                {showDiagramHud &&
                  scenario.samDiagramZones.map((z) => (
                    <div
                      key={`${z.id}-lbl`}
                      style={{ left: `${z.x}%`, top: `${z.y}%` }}
                      className="absolute pointer-events-none px-1.5 py-0.5 bg-slate-950/90 border border-sky-500/50 text-[10px] font-mono text-sky-300 rounded-br shadow"
                    >
                      {z.purdueLevel} · {z.vlan} (
                      {Math.round(z.confidence * 100)}%)
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Handheld Video Tracker Panel */}
      {showVideoPanel && (
        <div
          className={`${
            subTab === "rack_video" ? "max-w-4xl mx-auto" : ""
          } bg-slate-900/75 border border-slate-800 rounded-md overflow-hidden flex flex-col`}
        >
          <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-950/80 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Video className="w-4 h-4 text-emerald-400" />
              <div>
                <h3 className="text-xs font-semibold text-slate-100">
                  {isGuided
                    ? "Smartphone Rack Walkthrough Video — Tracks Slots & Spots Rogue Modems"
                    : "SAM 3.1 Mode 3 — 24fps Handheld .mp4 Rack & Cabinet Video Tracker"}
                </h3>
                <p className="text-[11px] text-slate-400">
                  {isGuided
                    ? "Keeps persistent IDs on every switch & open slot as the camera moves so nothing gets double-counted"
                    : "Persistent object_track_id Propagation (Zero Slot/Port Double-Counting)"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setVideoLoadFailed(false);
                  setVideoOverride("videos/rack_1u_slot_walkthrough.mp4");
                }}
                className={`px-2.5 py-1 rounded text-[11px] font-mono border ${
                  !isRoguePanVideo
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/50"
                    : "bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200"
                }`}
              >
                19&quot; Rack Slot Video
              </button>
              <button
                type="button"
                onClick={() => {
                  setVideoLoadFailed(false);
                  setVideoOverride("videos/cabinet_rogue_modem_pan.mp4");
                }}
                className={`px-2.5 py-1 rounded text-[11px] font-mono border ${
                  isRoguePanVideo
                    ? "bg-rose-500/20 text-rose-300 border-rose-500/50"
                    : "bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200"
                }`}
              >
                Cabinet Rogue 5G Pan Video
              </button>
            </div>
          </div>

          <div className="relative aspect-video bg-zinc-950 overflow-hidden">
            {!videoLoadFailed ? (
              <video
                key={videoUrl}
                src={videoUrl}
                controls
                autoPlay
                muted
                loop
                playsInline
                onError={() => setVideoLoadFailed(true)}
                className="w-full h-full object-contain bg-black"
              />
            ) : (
              <div className="w-full h-full bg-zinc-950 bg-industrial-grid relative flex flex-col justify-between p-4 select-none">
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-emerald-400">
                    ● SAM 3.1 VIDEO TRACKER SIM ·{" "}
                    {videoOverride.split("/")[1]}
                  </span>
                  <span className="text-slate-400">
                    FRAME {String(simFrame).padStart(3, "0")} / 144 · 24.0 FPS
                  </span>
                </div>

                <div className="relative h-44 my-auto border border-slate-800 rounded bg-slate-950/90 overflow-hidden">
                  {isRoguePanVideo ? (
                    <div
                      className="absolute top-6 flex items-center gap-5 transition-transform duration-75 px-8"
                      style={{
                        transform: `translateX(${
                          20 - (simFrame / 144) * 180
                        }px)`,
                      }}
                    >
                      <div className="w-28 h-28 rounded bg-slate-900 border border-indigo-500/50 p-2 text-[10px] font-mono text-indigo-300 shrink-0">
                        [TRK-02] S7-1500 PLCs
                        <div className="text-slate-500 mt-2">192.168.10.11</div>
                      </div>
                      <div className="w-32 h-28 rounded bg-slate-900 border border-emerald-500/60 p-2 text-[10px] font-mono text-emerald-300 shrink-0">
                        [TRK-03] 16P DIN SW
                        <div className="text-amber-300 mt-2">
                          Port 16 Red Patch
                        </div>
                      </div>
                      <div className="w-36 h-16 rounded bg-sky-950/30 border-2 border-dashed border-sky-400 p-2 text-[10px] font-mono text-sky-300 shrink-0">
                        [TRK-04] 250mm FREE DIN
                      </div>
                      <div className="w-44 h-32 rounded bg-rose-950/60 border-2 border-rose-500 p-2 text-[10px] font-mono text-rose-200 shrink-0 shadow-[0_0_20px_rgba(244,63,94,0.35)]">
                        <div className="font-bold text-rose-300">
                          [TRK-09] ROGUE 5G ROUTER
                        </div>
                        <div className="mt-1 text-rose-200/90">
                          Paddle Antennas · Bypass!
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="w-4/5 mx-auto space-y-2.5 py-3 transition-transform duration-75"
                      style={{
                        transform: `translateY(${
                          14 - (simFrame / 144) * 55
                        }px)`,
                      }}
                    >
                      <div className="h-9 rounded bg-slate-900 border border-sky-500/50 px-3 flex items-center justify-between text-[10px] font-mono text-sky-300">
                        <span>[TRK-01] RU-23 CAT6A PATCH PANEL</span>
                        <span>CONF 0.96</span>
                      </div>
                      <div className="h-10 rounded bg-slate-900 border border-emerald-500/50 px-3 flex items-center justify-between text-[10px] font-mono text-emerald-300">
                        <span>
                          [TRK-02] RU-20 CATALYST IE-9320 (12 FREE RJ45)
                        </span>
                        <span>CONF 0.97</span>
                      </div>
                      <div className="h-10 rounded bg-emerald-950/30 border-2 border-dashed border-emerald-400 px-3 flex items-center justify-between text-[10px] font-mono text-emerald-200">
                        <span>
                          [TRK-03] RU-14 VERIFIED EMPTY 1U RACK SLOT
                        </span>
                        <span>FITS ARCH_C</span>
                      </div>
                      <div className="h-11 rounded bg-slate-900 border border-slate-700 px-3 flex items-center justify-between text-[10px] font-mono text-slate-300">
                        <span>[TRK-04] RU-09 2U PROCESS HISTORIAN</span>
                        <span>CONF 0.95</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setSimPlaying((p) => !p)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-mono text-slate-200"
                  >
                    {simPlaying ? (
                      <>
                        <Pause className="w-3.5 h-3.5 text-amber-400" />
                        <span>Pause Pan</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Resume Pan</span>
                      </>
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={143}
                    value={simFrame}
                    onChange={(e) => {
                      setSimPlaying(false);
                      setSimFrame(Number(e.target.value));
                    }}
                    className="flex-1 accent-emerald-500"
                    aria-label="SAM 3.1 Video Frame Scrubber"
                  />
                  <span className="text-[10px] font-mono text-slate-400">
                    {(simFrame / 24).toFixed(1)}s / 6.0s
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Voice Note + Hidden Unlisted Devices Panel */}
      {showVoiceAndShadow && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Muse Voice Panel (5 cols) */}
          <div className="lg:col-span-5 bg-slate-900/75 border border-slate-800 rounded-md overflow-hidden flex flex-col">
            <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Mic className="w-4 h-4 text-amber-400" />
                <div>
                  <h3 className="text-xs font-semibold text-slate-100">
                    Technician Voice Memo (<code className="text-amber-300">Muse Voice</code>)
                  </h3>
                  <p className="text-[11px] font-mono text-slate-400">
                    {scenario.voiceNote.audioFilename} ·{" "}
                    {scenario.voiceNote.environmentNoiseDb}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setVoicePlaying((v) => !v)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-mono text-amber-300"
              >
                {voicePlaying ? (
                  <>
                    <Pause className="w-3 h-3" />
                    <span>Stop</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3" />
                    <span>Play Transcript</span>
                  </>
                )}
              </button>
            </div>

            <div className="px-4 py-2 bg-zinc-950 border-b border-slate-800/80 flex items-center gap-1.5">
              <RadioTower className="w-3.5 h-3.5 text-amber-400 shrink-0 mr-1" />
              <div className="flex-1 flex items-end gap-[3px] h-5">
                {[
                  40, 75, 55, 95, 65, 85, 35, 90, 100, 60, 80, 45, 70, 95, 50,
                  85, 60, 40, 75, 90, 55, 65, 45, 80,
                ].map((h, idx) => (
                  <span
                    key={idx}
                    style={{ height: `${h}%` }}
                    className={`flex-1 rounded-sm transition-colors ${
                      voicePlaying
                        ? idx % 2 === activeVoiceIndex % 2
                          ? "bg-amber-400"
                          : "bg-emerald-400/70"
                        : "bg-slate-700"
                    }`}
                  />
                ))}
              </div>
              <span className="text-[10px] font-mono text-slate-400 ml-1">
                {scenario.voiceNote.durationSec}s
              </span>
            </div>

            <div className="p-3.5 space-y-2.5 flex-1">
              {scenario.voiceNote.entries.map((entry, idx) => {
                const isHighlighted = voicePlaying && idx === activeVoiceIndex;
                const borderStyle =
                  entry.severity === "critical"
                    ? "border-rose-500/50 bg-rose-950/20"
                    : entry.severity === "warning"
                      ? "border-amber-500/40 bg-amber-950/15"
                      : "border-slate-800 bg-slate-950/60";
                return (
                  <div
                    key={entry.id}
                    className={`p-2.5 rounded border transition-all ${borderStyle} ${
                      isHighlighted ? "ring-1 ring-amber-400" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1">
                      <span className="text-slate-300 font-semibold">
                        {entry.speaker}
                      </span>
                      <span>[{entry.timestamp}]</span>
                    </div>
                    <p className="text-xs text-slate-200 leading-relaxed">
                      &ldquo;{entry.utterance}&rdquo;
                    </p>
                    <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-mono text-emerald-300">
                      <Cpu className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span>{entry.correlatedAsset}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Unlisted / Shadow Floor Devices List (7 cols) */}
          <div className="lg:col-span-7 bg-slate-900/75 border border-slate-800 rounded-md overflow-hidden flex flex-col">
            <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-950/80 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertOctagon className="w-4 h-4 text-rose-400" />
                <div>
                  <h3 className="text-xs font-semibold text-slate-100">
                    {isGuided
                      ? `Unlisted "Shadow" Devices Found on Floor (${scenario.shadowAssets.length} Missing From Customer Diagram)`
                      : `3-Way Reconciliation Anomalies — Undocumented Shadow OT (${scenario.shadowAssets.length})`}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {isGuided
                      ? "Caught automatically so your cutover plan includes every real machine on Day 1"
                      : "Fused: SAM 3.1 Vision + Baseten 1026 Switch CLI + DuckDB PCAP"}
                  </p>
                </div>
              </div>
            </div>

            <div className="divide-y divide-slate-800/80 flex-1">
              {scenario.shadowAssets.map((asset) => (
                <div
                  key={asset.ipAddress}
                  className={`p-4 space-y-2 ${
                    asset.isRogueBypass ? "bg-rose-950/25" : ""
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                          asset.isRogueBypass
                            ? "bg-rose-500 text-slate-950"
                            : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                        }`}
                      >
                        {asset.isRogueBypass
                          ? "URGENT ROGUE BYPASS"
                          : "UNLISTED FLOOR DEVICE"}
                      </span>
                      <span className="text-xs font-semibold text-slate-100">
                        {asset.vendor} — {asset.model}
                      </span>
                    </div>
                    <span className="text-xs font-mono text-sky-300">
                      IP: {asset.ipAddress} · VLAN {asset.vlan}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">
                    {asset.description}
                  </p>

                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[10px] font-mono text-slate-500">
                      Evidence:
                    </span>
                    {asset.discoverySources.map((src) => (
                      <span
                        key={src}
                        className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] font-mono text-slate-300"
                      >
                        {src}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
