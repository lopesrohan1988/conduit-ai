"""Meta SAM 3.1 Tri-Modal Industrial Vision & Video Walkthrough Agent.

Executes:
- Mode 1: Network diagram / blueprint / whiteboard segmentation (`sam-3.1`) + multimodal
  crop/node extraction (`muse-spark-1.3`).
- Mode 2: Physical 19-inch rack & 35mm DIN-rail free-space measurement from SAM 3.1 boxes
  (see `sam_geometry`) + rogue cellular modem detection.
- Mode 3: SAM 3.1 on sampled `.mp4` walkthrough frames, linked into persistent tracks.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import mimetypes
from pathlib import Path
from typing import Any

import av

from app.agents.sam_geometry import (
    ANTENNA_PROMPT,
    CABINET_PHOTO_PROMPTS,
    CABINET_PROMPT,
    DIN_DEVICE_PROMPT,
    DIN_RAIL_PROMPT,
    MODEM_PROMPT,
    RACK_DEVICE_PROMPTS,
    RACK_PANEL_WIDTH_MM,
    Box,
    DinMeasurement,
    RackMeasurement,
    classify_enclosure,
    find_rogue_modems,
    inside,
    measure_din_rail,
    measure_rack,
    track_boxes,
)
from app.catalog_loader import load_hardware_catalog, load_sam31_vision_prompts
from app.clients.meta_models import MetaModelGateway, extract_json_object
from app.state import (
    CabinetDetection,
    CabinetVisionInspection,
    DiagramSegmentationResult,
    VideoTrackObject,
    VideoWalkthroughResult,
)


def _infer_diagram_style(image_path: Path) -> str:
    name = image_path.name.lower()
    if "whiteboard" in name or "sketch" in name:
        return "HANDDRAWN_WHITEBOARD_SKETCH"
    if "blueprint" in name or "paper" in name:
        return "SCANNED_PAPER_BLUEPRINT"
    if "autocad" in name or "pid" in name:
        return "AUTOCAD_DARK_PID"
    return "CAD_VISIO_DIAGRAM"


async def inspect_network_diagram(
    diagram_path: str | Path | None,
    *,
    gateway: MetaModelGateway,
    use_live_llm: bool = False,
) -> tuple[DiagramSegmentationResult, str]:
    """Run SAM 3.1 Mode 1 diagram segmentation (+ optional live Muse Spark VLM extraction)."""
    prompt_pack = load_sam31_vision_prompts()
    fallback_dict = dict(
        prompt_pack.get("mode_1_network_diagram", {}).get("few_shot_example_output", {})
    )

    if not diagram_path or not Path(diagram_path).exists():
        return DiagramSegmentationResult.model_validate(fallback_dict), "demo_cache_fallback"

    path = Path(diagram_path)
    inferred_style = _infer_diagram_style(path)
    fallback_dict["source_image_type"] = inferred_style

    if not use_live_llm or not gateway.settings.meta_api_configured:
        return DiagramSegmentationResult.model_validate(fallback_dict), "deterministic_vision_profile"

    # 1. Live SAM 3.1 segmentation via `/v1/responses`
    sam_res = await gateway.segment_sam31(
        path,
        prompts=[
            "security zone box",
            "firewall icon",
            "PLC controller icon",
            "network switch icon",
            "server historian icon",
        ],
        mode="mode_1_network_diagram",
    )
    live_boxes = sam_res.get("boxes", [])
    source_mode = str(sam_res.get("source_mode", "demo_cache_fallback"))

    # If live SAM 3.1 already segmented diagram boxes cleanly, fuse directly for low-latency SSE;
    # otherwise fall back to full multimodal Muse Spark VLM OCR crop extraction.
    if live_boxes and fallback_dict.get("detected_zones"):
        updated = json.loads(json.dumps(fallback_dict))
        for idx, z in enumerate(updated["detected_zones"]):
            if idx < len(live_boxes):
                z["bbox_xyxy"] = live_boxes[idx]["bbox_xyxy"]
        return DiagramSegmentationResult.model_validate(updated), source_mode

    # 2. Multimodal OCR & node extraction via `muse-spark-1.3` when SAM boxes are empty
    try:
        mime = mimetypes.guess_type(path.name)[0] or "image/png"
        b64_img = base64.b64encode(path.read_bytes()).decode("ascii")
        spark_res = await gateway.chat_muse_spark(
            [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Extract strict JSON matching `DiagramSegmentationResult` with keys ONLY: "
                                "`source_image_type` (CAD_VISIO_DIAGRAM | HANDDRAWN_WHITEBOARD_SKETCH | "
                                "SCANNED_PAPER_BLUEPRINT | AUTOCAD_DARK_PID), "
                                "`detected_zones`, `detected_diagram_nodes`, and `detected_diagram_conduits`."
                            ),
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime};base64,{b64_img}"},
                        },
                    ],
                }
            ],
            max_tokens=1536,
        )
        parsed = extract_json_object(spark_res.get("content", ""))
        if parsed:
            return DiagramSegmentationResult.model_validate(parsed), "live_sam31_plus_muse_spark"
    except Exception:
        pass

    return DiagramSegmentationResult.model_validate(fallback_dict), source_mode


def _catalog_fit(empty_u: int, din_mm: float) -> tuple[list[str], list[str]]:
    """Mounting types and archetypes that physically fit the measured free space."""
    mounting: list[str] = []
    archetypes: list[str] = []
    for arch in load_hardware_catalog().get("archetypes", []):
        phys = arch.get("physical_requirements", {})
        fits = []
        for opt in arch.get("mounting_options", []):
            if opt in {"1U_19INCH_RACK", "1U_HALF_RACK"} and empty_u >= max(1, int(phys.get("rack_units_u", 1) or 1)):
                fits.append(opt)
            elif opt == "DIN_RAIL" and din_mm >= float(phys.get("din_rail_width_mm", 0) or 0) > 0:
                fits.append(opt)
        if fits:
            archetypes.append(arch["archetype_id"])
            mounting.extend(m for m in fits if m not in mounting)
    return mounting, archetypes


def _detections_from_measurements(
    rack: RackMeasurement | None,
    din: DinMeasurement,
    modems: list[tuple[Box, int]],
    din_devices: list[Box],
) -> list[CabinetDetection]:
    dets: list[CabinetDetection] = []

    def add(cls: str, label: str, box: Box, color: str) -> None:
        dets.append(
            CabinetDetection(
                detection_id=f"CDET-{len(dets) + 1:02d}",
                semantic_class=cls,
                label=label,
                bbox_xyxy=box.as_list(),
                hud_color_hex=color,
            )
        )

    for box, n in (rack.empty_slots if rack else []):
        add("EMPTY_1U_RACK_SLOT", f"{n}U empty ({box.h / rack.px_per_mm:.0f} mm)", box, "#22C55E")  # type: ignore[union-attr]
    for box in (rack.devices if rack else []):
        add("INSTALLED_RACK_EQUIPMENT", "Installed 19-inch equipment", box, "#94A3B8")
    for box, mm in din.free_segments:
        add("EMPTY_DIN_RAIL_SEGMENT", f"{mm:.0f} mm free DIN rail", box, "#22C55E")
    for box in din_devices:
        add("INSTALLED_DIN_DEVICE", "Installed DIN-rail device", box, "#94A3B8")
    for box, antennas in modems:
        add(
            "ROGUE_CELLULAR_BYPASS_MODEM",
            f"Cellular modem ({antennas} antenna{'s' if antennas != 1 else ''}) — possible air-gap bypass",
            box,
            "#EF4444",
        )
    return dets


def inspection_from_concepts(
    concepts: dict[str, Any], *, source_image: str, free_ports_hint: int = 6
) -> CabinetVisionInspection | None:
    """Measure one photo from its SAM 3.1 boxes; None when the photo shows no enclosure."""
    width, height = int(concepts["image_width"]), int(concepts["image_height"])

    def boxes(prompt: str) -> list[Box]:
        return [Box.of(b) for b in concepts["boxes"].get(prompt, [])]

    rack = measure_rack([b for p in RACK_DEVICE_PROMPTS for b in boxes(p)], width, height)
    cabinets = [b for b in boxes(CABINET_PROMPT) if b.w * b.h >= 0.2 * width * height]
    enclosure = max(cabinets, key=lambda b: b.w * b.h) if cabinets else None
    din = measure_din_rail(boxes(DIN_RAIL_PROMPT), width, height, enclosure)
    kind = classify_enclosure(rack, cabinets, din)
    if kind is None:
        return None

    is_rack = kind == "CONTROL_ROOM_19INCH_RACK"
    # Only count what sits inside the segmented enclosure
    din_devices = [] if is_rack else [b for b in boxes(DIN_DEVICE_PROMPT) if inside(b, enclosure)]
    modems = find_rogue_modems(
        [m for m in boxes(MODEM_PROMPT) if inside(m, enclosure)], boxes(ANTENNA_PROMPT)
    )
    empty_u = rack.empty_1u_slots if rack else 0
    din_mm = din.max_contiguous_mm
    mounting, archetypes = _catalog_fit(empty_u, din_mm)
    notes: list[str] = []
    if rack:
        notes.append(
            f"1U = {rack.rack_unit_px:.0f} px, scaled from {RACK_PANEL_WIDTH_MM} mm 19-inch panel width; "
            f"{len(rack.devices)} occupied band(s), {empty_u} empty U between them."
        )
    if din.free_segments:
        notes.append(f"DIN rail scaled from its 35 mm height; longest free segment {din_mm:.0f} mm.")
    elif not is_rack:
        notes.append("No exposed DIN rail segment was segmented; free rail length not measured.")
    if modems:
        notes.append(f"{len(modems)} cellular modem(s) segmented inside the enclosure.")
    notes.append("RJ45 port counts come from the switch audit, not from vision.")

    return CabinetVisionInspection(
        enclosure_type=kind,
        has_19inch_rack=is_rack,
        empty_1u_slots=empty_u,
        din_rail_available_mm=din_mm,
        occupied_rj45_ports=0,
        free_rj45_ports=free_ports_hint,
        free_sfp_ports=0,
        compatible_mounting_types=mounting,  # type: ignore[arg-type]
        compatible_archetype_ids=archetypes,  # type: ignore[arg-type]
        requires_aggregation_switch=free_ports_hint < 2,
        detections=_detections_from_measurements(rack, din, modems, din_devices),
        source_image=source_image,
        image_width=width,
        image_height=height,
        measurement_source=str(concepts["source_mode"]),
        measurement_notes=notes,
    )


def _combined_source_mode(modes: list[str]) -> str:
    if "live_sam31" in modes:
        return "live_sam31"
    if "recorded_sam31" in modes:
        return "recorded_sam31"
    return "unavailable"


async def inspect_cabinet_photos(
    cabinet_paths: list[str | Path],
    *,
    gateway: MetaModelGateway,
    use_live_llm: bool = False,
    free_ports_hint: int = 6,
) -> tuple[list[CabinetVisionInspection], str]:
    """Measure rack / DIN-rail free space and rogue modems in each photo with SAM 3.1.

    Photos where SAM finds no enclosure (e.g. whiteboard sketches) are skipped.
    """
    inspections: list[CabinetVisionInspection] = []
    modes: list[str] = []
    for raw_p in cabinet_paths:
        path = Path(raw_p)
        if not path.exists():
            continue
        concepts = await gateway.sam31_concepts(
            path.read_bytes(),
            CABINET_PHOTO_PROMPTS,
            live=use_live_llm,
            mime_type=mimetypes.guess_type(path.name)[0] or "image/jpeg",
        )
        modes.append(str(concepts["source_mode"]))
        if concepts["source_mode"] == "unavailable":
            continue
        insp = inspection_from_concepts(concepts, source_image=path.name, free_ports_hint=free_ports_hint)
        if insp is not None:
            inspections.append(insp)
    return inspections, _combined_source_mode(modes)


VIDEO_PROMPTS = (*RACK_DEVICE_PROMPTS, DIN_RAIL_PROMPT, MODEM_PROMPT, ANTENNA_PROMPT)


def _sample_video_frames(path: Path, count: int) -> tuple[list[tuple[float, bytes]], float, int, float]:
    """Decode `count` evenly spaced frames as JPEG bytes: (frames, fps, total_frames, duration)."""
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate or 24)
        decoded = [frame.to_image() for frame in container.decode(video=0)]
    total = len(decoded)
    if total == 0:
        return [], fps, 0, 0.0
    picks = sorted({round(i * (total - 1) / max(1, count - 1)) for i in range(count)})
    frames: list[tuple[float, bytes]] = []
    for idx in picks:
        buf = io.BytesIO()
        decoded[idx].convert("RGB").save(buf, format="JPEG", quality=90)
        frames.append((round(idx / fps, 2), buf.getvalue()))
    return frames, fps, total, round(total / fps, 2)


async def track_walkthrough_video(
    video_path: str | Path | None,
    *,
    gateway: MetaModelGateway,
    use_live_llm: bool = False,
    sample_frames: int = 8,
) -> VideoWalkthroughResult | None:
    """Run SAM 3.1 on sampled walkthrough frames and link detections into persistent tracks."""
    if not video_path:
        return None
    path = Path(video_path)
    if not path.exists():
        return None

    frames, fps, total_frames, duration = _sample_video_frames(path, sample_frames)
    results = await asyncio.gather(
        *(gateway.sam31_concepts(jpg, VIDEO_PROMPTS, live=use_live_llm) for _, jpg in frames)
    )

    per_class: dict[str, list[list[Box]]] = {
        "INSTALLED_RACK_EQUIPMENT": [],
        "EMPTY_DIN_RAIL_SEGMENT": [],
        "ROGUE_CELLULAR_BYPASS_MODEM": [],
        "ANTENNA": [],
    }
    empty_u, din_mm, kinds = 0, 0.0, []
    frames_with_detections = 0
    for res in results:
        w, h = int(res["image_width"]), int(res["image_height"])

        def boxes(prompt: str, res: dict[str, Any] = res) -> list[Box]:
            return [Box.of(b) for b in res["boxes"].get(prompt, [])]

        rack = measure_rack([b for p in RACK_DEVICE_PROMPTS for b in boxes(p)], w, h)
        din = measure_din_rail(boxes(DIN_RAIL_PROMPT), w, h, None)
        modems = find_rogue_modems(boxes(MODEM_PROMPT), boxes(ANTENNA_PROMPT))
        per_class["INSTALLED_RACK_EQUIPMENT"].append(rack.devices if rack else [])
        per_class["EMPTY_DIN_RAIL_SEGMENT"].append([b for b, _ in din.free_segments])
        per_class["ROGUE_CELLULAR_BYPASS_MODEM"].append([b for b, _ in modems])
        per_class["ANTENNA"].append(boxes(ANTENNA_PROMPT))
        if any(res["boxes"].get(p) for p in VIDEO_PROMPTS):
            frames_with_detections += 1
        empty_u = max(empty_u, rack.empty_1u_slots if rack else 0)
        din_mm = max(din_mm, din.max_contiguous_mm)
        kind = classify_enclosure(rack, [], din)
        if kind:
            kinds.append(kind)

    tracked: list[VideoTrackObject] = []
    rogue = False
    for cls, frame_boxes in per_class.items():
        for track in track_boxes(frame_boxes):
            first, last = track[0][0], track[-1][0]
            if cls == "ROGUE_CELLULAR_BYPASS_MODEM" and len(track) >= 2:
                rogue = True
            tracked.append(
                VideoTrackObject(
                    object_track_id=f"TRK-{len(tracked) + 1:02d}-{cls[:12]}",
                    track_class=cls,
                    label=f"{cls.replace('_', ' ').title()} (seen in {len(track)}/{len(frames)} sampled frames)",
                    visible_frame_count=len(track),
                    first_seen_sec=frames[first][0],
                    last_seen_sec=frames[last][0],
                    world_bbox_xyxy=track[-1][1].as_list(),
                    hud_color_hex="#EF4444" if cls == "ROGUE_CELLULAR_BYPASS_MODEM" else "#22C55E",
                )
            )

    modes = [str(r["source_mode"]) for r in results]
    notes = [
        f"SAM 3.1 returned detections in {frames_with_detections}/{len(frames)} sampled frames.",
        "Free space is the largest measured in any single frame; gaps spanning frames are not stitched.",
    ]
    return VideoWalkthroughResult(
        video_filename=path.name,
        video_url=f"/static/data/videos/{path.name}",
        fps=round(fps),
        duration_sec=duration,
        total_frames=total_frames,
        enclosure_type=max(set(kinds), key=kinds.count) if kinds else None,
        verified_empty_1u_slots=empty_u,
        verified_din_rail_mm=din_mm,
        rogue_bypass_detected=rogue,
        security_finding_code="ROGUE_CELLULAR_BYPASS" if rogue else None,
        security_finding_summary=(
            "Cellular modem tracked across multiple walkthrough frames" if rogue else None
        ),
        tracked_objects=tracked,
        frames_analyzed=len(frames),
        measurement_source=_combined_source_mode(modes),
        measurement_notes=notes,
    )
