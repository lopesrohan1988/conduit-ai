# Hosting the demo

A public demo should not expose API keys or spend model credits on every visitor. The backend therefore runs **without keys** and replays recorded model output:

| Stage | Without keys (public demo) |
| :--- | :--- |
| SAM 3.1 boxes, Muse Spark reads | Replayed from `data/cache/sam31/` and `data/cache/muse_spark_read/` |
| Muse Wonder / Muse Spark Open architect | Replayed from `data/cache/architect/`; every replayed proposal still goes through the live verifier |
| Packet and firewall analysis, switch parsing, verifier, map, attack replay | Run live on every request |

The UI labels replayed output as recorded. Recordings are refreshed by any run with keys, for example `uv run python scripts/run_eval_benchmark.py --live --open-weights`.

Each browser tab keeps its own runs, reviews and downloads (a random session id on every call), so visitors never see each other's work. Uploads are capped at 60 MB.

## Backend and frontend on Vercel (no GitHub access needed)

Both parts deploy from this machine with the Vercel CLI, so Vercel never needs access to the repository. Log in once with `npx vercel login` (email works).

1. Backend, as a Python function (only git-tracked files are staged, so `backend/.env` stays local):
   ```bash
   python deploy/stage_vercel_api.py ../conduit-vercel-api
   npx vercel deploy --prod --yes --cwd ../conduit-vercel-api
   ```
   Check `https://<backend-url>/api/v1/health`.
2. Frontend, pointed at that backend:
   ```bash
   cd frontend
   npx vercel deploy --prod --yes --build-env NEXT_PUBLIC_API_URL=https://<backend-url>
   ```

On Vercel's free plan, uploads in **Site & Files** are limited to 4.5 MB per request (Vercel's function payload limit). A run's engineer review lives in the serving instance's memory, so it can reset after the backend has been idle; downloads without a remembered run replay the recorded plan, so they still match what the run showed.

## Backend on a Hugging Face Docker Space (needs Hugging Face PRO)

1. Create a Space at https://huggingface.co/new-space: SDK **Docker**, template **Blank**, hardware **CPU basic** (free), visibility **Public**.
2. Create a token at https://huggingface.co/settings/tokens with **Write** access, then log in from this repository:
   ```bash
   uvx --from huggingface_hub hf auth login
   ```
3. Upload. Only files git tracks are sent, so `backend/.env` stays on your machine:
   ```bash
   uv run --no-project --with huggingface_hub python deploy/push_hf_space.py <user>/<space-name>
   ```
4. Wait for the build on the Space page (about 3 to 5 minutes), then check `https://<user>-<space-name>.hf.space/api/v1/health`.

Do not add `META_MODEL_API_KEY` or `BASETEN_API_KEY` as Space secrets for a public demo: every visitor's run would then call the paid models. A free Space sleeps after 48 hours without visits and takes about a minute to wake.

## Backend elsewhere (any Docker host)

```bash
docker build -t conduit-ai-backend .
docker run -p 8008:8008 conduit-ai-backend
```

It listens on `$PORT` (default 8008) and runs as uid 1000.

## Frontend on Vercel

1. At https://vercel.com/new, import the GitHub repository.
2. Set **Root Directory** to `frontend`. The framework (Next.js) is detected.
3. Add the environment variable `NEXT_PUBLIC_API_URL` = `https://<user>-<space-name>.hf.space` (no trailing slash).
4. Deploy. `NEXT_PUBLIC_` values are built into the page, so redeploy after changing it.
