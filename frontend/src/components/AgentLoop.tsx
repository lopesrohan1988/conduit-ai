"use client";

import React, { useEffect, useState } from "react";
import { BrainCircuit, CheckCircle2, CornerDownLeft, FlaskConical, Loader2, MinusCircle, ShieldCheck, XCircle } from "lucide-react";
import { ArchitectAttempt, ScenarioDataset, VerifierCheck } from "@/types/conduit";
import { API_BASE } from "@/lib/api";

interface Challenge {
  connection: string;
  detail: string;
  change: string;
  violations: string[];
  checks: VerifierCheck[];
}

function modelName(model: string): string {
  if (/open|glimmer/i.test(model)) return "Muse Spark Open (open weights)";
  if (/wonder/i.test(model)) return "Muse Wonder";
  return model;
}

/** The rule checker's verdict on one draft, one row per hard rule */
function Checklist({ checks }: { checks: VerifierCheck[] }) {
  return (
    <ul className="space-y-1">
      {checks.map((c) => {
        const failed = c.violations.length > 0;
        const absent = !failed && c.applies === 0;
        return (
          <li key={c.rule} className="text-xs">
            <div className="flex items-start gap-1.5">
              {failed ? (
                <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-px" />
              ) : absent ? (
                <MinusCircle className="w-3.5 h-3.5 text-slate-300 shrink-0 mt-px" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-px" />
              )}
              <span className={failed ? "text-rose-800 font-medium" : absent ? "text-slate-400" : "text-slate-700"}>
                {c.rule}
                {c.scope && <span className="text-slate-400"> · {absent ? "none in this plant" : c.scope}</span>}
              </span>
            </div>
            {failed && (
              <ul className="ml-5 mt-0.5 space-y-0.5 list-disc pl-3 text-[11px] text-rose-700">
                {c.violations.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Draft({ a, recorded }: { a: ArchitectAttempt; recorded: boolean }) {
  const failed = a.violations.length > 0;
  return (
    <div className={`rounded-lg border p-3 space-y-2 ${failed ? "border-rose-200 bg-rose-50/40" : "border-emerald-200 bg-emerald-50/40"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-slate-900 flex items-center gap-1.5">
          <BrainCircuit className="w-4 h-4 text-blue-600" />
          Draft {a.attempt} by {modelName(a.model)}
          {recorded && <span className="font-normal text-slate-500">(recorded output)</span>}
        </span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-slate-500">{(a.latencyMs / 1000).toFixed(1)} s</span>
          <span
            className={`px-2 py-0.5 rounded-full border ${
              failed ? "bg-rose-50 text-rose-700 border-rose-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"
            }`}
          >
            {failed ? `rejected: ${a.violations.length} problem${a.violations.length === 1 ? "" : "s"}` : "passed every rule"}
          </span>
        </span>
      </div>
      {a.proposedBom.length > 0 && (
        <div className="text-xs text-slate-600">
          Proposed kit: <span className="font-mono">{a.proposedBom.join(" + ")}</span>
        </div>
      )}
      {a.reasoningExcerpt && (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer select-none">The model&apos;s reasoning (excerpt)</summary>
          <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] leading-snug">{a.reasoningExcerpt}</p>
        </details>
      )}
      {a.checks.length > 0 ? (
        <Checklist checks={a.checks} />
      ) : (
        failed && (
          <ul className="list-disc pl-5 text-xs text-rose-800 space-y-0.5">
            {a.violations.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

/** Reopen a connection the plan cut and let the live rule checker judge it */
function CheckerChallenge({ scenarioId }: { scenarioId: string }) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<Challenge | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setState("idle");
    setResult(null);
  }, [scenarioId]);

  const run = async () => {
    setState("running");
    try {
      const res = await fetch(`${API_BASE}/api/v1/assessments/${encodeURIComponent(scenarioId)}/challenge-verifier`, {
        method: "POST",
      });
      const body = (await res.json()) as { challenge?: Challenge | null; detail?: string };
      if (!res.ok) throw new Error(body.detail ?? `HTTP ${res.status}`);
      if (!body.challenge) {
        setMessage("This plan cut nothing, so there is no dangerous connection to reopen.");
        setState("error");
        return;
      }
      setResult(body.challenge);
      setState("done");
    } catch (err) {
      setMessage(`Could not reach the rule checker (${String(err)}).`);
      setState("error");
    }
  };

  if (state === "done" && result) {
    const failed = result.checks.filter((c) => c.violations.length > 0);
    return (
      <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 space-y-2">
        <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
          <FlaskConical className="w-4 h-4 text-violet-600" />
          Test: reopen the most dangerous connection the plan cut
        </div>
        <div className="text-xs text-slate-700">
          <span className="font-mono">{result.connection}</span>
          <span className="text-slate-500"> · {result.detail}</span>
          <br />
          Change sent to the rule checker: {result.change.toLowerCase()}.
        </div>
        {result.violations.length > 0 ? (
          <>
            <div className="text-xs font-medium text-rose-800">
              Rejected: {failed.length} rule{failed.length === 1 ? "" : "s"} broken. A model draft with this
              change would be sent back, never shown.
            </div>
            <Checklist checks={failed} />
          </>
        ) : (
          <div className="text-xs font-medium text-amber-800">
            The rule checker accepted this change; it is not covered by a hard rule.
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={state === "running"}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-violet-200 bg-white hover:bg-violet-50 text-xs font-medium text-violet-700 disabled:opacity-60"
      >
        {state === "running" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
        Test the rule checker: try to sneak a dangerous change past it
      </button>
      {state === "error" && <span className="text-xs text-slate-500">{message}</span>}
    </div>
  );
}

/**
 * The architect agent's loop made visible: the model drafts a plan, an independent rule checker
 * tests it against hard safety rules, and every failure goes back to the model to fix.
 */
export default function AgentLoop({ scenario }: { scenario: ScenarioDataset }) {
  const trace = scenario.architectTrace;
  if (!trace) return null;
  const drafts = trace.attempts.filter((a) => !a.violations.some((v) => v.startsWith("MODEL_UNAVAILABLE")));
  const recorded = trace.finalSourceMode === "recorded_verified" || drafts.some((a) => a.sourceMode === "recorded");
  const connections = drafts[0]?.checks[0]?.scope ?? trace.fallbackChecks[0]?.scope ?? "";

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">How the AI agent designed this plan</h3>
        <span className="text-xs text-slate-500">
          {drafts.length > 0
            ? `${modelName(trace.model)} · ${drafts.length} draft${drafts.length === 1 ? "" : "s"} · ${(trace.totalLatencyMs / 1000).toFixed(1)} s`
            : "Backup rule engine"}
        </span>
      </div>
      <p className="text-xs text-slate-600">
        The agent drafts a plan from what it measured ({connections ? `${connections}, ` : ""}
        {scenario.telemetry.totalDiscoveredAssets} hosts). An independent rule checker, written as
        plain code and not an AI, tests every draft against hard safety rules. Each failure is sent
        back to the agent to fix. Only a plan that passes every rule is shown.
      </p>

      <ol className="space-y-2">
        {drafts.map((a, i) => (
          <li key={a.attempt} className="space-y-2">
            <Draft a={a} recorded={a.sourceMode === "recorded" || (recorded && a.sourceMode !== "live")} />
            {a.violations.length > 0 && (
              <div className="flex items-center gap-1.5 pl-3 text-xs text-slate-500">
                <CornerDownLeft className="w-3.5 h-3.5" />
                {i < drafts.length - 1
                  ? `Sent back to the agent: "fix ${a.violations.length === 1 ? "this problem" : `these ${a.violations.length} problems`}"`
                  : "Out of attempts: the plan comes from the backup rule engine instead"}
              </div>
            )}
          </li>
        ))}
      </ol>

      {!trace.accepted && trace.fallbackViolations !== null && (
        <div
          className={`rounded-lg border p-3 space-y-2 ${
            trace.fallbackViolations.length > 0 ? "border-rose-200 bg-rose-50/40" : "border-slate-200 bg-slate-50/60"
          }`}
        >
          <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-slate-600" />
            {drafts.length > 0 ? "Backup rule-engine plan" : "Plan from the backup rule engine (no model call in this run)"},
            checked by the same rules
          </div>
          {trace.fallbackChecks.length > 0 && <Checklist checks={trace.fallbackChecks} />}
        </div>
      )}

      {scenario.provenance && scenario.provenance !== "reference" && scenario.provenance !== "custom_upload" &&
        (scenario.topologySummary?.connectionsCut ?? 0) > 0 && (
        <CheckerChallenge scenarioId={scenario.id} />
      )}
    </div>
  );
}
