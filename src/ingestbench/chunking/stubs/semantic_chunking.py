"""Deferred chunker: semantic (embedding-similarity-based) chunking.

Not implemented in V1 because it depends on the embedding layer and would
couple stages that are otherwise independent -- see ARCHITECTURE.md
section 9. Registered now so run_config.yaml can already name it.
"""

from __future__ import annotations

from ingestbench.core.interfaces import Chunker
from ingestbench.core.models import ChunkSetResult, ExtractionResult
from ingestbench.core.registry import registry


@registry.register("chunker", "semantic")
class SemanticChunker(Chunker):
    name = "semantic"

    def chunk(self, extraction_result: ExtractionResult, **params) -> ChunkSetResult:
        raise NotImplementedError(
            "Semantic chunking is a registered stub (deferred past V1 -- it "
            "depends on the embedding layer). Implement chunk() in this file "
            "to enable it -- no other code needs to change."
        )
