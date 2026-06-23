"""OpenAI embedding implementations for text-embedding-3 models."""

from __future__ import annotations

import os
import time

from ingestbench.core.interfaces import Embedder
from ingestbench.core.models import ChunkSetResult, EmbeddingResult, MetadataResult
from ingestbench.core.registry import registry

_MODEL_DIMENSIONS = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
}


class OpenAIEmbedder(Embedder):
    def __init__(self, model: str) -> None:
        self.name = model
        self.model = model
        self.dimension = _MODEL_DIMENSIONS[model]

    def embed(
        self,
        chunk_set: ChunkSetResult,
        metadata: MetadataResult | None = None,
    ) -> EmbeddingResult:
        t0 = time.perf_counter()
        if not os.environ.get("OPENAI_API_KEY"):
            return EmbeddingResult(
                embedder_name=self.name,
                dimension=self.dimension,
                num_chunks_embedded=0,
                num_failed=len(chunk_set.chunks),
                embedding_time_s=round(time.perf_counter() - t0, 4),
                total_tokens=self._count_tokens([chunk.text for chunk in chunk_set.chunks]),
                estimated_cost_usd=0.0,
                config_used={"model": self.model, "skip_reason": "credentials_not_set"},
            )

        try:
            texts = [chunk.text for chunk in chunk_set.chunks]
            vectors, total_tokens = self._run_openai(texts)
        except Exception as exc:
            return EmbeddingResult(
                embedder_name=self.name,
                dimension=self.dimension,
                num_chunks_embedded=0,
                num_failed=len(chunk_set.chunks),
                embedding_time_s=round(time.perf_counter() - t0, 4),
                total_tokens=self._count_tokens([chunk.text for chunk in chunk_set.chunks]),
                estimated_cost_usd=0.0,
                config_used={"model": self.model, "error": str(exc)},
            )

        chunk_ids = [f"{chunk_set.source_extraction_id}:chunk:{i}" for i in range(len(vectors))]
        return EmbeddingResult(
            embedder_name=self.name,
            dimension=len(vectors[0]) if vectors else self.dimension,
            num_chunks_embedded=len(vectors),
            num_failed=max(0, len(chunk_set.chunks) - len(vectors)),
            embedding_time_s=round(time.perf_counter() - t0, 4),
            total_tokens=total_tokens,
            estimated_cost_usd=self.estimate_cost(total_tokens),
            chunk_ids=chunk_ids,
            vectors=vectors,
            config_used={"model": self.model},
        )

    def estimate_cost(self, input_tokens: int) -> float:
        from ingestbench.core.cost_ledger import CostLedger

        return CostLedger().estimate_embedding_cost(self.model, input_tokens)

    def _run_openai(self, texts: list[str]) -> tuple[list[list[float]], int]:
        from openai import OpenAI

        if not texts:
            return [], 0

        client = OpenAI()
        response = client.embeddings.create(model=self.model, input=texts)
        vectors = [item.embedding for item in sorted(response.data, key=lambda item: item.index)]
        total_tokens = response.usage.prompt_tokens if response.usage else self._count_tokens(texts)
        return vectors, total_tokens

    def _count_tokens(self, texts: list[str]) -> int:
        try:
            import tiktoken

            encoding = tiktoken.encoding_for_model(self.model)
            return sum(len(encoding.encode(text)) for text in texts)
        except Exception:
            return sum(max(1, len(text) // 4) for text in texts)


registry.register_embedder(OpenAIEmbedder("text-embedding-3-small"))
registry.register_embedder(OpenAIEmbedder("text-embedding-3-large"))
