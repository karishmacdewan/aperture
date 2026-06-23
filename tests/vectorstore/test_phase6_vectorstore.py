from __future__ import annotations

from ingestbench.core.models import EmbeddingResult, MetadataResult
from ingestbench.core.registry import registry
from ingestbench.vectorstore.pgvector_store import PgVectorStore
from ingestbench.vectorstore.qdrant_store import QdrantStore
import ingestbench.vectorstore  # noqa: F401


def _embedding() -> EmbeddingResult:
    return EmbeddingResult(
        embedder_name="fake",
        dimension=3,
        num_chunks_embedded=2,
        chunk_ids=["native:sample.md:chunk:0", "native:sample.md:chunk:1"],
        vectors=[[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
    )


def _metadata() -> MetadataResult:
    return MetadataResult(
        generator_name="rule_based",
        source_chunk_set_id="native:sample.md",
        num_chunks_processed=2,
        chunk_metadata=[
            {"source_file": "sample.md", "chunk_index": 0},
            {"source_file": "sample.md", "chunk_index": 1},
        ],
    )


def test_vector_stores_register_under_config_names():
    assert "qdrant" in registry.names("vector_store")
    assert "pgvector" in registry.names("vector_store")


def test_qdrant_embedded_upsert_writes_or_skips_gracefully(tmp_path):
    store = QdrantStore(collection_name="test_ingestbench", local_path=str(tmp_path / "qdrant"))
    store.create_collection(dimension=3, metadata_schema={})
    result = store.upsert(_embedding(), _metadata())

    assert result.store_name == "qdrant"
    assert result.write_failures in {0, 2}
    if result.write_failures == 0:
        assert result.num_vectors_written == 2
        assert "source_file" in result.metadata_fields_supported
    else:
        assert result.setup_notes


def test_pgvector_upsert_skips_when_infra_unavailable():
    store = PgVectorStore(dsn="postgresql://postgres:postgres@127.0.0.1:1/postgres")
    store.create_collection(dimension=3, metadata_schema={})
    result = store.upsert(_embedding(), _metadata())

    assert result.store_name == "pgvector"
    assert result.num_vectors_written == 0
    assert result.write_failures == 2
    assert result.setup_notes
