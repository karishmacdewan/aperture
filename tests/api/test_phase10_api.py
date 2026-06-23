from __future__ import annotations

import os
import tempfile
import time
from pathlib import Path

_TMP_DB = Path(tempfile.mkstemp(suffix=".db")[1])
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP_DB}"

from fastapi.testclient import TestClient  # noqa: E402

from api.main import app  # noqa: E402

SAMPLE_DOCX = Path(__file__).resolve().parents[2] / "sample_docs" / "structured" / "sample_structured.docx"


def _poll_until_done(client: TestClient, run_id: str, timeout_s: float = 20.0) -> dict:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        response = client.get(f"/api/runs/{run_id}")
        body = response.json()
        if body["status"] in {"complete", "failed"}:
            return body
        time.sleep(0.2)
    raise AssertionError(f"run {run_id} did not finish within {timeout_s}s")


def test_components_endpoint_reflects_registry() -> None:
    with TestClient(app) as client:
        response = client.get("/api/components")
        assert response.status_code == 200
        body = response.json()
        assert "native" in body["extractor"]
        assert "qdrant" in body["vector_store"]


def test_upload_then_run_against_uploaded_document() -> None:
    with TestClient(app) as client:
        with SAMPLE_DOCX.open("rb") as fh:
            upload_response = client.post(
                "/api/documents", files={"files": (SAMPLE_DOCX.name, fh, "application/octet-stream")}
            )
        assert upload_response.status_code == 200
        batch_id = upload_response.json()["upload_batch_id"]
        assert upload_response.json()["files"][0]["file_type"] == "docx"

        create_response = client.post(
            "/api/runs",
            json={
                "run_name": "api-test-run",
                "documents": {"source": "upload", "upload_batch_id": batch_id},
                "defaults": {"extractor": "native"},
                "sweep": {"extractor": ["native"]},
            },
        )
        assert create_response.status_code == 200
        run_id = create_response.json()["run_id"]

        final = _poll_until_done(client, run_id)
        assert final["status"] == "complete", final.get("error")
        assert final["result"]["extraction_results"][0]["extractor_name"] == "native"
        assert final["result"]["extraction_results"][0]["char_count"] > 0

        report_response = client.get(f"/api/runs/{run_id}/report.md")
        assert report_response.status_code == 200
        assert "Recommended Configuration" in report_response.text

        list_response = client.get("/api/runs")
        assert any(r["run_id"] == run_id for r in list_response.json())


def test_run_with_unknown_upload_batch_returns_404() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/runs",
            json={"documents": {"source": "upload", "upload_batch_id": "does-not-exist"}},
        )
        assert response.status_code == 404
