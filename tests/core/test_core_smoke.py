"""Phase 0 smoke test: models, registry, timing, and the cost ledger all
work together before any real extractor/chunker/etc. is implemented.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from ingestbench.core.cost_ledger import CostLedger
from ingestbench.core.interfaces import Extractor
from ingestbench.core.models import ExtractionResult, FileType
from ingestbench.core.registry import Registry
from ingestbench.core.timing import timed_stage

PRICING_PATH = Path(__file__).resolve().parents[2] / "configs" / "pricing.yaml"


def test_models_round_trip():
    result = ExtractionResult(
        extractor_name="fake",
        file_name="memo.pdf",
        file_type=FileType.PDF_NATIVE,
        char_count=1200,
        page_count=3,
    )
    payload = result.model_dump_json()
    restored = ExtractionResult.model_validate_json(payload)
    assert restored.file_name == "memo.pdf"
    assert restored.file_type == FileType.PDF_NATIVE


def test_registry_register_and_get():
    reg = Registry()

    @reg.register("extractor", "fake")
    class FakeExtractor:
        name = "fake"

    assert reg.get("extractor", "fake") is FakeExtractor
    assert reg.names("extractor") == ["fake"]

    with pytest.raises(KeyError):
        reg.get("extractor", "does_not_exist")


def test_timed_stage_fills_in_elapsed_time():
    class FakeExtractor(Extractor):
        name = "fake"
        supported_types = [FileType.TEXT_MARKDOWN]

        @timed_stage("extraction")
        def extract(self, file_path: Path) -> ExtractionResult:
            return ExtractionResult(
                extractor_name=self.name,
                file_name=file_path.name,
                file_type=FileType.TEXT_MARKDOWN,
                char_count=42,
            )

    result = FakeExtractor().extract(Path("hello.md"))
    assert result.extraction_time_s >= 0.0


def test_cost_ledger_reads_pricing_yaml_and_tracks_total():
    ledger = CostLedger(pricing_path=PRICING_PATH)

    embed_cost = ledger.estimate_embedding_cost("text-embedding-3-small", 1_000_000)
    assert embed_cost == pytest.approx(0.02)

    chat_cost = ledger.estimate_chat_cost("gpt-4o-mini", input_tokens=1_000_000, output_tokens=1_000_000)
    assert chat_cost == pytest.approx(0.15 + 0.60)

    ledger.record("embedding", "text-embedding-3-small", embed_cost)
    ledger.record("metadata", "llm_metadata", chat_cost)

    assert ledger.total_cost_usd == pytest.approx(embed_cost + chat_cost)
    assert ledger.breakdown_by_stage()["embedding"] == pytest.approx(embed_cost)

    with pytest.raises(ValueError):
        ledger.estimate_embedding_cost("not-a-real-model", 1000)
