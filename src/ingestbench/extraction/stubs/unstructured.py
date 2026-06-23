"""Deferred extractor: Unstructured. See ARCHITECTURE.md section 8."""

from __future__ import annotations

from pathlib import Path

from ingestbench.core.interfaces import Extractor
from ingestbench.core.models import ExtractionResult, FileType
from ingestbench.core.registry import registry


@registry.register("extractor", "unstructured")
class UnstructuredExtractor(Extractor):
    name = "unstructured"
    supported_types = [
        FileType.PDF_NATIVE,
        FileType.DOCX,
        FileType.PPTX,
        FileType.IMAGE,
        FileType.TEXT_MARKDOWN,
    ]
    requires_credentials = False

    def extract(self, file_path: Path) -> ExtractionResult:
        raise NotImplementedError(
            "Unstructured extractor is a registered stub (deferred past V1). "
            "Implement extract() in this file to enable it -- no other code "
            "needs to change."
        )
