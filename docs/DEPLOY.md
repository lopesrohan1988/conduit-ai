# Hosting the demo

A public demo should not expose API keys or spend model credits on every visitor. The backend therefore runs **without keys** and replays recorded model output:

| Stage | Without keys (public demo) |
| :--- | :--- |
| SAM 3.1 boxes, Muse Spark reads | Replayed from `data/cache/sam31/` and `data/cache/muse_spark_read/` |
| Muse Wonder / Muse Spark Open architect | Replayed from `data/cache/architect/`; every replayed proposal still goes through the live verifier |
| Packet and firewall analysis, switch parsing, verifier, map, attack replay | Run live on every request |

The UI labels replayed output as recorded. Recordings are refreshed by any run with keys, for example `uv run python scripts/run_eval_benchmark.py --live --open-weights`.

## Backend (Docker)

The `Dockerfile` at the repository root bundles the backend and `data/`:

```bash
docker build -t conduit-ai-backend .
docker run -p 8008:8008 conduit-ai-backend
```

Any container host works (Render, Fly.io, Railway, Cloud Run). It listens on `$PORT` (default 8008). To call the models live instead of replaying, set `META_MODEL_API_KEY` and `BASETEN_API_KEY` in the host's secret settings.

## Frontend (Vercel)

1. Import the repository and set the root directory to `frontend`.
2. Set `NEXT_PUBLIC_API_URL` to the backend's public URL.
3. Deploy. The build is the standard `next build`.
