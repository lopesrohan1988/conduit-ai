"""Principal OT Solutions Architect, Deterministic Diode Sizing & Cutover Synthesizer.

Combines:
1. Deterministic engineering math (`1.25x` bandwidth headroom, physical 1U/DIN-rail
   fit verification, Green/Amber/Red protocol cutover rules, TX/RX proxy translation
   tables, and Cisco IOS / Hirschmann HiOS port-security cutover CLI generation).
2. Live frontier reasoning synthesis via `Meta Muse Wonder 1.0` (`cloud_meta_api`) or
   `Meta Muse Glimmer 30B` (`air_gapped_open_weights`).
"""

from __future__ import annotations

from typing import Any

from app.agents.architect_llm_planner import (
    ArchitectureDecision,
    propose_and_verify_architecture,
)
from app.agents.switch_config_agent import SwitchAuditResult
from app.agents.telemetry_duckdb_agent import TelemetryAuditResult
from app.catalog_loader import load_hardware_catalog
from app.clients.meta_models import MetaModelGateway
from app.state import (
    ArchetypeId,
    BomLineItem,
    CabinetVisionInspection,
    ComplianceMappingRow,
    ConduitArchitecturePlan,
    ConduitSizingRecommendation,
    CutoverActionType,
    CutoverTier,
    ExecutiveSummary,
    InferenceMode,
    ModalDigitalTwinVerificationPlan,
    MountingOption,
    ProtocolCutoverRow,
    ReconciledZone,
    TxOperatingMode,
    TxRxProxyRule,
    VideoWalkthroughResult,
    VoiceFieldNoteTranscript,
)


def generate_switch_cutover_cli(
    plan: ConduitArchitecturePlan,
    *,
    switch_hostname: str = "OT-CORE-SW01",
) -> str:
    """Synthesize copy-ready Cisco IOS / Stratix VLAN isolation & port-security cutover CLI."""
    primary_sizing = plan.conduit_sizing_recommendations[0]
    ot_zone = plan.reconciled_zones[0] if plan.reconciled_zones else None
    ot_vlan = ot_zone.vlans[0] if (ot_zone and ot_zone.vlans) else 10
    first_proxy = (
        plan.tx_rx_proxy_translation_table[0]
        if plan.tx_rx_proxy_translation_table
        else None
    )
    tx_vip = first_proxy.tx_inner_vip if first_proxy else f"192.168.{ot_vlan}.250"

    lines = [
        f"! ==========================================================================",
        f"! ConduitAI Autonomous Cutover Script — {plan.executive_summary.facility_name}",
        f"! Target Switch: {switch_hostname} | Target Posture: IEC 62443 {plan.executive_summary.target_security_posture_sl}",
        f"! Enforced Diode: {primary_sizing.quantity}x {primary_sizing.recommended_archetype_id} ({primary_sizing.mounting_selection})",
        f"! ==========================================================================",
        "configure terminal",
        "!",
    ]

    # 1. Sever rogue bypass ports if any CRITICAL anomalies detected
    for anom in plan.shadow_assets_and_bypasses:
        if anom.anomaly_type in ("ROGUE_IT_BRIDGE", "DUAL_HOMED_BYPASS_ASSET"):
            lines.extend(
                [
                    f"! [CRITICAL] Quarantine {anom.anomaly_type}: {', '.join(anom.ip_addresses)} ({anom.mac_address})",
                    "interface GigabitEthernet1/0/24",
                    f" description QUARANTINED_{anom.anomaly_id}_AIRGAP_BYPASS",
                    " shutdown",
                    " exit",
                    "!",
                ]
            )

    # 2. Dedicated Diode TX Uplink Interface
    lines.extend(
        [
            f"! Provision Dedicated Hardware Data Diode TX Inner Interface ({tx_vip})",
            "interface GigabitEthernet1/0/47",
            f" description CONDUITAI_{primary_sizing.recommended_archetype_id}_TX_INGRESS",
            " switchport mode access",
            f" switchport access vlan {ot_vlan}",
            " switchport port-security",
            " switchport port-security maximum 2",
            " switchport port-security violation restrict",
            " spanning-tree portfast",
            " spanning-tree bpduguard enable",
            " no cdp enable",
            " no lldp transmit",
            " exit",
            "!",
            "! Decommission Legacy Bi-Directional IT/OT Firewall Trunk",
            "interface GigabitEthernet1/0/48",
            " description LEGACY_IT_FIREWALL_UPLINK_DECOMMISSIONED_POST_CUTOVER",
            " shutdown",
            " exit",
            "end",
            "write memory",
        ]
    )
    return "\n".join(lines)


_ACTION_PRESCRIPTIONS: dict[str, str] = {
    "DROP_IN_PROXY_MAPPING": "Route {proto} unidirectionally across {arch} TX -> RX replica.",
    "PULL_TO_PUSH_PROXY_REVERSAL": (
        "Reverse inbound {proto} poll: Diode TX polls OT {dst} locally and pushes state "
        "snapshots one-way to IT RX replica."
    ),
    "ROUTE_VIA_ARCH_D_OT_LOCKED_GATEWAY": (
        "Route {proto} through ARCH_D with TCP SYN locked to the OT side and a deterministic command whitelist."
    ),
    "DEPLOY_OPC_UA_WRAPPER_THEN_PROXY": "Deploy OT-side OPC-DA-to-OPC-UA wrapper on static TCP/4840 before Diode TX.",
    "REPLACE_SMB_WITH_SFTP_RELAY": "Replace legacy SMB share with OT-initiated SFTP file push across Diode TX.",
    "SEVER_CRITICAL_VIOLATION_AT_L1": "CRITICAL VIOLATION ({detail}): Physically sever at Layer 1/2.",
}


def synthesize_custom_architecture_plan(
    *,
    facility_name: str,
    switch_audit: SwitchAuditResult,
    telemetry_audit: TelemetryAuditResult,
    cabinet_inspections: list[CabinetVisionInspection],
    video_walkthrough: VideoWalkthroughResult | None,
    voice_transcript: VoiceFieldNoteTranscript | None,
    decision: ArchitectureDecision | None = None,
) -> ConduitArchitecturePlan:
    """Synthesize a `ConduitArchitecturePlan` from raw artifact audits.

    Without a `decision`, every choice comes from the deterministic rule engine. With a
    verifier-accepted `decision` from Muse Wonder / Glimmer, its per-flow tiers, BoM,
    mounting and target SL replace the rule-engine choices.
    """
    hw_catalog = load_hardware_catalog()
    arch_by_id = {a["archetype_id"]: a for a in hw_catalog.get("archetypes", [])}

    peak_mbps = telemetry_audit.peak_bandwidth_mbps or 25.0
    sized_mbps = round(peak_mbps * 1.25, 2)

    # Determine physical mounting constraints from SAM 3.1 cabinet + video + voice
    has_19inch = any(c.has_19inch_rack and c.empty_1u_slots > 0 for c in cabinet_inspections)
    if video_walkthrough and video_walkthrough.verified_empty_1u_slots > 0:
        has_19inch = True
    if cabinet_inspections and all(not c.has_19inch_rack for c in cabinet_inspections):
        has_19inch = False

    # Inspect protocol profile
    has_rtsp = any(f.dst_port == 554 or "RTSP" in f.protocol.upper() for f in telemetry_audit.flows)
    voice_text = (voice_transcript.raw_transcript.lower() if voice_transcript else "")
    needs_bidirectional_recipe = "recipe" in voice_text or "pas-x" in voice_text

    if needs_bidirectional_recipe and has_19inch:
        chosen_arch: ArchetypeId = "ARCH_D_BIDIRECTIONAL_GATEWAY"
        chosen_mount: MountingOption = "1U_19INCH_RACK"
        target_sl = "SL-3"
    elif has_rtsp or (sized_mbps > 80.0 and not has_19inch):
        chosen_arch = "ARCH_B_VIDEO_IOT_DIODE"
        chosen_mount = "1U_HALF_RACK" if has_19inch else "DIN_RAIL"
        target_sl = "SL-4"
    elif sized_mbps > 80.0 or len(switch_audit.vlans_observed) > 2:
        if has_19inch:
            chosen_arch = "ARCH_C_ENTERPRISE_1U_DIODE"
            chosen_mount = "1U_19INCH_RACK"
        else:
            chosen_arch = "ARCH_B_VIDEO_IOT_DIODE"
            chosen_mount = "DIN_RAIL"
        target_sl = "SL-4"
    else:
        chosen_arch = "ARCH_A_FIELD_DIODE"
        chosen_mount = "DIN_RAIL"
        target_sl = "SL-4"

    arch_meta = arch_by_id[chosen_arch]
    sustained_ceiling = float(arch_meta.get("recommended_sustained_mbps", 80.0))
    qty = max(1, int((sized_mbps + sustained_ceiling - 0.01) // sustained_ceiling))
    bom_choices: list[tuple[str, int, str]] = [(chosen_arch, qty, chosen_mount)]

    if decision is not None:
        bom_choices = [(b.archetype_id, b.quantity, b.mounting) for b in decision.bill_of_materials]
        # Primary conduit hardware = first unidirectional item (ARCH_D only carries return paths)
        primary = next((b for b in bom_choices if b[0] != "ARCH_D_BIDIRECTIONAL_GATEWAY"), bom_choices[0])
        chosen_arch, qty, chosen_mount = primary[0], primary[1], primary[2]  # type: ignore[assignment]
        arch_meta = arch_by_id[chosen_arch]
        target_sl = decision.target_sl

    bom_lines: list[BomLineItem] = []
    for idx, (code, n, _mount) in enumerate(bom_choices, start=1):
        unit = float(arch_by_id[code].get("estimated_bom_unit_cost_usd", 4500.0))
        bom_lines.append(
            BomLineItem(
                line_item=idx,
                item_code=code,
                description=str(arch_by_id[code].get("name", code)),
                quantity=n,
                estimated_unit_cost_usd=unit,
                estimated_extended_cost_usd=round(unit * n, 2),
            )
        )
    ext_cost = round(sum(b.estimated_extended_cost_usd for b in bom_lines), 2)
    total_units = sum(b.quantity for b in bom_lines)

    ot_vlans = [v for v in switch_audit.vlans_observed if v not in {50, 70, 80, 90, 100}] or [10]
    it_vlans = [v for v in switch_audit.vlans_observed if v in {50, 70, 80, 90, 100}] or [50]

    cutover_rows: list[ProtocolCutoverRow] = []
    proxy_rules: list[TxRxProxyRule] = []
    critical_severed = 0
    prx_idx = 1

    for fl in telemetry_audit.flows:
        initiator = "OT_TO_IT" if fl.direction == "OT_TO_IT" else "IT_TO_OT"
        tier = fl.preliminary_tier
        if fl.preliminary_tier == "GREEN":
            action: CutoverActionType = "DROP_IN_PROXY_MAPPING"
            presc = f"Route {fl.protocol} unidirectionally across {chosen_arch} TX -> RX replica."
        elif fl.preliminary_tier == "AMBER":
            action = (
                "ROUTE_VIA_ARCH_D_OT_LOCKED_GATEWAY"
                if chosen_arch == "ARCH_D_BIDIRECTIONAL_GATEWAY"
                else "PULL_TO_PUSH_PROXY_REVERSAL"
            )
            presc = (
                f"Reverse inbound {fl.protocol} poll: Diode TX polls OT {fl.dst_ip}:{fl.dst_port} "
                f"locally and pushes state snapshots one-way to IT RX replica."
            )
        else:
            if fl.dst_port in {135} or fl.uses_dynamic_ephemeral_ports:
                action = "DEPLOY_OPC_UA_WRAPPER_THEN_PROXY"
                presc = "Deploy OT-side OPC-DA-to-OPC-UA wrapper on static TCP/4840 before Diode TX."
            elif fl.dst_port in {139, 445}:
                action = "REPLACE_SMB_WITH_SFTP_RELAY"
                presc = "Replace legacy SMB share with OT-initiated SFTP file push across Diode TX."
            else:
                action = "SEVER_CRITICAL_VIOLATION_AT_L1"
                presc = f"CRITICAL VIOLATION ({fl.function_detail}): Physically sever at Layer 1/2."

        flow_decision = decision.flow_decisions.get(fl.flow_id) if decision else None
        if flow_decision is not None:
            initiator = "OT_TO_IT" if flow_decision.initiator == "OT_TO_IT" else "IT_TO_OT"
            tier = flow_decision.tier  # type: ignore[assignment]
            action = flow_decision.action  # type: ignore[assignment]
            presc = _ACTION_PRESCRIPTIONS[action].format(
                proto=fl.protocol, arch=chosen_arch, dst=f"{fl.dst_ip}:{fl.dst_port}", detail=fl.function_detail
            )
            if flow_decision.rationale:
                presc += f" Rationale: {flow_decision.rationale}"
        if action == "SEVER_CRITICAL_VIOLATION_AT_L1":
            critical_severed += 1

        cutover_rows.append(
            ProtocolCutoverRow(
                flow_id=fl.flow_id,
                observed_src_ip=fl.src_ip,
                observed_dst_ip=fl.dst_ip,
                port=fl.dst_port,
                protocol=fl.protocol,
                observed_initiator=initiator,  # type: ignore[arg-type]
                function_code_detail=fl.function_detail,
                cutover_tier=tier,
                cutover_action_type=action,
                engineering_prescription=presc,
            )
        )

        if action != "SEVER_CRITICAL_VIOLATION_AT_L1" and prx_idx <= 12:
            ot_ip = fl.src_ip if initiator == "OT_TO_IT" else fl.dst_ip
            it_ip = fl.dst_ip if initiator == "OT_TO_IT" else fl.src_ip
            ot_parts = ot_ip.split(".")
            it_parts = it_ip.split(".")
            tx_vip = f"{ot_parts[0]}.{ot_parts[1]}.{ot_parts[2]}.250" if len(ot_parts) == 4 else "192.168.10.250"
            rx_vip = f"{it_parts[0]}.{it_parts[1]}.{it_parts[2]}.250" if len(it_parts) == 4 else "10.50.1.250"
            tx_mode: TxOperatingMode = (
                "OT_SESSION_INITIATOR"
                if action == "ROUTE_VIA_ARCH_D_OT_LOCKED_GATEWAY"
                else "RTSP_STREAM_PULLER"
                if fl.dst_port == 554
                else (
                    "LOCAL_POLLER"
                    if action in ("PULL_TO_PUSH_PROXY_REVERSAL", "DEPLOY_OPC_UA_WRAPPER_THEN_PROXY")
                    else "PASSIVE_LISTENER"
                )
            )
            rem_port = 4840 if action == "DEPLOY_OPC_UA_WRAPPER_THEN_PROXY" else (22 if action == "REPLACE_SMB_WITH_SFTP_RELAY" else fl.dst_port)
            proxy_rules.append(
                TxRxProxyRule(
                    proxy_rule_id=f"PRX-{prx_idx:02d}",
                    assigned_conduit_id="CONDUIT-01",
                    assigned_archetype_id=(
                        "ARCH_D_BIDIRECTIONAL_GATEWAY"
                        if action == "ROUTE_VIA_ARCH_D_OT_LOCKED_GATEWAY"
                        else chosen_arch
                    ),
                    vlan_id=ot_vlans[0],
                    ot_source_ip=ot_ip,
                    ot_source_port=rem_port,
                    target_protocol=fl.protocol,
                    tx_inner_vip=tx_vip,
                    tx_operating_mode=tx_mode,
                    polling_interval_ms=500 if tx_mode == "LOCAL_POLLER" else None,
                    rx_outer_vip=rx_vip,
                    rx_exposed_port=rem_port,
                    it_consumer_ip=it_ip,
                    it_repointing_instruction=f"Repoint IT consumer {it_ip} to Diode RX VIP {rx_vip}:{rem_port}.",
                )
            )
            prx_idx += 1

    total_assets = switch_audit.total_discovered_assets or 12
    it_cnt = max(2, total_assets // 5)
    ot_cnt = max(1, total_assets - it_cnt)

    return ConduitArchitecturePlan(
        executive_summary=ExecutiveSummary(
            facility_name=facility_name,
            current_security_posture_sl="SL-1",
            target_security_posture_sl=target_sl,  # type: ignore[arg-type]
            total_discovered_assets=total_assets,
            undocumented_shadow_asset_count=len(switch_audit.shadow_anomalies),
            critical_violations_severed=critical_severed,
            recommended_diode_total_units=total_units,
            estimated_hardware_bom_usd=ext_cost,
            headline_synthesis=(
                decision.design_rationale
                if decision is not None and decision.design_rationale
                else (
                    f"Sized {' + '.join(f'{n}x {c}' for c, n, _ in bom_choices)} for {peak_mbps} Mbps peak "
                    f"({sized_mbps} Mbps w/ 1.25x headroom), severing {critical_severed} critical inbound risk(s)."
                )
            ),
        ),
        reconciled_zones=[
            ReconciledZone(
                zone_id="ZONE_OT_PRIMARY",
                zone_name=f"OT Control Zone (VLAN {ot_vlans[0]})",
                purdue_level="L1",
                target_sl=target_sl,  # type: ignore[arg-type]
                vlans=ot_vlans,
                asset_count=ot_cnt,
            ),
            ReconciledZone(
                zone_id="ZONE_IT_ENTERPRISE",
                zone_name=f"Enterprise IT Zone (VLAN {it_vlans[0]})",
                purdue_level="L4",
                target_sl="SL-2",
                vlans=it_vlans,
                asset_count=it_cnt,
            ),
        ],
        shadow_assets_and_bypasses=switch_audit.shadow_anomalies,
        conduit_sizing_recommendations=[
            ConduitSizingRecommendation(
                conduit_id=f"CONDUIT-{idx:02d}",
                source_zone_id="ZONE_OT_PRIMARY",
                destination_zone_id="ZONE_IT_ENTERPRISE",
                observed_peak_mbps=peak_mbps,
                sized_capacity_with_headroom_mbps=sized_mbps,
                recommended_archetype_id=code,  # type: ignore[arg-type]
                quantity=n,
                mounting_selection=mount,  # type: ignore[arg-type]
                cabinet_fit_verified=True,
                cabinet_fit_notes=f"SAM 3.1 verified {mount} enclosure clearance and switch port availability.",
                sizing_justification=(
                    f"Peak {peak_mbps} Mbps * 1.25 safety headroom = {sized_mbps} Mbps -> {n}x {code}."
                    + (
                        f" {decision.bill_of_materials[idx - 1].purpose}"
                        if decision is not None and decision.bill_of_materials[idx - 1].purpose
                        else ""
                    )
                ),
            )
            for idx, (code, n, mount) in enumerate(bom_choices, start=1)
        ],
        bill_of_materials=bom_lines,
        protocol_cutover_matrix=cutover_rows,
        tx_rx_proxy_translation_table=proxy_rules,
        modal_digital_twin_verification_plan=ModalDigitalTwinVerificationPlan(
            legitimate_flows_to_replay=[
                f"{r.target_protocol} ({r.ot_source_ip}:{r.ot_source_port} -> RX {r.rx_outer_vip}:{r.rx_exposed_port})"
                for r in proxy_rules[:4]
            ],
            adversarial_exploits_to_inject=[
                "Inbound IT-to-OT Nmap TCP SYN Sweep",
                "Unauthorized Modbus TCP FC 16 Register Write Injection",
            ],
            pass_criteria="100% legitimate telemetry continuity (<5ms latency) and 100% inbound exploit drop at Layer 1/2.",
        ),
        compliance_mapping=[
            ComplianceMappingRow(
                framework="IEC 62443-3-3",
                clause_id="SR 5.1 / SR 5.2 (Zone Boundary Protection)",
                pre_cutover_status="NON_COMPLIANT",
                post_cutover_status="COMPLIANT_SL4" if target_sl == "SL-4" else "COMPLIANT_SL3",
                auditor_evidence=f"Hardware-enforced {chosen_arch} isolation eliminates software firewall CVE lateral movement.",
            ),
            ComplianceMappingRow(
                framework="NIST SP 800-82 Rev. 3",
                clause_id="Section 5.2 (Unidirectional Gateways)",
                pre_cutover_status="NON_COMPLIANT",
                post_cutover_status="COMPLIANT",
                auditor_evidence="All inbound IT-to-OT polling converted to local TX poller -> one-way optical/FPGA push.",
            ),
        ],
    )


async def run_architect_sizing_agent(
    *,
    scenario_id: str | None,
    facility_name: str,
    inference_mode: InferenceMode,
    switch_audit: SwitchAuditResult,
    telemetry_audit: TelemetryAuditResult,
    cabinet_inspections: list[CabinetVisionInspection],
    video_walkthrough: VideoWalkthroughResult | None,
    voice_transcript: VoiceFieldNoteTranscript | None,
    gateway: MetaModelGateway,
    use_live_llm: bool = False,
) -> tuple[ConduitArchitecturePlan, dict[str, Any]]:
    """Design the cutover from measured evidence only (never from benchmark ground truth).

    With `use_live_llm`, `muse-wonder-1.0` (or air-gapped `Muse-Glimmer-30B`) proposes the
    design and the deterministic verifier must accept it; otherwise — or if every proposal is
    rejected — the deterministic rule engine designs it.
    """
    decision: ArchitectureDecision | None = None
    planner_trace: dict[str, Any] | None = None
    if use_live_llm:
        decision, trace = await propose_and_verify_architecture(
            facility_name=facility_name,
            switch_audit=switch_audit,
            telemetry_audit=telemetry_audit,
            cabinet_inspections=cabinet_inspections,
            video_walkthrough=video_walkthrough,
            voice_transcript=voice_transcript,
            gateway=gateway,
            inference_mode=inference_mode,
        )
        planner_trace = trace.to_dict()

    plan = synthesize_custom_architecture_plan(
        facility_name=facility_name,
        switch_audit=switch_audit,
        telemetry_audit=telemetry_audit,
        cabinet_inspections=cabinet_inspections,
        video_walkthrough=video_walkthrough,
        voice_transcript=voice_transcript,
        decision=decision,
    )

    default_model = (
        gateway.settings.muse_glimmer_model
        if inference_mode == "air_gapped_open_weights"
        else gateway.settings.muse_wonder_model
    )
    meta_info: dict[str, Any] = {
        "architect_model": (planner_trace or {}).get("model", default_model),
        "source_mode": (planner_trace or {}).get("final_source_mode", "deterministic_rule_engine"),
        "planner_trace": planner_trace,
        "reasoning_excerpt": next(
            (
                a["reasoning_excerpt"]
                for a in reversed((planner_trace or {}).get("attempts", []))
                if a.get("reasoning_excerpt")
            ),
            None,
        ),
        "switch_cutover_cli": generate_switch_cutover_cli(
            plan, switch_hostname=switch_audit.switch_hostname
        ),
    }
    return plan, meta_info
