"use client";

import React, { useState } from "react";
import { BrainCircuit, CheckCircle2, ChevronDown, ChevronUp, XCircle } from "lucide-react";
import { ScenarioDataset } from "@/types/conduit";

interface ArchitectDecisionPanelProps {
  scenario: ScenarioDataset;
}

/** Verifier verdict on a rule-engine plan, which gets the same hard-rule check as a model proposal. */
function FallbackCheck({ violations }: { violations: string[] | null }) {
  if (violations === null) return null;
  if (violations.length === 0) {
    return (
      <div className="text-xs text-emerald-800">
        The same verifier checked the rule-engine plan and found no violations.
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-rose-800">
        The verifier found {violations.length} issue{violations.length === 1 ? "" : "s"} in the
        rule-engine plan. An engineer must review before deployment:
      </div>
      <ul className="list-disc pl-5 text-xs text-rose-800 space-y-0.5">
        {violations.map((v, i) => (
          <li key={i}>{v}</li>
        ))}
      </ul>
    </div>
  );
}

/** Shows how the cutover plan was produced: Muse Wonder proposals and the verifier's verdicts. */
export default function ArchitectDecisionPanel({ scenario }: ArchitectDecisionPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const trace = scenario.architectTrace;
  const provenance = scenario.provenance ?? "reference";

  if (provenance === "reference") {
    return (
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-3 text-xs sm:text-sm text-slate-600 flex items-center gap-2.5">
        <BrainCircuit className="w-4 h-4 text-slate-400 shrink-0" />
        <span>
          Architect decision not computed yet. Run Analysis: Muse Wonder proposes each flow&apos;s
          tier and the hardware kit, and a deterministic verifier must accept it before it is shown.
        </span>
      </div>
    );
  }

  if (!trace || trace.attempts.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-3 space-y-2">
        <div className="text-xs sm:text-sm text-slate-700 flex items-center gap-2.5">
          <BrainCircuit className="w-4 h-4 text-slate-500 shrink-0" />
          <span>Plan produced by the deterministic rule engine (no live model call in this run).</span>
        </div>
        <FallbackCheck violations={trace?.fallbackViolations ?? null} />
      </div>
    );
  }

  const rejected = trace.attempts.filter((a) => a.violations.length > 0).length;
  const seconds = (trace.totalLatencyMs || trace.attempts.reduce((t, a) => t + a.latencyMs, 0)) / 1000;

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {trace.accepted ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          ) : (
            <XCircle className="w-5 h-5 text-amber-600 shrink-0" />
          )}
          <span className="text-sm font-semibold text-slate-900">
            {trace.accepted
              ? `${trace.model} proposed this plan · verifier accepted on attempt ${trace.attempts.length}`
              : `Verifier rejected all ${trace.attempts.length} ${trace.model} proposals · deterministic rule engine used`}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200">
            {rejected} rejected revision{rejected === 1 ? "" : "s"}
          </span>
          <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 font-mono">
            {seconds.toFixed(1)} s
          </span>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {trace.fallbackViolations !== null && (
        <div className="px-5 pb-3">
          <FallbackCheck violations={trace.fallbackViolations} />
        </div>
      )}

      {expanded && (
        <div className="border-t border-slate-100 px-5 py-3 space-y-3">
          <p className="text-xs text-slate-600">
            The verifier checks every proposal against hard rules: no inbound session graded
            GREEN, remote admin and lateral movement severed, each protocol supported by the chosen
            diode, capacity ≥ 1.25× peak, VLAN limits, and physical fit in the photographed cabinet.
            Violations go back to the model for revision.
          </p>
          <ol className="space-y-2">
            {trace.attempts.map((a) => (
              <li key={a.attempt} className="border border-slate-200 rounded-lg p-3 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-900">
                    Attempt {a.attempt} · {a.model}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-slate-500">{(a.latencyMs / 1000).toFixed(1)} s</span>
                    {a.violations.length === 0 ? (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        accepted
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                        rejected ({a.violations.length})
                      </span>
                    )}
                  </span>
                </div>
                {a.proposedBom.length > 0 && (
                  <div className="text-xs text-slate-700">
                    Proposed kit: <span className="font-mono">{a.proposedBom.join(" + ")}</span>
                  </div>
                )}
                {a.violations.length > 0 && (
                  <ul className="list-disc pl-5 text-xs text-rose-800 space-y-0.5">
                    {a.violations.map((v, i) => (
                      <li key={i}>{v}</li>
                    ))}
                  </ul>
                )}
                {a.reasoningExcerpt && (
                  <details className="text-xs text-slate-600">
                    <summary className="cursor-pointer select-none">Model reasoning excerpt</summary>
                    <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] leading-snug">
                      {a.reasoningExcerpt}
                    </p>
                  </details>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
