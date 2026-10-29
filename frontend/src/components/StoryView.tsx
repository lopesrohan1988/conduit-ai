"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Play, ShieldAlert, ShieldCheck } from "lucide-react";
import { ArchetypeId, ScenarioDataset } from "@/types/conduit";
import PurdueTopologyTab from "@/components/PurdueTopologyTab";
import AttackReplayPanel from "@/components/AttackReplayPanel";

export type StoryStep = 1 | 2 | 3;

interface StoryViewProps {
  scenario: ScenarioDataset;
  step: StoryStep;
  isAssessing: boolean;
  onRun: () => void;
}

const PLAIN_DEVICE: Record<ArchetypeId, string> = {
  ARCH_A_FIELD_DIODE: "field data diode",
  ARCH_B_VIDEO_IOT_DIODE: "video & sensor data diode",
  ARCH_C_ENTERPRISE_1U_DIODE: "rack-mount data diode",
  ARCH_D_BIDIRECTIONAL_GATEWAY: "plant-controlled gateway",
};

function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function Explainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-blue-50/70 border border-blue-100 px-4 py-3 text-sm text-slate-700 leading-relaxed">
      {children}
    </div>
  );
}

function Point({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "bad" | "good" | "neutral" }) {
  const dot = tone === "bad" ? "bg-rose-500" : tone === "good" ? "bg-emerald-500" : "bg-slate-400";
  return (
    <li className="flex gap-2.5 text-sm text-slate-800 leading-relaxed">
      <span className={`mt-2 w-2 h-2 rounded-full shrink-0 ${dot}`} />
      <span>{children}</span>
    </li>
  );
}

const PHASE_SEC = 7;

/** The replay as a moving picture: today's attack reaches the plant, then the same attack meets the plan. */
function AttackFilm({ scenario }: { scenario: ScenarioDataset }) {
  const [phase, setPhase] = useState<"today" | "plan">("today");
  const replay = scenario.attackReplay;

  useEffect(() => {
    const t = setTimeout(() => setPhase((p) => (p === "today" ? "plan" : "today")), PHASE_SEC * 1000);
    return () => clearTimeout(t);
  }, [phase]);

  if (!replay) return null;
  const today = phase === "today";
  const reached = today ? replay.today.reachedPlant : replay.proposed.reachedPlant;
  const total = today ? replay.today.attempts : replay.proposed.attempts;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex bg-slate-100 p-1 rounded-lg border border-slate-200" role="group" aria-label="Attack replay phase">
          {(["today", "plan"] as const).map((ph) => (
            <button
              key={ph}
              type="button"
              onClick={() => setPhase(ph)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                phase === ph
                  ? ph === "today"
                    ? "bg-white text-rose-700 shadow-sm"
                    : "bg-white text-emerald-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {ph === "today" ? <ShieldAlert className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
              {ph === "today" ? "Today" : "With the plan"}
            </button>
          ))}
        </div>
        <div className={`text-base sm:text-lg font-semibold ${reached > 0 ? "text-rose-700" : "text-emerald-700"}`}>
          {reached} of {total} attack commands reach plant equipment
        </div>
      </div>
      <PurdueTopologyTab
        key={phase}
        scenario={scenario}
        fixedMode={today ? "before" : "after"}
        embedded
        attackPhase={phase}
      />
      <div className="text-xs text-slate-500">
        Each red dot is a real control command from a public industrial capture, sent down a path this
        plant&apos;s own traffic uses today, from a hacked office computer or an unknown device on the
        plant network. {today ? "Today they reach the equipment." : "With the plan they stop at the diode, and the unknown devices are removed."}
      </div>
    </div>
  );
}

/** Three plain-language steps for someone who isn't a network engineer. */
export default function StoryView({ scenario, step, isAssessing, onRun }: StoryViewProps) {
  const summary = scenario.topologySummary;
  const computed = (scenario.provenance ?? "reference") !== "reference" && summary;

  if (!computed) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 shadow-sm text-center space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">{scenario.facilityName}</h2>
        <p className="text-sm text-slate-600 max-w-xl mx-auto leading-relaxed">
          ConduitAI reads the files a plant can hand over without letting anyone onto its network:
          traffic recordings, the firewall log, the switch settings and photos of the equipment
          cabinet. It then shows how a hacker in the office could reach the plant, and how to stop
          that with a one-way data diode.
        </p>
        <button
          type="button"
          onClick={onRun}
          disabled={isAssessing}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium shadow-sm"
        >
          {isAssessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
          {isAssessing ? "Analyzing this plant (about 30 seconds)…" : "Run analysis"}
        </button>
      </div>
    );
  }

  const cabinets = scenario.measuredCabinets ?? [];
  const rackU = Math.max(0, ...cabinets.filter((c) => c.enclosureType === "CONTROL_ROOM_19INCH_RACK").map((c) => c.empty1uSlots));
  const dinMm = Math.max(0, ...cabinets.map((c) => c.dinRailFreeMm));
  const kit = scenario.bom.items.map((i) => `${i.quantity} ${PLAIN_DEVICE[i.archetypeId] ?? i.shortName}`).join(" and ");
  const trace = scenario.architectTrace;
  const rejected = trace ? trace.attempts.filter((a) => a.violations.length > 0).length : 0;
  const unlisted = scenario.shadowAssets.length;

  if (step === 1) {
    return (
      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
          <h2 className="text-lg sm:text-xl font-semibold text-slate-900">
            Today, the office network can reach the plant in {plural(summary.itToOtPathsToday, "way")}.
          </h2>
          <ul className="space-y-2">
            {summary.commandPathsToday > 0 && (
              <Point tone="bad">
                {plural(summary.commandPathsToday, "of them", "of them")} can send control commands,
                for example tripping a breaker or changing a chemical dose.
              </Point>
            )}
            {summary.bypassPathsToday > 0 && (
              <Point tone="bad">
                {plural(summary.bypassPathsToday, "unknown device")} can send commands straight to plant
                equipment without passing the firewall
                {summary.rogueModemInPhoto ? ", including a cellular modem that Meta SAM 3.1 spotted in the cabinet photo." : "."}
              </Point>
            )}
            {unlisted > 0 && (
              <Point tone="bad">
                {plural(unlisted, "device")} on the network {unlisted === 1 ? "is" : "are"} missing from the plant&apos;s own records.
              </Point>
            )}
          </ul>
          <Explainer>
            <strong>IT</strong> is the office network: email, laptops, business servers.{" "}
            <strong>OT</strong> is the plant network that runs physical equipment such as breakers,
            pumps and chemical dosing. Today a firewall sits between them at best, and it lets
            connections go <em>both ways</em>, so a hacker who gets into the office can reach the plant.
          </Explainer>
        </div>
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-slate-500 px-1">
            Today&apos;s connections between the office (top) and the plant (bottom). Red and orange lines are
            opened from outside the plant, and each one is a path a hacker could use. Green lines only carry data out.
          </div>
          <PurdueTopologyTab scenario={scenario} fixedMode="before" embedded />
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
          <h2 className="text-lg sm:text-xl font-semibold text-slate-900">
            Install {kit} between the office and the plant
            <span className="text-slate-500 font-normal"> · ${scenario.bom.totalHardwareCostUsd.toLocaleString()}</span>
          </h2>
          <Explainer>
            A <strong>data diode</strong> is hardware that lets data travel in only one direction,
            out of the plant, like a one-way valve. Nothing can be sent back in, whatever a hacker
            in the office does.
          </Explainer>
          <ul className="space-y-2">
            <Point tone="good">{plural(summary.connectionsCut, "dangerous connection")} {summary.connectionsCut === 1 ? "is" : "are"} cut.</Point>
            <Point tone="good">
              {plural(summary.feedsKept, "data feed")} to the office keep working. Where the office
              used to ask the plant for data, the diode now reads it inside the plant and sends a
              copy out.
            </Point>
            {(summary.remoteCommandsDropped ?? 0) > 0 && (
              <Point>
                The control centre keeps receiving its plant data, but its remote commands stop: a
                diode only lets data out. If the site needs remote control, the plant-controlled
                gateway is the upgrade.
              </Point>
            )}
            {summary.bypassPathsToday > 0 && (
              <Point tone="bad">
                {summary.rogueModemInPhoto
                  ? "The cellular modem must be physically removed: no diode can protect a backdoor."
                  : "The unknown devices must be found and taken off the plant network: no diode protects against a device that is already inside."}
              </Point>
            )}
            {(rackU > 0 || dinMm > 0) && (
              <Point>
                It fits: Meta SAM 3.1 measured{" "}
                {rackU > 0 ? `${plural(rackU, "free rack slot")}` : `${dinMm.toFixed(0)} mm of free mounting rail`} in
                the cabinet photo.
              </Point>
            )}
            {trace && trace.accepted && (
              <Point>
                Designed by {/open|glimmer/i.test(trace.model) ? "Meta's open-weights Muse Spark Open, which can run on the plant's own server," : "Meta Muse Wonder"}{" "}
                and approved by an independent rule checker
                {rejected > 0 ? `, which sent back ${plural(rejected, "unsafe draft")} first` : ""}.
              </Point>
            )}
            {trace && !trace.accepted && trace.fallbackViolations !== null && (
              <Point tone={trace.fallbackViolations.length > 0 ? "bad" : "neutral"}>
                Designed by the backup rule engine
                {trace.attempts.length > 0 ? " after the AI design was rejected" : ""}.{" "}
                {trace.fallbackViolations.length === 0
                  ? "The independent rule checker approved it."
                  : `The independent rule checker flagged ${plural(trace.fallbackViolations.length, "issue")}, so an engineer must review this kit before ordering (see Engineer detail).`}
              </Point>
            )}
          </ul>
        </div>
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-slate-500 px-1">
            After the change: green arrows are one-way data leaving the plant; grey crossed lines are cut.
          </div>
          <PurdueTopologyTab scenario={scenario} fixedMode="after" embedded />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AttackFilm scenario={scenario} />
      <AttackReplayPanel replay={scenario.attackReplay} />
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Why you can trust this result</h3>
        <ul className="space-y-2">
          <Point>
            The attack packets are real: control commands recorded from real industrial equipment in
            public datasets.{" "}
            {scenario.dataOrigin === "public_dataset"
              ? "This plant's traffic is real too: a public university testbed (UOWM, CC-BY-4.0), scored against its authors' own attack labels."
              : "This demo plant itself is synthetic."}
          </Point>
          <Point>
            The test can fail. If the plan left a backdoor open, its commands would show up above as
            reaching the plant.
          </Point>
          <Point>
            The map, the numbers and the design were computed from this plant&apos;s files in this run;
            nothing on these pages is pre-written.
          </Point>
        </ul>
      </div>
    </div>
  );
}
