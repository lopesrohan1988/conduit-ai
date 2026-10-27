import { FlowTier, ProtocolFlowEntry, ScenarioDataset } from "@/types/conduit";

export interface GuidedScenarioNarrative {
  customerSituation: string;
  businessGoal: string;
  cabinetFitHeadline: string;
  cabinetFitPlainText: string;
  hiddenRiskHeadline: string;
  hiddenRiskPlainText: string;
  salesTalkingPoint: string;
}

const SCENARIO_NARRATIVES: Record<string, GuidedScenarioNarrative> = {
  scenario_1_manufacturing: {
    customerSituation:
      "Automotive stamping plant sending robot & high-speed camera quality data up to corporate SAP and Splunk dashboards.",
    businessGoal:
      "Stop corporate IT ransomware from halting stamping presses while keeping 85 Mbps camera quality batches flowing with zero production downtime.",
    cabinetFitHeadline:
      "Yes — Fits Upstairs in Control Room 19\" Rack Slot RU-14 (Not Press-Floor Box)",
    cabinetFitPlainText:
      "SAM 3.1 spotted that the stamping-floor box only has clip-on DIN rails, while upstairs in the Control Room server rack, 1U slot RU-14 is wide open with 12 spare network ports. ConduitAI automatically mounts the 1U Enterprise Diode in RU-14 so installers don't show up with hardware that won't fit.",
    hiddenRiskHeadline:
      "3 Unlisted Factory PLCs & Direct Contractor Remote-Control Access Found",
    hiddenRiskPlainText:
      "Maintenance added 3 extra stamping & conveyor controllers (.15, .16, .17) that were missing from the customer's Visio diagram—plus an office workstation is sending unauthorized tonnage-overwrite commands inward.",
    salesTalkingPoint:
      "\"Your Visio diagram missed 3 live controllers on the press line. If we hadn't caught them before cutover, your PI Historian charts would have gone blank on Day 1—ConduitAI already included all 3 in your zero-downtime proxy setup.\"",
  },
  scenario_2_substation: {
    customerSituation:
      "220kV high-voltage power substation reporting live megawatt/voltage readings to the regional grid control center.",
    businessGoal:
      "Meet mandatory NERC CIP & CEA grid security rules and physically block remote breaker-trip cyberattacks at minimal hardware cost ($4,500).",
    cabinetFitHeadline:
      "Yes — Clips Directly onto Existing Substation DIN-Rail & 48V Battery Bus",
    cabinetFitPlainText:
      "SAM 3.1 verified 210mm of free 35mm DIN-rail space and 8 spare switch ports inside the relay house. The compact fanless Field Diode ($4,500) clips right in with zero rack modifications.",
    hiddenRiskHeadline:
      "Live Breaker-Trip Attack Command & 2 Temporary Relay Leftovers Caught",
    hiddenRiskPlainText:
      "Traffic logs revealed an unauthorized breaker-trip command coming from the corporate WAN (Industroyer2 pattern) plus 2 temporary Bay 4 commissioning relays left plugged in after last month's maintenance.",
    salesTalkingPoint:
      "\"A software firewall leaves a two-way cable open toward your 220kV circuit breakers. For just $4,500 in ruggedized hardware, this diode makes remote breaker-trip injection physically impossible while keeping regional EMS telemetry live.\"",
  },
  scenario_3_smart_building: {
    customerSituation:
      "Corporate HQ tower streaming 48 high-definition security cameras and smart HVAC building sensors into the corporate network.",
    businessGoal:
      "Prevent vulnerable security cameras from becoming a backdoor into corporate badge/HR databases—while saving $12,500 by right-sizing hardware.",
    cabinetFitHeadline:
      "Yes — Fits Open 1U Slot RU-14 in Building MDF Closet ($8,500 Half-Rack Diode)",
    cabinetFitPlainText:
      "SAM 3.1 verified an open 1U slot right below the Aruba PoE camera switch and selected the $8,500 Video & IoT Diode instead of an oversized $21,000 enterprise unit—saving the customer $12,500 immediately.",
    hiddenRiskHeadline:
      "Infected Security Camera (.33) Actively Scanning Building & Corporate Servers!",
    hiddenRiskPlainText:
      "Camera 172.16.40.33 has compromised firmware and is actively scanning corporate badge databases and chiller controls—plus 2 unlisted loading-dock cameras were found.",
    salesTalkingPoint:
      "\"One of your PoE cameras is already probing your corporate network. Our Video Diode strips away all network attack traffic and passes only pure video frames to your Milestone NVR—stopping camera-borne breaches cold for $8,500.\"",
  },
  scenario_4_water_treatment: {
    customerSituation:
      "Municipal drinking-water plant dosing chlorine & reporting EPA water-quality data, working from an old 2019 paper blueprint.",
    businessGoal:
      "Protect public drinking-water chemical dosing from remote tampering and fit inside wet-area NEMA cabinets that have zero server racks.",
    cabinetFitHeadline:
      "Critical Save — No 19\" Rack Here! Auto-Switched Quote to Clip-On DIN Hardware",
    cabinetFitPlainText:
      "A standard 19-inch rackmount diode cannot mount inside this chemical cabinet. SAM 3.1 measured 250mm of free 35mm DIN rail and sized a compact dual DIN-rail kit (175mm total) that clips in cleanly.",
    hiddenRiskHeadline:
      "URGENT: Unauthorized 5G Cellular Modem Bypassing the Firewall!",
    hiddenRiskPlainText:
      "SAM 3.1's camera scan + switch logs caught a hidden 5G cellular router with paddle antennas plugged straight into port Gi1/24—completely invisible to the customer's firewall while allowing Oldsmar-style remote screen control and dangerous 11,100 ppm chlorine overrides!",
    salesTalkingPoint:
      "\"Your perimeter firewall looked clean only because someone plugged a rogue 5G cellular modem directly inside the chlorine cabinet! ConduitAI spotted it on camera and in packet logs—we give your team the exact switch port (Gi1/24) to shut down today.\"",
  },
  scenario_5_oil_gas_pipeline: {
    customerSituation:
      "Remote West Texas gas compressor station sending pipeline metering & safety data over satellite (VSAT) to Houston headquarters.",
    businessGoal:
      "Keep gas flowing even if corporate IT is hit by Colonial Pipeline-style ransomware, using wide-temperature (-40°C to +75°C) hardware.",
    cabinetFitHeadline:
      "Yes — Rugged Heat-Rated (-40°C to +75°C) DIN Diode Fits Desert Enclosure",
    cabinetFitPlainText:
      "Field technician audio noted cabinet temperatures hit 62°C in summer. ConduitAI selected a fanless aluminum DIN-rail diode rated to +75°C that fits the 250mm open rail space.",
    hiddenRiskHeadline:
      "Unencrypted Passwords Over Satellite & Ransomware-Prone File Shares",
    hiddenRiskPlainText:
      "Houston IT is logging into a pipeline odorizer over unencrypted Telnet (exposing root passwords in plaintext) and mounting legacy Windows SMB file shares—the #1 ransomware pathway.",
    salesTalkingPoint:
      "\"If ransomware hits corporate IT tomorrow, open Windows file shares can force a precautionary pipeline shutdown. For $4,500, this extreme-temp hardware diode isolates Compressor Station 4 so gas custody metering never stops.\"",
  },
  scenario_6_pharma_cleanroom: {
    customerSituation:
      "FDA-regulated sterile biologics cleanroom streaming batch quality records out while receiving signed production recipes from Werum PAS-X MES.",
    businessGoal:
      "Achieve hardware isolation WITHOUT breaking mandatory closed-loop digital batch recipe downloads required to run pharmaceutical manufacturing.",
    cabinetFitHeadline:
      "Yes — Dual 1U Slots Verified in Cleanroom Interstitial Server Rack",
    cabinetFitPlainText:
      "SAM 3.1 verified two contiguous 1U slots and 12 free ports in the cleanroom interstitial rack—accommodating both the Controlled Recipe Gateway and the Optical Cleanroom EMS Diode.",
    hiddenRiskHeadline:
      "Pure One-Way Diode Would Break Batch Recipes + 2 Unvalidated GMP Skids Found",
    hiddenRiskPlainText:
      "Quoting a standard blind one-way diode on VLAN 60 would block PAS-X master recipes and halt drug production! ConduitAI automatically selected Archetype D (OT-initiated hardware guard) for recipes + flagged 2 unvalidated mixer/WFI skids.",
    salesTalkingPoint:
      "\"Most vendors quote a blind one-way diode here and accidentally break your PAS-X recipe downloads. ConduitAI recognized your signed recipe flow and paired a Controlled OT-Locked Gateway with pure optical particle-counter isolation—plus caught 2 unvalidated GMP skids before an FDA audit.\"",
  },
};

export function getGuidedNarrative(scenario: ScenarioDataset): GuidedScenarioNarrative {
  return (
    SCENARIO_NARRATIVES[scenario.id] ?? SCENARIO_NARRATIVES.scenario_1_manufacturing
  );
}

export function getPlainEnglishTierSummary(tier: FlowTier): {
  title: string;
  customerImpact: string;
  badgeColor: string;
} {
  switch (tier) {
    case "GREEN":
      return {
        title: "✅ Works Immediately (One-Way Out)",
        customerImpact:
          "Already sends data outward from plant to office. Flows straight through the hardware diode with zero workflow changes.",
        badgeColor: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
      };
    case "AMBER":
      return {
        title: "🔄 Kept Working via Auto-Mirror (Pull → Push)",
        customerImpact:
          "Office server currently reaches into the plant to read data. Diode's inner helper reads the machine locally and updates a safe office mirror copy—0% downtime.",
        badgeColor: "bg-amber-500/15 text-amber-300 border-amber-500/40",
      };
    case "RED_BLOCKER":
      return {
        title: "🔌 Needs Simple Local Adapter Before Cutover",
        customerImpact:
          "Old Windows file-share or dynamic-port protocol that ransomware abuses. Converted to a clean one-way file/tag push on the plant side.",
        badgeColor: "bg-orange-500/20 text-orange-300 border-orange-500/50",
      };
    case "CRITICAL_VIOLATION":
      return {
        title: "🛑 Dangerous Access — Permanently Blocked",
        customerImpact:
          "Unauthorized remote desktop, hacker scan, or machine-override write. Physically impossible after hardware diode installation.",
        badgeColor: "bg-rose-500/20 text-rose-300 border-rose-500/50",
      };
  }
}

export function explainFlowInPlainEnglish(flow: ProtocolFlowEntry): {
  whatItDoes: string;
  howWeHandleIt: string;
} {
  const proto = flow.protocol.toUpperCase();
  if (flow.classification === "CRITICAL_VIOLATION") {
    return {
      whatItDoes: `High-risk remote access or unauthorized control command (${flow.functionDetail}).`,
      howWeHandleIt:
        "Physically cut off by the one-way hardware barrier so attackers can never reach plant equipment.",
    };
  }
  if (flow.classification === "RED_BLOCKER") {
    return {
      whatItDoes: `Legacy two-way Windows ${proto} connection (${flow.functionDetail}).`,
      howWeHandleIt:
        "Replaced with a safe local protocol adapter / one-way SFTP file dropbox before cutover so business files still arrive.",
    };
  }
  if (flow.classification === "AMBER") {
    if (proto.includes("RECIPE")) {
      return {
        whatItDoes:
          "Mandatory signed production batch recipes sent from enterprise MES to plant batch controller.",
        howWeHandleIt:
          "Handled safely via Controlled Gateway (ARCH_D): the plant side pulls signed recipes from a holding queue—office hosts can never initiate connections inward.",
      };
    }
    return {
      whatItDoes: `Office dashboard/historian polling plant equipment for read-only readings (${flow.functionDetail}).`,
      howWeHandleIt:
        "Diode's OT-side poller reads the equipment locally and mirrors live values to the office side—dashboards stay 100% live without inward access.",
    };
  }
  return {
    whatItDoes: `Outbound plant telemetry, video, or security logs (${flow.functionDetail}).`,
    howWeHandleIt:
      "Streams straight out across the one-way optical hardware diode with zero downtime.",
  };
}

export function buildNetworkEngineerRequestTemplate(
  scenario: ScenarioDataset
): string {
  return `Subject: Quick Read-Only Site Exports for ${scenario.facilityName} Data Diode Sizing (Zero Plant Impact)

Hi Network / OT Engineering Team,

We are preparing a verified hardware data diode quote and zero-downtime cutover plan for ${scenario.facilityName} (${scenario.vertical}) using ConduitAI.

Nothing needs to be installed on your network—everything runs 100% offline from 4 quick read-only items whenever convenient:

1. Existing Network Diagram: Any PDF, PNG, Visio export, paper blueprint scan, or whiteboard photo you already have.
2. Cabinet / Server Rack Photo + 6-sec Video: Quick smartphone photo & vertical pan of the target rack or PLC cabinet (so we verify 1U rack vs. 35mm DIN-rail fit and spare switch ports).
3. Read-Only Switch ARP/MAC Output: Output of "show ip arp", "show mac address-table", and "show vlan" from the boundary OT switch.
4. Boundary Traffic Sample: A 5–15 min passive SPAN/mirror PCAP capture (and optional 24h firewall CSV log) at the IT/OT boundary so we verify peak Mbps and ensure zero Historian/SCADA polling breaks at cutover.

Optional: Feel free to record a 15-second voice memo on your phone pointing out any recent floor additions or temperature/power constraints.

Thank you!`;
}

export function buildCustomerProposalEmail(scenario: ScenarioDataset): string {
  const narrative = getGuidedNarrative(scenario);
  const hwLines = scenario.bom.items
    .map(
      (i) =>
        `  • ${i.quantity}x ${i.name} (${i.archetypeId}) — ${i.mountingOption} — $${i.extendedCostUsd.toLocaleString()} USD`
    )
    .join("\n");

  return `Subject: Verified Hardware Data Diode Proposal & Zero-Downtime Cutover Plan — ${scenario.facilityName}

Hi Team,

Following our review of your site diagram, cabinet photos, and boundary network capture for ${scenario.facilityName}, here is your verified hardware isolation quote and cutover summary:

1. RECOMMENDED HARDWARE QUOTE (Total: $${scenario.bom.totalHardwareCostUsd.toLocaleString()} USD)
${hwLines}
  • Bandwidth Sizing: ${scenario.bom.peakBandwidthMbps} Mbps observed peak → sized for ${scenario.bom.sizedBandwidthWithHeadroomMbps} Mbps (includes 25% safety buffer; hardware supports ${scenario.bom.sustainedCapacityMbps} Mbps sustained).
  • Physical Fit Verified: ${scenario.bom.physicalFitStatus}

2. KEY FLOOR RISKS UNCOVERED BEFORE INSTALLATION
  • ${narrative.hiddenRiskHeadline}: ${narrative.hiddenRiskPlainText}

3. ZERO-DOWNTIME CUTOVER GUARANTEE (DIGITAL TWIN VERIFIED)
  • All ${scenario.flows.length} cross-zone data flows were replayed across a physical one-way socket twin:
  • 0% Operational Downtime — existing Historian, SCADA, and compliance feeds remain 100% live via local pull-to-push mirroring.
  • 100% Inbound Cyberattack Block — remote desktop, ransomware file shares, and unauthorized machine writes are physically severed (${scenario.preCutoverSl} → ${scenario.postCutoverSl}).

4. COMPLIANCE STANDARDS SATISFIED
  • ${scenario.compliance.map((c) => `${c.standard} (${c.clauseId})`).join(", ")}

Attached / Ready to Share with Your Network Engineer:
  • Editable Target Architecture Diagram (.drawio)
  • Copy-Paste Switch VLAN Cutover Commands & TX/RX Proxy Configuration Bundle

Let's review this together in a 15-minute call with your network lead to schedule cutover.`;
}
