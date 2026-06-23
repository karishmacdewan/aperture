"""Free, deterministic chunk metadata generation."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from ingestbench.core.interfaces import MetadataGenerator
from ingestbench.core.models import ChunkSetResult, MetadataResult
from ingestbench.core.registry import registry


class RuleBasedMetadataGenerator(MetadataGenerator):
    name = "rule_based"
    is_llm_based = False

    def generate(self, chunk_set: ChunkSetResult) -> MetadataResult:
        t0 = time.perf_counter()
        outputs = []
        source_file = _source_file(chunk_set.source_extraction_id)

        for index, chunk in enumerate(chunk_set.chunks):
            metadata = {
                "source_id": chunk_set.source_extraction_id,
                "source_file": source_file,
                "chunk_index": chunk.metadata.get("chunk_index", index),
                "char_len": chunk.char_len,
                "heading": chunk.metadata.get("heading"),
                "start_char": chunk.metadata.get("start_char"),
                "end_char": chunk.metadata.get("end_char"),
                "contains_table_hint": _contains_table_hint(chunk.text),
                "contains_image_hint": _contains_image_hint(chunk.text),
            }
            outputs.append({key: value for key, value in metadata.items() if value is not None})

        fields = sorted({field for item in outputs for field in item.keys()})
        coverage = _coverage(outputs, len(chunk_set.chunks))

        return MetadataResult(
            generator_name=self.name,
            is_llm_based=self.is_llm_based,
            source_chunk_set_id=chunk_set.source_extraction_id,
            num_chunks_processed=len(chunk_set.chunks),
            fields_generated=fields,
            coverage_pct=coverage,
            generation_time_s=round(time.perf_counter() - t0, 4),
            chunk_metadata=outputs,
            sample_outputs=outputs[:5],
            config_used={"strategy": "deterministic_rules"},
        )


def _source_file(source_id: str) -> str:
    return source_id.split(":", 1)[1] if ":" in source_id else Path(source_id).name


def _contains_table_hint(text: str) -> bool:
    lowered = text.lower()
    return "|" in text or "\t" in text or " table " in f" {lowered} "


def _contains_image_hint(text: str) -> bool:
    lowered = text.lower()
    return any(marker in lowered for marker in ["image", "figure", "screenshot", "diagram", "chart"])


def _coverage(outputs: list[dict[str, Any]], total: int) -> float:
    if not total:
        return 0.0
    covered = sum(1 for item in outputs if item)
    return round((covered / total) * 100, 2)


registry.register_metadata_generator(RuleBasedMetadataGenerator())
