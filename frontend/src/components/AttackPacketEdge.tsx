"use client";

import React, { useLayoutEffect, useRef, useState } from "react";
import { Position, getBezierPath, useInternalNode, type Edge, type EdgeProps } from "@xyflow/react";

export type AttackPacketData = {
  /** True when the plan stops this path: the packet halts at `stopAt` and an ✕ appears */
  blocked: boolean;
  /** Fraction of the path the packet covers before it is stopped (1 = reaches the target) */
  stopAt: number;
  delaySec: number;
  /** Node the packet passes through on the way (the firewall today), entering at its top */
  via?: string;
};

export type AttackPacketEdgeType = Edge<AttackPacketData, "attackPacket">;

const CYCLE_SEC = 2.4;

/** A command packet travelling one attack path: it reaches the plant today, or halts where the plan stops it. */
export default function AttackPacketEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<AttackPacketEdgeType>) {
  const viaNode = useInternalNode(data?.via ?? "");
  let path: string;
  if (data?.via && viaNode) {
    // source -> top of the via node, through it, bottom of the via node -> target
    const { x, y } = viaNode.internals.positionAbsolute;
    const w = viaNode.measured.width ?? 0;
    const h = viaNode.measured.height ?? 0;
    const cx = x + w / 2;
    const [inPath] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX: cx, targetY: y, targetPosition: Position.Top });
    const [outPath] = getBezierPath({ sourceX: cx, sourceY: y + h, sourcePosition: Position.Bottom, targetX, targetY, targetPosition });
    path = `${inPath} L ${cx},${y + h} ${outPath.replace(/^M[^C]*/, "")}`;
  } else {
    [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  }
  const pathRef = useRef<SVGPathElement>(null);
  const [end, setEnd] = useState<{ x: number; y: number }>({ x: targetX, y: targetY });
  const blocked = data?.blocked ?? false;
  const stopAt = blocked ? (data?.stopAt ?? 1) : 1;
  const begin = `${data?.delaySec ?? 0}s`;
  const dur = `${CYCLE_SEC}s`;

  useLayoutEffect(() => {
    const el = pathRef.current;
    if (!el) return;
    const p = el.getPointAtLength(el.getTotalLength() * stopAt);
    setEnd({ x: p.x, y: p.y });
  }, [path, stopAt]);

  const color = blocked ? "#e11d48" : "#be123c";
  return (
    <g className="pointer-events-none">
      <path ref={pathRef} id={`${id}-route`} d={path} fill="none" stroke={color} strokeOpacity={0.18} strokeWidth={2} />
      <circle r={7} fill={color} stroke="white" strokeWidth={2} opacity={0}>
        <animateMotion
          dur={dur}
          begin={begin}
          repeatCount="indefinite"
          keyPoints={`0;${stopAt};${stopAt}`}
          keyTimes="0;0.75;1"
          calcMode="linear"
        >
          <mpath href={`#${id}-route`} />
        </animateMotion>
        <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.8;1" dur={dur} begin={begin} repeatCount="indefinite" />
      </circle>
      {blocked ? (
        <text
          x={end.x}
          y={end.y + 6}
          textAnchor="middle"
          fontSize={20}
          fontWeight={800}
          fill="#e11d48"
          stroke="white"
          strokeWidth={3}
          paintOrder="stroke"
          opacity={0}
        >
          ✕
          <animate attributeName="opacity" values="0;0;1;0" keyTimes="0;0.72;0.8;1" dur={dur} begin={begin} repeatCount="indefinite" />
        </text>
      ) : (
        <circle cx={end.x} cy={end.y} r={0} fill="none" stroke="#e11d48" strokeWidth={3}>
          <animate attributeName="r" values="0;0;22" keyTimes="0;0.74;1" dur={dur} begin={begin} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;0;0.9;0" keyTimes="0;0.74;0.8;1" dur={dur} begin={begin} repeatCount="indefinite" />
        </circle>
      )}
    </g>
  );
}
