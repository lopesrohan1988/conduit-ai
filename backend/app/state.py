"""Pydantic v2 domain schemas and LangGraph state definitions for ConduitAI.

Matches `data/prompts/muse_spark_architect_prompt.md` and
`data/prompts/sam31_vision_prompts.json` 100%.
"""

from __future__ import annotations

import operator
from typing import Annotated, Any, Literal, TypedDict

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Shared Literals & Enums
# ---------------------------------------------------------------------------

InferenceMode = Literal["cloud_meta_api", "air_gapped_open_weights"]

PurdueLevel = Literal["L0", "L1", "L2", "L3", "L3.5", "L4"]

ArchetypeId = Literal[
    "ARCH_A_FIELD_DIODE",
    "ARCH_B_VIDEO_IOT_DIODE",
    "ARCH_C_ENTERPRISE_1U_DIODE",
    "ARCH_D_BIDIRECTIONAL_GATEWAY",
]

MountingOption = Literal[
    "DIN_RAIL",
    "COMPACT_WALL",
    "1U_HALF_RACK",
    "1U_19INCH_RACK",
]

CutoverTier = Literal["GREEN", "AMBER", "RED"]

CutoverActionType = Literal[
    "DROP_IN_PROXY_MAPPING",
    "PULL_TO_PUSH_PROXY_REVERSAL",
    "DEPLOY_OPC_UA_WRAPPER_THEN_PROXY",
    "REPLACE_SMB_WITH_SFTP_RELAY",
    "ROUTE_VIA_ARCH_D_OT_LOCKED_GATEWAY",
    "SEVER_CRITICAL_VIOLATION_AT_L1",
]

TxOperatingMode = Literal[
    "LOCAL_POLLER",
    "PASSIVE_LISTENER",
    "RTSP_STREAM_PULLER",
    "OT_SESSION_INITIATOR",
]


# ---------------------------------------------------------------------------
# 1. Vision / Video / Voice Intake Models (SAM 3.1 + Muse Voice)
# ---------------------------------------------------------------------------


class DetectedZoneBox(BaseModel):
    """SAM 3.1 Mode 1 segmented security zone container."""

    model_config = ConfigDict(extra="forbid")

    zone_box_id: str
    label: str
    inferred_purdue_level: str
    bbox_xyxy: list[float] = Field(..., min_length=4, max_length=4)


class DetectedDiagramNode(BaseModel):
    """SAM 3.1 Mode 1 + Muse Spark OCR extracted asset icon on a network diagram."""

    model_config = ConfigDict(extra="forbid")

    node_id: str
    semantic_class: str
    extracted_label: str
    extracted_ip: str | None = None
    parent_zone_box_id: str | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    bbox_xyxy: list[float] = Field(..., min_length=4, max_length=4)


class DetectedDiagramConduit(BaseModel):
    """SAM 3.1 Mode 1 extracted directional conduit line between diagram nodes."""

    model_config = ConfigDict(extra="forbid")

    from_node_id: str
    to_node_id: str
    protocol_annotation: str | None = None


class DiagramSegmentationResult(BaseModel):
    """Complete SAM 3.1 Mode 1 network diagram / whiteboard extraction output."""

    model_config = ConfigDict(extra="forbid")

    source_image_type: Literal[
        "CAD_VISIO_DIAGRAM",
        "HANDDRAWN_WHITEBOARD_SKETCH",
        "SCANNED_PAPER_BLUEPRINT",
        "AUTOCAD_DARK_PID",
    ]
    detected_zones: list[DetectedZoneBox] = Field(default_factory=list)
    detected_diagram_nodes: list[DetectedDiagramNode] = Field(default_factory=list)
    detected_diagram_conduits: list[DetectedDiagramConduit] = Field(default_factory=list)


class CabinetDetection(BaseModel):
    """Single SAM 3.1 Mode 2 physical rack/cabinet segmentation box."""

    model_config = ConfigDict(extra="forbid")

    detection_id: str
    semantic_class: str
    label: str
    # SAM 3.1's API returns boxes without scores, so measured detections leave this unset
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    bbox_xyxy: list[float] = Field(..., min_length=4, max_length=4)
    hud_color_hex: str


class CabinetVisionInspection(BaseModel):
    """Complete SAM 3.1 Mode 2 physical rack, DIN-rail, and switch port inspection."""

    model_config = ConfigDict(extra="forbid")

    enclosure_type: Literal[
        "CONTROL_ROOM_19INCH_RACK",
        "INDUSTRIAL_DIN_RAIL_CABINET",
        "HYBRID_WALL_ENCLOSURE",
    ]
    has_19inch_rack: bool
    empty_1u_slots: int = Field(..., ge=0)
    din_rail_available_mm: float = Field(..., ge=0.0)
    occupied_rj45_ports: int = Field(..., ge=0)
    free_rj45_ports: int = Field(..., ge=0)
    free_sfp_ports: int = Field(..., ge=0)
    compatible_mounting_types: list[MountingOption] = Field(default_factory=list)
    compatible_archetype_ids: list[ArchetypeId] = Field(default_factory=list)
    requires_aggregation_switch: bool
    detections: list[CabinetDetection] = Field(default_factory=list)
    source_image: str | None = None
    image_width: int | None = None
    image_height: int | None = None
    # live_sam31 | recorded_sam31 (replayed SAM output) | reference_profile (not measured)
    measurement_source: str = "reference_profile"
    measurement_notes: list[str] = Field(default_factory=list)


class VideoTrackObject(BaseModel):
    """Persistent multi-frame object tracked by SAM 3.1 Mode 3 across walkthrough video."""

    model_config = ConfigDict(extra="forbid")

    object_track_id: str
    track_class: str
    label: str
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    visible_frame_count: int = Field(..., ge=0)
    first_seen_sec: float = Field(default=0.0, ge=0.0)
    last_seen_sec: float = Field(default=0.0, ge=0.0)
    world_bbox_xyxy: list[float] = Field(
        default_factory=lambda: [0.0, 0.0, 0.0, 0.0], min_length=4, max_length=4
    )
    hud_color_hex: str = "#22C55E"


class VideoWalkthroughResult(BaseModel):
    """Deduplicated physical audit result from a SAM 3.1 `.mp4` cabinet/rack walkthrough."""

    model_config = ConfigDict(extra="forbid")

    video_filename: str
    video_url: str | None = None
    fps: int = 24
    duration_sec: float = 6.0
    total_frames: int = 144
    enclosure_type: (
        Literal[
            "CONTROL_ROOM_19INCH_RACK",
            "INDUSTRIAL_DIN_RAIL_CABINET",
            "HYBRID_WALL_ENCLOSURE",
        ]
        | None
    ) = None
    verified_empty_1u_slots: int = Field(default=0, ge=0)
    verified_din_rail_mm: float = Field(default=0.0, ge=0.0)
    rogue_bypass_detected: bool = False
    security_finding_code: str | None = None
    security_finding_summary: str | None = None
    tracked_objects: list[VideoTrackObject] = Field(default_factory=list)
    frames_analyzed: int = 0
    measurement_source: str = "reference_profile"
    measurement_notes: list[str] = Field(default_factory=list)


class VoiceFieldObservation(BaseModel):
    """Structured engineering constraint extracted from a field engineer's voice note."""

    model_config = ConfigDict(extra="forbid")

    observation_id: str
    category: Literal[
        "PHYSICAL_MOUNTING",
        "ROGUE_ASSET",
        "PROTOCOL_REQUIREMENT",
        "SAFETY_CONSTRAINT",
        "GENERAL_NOTE",
    ]
    extracted_entity: str
    engineering_impact: str
    severity: Literal["INFO", "WARNING", "CRITICAL"] = "INFO"
    timestamp_offset_sec: float | None = None


class VoiceFieldNoteTranscript(BaseModel):
    """Muse Voice Transcribe output + structured OT engineering observations."""

    model_config = ConfigDict(extra="forbid")

    scenario_id: str | None = None
    audio_filename: str
    model_used: str = "muse-voice-transcribe-1.0"
    source_mode: Literal["live_meta_asr", "demo_fallback_transcript", "not_supplied"] = (
        "demo_fallback_transcript"
    )
    duration_sec: float = 14.5
    language: str = "en"
    raw_transcript: str
    structured_observations: list[VoiceFieldObservation] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# 2. Logical Switch Inventory & Deep Packet Telemetry Models
# ---------------------------------------------------------------------------


class AssetNode(BaseModel):
    """Reconciled L2/L3 endpoint across diagram, switch CLI dumps, and packet captures."""

    model_config = ConfigDict(extra="forbid")

    asset_id: str
    ip_address: str
    secondary_ips: list[str] = Field(default_factory=list)
    mac_address: str | None = None
    oui_prefix: str | None = None
    vendor: str = "Unknown"
    hostname: str | None = None
    device_category: str = "UNKNOWN"
    purdue_level: PurdueLevel = "L1"
    vlan: int | None = None
    switch_port: str | None = None
    documented_on_diagram: bool = True
    is_shadow_asset: bool = False
    is_dual_homed_bypass: bool = False
    discovery_sources: list[str] = Field(default_factory=list)


class ProtocolFlowAnalysis(BaseModel):
    """Scapy + DuckDB cross-zone protocol flow & L7 function-code telemetry."""

    model_config = ConfigDict(extra="forbid")

    flow_id: str
    src_ip: str
    dst_ip: str
    dst_port: int
    transport: Literal["TCP", "UDP", "TCP/UDP", "L2_MULTICAST"] = "TCP"
    protocol: str
    direction: str
    function_codes_observed: list[str] = Field(default_factory=list)
    function_detail: str = ""
    has_write_operations: bool = False
    uses_dynamic_ephemeral_ports: bool = False
    lateral_movement_suspected: bool = False
    packet_count: int = 0
    bytes_transferred: int = 0
    p95_mbps: float = 0.0
    peak_mbps: float = 0.0
    preliminary_tier: CutoverTier = "AMBER"


class TrafficConduit(BaseModel):
    """Aggregated cross-zone traffic conduit with 1.25x bandwidth headroom sizing."""

    model_config = ConfigDict(extra="forbid")

    conduit_id: str
    name: str
    source_zone: str
    destination_zone: str
    vlans_observed: list[int] = Field(default_factory=list)
    requires_8021q_vlan_trunk: bool = False
    p95_mbps: float = 0.0
    peak_mbps: float
    sized_mbps_with_headroom: float
    flows: list[ProtocolFlowAnalysis] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# 3. Master Architect Output Models (`ConduitArchitecturePlan`)
#    Matches `muse_spark_architect_prompt.md` Section 2 & Few-Shot JSON 100%
# ---------------------------------------------------------------------------


class ExecutiveSummary(BaseModel):
    """C-suite & OT Engineering executive summary of the hardware isolation design."""

    model_config = ConfigDict(extra="forbid")

    facility_name: str
    current_security_posture_sl: Literal["SL-0", "SL-1", "SL-2"]
    target_security_posture_sl: Literal["SL-3", "SL-4"]
    total_discovered_assets: int
    undocumented_shadow_asset_count: int
    critical_violations_severed: int
    recommended_diode_total_units: int
    estimated_hardware_bom_usd: float
    headline_synthesis: str


class ReconciledZone(BaseModel):
    """Purdue security zone reconciled from switch VLANs, PCAPs, and diagrams."""

    model_config = ConfigDict(extra="forbid")

    zone_id: str
    zone_name: str
    purdue_level: PurdueLevel
    target_sl: Literal["SL-2", "SL-3", "SL-4"]
    vlans: list[int]
    asset_count: int


class ShadowAssetAnomaly(BaseModel):
    """Undocumented shadow OT device, dual-homed server, or rogue cellular bypass."""

    model_config = ConfigDict(extra="forbid")

    anomaly_id: str
    anomaly_type: Literal[
        "UNDOCUMENTED_SHADOW_ASSET",
        "DUAL_HOMED_BYPASS_ASSET",
        "ROGUE_IT_BRIDGE",
    ]
    severity: Literal["MEDIUM", "HIGH", "CRITICAL"]
    ip_addresses: list[str]
    mac_address: str
    vendor: str
    evidence_source: str
    remediation_action: str


class ConduitSizingRecommendation(BaseModel):
    """Deterministic hardware diode archetype & physical mounting recommendation."""

    model_config = ConfigDict(extra="forbid")

    conduit_id: str
    source_zone_id: str
    destination_zone_id: str
    observed_peak_mbps: float
    sized_capacity_with_headroom_mbps: float
    recommended_archetype_id: ArchetypeId
    quantity: int = Field(..., ge=1)
    mounting_selection: MountingOption
    cabinet_fit_verified: bool
    cabinet_fit_notes: str
    sizing_justification: str


class BomLineItem(BaseModel):
    """Vendor-neutral Bill of Materials (BoM) line item."""

    model_config = ConfigDict(extra="forbid")

    line_item: int
    item_code: str
    description: str
    quantity: int
    estimated_unit_cost_usd: float
    estimated_extended_cost_usd: float


class ProtocolCutoverRow(BaseModel):
    """Green / Amber / Red protocol cutover classification and remediation."""

    model_config = ConfigDict(extra="forbid")

    flow_id: str
    observed_src_ip: str
    observed_dst_ip: str
    port: int
    protocol: str
    observed_initiator: Literal["OT_TO_IT", "IT_TO_OT"]
    function_code_detail: str
    cutover_tier: CutoverTier
    cutover_action_type: CutoverActionType
    engineering_prescription: str


class TxRxProxyRule(BaseModel):
    """Day-one TX Inner Proxy to RX Outer Proxy translation rule."""

    model_config = ConfigDict(extra="forbid")

    proxy_rule_id: str
    assigned_conduit_id: str
    assigned_archetype_id: str
    vlan_id: int
    ot_source_ip: str
    ot_source_port: int
    target_protocol: str
    tx_inner_vip: str
    tx_operating_mode: TxOperatingMode
    polling_interval_ms: int | None = None
    rx_outer_vip: str
    rx_exposed_port: int
    it_consumer_ip: str
    it_repointing_instruction: str


class ModalDigitalTwinVerificationPlan(BaseModel):
    """Pre-cutover verification plan executed inside the Modal Digital Twin sandbox."""

    model_config = ConfigDict(extra="forbid")

    legitimate_flows_to_replay: list[str]
    adversarial_exploits_to_inject: list[str]
    pass_criteria: str


class ComplianceMappingRow(BaseModel):
    """Regulatory clause mapping across IEC 62443, NIST 800-82, NERC CIP, and India CEA."""

    model_config = ConfigDict(extra="forbid")

    framework: str
    clause_id: str
    pre_cutover_status: Literal["NON_COMPLIANT", "PARTIAL_SL2_ONLY"]
    post_cutover_status: Literal["COMPLIANT_SL3", "COMPLIANT_SL4", "COMPLIANT"]
    auditor_evidence: str


class ConduitArchitecturePlan(BaseModel):
    """Master OT Hardware Data Diode Isolation & Cutover Architecture Plan."""

    model_config = ConfigDict(extra="forbid")

    executive_summary: ExecutiveSummary
    reconciled_zones: list[ReconciledZone]
    shadow_assets_and_bypasses: list[ShadowAssetAnomaly]
    conduit_sizing_recommendations: list[ConduitSizingRecommendation]
    bill_of_materials: list[BomLineItem]
    protocol_cutover_matrix: list[ProtocolCutoverRow]
    tx_rx_proxy_translation_table: list[TxRxProxyRule]
    modal_digital_twin_verification_plan: ModalDigitalTwinVerificationPlan
    compliance_mapping: list[ComplianceMappingRow]


# ---------------------------------------------------------------------------
# 4. Modal Digital Twin Execution Result Models
# ---------------------------------------------------------------------------


class ModalTwinReplayFlowResult(BaseModel):
    """Telemetry continuity result for a single legitimate flow across TX -> RX."""

    model_config = ConfigDict(extra="forbid")

    flow_description: str
    protocol: str
    tx_packets_sent: int
    rx_packets_delivered: int
    delivery_rate_pct: float
    median_proxy_latency_ms: float
    passed: bool


class ModalTwinExploitResult(BaseModel):
    """Adversarial attack injection result against the one-way hardware diode barrier."""

    model_config = ConfigDict(extra="forbid")

    attack_name: str
    cve_or_technique: str
    target_ip: str
    target_port: int
    packets_injected_from_it: int
    packets_reaching_ot: int
    blocked_at_layer: str = "Layer 1/2 Physical Unidirectional Barrier"
    physically_blocked: bool


class ModalTwinVerificationResult(BaseModel):
    """Full Layer-1/2 Socket Digital Twin verification report."""

    model_config = ConfigDict(extra="forbid")

    sandbox_id: str
    execution_backend: Literal["modal_cloud_sandbox", "local_socket_twin_fallback"]
    enforced_archetype_id: str
    legitimate_telemetry_results: list[ModalTwinReplayFlowResult]
    adversarial_exploit_results: list[ModalTwinExploitResult]
    telemetry_continuity_pct: float
    inbound_exploit_block_rate_pct: float
    overall_verdict: Literal[
        "VERIFIED_ZERO_DOWNTIME_LOCKDOWN",
        "FAILED_CONTINUITY",
        "FAILED_ISOLATION",
    ]
    execution_duration_ms: float
    sandbox_stdout_log: str = ""


# ---------------------------------------------------------------------------
# 5. LangGraph Multi-Agent Orchestration State (`ConduitGraphState`)
# ---------------------------------------------------------------------------


class ConduitGraphState(TypedDict, total=False):
    """Shared state dictionary passed across all LangGraph discovery & sizing nodes."""

    # Inputs & routing configuration
    scenario_id: str
    facility_name: str
    inference_mode: InferenceMode
    diagram_image_path: str | None
    cabinet_image_paths: list[str]
    video_walkthrough_path: str | None
    pcap_path: str | None
    firewall_csv_path: str | None
    switch_dump_path: str | None
    asset_inventory_csv_path: str | None
    voice_audio_bytes: bytes | None
    voice_audio_filename: str | None

    # Intermediate multi-modal & telemetry agent outputs
    diagram_segmentation: DiagramSegmentationResult | None
    cabinet_inspections: list[CabinetVisionInspection]
    video_walkthrough_result: VideoWalkthroughResult | None
    voice_transcript: VoiceFieldNoteTranscript | None
    discovered_assets: list[AssetNode]
    protocol_flows: list[ProtocolFlowAnalysis]
    traffic_conduits: list[TrafficConduit]

    # Master Architect & Digital Twin outputs
    architecture_plan: ConduitArchitecturePlan | None
    twin_verification: ModalTwinVerificationResult | None
    generated_rack_card_url: str | None

    # Accumulating event log & error trace across parallel nodes
    agent_events: Annotated[list[dict[str, Any]], operator.add]
    errors: Annotated[list[str], operator.add]
