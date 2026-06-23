"""Typed result models for every ingestion stage.

These are the only objects that move between stages, the orchestrator, and
the report generator -- no stage hands off a raw dict or raw text alone.
That's what lets the report generator stay completely decoupled from any
specific extractor/chunker/embedder implementation.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class FileType(str, Enum):
    PDF_NATIVE = "pdf_native"
    PDF_SCANNED = "pdf_scanned"
    DOCX = "docx"
    PPTX = "pptx"
    IMAGE = "image"
    TEXT_MARKDOWN = "text_markdown"
    UNKNOWN = "unknown"


class Chunk(BaseModel):
    text: str
    char_len: int
    metadata: dict[str, Any] = Field(default_factory=dict)


class ExtractionResult(BaseModel):
    extractor_name: str
    file_name: str
    file_type: FileType
    success: bool = True
    extraction_time_s: float = 0.0
    char_count: int = 0
    page_count: int = 0
    tables_detected: int = 0
    images_detected: int = 0
    ocr_required: bool = False
    ocr_method_used: Optional[str] = None  # "tesseract" | "azure_di" | None
    failed_pages: list[int] = Field(default_factory=list)
    quality_flags: list[str] = Field(default_factory=list)
    layout_notes: Optional[str] = None
    raw_text: str = ""
    structured_elements: dict[str, Any] = Field(default_factory=dict)
    config_used: dict[str, Any] = Field(default_factory=dict)


class ChunkSetResult(BaseModel):
    chunker_name: str
    source_extraction_id: str
    chunks: list[Chunk] = Field(default_factory=list)
    num_chunks: int = 0
    avg_chunk_size: float = 0.0
    min_chunk_size: int = 0
    max_chunk_size: int = 0
    size_distribution: dict[str, int] = Field(default_factory=dict)
    overlap_used: int = 0
    pct_undersized: float = 0.0
    pct_oversized: float = 0.0
    tables_split: int = 0
    config_used: dict[str, Any] = Field(default_factory=dict)


class MetadataResult(BaseModel):
    """Output of the metadata generation stage (rule-based or LLM-based).

    This is deliberately its own model, not a field bolted onto ChunkSetResult
    -- see ARCHITECTURE.md section 10 for why metadata generation is a
    first-class, independently benchmarkable stage.
    """

    generator_name: str
    is_llm_based: bool = False
    source_chunk_set_id: str
    num_chunks_processed: int = 0
    num_failed: int = 0
    fields_generated: list[str] = Field(default_factory=list)
    coverage_pct: float = 0.0
    generation_time_s: float = 0.0
    llm_input_tokens: int = 0
    llm_output_tokens: int = 0
    estimated_cost_usd: float = 0.0
    schema_consistency_flag: bool = True
    chunk_metadata: list[dict[str, Any]] = Field(default_factory=list)
    sample_outputs: list[dict[str, Any]] = Field(default_factory=list)
    config_used: dict[str, Any] = Field(default_factory=dict)


class EmbeddingResult(BaseModel):
    embedder_name: str
    dimension: int = 0
    num_chunks_embedded: int = 0
    num_failed: int = 0
    embedding_time_s: float = 0.0
    total_tokens: int = 0
    estimated_cost_usd: float = 0.0
    chunk_ids: list[str] = Field(default_factory=list)
    vectors: list[list[float]] = Field(default_factory=list)
    config_used: dict[str, Any] = Field(default_factory=dict)


class VectorStoreResult(BaseModel):
    store_name: str
    num_vectors_written: int = 0
    upsert_time_s: float = 0.0
    write_failures: int = 0
    metadata_fields_supported: list[str] = Field(default_factory=list)
    metadata_payload_size_bytes: float = 0.0
    setup_notes: Optional[str] = None
    operational_notes: Optional[str] = None
    config_used: dict[str, Any] = Field(default_factory=dict)


class BenchmarkRun(BaseModel):
    """Everything produced by one orchestrator run. Persisted to
    runs/<run_id>/results.jsonl and handed to the report generator."""

    run_id: str
    run_name: str = ""
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    config_snapshot: dict[str, Any] = Field(default_factory=dict)
    extraction_results: list[ExtractionResult] = Field(default_factory=list)
    chunk_results: list[ChunkSetResult] = Field(default_factory=list)
    metadata_results: list[MetadataResult] = Field(default_factory=list)
    embedding_results: list[EmbeddingResult] = Field(default_factory=list)
    vectorstore_results: list[VectorStoreResult] = Field(default_factory=list)
    environment: dict[str, Any] = Field(default_factory=dict)

    @property
    def total_run_cost_usd(self) -> float:
        cost = sum(m.estimated_cost_usd for m in self.metadata_results)
        cost += sum(e.estimated_cost_usd for e in self.embedding_results)
        return round(cost, 6)
