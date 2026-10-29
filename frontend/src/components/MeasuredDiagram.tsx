"use client";

import React from "react";
import { MeasuredDiagram as MeasuredDiagramData } from "@/types/conduit";

interface MeasuredDiagramProps {
  url: string;
  diagram: MeasuredDiagramData;
}

const STATUS_COLOR: Record<string, string> = {
  seen: "#059669",
  not_seen: "#d97706",
  not_a_device: "#64748b",
};

/** The customer's drawing with SAM 3.1 boxes, each read by Muse Spark and checked against the network. */
export default function MeasuredDiagram({ url, diagram }: MeasuredDiagramProps) {
  const { imageWidth: w, imageHeight: h } = diagram;
  const stroke = Math.max(2, Math.round(w / 500));
  const font = Math.max(12, Math.round(w / 90));
  const flagged = diagram.missingFromDrawing.filter((m) => m.undocumented);
  const others = diagram.missingFromDrawing.length - flagged.length;

  return (
    <div className="space-y-3">
      <div className="relative bg-slate-900 rounded-lg overflow-hidden" style={{ aspectRatio: `${w} / ${h}` }}>
        <img src={url} alt={diagram.sourceImage} className="absolute inset-0 w-full h-full" />
        <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 w-full h-full pointer-events-none">
          {diagram.regions.map((g, i) => {
            const [x1, y1, x2, y2] = g.bbox;
            const color = STATUS_COLOR[g.status] ?? STATUS_COLOR.not_a_device;
            const device = g.status !== "not_a_device";
            return (
              <g key={i}>
                <rect
                  x={x1}
                  y={y1}
                  width={x2 - x1}
                  height={y2 - y1}
                  fill={device ? `${color}14` : "none"}
                  stroke={color}
                  strokeWidth={device ? stroke : stroke / 2}
                  strokeDasharray={device ? undefined : `${stroke * 3} ${stroke * 2}`}
                />
                {device && (
                  <text
                    x={x2 - stroke * 2}
                    y={y2 - stroke * 2}
                    textAnchor="end"
                    fontSize={font}
                    fontWeight={700}
                    fill={color}
                    stroke="white"
                    strokeWidth={font / 5}
                    paintOrder="stroke"
                  >
                    {g.status === "seen" ? "seen on network" : "not seen"}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        <span>
          <span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: STATUS_COLOR.seen }} />
          Drawn and seen on the network
        </span>
        <span>
          <span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: STATUS_COLOR.not_seen }} />
          Drawn but never seen
        </span>
        <span>
          <span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: STATUS_COLOR.not_a_device }} />
          Zone, label or legend
        </span>
      </div>

      <div className="rounded-lg border border-slate-200 p-3 space-y-2 text-xs text-slate-700">
        <div>
          SAM 3.1 found {diagram.regions.length} boxes on this drawing and Muse Spark read each one (
          {diagram.readSourceMode.replace(/_/g, " ")}). {diagram.drawnSeen} of {diagram.drawnDevices} drawn
          devices were seen on the network; {diagram.missingFromDrawing.length} hosts on the network are not on
          the drawing.
        </div>
        {flagged.length > 0 && (
          <div className="space-y-1">
            <div className="font-medium text-rose-800">
              Not on the drawing and not in the asset list either:
            </div>
            <ul className="list-disc pl-5 space-y-0.5 text-rose-800">
              {flagged.map((m) => (
                <li key={m.ip} className="font-mono">
                  {m.ip}
                  {m.hostname ? ` ${m.hostname}` : ""}
                  {m.vendor ? ` (${m.vendor})` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        {others > 0 && (
          <details>
            <summary className="cursor-pointer select-none text-slate-600">
              {others} other host{others === 1 ? " is" : "s are"} on the network but not drawn (drawings
              often show key devices only)
            </summary>
            <ul className="mt-1 columns-1 sm:columns-2 text-[11px] font-mono text-slate-600">
              {diagram.missingFromDrawing
                .filter((m) => !m.undocumented)
                .map((m) => (
                  <li key={m.ip}>
                    {m.ip} {m.hostname ?? ""}
                  </li>
                ))}
            </ul>
          </details>
        )}
        <div className="text-[11px] text-slate-500">
          Labels are matched by IP address, so a misread name does not change the result.
        </div>
      </div>
    </div>
  );
}
