from __future__ import annotations

from ingestbench.core.models import Chunk, ChunkSetResult
from ingestbench.core.registry import registry
from ingestbench.embedding.openai_embedder import OpenAIEmbedder
import ingestbench.embedding  # noqa: F401


def _chunk_set() -> ChunkSetResult:
    return ChunkSetResult(
        chunker_name="fixed_size",
        source_extraction_id="native:sample.md",
        chunks=[
            Chunk(text="First chunk", char_len=11, metadata={"chunk_index": 0}),
            Chunk(text="Second chunk", char_len=12, metadata={"chunk_index": 1}),
        ],
        num_chunks=2,
    )


def test_openai_embedders_register_under_model_names():
    assert "text-embedding-3-small" in registry.names("embedder")
    assert "text-embedding-3-large" in registry.names("embedder")


def test_openai_embedder_skips_cleanly_without_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    result = OpenAIEmbedder("text-embedding-3-small").embed(_chunk_set())

    assert result.embedder_name == "text-embedding-3-small"
    assert result.dimension == 1536
    assert result.num_chunks_embedded == 0
    assert result.num_failed == 2
    assert result.vectors == []
    assert result.chunk_ids == []
    assert result.total_tokens > 0
    assert result.config_used["skip_reason"] == "credentials_not_set"
