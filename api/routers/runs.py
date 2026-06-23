"""POST/GET /api/runs -- create, list, and fetch benchmark runs.

Builds a run_config.yaml equivalent to what the CLI already consumes and
hands it to the unchanged BenchmarkOrchestrator -- this router adds no new
engine logic, only persistence and job scheduling around it.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from api.db import RunRecord, get_session
from api.jobs import execute_run, write_run_config
from api.storage import PROJECT_ROOT

router = APIRouter()

DEFAULT_SAMPLE_CATEGORIES = ["structured", "scanned", "powerpoint", "image_heavy"]

DEFAULT_COMPONENTS = {
    "extractor": "docling",
    "chunker": "heading_based",
    "metadata_generator": "rule_based",
    "embedder": "text-embedding-3-small",
    "vector_store": "qdrant",
}

DEFAULT_CHUNKING_PARAMS = {
    "fixed_size": {"chunk_size": 500, "overlap": 50},
    "heading_based": {"max_chunk_size": 600},
    "recursive": {"chunk_size": 500, "overlap": 75},
}

DEFAULT_SWEEP = {
    "extractor": ["native", "docling", "tesseract", "azure_di", "gpt4o_vlm"],
    "chunker": ["fixed_size", "heading_based", "recursive"],
    "metadata_generator": ["rule_based", "llm_metadata"],
    "embedder": ["text-embedding-3-small", "text-embedding-3-large"],
    "vector_store": ["qdrant", "pgvector"],
}


class DocumentsSpec(BaseModel):
    source: str = "sample"  # "sample" | "upload"
    categories: Optional[list[str]] = None  # sample corpus categories
    upload_batch_id: Optional[str] = None  # required when source == "upload"


class CreateRunRequest(BaseModel):
    run_name: str = ""
    mode: str = "ablation"  # ablation | full_factorial
    documents: DocumentsSpec = DocumentsSpec()
    defaults: dict[str, str] = {}
    sweep: dict[str, list[str]] = {}
    chunking_params: dict[str, dict[str, Any]] = {}


@router.post("/runs")
def create_run(request: CreateRunRequest, background_tasks: BackgroundTasks) -> dict:
    run_id = uuid.uuid4().hex[:12]

    if request.documents.source == "upload":
        if not request.documents.upload_batch_id:
            raise HTTPException(400, "upload_batch_id is required when documents.source == 'upload'")
        batch_dir = PROJECT_ROOT / "uploads" / request.documents.upload_batch_id
        if not batch_dir.exists():
            raise HTTPException(404, f"Unknown upload_batch_id '{request.documents.upload_batch_id}'")
        documents_cfg = {"source_dir": str(batch_dir.relative_to(PROJECT_ROOT)), "categories": ["files"]}
    else:
        documents_cfg = {
            "source_dir": "sample_docs",
            "categories": request.documents.categories or DEFAULT_SAMPLE_CATEGORIES,
        }

    defaults = {**DEFAULT_COMPONENTS, **request.defaults}
    sweep = {**DEFAULT_SWEEP, **request.sweep}
    chunking_params = {**DEFAULT_CHUNKING_PARAMS, **request.chunking_params}

    config = {
        "run_name": request.run_name,
        "mode": request.mode,
        "documents": documents_cfg,
        "defaults": defaults,
        "sweep": sweep,
        "chunking_params": chunking_params,
    }
    config_path = write_run_config(run_id, config)

    session = get_session()
    try:
        session.add(RunRecord(run_id=run_id, run_name=request.run_name, status="pending", config_snapshot=config))
        session.commit()
    finally:
        session.close()

    background_tasks.add_task(execute_run, run_id, str(config_path))
    return {"run_id": run_id, "status": "pending"}


@router.get("/runs")
def list_runs() -> list[dict]:
    session = get_session()
    try:
        records = session.query(RunRecord).order_by(RunRecord.created_at.desc()).all()
        return [
            {
                "run_id": r.run_id,
                "run_name": r.run_name,
                "status": r.status,
                "created_at": r.created_at.isoformat(),
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
            }
            for r in records
        ]
    finally:
        session.close()


@router.get("/runs/{run_id}")
def get_run(run_id: str) -> dict:
    session = get_session()
    try:
        record = session.get(RunRecord, run_id)
        if record is None:
            raise HTTPException(404, f"Unknown run_id '{run_id}'")
        payload = {
            "run_id": record.run_id,
            "run_name": record.run_name,
            "status": record.status,
            "created_at": record.created_at.isoformat(),
            "completed_at": record.completed_at.isoformat() if record.completed_at else None,
            "error": record.error,
        }
        if record.status == "complete":
            results_path = PROJECT_ROOT / "runs" / run_id / "results.json"
            if results_path.exists():
                payload["result"] = json.loads(results_path.read_text(encoding="utf-8"))
        return payload
    finally:
        session.close()


@router.get("/runs/{run_id}/report.md", response_class=PlainTextResponse)
def get_run_report(run_id: str) -> str:
    report_path = PROJECT_ROOT / "runs" / run_id / "report.md"
    if not report_path.exists():
        raise HTTPException(404, f"No report found for run_id '{run_id}' (not complete yet?)")
    return report_path.read_text(encoding="utf-8")
