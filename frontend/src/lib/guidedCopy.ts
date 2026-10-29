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
  scenario_2_substation: {
    selectLabel: "1. GridCore 220kV Substation",
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
  scenario_4_water_treatment: {
    selectLabel: "2. AquaPure Water Plant (5G Alert)",
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
  scenario_5_uowm_iec104: {
    selectLabel: "3. IEC-104 Grid Testbed (real traffic)",
    industryBadge: "Real public data",
    businessGoal:
      "Real IEC-104 traffic from a university grid testbed, including a recorded attack: does ConduitAI find it and design the right fix?",
    cabinetFitHeadline: "No cabinet photos in this dataset",
    cabinetFitPlainText:
      "The public dataset has traffic only, so physical space is not measured; an engineer would confirm it on site.",
    hiddenRiskHeadline: "Recorded attack: unauthorised breaker commands",
    hiddenRiskPlainText:
      "The dataset's authors ran Metasploit's IEC-104 module from three machines on the plant network; ConduitAI has to find them from the traffic alone.",
    salesTalkingPoint:
      "Run on someone else's real traffic, with an answer key written by the dataset's authors, not by us.",
  },
};

export function getGuidedNarrative(
  scenario: ScenarioDataset
): GuidedScenarioNarrative {
  return (
    SCENARIO_NARRATIVES[scenario.id] ??
    SCENARIO_NARRATIVES.scenario_2_substation
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
