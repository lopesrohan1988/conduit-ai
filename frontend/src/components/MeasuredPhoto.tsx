"use client";

import React from "react";
import { MeasuredCabinet } from "@/types/conduit";

interface MeasuredPhotoProps {
  url: string;
  cabinet: MeasuredCabinet;
}

/** Photo with SAM 3.1 boxes drawn in the image's own pixel coordinates, so overlays stay aligned. */
export default function MeasuredPhoto({ url, cabinet }: MeasuredPhotoProps) {
  const { imageWidth: w, imageHeight: h } = cabinet;
  const stroke = Math.max(2, Math.round(w / 300));
  const font = Math.max(14, Math.round(w / 55));
  return (
    <div className="space-y-2">
      <div className="relative bg-slate-900 rounded-lg overflow-hidden" style={{ aspectRatio: `${w} / ${h}` }}>
        <img src={url} alt={cabinet.sourceImage} className="absolute inset-0 w-full h-full" />
        <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 w-full h-full pointer-events-none">
          {cabinet.detections.map((d, i) => {
            const [x1, y1, x2, y2] = d.bbox;
            const muted = d.semanticClass.startsWith("INSTALLED");
            return (
              <g key={i}>
                <rect
                  x={x1}
                  y={y1}
                  width={x2 - x1}
                  height={y2 - y1}
                  fill={muted ? "none" : `${d.color}22`}
                  stroke={d.color}
                  strokeWidth={muted ? stroke / 2 : stroke}
                  strokeDasharray={muted ? `${stroke * 3} ${stroke * 2}` : undefined}
                />
                {!muted && (
                  <text
                    x={x1 + stroke * 2}
                    y={Math.max(font, y1 - stroke * 2)}
                    fontSize={font}
                    fontFamily="monospace"
                    fontWeight="bold"
                    fill={d.color}
                    stroke="#0f172a"
                    strokeWidth={font / 6}
                    paintOrder="stroke"
                  >
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <ul className="text-[11px] text-slate-600 space-y-0.5">
        <li className="font-medium text-slate-700">
          Measured from SAM 3.1 boxes ({cabinet.measurementSource.replace(/_/g, " ")})
        </li>
        {cabinet.notes.map((n, i) => (
          <li key={i}>· {n}</li>
        ))}
      </ul>
    </div>
  );
}
