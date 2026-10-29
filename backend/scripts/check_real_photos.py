"""Check SAM 3.1 cabinet measurement on real Wikimedia Commons photos.

The demo plants use AI-generated cabinet photos. This script downloads the real photos listed
in `data/evals/real_photo_check.json` (they are not redistributed in the repo), runs the same
cabinet inspection the pipeline uses, and compares it with the hand labels.

What it reports:
- measured: photos where an enclosure was found and free space was measured
- false free space: more empty U measured than the label allows (the dangerous error)
- false modem alarms: a cellular modem reported where none exists

Without `--live` the recorded SAM 3.1 and Muse Spark outputs are replayed.

Usage:
    cd backend
    uv run python scripts/check_real_photos.py          # replay recorded model output
    uv run python scripts/check_real_photos.py --live   # call the Meta APIs again
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import tempfile
import urllib.request
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.agents.vision_sam31_agent import inspect_cabinet_photos  # noqa: E402
from app.clients.meta_models import MetaModelGateway  # noqa: E402
from app.config import get_settings  # noqa: E402

USER_AGENT = "ConduitAI-real-photo-check/0.1 (https://github.com/lopesrohan1988/conduit-ai)"


def _download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        dest.write_bytes(resp.read())


async def main(live: bool) -> None:
    manifest = json.loads(
        (get_settings().resolved_data_dir / "evals" / "real_photo_check.json").read_text(encoding="utf-8")
    )
    gateway = MetaModelGateway()
    rows = []
    with tempfile.TemporaryDirectory() as tmp:
        for photo in manifest["photos"]:
            path = Path(tmp) / photo["file"]
            _download(photo["download_url"], path)
            insps, mode = await inspect_cabinet_photos([path], gateway=gateway, use_live_llm=live)
            rows.append((photo, insps[0] if insps else None, mode))

    measured = [(p, c) for p, c, _ in rows if c is not None]
    false_space = [
        p for p, c in measured if p["label"]["empty_u"] is not None and c.empty_1u_slots > p["label"]["empty_u"]
    ]
    false_space += [p for p, c in measured if p["label"]["enclosure"] == "no enclosure"]
    modem_alarms = [
        p for p, c in measured if any(d.semantic_class == "ROGUE_CELLULAR_BYPASS_MODEM" for d in c.detections)
    ]
    enclosures = [p for p, _, _ in rows if p["label"]["enclosure"] != "no enclosure"]

    print("| Photo | Label | Result | Licence |")
    print("|---|---|---|---|")
    for p, c, mode in rows:
        label = p["label"]["enclosure"] + (f", {p['label']['empty_u']} empty U" if p["label"]["empty_u"] is not None else "")
        if c is None:
            result = "not measured"
        elif c.has_19inch_rack:
            result = f"19-inch rack, {c.empty_1u_slots} empty U"
        else:
            result = f"DIN cabinet, {c.din_rail_available_mm:.0f} mm free rail"
        print(f"| [{p['file']}]({p['commons_page']}) | {label} | {result} ({mode}) | {p['license']}, {p['author']} |")
    print()
    print(f"Enclosure photos measured: {sum(1 for p, _ in measured if p in enclosures)} of {len(enclosures)}")
    print(f"False free-space claims: {len(false_space)}")
    print(f"False cellular-modem alarms: {len(modem_alarms)} of {len(rows)} photos")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--live", action="store_true", help="call SAM 3.1 and Muse Spark instead of replaying")
    asyncio.run(main(parser.parse_args().live))
