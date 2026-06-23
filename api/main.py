"""FastAPI app entry point.

Run with: uvicorn api.main:app --reload --app-dir .
(from the ingestion-benchmark/ directory, with PYTHONPATH including src/)
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.db import init_db
from api.routers import components, documents, runs


def _import_engine_components() -> None:
    import ingestbench.chunking  # noqa: F401
    import ingestbench.embedding  # noqa: F401
    import ingestbench.extraction  # noqa: F401
    import ingestbench.metadata  # noqa: F401
    import ingestbench.vectorstore  # noqa: F401


@asynccontextmanager
async def lifespan(_: FastAPI):
    _import_engine_components()
    init_db()
    yield


app = FastAPI(title="Ingestion Benchmark API", version="0.1.0", lifespan=lifespan)

# Next.js dev server runs on a different origin (localhost:3000) than the
# API (localhost:8000); this is a local single-tenant tool (no auth in V1
# per ARCHITECTURE.md section 20.5), so a permissive local-only CORS policy
# is fine here. ALLOWED_ORIGINS lets a deployed frontend (e.g. a Vercel URL)
# be added without touching this file -- set it to a comma-separated list.
_default_origins = "http://localhost:3000,http://127.0.0.1:3000"
allow_origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", _default_origins).split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(components.router, prefix="/api")
app.include_router(documents.router, prefix="/api")
app.include_router(runs.router, prefix="/api")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
