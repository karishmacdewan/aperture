"""Abstract interfaces for every swappable pipeline stage.

The orchestrator only ever calls these methods -- it never imports a
concrete extractor/chunker/etc. directly. Concrete implementations live in
their own module and register themselves against `core.registry.registry`;
adding a new one never requires touching this file or the orchestrator.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from ingestbench.core.models import (
    ChunkSetResult,
    EmbeddingResult,
    ExtractionResult,
    FileType,
    MetadataResult,
    VectorStoreResult,
)


class Extractor(ABC):
    """Stage 2: turns one file into an ExtractionResult."""

    name: str
    supported_types: list[FileType] = []
    requires_credentials: bool = False  # True for azure_di, gpt4o_vlm

    @abstractmethod
    def extract(self, file_path: Path) -> ExtractionResult:
        """Parse one file and return a structured ExtractionResult."""


class Chunker(ABC):
    """Stage 4: splits an ExtractionResult's text into a ChunkSetResult."""

    name: str

    @abstractmethod
    def chunk(self, extraction_result: ExtractionResult, **params) -> ChunkSetResult:
        """Split extracted text into chunks according to this strategy."""


class MetadataGenerator(ABC):
    """Stage 5: produces per-chunk metadata for a ChunkSetResult.

    Operates on chunks only -- never touches chunk text, never calls the
    embedder or vector store. Rule-based implementations cost nothing;
    LLM-based implementations report token usage via estimate_cost().
    """

    name: str
    is_llm_based: bool = False

    @abstractmethod
    def generate(self, chunk_set: ChunkSetResult) -> MetadataResult:
        """Produce a MetadataResult describing every chunk in chunk_set."""

    def estimate_cost(self, input_tokens: int, output_tokens: int = 0) -> float:
        """Override in LLM-based generators. Rule-based generators are free."""
        return 0.0


class Embedder(ABC):
    """Stage 6: embeds every chunk in a ChunkSetResult."""

    name: str
    dimension: int = 0

    @abstractmethod
    def embed(
        self,
        chunk_set: ChunkSetResult,
        metadata: MetadataResult | None = None,
    ) -> EmbeddingResult:
        """Embed chunk text. `metadata` is accepted now (even though V1
        always embeds chunk text only) so a future metadata-aware embedding
        strategy doesn't require an interface change."""

    @abstractmethod
    def estimate_cost(self, input_tokens: int) -> float:
        """$ cost for embedding input_tokens, read from configs/pricing.yaml."""


class VectorStore(ABC):
    """Stage 7: writes an EmbeddingResult's vectors (+ metadata payloads)."""

    name: str

    @abstractmethod
    def create_collection(self, dimension: int, metadata_schema: dict) -> None:
        """Create or reset the collection/table for this benchmark cell."""

    @abstractmethod
    def upsert(
        self,
        embedding_result: EmbeddingResult,
        metadata: MetadataResult | None = None,
    ) -> VectorStoreResult:
        """Write vectors (and metadata payloads, if provided) and report timing."""

    @abstractmethod
    def describe(self) -> dict:
        """Operational notes: index type, supported filters, setup notes."""
