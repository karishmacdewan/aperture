"""Deferred extractor: Claude-vision, an alternate VLM extractor alongside
GPT-4o (the first VLM implementation -- see gpt4o_vlm_extractor.py in
Phase 2). Same interface, different model. See ARCHITECTURE.md section 8.
"""

from __future__ import annotations

from pathlib import Path

from ingestbench.core.interfaces import Extractor
from ingestbench.core.models import ExtractionResult, FileType
from ingestbench.core.registry import registry


@registry.register("extractor", "claude_vlm")
class ClaudeVLMExtractor(Extractor):
    name = "claude_vlm"
    supported_types = [FileType.IMAGE, FileType.PDF_SCANNED]
    requires_credentials = True

    def extract(self, file_path: Path) -> ExtractionResult:
        raise NotImplementedError(
            "Claude-vision extractor is a registered stub (deferred past V1). "
            "Implement extract() in this file to enable it -- no other code "
            "needs to change."
        )
