# Ingestion Benchmark Web

Next.js product interface for the Enterprise Ingestion Benchmarking Tool.

The UI lets a consultant upload a representative document set, configure an ingestion benchmark, monitor runs, and review an evidence-backed recommendation for extraction, chunking, metadata, embedding, and vector-store choices.

## Run Locally

Start the FastAPI service first from the project root:

```bash
uvicorn api.main:app --reload
```

Then start the web app:

```bash
npm install
npm run dev
```

The app defaults to `http://localhost:8000` for the API. Override with:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 npm run dev
```

## Product Surfaces

- `/upload` uploads representative documents and confirms detected file types.
- `/runs/new` configures ablation or full benchmark sweeps from live registry data.
- `/runs` lists completed and in-progress benchmarks.
- `/runs/[runId]` presents the executive recommendation, confidence, score breakdown, tradeoffs, and detailed metrics.
- `/runs/compare?ids=a,b` compares benchmark runs.

## Checks

```bash
npm run lint
npm run build
```
