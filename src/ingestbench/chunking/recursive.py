"""Recursive paragraph/sentence/word chunker."""

from __future__ import annotations

import re

from ingestbench.chunking._helpers import build_chunk_result, make_chunk
from ingestbench.core.interfaces import Chunker
from ingestbench.core.models import ChunkSetResult, ExtractionResult
from ingestbench.core.registry import registry


class RecursiveChunker(Chunker):
    name = "recursive"

    def chunk(
        self,
        extraction_result: ExtractionResult,
        chunk_size: int = 500,
        overlap: int = 75,
        **params,
    ) -> ChunkSetResult:
        if chunk_size <= 0:
            raise ValueError("chunk_size must be > 0")
        if overlap < 0:
            raise ValueError("overlap must be >= 0")
        if overlap >= chunk_size:
            raise ValueError("overlap must be smaller than chunk_size")

        units = self._split_recursive(extraction_result.raw_text or "", chunk_size)
        chunks = self._merge_units(units, chunk_size, overlap)

        return build_chunk_result(
            chunker_name=self.name,
            extraction_result=extraction_result,
            chunks=[
                make_chunk(text, chunk_index=i)
                for i, text in enumerate(chunks)
                if text.strip()
            ],
            target_size=chunk_size,
            overlap=overlap,
            config_used={"chunk_size": chunk_size, "overlap": overlap, **params},
        )

    def _split_recursive(self, text: str, chunk_size: int) -> list[str]:
        text = text.strip()
        if not text:
            return []
        if len(text) <= chunk_size:
            return [text]

        for pattern in [r"\n\s*\n", r"\n", r"(?<=[.!?])\s+", r"\s+"]:
            pieces = [piece.strip() for piece in re.split(pattern, text) if piece.strip()]
            if len(pieces) > 1:
                units: list[str] = []
                for piece in pieces:
                    units.extend(self._split_recursive(piece, chunk_size))
                return units

        return [text[i : i + chunk_size] for i in range(0, len(text), chunk_size)]

    def _merge_units(self, units: list[str], chunk_size: int, overlap: int) -> list[str]:
        chunks: list[str] = []
        current = ""

        for unit in units:
            separator = "\n\n" if "\n" in current else " "
            candidate = f"{current}{separator}{unit}".strip() if current else unit
            if len(candidate) <= chunk_size:
                current = candidate
                continue
            if current:
                chunks.append(current)
            current = self._overlap_prefix(current, overlap, unit, chunk_size)

        if current:
            chunks.append(current)
        return chunks

    def _overlap_prefix(self, previous: str, overlap: int, next_unit: str, chunk_size: int) -> str:
        if overlap == 0 or not previous:
            return next_unit
        prefix = previous[-overlap:].strip()
        if not prefix:
            return next_unit
        candidate = f"{prefix} {next_unit}".strip()
        return candidate if len(candidate) <= chunk_size else next_unit


registry.register_chunker(RecursiveChunker())
