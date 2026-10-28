import {
  AgentTimelineStep,
  InferenceMode,
  ModelServiceHealth,
  ScenarioDataset,
} from "@/types/conduit";
import { SCENARIOS_PART_1 } from "./scenariosPart1";
import { SCENARIOS_PART_2 } from "./scenariosPart2";

export const FALLBACK_SCENARIOS: ScenarioDataset[] = [
  ...SCENARIOS_PART_1,
  ...SCENARIOS_PART_2,
];

export function getScenarioById(scenarioId: string): ScenarioDataset {
  return (
    FALLBACK_SCENARIOS.find((s) => s.id === scenarioId) ?? FALLBACK_SCENARIOS[0]
  );
}

export function getDefaultModelStack(mode: InferenceMode): ModelServiceHealth[] {
  const isAirGapped = mode === "airgapped_glimmer";
  return [
    {
      id: "sam_3_1",
      label: "SAM 3.1",
      sublabel: "Vision + 24fps Video",
      provider: isAirGapped ? "Local GPU" : "api.meta.ai",
      status: "standby",
    },
    {
      id: "muse_spark",
      label: "Muse Spark",
      sublabel: isAirGapped ? "Routed → Glimmer 30B" : "3-Way Orchestrator",
      provider: isAirGapped ? "Air-Gapped" : "api.meta.ai",
      status: "standby",
    },
    {
      id: "muse_wonder",
      label: isAirGapped ? "Muse Glimmer 30B" : "Muse Wonder",
      sublabel: isAirGapped ? "Apache 2.0 On-Prem" : "Frontier Sizing & CLI",
      provider: isAirGapped ? "Modal Enclave" : "api.meta.ai",
      status: "standby",
    },
    {
      id: "muse_image",
      label: "Muse Image",
      sublabel: "Rack Elevation Card",
      provider: isAirGapped ? "Cached SVG" : "api.meta.ai",
      status: "standby",
    },
    {
      id: "muse_voice",
      label: "Muse Voice",
      sublabel: "/v1/asr Field Audio",
      provider: isAirGapped ? "Local Whisper/ASR" : "api.meta.ai",
      status: "standby",
    },
    {
      id: "baseten_1026",
      label: "Baseten 1026",
      sublabel: "2M TPM CLI Parser",
      provider: isAirGapped ? "Air-Gapped" : "muse-spark-open-1026",
      status: "standby",
    },
    {
      id: "modal_twin",
      label: "Modal Twin",
      sublabel: "L1/L2 os.pipe() Verify",
      provider: "Modal Sandbox",
      status: "standby",
    },
  ];
}

export function buildTimelineTemplate(
  scenario: ScenarioDataset,
  mode: InferenceMode
): AgentTimelineStep[] {
  const isAirGapped = mode === "airgapped_glimmer";
  const architectModel = isAirGapped
    ? "Meta Muse Glimmer 30B (Apache 2.0 Air-Gapped)"
    : "Meta Muse Wonder (Frontier Architect)";
  const supervisorModel = isAirGapped
    ? "Muse Glimmer 30B Local Graph Router"
    : "Meta Muse Spark Supervisor";

  return [
    {
      id: "step-sam",
      stepNumber: 1,
      agentName: "SAM 3.1 Tri-Modal Vision & Video Sizer",
      modelTag: "meta/sam-3.1",
      status: "idle",
      headline: `Segmented ${scenario.samDiagramZones.length} diagram zones + ${scenario.samCabinetDetections.length} physical rack/DIN tracks`,
      detail: scenario.samCabinetMetrics.rogueModemDetected
        ? `CRITICAL: Tracked unauthorized 5G bypass modem on Stratix Gi1/24 + measured ${scenario.samCabinetMetrics.dinRailFreeMm}mm free DIN rail.`
        : `Verified ${scenario.samCabinetMetrics.empty1uSlots} open 1U slot(s), ${scenario.samCabinetMetrics.dinRailFreeMm}mm DIN track, and ${scenario.samCabinetMetrics.freeRj45Ports} spare RJ45 ports.`,
      durationMs: 410,
    },
    {
      id: "step-voice",
      stepNumber: 2,
      agentName: "Muse Voice Field-Note Transcriber",
      modelTag: "meta/muse-voice-transcribe",
      status: "idle",
      headline: `Transcribed ${scenario.voiceNote.audioFilename} (${scenario.voiceNote.environmentNoiseDb})`,
      detail: `Correlated ${scenario.voiceNote.entries.length} spoken technician callouts against physical switch ports and rack slots.`,
      durationMs: 260,
    },
    {
      id: "step-cli",
      stepNumber: 3,
      agentName: "Switch CLI & MAC OUI Asset Agent",
      modelTag: isAirGapped ? "Muse-Glimmer-30B" : "Baseten muse-spark-open-1026",
      status: "idle",
      headline: `Parsed ARP/MAC tables + ${scenario.telemetry.firewallRowCount.toLocaleString()} ${scenario.telemetry.firewallVendor} rows`,
      detail: `Reconciled ${scenario.telemetry.totalDiscoveredAssets} live L2/L3 endpoints (${scenario.telemetry.documentedAssets} documented, ${scenario.telemetry.shadowAssetCount} undocumented Shadow OT).`,
      durationMs: 340,
    },
    {
      id: "step-pcap",
      stepNumber: 4,
      agentName: "10-Protocol Packet Dissector (Scapy + DuckDB)",
      modelTag: "DuckDB Packet SQL",
      status: "idle",
      headline: `Dissected ${scenario.telemetry.pcapPacketCount.toLocaleString()} packets · Peak ${scenario.telemetry.peakBandwidthMbps.toFixed(1)} Mbps (${scenario.telemetry.sizedHeadroomMbps.toFixed(2)} Mbps @ 1.25x)`,
      detail: `Classified ${scenario.flows.length} cross-zone L7 flows by TCP SYN origin and Read/Write function code.`,
      durationMs: 290,
    },
    {
      id: "step-spark",
      stepNumber: 5,
      agentName: "3-Way Graph Reconciler",
      modelTag: supervisorModel,
      status: "idle",
      headline: `Fused Visual Diagram + Switch CLI + SPAN PCAP across Purdue L0–L4`,
      detail: scenario.isCriticalRogueScenario
        ? `ALERT: Exposed firewall-invisible Rogue 5G cellular modem (192.168.25.254) injecting NaOCl override!`
        : `Flagged ${scenario.shadowAssets.map((a) => a.ipAddress).join(", ")} absent from customer baseline.`,
      durationMs: 380,
    },
    {
      id: "step-wonder",
      stepNumber: 6,
      agentName: "Deterministic Diode Sizer & Proxy Synthesizer",
      modelTag: architectModel,
      status: "idle",
      headline: `Selected ${scenario.bom.items.map((i) => `${i.quantity}x ${i.archetypeId}`).join(" + ")} ($${scenario.bom.totalHardwareCostUsd.toLocaleString()})`,
      detail: `Generated TX/RX proxy translation rules, switch cutover CLI, and ${scenario.compliance.length} regulatory clause mappings.`,
      durationMs: 520,
    },
    {
      id: "step-modal",
      stepNumber: 7,
      agentName: "Verifiable Layer-1/2 Socket Digital Twin",
      modelTag: "Modal Sandbox os.pipe()",
      status: "idle",
      headline: `Replayed ${scenario.digitalTwin.pcapPacketsReplayed.toLocaleString()} frames across unidirectional os.pipe()`,
      detail: `PROVEN: ${scenario.digitalTwin.operationalDowntimePct}% operational downtime · ${scenario.digitalTwin.inboundExploitDropPct}% physical inbound exploit drop.`,
      durationMs: 470,
    },
  ];
}
