"""Meta SAM 3.1 Tri-Modal Industrial Vision & Video Walkthrough Agent.

Executes:
- Mode 1: SAM 3.1 finds the boxes on the customer's network drawing and `muse-spark-1.3`
  reads each crop; the drawing is then compared with the hosts seen on the network.
- Mode 2: Physical 19-inch rack & 35mm DIN-rail free-space measurement from SAM 3.1 boxes
  (see `sam_geometry`) + rogue cellular modem detection.
- Mode 3: SAM 3.1 on sampled `.mp4` walkthrough frames, linked into persistent tracks.
"""

from __future__ import annotations

import asyncio
import io
import mimetypes
from dataclasses import replace
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
    iou,
    measure_din_rail,
    measure_rack,
    track_boxes,
)
from app.agents.switch_config_agent import SwitchAuditResult
from app.agents.telemetry_duckdb_agent import TelemetryAuditResult
from app.catalog_loader import load_hardware_catalog
from app.clients.meta_models import MetaModelGateway, region_key
from app.state import (
    CabinetDetection,
    CabinetVisionInspection,
    DetectedDiagramNode,
    DetectedZoneBox,
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


DIAGRAM_BOX_PROMPT = "rectangle box"
DIAGRAM_READ_PROMPT = (
    "Read this box cut from a network drawing. Return strict JSON only: "
    '{"name": "device or zone name as written", "hostname": "hostname or null", '
    '"ips": ["every IPv4 address written, ranges expanded"], '
    '"kind": "device | firewall | zone | legend | other"}'
)
_DRAWN_KINDS = {"device", "firewall"}


async def inspect_network_diagram(
    diagram_path: str | Path | None,
    *,
    gateway: MetaModelGateway,
    use_live_llm: bool = False,
) -> tuple[DiagramSegmentationResult, str, dict[str, Any] | None]:
    """SAM 3.1 finds the boxes drawn on the customer's diagram; Muse Spark reads each one.

    Returns the segmentation, a source mode, and the per-box reading used to compare the
    drawing with the devices actually seen on the network.
    """
    if not diagram_path or not Path(diagram_path).exists():
        return DiagramSegmentationResult(source_image_type="CAD_VISIO_DIAGRAM"), "unavailable", None

    path = Path(diagram_path)
    image_bytes = path.read_bytes()
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    sam = await gateway.sam31_concepts(image_bytes, [DIAGRAM_BOX_PROMPT], live=use_live_llm, mime_type=mime)
    boxes: list[list[float]] = []
    for b in sam["boxes"].get(DIAGRAM_BOX_PROMPT, []):
        if all(iou(Box(*b), Box(*k)) < 0.8 for k in boxes):
            boxes.append(b)
    read = await gateway.muse_spark_read_regions(image_bytes, boxes, DIAGRAM_READ_PROMPT, live=use_live_llm)

    regions: list[dict[str, Any]] = []
    for b in boxes:
        r = read["reads"].get(",".join(str(round(v)) for v in b))
        if r is None:
            continue
        ips = [str(ip).strip() for ip in (r.get("ips") or []) if str(ip).strip().count(".") == 3]
        regions.append(
            {
                "bbox": [round(v, 1) for v in b],
                "kind": str(r.get("kind") or "other").lower(),
                "name": str(r.get("name") or "")[:120],
                "hostname": (str(r["hostname"])[:80] if r.get("hostname") else None),
                "ips": ips,
            }
        )

    nodes = [
        DetectedDiagramNode(
            node_id=f"N{i:02d}",
            semantic_class=g["kind"].upper(),
            extracted_label=g["hostname"] or g["name"],
            extracted_ip=g["ips"][0] if g["ips"] else None,
            bbox_xyxy=g["bbox"],
        )
        for i, g in enumerate((g for g in regions if g["kind"] in _DRAWN_KINDS), start=1)
    ]
    zones = [
        DetectedZoneBox(zone_box_id=f"Z{i:02d}", label=g["name"], inferred_purdue_level="unclassified", bbox_xyxy=g["bbox"])
        for i, g in enumerate((g for g in regions if g["kind"] == "zone"), start=1)
    ]
    result = DiagramSegmentationResult(
        source_image_type=_infer_diagram_style(path),  # type: ignore[arg-type]
        detected_zones=zones,
        detected_diagram_nodes=nodes,
    )
    reading = {
        "source_image": path.name,
        "image_width": sam["image_width"],
        "image_height": sam["image_height"],
        "sam_source_mode": sam["source_mode"],
        "read_source_mode": read["source_mode"],
        "regions": regions,
    }
    return result, sam["source_mode"], reading


def reconcile_diagram(
    reading: dict[str, Any], switch_audit: SwitchAuditResult, telemetry_audit: TelemetryAuditResult
) -> dict[str, Any]:
    """Compare the addresses written on the drawing with the hosts seen on the network.

    Only subnets that appear on the drawing are compared, so outside addresses don't count.
    """
    drawn = {ip for g in reading["regions"] if g["kind"] in _DRAWN_KINDS for ip in g["ips"]}
    subnets = {ip.rsplit(".", 1)[0] for ip in drawn}
    by_ip = {a.ip_address: a for a in switch_audit.assets}
    seen = set(by_ip) | {ip for f in telemetry_audit.flows for ip in (f.src_ip, f.dst_ip)}
    seen = {ip for ip in seen if ip.rsplit(".", 1)[0] in subnets}

    for g in reading["regions"]:
        if g["kind"] not in _DRAWN_KINDS or not g["ips"]:
            g["status"] = "not_a_device"
        else:
            g["status"] = "seen" if any(ip in seen for ip in g["ips"]) else "not_seen"
    missing = [
        {
            "ip": ip,
            "hostname": by_ip[ip].hostname if ip in by_ip else None,
            "vendor": by_ip[ip].vendor if ip in by_ip else None,
            # Also absent from the plant's asset list, or bridging around the firewall
            "undocumented": ip in by_ip and (by_ip[ip].is_shadow_asset or by_ip[ip].is_dual_homed_bypass),
        }
        for ip in sorted(seen - drawn, key=lambda x: tuple(int(o) for o in x.split(".")))
    ]
    return {
        "drawn_devices": sum(1 for g in reading["regions"] if g["status"] != "not_a_device"),
        "drawn_seen": sum(1 for g in reading["regions"] if g["status"] == "seen"),
        "drawn_not_seen": sum(1 for g in reading["regions"] if g["status"] == "not_seen"),
        "missing_from_drawing": missing,
    }


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


RACK_GAP_PROMPT = (
    "This crop is the space between two pieces of equipment in a 19-inch rack. Is it empty rack "
    "space with nothing mounted (open rails or a plain blanking plate), or is something mounted "
    "there (patch panel, cable manager, device, shelf)? Return strict JSON only: "
    '{"empty": true or false, "seen": "what occupies the space, briefly"}'
)


def _measure_rack_from(concepts: dict[str, Any]) -> RackMeasurement | None:
    width, height = int(concepts["image_width"]), int(concepts["image_height"])
    devices = [Box.of(b) for p in RACK_DEVICE_PROMPTS for b in concepts["boxes"].get(p, [])]
    return measure_rack(devices, width, height)


def inspection_from_concepts(
    concepts: dict[str, Any],
    *,
    source_image: str,
    free_ports_hint: int = 6,
    gap_reads: dict[str, Any] | None = None,
) -> CabinetVisionInspection | None:
    """Measure one photo from its SAM 3.1 boxes; None when the photo shows no enclosure.

    With `gap_reads`, a gap between rack devices counts as empty only if Muse Spark looked at
    its crop and confirmed nothing is mounted there.
    """
    width, height = int(concepts["image_width"]), int(concepts["image_height"])

    def boxes(prompt: str) -> list[Box]:
        return [Box.of(b) for b in concepts["boxes"].get(prompt, [])]

    rack = _measure_rack_from(concepts)
    gap_note = None
    if rack is not None and gap_reads is not None:
        kept = [
            (b, n)
            for b, n in rack.empty_slots
            if (gap_reads.get(region_key((b.x1, b.y1, b.x2, b.y2))) or {}).get("empty") is True
        ]
        dropped = rack.empty_1u_slots - sum(n for _, n in kept)
        if dropped:
            seen = sorted(
                {
                    str(r.get("seen"))
                    for r in gap_reads.values()
                    if isinstance(r, dict) and r.get("empty") is not True and r.get("seen")
                }
            )
            gap_note = (
                f"{dropped} U between devices not counted: Muse Spark did not confirm it empty"
                + (f" (saw: {'; '.join(seen)[:160]})." if seen else ".")
            )
        rack = replace(rack, empty_slots=kept)
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
    if not is_rack and not modems and not any(inside(b, enclosure) for b in boxes(DIN_RAIL_PROMPT)):
        # An enclosure with no rail, rack device or modem found gives nothing to measure; reporting
        # "0 mm free" would read as a measurement (seen on real racks shot at an angle or behind a door)
        return None
    empty_u = rack.empty_1u_slots if rack else 0
    din_mm = din.max_contiguous_mm
    mounting, archetypes = _catalog_fit(empty_u, din_mm)
    notes: list[str] = []
    if rack:
        notes.append(
            f"1U = {rack.rack_unit_px:.0f} px, scaled from {RACK_PANEL_WIDTH_MM} mm 19-inch panel width; "
            f"{len(rack.devices)} occupied band(s), {empty_u} empty U between them."
        )
    if gap_note:
        notes.append(gap_note)
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
        rack = _measure_rack_from(concepts)
        gaps = [[b.x1, b.y1, b.x2, b.y2] for b, _ in (rack.empty_slots if rack else [])]
        gap_reads = (
            (await gateway.muse_spark_read_regions(path.read_bytes(), gaps, RACK_GAP_PROMPT, live=use_live_llm))["reads"]
            if gaps
            else {}
        )
        insp = inspection_from_concepts(
            concepts, source_image=path.name, free_ports_hint=free_ports_hint, gap_reads=gap_reads
        )
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
