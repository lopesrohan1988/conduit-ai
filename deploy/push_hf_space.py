"""Upload the backend to a Hugging Face Docker Space.

Only files git tracks are sent (Dockerfile, backend/, data/), so local secrets such as backend/.env
never leave the machine. The Space gets its own README with the Docker settings Hugging Face reads.

Usage, from the repository root, after `uvx --from huggingface_hub hf auth login`:

    uv run --no-project --with huggingface_hub python deploy/push_hf_space.py <user>/<space-name>
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parent.parent
INCLUDE_PREFIXES = ("backend/", "data/")
INCLUDE_FILES = {"Dockerfile", ".dockerignore"}
EXCLUDE_PREFIXES = ("backend/tests/",)


def tracked_files() -> list[str]:
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    files = [
        f
        for f in out.splitlines()
        if (f in INCLUDE_FILES or f.startswith(INCLUDE_PREFIXES)) and not f.startswith(EXCLUDE_PREFIXES)
    ]
    assert not any(Path(f).name == ".env" for f in files), "refusing to upload .env"
    return files


def main() -> None:
    if len(sys.argv) != 2 or "/" not in sys.argv[1]:
        sys.exit("usage: push_hf_space.py <user>/<space-name>")
    space = sys.argv[1]
    files = tracked_files()
    api = HfApi()
    print(f"Uploading {len(files)} tracked files to spaces/{space} ...")
    api.upload_folder(
        folder_path=str(ROOT),
        repo_id=space,
        repo_type="space",
        allow_patterns=files,
        commit_message="Deploy ConduitAI backend",
    )
    api.upload_file(
        path_or_fileobj=str(ROOT / "deploy" / "huggingface" / "README.md"),
        path_in_repo="README.md",
        repo_id=space,
        repo_type="space",
        commit_message="Space settings",
    )
    owner, name = space.split("/")
    print(f"Done. Build log: https://huggingface.co/spaces/{space}")
    print(f"API URL once built: https://{owner.lower()}-{name.lower().replace('_', '-').replace('.', '-')}.hf.space")


if __name__ == "__main__":
    main()
