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
  Network,
} from "lucide-react";
import { ScenarioDataset, TopologyNodeSpec } from "@/types/conduit";

interface PurdueTopologyTabProps {
  scenario: ScenarioDataset;
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

function PurdueAssetNodeComponent({ data, selected }: NodeProps<PurdueGraphNode>) {
  const { spec, mode, archetypeSummary, preSl, postSl } = data;
  const isAfter = mode === "after";

  // Dramatic Boundary Node (L3.5 Software Firewall vs Hardware Data Diode Conduit)
  if (spec.isBoundaryNode) {
    return (
      <div
        className={`min-w-[300px] rounded-md px-3.5 py-2.5 border-2 transition-all shadow-xl ${
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
            {isAfter ? `L3.5 HARDWARE DIODE (${postSl})` : `L3.5 SOFTWARE FW (${preSl})`}
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
              <span>OT TX POLLER</span>
              <ArrowRight className="w-3 h-3 text-emerald-400" />
              <span className="px-1 rounded bg-emerald-500/20 text-emerald-200">
                L1/L2 DIODE
              </span>
              <ArrowRight className="w-3 h-3 text-emerald-400" />
              <span>IT RX REPLICA</span>
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
              Bi-Directional IP Routing · Inbound TCP Pinholes Open
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

  // Standard, Shadow OT, or Rogue 5G Bypass Node
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
          {spec.purdueLevel}
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
              ? "CONFISCATED & PORT SHUT"
              : isAfter && isShadow
                ? "BASELINED + TX POLLED"
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

export default function PurdueTopologyTab({ scenario }: PurdueTopologyTabProps) {
  const [cutoverMode, setCutoverMode] = useState<CutoverViewMode>("before");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedNodeId(null);
  }, [scenario.id]);

  const archetypeSummary = useMemo(
    () =>
      scenario.bom.items
        .map((i) => `${i.quantity}x ${i.archetypeId.replace(/_/g, " ")}`)
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

      // In AFTER mode:
      // 1) Critical exploit & bypass edges are physically severed!
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

      // 2) Amber inbound IT->OT polls flip direction to upward OT->Diode->RX Replica one-way streams!
      if (isAfter && (isAmber || isRedBlocker)) {
        const srcNode = nodeMap.get(e.source);
        const dstNode = nodeMap.get(e.target);
        // Ensure visual flow always moves upward (from higher Y OT to lower Y Boundary/IT)
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

      // 3) Green flows (both before & after) or Before-mode Amber/Red/Critical flows
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
      {/* Top Action Bar: Dramatic Before vs. After Hardware Data Diode Toggle */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-md p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Network className="w-4 h-4 text-emerald-400" />
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Interactive Purdue <code className="text-emerald-300">L0–L5</code> Zone & Conduit Graph
            </h3>
            <p className="text-xs font-mono text-slate-400">
              Conduit {scenario.conduitId}: {scenario.conduitName}
            </p>
          </div>
        </div>

        {/* Dramatic Before / After Segmented Switch */}
        <div className="inline-flex rounded-md bg-slate-950 p-1 border border-slate-800 gap-1">
          <button
            type="button"
            onClick={() => setCutoverMode("before")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded text-xs font-semibold transition-all ${
              cutoverMode === "before"
                ? "bg-rose-500/20 text-rose-200 border border-rose-500/60 shadow-[0_0_16px_rgba(244,63,94,0.2)]"
                : "text-slate-400 hover:text-slate-200 border border-transparent"
            }`}
          >
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            <span>Before: Software Firewall ({scenario.preCutoverSl})</span>
          </button>
          <button
            type="button"
            onClick={() => setCutoverMode("after")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded text-xs font-semibold transition-all ${
              cutoverMode === "after"
                ? "bg-emerald-500 text-slate-950 border border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.35)]"
                : "text-slate-400 hover:text-slate-200 border border-transparent"
            }`}
          >
            <Lock className="w-4 h-4" />
            <span>After: Hardware Data Diode ({scenario.postCutoverSl})</span>
          </button>
        </div>
      </div>

      {/* Main Graph + Right Purdue Zone & Node Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* React Flow Interactive Canvas (9 cols) */}
        <div className="xl:col-span-9 h-[620px] rounded-md border border-slate-800 bg-zinc-950 relative overflow-hidden">
          {/* Swimlane Level Watermarks */}
          <div className="absolute left-3 top-4 z-10 pointer-events-none space-y-[125px] text-[10px] font-mono uppercase tracking-wider">
            <div className="px-2 py-0.5 rounded bg-sky-950/70 border border-sky-500/30 text-sky-300">
              Purdue L4 · Enterprise IT / WAN
            </div>
            <div className="px-2 py-0.5 rounded bg-amber-950/70 border border-amber-500/30 text-amber-300">
              Purdue L3.5 · Conduit Boundary
            </div>
            <div className="px-2 py-0.5 rounded bg-emerald-950/70 border border-emerald-500/30 text-emerald-300">
              Purdue L3/L2 · OT SCADA & HMI
            </div>
            <div className="px-2 py-0.5 rounded bg-emerald-950/70 border border-emerald-500/30 text-emerald-300">
              Purdue L1/L0 · PLCs, RTUs & Relays
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

        {/* Right Telemetry & Selected Asset Inspector (3 cols) */}
        <div className="xl:col-span-3 space-y-3 flex flex-col">
          {/* Cutover Security Posture Card */}
          <div
            className={`p-3.5 rounded-md border ${
              cutoverMode === "after"
                ? "bg-emerald-950/25 border-emerald-500/50"
                : "bg-rose-950/25 border-rose-500/50"
            }`}
          >
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              Active Boundary Posture
            </div>
            <div className="text-base font-bold font-mono mt-1 text-slate-100">
              {cutoverMode === "after"
                ? `IEC 62443 ${scenario.postCutoverSl} ENFORCED`
                : `VULNERABLE (${scenario.preCutoverSl})`}
            </div>
            <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
              {cutoverMode === "after"
                ? "Physical OS-less TX → RX isolation severs 100% of inbound TCP SYN, RDP, SMBv1, and unauthorized actuation writes while preserving all OT telemetry via local pull-to-push replication."
                : "Bi-directional stateful firewall rules expose Level 1/2 OT controllers to inbound IT polling, ephemeral DCOM/SMB worms, and physical cellular bypasses."}
            </p>
          </div>

          {/* Selected Node Inspector */}
          {selectedSpec && (
            <div className="p-3.5 rounded-md bg-slate-900/85 border border-slate-800 space-y-2.5 flex-1">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                <Cpu className="w-4 h-4 text-sky-400" />
                <span className="text-xs font-semibold text-slate-100">
                  Selected Endpoint Inspector
                </span>
              </div>

              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-500">Hostname:</span>
                  <span className="text-slate-100 font-semibold">
                    {selectedSpec.hostname}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">IPv4 / Range:</span>
                  <span className="text-emerald-300">{selectedSpec.ip}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Purdue Zone:</span>
                  <span className="text-sky-300">
                    {selectedSpec.purdueLevel} ({selectedSpec.vlan})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Vendor:</span>
                  <span className="text-slate-200">{selectedSpec.vendor}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Function:</span>
                  <span className="text-slate-300">{selectedSpec.role}</span>
                </div>
              </div>

              {(selectedSpec.isShadowAsset || selectedSpec.isRogueBypass) && (
                <div className="p-2.5 rounded bg-rose-950/40 border border-rose-500/40 text-[11px] text-rose-200 leading-relaxed">
                  <div className="font-mono font-bold text-rose-300 mb-0.5">
                    3-WAY GRAPH RECONCILIATION ALERT
                  </div>
                  {selectedSpec.isRogueBypass
                    ? "Absent from customer diagram & FortiGate perimeter CSV; detected physically by Meta SAM 3.1 + switch port MAC table + PCAP packet dissection."
                    : "Absent from customer CAD diagram & asset_inventory.csv; uncovered via Baseten 1026 switch ARP/MAC parsing + DuckDB L7 protocol scan."}
                </div>
              )}
            </div>
          )}

          {/* Edge Color Legend */}
          <div className="p-3.5 rounded-md bg-slate-900/85 border border-slate-800 space-y-2 text-[11px] font-mono">
            <div className="text-slate-400 uppercase text-[10px]">
              Conduit Edge Legend
            </div>
            <div className="flex items-center gap-2 text-emerald-300">
              <span className="w-5 h-0.5 bg-emerald-400 inline-block" />
              <span>GREEN · Unidirectional OT → IT</span>
            </div>
            <div className="flex items-center gap-2 text-amber-300">
              <span className="w-5 h-0.5 bg-amber-400 inline-block" />
              <span>AMBER · Pull-to-Push Reversal</span>
            </div>
            <div className="flex items-center gap-2 text-rose-300">
              <span className="w-5 h-0.5 bg-rose-500 inline-block" />
              <span>CRITICAL / RED · Sever or Wrap</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
