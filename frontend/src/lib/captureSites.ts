import { CaptureSiteInfo, ScenarioDataset } from "@/types/conduit";
import { API_BASE } from "@/lib/api";
import { SCENARIO_REAL_IEC104 } from "./scenarioReal";

// Capture sites the user has picked this session, so getScenarioById can resolve them
const REGISTRY = new Map<string, ScenarioDataset>();

export function getCaptureSiteScenario(id: string): ScenarioDataset | undefined {
  return REGISTRY.get(id);
}

/** A site built from one public capture: the packets are the only evidence, nothing pre-written. */
export function registerCaptureSite(site: CaptureSiteInfo): ScenarioDataset {
  const existing = REGISTRY.get(site.scenarioId);
  if (existing) return existing;
  const scenario: ScenarioDataset = {
    ...SCENARIO_REAL_IEC104,
    id: site.scenarioId,
    dataOrigin: "public_capture",
    captureSite: site,
    shortIndex: 0,
    shortLabel: `${site.protocolFamily} capture [never seen]`,
    badgeTag: "PUBLIC CAPTURE · PACKETS ONLY",
    vertical: site.protocolFamily,
    facilityName: `Public capture: ${site.story}`,
    conduitId: "CAPTURE",
    conduitName: site.story,
    telemetry: {
      ...SCENARIO_REAL_IEC104.telemetry,
      pcapPacketCount: site.packetCount,
      documentedAssets: 0,
    },
  };
  REGISTRY.set(site.scenarioId, scenario);
  return scenario;
}

export async function fetchCaptureSites(): Promise<CaptureSiteInfo[]> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/capture-sites`);
    if (!res.ok) return [];
    const json = (await res.json()) as { capture_sites?: Array<Record<string, unknown>> };
    return (json.capture_sites ?? []).map((s) => ({
      scenarioId: String(s.scenario_id ?? ""),
      filename: String(s.filename ?? ""),
      story: String(s.story ?? ""),
      protocolFamily: String(s.protocol_family ?? ""),
      hardwareContext: String(s.hardware_context ?? ""),
      packetCount: Number(s.packet_count ?? 0),
      license: String(s.license ?? ""),
      sourceRepo: String(s.source_repo ?? ""),
      sourceUrl: String(s.source_url ?? ""),
    }));
  } catch {
    return [];
  }
}
