from __future__ import annotations

from ingestbench.chunking.fixed_size import FixedSizeChunker
from ingestbench.chunking.heading_based import HeadingBasedChunker
from ingestbench.chunking.recursive import RecursiveChunker
from ingestbench.core.models import ExtractionResult, FileType
from ingestbench.core.registry import registry
import ingestbench.chunking  # noqa: F401


def _extraction(raw_text: str) -> ExtractionResult:
    return ExtractionResult(
        extractor_name="native",
        file_name="sample.md",
        file_type=FileType.TEXT_MARKDOWN,
        char_count=len(raw_text),
        raw_text=raw_text,
    )


def test_chunkers_register_under_config_names():
    assert "fixed_size" in registry.names("chunker")
    assert "heading_based" in registry.names("chunker")
    assert "recursive" in registry.names("chunker")
    assert "semantic" in registry.names("chunker")


def test_fixed_size_chunker_reports_overlap_and_stats():
    text = "abcdefghijklmnopqrstuvwxyz" * 20
    result = FixedSizeChunker().chunk(_extraction(text), chunk_size=100, overlap=20)

    assert result.chunker_name == "fixed_size"
    assert result.source_extraction_id == "native:sample.md"
    assert result.num_chunks > 1
    assert result.overlap_used == 20
    assert result.max_chunk_size <= 100
    assert result.chunks[0].metadata["start_char"] == 0
    assert result.chunks[1].metadata["start_char"] == 80


def test_heading_based_chunker_preserves_section_metadata():
    text = "\n".join(
        [
            "Acme Corp Data Retention Policy",
            "Intro paragraph.",
            "1. Introduction",
            "This policy defines the scope.",
            "2. Scope",
            "This covers customer records and email logs.",
        ]
    )

    result = HeadingBasedChunker().chunk(_extraction(text), max_chunk_size=120)

    assert result.chunker_name == "heading_based"
    assert result.num_chunks == 3
    assert [chunk.metadata["heading"] for chunk in result.chunks] == [
        "Acme Corp Data Retention Policy",
        "1. Introduction",
        "2. Scope",
    ]
    assert all(chunk.char_len <= 120 for chunk in result.chunks)


def test_recursive_chunker_splits_paragraphs_before_character_fallback():
    text = (
        "First paragraph has a few sentences. It should stay together when possible.\n\n"
        "Second paragraph is intentionally longer so the recursive splitter has to "
        "walk down from paragraphs to sentences to words before forming bounded chunks."
    )

    result = RecursiveChunker().chunk(_extraction(text), chunk_size=90, overlap=10)

    assert result.chunker_name == "recursive"
    assert result.num_chunks > 1
    assert result.overlap_used == 10
    assert all(chunk.char_len <= 90 for chunk in result.chunks)
