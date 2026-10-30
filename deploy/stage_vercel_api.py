"""Assemble the backend as one folder Vercel can deploy as a Python function.

Vercel deploys a single folder, so the backend's code goes at its root (Vercel finds `app` in
app/main.py) and data/ goes inside it. Only files git tracks are copied, so backend/.env never
leaves the machine.

Usage, from the repository root:

    python deploy/stage_vercel_api.py <empty-output-folder>
    npx vercel deploy --prod --cwd <output-folder>
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP_PREFIXES = ("backend/tests/", "backend/scripts/")


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: stage_vercel_api.py <output-folder>")
    out = Path(sys.argv[1]).resolve()
    if out.exists() and any(p.name != ".vercel" for p in out.iterdir()):
        sys.exit(f"{out} is not empty (only a .vercel link folder may be kept)")
    out.mkdir(parents=True, exist_ok=True)

    tracked = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    copied = 0
    for rel in tracked.splitlines():
        if rel.startswith(SKIP_PREFIXES) or Path(rel).name == ".env":
            continue
        if rel.startswith("backend/"):
            dest = out / rel.removeprefix("backend/")
        elif rel.startswith("data/"):
            dest = out / rel
        else:
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / rel, dest)
        copied += 1
    (out / ".vercelignore").write_text(".venv\n__pycache__\n.env*\n", encoding="utf-8")
    print(f"Staged {copied} files in {out}")


if __name__ == "__main__":
    main()
