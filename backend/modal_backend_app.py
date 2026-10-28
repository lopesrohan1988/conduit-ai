"""1-Command Modal Serverless ASGI Cloud Deployment for ConduitAI FastAPI Backend.

Bundles `backend/app` and `data/` (pluggable hardware catalogs, IEC 62443 controls,
6 OT scenarios, 15 ICS PCAPs, and cabinet walkthrough videos) into a scale-to-zero
Modal container exposing the full FastAPI + LangGraph + DuckDB + Scapy + Kernel Twin API.

Usage:
    # Optional: store live Meta API key as a Modal secret
    modal secret create conduit-ai-secrets META_MODEL_API_KEY=<your_key>

    # Deploy serverless ASGI backend
    modal deploy backend/modal_backend_app.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

import modal

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_APP_DIR = REPO_ROOT / "backend" / "app"
DATA_DIR = REPO_ROOT / "data"

backend_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("libglib2.0-0", "libgl1")
    .pip_install(
        "fastapi>=0.115.0",
        "uvicorn[standard]>=0.32.0",
        "sse-starlette>=2.1.0",
        "python-multipart>=0.0.12",
        "pydantic>=2.10.0",
        "pydantic-settings>=2.6.0",
        "langgraph>=0.2.50",
        "langchain-core>=0.3.20",
        "openai>=1.55.0",
        "httpx>=0.28.0",
        "duckdb>=1.1.3",
        "scapy>=2.6.1",
        "pillow>=11.0.0",
        "opencv-python-headless>=4.10.0.84",
        "reportlab>=4.2.5",
        "networkx>=3.4.2",
    )
    .env(
        {
            "PYTHONPATH": "/root/conduit-ai/backend",
            "DATA_DIR": "/root/conduit-ai/data",
            "CATALOGS_DIR": "/root/conduit-ai/data/catalogs",
            "SCENARIOS_DIR": "/root/conduit-ai/data/scenarios",
            "REAL_ICS_CAPTURES_DIR": "/root/conduit-ai/data/real_ics_captures",
            "VIDEOS_DIR": "/root/conduit-ai/data/videos",
        }
    )
    .add_local_dir(str(BACKEND_APP_DIR), remote_path="/root/conduit-ai/backend/app")
    .add_local_dir(str(DATA_DIR), remote_path="/root/conduit-ai/data")
)

app = modal.App("conduit-ai-backend")


_backend_secret_name = os.environ.get("CONDUIT_MODAL_SECRET", "").strip()
_backend_secrets = (
    [modal.Secret.from_name(_backend_secret_name)] if _backend_secret_name else []
)


@app.function(
    image=backend_image,
    scaledown_window=120,
    timeout=300,
    secrets=_backend_secrets,
)
@modal.concurrent(max_inputs=32)
@modal.asgi_app()
def fastapi_app() -> Any:
    """Return the ConduitAI FastAPI ASGI application inside Modal serverless runtime."""
    if "/root/conduit-ai/backend" not in sys.path:
        sys.path.insert(0, "/root/conduit-ai/backend")
    from app.main import app as conduit_fastapi_app

    return conduit_fastapi_app
