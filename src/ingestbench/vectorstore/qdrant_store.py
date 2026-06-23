"""Qdrant vector-store writer.

Uses embedded local Qdrant storage by default, so the benchmark can exercise
real vector writes even when Docker is unavailable.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ingestbench.core.interfaces import VectorStore
from ingestbench.core.models import EmbeddingResult, MetadataResult, VectorStoreResult
from ingestbench.core.registry import registry


class QdrantStore(VectorStore):
    name = "qdrant"

    def __init__(self, collection_name: str = "ingestbench", local_path: str = "runs/qdrant_local") -> None:
        self.collection_name = collection_name
        self.local_path = Path(local_path)
        self._client = None
        self._unavailable_reason: str | None = None

    def create_collection(self, dimension: int, metadata_schema: dict) -> None:
        try:
            from qdrant_client import QdrantClient
            from qdrant_client.models import Distance, VectorParams

            self.local_path.mkdir(parents=True, exist_ok=True)
            if self._client is None:
                self._client = QdrantClient(path=str(self.local_path))
            if self._client.collection_exists(self.collection_name):
                self._client.delete_collection(self.collection_name)
            self._client.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(size=dimension, distance=Distance.COSINE),
            )
            self._unavailable_reason = None
        except Exception as exc:
            self._client = None
            self._unavailable_reason = f"qdrant_unavailable:{exc}"

    def upsert(
        self,
        embedding_result: EmbeddingResult,
        metadata: MetadataResult | None = None,
    ) -> VectorStoreResult:
        import time

        t0 = time.perf_counter()
        if self._client is None:
            return self._result(
                embedding_result,
                upsert_time_s=time.perf_counter() - t0,
                failures=len(embedding_result.vectors),
                setup_notes=self._unavailable_reason or "collection_not_created",
                metadata=metadata,
            )
        if not embedding_result.vectors:
            return self._result(
                embedding_result,
                upsert_time_s=time.perf_counter() - t0,
                setup_notes="no_vectors_to_write",
                metadata=metadata,
            )

        try:
            from qdrant_client.models import PointStruct

            payloads = _payloads(embedding_result, metadata)
            points = [
                PointStruct(id=i, vector=vector, payload=payloads[i])
                for i, vector in enumerate(embedding_result.vectors)
            ]
            self._client.upsert(collection_name=self.collection_name, points=points)
            failures = 0
            setup_notes = f"embedded_local_path:{self.local_path}"
        except Exception as exc:
            failures = len(embedding_result.vectors)
            setup_notes = f"upsert_error:{exc}"

        return self._result(
            embedding_result,
            upsert_time_s=time.perf_counter() - t0,
            failures=failures,
            setup_notes=setup_notes,
            metadata=metadata,
        )

    def describe(self) -> dict:
        return {
            "backend": "qdrant",
            "mode": "embedded_local",
            "collection": self.collection_name,
            "distance": "cosine",
            "supports_metadata_payload": True,
        }

    def _result(
        self,
        embedding_result: EmbeddingResult,
        *,
        upsert_time_s: float,
        failures: int = 0,
        setup_notes: str | None = None,
        metadata: MetadataResult | None = None,
    ) -> VectorStoreResult:
        payloads = _payloads(embedding_result, metadata)
        return VectorStoreResult(
            store_name=self.name,
            num_vectors_written=max(0, len(embedding_result.vectors) - failures),
            upsert_time_s=round(upsert_time_s, 4),
            write_failures=failures,
            metadata_fields_supported=sorted({key for payload in payloads for key in payload.keys()}),
            metadata_payload_size_bytes=float(len(json.dumps(payloads))),
            setup_notes=setup_notes,
            operational_notes=json.dumps(self.describe()),
            config_used={"collection_name": self.collection_name, "local_path": str(self.local_path)},
        )


def _payloads(embedding_result: EmbeddingResult, metadata: MetadataResult | None) -> list[dict[str, Any]]:
    metadata_items = metadata.chunk_metadata if metadata else []
    payloads = []
    for index, _vector in enumerate(embedding_result.vectors):
        payload = {"chunk_id": embedding_result.chunk_ids[index] if index < len(embedding_result.chunk_ids) else str(index)}
        if index < len(metadata_items):
            payload.update(metadata_items[index])
        payloads.append(payload)
    return payloads


registry.register_vector_store(QdrantStore())
