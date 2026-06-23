"""Single source of truth for $ cost anywhere in the pipeline.

GPT-4o vision calls (extraction), GPT-4o-mini calls (LLM metadata
enrichment), and OpenAI embedding calls all read rates from
configs/pricing.yaml through this one class and record their spend here --
see ARCHITECTURE.md section 7. Nothing computes cost by hand elsewhere.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

DEFAULT_PRICING_PATH = Path("configs/pricing.yaml")


class CostLedger:
    def __init__(self, pricing_path: Path = DEFAULT_PRICING_PATH) -> None:
        data: dict[str, Any] = yaml.safe_load(Path(pricing_path).read_text())
        self.embedding_models: dict[str, dict] = data.get("embedding_models", {})
        self.chat_vision_models: dict[str, dict] = data.get("chat_vision_models", {})
        self._entries: list[dict[str, Any]] = []

    def estimate_embedding_cost(self, model: str, input_tokens: int) -> float:
        if model not in self.embedding_models:
            raise ValueError(
                f"Unknown embedding model '{model}'. "
                f"Known: {sorted(self.embedding_models)}. Add it to configs/pricing.yaml."
            )
        rate = self.embedding_models[model]["input_per_1m_usd"]
        return round(input_tokens / 1_000_000 * rate, 6)

    def estimate_chat_cost(self, model: str, input_tokens: int, output_tokens: int = 0) -> float:
        if model not in self.chat_vision_models:
            raise ValueError(
                f"Unknown chat/vision model '{model}'. "
                f"Known: {sorted(self.chat_vision_models)}. Add it to configs/pricing.yaml."
            )
        rates = self.chat_vision_models[model]
        cost = input_tokens / 1_000_000 * rates["input_per_1m_usd"]
        cost += output_tokens / 1_000_000 * rates.get("output_per_1m_usd", 0.0)
        return round(cost, 6)

    def record(self, stage: str, component: str, cost_usd: float, **extra: Any) -> None:
        """Log a cost-incurring event (e.g. one extraction call, one batch of
        embedding calls) so the run can report a full cost breakdown."""
        self._entries.append({"stage": stage, "component": component, "cost_usd": cost_usd, **extra})

    @property
    def total_cost_usd(self) -> float:
        return round(sum(e["cost_usd"] for e in self._entries), 6)

    def breakdown_by_stage(self) -> dict[str, float]:
        out: dict[str, float] = {}
        for e in self._entries:
            out[e["stage"]] = round(out.get(e["stage"], 0.0) + e["cost_usd"], 6)
        return out

    @property
    def entries(self) -> list[dict[str, Any]]:
        return list(self._entries)
