"""Shared helpers for chunker result construction."""

from __future__ import annotations

from ingestbench.core.models import Chunk, ChunkSetResult, ExtractionResult


def source_id(extraction_result: ExtractionResult) -> str:
    return f"{extraction_result.extractor_name}:{extraction_result.file_name}"


def make_chunk(text: str, **metadata) -> Chunk:
    clean_text = text.strip()
    return Chunk(text=clean_text, char_len=len(clean_text), metadata={k: v for k, v in metadata.items() if v is not None})


def build_chunk_result(
    *,
    chunker_name: str,
    extraction_result: ExtractionResult,
    chunks: list[Chunk],
    target_size: int,
    overlap: int = 0,
    config_used: dict | None = None,
) -> ChunkSetResult:
    lengths = [chunk.char_len for chunk in chunks]
    num_chunks = len(chunks)
    undersized = sum(1 for length in lengths if target_size and length < target_size * 0.5)
    oversized = sum(1 for length in lengths if target_size and length > target_size)

    return ChunkSetResult(
        chunker_name=chunker_name,
        source_extraction_id=source_id(extraction_result),
        chunks=chunks,
        num_chunks=num_chunks,
        avg_chunk_size=round(sum(lengths) / num_chunks, 2) if num_chunks else 0.0,
        min_chunk_size=min(lengths) if lengths else 0,
        max_chunk_size=max(lengths) if lengths else 0,
        size_distribution=size_distribution(lengths),
        overlap_used=overlap,
        pct_undersized=round((undersized / num_chunks) * 100, 2) if num_chunks else 0.0,
        pct_oversized=round((oversized / num_chunks) * 100, 2) if num_chunks else 0.0,
        tables_split=estimate_tables_split(extraction_result, chunks),
        config_used=config_used or {},
    )


def size_distribution(lengths: list[int]) -> dict[str, int]:
    buckets = {
        "0-249": 0,
        "250-499": 0,
        "500-999": 0,
        "1000-1999": 0,
        "2000+": 0,
    }
    for length in lengths:
        if length < 250:
            buckets["0-249"] += 1
        elif length < 500:
            buckets["250-499"] += 1
        elif length < 1000:
            buckets["500-999"] += 1
        elif length < 2000:
            buckets["1000-1999"] += 1
        else:
            buckets["2000+"] += 1
    return buckets


def estimate_tables_split(extraction_result: ExtractionResult, chunks: list[Chunk]) -> int:
    table_texts = extraction_result.structured_elements.get("tables_text", [])
    if not table_texts:
        return 0

    split_count = 0
    for table_text in table_texts:
        table_text = str(table_text).strip()
        if not table_text:
            continue
        containing_chunks = [chunk for chunk in chunks if table_text in chunk.text]
        if not containing_chunks:
            split_count += 1
    return split_count
