"""Scale-to-zero Modal GPU OpenAI-compatible vLLM server for Air-Gapped `Muse-Glimmer-30B`.

Deploys an isolated OpenAI-compatible `/v1/chat/completions` endpoint for critical
infrastructure utilities (nuclear, transmission substations, defense manufacturing)
requiring open-weights inference without outbound internet dependencies.

Usage:
    modal deploy backend/modal_glimmer_server.py

Then copy the printed `https://<workspace>--conduitai-muse-glimmer-30b-serve.modal.run/v1`
URL into `.env` as `MUSE_GLIMMER_ENDPOINT_URL`.
"""

from __future__ import annotations

import os
import subprocess

import modal

MODEL_REPO = os.environ.get("MUSE_GLIMMER_HF_REPO", "meta-models/Muse-Glimmer-30B")
SERVED_MODEL_NAME = os.environ.get("MUSE_GLIMMER_MODEL", "Muse-Glimmer-30B")
GPU_SPEC = os.environ.get("GLIMMER_GPU", "H100")
VLLM_PORT = 8000

hf_cache_vol = modal.Volume.from_name("conduitai-hf-cache", create_if_missing=True)
vllm_cache_vol = modal.Volume.from_name("conduitai-vllm-cache", create_if_missing=True)

vllm_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "vllm>=0.8.2",
        "huggingface_hub[hf_transfer]>=0.29.0",
        "fastapi[standard]>=0.115.0",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
)

app = modal.App("conduitai-muse-glimmer-30b")


_hf_secret_name = os.environ.get("HF_MODAL_SECRET", "").strip()
_glimmer_secrets = (
    [modal.Secret.from_name(_hf_secret_name)] if _hf_secret_name else []
)


@app.function(
    image=vllm_image,
    gpu=GPU_SPEC,
    scaledown_window=60,
    timeout=900,
    max_containers=1,
    volumes={
        "/root/.cache/huggingface": hf_cache_vol,
        "/root/.cache/vllm": vllm_cache_vol,
    },
    secrets=_glimmer_secrets,
)
@modal.concurrent(max_inputs=16)
@modal.web_server(port=VLLM_PORT, startup_timeout=600)
def serve() -> None:
    """Launch OpenAI-compatible vLLM server for `Muse-Glimmer-30B`."""
    cmd = [
        "vllm",
        "serve",
        MODEL_REPO,
        "--served-model-name",
        SERVED_MODEL_NAME,
        "--host",
        "0.0.0.0",
        "--port",
        str(VLLM_PORT),
        "--max-model-len",
        "16384",
        "--dtype",
        "bfloat16",
        "--gpu-memory-utilization",
        "0.92",
    ]
    subprocess.Popen(cmd)
