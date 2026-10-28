"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronUp, ShieldAlert, ShieldCheck } from "lucide-react";
import { AttackReplay } from "@/types/conduit";

interface AttackReplayPanelProps {
  replay: AttackReplay | null | undefined;
}

/** "If IT is hacked": real command packets against today's network and the proposed design. */
export default function AttackReplayPanel({ replay }: AttackReplayPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (!replay) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-3 text-xs sm:text-sm text-slate-600">
        Run Analysis to replay real attack commands (breaker trips, valve and setpoint writes) from a
        hacked IT network against today&apos;s network and the proposed diode design.
      </div>
    );
  }

  const today = replay.today.reachedPlant;
  const after = replay.proposed.reachedPlant;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
      <div className="px-5 py-4 space-y-3">
        <div className="text-sm font-semibold text-slate-900">If the office IT network is hacked…</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-rose-700">
              <ShieldAlert className="w-4 h-4" /> Today
            </div>
            <div className="mt-1 text-2xl font-bold text-rose-700">
              {today} of {replay.today.attempts}
            </div>
            <div className="text-xs text-rose-800">attack commands reach plant equipment</div>
          </div>
          <div
            className={`rounded-lg border p-3 ${
              after === 0 ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"
            }`}
          >
            <div
              className={`flex items-center gap-2 text-xs font-medium ${
                after === 0 ? "text-emerald-700" : "text-rose-700"
              }`}
            >
              <ShieldCheck className="w-4 h-4" /> With the proposed diode
            </div>
            <div className={`mt-1 text-2xl font-bold ${after === 0 ? "text-emerald-700" : "text-rose-700"}`}>
              {after} of {replay.proposed.attempts}
            </div>
            <div className={`text-xs ${after === 0 ? "text-emerald-800" : "text-rose-800"}`}>
              reach the plant · {replay.feedsKept} data feeds to the office keep working
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-600">
          {replay.realCommandFrames} of the attempts are real command packets taken from public
          industrial captures ({replay.commandFrameSources.length} files), sent down the exact paths
          this site&apos;s traffic uses today. {replay.threatModel}
        </p>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {expanded ? "Hide" : "Show"} each attack path
        </button>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 px-5 py-3 space-y-2">
          {replay.paths.map((p) => (
            <div key={`${p.flowId}-${p.attacker}`} className="border border-slate-200 rounded-lg p-3 text-xs space-y-1">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-semibold text-slate-900">
                  {p.via === "bypass device" ? "Bypass device" : "Hacked IT host"} {p.attacker} → {p.target}:
                  {p.port} ({p.protocol})
                </span>
                <span>
                  <span className="text-rose-700 font-medium">today {p.reachedPlantToday}</span>
                  {" · "}
                  <span className={p.reachedPlantProposed === 0 ? "text-emerald-700 font-medium" : "text-rose-700 font-medium"}>
                    proposed {p.reachedPlantProposed}
                  </span>
                </span>
              </div>
              <div className="text-slate-600">
                Commands: {Array.from(new Set(p.frames.map((f) => f.label))).join(", ")}
              </div>
              <div className="text-slate-500">Proposed design: {p.proposedOutcome}</div>
            </div>
          ))}
          <p className="text-[11px] text-slate-500">{replay.caveat}</p>
        </div>
      )}
    </div>
  );
}
