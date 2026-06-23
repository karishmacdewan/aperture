# Enterprise Ingestion Benchmarking Tool

Benchmarks RAG ingestion architecture decisions -- extraction, chunking,
metadata generation, embedding, and vector database write performance --
so the right pipeline can be chosen *before* retrieval is built.

**Scope:** stops at the vector database write. No retrieval, reranking,
generation, or agents. See `ARCHITECTURE.md` for the full design.

## Status

Phases 0-8 (the engine), 10-11 (FastAPI product layer), and 12-13
(Next.js UI) are all implemented. See `ARCHITECTURE.md` section 17 for
the engine's phased plan and section 20 for the full web-product
architecture.

The engine: core scaffold, synthetic corpus generation, extraction
(native/Tesseract/Docling/Azure DI/GPT-4o VLM), chunking, metadata
generation, embedding, vector-store write (Qdrant/pgvector), orchestration,
and Markdown report generation -- runnable via the CLI or the API.

Credential-gated extractors (Azure DI, GPT-4o VLM) and embedders skip
gracefully without API keys; cost/timing for those stages is best
estimated by configuring the relevant env vars and re-running.

## Quick start (CLI)

```bash
pip install -e ".[extraction,embedding,vectorstore,reporting,sample-docs]"
docker compose up -d                      # local Qdrant + pgvector
python -m ingestbench generate-sample-docs
python -m ingestbench run --config configs/run_config.yaml
python -m ingestbench report --run-id <run_id>
```

## Quick start (API)

```bash
pip install -e ".[extraction,embedding,vectorstore,reporting,sample-docs,api]"
uvicorn api.main:app --reload
# defaults to a local SQLite app DB (api/app.db); set DATABASE_URL to a
# Postgres DSN to match ARCHITECTURE.md section 20.5 exactly.
```

- `GET /api/components` -- selectable components per stage, read live from the registry
- `POST /api/documents` -- upload files (multipart `files`), returns an `upload_batch_id`
- `POST /api/runs` -- start a benchmark run (`documents.source` is `"sample"` or `"upload"`)
- `GET /api/runs` / `GET /api/runs/{run_id}` -- history and status/result
- `GET /api/runs/{run_id}/report.md` -- the same Markdown report the CLI produces

## Quick start (web UI)

```bash
cd web
npm install
npm run dev          # http://localhost:3000, calls the API at NEXT_PUBLIC_API_BASE_URL
```

Run the API (`uvicorn api.main:app --reload`, default `http://localhost:8000`) alongside it.
Pages: `/upload`, `/runs/new`, `/runs`, `/runs/[runId]` (live status + recommended config +
comparison charts), `/runs/compare?ids=a,b`.

## Project layout

See `ARCHITECTURE.md` section 14 for the annotated folder tree. In short:

- `src/ingestbench/core/` -- interfaces, pydantic models, registry, timing,
  logging, cost ledger. Every other package depends on this one; it depends
  on nothing else in the project.
- `src/ingestbench/{extraction,chunking,metadata,embedding,vectorstore}/` --
  one swappable implementation per file, registered against the interfaces
  in `core/interfaces.py`.
- `src/ingestbench/orchestration/` -- builds and runs the comparison matrix.
- `src/ingestbench/reporting/` -- turns a finished run into a Markdown report.
- `retrieval_bench/` -- intentionally empty. This is where retrieval
  benchmarking gets built later, reading from this tool's outputs without
  this tool ever depending on it.
- `api/` -- FastAPI product layer (Phase 10-11). Imports `ingestbench` as a
  normal dependency; the engine has zero awareness of it. See
  `ARCHITECTURE.md` section 20.
- `web/` -- Next.js frontend (Phase 12-13). Only talks to the FastAPI
  layer over HTTP, never to Python directly.
