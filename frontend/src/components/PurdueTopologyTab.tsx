"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import {
  ShieldAlert,
  ShieldCheck,
  ArrowRight,
  Cpu,
  AlertTriangle,
  Lock,
  Unlock,
  Network,
  Info,
} from "lucide-react";
import {
  ScenarioDataset,
  TopologyNodeSpec,
  UserLensMode,
} from "@/types/conduit";

interface PurdueTopologyTabProps {
  scenario: ScenarioDataset;
  userLens?: UserLensMode;
}

type CutoverViewMode = "before" | "after";

type PurdueGraphNodeData = {
  spec: TopologyNodeSpec;
  mode: CutoverViewMode;
  archetypeSummary: string;
  preSl: string;
  postSl: string;
};

type PurdueGraphNode = Node<PurdueGraphNodeData, "purdueAsset">;

function PurdueAssetNodeComponent({
  data,
  selected,
}: NodeProps<PurdueGraphNode>) {
  const { spec, mode, archetypeSummary, preSl, postSl } = data;
  const isAfter = mode === "after";

  if (spec.isBoundaryNode) {
    return (
      <div
        className={`min-w-[310px] rounded-md px-3.5 py-2.5 border-2 transition-all shadow-xl ${
          isAfter
            ? "bg-emerald-950/90 border-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.28)]"
            : "bg-amber-950/80 border-amber-500/80 shadow-[0_0_24px_rgba(245,158,11,0.18)]"
        } ${selected ? "ring-2 ring-white/60" : ""}`}
      >
        <Handle
          type="target"
          position={Position.Top}
          id="top-target"
          className="!bg-slate-400 !w-2.5 !h-2.5"
        />
        <Handle
          type="source"
          position={Position.Top}
          id="top-source"
          className="!bg-emerald-400 !w-2.5 !h-2.5"
        />

        <div className="flex items-center justify-between gap-2 mb-1">
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
              isAfter
                ? "bg-emerald-400 text-slate-950"
                : "bg-amber-500 text-slate-950"
            }`}
          >
            {isAfter
              ? `ONE-WAY HARDWARE DIODE (${postSl})`
              : `TWO-WAY SOFTWARE FIREWALL (${preSl})`}
          </span>
          <span className="text-[10px] font-mono text-slate-300">
            {spec.vlan}
          </span>
        </div>

        {isAfter ? (
          <div className="space-y-1.5">
            <div className="text-xs font-bold text-emerald-200 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{archetypeSummary}</span>
            </div>
            <div className="flex items-center justify-between gap-1 px-2 py-1 rounded bg-slate-950/90 border border-emerald-500/40 text-[10px] font-mono text-emerald-300">
              <span>PLANT READER</span>
              <ArrowRight className="w-3 h-3 text-emerald-400" />
              <span className="px-1 rounded bg-emerald-500/20 text-emerald-200">
                1-WAY HARDWARE
              </span>
              <ArrowRight className="w-3 h-3 text-emerald-400" />
              <span>OFFICE MIRROR</span>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-xs font-bold text-amber-100 flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                {spec.hostname} ({spec.vendor})
              </span>
            </div>
            <div className="text-[10px] font-mono text-amber-200/80 mt-0.5">
              Two-Way Cable · Hackers & Ransomware Can Reach Inward
            </div>
          </div>
        )}

        <Handle
          type="source"
          position={Position.Bottom}
          id="bottom-source"
          className="!bg-amber-400 !w-2.5 !h-2.5"
        />
        <Handle
          type="target"
          position={Position.Bottom}
          id="bottom-target"
          className="!bg-emerald-400 !w-2.5 !h-2.5"
        />
      </div>
    );
  }

  const isRogue = Boolean(spec.isRogueBypass);
  const isShadow = Boolean(spec.isShadowAsset);
  const isQuarantinedRogue = isRogue && isAfter;

  const levelBadgeColor =
    spec.purdueLevel === "L4"
      ? "bg-sky-500/20 text-sky-300 border-sky-500/40"
      : spec.purdueLevel === "BYPASS"
        ? "bg-rose-500 text-slate-950 border-rose-400"
        : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";

  const cardBorder = isQuarantinedRogue
    ? "bg-slate-900/50 border-slate-700 opacity-65"
    : isRogue
      ? "bg-rose-950/85 border-rose-500 animate-pulse-alert"
      : isShadow
        ? isAfter
          ? "bg-slate-900/95 border-emerald-500/60"
          : "bg-rose-950/45 border-rose-400/80"
        : "bg-slate-900/95 border-slate-700 hover:border-slate-500";

  return (
    <div
      className={`min-w-[205px] max-w-[235px] rounded-md px-3 py-2 border transition-all shadow-lg ${cardBorder} ${
        selected ? "ring-2 ring-sky-400" : ""
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="top-target"
        className="!bg-slate-500 !w-2 !h-2"
      />
      <Handle
        type="source"
        position={Position.Top}
        id="top-source"
        className="!bg-emerald-400 !w-2 !h-2"
      />

      <div className="flex items-center justify-between gap-1.5 mb-1">
        <span
          className={`px-1.5 py-[1px] rounded text-[9px] font-mono font-bold border ${levelBadgeColor}`}
        >
          {spec.purdueLevel === "L4"
            ? "L4 OFFICE"
            : spec.purdueLevel === "BYPASS"
              ? "BYPASS"
              : `${spec.purdueLevel} PLANT`}
        </span>
        <span className="text-[10px] font-mono text-slate-400 truncate">
          {spec.ip}
        </span>
      </div>

      <div className="text-xs font-semibold text-slate-100 truncate">
        {spec.hostname}
      </div>
      <div className="text-[10px] text-slate-400 truncate">
        {spec.vendor} · {spec.role}
      </div>

      {spec.anomalyBadge && (
        <div
          className={`mt-1.5 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold inline-flex items-center gap-1 ${
            isQuarantinedRogue
              ? "bg-slate-800 text-slate-300 border border-slate-600 line-through"
              : isRogue || (!isAfter && isShadow)
                ? "bg-rose-500/25 text-rose-200 border border-rose-500/50"
                : isAfter && isShadow
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                  : "bg-amber-500/20 text-amber-200 border border-amber-500/40"
          }`}
        >
          <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
          <span>
            {isQuarantinedRogue
              ? "UNPLUGGED & PORT SHUT"
              : isAfter && isShadow
                ? "PROTECTED + MIRRORED"
                : spec.anomalyBadge}
          </span>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom-source"
        className="!bg-slate-500 !w-2 !h-2"
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="bottom-target"
        className="!bg-slate-500 !w-2 !h-2"
      />
    </div>
  );
}

const nodeTypes = {
  purdueAsset: PurdueAssetNodeComponent,
};

function describeNodeInPlainEnglish(
  spec: TopologyNodeSpec,
  isAfter: boolean
): string {
  if (spec.isBoundaryNode) {
    return isAfter
      ? "Physical Hardware Data Diode installed between Plant and Office. Data streams outward to dashboards, while physical laws prevent any cyberattack from traveling inward."
      : "Current software firewall connecting Office IT and Plant OT. Because it routes traffic two ways in software, ransomware or stolen credentials can still reach inward.";
  }
  if (spec.isRogueBypass) {
    return isAfter
      ? "Previously hidden bypass device—now physically unplugged and its switch port permanently locked down."
      : "URGENT RISK: Unauthorized device bypassing the customer's main firewall and creating a direct backdoor into plant machinery!";
  }
  if (spec.isShadowAsset) {
    return isAfter
      ? "Unlisted floor machine discovered by ConduitAI—now documented in the asset inventory and safely mirrored through the diode so no readings are lost."
      : "Unlisted floor equipment missing from the customer's network diagram. Found automatically in switch and packet logs so it isn't forgotten at cutover.";
  }
  if (spec.purdueLevel === "L4") {
    return isAfter
      ? `Corporate / Office system (${spec.role}). Reads live plant data safely from the Diode's Office Mirror Replica without touching real factory machines.`
      : `Corporate / Office system (${spec.role}). Today it connects directly across the firewall toward plant equipment.`;
  }
  return isAfter
    ? `Protected Plant Floor equipment (${spec.role}). Completely shielded from corporate IT cyberattacks while reporting live telemetry outward.`
    : `Plant Floor equipment (${spec.role}) running physical operations. Currently exposed to inward network connections.`;
}

export default function PurdueTopologyTab({
  scenario,
  userLens = "guided_collab",
}: PurdueTopologyTabProps) {
  const isGuided = userLens === "guided_collab";
  const [cutoverMode, setCutoverMode] = useState<CutoverViewMode>("before");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedNodeId(null);
  }, [scenario.id]);

  const archetypeSummary = useMemo(
    () =>
      scenario.bom.items
        .map((i) => `${i.quantity}x ${i.shortName}`)
        .join(" + "),
    [scenario.bom.items]
  );

  const nodes: PurdueGraphNode[] = useMemo(
    () =>
      scenario.topologyNodes.map((spec) => ({
        id: spec.id,
        type: "purdueAsset",
        position: { x: spec.x, y: spec.y },
        data: {
          spec,
          mode: cutoverMode,
          archetypeSummary,
          preSl: scenario.preCutoverSl,
          postSl: scenario.postCutoverSl,
        },
      })),
    [
      scenario.topologyNodes,
      cutoverMode,
      archetypeSummary,
      scenario.preCutoverSl,
      scenario.postCutoverSl,
    ]
  );

  const edges: Edge[] = useMemo(() => {
    const isAfter = cutoverMode === "after";
    const nodeMap = new Map(scenario.topologyNodes.map((n) => [n.id, n]));

    return scenario.topologyEdges.map((e) => {
      const isCritical = e.classification === "CRITICAL_VIOLATION";
      const isRedBlocker = e.classification === "RED_BLOCKER";
      const isAmber = e.classification === "AMBER";

      if (isAfter && isCritical) {
        const srcNode = nodeMap.get(e.source);
        const dstNode = nodeMap.get(e.target);
        const srcDown = (srcNode?.y ?? 0) < (dstNode?.y ?? 0);
        return {
          id: `${e.id}-after`,
          source: e.source,
          target: e.target,
          sourceHandle: srcDown ? "bottom-source" : "top-source",
          targetHandle: srcDown ? "top-target" : "bottom-target",
          label: `✕ ${e.afterLabel}`,
          animated: false,
          style: {
            stroke: "#64748b",
            strokeWidth: 1.5,
            strokeDasharray: "5 5",
            opacity: 0.45,
          },
          labelStyle: {
            fill: "#fda4af",
            fontSize: 10,
            fontFamily: "monospace",
            fontWeight: 700,
          },
          labelBgStyle: {
            fill: "#1e1b2e",
            fillOpacity: 0.9,
            stroke: "#f43f5e",
            strokeWidth: 0.6,
          },
          labelBgPadding: [5, 3] as [number, number],
        };
      }

      if (isAfter && (isAmber || isRedBlocker)) {
        const srcNode = nodeMap.get(e.source);
        const dstNode = nodeMap.get(e.target);
        const shouldFlip = (srcNode?.y ?? 0) < (dstNode?.y ?? 0);
        const finalSource = shouldFlip ? e.target : e.source;
        const finalTarget = shouldFlip ? e.source : e.target;

        return {
          id: `${e.id}-after`,
          source: finalSource,
          target: finalTarget,
          sourceHandle: "top-source",
          targetHandle: "bottom-target",
          label: `✓ ${e.afterLabel}`,
          animated: true,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#10b981",
          },
          style: {
            stroke: "#10b981",
            strokeWidth: 2.2,
          },
          labelStyle: {
            fill: "#a7f3d0",
            fontSize: 10,
            fontFamily: "monospace",
            fontWeight: 600,
          },
          labelBgStyle: {
            fill: "#022c22",
            fillOpacity: 0.92,
            stroke: "#10b981",
            strokeWidth: 0.6,
          },
          labelBgPadding: [5, 3] as [number, number],
        };
      }

      const srcNode = nodeMap.get(e.source);
      const dstNode = nodeMap.get(e.target);
      const goingUp = (srcNode?.y ?? 0) > (dstNode?.y ?? 0);

      const strokeColor =
        isCritical || isRedBlocker
          ? "#f43f5e"
          : isAmber
            ? "#f59e0b"
            : "#10b981";

      return {
        id: `${e.id}-${cutoverMode}`,
        source: e.source,
        target: e.target,
        sourceHandle: goingUp ? "top-source" : "bottom-source",
        targetHandle: goingUp ? "bottom-target" : "top-target",
        label: isAfter ? e.afterLabel : e.beforeLabel,
        animated: true,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: strokeColor,
        },
        style: {
          stroke: strokeColor,
          strokeWidth: isCritical ? 2.6 : 2,
          strokeDasharray: isCritical ? "6 3" : undefined,
        },
        labelStyle: {
          fill:
            isCritical || isRedBlocker
              ? "#fecdd3"
              : isAmber
                ? "#fde68a"
                : "#a7f3d0",
          fontSize: 10,
          fontFamily: "monospace",
          fontWeight: 600,
        },
        labelBgStyle: {
          fill: "#090d16",
          fillOpacity: 0.92,
          stroke: strokeColor,
          strokeWidth: 0.6,
        },
        labelBgPadding: [5, 3] as [number, number],
      };
    });
  }, [scenario.topologyEdges, scenario.topologyNodes, cutoverMode]);

  const selectedSpec = useMemo(
    () =>
      scenario.topologyNodes.find((n) => n.id === selectedNodeId) ??
      scenario.topologyNodes.find((n) => n.isRogueBypass || n.isShadowAsset) ??
      scenario.topologyNodes[0],
    [scenario.topologyNodes, selectedNodeId]
  );

  return (
    <div className="space-y-4">
      {/* Plain-English Before vs. After Interactive Story Switcher */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setCutoverMode("before")}
          className={`text-left p-4 rounded-md border transition-all flex items-start gap-3 ${
            cutoverMode === "before"
              ? "bg-rose-950/35 border-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.18)]"
              : "bg-slate-900/65 border-slate-800 hover:bg-slate-900"
          }`}
        >
          <div className="p-2 rounded bg-rose-500/20 border border-rose-500/40 shrink-0 mt-0.5">
            <Unlock className="w-4 h-4 text-rose-400" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs sm:text-sm font-bold text-slate-100">
                🔓 Today: Two-Way Software Firewall (Hackable ·{" "}
                {scenario.preCutoverSl})
              </span>
              {cutoverMode === "before" && (
                <span className="px-1.5 py-0.5 rounded bg-rose-500 text-slate-950 text-[10px] font-mono font-bold">
                  VIEWING
                </span>
              )}
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Office computers, remote contractors, and ransomware worms can
              reach <strong className="text-rose-300">inward</strong> into
              factory machines (red &amp; yellow downward arrows).
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setCutoverMode("after")}
          className={`text-left p-4 rounded-md border transition-all flex items-start gap-3 ${
            cutoverMode === "after"
              ? "bg-emerald-950/40 border-emerald-400 shadow-[0_0_24px_rgba(16,185,129,0.22)]"
              : "bg-slate-900/65 border-slate-800 hover:bg-slate-900"
          }`}
        >
          <div className="p-2 rounded bg-emerald-500/20 border border-emerald-500/40 shrink-0 mt-0.5">
            <Lock className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs sm:text-sm font-bold text-slate-100">
                🛡️ After ConduitAI: One-Way Hardware Diode (Un-hackable ·{" "}
                {scenario.postCutoverSl})
              </span>
              {cutoverMode === "after" && (
                <span className="px-1.5 py-0.5 rounded bg-emerald-400 text-slate-950 text-[10px] font-mono font-bold">
                  VIEWING
                </span>
              )}
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Click here to see the cutover: plant data flows{" "}
              <strong className="text-emerald-300">OUT</strong> to dashboards
              normally (all green upward streams), while inbound cyberattacks
              are physically cut off!
            </p>
          </div>
        </button>
      </div>

      {/* Simple Plain-English Legend Strip */}
      <div className="bg-slate-900/85 border border-slate-800 rounded-md px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-slate-200 font-semibold">
          <Network className="w-4 h-4 text-emerald-400" />
          <span>
            {isGuided
              ? "Simple Map Legend (Click any box on the map to inspect):"
              : `Conduit ${scenario.conduitId}: ${scenario.conduitName}`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs">
          <span className="inline-flex items-center gap-1.5 text-emerald-300">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <span>🟢 Safe Outbound Data (Flows Out Normally)</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-amber-300">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span>🟡 Auto-Reversed Polling (Mirrored Safely)</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-rose-300">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span>🔴 Blocked Attack / Rogue Bypass</span>
          </span>
        </div>
      </div>

      {/* Main Graph + Right Dual-Layer Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-9 h-[610px] rounded-md border border-slate-800 bg-zinc-950 relative overflow-hidden">
          <div className="absolute left-3 top-4 z-10 pointer-events-none space-y-[125px] text-[10px] font-mono uppercase tracking-wider">
            <div className="px-2 py-0.5 rounded bg-sky-950/75 border border-sky-500/30 text-sky-300">
              {isGuided
                ? "Top Floor · Corporate Office & Cloud (L4)"
                : "Purdue L4 · Enterprise IT / WAN"}
            </div>
            <div className="px-2 py-0.5 rounded bg-amber-950/75 border border-amber-500/30 text-amber-300">
              {isGuided
                ? "Security Barrier · Firewall vs. Data Diode (L3.5)"
                : "Purdue L3.5 · Conduit Boundary"}
            </div>
            <div className="px-2 py-0.5 rounded bg-emerald-950/75 border border-emerald-500/30 text-emerald-300">
              {isGuided
                ? "Control Room · Operator Screens & SCADA (L2/L3)"
                : "Purdue L3/L2 · OT SCADA & HMI"}
            </div>
            <div className="px-2 py-0.5 rounded bg-emerald-950/75 border border-emerald-500/30 text-emerald-300">
              {isGuided
                ? "Plant Floor · Physical Machines & Controllers (L1)"
                : "Purdue L1/L0 · PLCs, RTUs & Relays"}
            </div>
          </div>

          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            fitView
            fitViewOptions={{ padding: 0.16 }}
            minZoom={0.45}
            maxZoom={1.6}
          >
            <Background color="#1e293b" gap={24} size={1} />
            <Controls position="bottom-right" />
          </ReactFlow>
        </div>

        {/* Right Inspector: Plain-English Summary + Network Engineer Spec */}
        <div className="xl:col-span-3 space-y-3 flex flex-col">
          {selectedSpec && (
            <div className="p-4 rounded-md bg-slate-900/90 border border-slate-800 space-y-3 flex-1">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                <Info className="w-4 h-4 text-emerald-400" />
                <div>
                  <div className="text-xs font-bold text-slate-100">
                    {selectedSpec.hostname}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {selectedSpec.vendor} · {selectedSpec.role}
                  </div>
                </div>
              </div>

              {/* Plain-English Explanation for Non-Technical / Sales */}
              <div className="p-3 rounded bg-slate-950/90 border border-emerald-500/30 space-y-1">
                <div className="text-[10px] font-mono uppercase text-emerald-400 font-semibold">
                  Plain-English Summary
                </div>
                <p className="text-xs text-slate-200 leading-relaxed">
                  {describeNodeInPlainEnglish(
                    selectedSpec,
                    cutoverMode === "after"
                  )}
                </p>
              </div>

              {/* Technical Spec for Network Engineer */}
              <div className="space-y-1.5 pt-1 text-xs font-mono">
                <div className="flex items-center gap-1.5 text-[10px] uppercase text-sky-400 pb-1">
                  <Cpu className="w-3.5 h-3.5" />
                  <span>Network Engineer Spec</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">IPv4 / Subnet:</span>
                  <span className="text-emerald-300">{selectedSpec.ip}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Purdue Level:</span>
                  <span className="text-sky-300">
                    {selectedSpec.purdueLevel}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">VLAN / Trunk:</span>
                  <span className="text-slate-200">{selectedSpec.vlan}</span>
                </div>
              </div>

              {(selectedSpec.isShadowAsset || selectedSpec.isRogueBypass) && (
                <div className="p-2.5 rounded bg-rose-950/40 border border-rose-500/40 text-[11px] text-rose-200 leading-relaxed">
                  <div className="font-mono font-bold text-rose-300 mb-0.5">
                    HOW CONDUITAI CAUGHT THIS
                  </div>
                  {selectedSpec.isRogueBypass
                    ? "Invisible in perimeter firewall logs! Spotted physically on camera by Meta SAM 3.1 + switch MAC table + packet capture."
                    : "Missing from customer diagram & Excel inventory; uncovered automatically from switch ARP table + live packet traffic."}
                </div>
              )}
            </div>
          )}

          {/* Quick Tip for Customer Calls */}
          <div className="p-3.5 rounded-md bg-slate-900/85 border border-slate-800 text-xs text-slate-300 space-y-1">
            <div className="text-[10px] font-mono uppercase text-amber-400 font-semibold">
              💡 Tip During Customer Demo
            </div>
            <p className="leading-relaxed text-[11px] text-slate-300">
              Click between{" "}
              <strong className="text-rose-300">Today (Firewall)</strong> and{" "}
              <strong className="text-emerald-300">
                After (Hardware Diode)
              </strong>{" "}
              above to visually show executives how every red attack path
              disappears while business data keeps flowing upward.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
