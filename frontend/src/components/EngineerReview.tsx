"use client";

import React, { useEffect, useState } from "react";
import { BadgeCheck, CheckCircle2, FileSearch, HelpCircle, Loader2, PenLine, XCircle } from "lucide-react";
import { EvidenceConflict, EvidenceManifest, ScenarioDataset } from "@/types/conduit";
import { API_BASE, withSession } from "@/lib/api";
import { Checklist } from "@/components/AgentLoop";

/** Plain wording for each cutover action; the enum names stay in the JSON bundle */
export const ACTION_LABEL: Record<string, string> = {
  DROP_IN_PROXY_MAPPING: "Keep: one-way out through the diode",
  PULL_TO_PUSH_PROXY_REVERSAL: "Keep: diode polls the plant, pushes a copy out",
  DEPLOY_OPC_UA_WRAPPER_THEN_PROXY: "Keep: protocol adapter, then one-way out",
  REPLACE_SMB_WITH_SFTP_RELAY: "Keep: file push out only",
  ROUTE_VIA_ARCH_D_OT_LOCKED_GATEWAY: "Keep: plant-initiated only, through a locked gateway",
  SEVER_CRITICAL_VIOLATION_AT_L1: "Cut",
};

const REVIEWER_KEY = "conduitai.reviewer";

function useReviewerName(): [string, (v: string) => void] {
  const [name, setName] = useState("");
  useEffect(() => {
    try {
      setName(window.localStorage.getItem(REVIEWER_KEY) ?? "");
    } catch {
      // Storage can be blocked; the field just starts empty
    }
  }, []);
  const update = (v: string) => {
    setName(v);
    try {
      window.localStorage.setItem(REVIEWER_KEY, v);
    } catch {
      // Not remembered this time
    }
  };
  return [name, update];
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail = data.detail;
    throw new Error(
      typeof detail === "string" ? detail : Array.isArray(detail) ? "Fill in a reason (5+ characters) and your name." : `HTTP ${res.status}`
    );
  }
  return data;
}

/** Sign-off status line, shared by the review panel and the handoff downloads */
export function SignoffStatus({ scenario }: { scenario: ScenarioDataset }) {
  const s = scenario.review?.signoff;
  if (!scenario.review) return null;
  return s ? (
    <div className="inline-flex items-center gap-1.5 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
      <BadgeCheck className="w-3.5 h-3.5" />
      Signed off by {s.reviewer} · {s.at.replace("T", " ").replace("Z", " UTC")} · plan {s.planFingerprint}
    </div>
  ) : (
    <div className="inline-flex items-center gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
      <PenLine className="w-3.5 h-3.5" />
      Draft · not yet signed off by an engineer
    </div>
  );
}

/** Change any connection's decision; the verifier re-checks it before it reaches the plan */
export function EngineerReviewPanel({
  scenario,
  onPayload,
}: {
  scenario: ScenarioDataset;
  onPayload: (payload: Record<string, unknown>) => void;
}) {
  const review = scenario.review;
  const [reviewer, setReviewer] = useReviewerName();
  const [flowId, setFlowId] = useState(scenario.flows[0]?.flowId ?? "");
  const current = scenario.flows.find((f) => f.flowId === flowId);
  const [action, setAction] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"" | "override" | "signoff">("");
  const [error, setError] = useState("");

  useEffect(() => {
    // Offer the opposite of what the plan does now, so one click shows the verifier at work
    setAction(current?.cutoverActionType === "SEVER_CRITICAL_VIOLATION_AT_L1" ? "DROP_IN_PROXY_MAPPING" : "SEVER_CRITICAL_VIOLATION_AT_L1");
  }, [flowId, current?.cutoverActionType]);

  if (!review) return null;
  const base = `${API_BASE}/api/v1/assessments/${encodeURIComponent(scenario.id)}/review`;
  const latest = review.overrides[review.overrides.length - 1];

  const submitOverride = async () => {
    setBusy("override");
    setError("");
    try {
      onPayload(await postJson(withSession(`${base}/override`), { flow_id: flowId, action, reason, reviewer }));
      setReason("");
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy("");
    }
  };
  const submitSignoff = async () => {
    setBusy("signoff");
    setError("");
    try {
      onPayload(await postJson(withSession(`${base}/signoff`), { reviewer, note }));
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">Engineer review</h4>
          <p className="text-xs text-slate-500">
            Change any decision with a reason. The same rule checker that checks the AI re-checks your change, and only an
            accepted change reaches the plan, the map and the downloads.
          </p>
        </div>
        <SignoffStatus scenario={scenario} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
        <label className="lg:col-span-4 text-xs text-slate-600 space-y-1">
          <span>Connection</span>
          <select
            value={flowId}
            onChange={(e) => setFlowId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs bg-white"
          >
            {scenario.flows.map((f) => (
              <option key={f.flowId} value={f.flowId}>
                {f.flowId} · {f.protocol} {f.srcIp} → {f.dstIp}:{f.dstPort} · now {ACTION_LABEL[f.cutoverActionType ?? ""] ?? "?"}
              </option>
            ))}
          </select>
        </label>
        <label className="lg:col-span-3 text-xs text-slate-600 space-y-1">
          <span>Change to</span>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs bg-white"
          >
            {Object.entries(ACTION_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="lg:col-span-3 text-xs text-slate-600 space-y-1">
          <span>Reason</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. vendor support needs this feed"
            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
          />
        </label>
        <label className="lg:col-span-2 text-xs text-slate-600 space-y-1">
          <span>Your name</span>
          <input
            value={reviewer}
            onChange={(e) => setReviewer(e.target.value)}
            placeholder="Reviewer"
            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={submitOverride}
          disabled={busy !== "" || !flowId}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium"
        >
          {busy === "override" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PenLine className="w-3.5 h-3.5" />}
          Check with the rule checker and apply
        </button>
        {error && <span className="text-xs text-rose-700">{error}</span>}
      </div>

      {latest && (
        <div
          className={`rounded-lg border p-3 space-y-2 ${
            latest.accepted ? "border-emerald-200 bg-emerald-50/50" : "border-rose-200 bg-rose-50/50"
          }`}
        >
          <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
            {latest.accepted ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-600" />
            )}
            {latest.accepted
              ? `Accepted and applied: ${latest.flowId} is now "${ACTION_LABEL[latest.toAction]}"`
              : `Refused: ${latest.flowId} stays "${ACTION_LABEL[latest.fromAction]}"`}
          </div>
          <div className="text-xs text-slate-600">
            <span className="font-mono">{latest.connection}</span> · {latest.reviewer}: “{latest.reason}”
          </div>
          {!latest.accepted && <Checklist checks={latest.checks.filter((c) => c.violations.length > 0)} />}
        </div>
      )}

      {review.overrides.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-600">Review log ({review.overrides.length})</summary>
          <ul className="mt-2 space-y-1">
            {review.overrides.map((o) => (
              <li key={o.id} className="text-slate-700">
                <span className={o.accepted ? "text-emerald-700" : "text-rose-700"}>{o.accepted ? "Accepted" : "Refused"}</span>{" "}
                · {o.flowId}: {ACTION_LABEL[o.fromAction]} → {ACTION_LABEL[o.toAction]} · {o.reviewer}, {o.at} · “{o.reason}”
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="border-t border-slate-100 pt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-600 space-y-1 flex-1 min-w-[14rem]">
          <span>Sign-off note</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. reviewed against the site walkdown"
            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
          />
        </label>
        <button
          type="button"
          onClick={submitSignoff}
          disabled={busy !== ""}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-medium"
        >
          {busy === "signoff" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BadgeCheck className="w-3.5 h-3.5" />}
          Sign off plan {review.planFingerprint}
        </button>
        <span className="text-[11px] text-slate-500 w-full">
          The sign-off names this exact plan by its fingerprint. Any later accepted change voids it.
        </span>
      </div>
    </div>
  );
}

/** Where two sources disagree, as the questions to put to the site */
export function EvidenceConflictsPanel({ conflicts }: { conflicts?: EvidenceConflict[] }) {
  if (!conflicts || conflicts.length === 0) return null;
  return (
    <div className="bg-white border border-amber-200 rounded-xl shadow-sm p-4 space-y-3">
      <div className="flex items-center gap-2">
        <HelpCircle className="w-4 h-4 text-amber-600" />
        <h4 className="text-sm font-semibold text-slate-900">Questions for the site ({conflicts.length})</h4>
        <span className="text-xs text-slate-500">Where the supplied sources disagree</span>
      </div>
      <ul className="space-y-2">
        {conflicts.map((c) => (
          <li key={c.topic} className="rounded-lg border border-slate-200 p-3 space-y-1.5">
            <div className="text-xs font-semibold text-slate-900">{c.topic}</div>
            <div className="flex flex-wrap gap-2">
              {c.sources.map((s) => (
                <span key={s.source} className="text-[11px] rounded-md bg-slate-50 border border-slate-200 px-2 py-0.5 text-slate-700">
                  {s.source}: <span className="font-mono font-semibold">{s.value}</span>
                </span>
              ))}
            </div>
            <div className="text-xs text-amber-900">{c.question}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Every input by SHA-256, every model and how it ran, and the evidence behind each finding */
export function EvidenceManifestPanel({ manifest }: { manifest?: EvidenceManifest | null }) {
  if (!manifest) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileSearch className="w-4 h-4 text-slate-600" />
          <h4 className="text-sm font-semibold text-slate-900">Evidence and chain of custody</h4>
        </div>
        <span className="text-[11px] text-slate-500">
          In the PDF and in the bundle as 07_evidence_manifest.json · plan {manifest.planFingerprint}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-200">
              <th className="py-1.5 pr-3 font-medium">Input</th>
              <th className="py-1.5 pr-3 font-medium">File</th>
              <th className="py-1.5 pr-3 font-medium">Bytes</th>
              <th className="py-1.5 font-medium">SHA-256</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {manifest.inputs.map((i) => (
              <tr key={`${i.role}-${i.file}`}>
                <td className="py-1.5 pr-3 text-slate-700 whitespace-nowrap">{i.role}</td>
                <td className="py-1.5 pr-3 font-mono text-slate-800">{i.file}</td>
                <td className="py-1.5 pr-3 font-mono text-slate-600">{i.bytes.toLocaleString()}</td>
                <td className="py-1.5 font-mono text-slate-500 break-all" title={i.sha256}>
                  {i.sha256.slice(0, 16)}…
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {manifest.models.map((m) => (
          <span key={m.stage} className="text-[11px] rounded-md bg-slate-50 border border-slate-200 px-2 py-0.5 text-slate-700">
            {m.model} <span className="text-slate-400">({m.sourceMode.replace(/_/g, " ")})</span>
          </span>
        ))}
      </div>
      <p className="text-xs text-slate-600">
        Architect: {manifest.architect.model} ({manifest.architect.sourceMode.replace(/_/g, " ")}), {manifest.architect.drafts}{" "}
        draft(s), {manifest.architect.draftsRejected} rejected by the rule checker. {manifest.findings.length} findings, each
        tied to the file it came from.
      </p>
    </div>
  );
}
