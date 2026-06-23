# Deploying Aperture (demo)

Frontend → Vercel. Backend → Render (Vercel can't run the FastAPI + SQLite +
background-job backend — its functions are stateless/short-lived).

A git repo has already been initialized in this folder with one commit.

## 1. Push to GitHub

From your own terminal (not this sandbox, so it uses your real GitHub login):

```bash
cd "/Users/karishmadewan/Projects/Ingestion tool codex/ingestion-benchmark"
gh repo create aperture-ingestion-bench --private --source=. --remote=origin --push
```

No `gh` CLI? Create an empty repo on github.com instead, then:

```bash
git remote add origin <the repo URL>
git push -u origin master
```

## 2. Backend on Render

New → Web Service → connect the repo you just pushed.

- Root Directory: `ingestion-benchmark`
- Runtime: Python 3
- Build Command: `pip install -e ".[api]"`
- Start Command: `uvicorn api.main:app --host 0.0.0.0 --port $PORT`
- Env vars (Environment tab):
  - `OPENAI_API_KEY` — only needed if your benchmark config uses an OpenAI-backed extractor/metadata/embedder
  - `ALLOWED_ORIGINS` — leave blank for now, you'll set it after step 3

Deploy, then copy the service URL it gives you (e.g. `https://aperture-api.onrender.com`).

Note: the free tier's disk isn't persistent across redeploys/restarts — runs and uploads created during a demo session are fine, but don't expect data to survive a redeploy. Good enough to show your brother; not a permanent home for run history.

## 3. Frontend on Vercel

Import the same repo.

- Root Directory: `ingestion-benchmark/web`
- Framework Preset: Next.js (auto-detected)
- Env var: `NEXT_PUBLIC_API_BASE_URL` = the Render URL from step 2

Deploy, then copy the Vercel URL it gives you (e.g. `https://aperture-demo.vercel.app`).

## 4. Close the loop

Back in Render → Environment, set:

```
ALLOWED_ORIGINS=https://aperture-demo.vercel.app
```

Save (Render redeploys automatically on env var change).

## 5. Test

Open the Vercel URL, click "Configure benchmark." If it can't reach the API,
double check `NEXT_PUBLIC_API_BASE_URL` (Vercel) and `ALLOWED_ORIGINS` (Render)
match exactly, including `https://` and no trailing slash.
