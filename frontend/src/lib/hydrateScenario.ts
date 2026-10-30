import {
  ArchetypeId,
  ArchitectTrace,
  VerifierCheck,
  ComplianceClauseRow,
  ExploitReplayItem,
  FlowTier,
  HardwareBomItem,
  MeasuredCabinet,
  ModalTwinVerification,
  ProtocolFlowEntry,
  ScenarioDataset,
  ShadowAssetFinding,
  TopologyEdgeSpec,
  TopologyNodeSpec,
  VoiceTranscriptEntry,
} from "@/types/conduit";

const ARCHETYPE_SPECS: Record<
  ArchetypeId,
  Omit<
    HardwareBomItem,
    "quantity" | "unitCostUsd" | "extendedCostUsd" | "mountingOption"
  >
> = {
  ARCH_A_FIELD_DIODE: {
    archetypeId: "ARCH_A_FIELD_DIODE",
    name: "Industrial Field Protocol Diode",
    shortName: "Field Diode (100M)",
    directionality: "Strictly Unidirectional (TX -> RX)",
    isolationLayer: "Physical Optical / FPGA Air-Gap",
    maxThroughputMbps: 100,
    sustainedCeilingMbps: 80,
    reverseThroughputMbps: 0,
    interfaces: "2x 10/100Base-TX RJ45 (TX/RX)",
    powerSupply: "Dual Redundant 24V DC Terminal",
    operatingTempC: "-40°C to +75°C Fanless",
    maxIecSl: "SL-4",
  },
  ARCH_B_VIDEO_IOT_DIODE: {
    archetypeId: "ARCH_B_VIDEO_IOT_DIODE",
    name: "Edge Video & IoT Unidirectional Proxy Diode",
    shortName: "Video/IoT Diode (1G)",
    directionality: "Strictly Unidirectional (TX -> RX)",
    isolationLayer: "Layer-1 Optical LED/Photodiode",
    maxThroughputMbps: 1000,
    sustainedCeilingMbps: 800,
    reverseThroughputMbps: 0,
    interfaces: "2x 1000Base-T / SFP",
    powerSupply: "24V DC / 100-240V AC Adapter",
    operatingTempC: "-20°C to +60°C",
    maxIecSl: "SL-4",
  },
  ARCH_C_ENTERPRISE_1U_DIODE: {
    archetypeId: "ARCH_C_ENTERPRISE_1U_DIODE",
    name: "1U Enterprise Multi-VLAN Protocol-Breaking Diode",
    shortName: "Enterprise 1U Diode (1G)",
    directionality: "Strictly Unidirectional (TX -> RX)",
    isolationLayer: "Physical Laser TX-Only SFP+ Air-Gap",
    maxThroughputMbps: 1000,
    sustainedCeilingMbps: 850,
    reverseThroughputMbps: 0,
    interfaces: "4x 1GbE RJ45 + 2x SFP+ (16 VLANs)",
    powerSupply: "Dual Hot-Swap 100-240V AC PSU",
    operatingTempC: "0°C to +50°C Control Room",
    maxIecSl: "SL-4",
  },
  ARCH_D_BIDIRECTIONAL_GATEWAY: {
    archetypeId: "ARCH_D_BIDIRECTIONAL_GATEWAY",
    name: "Dual-Stage OT-Locked Controlled Gateway",
    shortName: "OT-Locked Gateway (1G/100M)",
    directionality: "Tandem Dual-Path (OT TCP SYN Lock)",
    isolationLayer: "Dual Optical Diode + FPGA Schema Guard",
    maxThroughputMbps: 1000,
    sustainedCeilingMbps: 800,
    reverseThroughputMbps: 50,
    interfaces: "4x 1GbE RJ45 + Hardware Keyswitch",
    powerSupply: "Dual Hot-Swap 100-240V AC PSU",
    operatingTempC: "0°C to +50°C Cleanroom/MDF",
    maxIecSl: "SL-3",
  },
};

export function hydrateTwinVerification(
  baseTwin: ModalTwinVerification,
  rawTwin: Record<string, unknown>
): ModalTwinVerification {
  const legitArr = Array.isArray(rawTwin.legitimate_telemetry_results)
    ? (rawTwin.legitimate_telemetry_results as Array<Record<string, unknown>>)
    : [];
  const exploitArr = Array.isArray(rawTwin.adversarial_exploit_results)
    ? (rawTwin.adversarial_exploit_results as Array<Record<string, unknown>>)
    : [];

  const totalSent = legitArr.reduce(
    (acc, r) => acc + Number(r.tx_packets_sent ?? 0),
    0
  );
  const totalDelivered = legitArr.reduce(
    (acc, r) => acc + Number(r.rx_packets_delivered ?? 0),
    0
  );
  const medianLatency =
    legitArr.length > 0
      ? Number(legitArr[0].median_proxy_latency_ms ?? baseTwin.medianForwardLatencyMs)
      : baseTwin.medianForwardLatencyMs;

  const mappedExploits: ExploitReplayItem[] =
    exploitArr.length > 0
      ? exploitArr.map((ex, idx) => ({
          id: `EXP-LIVE-${idx + 1}`,
          attackName: String(ex.attack_name ?? "Inbound Lateral Exploit"),
          mitreTechnique: String(ex.cve_or_technique ?? "MITRE ICS T0846"),
          protocolVector: `${String(ex.target_ip ?? "OT")}:${String(
            ex.target_port ?? 502
          )}`,
          injectedPackets: Number(ex.packets_injected_from_it ?? 0),
          packetsCrossedBarrier: Number(ex.packets_reaching_ot ?? 0),
          result:
            ex.physically_blocked === false || Number(ex.packets_reaching_ot ?? 0) > 0
              ? `CROSSED BARRIER (${Number(ex.packets_reaching_ot ?? 0)} pkts)`
              : "DROPPED (0 pkts crossed)",
        }))
      : baseTwin.exploitsTested;

  const rawLog = String(rawTwin.sandbox_stdout_log ?? "").trim();
  const consoleLines = rawLog
    ? rawLog.split(/\r?\n/).filter((l) => l.trim().length > 0)
    : baseTwin.consoleTrace;

  return {
    sandboxId: String(rawTwin.sandbox_id ?? baseTwin.sandboxId),
    kernelMechanism:
      rawTwin.execution_backend === "modal_cloud_sandbox"
        ? "Modal Cloud Linux Sandbox · Unidirectional os.pipe() + TCP Proxy"
        : "Kernel Unidirectional os.pipe() (read-only RX FD) + Loopback TCP Proxy",
    pcapPacketsReplayed: totalSent > 0 ? totalSent : baseTwin.pcapPacketsReplayed,
    legitimatePayloadsDelivered:
      totalDelivered > 0 ? totalDelivered : baseTwin.legitimatePayloadsDelivered,
    operationalDowntimePct:
      100 - Number(rawTwin.telemetry_continuity_pct ?? 100),
    inboundExploitDropPct: Number(
      rawTwin.inbound_exploit_block_rate_pct ?? 100
    ),
    medianForwardLatencyMs: medianLatency,
    reverseChannelBytes: 0,
    exploitsTested: mappedExploits,
    consoleTrace: consoleLines,
  };
}

export function hydrateVoiceTranscript(
  baseVoice: ScenarioDataset["voiceNote"],
  rawVoice: Record<string, unknown>
): ScenarioDataset["voiceNote"] {
  const obsArr = Array.isArray(rawVoice.structured_observations)
    ? (rawVoice.structured_observations as Array<Record<string, unknown>>)
    : [];

  const entries: VoiceTranscriptEntry[] =
    obsArr.length > 0
      ? obsArr.map((o, idx) => {
          const sevRaw = String(o.severity ?? "INFO").toUpperCase();
          const sev: "normal" | "warning" | "critical" =
            sevRaw === "CRITICAL"
              ? "critical"
              : sevRaw === "WARNING"
                ? "warning"
                : "normal";
          const sec = Number(o.timestamp_offset_sec ?? idx * 4);
          const mm = String(Math.floor(sec / 60)).padStart(2, "0");
          const ss = String(Math.floor(sec % 60)).padStart(2, "0");
          return {
            id: String(o.observation_id ?? `VOBS-${idx + 1}`),
            timestamp: `${mm}:${ss}`,
            speaker: "Field OT Engineer",
            utterance:
              idx === 0 && rawVoice.raw_transcript
                ? String(rawVoice.raw_transcript)
                : String(o.engineering_impact ?? ""),
            correlatedAsset: String(o.extracted_entity ?? "Plant Enclosure"),
            severity: sev,
          };
        })
      : baseVoice.entries;

  return {
    ...baseVoice,
    audioFilename: String(rawVoice.audio_filename ?? baseVoice.audioFilename),
    durationSec: Number(rawVoice.duration_sec ?? baseVoice.durationSec),
    modelId: String(rawVoice.model_used ?? baseVoice.modelId),
    entries,
  };
}

export function hydrateArchitectTrace(
  rawTrace: Record<string, unknown>
): ArchitectTrace {
  const attempts = Array.isArray(rawTrace.attempts)
    ? (rawTrace.attempts as Array<Record<string, unknown>>)
    : [];
  const fallback = rawTrace.fallback_check as { violations?: unknown; checks?: unknown } | undefined;
  return {
    fallbackViolations: Array.isArray(fallback?.violations) ? fallback.violations.map(String) : null,
    fallbackChecks: hydrateChecks(fallback?.checks),
    model: String(rawTrace.model ?? ""),
    accepted: Boolean(rawTrace.accepted),
    finalSourceMode: String(rawTrace.final_source_mode ?? "deterministic_rule_engine"),
    totalLatencyMs: Number(rawTrace.total_latency_ms ?? 0),
    attempts: attempts.map((a, idx) => ({
      attempt: Number(a.attempt ?? idx + 1),
      sourceMode: String(a.source_mode ?? ""),
      model: String(a.model ?? rawTrace.model ?? ""),
      latencyMs: Number(a.latency_ms ?? 0),
      violations: Array.isArray(a.violations) ? a.violations.map(String) : [],
      proposedBom: Array.isArray(a.proposed_bom) ? a.proposed_bom.map(String) : [],
      reasoningExcerpt: a.reasoning_excerpt ? String(a.reasoning_excerpt) : undefined,
      checks: hydrateChecks(a.checks),
    })),
  };
}

function hydrateChecks(raw: unknown): VerifierCheck[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>).map((c) => ({
    rule: String(c.rule ?? ""),
    scope: String(c.scope ?? ""),
    applies: Number(c.applies ?? 0),
    violations: Array.isArray(c.violations) ? c.violations.map(String) : [],
  }));
}

function hydrateMeasuredCabinets(raw: Array<Record<string, unknown>>): MeasuredCabinet[] {
  return raw.map((c) => ({
    sourceImage: String(c.source_image ?? ""),
    imageWidth: Number(c.image_width ?? 1),
    imageHeight: Number(c.image_height ?? 1),
    enclosureType: String(c.enclosure_type ?? ""),
    empty1uSlots: Number(c.empty_1u_slots ?? 0),
    dinRailFreeMm: Number(c.din_rail_available_mm ?? 0),
    freeRj45Ports: Number(c.free_rj45_ports ?? 0),
    measurementSource: String(c.measurement_source ?? ""),
    notes: Array.isArray(c.measurement_notes) ? c.measurement_notes.map(String) : [],
    detections: (Array.isArray(c.detections) ? (c.detections as Array<Record<string, unknown>>) : []).map(
      (d) => {
        const b = Array.isArray(d.bbox_xyxy) ? d.bbox_xyxy.map(Number) : [0, 0, 0, 0];
        return {
          semanticClass: String(d.semantic_class ?? ""),
          label: String(d.label ?? ""),
          bbox: [b[0], b[1], b[2], b[3]] as [number, number, number, number],
          color: String(d.hud_color_hex ?? "#22C55E"),
        };
      }
    ),
  }));
}

const UDP_PORTS = new Set([69, 123, 161, 162, 514, 1514, 47808]);

function mapCutoverRows(
  cutoverArr: Array<Record<string, unknown>>,
  proxyArr: Array<Record<string, unknown>>
): ProtocolFlowEntry[] {
  return cutoverArr.map((row, idx) => {
    const tierRaw = String(row.cutover_tier ?? "AMBER").toUpperCase();
    const actionRaw = String(row.cutover_action_type ?? "");
    const classification: FlowTier =
      tierRaw === "GREEN"
        ? "GREEN"
        : tierRaw === "AMBER"
          ? "AMBER"
          : actionRaw === "SEVER_CRITICAL_VIOLATION_AT_L1"
            ? "CRITICAL_VIOLATION"
            : "RED_BLOCKER";
    const port = Number(row.port ?? 0);
    const src = String(row.observed_src_ip ?? "");
    const dst = String(row.observed_dst_ip ?? "");
    // Proxy rules exist only for carried flows, so match on the OT endpoint, never by index
    const proxy = proxyArr.find(
      (p) =>
        Number(p.ot_source_port) === port &&
        (String(p.ot_source_ip) === src || String(p.ot_source_ip) === dst)
    );
    const protocol = String(row.protocol ?? `TCP/${port}`);
    return {
      flowId: String(row.flow_id ?? `FLOW-${idx + 1}`),
      srcIp: src,
      dstIp: dst,
      dstPort: port,
      transport: UDP_PORTS.has(port) ? "UDP" : "TCP",
      protocol,
      functionDetail: String(row.function_code_detail ?? ""),
      direction: String(row.observed_initiator ?? "IT_TO_OT"),
      classification,
      catalogProtocolId: proxy ? String(proxy.target_protocol) : protocol,
      prescribedCutoverAction: String(row.engineering_prescription ?? ""),
      txInnerConfig: proxy
        ? `${String(proxy.tx_operating_mode)} on ${String(proxy.tx_inner_vip)} -> OT ${String(
            proxy.ot_source_ip
          )}:${String(proxy.ot_source_port)}`
        : actionRaw === "SEVER_CRITICAL_VIOLATION_AT_L1"
          ? "PHYSICALLY SEVERED AT LAYER 1/2"
          : "No proxy rule (remediate first)",
      rxOuterConfig: proxy
        ? `Expose RX Replica ${String(proxy.rx_outer_vip)}:${String(
            proxy.rx_exposed_port
          )} to IT ${String(proxy.it_consumer_ip)}`
        : "ZERO PROXY EXPOSURE",
    };
  });
}

function mapShadowAssets(
  shadowArr: Array<Record<string, unknown>>,
  reference: ShadowAssetFinding[]
): ShadowAssetFinding[] {
  return shadowArr.map((s, idx) => {
    const ips = Array.isArray(s.ip_addresses) ? s.ip_addresses.map(String) : [];
    const anomType = String(s.anomaly_type ?? "UNDOCUMENTED_SHADOW_ASSET");
    // Keep hand-labelled hostnames/models when the pipeline found the same device
    const known = reference.find((r) => ips.includes(r.ipAddress));
    return {
      ipAddress: ips[0] ?? "unknown",
      macAddress: String(s.mac_address ?? known?.macAddress ?? ""),
      vendor: String(s.vendor ?? known?.vendor ?? "Unknown vendor"),
      model:
        known?.model ??
        (anomType === "ROGUE_IT_BRIDGE" ? "Cellular bypass modem" : "Undocumented device"),
      hostname: known?.hostname ?? `unlisted-${idx + 1}`,
      purdueLevel: known?.purdueLevel ?? "L1",
      vlan: known?.vlan ?? 0,
      anomalyType: anomType,
      discoverySources: [String(s.evidence_source ?? "Switch ARP + PCAP")],
      description: String(s.remediation_action ?? known?.description ?? ""),
      isRogueBypass: anomType === "ROGUE_IT_BRIDGE",
    };
  });
}

export function hydrateScenarioFromBackendPayload(
  baseScenario: ScenarioDataset,
  payload: Record<string, unknown>,
  options?: { isCustomUpload?: boolean }
): ScenarioDataset {
  const next: ScenarioDataset = { ...baseScenario };
  const isCustom = Boolean(options?.isCustomUpload);

  if (payload.planner_trace && typeof payload.planner_trace === "object") {
    next.architectTrace = hydrateArchitectTrace(
      payload.planner_trace as Record<string, unknown>
    );
  } else if (payload.architecture_plan) {
    next.architectTrace = null;
  }
  if (typeof payload.architect_source_mode === "string") {
    next.architectSourceMode = payload.architect_source_mode;
  }
  if (payload.attack_replay && typeof payload.attack_replay === "object") {
    const r = payload.attack_replay as Record<string, unknown>;
    const counts = (v: unknown) => {
      const o = (v ?? {}) as Record<string, unknown>;
      return { attempts: Number(o.attempts ?? 0), reachedPlant: Number(o.reached_plant ?? 0) };
    };
    next.attackReplay = {
      threatModel: String(r.threat_model ?? ""),
      commandFrameSources: Array.isArray(r.command_frame_sources) ? r.command_frame_sources.map(String) : [],
      today: counts(r.today),
      proposed: counts(r.proposed),
      realCommandFrames: Number(r.real_command_frames ?? 0),
      feedsKept: Number(r.feeds_kept ?? 0),
      caveat: String(r.caveat ?? ""),
      paths: (Array.isArray(r.paths) ? (r.paths as Array<Record<string, unknown>>) : []).map((p) => ({
        flowId: String(p.flow_id ?? ""),
        attacker: String(p.attacker ?? ""),
        target: String(p.target ?? ""),
        port: Number(p.port ?? 0),
        protocol: String(p.protocol ?? ""),
        via: String(p.via ?? ""),
        frames: (Array.isArray(p.frames) ? (p.frames as Array<Record<string, unknown>>) : []).map((f) => ({
          label: String(f.label ?? ""),
          sourceCapture: f.source_capture ? String(f.source_capture) : null,
        })),
        reachedPlantToday: Number(p.reached_plant_today ?? 0),
        reachedPlantProposed: Number(p.reached_plant_proposed ?? 0),
        proposedOutcome: String(p.proposed_outcome ?? ""),
      })),
    };
  }
  if (payload.topology && typeof payload.topology === "object") {
    const topo = payload.topology as Record<string, unknown>;
    if (Array.isArray(topo.nodes) && topo.nodes.length > 0) {
      next.topologyNodes = topo.nodes as TopologyNodeSpec[];
      next.topologyEdges = (Array.isArray(topo.edges) ? topo.edges : []) as TopologyEdgeSpec[];
    }
    const sm = (topo.summary ?? {}) as Record<string, unknown>;
    next.topologySummary = {
      itToOtPathsToday: Number(sm.it_to_ot_paths_today ?? 0),
      commandPathsToday: Number(sm.command_paths_today ?? 0),
      bypassPathsToday: Number(sm.bypass_paths_today ?? 0),
      rogueModemInPhoto: Boolean(sm.rogue_modem_in_photo),
      itToOtPathsAfter: Number(sm.it_to_ot_paths_after ?? 0),
      feedsKept: Number(sm.feeds_kept ?? 0),
      connectionsCut: Number(sm.connections_cut ?? 0),
      remoteCommandsDropped: Number(sm.remote_commands_dropped ?? 0),
    };
  }
  if (Array.isArray(payload.cabinet_inspections)) {
    next.measuredCabinets = hydrateMeasuredCabinets(
      payload.cabinet_inspections as Array<Record<string, unknown>>
    );
    const racks = next.measuredCabinets.filter((c) => c.enclosureType === "CONTROL_ROOM_19INCH_RACK");
    next.samCabinetMetrics = {
      ...next.samCabinetMetrics,
      empty1uSlots: Math.max(0, ...racks.map((c) => c.empty1uSlots)),
      dinRailFreeMm: Math.max(0, ...next.measuredCabinets.map((c) => c.dinRailFreeMm)),
      rogueModemDetected: next.measuredCabinets.some((c) =>
        c.detections.some((d) => d.semanticClass === "ROGUE_CELLULAR_BYPASS_MODEM")
      ),
    };
  }
  if (payload.video_walkthrough && typeof payload.video_walkthrough === "object") {
    const v = payload.video_walkthrough as Record<string, unknown>;
    next.measuredVideo = {
      filename: String(v.video_filename ?? ""),
      framesAnalyzed: Number(v.frames_analyzed ?? 0),
      trackCount: Array.isArray(v.tracked_objects) ? v.tracked_objects.length : 0,
      verifiedEmpty1uSlots: Number(v.verified_empty_1u_slots ?? 0),
      verifiedDinRailMm: Number(v.verified_din_rail_mm ?? 0),
      rogueDetected: Boolean(v.rogue_bypass_detected),
      measurementSource: String(v.measurement_source ?? ""),
      notes: Array.isArray(v.measurement_notes) ? v.measurement_notes.map(String) : [],
    };
  } else if ("video_walkthrough" in payload) {
    next.measuredVideo = null;
  }
  const rawDiagram = payload.diagram_reading as Record<string, unknown> | null | undefined;
  if (rawDiagram && typeof rawDiagram === "object" && Array.isArray(rawDiagram.regions)) {
    const rec = (rawDiagram.reconciliation ?? {}) as Record<string, unknown>;
    next.measuredDiagram = {
      sourceImage: String(rawDiagram.source_image ?? ""),
      imageWidth: Number(rawDiagram.image_width ?? 1),
      imageHeight: Number(rawDiagram.image_height ?? 1),
      samSourceMode: String(rawDiagram.sam_source_mode ?? ""),
      readSourceMode: String(rawDiagram.read_source_mode ?? ""),
      regions: (rawDiagram.regions as Array<Record<string, unknown>>).map((g) => ({
        bbox: (Array.isArray(g.bbox) ? g.bbox.map(Number) : [0, 0, 0, 0]) as [number, number, number, number],
        kind: String(g.kind ?? "other"),
        name: String(g.name ?? ""),
        hostname: g.hostname ? String(g.hostname) : null,
        ips: Array.isArray(g.ips) ? g.ips.map(String) : [],
        status: String(g.status ?? "not_a_device"),
      })),
      drawnDevices: Number(rec.drawn_devices ?? 0),
      drawnSeen: Number(rec.drawn_seen ?? 0),
      missingFromDrawing: Array.isArray(rec.missing_from_drawing)
        ? (rec.missing_from_drawing as Array<Record<string, unknown>>).map((m) => ({
            ip: String(m.ip ?? ""),
            hostname: m.hostname ? String(m.hostname) : null,
            vendor: m.vendor ? String(m.vendor) : null,
            undocumented: Boolean(m.undocumented),
          }))
        : [],
    };
  } else if ("diagram_reading" in payload) {
    next.measuredDiagram = null;
  }

  const rawPlan = payload.architecture_plan as
    | Record<string, unknown>
    | undefined;
  const rawTwin = payload.twin_verification as
    | Record<string, unknown>
    | undefined;
  const rawVoice = payload.voice_transcript as
    | Record<string, unknown>
    | undefined;
  const rawCli =
    typeof payload.switch_cutover_cli === "string" &&
    payload.switch_cutover_cli.trim().length > 0
      ? payload.switch_cutover_cli
      : undefined;

  if (rawTwin) {
    next.digitalTwin = hydrateTwinVerification(next.digitalTwin, rawTwin);
  }
  if (rawVoice) {
    next.voiceNote = hydrateVoiceTranscript(next.voiceNote, rawVoice);
  }

  if (!rawPlan) {
    return next;
  }
  next.provenance = isCustom ? "custom_upload" : "live_pipeline";

  const exec = (rawPlan.executive_summary ?? {}) as Record<string, unknown>;
  const sizingArr = Array.isArray(rawPlan.conduit_sizing_recommendations)
    ? (rawPlan.conduit_sizing_recommendations as Array<Record<string, unknown>>)
    : [];
  const bomArr = Array.isArray(rawPlan.bill_of_materials)
    ? (rawPlan.bill_of_materials as Array<Record<string, unknown>>)
    : [];
  const shadowArr = Array.isArray(rawPlan.shadow_assets_and_bypasses)
    ? (rawPlan.shadow_assets_and_bypasses as Array<Record<string, unknown>>)
    : [];
  const cutoverArr = Array.isArray(rawPlan.protocol_cutover_matrix)
    ? (rawPlan.protocol_cutover_matrix as Array<Record<string, unknown>>)
    : [];
  const proxyArr = Array.isArray(rawPlan.tx_rx_proxy_translation_table)
    ? (rawPlan.tx_rx_proxy_translation_table as Array<Record<string, unknown>>)
    : [];
  const compArr = Array.isArray(rawPlan.compliance_mapping)
    ? (rawPlan.compliance_mapping as Array<Record<string, unknown>>)
    : [];

  if (exec.facility_name) {
    next.facilityName = String(exec.facility_name);
    if (isCustom) {
      next.shortLabel = String(exec.facility_name);
    }
  }
  if (exec.current_security_posture_sl) {
    next.preCutoverSl = String(exec.current_security_posture_sl);
  }
  if (exec.target_security_posture_sl) {
    next.postCutoverSl = String(exec.target_security_posture_sl);
  }

  const primarySizing = sizingArr[0];
  const peakMbps = primarySizing
    ? Number(primarySizing.observed_peak_mbps ?? next.telemetry.peakBandwidthMbps)
    : next.telemetry.peakBandwidthMbps;
  const sizedMbps = primarySizing
    ? Number(
        primarySizing.sized_capacity_with_headroom_mbps ??
          next.telemetry.sizedHeadroomMbps
      )
    : next.telemetry.sizedHeadroomMbps;

  const totalAssets = Number(
    exec.total_discovered_assets ?? next.telemetry.totalDiscoveredAssets
  );
  const shadowCount = Number(
    exec.undocumented_shadow_asset_count ?? next.telemetry.shadowAssetCount
  );

  next.telemetry = {
    ...next.telemetry,
    peakBandwidthMbps: peakMbps,
    sizedHeadroomMbps: sizedMbps,
    totalDiscoveredAssets: totalAssets,
    documentedAssets: Math.max(0, totalAssets - shadowCount),
    shadowAssetCount: shadowCount,
  };

  if (shadowArr.length > 0 || isCustom) {
    next.shadowAssets = mapShadowAssets(shadowArr, baseScenario.shadowAssets);
    next.isCriticalRogueScenario = next.shadowAssets.some((m) => m.isRogueBypass);
  }

  if (cutoverArr.length > 0 || isCustom) {
    next.flows = mapCutoverRows(cutoverArr, proxyArr);
  }

  if (bomArr.length > 0) {
    const mappedItems: HardwareBomItem[] = bomArr.map((b, idx) => {
      const archCode = (String(b.item_code ?? "ARCH_A_FIELD_DIODE") as ArchetypeId);
      const spec =
        ARCHETYPE_SPECS[archCode] ?? ARCHETYPE_SPECS.ARCH_A_FIELD_DIODE;
      const sz = sizingArr[idx] ?? primarySizing;
      return {
        ...spec,
        mountingOption: String(sz?.mounting_selection ?? "DIN_RAIL"),
        quantity: Number(b.quantity ?? 1),
        unitCostUsd: Number(b.estimated_unit_cost_usd ?? 4500),
        extendedCostUsd: Number(b.estimated_extended_cost_usd ?? 4500),
      };
    });

    const totalSustained = mappedItems.reduce(
      (acc, i) => acc + i.sustainedCeilingMbps * i.quantity,
      0
    );

    next.bom = {
      ...next.bom,
      items: mappedItems,
      totalHardwareCostUsd: Number(
        exec.estimated_hardware_bom_usd ?? next.bom.totalHardwareCostUsd
      ),
      peakBandwidthMbps: peakMbps,
      sizedBandwidthWithHeadroomMbps: sizedMbps,
      sustainedCapacityMbps: Math.max(totalSustained, 80),
      physicalMountingNote: String(
        primarySizing?.cabinet_fit_notes ?? next.bom.physicalMountingNote
      ),
      sizingJustification: String(
        primarySizing?.sizing_justification ??
          exec.headline_synthesis ??
          next.bom.sizingJustification
      ),
      switchCutoverCli: rawCli ?? next.bom.switchCutoverCli,
    };
  } else if (rawCli) {
    next.bom = { ...next.bom, switchCutoverCli: rawCli };
  }

  // The run's own mapping, so the table matches the PDF the client downloads
  if (compArr.length > 0) {
    const mappedComp: ComplianceClauseRow[] = compArr.map((c, idx) => ({
      id: `COMP-LIVE-${idx + 1}`,
      standard: String(c.framework ?? "IEC 62443-3-3"),
      clauseId: String(c.clause_id ?? "SR 5.1"),
      findingCode: `FND-0${idx + 1}`,
      severity: "CRITICAL",
      preCutoverState: complianceLabel(String(c.pre_cutover_status ?? "NON_COMPLIANT")),
      postCutoverState: complianceLabel(String(c.post_cutover_status ?? "COMPLIANT_SL4")),
      diodeSatisfactionNote: String(c.auditor_evidence ?? ""),
    }));
    next.compliance = mappedComp;
  }

  return next;
}

function complianceLabel(status: string): string {
  return (
    {
      NON_COMPLIANT: "Not compliant",
      PARTIAL_SL2_ONLY: "Partial (SL-2 only)",
      COMPLIANT_SL3: "Compliant (SL-3)",
      COMPLIANT_SL4: "Compliant (SL-4)",
      COMPLIANT: "Compliant",
    }[status] ?? status
  );
}

/** Convert recorded browser audio Blob (WebM/Ogg) into mono 16kHz 16-bit PCM WAV bytes */
export async function encodeAudioBlobToWav(blob: Blob): Promise<Blob> {
  try {
    const arrayBuf = await blob.arrayBuffer();
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new AudioCtx({ sampleRate: 16000 });
    const decoded = await ctx.decodeAudioData(arrayBuf);
    const channel = decoded.getChannelData(0);
    await ctx.close();

    const pcmLength = channel.length * 2;
    const wavBuf = new ArrayBuffer(44 + pcmLength);
    const view = new DataView(wavBuf);

    const writeStr = (offset: number, s: string) => {
      for (let i = 0; i < s.length; i++) {
        view.setUint8(offset + i, s.charCodeAt(i));
      }
    };

    writeStr(0, "RIFF");
    view.setUint32(4, 36 + pcmLength, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, decoded.sampleRate, true);
    view.setUint32(28, decoded.sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, pcmLength, true);

    let offset = 44;
    for (let i = 0; i < channel.length; i++) {
      const clamped = Math.max(-1, Math.min(1, channel[i]));
      view.setInt16(
        offset,
        clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
        true
      );
      offset += 2;
    }
    return new Blob([wavBuf], { type: "audio/wav" });
  } catch {
    return blob;
  }
}

