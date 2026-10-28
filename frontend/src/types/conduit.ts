export type InferenceMode = "cloud_frontier" | "airgapped_glimmer";

export type UserLensMode = "guided_collab" | "engineer_deep";

export type WorkbenchTabId =
  | "site_setup"
  | "intake_vision"
  | "purdue_topology"
  | "cutover_matrix"
  | "bom_compliance";

export type SamOverlayCategory =
  | "EMPTY_1U_RACK_SLOT"
  | "DIN_RAIL_TRACK"
  | "FREE_RJ45_PORT"
  | "ROGUE_CELLULAR_BYPASS_MODEM";

export interface ModelServiceHealth {
  id: string;
  label: string;
  sublabel: string;
  provider: string;
  status: "online" | "airgapped" | "standby" | "simulated";
  latencyMs?: number;
}

export interface AgentTimelineStep {
  id: string;
  stepNumber: number;
  agentName: string;
  modelTag: string;
  status: "idle" | "running" | "completed" | "alert";
  headline: string;
  detail: string;
  durationMs?: number;
}

export interface SamDetectionBox {
  id: string;
  category: SamOverlayCategory;
  semanticClass: string;
  label: string;
  confidence: number;
  /** Percentage coordinates (0-100) relative to image container */
  x: number;
  y: number;
  w: number;
  h: number;
  measurement: string;
  trackId: string;
}

export interface DiagramZoneBox {
  id: string;
  label: string;
  purdueLevel: string;
  vlan: string;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
}

export interface VoiceTranscriptEntry {
  id: string;
  timestamp: string;
  speaker: string;
  utterance: string;
  correlatedAsset: string;
  severity: "normal" | "warning" | "critical";
}

export interface ShadowAssetFinding {
  ipAddress: string;
  macAddress: string;
  vendor: string;
  model: string;
  hostname: string;
  purdueLevel: string;
  vlan: number;
  anomalyType: string;
  discoverySources: string[];
  description: string;
  isRogueBypass?: boolean;
}

export interface TopologyNodeSpec {
  id: string;
  hostname: string;
  ip: string;
  vendor: string;
  role: string;
  purdueLevel: "L4" | "L3.5" | "L3" | "L2" | "L1" | "BYPASS";
  vlan: string;
  isShadowAsset?: boolean;
  isRogueBypass?: boolean;
  isBoundaryNode?: boolean;
  anomalyBadge?: string;
  x: number;
  y: number;
}

export interface TopologyEdgeSpec {
  id: string;
  source: string;
  target: string;
  protocol: string;
  port: string;
  classification: "GREEN" | "AMBER" | "RED_BLOCKER" | "CRITICAL_VIOLATION" | "LOCAL";
  directionBefore: "OT_TO_IT" | "IT_TO_OT" | "BYPASS_TO_OT" | "LOCAL";
  beforeLabel: string;
  afterLabel: string;
}

export type FlowTier = "GREEN" | "AMBER" | "RED_BLOCKER" | "CRITICAL_VIOLATION";

export interface ProtocolFlowEntry {
  flowId: string;
  srcIp: string;
  dstIp: string;
  dstPort: number;
  transport: string;
  protocol: string;
  functionDetail: string;
  direction: string;
  classification: FlowTier;
  catalogProtocolId: string;
  prescribedCutoverAction: string;
  txInnerConfig: string;
  rxOuterConfig: string;
}

export interface ExploitReplayItem {
  id: string;
  attackName: string;
  mitreTechnique: string;
  protocolVector: string;
  injectedPackets: number;
  packetsCrossedBarrier: number;
  result: string;
}

export interface ModalTwinVerification {
  sandboxId: string;
  kernelMechanism: string;
  pcapPacketsReplayed: number;
  legitimatePayloadsDelivered: number;
  operationalDowntimePct: number;
  inboundExploitDropPct: number;
  medianForwardLatencyMs: number;
  reverseChannelBytes: number;
  exploitsTested: ExploitReplayItem[];
  consoleTrace: string[];
}

export type ArchetypeId =
  | "ARCH_A_FIELD_DIODE"
  | "ARCH_B_VIDEO_IOT_DIODE"
  | "ARCH_C_ENTERPRISE_1U_DIODE"
  | "ARCH_D_BIDIRECTIONAL_GATEWAY";

export interface HardwareBomItem {
  archetypeId: ArchetypeId;
  name: string;
  shortName: string;
  directionality: string;
  isolationLayer: string;
  maxThroughputMbps: number;
  sustainedCeilingMbps: number;
  reverseThroughputMbps: number;
  mountingOption: string;
  quantity: number;
  unitCostUsd: number;
  extendedCostUsd: number;
  interfaces: string;
  powerSupply: string;
  operatingTempC: string;
  maxIecSl: string;
}

export interface HardwareBomSummary {
  items: HardwareBomItem[];
  totalHardwareCostUsd: number;
  peakBandwidthMbps: number;
  sizedBandwidthWithHeadroomMbps: number;
  sustainedCapacityMbps: number;
  physicalFitStatus: string;
  physicalMountingNote: string;
  sizingJustification: string;
  switchCutoverCli: string;
}

export interface ComplianceClauseRow {
  id: string;
  standard: string;
  clauseId: string;
  findingCode: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  preCutoverState: string;
  postCutoverState: string;
  diodeSatisfactionNote: string;
}

/** Where the numbers on screen came from */
export type DataProvenance = "reference" | "live_pipeline" | "custom_upload";

export interface ArchitectAttempt {
  attempt: number;
  sourceMode: string;
  model: string;
  latencyMs: number;
  violations: string[];
  proposedBom: string[];
  reasoningExcerpt?: string;
}

/** Muse Wonder propose -> deterministic verify loop, as reported by the backend */
export interface ArchitectTrace {
  model: string;
  accepted: boolean;
  finalSourceMode: string;
  totalLatencyMs: number;
  attempts: ArchitectAttempt[];
}

export interface ScenarioDataset {
  id: string;
  provenance?: DataProvenance;
  architectSourceMode?: string;
  architectTrace?: ArchitectTrace | null;
  shortIndex: number;
  shortLabel: string;
  badgeTag?: string;
  isCriticalRogueScenario?: boolean;
  vertical: string;
  facilityName: string;
  diagramStyle: string;
  preCutoverSl: string;
  postCutoverSl: string;
  conduitId: string;
  conduitName: string;
  telemetry: {
    pcapPacketCount: number;
    firewallVendor: string;
    firewallRowCount: number;
    peakBandwidthMbps: number;
    sizedHeadroomMbps: number;
    totalDiscoveredAssets: number;
    documentedAssets: number;
    shadowAssetCount: number;
  };
  mediaPaths: {
    topologyDiagramRel: string;
    cabinetPhotoRel: string;
    secondaryPhotoRel?: string;
    walkthroughVideoRel: "videos/rack_1u_slot_walkthrough.mp4" | "videos/cabinet_rogue_modem_pan.mp4";
    walkthroughVideoTitle: string;
    walkthroughModeLabel: string;
    enclosureType: "19INCH_SERVER_RACK" | "DIN_RAIL_CABINET";
  };
  samDiagramZones: DiagramZoneBox[];
  samCabinetDetections: SamDetectionBox[];
  samCabinetMetrics: {
    enclosureClass: string;
    empty1uSlots: number;
    dinRailFreeMm: number;
    freeRj45Ports: number;
    freeSfpPorts: number;
    rogueModemDetected: boolean;
  };
  voiceNote: {
    audioFilename: string;
    durationSec: number;
    environmentNoiseDb: string;
    modelId: string;
    entries: VoiceTranscriptEntry[];
  };
  shadowAssets: ShadowAssetFinding[];
  topologyNodes: TopologyNodeSpec[];
  topologyEdges: TopologyEdgeSpec[];
  flows: ProtocolFlowEntry[];
  digitalTwin: ModalTwinVerification;
  bom: HardwareBomSummary;
  compliance: ComplianceClauseRow[];
}
