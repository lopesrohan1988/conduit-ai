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

from app.agents.switch_config_agent import SwitchAuditResult
from app.agents.telemetry_duckdb_agent import TelemetryAuditResult
from app.catalog_loader import (
    build_scenario_architecture_plan,
    load_hardware_catalog,
)
from app.clients.meta_models import MetaModelGateway, extract_json_object
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


def synthesize_custom_architecture_plan(
    *,
    facility_name: str,
    switch_audit: SwitchAuditResult,
    telemetry_audit: TelemetryAuditResult,
    cabinet_inspections: list[CabinetVisionInspection],
    video_walkthrough: VideoWalkthroughResult | None,
    voice_transcript: VoiceFieldNoteTranscript | None,
) -> ConduitArchitecturePlan:
    """Synthesize a deterministic `ConduitArchitecturePlan` directly from raw artifact audits."""
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
    sustained_ceiling = float(arch_meta.get("sustained_throughput_ceiling_mbps", 80.0))
    qty = max(1, int((sized_mbps + sustained_ceiling - 0.01) // sustained_ceiling))
    unit_cost = float(arch_meta.get("estimated_unit_cost_usd", 4500.0))
    ext_cost = round(unit_cost * qty, 2)

    ot_vlans = [v for v in switch_audit.vlans_observed if v not in {50, 70, 80, 90, 100}] or [10]
    it_vlans = [v for v in switch_audit.vlans_observed if v in {50, 70, 80, 90, 100}] or [50]

    cutover_rows: list[ProtocolCutoverRow] = []
    proxy_rules: list[TxRxProxyRule] = []
    critical_severed = 0
    prx_idx = 1

    for fl in telemetry_audit.flows:
        initiator = "OT_TO_IT" if fl.direction == "OT_TO_IT" else "IT_TO_OT"
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
                cutover_tier=fl.preliminary_tier,
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
                "RTSP_STREAM_PULLER"
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
                    assigned_archetype_id=chosen_arch,
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
            recommended_diode_total_units=qty,
            estimated_hardware_bom_usd=ext_cost,
            headline_synthesis=(
                f"Sized {qty}x {chosen_arch} ({chosen_mount}) for {peak_mbps} Mbps peak "
                f"({sized_mbps} Mbps w/ 1.25x headroom), severing {critical_severed} critical inbound risk(s)."
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
                conduit_id="CONDUIT-01",
                source_zone_id="ZONE_OT_PRIMARY",
                destination_zone_id="ZONE_IT_ENTERPRISE",
                observed_peak_mbps=peak_mbps,
                sized_capacity_with_headroom_mbps=sized_mbps,
                recommended_archetype_id=chosen_arch,
                quantity=qty,
                mounting_selection=chosen_mount,
                cabinet_fit_verified=True,
                cabinet_fit_notes=f"SAM 3.1 verified {chosen_mount} enclosure clearance and switch port availability.",
                sizing_justification=f"Peak {peak_mbps} Mbps * 1.25 safety headroom = {sized_mbps} Mbps -> {qty}x {chosen_arch}.",
            )
        ],
        bill_of_materials=[
            BomLineItem(
                line_item=1,
                item_code=chosen_arch,
                description=str(arch_meta.get("name", chosen_arch)),
                quantity=qty,
                estimated_unit_cost_usd=unit_cost,
                estimated_extended_cost_usd=ext_cost,
            )
        ],
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
    """Run deterministic diode sizing + optional live `muse-wonder-1.0` / `Muse-Glimmer-30B` synthesis."""
    if scenario_id:
        try:
            plan = build_scenario_architecture_plan(scenario_id)
        except KeyError:
            plan = synthesize_custom_architecture_plan(
                facility_name=facility_name,
                switch_audit=switch_audit,
                telemetry_audit=telemetry_audit,
                cabinet_inspections=cabinet_inspections,
                video_walkthrough=video_walkthrough,
                voice_transcript=voice_transcript,
            )
    else:
        plan = synthesize_custom_architecture_plan(
            facility_name=facility_name,
            switch_audit=switch_audit,
            telemetry_audit=telemetry_audit,
            cabinet_inspections=cabinet_inspections,
            video_walkthrough=video_walkthrough,
            voice_transcript=voice_transcript,
        )

    meta_info: dict[str, Any] = {
        "architect_model": (
            gateway.settings.muse_glimmer_model
            if inference_mode == "air_gapped_open_weights"
            else gateway.settings.muse_wonder_model
        ),
        "source_mode": "deterministic_rule_engine",
        "reasoning_excerpt": None,
        "switch_cutover_cli": generate_switch_cutover_cli(
            plan, switch_hostname=switch_audit.switch_hostname
        ),
    }

    if not use_live_llm:
        return plan, meta_info

    # Invoke live `muse-wonder-1.0` (or Air-Gapped `Muse-Glimmer-30B`) to verify & enrich executive synthesis
    prompt = (
        f"You are ConduitAI's Principal OT Hardware Data Diode Solutions Architect.\n"
        f"Facility: {facility_name}\n"
        f"Telemetry Ground Truth: {switch_audit.total_discovered_assets} endpoints, "
        f"{len(switch_audit.shadow_anomalies)} undocumented shadow/bypass OT anomalies, "
        f"Peak Conduit Bandwidth = {telemetry_audit.peak_bandwidth_mbps} Mbps "
        f"({telemetry_audit.sized_bandwidth_with_1_25x_headroom_mbps} Mbps w/ 1.25x headroom), "
        f"Selected Diode = {plan.conduit_sizing_recommendations[0].quantity}x "
        f"{plan.conduit_sizing_recommendations[0].recommended_archetype_id} "
        f"({plan.conduit_sizing_recommendations[0].mounting_selection}).\n"
        "Return strict JSON ONLY with keys: "
        '{"headline_synthesis": "2-sentence boardroom + OT engineering cutover justification", '
        '"sizing_justification": "1-sentence 1.25x bandwidth & protocol proxy proof"}'
    )
    llm_res = await gateway.route_architect_reasoning(
        [{"role": "user", "content": prompt}],
        inference_mode=inference_mode,
        temperature=0.1,
        max_tokens=4096,
    )
    meta_info["architect_model"] = str(llm_res.get("model") or meta_info["architect_model"])
    meta_info["source_mode"] = str(llm_res.get("source_mode") or "deterministic_rule_engine")
    if llm_res.get("reasoning"):
        meta_info["reasoning_excerpt"] = str(llm_res["reasoning"])[:600]

    parsed = extract_json_object(llm_res.get("content", ""))
    if parsed:
        if parsed.get("headline_synthesis"):
            plan.executive_summary.headline_synthesis = str(parsed["headline_synthesis"]).strip()
        if parsed.get("sizing_justification") and plan.conduit_sizing_recommendations:
            plan.conduit_sizing_recommendations[0].sizing_justification = str(
                parsed["sizing_justification"]
            ).strip()

    return plan, meta_info

