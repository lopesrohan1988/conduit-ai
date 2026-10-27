import { InferenceMode, ModelServiceHealth } from "@/types/conduit";
import { getDefaultModelStack } from "./fallbackData";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8008";

export function getStaticDataUrl(relativePath: string): string {
  const cleaned = relativePath.replace(/^\/+/, "");
  return `${API_BASE}/static/data/${cleaned}`;
}

export interface BackendHealthPayload {
  status?: string;
  backendConnected: boolean;
  models: ModelServiceHealth[];
}

export async function fetchBackendModelHealth(
  mode: InferenceMode
): Promise<BackendHealthPayload> {
  const fallback = getDefaultModelStack(mode);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2200);
    const res = await fetch(`${API_BASE}/api/v1/health/models`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { backendConnected: false, models: fallback };
    }
    const data = await res.json();
    const integrationsKeyMap: Record<string, string> = {
      sam_3_1: "sam_3_1",
      muse_spark: "muse_spark",
      muse_wonder: "muse_wonder",
      muse_image: "muse_image",
      muse_voice: "muse_voice_transcribe",
      baseten_1026: "baseten_muse_spark_open_1026",
      modal_twin: "modal_glimmer_and_twin",
    };
    // Merge live latency or status flags from backend if provided
    const merged = fallback.map((badge) => {
      const mappedKey = integrationsKeyMap[badge.id] ?? badge.id;
      const remoteEntry =
        data?.integrations?.[mappedKey] ??
        data?.models?.[badge.id] ??
        (Array.isArray(data?.models)
          ? data.models.find(
              (m: Record<string, unknown>) =>
                m.id === badge.id || m.name === badge.label
            )
          : undefined);
      if (!remoteEntry) return badge;
      const remoteStatus = String(
        remoteEntry.operational_status ?? remoteEntry.status ?? ""
      ).toLowerCase();
      return {
        ...badge,
        status:
          mode === "airgapped_glimmer" && badge.id !== "modal_twin"
            ? ("airgapped" as const)
            : remoteStatus === "live" ||
                remoteStatus === "live_ready" ||
                remoteStatus === "online" ||
                remoteStatus === "ready" ||
                remoteStatus === "configured" ||
                remoteStatus === "sandbox_profile_ready"
              ? ("online" as const)
              : remoteStatus === "demo_fallback_ready" ||
                  remoteStatus === "simulated" ||
                  remoteStatus === "fallback"
                ? ("online" as const)
                : badge.status,
        latencyMs:
          typeof remoteEntry.latency_ms === "number"
            ? remoteEntry.latency_ms
            : badge.latencyMs,
      };
    });
    return { backendConnected: true, status: data?.status ?? "ok", models: merged };
  } catch {
    return { backendConnected: false, models: fallback };
  }
}

export async function fetchBackendScenariosList(): Promise<string[] | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${API_BASE}/api/v1/scenarios`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    if (Array.isArray(json)) {
      return json.map((item) => String(item.scenario_id ?? item.id ?? ""));
    }
    if (Array.isArray(json?.scenarios)) {
      return json.scenarios.map((item: Record<string, unknown>) =>
        String(item.scenario_id ?? item.id ?? "")
      );
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchScenarioPreview(
  scenarioId: string
): Promise<Record<string, unknown> | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2200);
    const res = await fetch(
      `${API_BASE}/api/v1/scenarios/${encodeURIComponent(scenarioId)}/preview`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getExportEndpointUrl(
  scenarioId: string,
  format: "drawio" | "pdf" | "zip"
): string {
  return `${API_BASE}/api/v1/assessments/${encodeURIComponent(scenarioId)}/export/${format}`;
}
