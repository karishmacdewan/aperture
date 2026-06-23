"""Fixed-size character chunker with configurable overlap."""

from __future__ import annotations

from ingestbench.chunking._helpers import build_chunk_result, make_chunk
from ingestbench.core.interfaces import Chunker
from ingestbench.core.models import ChunkSetResult, ExtractionResult
from ingestbench.core.registry import registry


class FixedSizeChunker(Chunker):
    name = "fixed_size"

    def chunk(
        self,
        extraction_result: ExtractionResult,
        chunk_size: int = 500,
        overlap: int = 50,
        **params,
    ) -> ChunkSetResult:
        if chunk_size <= 0:
            raise ValueError("chunk_size must be > 0")
        if overlap < 0:
            raise ValueError("overlap must be >= 0")
        if overlap >= chunk_size:
            raise ValueError("overlap must be smaller than chunk_size")

        text = extraction_result.raw_text or ""
        chunks = []
        start = 0
        index = 0
        step = chunk_size - overlap

        while start < len(text):
            end = min(start + chunk_size, len(text))
            chunk_text = text[start:end]
            if chunk_text.strip():
                chunks.append(make_chunk(chunk_text, chunk_index=index, start_char=start, end_char=end))
                index += 1
            if end == len(text):
                break
            start += step

        return build_chunk_result(
            chunker_name=self.name,
            extraction_result=extraction_result,
            chunks=chunks,
            target_size=chunk_size,
            overlap=overlap,
            config_used={"chunk_size": chunk_size, "overlap": overlap, **params},
        )


registry.register_chunker(FixedSizeChunker())
