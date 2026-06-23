"""A single registry mapping (stage, component_name) -> implementation class.

This is what makes new components pluggable without touching the
orchestrator: an implementation registers itself with a decorator in its
own module, and the orchestrator looks components up by string name from
run_config.yaml. See ARCHITECTURE.md sections 3 and 18.
"""

from __future__ import annotations

from collections import defaultdict
from typing import TypeVar

T = TypeVar("T")

# Canonical stage names used everywhere else in the codebase.
STAGES = ("extractor", "chunker", "metadata_generator", "embedder", "vector_store")


class Registry:
    def __init__(self) -> None:
        self._components: dict[str, dict[str, type]] = defaultdict(dict)

    def register(self, stage: str, name: str):
        """Class decorator: @registry.register("extractor", "docling")"""

        def decorator(cls: T) -> T:
            self._components[stage][name] = cls
            return cls

        return decorator

    def get(self, stage: str, name: str) -> type:
        try:
            return self._components[stage][name]
        except KeyError as exc:
            available = self.names(stage)
            raise KeyError(
                f"No component named '{name}' registered for stage '{stage}'. "
                f"Available for '{stage}': {available}"
            ) from exc

    def names(self, stage: str) -> list[str]:
        return sorted(self._components.get(stage, {}).keys())

    def all_stages(self) -> list[str]:
        return sorted(self._components.keys())

    # Convenience helpers for instance-based registration.
    # Each stage has one method so call sites are readable.

    def register_extractor(self, instance) -> None:
        self._components["extractor"][instance.name] = instance

    def register_chunker(self, instance) -> None:
        self._components["chunker"][instance.name] = instance

    def register_metadata_generator(self, instance) -> None:
        self._components["metadata_generator"][instance.name] = instance

    def register_embedder(self, instance) -> None:
        self._components["embedder"][instance.name] = instance

    def register_vector_store(self, instance) -> None:
        self._components["vector_store"][instance.name] = instance

    def get_extractor(self, name: str):
        return self._components["extractor"][name]


# Shared singleton -- every extractor/chunker/metadata/embedder/vectorstore
# module imports this and registers itself on import.
registry = Registry()
