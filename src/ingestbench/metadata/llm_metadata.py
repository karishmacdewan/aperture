"""GPT-4o-mini metadata enrichment for chunks."""

from __future__ import annotations

import json
import os
import time
from typing import Any

from ingestbench.core.interfaces import MetadataGenerator
from ingestbench.core.models import ChunkSetResult, MetadataResult
from ingestbench.core.registry import registry

_SYSTEM_PROMPT = (
    "You generate compact retrieval metadata for document chunks. "
    "Return valid JSON only."
)


class LLMMetadataGenerator(MetadataGenerator):
    name = "llm_metadata"
    is_llm_based = True
    requires_credentials = True

    def __init__(self, model: str = "gpt-4o-mini", max_chunk_chars: int = 1600) -> None:
        self.model = model
        self.max_chunk_chars = max_chunk_chars

    def generate(self, chunk_set: ChunkSetResult) -> MetadataResult:
        t0 = time.perf_counter()
        if not os.environ.get("OPENAI_API_KEY"):
            return MetadataResult(
                generator_name=self.name,
                is_llm_based=self.is_llm_based,
                source_chunk_set_id=chunk_set.source_extraction_id,
                num_chunks_processed=0,
                num_failed=len(chunk_set.chunks),
                coverage_pct=0.0,
                generation_time_s=round(time.perf_counter() - t0, 4),
                schema_consistency_flag=False,
                config_used={"model": self.model, "skip_reason": "credentials_not_set"},
            )

        try:
            outputs, input_tokens, output_tokens = self._run_llm(chunk_set)
            num_failed = max(0, len(chunk_set.chunks) - len(outputs))
            schema_ok = self._schema_is_consistent(outputs)
        except Exception as exc:
            return MetadataResult(
                generator_name=self.name,
                is_llm_based=self.is_llm_based,
                source_chunk_set_id=chunk_set.source_extraction_id,
                num_chunks_processed=0,
                num_failed=len(chunk_set.chunks),
                coverage_pct=0.0,
                generation_time_s=round(time.perf_counter() - t0, 4),
                schema_consistency_flag=False,
                config_used={"model": self.model, "error": str(exc)},
            )

        return MetadataResult(
            generator_name=self.name,
            is_llm_based=self.is_llm_based,
            source_chunk_set_id=chunk_set.source_extraction_id,
            num_chunks_processed=len(outputs),
            num_failed=num_failed,
            fields_generated=sorted({key for item in outputs for key in item.keys()}),
            coverage_pct=round((len(outputs) / len(chunk_set.chunks)) * 100, 2) if chunk_set.chunks else 0.0,
            generation_time_s=round(time.perf_counter() - t0, 4),
            llm_input_tokens=input_tokens,
            llm_output_tokens=output_tokens,
            estimated_cost_usd=self.estimate_cost(input_tokens, output_tokens),
            schema_consistency_flag=schema_ok,
            chunk_metadata=outputs,
            sample_outputs=outputs[:5],
            config_used={"model": self.model, "max_chunk_chars": self.max_chunk_chars},
        )

    def estimate_cost(self, input_tokens: int, output_tokens: int = 0) -> float:
        from ingestbench.core.cost_ledger import CostLedger

        return CostLedger().estimate_chat_cost(self.model, input_tokens, output_tokens)

    def _run_llm(self, chunk_set: ChunkSetResult) -> tuple[list[dict[str, Any]], int, int]:
        from openai import OpenAI

        client = OpenAI()
        payload = [
            {
                "chunk_index": chunk.metadata.get("chunk_index", index),
                "text": chunk.text[: self.max_chunk_chars],
            }
            for index, chunk in enumerate(chunk_set.chunks)
        ]

        response = client.chat.completions.create(
            model=self.model,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        "For each chunk, return JSON with key 'chunks'. Each item must include "
                        "chunk_index, summary, keywords, entities, and document_section. "
                        f"Chunks: {json.dumps(payload)}"
                    ),
                },
            ],
        )

        content = response.choices[0].message.content or "{}"
        parsed = json.loads(content)
        outputs = parsed.get("chunks", [])
        if not isinstance(outputs, list):
            outputs = []

        usage = response.usage
        input_tokens = usage.prompt_tokens if usage else _rough_token_count(json.dumps(payload))
        output_tokens = usage.completion_tokens if usage else _rough_token_count(content)
        return [item for item in outputs if isinstance(item, dict)], input_tokens, output_tokens

    def _schema_is_consistent(self, outputs: list[dict[str, Any]]) -> bool:
        required = {"chunk_index", "summary", "keywords", "entities", "document_section"}
        return bool(outputs) and all(required.issubset(output.keys()) for output in outputs)


def _rough_token_count(text: str) -> int:
    try:
        import tiktoken

        return len(tiktoken.encoding_for_model("gpt-4o-mini").encode(text))
    except Exception:
        return max(1, len(text) // 4)


registry.register_metadata_generator(LLMMetadataGenerator())
