from __future__ import annotations

from ingestbench.core.models import Chunk, ChunkSetResult
from ingestbench.core.registry import registry
from ingestbench.metadata.llm_metadata import LLMMetadataGenerator
from ingestbench.metadata.rule_based_metadata import RuleBasedMetadataGenerator
import ingestbench.metadata  # noqa: F401


def _chunk_set() -> ChunkSetResult:
    return ChunkSetResult(
        chunker_name="heading_based",
        source_extraction_id="native:sample.md",
        chunks=[
            Chunk(
                text="1. Introduction\nThis policy describes retention rules.",
                char_len=52,
                metadata={"chunk_index": 0, "heading": "1. Introduction"},
            ),
            Chunk(
                text="Data Category | Retention Period | Owner",
                char_len=40,
                metadata={"chunk_index": 1, "heading": "3. Retention Requirements"},
            ),
        ],
        num_chunks=2,
    )


def test_metadata_generators_register_under_config_names():
    assert "rule_based" in registry.names("metadata_generator")
    assert "llm_metadata" in registry.names("metadata_generator")


def test_rule_based_metadata_generates_payload_fields_for_each_chunk():
    result = RuleBasedMetadataGenerator().generate(_chunk_set())

    assert result.generator_name == "rule_based"
    assert result.is_llm_based is False
    assert result.num_chunks_processed == 2
    assert result.num_failed == 0
    assert result.coverage_pct == 100.0
    assert result.estimated_cost_usd == 0.0
    assert "source_file" in result.fields_generated
    assert "heading" in result.fields_generated
    assert result.sample_outputs[0]["source_file"] == "sample.md"
    assert result.sample_outputs[1]["contains_table_hint"] is True


def test_llm_metadata_skips_cleanly_without_openai_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    result = LLMMetadataGenerator().generate(_chunk_set())

    assert result.generator_name == "llm_metadata"
    assert result.is_llm_based is True
    assert result.num_chunks_processed == 0
    assert result.num_failed == 2
    assert result.coverage_pct == 0.0
    assert result.schema_consistency_flag is False
    assert result.config_used["skip_reason"] == "credentials_not_set"
