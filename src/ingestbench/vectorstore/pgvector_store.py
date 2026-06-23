"""Postgres/pgvector writer.

This implementation expects a running Postgres service with the pgvector
extension available. In sandboxes without Docker/Postgres, it records an
infra-unavailable result instead of crashing the benchmark.
"""

from __future__ import annotations

import json
import os
from typing import Any

from ingestbench.core.interfaces import VectorStore
from ingestbench.core.models import EmbeddingResult, MetadataResult, VectorStoreResult
from ingestbench.core.registry import registry


class PgVectorStore(VectorStore):
    name = "pgvector"

    def __init__(self, table_name: str = "ingestbench_vectors", dsn: str | None = None) -> None:
        self.table_name = table_name
        self.dsn = dsn or os.environ.get(
            "PGVECTOR_DSN", "postgresql://ingestbench:ingestbench@localhost:5432/ingestbench"
        )
        self._conn = None
        self._unavailable_reason: str | None = None

    def create_collection(self, dimension: int, metadata_schema: dict) -> None:
        try:
            import psycopg
            from pgvector.psycopg import register_vector

            self._conn = psycopg.connect(self.dsn, connect_timeout=2)
            with self._conn.cursor() as cur:
                cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
            self._conn.commit()
            register_vector(self._conn)
            with self._conn.cursor() as cur:
                cur.execute(f"DROP TABLE IF EXISTS {self.table_name}")
                cur.execute(
                    f"""
                    CREATE TABLE {self.table_name} (
                        id text PRIMARY KEY,
                        embedding vector({dimension}),
                        metadata jsonb
                    )
                    """
                )
            self._conn.commit()
            self._unavailable_reason = None
        except Exception as exc:
            self._conn = None
            self._unavailable_reason = f"pgvector_unavailable:{exc}"

    def upsert(
        self,
        embedding_result: EmbeddingResult,
        metadata: MetadataResult | None = None,
    ) -> VectorStoreResult:
        import time

        t0 = time.perf_counter()
        payloads = _payloads(embedding_result, metadata)
        if self._conn is None:
            return self._result(
                embedding_result,
                payloads,
                upsert_time_s=time.perf_counter() - t0,
                failures=len(embedding_result.vectors),
                setup_notes=self._unavailable_reason or "collection_not_created",
            )
        if not embedding_result.vectors:
            return self._result(
                embedding_result,
                payloads,
                upsert_time_s=time.perf_counter() - t0,
                setup_notes="no_vectors_to_write",
            )

        try:
            with self._conn.cursor() as cur:
                for index, vector in enumerate(embedding_result.vectors):
                    chunk_id = embedding_result.chunk_ids[index] if index < len(embedding_result.chunk_ids) else str(index)
                    cur.execute(
                        f"""
                        INSERT INTO {self.table_name} (id, embedding, metadata)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (id) DO UPDATE
                        SET embedding = EXCLUDED.embedding, metadata = EXCLUDED.metadata
                        """,
                        (chunk_id, vector, json.dumps(payloads[index])),
                    )
            self._conn.commit()
            failures = 0
            setup_notes = "postgres_pgvector"
        except Exception as exc:
            self._conn.rollback()
            failures = len(embedding_result.vectors)
            setup_notes = f"upsert_error:{exc}"

        return self._result(
            embedding_result,
            payloads,
            upsert_time_s=time.perf_counter() - t0,
            failures=failures,
            setup_notes=setup_notes,
        )

    def describe(self) -> dict:
        return {
            "backend": "postgres",
            "extension": "pgvector",
            "table": self.table_name,
            "supports_metadata_payload": True,
        }

    def _result(
        self,
        embedding_result: EmbeddingResult,
        payloads: list[dict[str, Any]],
        *,
        upsert_time_s: float,
        failures: int = 0,
        setup_notes: str | None = None,
    ) -> VectorStoreResult:
        return VectorStoreResult(
            store_name=self.name,
            num_vectors_written=max(0, len(embedding_result.vectors) - failures),
            upsert_time_s=round(upsert_time_s, 4),
            write_failures=failures,
            metadata_fields_supported=sorted({key for payload in payloads for key in payload.keys()}),
            metadata_payload_size_bytes=float(len(json.dumps(payloads))),
            setup_notes=setup_notes,
            operational_notes=json.dumps(self.describe()),
            config_used={"table_name": self.table_name, "dsn": _redact_dsn(self.dsn)},
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


def _redact_dsn(dsn: str) -> str:
    if "@" not in dsn or "://" not in dsn:
        return dsn
    scheme, rest = dsn.split("://", 1)
    return f"{scheme}://***@{rest.split('@', 1)[1]}"


registry.register_vector_store(PgVectorStore())
