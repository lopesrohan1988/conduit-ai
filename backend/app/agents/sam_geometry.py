"""Turn SAM 3.1 concept boxes into physical measurements.

SAM 3.1 finds objects but does not measure them. Every number here is derived from box geometry
and a physical standard visible in the same image, so no per-site constants are involved:

- 19-inch rack gear: EIA-310 front panels are 482.6 mm wide and one rack unit is 44.45 mm tall.
- DIN rail: EN 60715 top-hat rail is 35 mm tall.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from statistics import median
from typing import Any, Literal

RACK_PANEL_WIDTH_MM = 482.6
RACK_UNIT_MM = 44.45
DIN_RAIL_HEIGHT_MM = 35.0

# Concept prompts sent to SAM 3.1, one call each (SAM takes a single noun phrase per prompt)
RACK_DEVICE_PROMPTS = ("patch panel", "rack server", "network switch", "Cisco switch")
CABINET_PROMPT = "electrical cabinet"
DIN_DEVICE_PROMPT = "device"
DIN_RAIL_PROMPT = "steel bar"  # exposed (free) DIN rail segments
MODEM_PROMPT = "cellular modem"
ANTENNA_PROMPT = "antenna"
CABINET_PHOTO_PROMPTS = (
    *RACK_DEVICE_PROMPTS,
    CABINET_PROMPT,
    DIN_DEVICE_PROMPT,
    DIN_RAIL_PROMPT,
    MODEM_PROMPT,
    ANTENNA_PROMPT,
)

# A gap must be at least 0.65 U tall before it counts as a usable slot
_SLOT_ROUNDING = 0.35

EnclosureType = Literal["CONTROL_ROOM_19INCH_RACK", "INDUSTRIAL_DIN_RAIL_CABINET"]


@dataclass(frozen=True)
class Box:
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def w(self) -> float:
        return max(0.0, self.x2 - self.x1)

    @property
    def h(self) -> float:
        return max(0.0, self.y2 - self.y1)

    @property
    def cx(self) -> float:
        return (self.x1 + self.x2) / 2

    @property
    def cy(self) -> float:
        return (self.y1 + self.y2) / 2

    def as_list(self) -> list[float]:
        return [round(self.x1, 1), round(self.y1, 1), round(self.x2, 1), round(self.y2, 1)]

    @classmethod
    def of(cls, raw: dict[str, Any] | list[float]) -> Box:
        xyxy = raw["bbox_xyxy"] if isinstance(raw, dict) else raw
        return cls(*(float(v) for v in xyxy[:4]))


def iou(a: Box, b: Box) -> float:
    ix = max(0.0, min(a.x2, b.x2) - max(a.x1, b.x1))
    iy = max(0.0, min(a.y2, b.y2) - max(a.y1, b.y1))
    inter = ix * iy
    union = a.w * a.h + b.w * b.h - inter
    return inter / union if union > 0 else 0.0


@dataclass
class RackMeasurement:
    devices: list[Box]
    px_per_mm: float
    rack_unit_px: float
    empty_slots: list[tuple[Box, int]]

    @property
    def empty_1u_slots(self) -> int:
        return sum(n for _, n in self.empty_slots)


def measure_rack(device_boxes: list[Box], img_w: int, img_h: int) -> RackMeasurement | None:
    """Count empty rack units in the gaps between full-width 19-inch devices."""
    wide = [b for b in device_boxes if b.w >= 0.35 * img_w and b.w >= 1.5 * b.h]
    if not wide:
        return None
    # Gear mounted flush with the rails shows the true 19-inch width; deeper chassis that protrude
    # toward the camera look wider, so scale from the narrowest full-width panel
    ref_w = min(b.w for b in wide if b.w >= 0.8 * median(x.w for x in wide))
    devices = [b for b in wide if b.w >= 0.8 * ref_w]
    px_per_mm = ref_w / RACK_PANEL_WIDTH_MM
    unit_px = RACK_UNIT_MM * px_per_mm

    # Merge overlapping detections of the same gear into vertical occupied intervals
    merged: list[Box] = []
    for b in sorted(devices, key=lambda d: d.y1):
        if merged and b.y1 <= merged[-1].y2 + 0.25 * unit_px:
            last = merged[-1]
            merged[-1] = Box(min(last.x1, b.x1), last.y1, max(last.x2, b.x2), max(last.y2, b.y2))
        else:
            merged.append(b)

    slots: list[tuple[Box, int]] = []
    for upper, lower in zip(merged, merged[1:]):
        gap = lower.y1 - upper.y2
        n = math.floor(gap / unit_px + _SLOT_ROUNDING)
        if n > 0:
            slots.append((Box(min(upper.x1, lower.x1), upper.y2, max(upper.x2, lower.x2), lower.y1), n))
    return RackMeasurement(devices=merged, px_per_mm=px_per_mm, rack_unit_px=unit_px, empty_slots=slots)


@dataclass
class DinMeasurement:
    free_segments: list[tuple[Box, float]] = field(default_factory=list)

    @property
    def max_contiguous_mm(self) -> float:
        return max((mm for _, mm in self.free_segments), default=0.0)


def measure_din_rail(rail_boxes: list[Box], img_w: int, img_h: int, enclosure: Box | None) -> DinMeasurement:
    """Length of each exposed rail segment, scaled by the rail's own 35 mm height."""
    out = DinMeasurement()
    for b in rail_boxes:
        if not (b.w >= 4 * b.h and 0.012 * img_h <= b.h <= 0.08 * img_h and b.w >= 0.06 * img_w):
            continue
        if not inside(b, enclosure):
            continue
        mm = b.w / (b.h / DIN_RAIL_HEIGHT_MM)
        out.free_segments.append((b, round(mm, 1)))
    return out


def find_rogue_modems(modem_boxes: list[Box], antenna_boxes: list[Box]) -> list[tuple[Box, int]]:
    """Cellular modems, each with the number of antennas mounted on or just above it."""
    found: list[tuple[Box, int]] = []
    for m in modem_boxes:
        near = [
            a
            for a in antenna_boxes
            if m.x1 - 0.25 * m.w <= a.cx <= m.x2 + 0.25 * m.w and a.y1 <= m.y2 and a.y2 >= m.y1 - 0.6 * m.h
        ]
        found.append((m, len(near)))
    return found


def classify_enclosure(
    rack: RackMeasurement | None, cabinet_boxes: list[Box], din: DinMeasurement
) -> EnclosureType | None:
    """Decide what the photo shows from what SAM found in it; None means not a cabinet photo.

    Loose "device" or modem boxes alone are not enough: sketches and diagrams draw those too.
    """
    if rack is not None:
        return "CONTROL_ROOM_19INCH_RACK"
    if cabinet_boxes or len(din.free_segments) >= 2:
        return "INDUSTRIAL_DIN_RAIL_CABINET"
    return None


def inside(box: Box, enclosure: Box | None) -> bool:
    return enclosure is None or (
        enclosure.x1 <= box.cx <= enclosure.x2 and enclosure.y1 <= box.cy <= enclosure.y2
    )


def track_boxes(
    frames: list[list[Box]], *, min_iou: float = 0.2
) -> list[list[tuple[int, Box]]]:
    """Greedy frame-to-frame association; each track is a list of (frame_index, box)."""
    tracks: list[list[tuple[int, Box]]] = []
    for fi, boxes in enumerate(frames):
        open_tracks = [t for t in tracks if t[-1][0] == fi - 1]
        claimed: set[int] = set()
        for b in sorted(boxes, key=lambda x: -(x.w * x.h)):
            best, best_score = None, 0.0
            for ti, t in enumerate(open_tracks):
                if ti in claimed:
                    continue
                prev = t[-1][1]
                near = math.hypot(b.cx - prev.cx, b.cy - prev.cy) <= 0.5 * max(prev.w, prev.h, b.w, b.h)
                score = iou(b, prev)
                if (score >= min_iou or near) and score >= best_score:
                    best, best_score = ti, score
            if best is None:
                tracks.append([(fi, b)])
            else:
                claimed.add(best)
                open_tracks[best].append((fi, b))
    return tracks
