"use client";

import React, { useEffect, useState } from "react";
import {
  Eye,
  Video,
  Mic,
  Play,
  Pause,
  CheckSquare,
  Square,
  Camera,
  LayoutGrid,
} from "lucide-react";
import {
  SamOverlayCategory,
  ScenarioDataset,
  UserLensMode,
} from "@/types/conduit";
import { getStaticDataUrl } from "@/lib/api";
import MeasuredPhoto from "@/components/MeasuredPhoto";
import MeasuredDiagram from "@/components/MeasuredDiagram";
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
    plainLabel: "Open 1U Slot",
    stroke: "#22c55e",
    fill: "rgba(34, 197, 94, 0.16)",
    badgeBg: "#15803d",
  },
  DIN_RAIL_TRACK: {
    label: "DIN_RAIL_TRACK",
    plainLabel: "Free DIN Rail",
    stroke: "#38bdf8",
    fill: "rgba(56, 189, 248, 0.16)",
    badgeBg: "#0369a1",
  },
  FREE_RJ45_PORT: {
    label: "FREE_RJ45_PORT",
    plainLabel: "Spare Ports",
    stroke: "#4ade80",
    fill: "rgba(74, 222, 128, 0.16)",
    badgeBg: "#166534",
  },
  ROGUE_CELLULAR_BYPASS_MODEM: {
    label: "ROGUE_CELLULAR_BYPASS_MODEM",
    plainLabel: "Rogue 5G Modem",
    stroke: "#f43f5e",
    fill: "rgba(244, 63, 94, 0.22)",
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
  const measuredDiagram = scenario.measuredDiagram ?? null;
  const cabinetUrl = getStaticDataUrl(activePhotoRel);
  const videoUrl = getStaticDataUrl(videoOverride);

  const measuredCabinets = scenario.measuredCabinets ?? [];
  const activeMeasured = measuredCabinets.find(
    (c) => c.sourceImage && activePhotoRel.endsWith(c.sourceImage)
  );
  const visionMeasured = measuredCabinets.length > 0;
  const measuredRackU = Math.max(
    0,
    ...measuredCabinets
      .filter((c) => c.enclosureType === "CONTROL_ROOM_19INCH_RACK")
      .map((c) => c.empty1uSlots)
  );
  const measuredDinMm = Math.max(0, ...measuredCabinets.map((c) => c.dinRailFreeMm));
  const measuredHeadline = visionMeasured
    ? [
        measuredRackU > 0 ? `${measuredRackU} empty U in the rack photo` : null,
        measuredDinMm > 0 ? `${measuredDinMm.toFixed(0)} mm free DIN rail` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "No free mounting space measured in the site photos"
    : null;

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
      {/* Top 2 Clean Summary Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Card 1: Physical Rack Space (SAM 3.1) */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500">
                Physical Rack Space
              </span>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                  visionMeasured
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-slate-50 text-slate-600 border-slate-200"
                }`}
              >
                {visionMeasured ? "Measured by SAM 3.1" : "Reference values"}
              </span>
            </div>
            <h3 className="text-sm sm:text-base font-semibold text-slate-900">
              {measuredHeadline ?? narrative.cabinetFitHeadline}
            </h3>
            {!isGuided && (
              <p className="text-xs text-slate-600 leading-relaxed">
                {visionMeasured
                  ? (() => {
                      // Notes from the photo behind the headline number, not a mix of every photo
                      const best = [...measuredCabinets].sort(
                        (a, b) => b.empty1uSlots - a.empty1uSlots || b.dinRailFreeMm - a.dinRailFreeMm
                      )[0];
                      return `${best.sourceImage}: ${best.notes.slice(0, 2).join(" ")}`;
                    })()
                  : narrative.cabinetFitPlainText}
              </p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100">
            <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200/80">
              <div className="text-[11px] text-slate-500">Open 1U Slots</div>
              <div className="text-sm font-semibold text-slate-900 font-mono mt-0.5">
                {scenario.samCabinetMetrics.empty1uSlots} U
              </div>
            </div>
            <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200/80">
              <div className="text-[11px] text-slate-500">Free DIN Rail</div>
              <div className="text-sm font-semibold text-slate-900 font-mono mt-0.5">
                {scenario.samCabinetMetrics.dinRailFreeMm} mm
              </div>
            </div>
            <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200/80">
              <div className="text-[11px] text-slate-500">Spare Ports</div>
              <div className="text-sm font-semibold text-slate-900 font-mono mt-0.5">
                {scenario.samCabinetMetrics.freeRj45Ports} RJ45 ·{" "}
                {scenario.samCabinetMetrics.freeSfpPorts} SFP
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: Unlisted Devices & Risks */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500">
                Unlisted Devices &amp; Risks
              </span>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                  scenario.isCriticalRogueScenario
                    ? "bg-rose-50 text-rose-700 border-rose-200"
                    : "bg-amber-50 text-amber-800 border-amber-200"
                }`}
              >
                {scenario.shadowAssets.length} Unlisted Found
              </span>
            </div>
            <h3 className="text-sm sm:text-base font-semibold text-slate-900">
              {narrative.hiddenRiskHeadline}
            </h3>
            {!isGuided && (
              <p className="text-xs text-slate-600 leading-relaxed">
                {narrative.hiddenRiskPlainText}
              </p>
            )}
          </div>

          <div className="bg-blue-50/70 border border-blue-100 text-slate-700 rounded-lg p-2.5 text-xs leading-relaxed">
            <span className="font-semibold text-blue-900">
              Customer Talking Point:{" "}
            </span>
            {narrative.salesTalkingPoint}
          </div>
        </div>
      </div>

      {/* Clean 4 Sub-Tab Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-1.5 shadow-sm flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setSubTab("cabinet_photo")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              subTab === "cabinet_photo"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Cabinet Photo</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab("rack_video")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              subTab === "rack_video"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <Video className="w-3.5 h-3.5" />
            <span>Rack Video</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab("diagram_check")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              subTab === "diagram_check"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Network Diagram</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab("voice_and_shadow")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              subTab === "voice_and_shadow"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <Mic className="w-3.5 h-3.5" />
            <span>Voice &amp; Unlisted Gear ({scenario.shadowAssets.length})</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() =>
            setSubTab(subTab === "all_grid" ? "cabinet_photo" : "all_grid")
          }
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            subTab === "all_grid"
              ? "bg-slate-100 text-slate-900 border-slate-300"
              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
          }`}
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          <span>{subTab === "all_grid" ? "Single Panel" : "All 4 Panels"}</span>
        </button>
      </div>

      {/* Cabinet Photo & Diagram Panels */}
      {(showDiagramPanel || showCabinetPanel) && (
        <div
          className={`grid grid-cols-1 ${
            subTab === "all_grid" ? "lg:grid-cols-2" : "max-w-5xl mx-auto"
          } gap-4`}
        >
          {/* Cabinet Photo Card */}
          {showCabinetPanel && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">
                    Cabinet Space Inspection (SAM 3.1)
                  </h4>
                  <p className="text-xs text-slate-500 font-mono">
                    {activePhotoRel}
                  </p>
                </div>

                {scenario.mediaPaths.secondaryPhotoRel && (
                  <button
                    type="button"
                    onClick={() => {
                      setCabinetLoadFailed(false);
                      setUseSecondaryPhoto((v) => !v);
                    }}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                  >
                    {useSecondaryPhoto ? "Primary Photo" : "Alternate Photo"}
                  </button>
                )}
              </div>

              {/* Clean Light Overlay Toggle Chips */}
              <div className="flex flex-wrap items-center gap-1.5">
                {(Object.keys(OVERLAY_META) as SamOverlayCategory[]).map(
                  (cat) => {
                    const active = enabledOverlays[cat];
                    const meta = OVERLAY_META[cat];
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => toggleOverlay(cat)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                          active
                            ? "bg-slate-50 text-slate-900 border-slate-300"
                            : "bg-white text-slate-400 border-slate-200"
                        }`}
                      >
                        {active ? (
                          <CheckSquare
                            className="w-3.5 h-3.5"
                            style={{ color: meta.stroke }}
                          />
                        ) : (
                          <Square className="w-3.5 h-3.5 text-slate-300" />
                        )}
                        <span>{isGuided ? meta.plainLabel : meta.label}</span>
                      </button>
                    );
                  }
                )}
              </div>

              {/* Photo Media Frame */}
              {activeMeasured ? (
                <MeasuredPhoto url={cabinetUrl} cabinet={activeMeasured} />
              ) : (
              <div className="relative aspect-[16/10] bg-slate-900 rounded-lg overflow-hidden">
                {!cabinetLoadFailed ? (
                  <img
                    src={cabinetUrl}
                    alt={`${scenario.facilityName} Physical Cabinet`}
                    onError={() => setCabinetLoadFailed(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-media-grid bg-slate-900 p-5 flex flex-col justify-between select-none text-slate-200">
                    <div className="flex justify-between text-[10px] font-mono text-slate-400">
                      <span>ENCLOSURE ELEVATION</span>
                      <span>35mm DIN / EIA-310 CALIBRATED</span>
                    </div>
                    {scenario.mediaPaths.enclosureType ===
                    "19INCH_SERVER_RACK" ? (
                      <div className="mx-auto w-4/5 border-x-4 border-slate-600 bg-slate-800/80 p-3 space-y-2">
                        <div className="h-7 rounded bg-slate-700 px-2.5 flex items-center justify-between text-[10px] font-mono">
                          <span>RU-20 · OT CORE SWITCH (48P)</span>
                          <span className="text-emerald-400">12x FREE RJ45</span>
                        </div>
                        <div className="h-6 rounded bg-slate-900/90 border border-dashed border-emerald-400 px-2.5 flex items-center justify-between text-[10px] font-mono text-emerald-300">
                          <span>RU-14 · OPEN 1U RACK SLOT</span>
                          <span>44.45mm VERIFIED</span>
                        </div>
                        <div className="h-10 rounded bg-slate-700 px-2.5 flex items-center justify-between text-[10px] font-mono">
                          <span>RU-09..08 · 2U OT HISTORIAN</span>
                          <span>DUAL PSU</span>
                        </div>
                      </div>
                    ) : (
                      <div className="my-auto relative flex items-center gap-2 border-y-2 border-slate-600 py-5 px-3 bg-slate-800/60">
                        <div className="w-1/4 h-24 rounded bg-slate-700 p-2 text-[10px] font-mono">
                          DIN SWITCH
                          <div className="text-emerald-400 mt-2">
                            PORTS 11–15 FREE
                          </div>
                        </div>
                        <div className="w-1/4 h-12 rounded border border-dashed border-sky-400 bg-sky-900/30 flex items-center justify-center text-[10px] font-mono text-sky-200 text-center px-1">
                          250mm FREE DIN RAIL
                        </div>
                        {scenario.samCabinetMetrics.rogueModemDetected && (
                          <div className="w-2/5 h-28 rounded bg-rose-900/60 border-2 border-rose-500 p-2 text-[10px] font-mono text-rose-100">
                            <div className="font-bold">CELLGATE 5G MODEM</div>
                            <div className="text-rose-300 mt-1">
                              GI1/24 BYPASS PATCH
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="text-[10px] font-mono text-slate-400 flex justify-between">
                      <span>CALIBRATION: 0.547 mm/px</span>
                      <span>SAM 3.1 SEGMENTATION</span>
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
                  return (
                    <div
                      key={`${det.id}-tag`}
                      style={{
                        left: `${det.x}%`,
                        top: `${Math.max(2, det.y - 7)}%`,
                      }}
                      className="absolute pointer-events-none px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold text-white shadow flex items-center gap-1"
                    >
                      <span
                        style={{ backgroundColor: meta.badgeBg }}
                        className="px-1.5 py-0.5 rounded"
                      >
                        [{det.trackId}] {det.measurement} (
                        {Math.round(det.confidence * 100)}%)
                      </span>
                    </div>
                  );
                })}
              </div>
              )}
              {!activeMeasured && (
                <p className="text-[11px] text-slate-500">
                  {visionMeasured
                    ? "SAM 3.1 found nothing it could measure in this photo (no rack devices, DIN rail or modem), so no free space is claimed; boxes shown are reference annotations."
                    : "Reference annotations. Run Analysis to measure this photo with SAM 3.1."}
                </p>
              )}
            </div>
          )}

          {/* Network Diagram Card */}
          {showDiagramPanel && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">
                    Customer Network Diagram
                  </h4>
                  <p className="text-xs text-slate-500">
                    {scenario.diagramStyle}
                  </p>
                </div>
                {!measuredDiagram && (
                  <button
                    type="button"
                    onClick={() => setShowDiagramHud((v) => !v)}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                  >
                    {showDiagramHud ? "Zone Boxes: On" : "Zone Boxes: Off"}
                  </button>
                )}
              </div>

              {measuredDiagram && !diagramLoadFailed ? (
                <MeasuredDiagram url={diagramUrl} diagram={measuredDiagram} />
              ) : (
                <>
                  <div className="relative aspect-[16/10] bg-slate-900 rounded-lg overflow-hidden">
                    {!diagramLoadFailed ? (
                      <img
                        src={diagramUrl}
                        alt={`${scenario.facilityName} Topology Diagram`}
                        onError={() => setDiagramLoadFailed(true)}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="w-full h-full bg-media-grid bg-slate-900 flex flex-col justify-between p-5 select-none text-slate-200">
                        <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 border-b border-slate-700 pb-1.5">
                          <span>DIAGRAM PARSER // {scenario.id.toUpperCase()}</span>
                          <span>PURDUE L0–L4</span>
                        </div>
                        <div className="my-auto space-y-2.5 px-2">
                          <div className="p-2.5 rounded border border-sky-400/40 bg-sky-900/20 flex items-center justify-between text-xs font-mono text-sky-200">
                            <span>L4 CORPORATE IT / WAN</span>
                            <span className="text-[10px] text-slate-300">
                              Historian · MES · SIEM
                            </span>
                          </div>
                          <div className="mx-auto w-2/3 p-2 rounded border border-amber-400/50 bg-amber-900/25 text-center text-xs font-mono text-amber-200">
                            L3.5 {scenario.telemetry.firewallVendor} (
                            {scenario.preCutoverSl})
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                            <div className="p-2.5 rounded border border-emerald-400/40 bg-emerald-900/20 text-emerald-200">
                              L2/L3 SCADA ({scenario.telemetry.peakBandwidthMbps}{" "}
                              Mbps)
                            </div>
                            <div className="p-2.5 rounded border border-emerald-400/40 bg-emerald-900/20 text-emerald-200">
                              L1 PLCs ({scenario.telemetry.documentedAssets} Listed)
                            </div>
                          </div>
                        </div>
                        <div className="text-[10px] font-mono text-amber-300 flex items-center justify-between border-t border-slate-700 pt-1.5">
                          <span>
                            {scenario.telemetry.shadowAssetCount} Unlisted Floor
                            Devices Missing From Diagram
                          </span>
                          <span>SAM 3.1 OCR</span>
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
                              fill="rgba(56, 189, 248, 0.1)"
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
                          className="absolute pointer-events-none px-1.5 py-0.5 bg-slate-900/90 text-[10px] font-mono text-sky-200 rounded-br"
                        >
                          {z.purdueLevel} · {z.vlan}
                        </div>
                      ))}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Reference zone annotations. Run Analysis to read this drawing with SAM 3.1 and Muse
                    Spark and compare it with the devices seen on the network.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Rack Video Tracker Card */}
      {showVideoPanel && (
        <div
          className={`${
            subTab === "rack_video" ? "max-w-4xl mx-auto" : ""
          } bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold text-slate-900">
                Handheld Rack Video Tracker (24fps)
              </h4>
              <p className="text-xs text-slate-500">
                Tracks open slots across camera movement without double-counting
              </p>
            </div>

            <div className="inline-flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => {
                  setVideoLoadFailed(false);
                  setVideoOverride("videos/rack_1u_slot_walkthrough.mp4");
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  !isRoguePanVideo
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                19&quot; Rack Pan
              </button>
              <button
                type="button"
                onClick={() => {
                  setVideoLoadFailed(false);
                  setVideoOverride("videos/cabinet_rogue_modem_pan.mp4");
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  isRoguePanVideo
                    ? "bg-white text-rose-700 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Rogue 5G Cabinet Pan
              </button>
            </div>
          </div>

          <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 space-y-0.5">
            {scenario.measuredVideo ? (
              <>
                <div className="font-medium text-slate-700">
                  SAM 3.1 on {scenario.measuredVideo.framesAnalyzed} sampled frames (
                  {scenario.measuredVideo.measurementSource.replace(/_/g, " ")}):{" "}
                  {scenario.measuredVideo.trackCount} track(s),{" "}
                  {scenario.measuredVideo.verifiedEmpty1uSlots} empty U,{" "}
                  {scenario.measuredVideo.verifiedDinRailMm.toFixed(0)} mm free rail
                  {scenario.measuredVideo.rogueDetected ? ", cellular modem tracked" : ""}.
                </div>
                {scenario.measuredVideo.notes.map((n, i) => (
                  <div key={i}>· {n}</div>
                ))}
                <div>· The HUD drawn on the playback below is illustrative, not SAM output.</div>
              </>
            ) : (
              <div>
                Playback HUD is illustrative. Run Analysis to track this video with SAM 3.1.
              </div>
            )}
          </div>

          <div className="relative aspect-video bg-slate-900 rounded-lg overflow-hidden">
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
              <div className="w-full h-full bg-slate-900 bg-media-grid relative flex flex-col justify-between p-4 select-none text-slate-200">
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-emerald-300">
                    SAM 3.1 TRACKER · {videoOverride.split("/")[1]}
                  </span>
                  <span className="text-slate-400">
                    FRAME {String(simFrame).padStart(3, "0")} / 144
                  </span>
                </div>

                <div className="relative h-44 my-auto border border-slate-700 rounded-lg bg-slate-900/90 overflow-hidden">
                  {isRoguePanVideo ? (
                    <div
                      className="absolute top-6 flex items-center gap-5 transition-transform duration-75 px-8"
                      style={{
                        transform: `translateX(${
                          20 - (simFrame / 144) * 180
                        }px)`,
                      }}
                    >
                      <div className="w-28 h-28 rounded bg-slate-800 border border-slate-600 p-2 text-[10px] font-mono shrink-0">
                        [TRK-02] S7-1500 PLC
                        <div className="text-slate-400 mt-2">192.168.10.11</div>
                      </div>
                      <div className="w-32 h-28 rounded bg-slate-800 border border-emerald-500/60 p-2 text-[10px] font-mono text-emerald-300 shrink-0">
                        [TRK-03] 16P DIN SW
                        <div className="text-amber-300 mt-2">Port 16 Patch</div>
                      </div>
                      <div className="w-36 h-16 rounded bg-sky-900/40 border border-dashed border-sky-400 p-2 text-[10px] font-mono text-sky-200 shrink-0">
                        [TRK-04] 250mm DIN
                      </div>
                      <div className="w-44 h-32 rounded bg-rose-900/60 border-2 border-rose-500 p-2 text-[10px] font-mono text-rose-100 shrink-0">
                        <div className="font-bold">[TRK-09] ROGUE 5G MODEM</div>
                        <div className="mt-1 text-rose-200">
                          Paddle Antennas · Bypass
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
                      <div className="h-9 rounded bg-slate-800 border border-slate-600 px-3 flex items-center justify-between text-[10px] font-mono text-sky-200">
                        <span>[TRK-01] RU-23 PATCH PANEL</span>
                        <span>96%</span>
                      </div>
                      <div className="h-10 rounded bg-slate-800 border border-emerald-500/50 px-3 flex items-center justify-between text-[10px] font-mono text-emerald-300">
                        <span>[TRK-02] RU-20 CORE SWITCH (12 FREE RJ45)</span>
                        <span>97%</span>
                      </div>
                      <div className="h-10 rounded bg-emerald-900/40 border border-dashed border-emerald-400 px-3 flex items-center justify-between text-[10px] font-mono text-emerald-200">
                        <span>[TRK-03] RU-14 OPEN 1U RACK SLOT</span>
                        <span>FITS ARCH_C</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setSimPlaying((p) => !p)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-white"
                  >
                    {simPlaying ? (
                      <>
                        <Pause className="w-3.5 h-3.5" />
                        <span>Pause</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5" />
                        <span>Play</span>
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
                    className="flex-1 accent-blue-500"
                    aria-label="Video Frame Scrubber"
                  />
                  <span className="text-[11px] font-mono text-slate-300">
                    {(simFrame / 24).toFixed(1)}s / 6.0s
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Voice Note + Unlisted Floor Gear (Clean Light Mode Cards) */}
      {showVoiceAndShadow && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Technician Voice Memo Card (5 cols) */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">
                  Technician Voice Memo
                </h4>
                <p className="text-xs text-slate-500">
                  Muse Voice ASR · {scenario.voiceNote.environmentNoiseDb}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setVoicePlaying((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-800 transition-colors"
              >
                {voicePlaying ? (
                  <>
                    <Pause className="w-3 h-3" />
                    <span>Stop</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3" />
                    <span>Play</span>
                  </>
                )}
              </button>
            </div>

            {/* Light Waveform Bar */}
            <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 flex items-center gap-1.5">
              <div className="flex-1 flex items-end gap-[3px] h-4">
                {[
                  40, 75, 55, 95, 65, 85, 35, 90, 100, 60, 80, 45, 70, 95, 50,
                  85, 60, 40, 75, 90,
                ].map((h, idx) => (
                  <span
                    key={idx}
                    style={{ height: `${h}%` }}
                    className={`flex-1 rounded-sm transition-colors ${
                      voicePlaying
                        ? idx % 2 === activeVoiceIndex % 2
                          ? "bg-blue-600"
                          : "bg-blue-300"
                        : "bg-slate-300"
                    }`}
                  />
                ))}
              </div>
              <span className="text-[11px] font-mono text-slate-500 ml-1">
                {scenario.voiceNote.durationSec}s
              </span>
            </div>

            <div className="space-y-2">
              {scenario.voiceNote.entries.map((entry, idx) => {
                const isHighlighted = voicePlaying && idx === activeVoiceIndex;
                const boxStyle =
                  entry.severity === "critical"
                    ? "bg-rose-50/60 border-rose-200"
                    : entry.severity === "warning"
                      ? "bg-amber-50/60 border-amber-200"
                      : "bg-slate-50 border-slate-200";
                return (
                  <div
                    key={entry.id}
                    className={`p-3 rounded-lg border transition-all ${boxStyle} ${
                      isHighlighted ? "ring-2 ring-blue-500/30" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                      <span className="font-semibold text-slate-800">
                        {entry.speaker}
                      </span>
                      <span className="font-mono">{entry.timestamp}</span>
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed">
                      &ldquo;{entry.utterance}&rdquo;
                    </p>
                    <div className="mt-1.5 inline-block px-2 py-0.5 rounded bg-white border border-slate-200 text-[11px] font-mono text-slate-700">
                      {entry.correlatedAsset}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Unlisted Floor Devices Table Card (7 cols) */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">
                  Unlisted Floor Devices ({scenario.shadowAssets.length})
                </h4>
                <p className="text-xs text-slate-500">
                  Active on switch/traffic logs, missing from customer diagram
                </p>
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {scenario.shadowAssets.map((asset) => (
                <div
                  key={asset.ipAddress}
                  className={`p-4 space-y-1.5 ${
                    asset.isRogueBypass ? "bg-rose-50/40" : "bg-white"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                          asset.isRogueBypass
                            ? "bg-rose-50 text-rose-700 border-rose-200"
                            : "bg-amber-50 text-amber-800 border-amber-200"
                        }`}
                      >
                        {asset.isRogueBypass ? "Rogue Bypass" : "Unlisted"}
                      </span>
                      <span className="text-sm font-semibold text-slate-900">
                        {asset.vendor} {asset.model}
                      </span>
                    </div>
                    <span className="text-xs font-mono text-slate-600">
                      {asset.ipAddress} · VLAN {asset.vlan}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">
                    {asset.description}
                  </p>

                  {!isGuided && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {asset.discoverySources.map((src) => (
                        <span
                          key={src}
                          className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-mono"
                        >
                          {src}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
