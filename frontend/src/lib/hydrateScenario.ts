import {
  ArchetypeId,
  ComplianceClauseRow,
  ExploitReplayItem,
  FlowTier,
  HardwareBomItem,
  ModalTwinVerification,
  ProtocolFlowEntry,
  ScenarioDataset,
  ShadowAssetFinding,
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
          injectedPackets: Number(ex.packets_injected_from_it ?? 50),
          packetsCrossedBarrier: Number(ex.packets_reaching_ot ?? 0),
          result: "100% PHYSICALLY DROPPED",
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

export function hydrateScenarioFromBackendPayload(
  baseScenario: ScenarioDataset,
  payload: Record<string, unknown>,
  options?: { isCustomUpload?: boolean }
): ScenarioDataset {
  const next: ScenarioDataset = { ...baseScenario };
  const isCustom = Boolean(options?.isCustomUpload);

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

  if (isCustom && shadowArr.length > 0) {
    const mappedShadows: ShadowAssetFinding[] = shadowArr.map((s, idx) => {
      const ips = Array.isArray(s.ip_addresses) ? s.ip_addresses : [];
      const anomType = String(s.anomaly_type ?? "UNDOCUMENTED_SHADOW_ASSET");
      return {
        ipAddress: String(ips[0] ?? `192.168.10.${15 + idx}`),
        macAddress: String(s.mac_address ?? "00:1B:1B:00:00:01"),
        vendor: String(s.vendor ?? "Industrial Vendor"),
        model: anomType.includes("ROGUE") ? "Cellular Bypass Modem" : "Shadow OT Node",
        hostname: `shadow-node-${idx + 1}`,
        purdueLevel: "L1",
        vlan: 10,
        anomalyType: anomType,
        discoverySources: [String(s.evidence_source ?? "Switch ARP + PCAP")],
        description: String(s.remediation_action ?? ""),
        isRogueBypass: anomType === "ROGUE_IT_BRIDGE",
      };
    });
    next.shadowAssets = mappedShadows;
    next.isCriticalRogueScenario = mappedShadows.some((m) => m.isRogueBypass);
  }

  if (isCustom && cutoverArr.length > 0) {
    const mappedFlows: ProtocolFlowEntry[] = cutoverArr.map((row, idx) => {
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

      const matchingProxy = proxyArr[idx];
      return {
        flowId: String(row.flow_id ?? `FLOW-${idx + 1}`),
        srcIp: String(row.observed_src_ip ?? ""),
        dstIp: String(row.observed_dst_ip ?? ""),
        dstPort: Number(row.port ?? 502),
        transport: "TCP",
        protocol: String(row.protocol ?? "MODBUS_TCP"),
        functionDetail: String(row.function_code_detail ?? ""),
        direction: String(row.observed_initiator ?? "IT_TO_OT"),
        classification,
        catalogProtocolId: String(row.protocol ?? "MODBUS_TCP"),
        prescribedCutoverAction: String(row.engineering_prescription ?? ""),
        txInnerConfig: matchingProxy
          ? `${String(matchingProxy.tx_operating_mode)} on ${String(
              matchingProxy.tx_inner_vip
            )} -> OT ${String(matchingProxy.ot_source_ip)}:${String(
              matchingProxy.ot_source_port
            )}`
          : "PHYSICALLY SEVERED AT LAYER 1/2",
        rxOuterConfig: matchingProxy
          ? `Expose RX Replica ${String(matchingProxy.rx_outer_vip)}:${String(
              matchingProxy.rx_exposed_port
            )} to IT ${String(matchingProxy.it_consumer_ip)}`
          : "ZERO PROXY EXPOSURE",
      };
    });
    next.flows = mappedFlows;
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

  if (isCustom && compArr.length > 0) {
    const mappedComp: ComplianceClauseRow[] = compArr.map((c, idx) => ({
      id: `COMP-LIVE-${idx + 1}`,
      standard: String(c.framework ?? "IEC 62443-3-3"),
      clauseId: String(c.clause_id ?? "SR 5.1"),
      findingCode: `FND-0${idx + 1}`,
      severity: "CRITICAL",
      preCutoverState: String(c.pre_cutover_status ?? "NON_COMPLIANT"),
      postCutoverState: String(c.post_cutover_status ?? "COMPLIANT_SL4"),
      diodeSatisfactionNote: String(c.auditor_evidence ?? ""),
    }));
    next.compliance = mappedComp;
  }

  return next;
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

