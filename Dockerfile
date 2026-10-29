# ConduitAI backend for a public demo. It runs without API keys: SAM 3.1, Muse Spark and the
# architect replay their recorded outputs from data/cache/, and the verifier, parsers, attack
# replay and map all run live. Set META_MODEL_API_KEY / BASETEN_API_KEY to call the models.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /bin/uv

WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/ ./
COPY data/ /app/data/

ENV PORT=8008 \
    PYTHONUNBUFFERED=1
EXPOSE 8008
CMD ["sh", "-c", "uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
