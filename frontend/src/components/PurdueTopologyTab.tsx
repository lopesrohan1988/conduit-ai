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
  AlertTriangle,
  Lock,
  Unlock,
} from "lucide-react";
import {
  ScenarioDataset,
  TopologyNodeSpec,
  UserLensMode,
} from "@/types/conduit";

interface PurdueTopologyTabProps {
  scenario: ScenarioDataset;
  userLens?: UserLensMode;
  /** Pin the map to one view (story mode) instead of showing the today/proposed switch */
  fixedMode?: "before" | "after";
  /** Map only: no control bar or device inspector */
  embedded?: boolean;
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
        className={`min-w-[295px] rounded-xl px-3.5 py-2.5 border-2 transition-all shadow-sm ${
          isAfter
            ? "bg-emerald-50/80 border-emerald-500"
            : "bg-amber-50/80 border-amber-400"
        } ${selected ? "ring-2 ring-blue-500/40" : ""}`}
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
          className="!bg-emerald-500 !w-2.5 !h-2.5"
        />

        <div className="flex items-center justify-between gap-2 mb-1">
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
              isAfter
                ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                : "bg-amber-100 text-amber-900 border-amber-200"
            }`}
          >
            {isAfter
              ? `Hardware Diode (${postSl})`
              : `Software Firewall (${preSl})`}
          </span>
          <span className="text-[10px] font-mono text-slate-500">
            {spec.vlan}
          </span>
        </div>

        {isAfter ? (
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{archetypeSummary}</span>
            </div>
            <div className="flex items-center justify-between gap-1 px-2 py-1 rounded-md bg-white border border-emerald-200 text-[10px] font-mono text-emerald-800">
              <span>Plant TX</span>
              <ArrowRight className="w-3 h-3 text-emerald-600" />
              <span className="font-semibold">1-Way Lock</span>
              <ArrowRight className="w-3 h-3 text-emerald-600" />
              <span>Office Mirror</span>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                {spec.hostname} ({spec.vendor})
              </span>
            </div>
            <div className="text-[11px] text-amber-900/80 mt-0.5">
              Two-way connection — inward access exposed
            </div>
          </div>
        )}

        <Handle
          type="source"
          position={Position.Bottom}
          id="bottom-source"
          className="!bg-amber-500 !w-2.5 !h-2.5"
        />
        <Handle
          type="target"
          position={Position.Bottom}
          id="bottom-target"
          className="!bg-emerald-500 !w-2.5 !h-2.5"
        />
      </div>
    );
  }

  const isRogue = Boolean(spec.isRogueBypass);
  const isShadow = Boolean(spec.isShadowAsset);
  const isQuarantinedRogue = isRogue && isAfter;

  const levelBadgeColor =
    spec.purdueLevel === "L4"
      ? "bg-slate-100 text-slate-700 border-slate-200"
      : spec.purdueLevel === "BYPASS"
        ? "bg-rose-50 text-rose-700 border-rose-200"
        : "bg-emerald-50 text-emerald-700 border-emerald-200";

  const cardStyle = isQuarantinedRogue
    ? "bg-slate-100 border-slate-300 opacity-65"
    : isRogue
      ? "bg-rose-50/70 border-rose-400"
      : isShadow
        ? isAfter
          ? "bg-white border-emerald-400"
          : "bg-rose-50/40 border-rose-400"
        : "bg-white border-slate-300 hover:border-slate-400";

  return (
    <div
      className={`min-w-[200px] max-w-[230px] rounded-xl px-3 py-2 border-2 transition-all shadow-sm ${cardStyle} ${
        selected ? "ring-2 ring-blue-500/40" : ""
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="top-target"
        className="!bg-slate-400 !w-2 !h-2"
      />
      <Handle
        type="source"
        position={Position.Top}
        id="top-source"
        className="!bg-emerald-500 !w-2 !h-2"
      />

      <div className="flex items-center justify-between gap-1.5 mb-1">
        <span
          className={`px-1.5 py-[1px] rounded text-[10px] font-semibold border ${levelBadgeColor}`}
        >
          {spec.purdueLevel === "L4"
            ? "L4 IT"
            : spec.purdueLevel === "BYPASS"
              ? "Bypass"
              : `${spec.purdueLevel} Plant`}
        </span>
        <span className="text-[10px] font-mono text-slate-500 truncate">
          {spec.ip}
        </span>
      </div>

      <div className="text-xs font-semibold text-slate-900 truncate">
        {spec.hostname}
      </div>
      <div className="text-[11px] text-slate-500 truncate">
        {spec.vendor} · {spec.role}
      </div>

      {spec.anomalyBadge && (
        <div
          className={`mt-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium inline-flex items-center gap-1 border ${
            isQuarantinedRogue
              ? "bg-slate-100 text-slate-500 border-slate-200 line-through"
              : isRogue || (!isAfter && isShadow)
                ? "bg-rose-50 text-rose-700 border-rose-200"
                : "bg-emerald-50 text-emerald-700 border-emerald-200"
          }`}
        >
          <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
          <span>
            {isQuarantinedRogue
              ? "Port Shut"
              : isAfter && isShadow
                ? "Mirrored Safely"
                : spec.anomalyBadge}
          </span>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom-source"
        className="!bg-slate-400 !w-2 !h-2"
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="bottom-target"
        className="!bg-slate-400 !w-2 !h-2"
      />
    </div>
  );
}

type LaneLabelNode = Node<{ label: string }, "laneLabel">;

/** Row title drawn inside the graph so it stays aligned when the map is zoomed or fitted */
function LaneLabelComponent({ data }: NodeProps<LaneLabelNode>) {
  return (
    <div className="px-2.5 py-1 rounded-md bg-white/90 border border-slate-200 text-xs font-semibold text-slate-600 shadow-sm whitespace-nowrap">
      {data.label}
    </div>
  );
}

const nodeTypes = {
  purdueAsset: PurdueAssetNodeComponent,
  laneLabel: LaneLabelComponent,
};

function describeNodeShort(spec: TopologyNodeSpec, isAfter: boolean): string {
  if (spec.isBoundaryNode) {
    return isAfter
      ? "Physical one-way hardware diode: telemetry flows out to dashboards while inbound attacks are physically impossible."
      : "Software firewall routing traffic two ways—ransomware or stolen credentials can still reach inward.";
  }
  if (spec.isRogueBypass) {
    return isAfter
      ? "Unauthorized bypass modem unplugged and switch port administratively shut down."
      : "Unauthorized cellular modem bypassing the main firewall directly into the control cabinet.";
  }
  if (spec.isShadowAsset) {
    return isAfter
      ? "Previously unlisted floor device—now inventoried and safely mirrored through the diode."
      : "Active floor device missing from the customer's diagram; discovered via switch ARP and packet logs.";
  }
  if (spec.purdueLevel === "L4") {
    return isAfter
      ? "Corporate IT server reading live plant values from the safe DMZ replica without inward plant access."
      : "Corporate IT server connecting directly across the firewall toward plant equipment.";
  }
  return isAfter
    ? "Protected plant equipment shielded from inbound cyberattacks while streaming live telemetry out."
    : "Plant equipment currently reachable by inward network connections.";
}

export default function PurdueTopologyTab({
  scenario,
  userLens = "guided_collab",
  fixedMode,
  embedded = false,
}: PurdueTopologyTabProps) {
  const isGuided = userLens === "guided_collab";
  const [modeState, setCutoverMode] = useState<CutoverViewMode>("before");
  const cutoverMode = fixedMode ?? modeState;
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

  const nodes: Array<PurdueGraphNode | LaneLabelNode> = useMemo(() => {
    const assetNodes: PurdueGraphNode[] = scenario.topologyNodes.map((spec) => ({
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
    }));
    const specs = scenario.topologyNodes;
    if (specs.length === 0) return assetNodes;
    const left = Math.min(...specs.map((n) => n.x)) - 210;
    const ys = specs.filter((n) => !n.isBoundaryNode && !n.isRogueBypass).map((n) => n.y);
    const boundary = specs.find((n) => n.isBoundaryNode);
    const lanes: Array<[string, number]> = [
      [isGuided ? "Office network (IT)" : "Enterprise IT · Purdue L4", Math.min(...ys)],
      [isGuided ? "The wall between them" : "IT/OT boundary · L3.5", boundary?.y ?? 230],
      [isGuided ? "Plant network (OT)" : "Plant OT · Purdue L0–L3", Math.max(...ys)],
    ];
    const laneNodes: LaneLabelNode[] = lanes.map(([label, y], i) => ({
      id: `lane-${i}`,
      type: "laneLabel",
      position: { x: left, y: y + 20 },
      data: { label },
      draggable: false,
      selectable: false,
    }));
    return [...laneNodes, ...assetNodes];
  },
    [
      scenario.topologyNodes,
      cutoverMode,
      archetypeSummary,
      scenario.preCutoverSl,
      scenario.postCutoverSl,
      isGuided,
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
            stroke: "#94a3b8",
            strokeWidth: 1.5,
            strokeDasharray: "5 5",
            opacity: 0.65,
          },
          labelStyle: {
            fill: "#be123c",
            fontSize: 10,
            fontFamily: "monospace",
            fontWeight: 600,
          },
          labelBgStyle: {
            fill: "#fff1f2",
            fillOpacity: 0.96,
            stroke: "#fecdd3",
            strokeWidth: 1,
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
            color: "#059669",
          },
          style: {
            stroke: "#059669",
            strokeWidth: 2,
          },
          labelStyle: {
            fill: "#047857",
            fontSize: 10,
            fontFamily: "monospace",
            fontWeight: 600,
          },
          labelBgStyle: {
            fill: "#ecfdf5",
            fillOpacity: 0.96,
            stroke: "#a7f3d0",
            strokeWidth: 1,
          },
          labelBgPadding: [5, 3] as [number, number],
        };
      }

      const srcNode = nodeMap.get(e.source);
      const dstNode = nodeMap.get(e.target);
      const goingUp = (srcNode?.y ?? 0) > (dstNode?.y ?? 0);

      const strokeColor =
        isCritical || isRedBlocker
          ? "#e11d48"
          : isAmber
            ? "#d97706"
            : "#059669";

      const labelTextFill =
        isCritical || isRedBlocker
          ? "#be123c"
          : isAmber
            ? "#b45309"
            : "#047857";

      const labelBgFill =
        isCritical || isRedBlocker
          ? "#fff1f2"
          : isAmber
            ? "#fffbeb"
            : "#ecfdf5";

      const labelBorder =
        isCritical || isRedBlocker
          ? "#fecdd3"
          : isAmber
            ? "#fde68a"
            : "#a7f3d0";

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
          strokeWidth: isCritical ? 2.4 : 2,
          strokeDasharray: isCritical ? "6 3" : undefined,
        },
        labelStyle: {
          fill: labelTextFill,
          fontSize: 10,
          fontFamily: "monospace",
          fontWeight: 600,
        },
        labelBgStyle: {
          fill: labelBgFill,
          fillOpacity: 0.96,
          stroke: labelBorder,
          strokeWidth: 1,
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
      {/* Clean Single-Row Control Bar */}
      {!embedded && (
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-wrap justify-between items-center gap-3">
        {/* Segmented Before vs After Switch */}
        <div
          className="inline-flex flex-wrap items-center bg-slate-100 p-1 rounded-lg border border-slate-200/80 gap-1"
          role="group"
          aria-label="Security Map Architecture Toggle"
        >
          <button
            type="button"
            onClick={() => setCutoverMode("before")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all ${
              cutoverMode === "before"
                ? "bg-white text-rose-700 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Unlock className="w-3.5 h-3.5" />
            <span>Current: Software Firewall (Two-Way)</span>
          </button>

          <button
            type="button"
            onClick={() => setCutoverMode("after")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all ${
              cutoverMode === "after"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Proposed: Hardware Diode (One-Way)</span>
          </button>
        </div>

        {/* Simple 3-Item Legend */}
        <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-600 px-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span>Safe Outbound</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span>Auto-Reversed</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span>Blocked Threat</span>
          </span>
        </div>
      </div>

      )}

      {/* Light-Mode Blueprint Graph + Concise Side Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div
          className={`${
            embedded ? "xl:col-span-12 h-[420px]" : "xl:col-span-9 h-[560px]"
          } rounded-xl border border-slate-200 bg-slate-50/80 shadow-sm relative overflow-hidden`}
        >
          <ReactFlow
            nodes={nodes}
            // Story maps rely on colour alone: per-connection labels pile up at the boundary
            edges={embedded ? edges.map((e) => ({ ...e, label: undefined })) : edges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            fitView
            fitViewOptions={{ padding: 0.16 }}
            minZoom={0.45}
            maxZoom={1.6}
          >
            <Background color="#cbd5e1" gap={20} size={1} />
            <Controls position="bottom-right" />
          </ReactFlow>
        </div>

        {/* Concise Right-Hand Node Inspector */}
        <div className="xl:col-span-3">
          {selectedSpec && !embedded && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3.5">
              <div>
                <div className="text-xs font-medium text-slate-500">
                  Selected Device
                </div>
                <h4 className="text-sm font-semibold text-slate-900 mt-0.5">
                  {selectedSpec.hostname}
                </h4>
                <div className="text-xs text-slate-500">
                  {selectedSpec.vendor}
                </div>
              </div>

              {/* 1 Short Plain-English Explanation */}
              <p className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 leading-relaxed">
                {describeNodeShort(selectedSpec, cutoverMode === "after")}
              </p>

              {/* Compact Key-Value Specs */}
              <div className="divide-y divide-slate-100 text-xs">
                <div className="py-1.5 flex items-center justify-between gap-2">
                  <span className="text-slate-500">IP Address</span>
                  <span className="font-mono font-medium text-slate-900">
                    {selectedSpec.ip}
                  </span>
                </div>
                <div className="py-1.5 flex items-center justify-between gap-2">
                  <span className="text-slate-500">Zone</span>
                  <span className="font-mono font-medium text-slate-900">
                    {selectedSpec.purdueLevel} · {selectedSpec.vlan}
                  </span>
                </div>
                <div className="py-1.5 flex items-center justify-between gap-2">
                  <span className="text-slate-500">Role</span>
                  <span className="font-medium text-slate-900 text-right">
                    {selectedSpec.role}
                  </span>
                </div>
              </div>

              {(selectedSpec.isShadowAsset || selectedSpec.isRogueBypass) && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 leading-snug">
                  <span className="font-semibold">Discovery Note: </span>
                  {selectedSpec.isRogueBypass
                    ? "Spotted on camera by SAM 3.1 + switch MAC table."
                    : "Missing from diagram; caught in switch ARP + PCAP."}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
