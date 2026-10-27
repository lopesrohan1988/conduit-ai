import { FlowTier, ProtocolFlowEntry, ScenarioDataset } from "@/types/conduit";

export interface GuidedScenarioNarrative {
  selectLabel: string;
  industryBadge: string;
  businessGoal: string;
  cabinetFitHeadline: string;
  cabinetFitPlainText: string;
  hiddenRiskHeadline: string;
  hiddenRiskPlainText: string;
  salesTalkingPoint: string;
}

const SCENARIO_NARRATIVES: Record<string, GuidedScenarioNarrative> = {
  scenario_1_manufacturing: {
    selectLabel: "1. Apex Automotive Plant",
    industryBadge: "Manufacturing",
    businessGoal:
      "Block corporate ransomware from stamping presses while keeping 85 Mbps camera quality feeds live.",
    cabinetFitHeadline:
      "Fits Control Room 19\" Rack Slot RU-14 (12 spare ports)",
    cabinetFitPlainText:
      "Floor cabinet only has DIN rails; SAM 3.1 verified an open 1U slot (RU-14) upstairs in the Control Room rack.",
    hiddenRiskHeadline:
      "3 unlisted press PLCs & unauthorized remote PLC write access found",
    hiddenRiskPlainText:
      "Controllers .15–.17 were missing from the Visio diagram, and an office PC is writing tonnage registers directly.",
    salesTalkingPoint:
      "Your diagram missed 3 live press PLCs—ConduitAI caught them before cutover so your PI Historian never drops a tag.",
  },
  scenario_2_substation: {
    selectLabel: "2. GridCore 220kV Substation",
    industryBadge: "Power Grid",
    businessGoal:
      "Meet NERC CIP rules and physically block remote breaker-trip commands for $4,500.",
    cabinetFitHeadline:
      "Clips directly onto existing 35mm DIN rail & 48V bus",
    cabinetFitPlainText:
      "SAM 3.1 measured 210mm of open DIN rail and 8 free ports inside the relay house—no rack modifications needed.",
    hiddenRiskHeadline:
      "Live breaker-trip command & 2 unlisted Bay 4 relays detected",
    hiddenRiskPlainText:
      "Packet logs caught an unauthorized IEC-104 breaker command from WAN plus 2 commissioning relays left on the switch.",
    salesTalkingPoint:
      "For $4,500 in rugged DIN hardware, remote breaker-trip attacks become physically impossible while EMS telemetry stays live.",
  },
  scenario_3_smart_building: {
    selectLabel: "3. MetroCorp Smart Building",
    industryBadge: "Smart Building",
    businessGoal:
      "Isolate 48 security cameras & HVAC from corporate HR/badge servers—saving $12,500 via right-sizing.",
    cabinetFitHeadline:
      "Fits open 1U slot RU-14 in MDF closet ($8,500 half-rack unit)",
    cabinetFitPlainText:
      "SAM 3.1 verified 1U open space below the PoE switch and selected the $8,500 Video Diode over a $21k enterprise unit.",
    hiddenRiskHeadline:
      "Compromised PoE camera (.33) actively scanning corporate servers",
    hiddenRiskPlainText:
      "Camera 172.16.40.33 is probing badge databases and chiller controls; 2 unlisted dock cameras also discovered.",
    salesTalkingPoint:
      "One camera is already probing your corporate network—this $8,500 Video Diode passes pure video frames and blocks all network pivots.",
  },
  scenario_4_water_treatment: {
    selectLabel: "4. AquaPure Water Plant (5G Alert)",
    industryBadge: "Water Utility",
    businessGoal:
      "Lock down chlorine dosing against remote tampering inside wet-area NEMA cabinets.",
    cabinetFitHeadline:
      "No 19\" rack on site — auto-switched quote to clip-on DIN kit",
    cabinetFitPlainText:
      "Standard rack units won't fit this NEMA box; SAM 3.1 measured 250mm free DIN rail for a 175mm dual DIN kit.",
    hiddenRiskHeadline:
      "Rogue 5G cellular modem bypassing the firewall on port Gi1/24",
    hiddenRiskPlainText:
      "Camera scan + switch MAC table caught an unauthorized 5G router allowing remote VNC screen control & chemical overrides.",
    salesTalkingPoint:
      "Your firewall looked clean because a rogue 5G modem was plugged directly into the chlorine cabinet—we give IT the exact port (Gi1/24) to shut down.",
  },
  scenario_5_oil_gas_pipeline: {
    selectLabel: "5. PermianStream Oil Pipeline",
    industryBadge: "Oil & Gas",
    businessGoal:
      "Keep pipeline gas custody metering running even during a corporate IT ransomware incident.",
    cabinetFitHeadline:
      "Heat-rated (-40°C to +75°C) fanless DIN diode fits compressor box",
    cabinetFitPlainText:
      "Voice note flagged 62°C summer cabinet heat; ConduitAI selected a +75°C rated DIN diode fitting 250mm open rail.",
    hiddenRiskHeadline:
      "Plaintext Telnet passwords & ransomware-prone SMB shares over VSAT",
    hiddenRiskPlainText:
      "Corporate IT is using unencrypted Telnet to the odorizer and mounting SMB file shares across the satellite link.",
    salesTalkingPoint:
      "Open Windows file shares can force a pipeline shutdown during IT ransomware—this $4,500 heat-rated diode keeps gas metering isolated.",
  },
  scenario_6_pharma_cleanroom: {
    selectLabel: "6. BioVance Pharma Cleanroom",
    industryBadge: "Pharma GMP",
    businessGoal:
      "Isolate cleanroom skids without breaking mandatory signed MES batch recipe downloads.",
    cabinetFitHeadline:
      "Dual open 1U slots verified in cleanroom interstitial rack",
    cabinetFitPlainText:
      "SAM 3.1 confirmed two contiguous 1U slots and 12 spare ports for the Controlled Recipe Gateway + Optical EMS Diode.",
    hiddenRiskHeadline:
      "Blind one-way diode would break batch recipes + 2 unvalidated skids found",
    hiddenRiskPlainText:
      "Standard one-way diodes block PAS-X recipe handshakes; ConduitAI paired an OT-initiated gateway and flagged 2 unlisted GMP skids.",
    salesTalkingPoint:
      "A standard blind diode here would halt drug batch recipes—ConduitAI paired an OT-locked recipe gateway and caught 2 unvalidated skids pre-audit.",
  },
};

export function getGuidedNarrative(
  scenario: ScenarioDataset
): GuidedScenarioNarrative {
  return (
    SCENARIO_NARRATIVES[scenario.id] ??
    SCENARIO_NARRATIVES.scenario_1_manufacturing
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
        title: "Works As-Is",
        customerImpact: "Flows outward naturally with zero changes.",
        badgeColor: "bg-emerald-50 text-emerald-700 border-emerald-200",
      };
    case "AMBER":
      return {
        title: "Auto-Reversed",
        customerImpact: "Local helper mirrors readings outward safely.",
        badgeColor: "bg-amber-50 text-amber-800 border-amber-200",
      };
    case "RED_BLOCKER":
      return {
        title: "Local Adapter",
        customerImpact: "Converted to a safe one-way file/tag push.",
        badgeColor: "bg-amber-50 text-amber-800 border-amber-200",
      };
    case "CRITICAL_VIOLATION":
      return {
        title: "Blocked Threat",
        customerImpact: "Physically severed by one-way hardware.",
        badgeColor: "bg-rose-50 text-rose-700 border-rose-200",
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
      whatItDoes: `Unauthorized remote control / scan (${flow.functionDetail})`,
      howWeHandleIt: "Physically blocked by one-way diode hardware.",
    };
  }
  if (flow.classification === "RED_BLOCKER") {
    return {
      whatItDoes: `Legacy two-way ${proto} share (${flow.functionDetail})`,
      howWeHandleIt: "Converted to safe one-way local file/tag push.",
    };
  }
  if (flow.classification === "AMBER") {
    if (proto.includes("RECIPE")) {
      return {
        whatItDoes: "Signed MES production batch recipe download",
        howWeHandleIt: "Plant side pulls signed recipes via Controlled Gateway (ARCH_D).",
      };
    }
    return {
      whatItDoes: `Dashboard polling plant data (${flow.functionDetail})`,
      howWeHandleIt: "OT poller mirrors live values to office replica (0% downtime).",
    };
  }
  return {
    whatItDoes: `Outbound telemetry / video / logs (${flow.functionDetail})`,
    howWeHandleIt: "Streams straight out through the one-way optical diode.",
  };
}

export function buildNetworkEngineerRequestTemplate(
  scenario: ScenarioDataset
): string {
  return `Subject: Read-Only Site Files for ${scenario.facilityName} Data Diode Quote

Hi Network / OT Team,

To generate our verified hardware diode quote and zero-downtime cutover plan for ${scenario.facilityName}, please share 4 quick read-only items (nothing installed on your network):

1. Network Diagram: Existing PDF, Visio, PNG, or whiteboard photo.
2. Cabinet Photo + 6s Video: Quick phone photo & vertical pan of the target rack or PLC cabinet.
3. Switch ARP / MAC Output: Read-only "show ip arp", "show mac address-table", and "show vlan".
4. Boundary Traffic Sample: 5–15 min passive SPAN PCAP (plus optional firewall CSV log).

Optional: A 15-second phone voice memo noting any floor changes or heat/power limits.

Thanks!`;
}

export function buildCustomerProposalEmail(scenario: ScenarioDataset): string {
  const narrative = getGuidedNarrative(scenario);
  const hwLines = scenario.bom.items
    .map(
      (i) =>
        `• ${i.quantity}x ${i.name} (${i.mountingOption}) — $${i.extendedCostUsd.toLocaleString()}`
    )
    .join("\n");

  return `Subject: Verified Data Diode Quote & Zero-Downtime Plan — ${scenario.facilityName}

Hi Team,

Here is your verified hardware isolation quote and cutover summary for ${scenario.facilityName}:

1. Hardware Quote — $${scenario.bom.totalHardwareCostUsd.toLocaleString()} USD
${hwLines}
• Speed Sized: ${scenario.bom.peakBandwidthMbps} Mbps peak → ${scenario.bom.sizedBandwidthWithHeadroomMbps} Mbps w/ 25% buffer (${scenario.bom.sustainedCapacityMbps} Mbps capacity).
• Physical Fit: ${scenario.bom.physicalFitStatus}

2. Floor Risks Caught Early
• ${narrative.hiddenRiskHeadline}

3. Zero-Downtime Proof (Digital Twin Verified)
• All ${scenario.flows.length} connections tested: 0% plant downtime, 100% inbound attacks physically blocked (${scenario.preCutoverSl} → ${scenario.postCutoverSl}).
• Satisfies: ${scenario.compliance.map((c) => `${c.standard} ${c.clauseId}`).join(", ")}.

Ready to review with your network lead in 15 minutes to schedule cutover.`;
}
