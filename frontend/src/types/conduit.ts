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
  /** `recorded`: no key on this server, so the model's recorded outputs are replayed */
  status: "online" | "airgapped" | "standby" | "simulated" | "recorded";
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
  /** After the cutover: cut at the boundary, carried through the diode or OT-locked gateway, or local */
  afterAction?: "cut" | "via_diode" | "via_gateway" | "local";
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
  /** Verifier result for a rule-engine plan; null when a model proposal was accepted */
  fallbackViolations: string[] | null;
}

export interface MeasuredDetection {
  semanticClass: string;
  label: string;
  bbox: [number, number, number, number];
  color: string;
}

/** One cabinet photo measured from SAM 3.1 boxes (pixel coordinates of the source image) */
export interface MeasuredCabinet {
  sourceImage: string;
  imageWidth: number;
  imageHeight: number;
  enclosureType: string;
  empty1uSlots: number;
  dinRailFreeMm: number;
  freeRj45Ports: number;
  measurementSource: string;
  notes: string[];
  detections: MeasuredDetection[];
}

export interface MeasuredVideo {
  filename: string;
  framesAnalyzed: number;
  trackCount: number;
  verifiedEmpty1uSlots: number;
  verifiedDinRailMm: number;
  rogueDetected: boolean;
  measurementSource: string;
  notes: string[];
}

export interface DiagramRegion {
  bbox: [number, number, number, number];
  kind: string;
  name: string;
  hostname: string | null;
  ips: string[];
  /** seen | not_seen | not_a_device */
  status: string;
}

export interface MissingFromDrawing {
  ip: string;
  hostname: string | null;
  vendor: string | null;
  undocumented: boolean;
}

/** SAM 3.1 boxes on the customer's drawing, each read by Muse Spark, compared with the network */
export interface MeasuredDiagram {
  sourceImage: string;
  imageWidth: number;
  imageHeight: number;
  samSourceMode: string;
  readSourceMode: string;
  regions: DiagramRegion[];
  drawnDevices: number;
  drawnSeen: number;
  missingFromDrawing: MissingFromDrawing[];
}

export interface AttackReplayPath {
  flowId: string;
  attacker: string;
  target: string;
  port: number;
  protocol: string;
  via: string;
  frames: Array<{ label: string; sourceCapture: string | null }>;
  reachedPlantToday: number;
  reachedPlantProposed: number;
  proposedOutcome: string;
}

/** Real command packets replayed from a hacked IT network: today vs. the proposed design */
export interface AttackReplay {
  threatModel: string;
  commandFrameSources: string[];
  today: { attempts: number; reachedPlant: number };
  proposed: { attempts: number; reachedPlant: number };
  realCommandFrames: number;
  feedsKept: number;
  caveat: string;
  paths: AttackReplayPath[];
}

/** Counts behind the "today vs. proposed" story, computed from the run */
export interface TopologySummary {
  remoteCommandsDropped?: number;
  itToOtPathsToday: number;
  commandPathsToday: number;
  bypassPathsToday: number;
  rogueModemInPhoto: boolean;
  itToOtPathsAfter: number;
  feedsKept: number;
  connectionsCut: number;
}

export interface ScenarioDataset {
  id: string;
  /** Where the plant's own files come from; synthetic unless stated */
  dataOrigin?: "synthetic" | "public_dataset";
  topologySummary?: TopologySummary | null;
  attackReplay?: AttackReplay | null;
  provenance?: DataProvenance;
  measuredCabinets?: MeasuredCabinet[];
  measuredVideo?: MeasuredVideo | null;
  measuredDiagram?: MeasuredDiagram | null;
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
    /** Empty when the site supplied no walkthrough video */
    walkthroughVideoRel: string;
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
