"""Re-download every real ICS capture from its upstream source and check it matches the manifest.

Each entry in `data/real_ics_captures/REAL_PCAP_MANIFEST.json` names its `source_url`, licence
and SHA-256. This script fetches each URL and compares the hash with the file in the repo, so
anyone can confirm the captures are unmodified copies of the licensed originals.

Usage:
    python data/scripts/verify_real_ics_captures.py
"""

from __future__ import annotations

import hashlib
import json
import sys
import urllib.request
from pathlib import Path

CAPTURES = Path(__file__).resolve().parent.parent / "real_ics_captures"
USER_AGENT = "ConduitAI-capture-check/0.1 (https://github.com/lopesrohan1988/conduit-ai)"


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    manifest = json.loads((CAPTURES / "REAL_PCAP_MANIFEST.json").read_text(encoding="utf-8"))
    failures = 0
    for c in manifest["captures"]:
        local = _sha256((CAPTURES / c["filename"]).read_bytes())
        req = urllib.request.Request(c["source_url"], headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=60) as resp:
            upstream = _sha256(resp.read())
        ok = local == upstream == c["sha256"]
        failures += not ok
        print(f"{'OK  ' if ok else 'FAIL'} {c['filename']:48} {c['license']:14} {c['source_url']}")
    print(f"\n{len(manifest['captures']) - failures} of {len(manifest['captures'])} captures match their upstream source")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
