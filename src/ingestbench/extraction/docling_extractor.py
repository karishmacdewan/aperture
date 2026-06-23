"""Docling extractor (best-effort).

Docling is a heavy optional dependency. If not installed this class still
registers itself but every extract() call returns success=False with the
flag 'docling_not_installed'. That lets run_config.yaml name 'docling' as a
desired extractor -- the orchestrator treats the skipped result as a "not
available in this environment" data point, not a crash.
"""

from __future__ import annotations

import time
from pathlib import Path

from ingestbench.core.interfaces import Extractor
from ingestbench.core.models import ExtractionResult, FileType
from ingestbench.core.registry import registry

_DOCLING_AVAILABLE = False
try:
    import docling  # noqa: F401

    _DOCLING_AVAILABLE = True
except ImportError:
    pass

_ALL_TYPES = [
    FileType.PDF_NATIVE,
    FileType.PDF_SCANNED,
    FileType.DOCX,
    FileType.PPTX,
    FileType.IMAGE,
]


class DoclingExtractor(Extractor):
    name = "docling"
    supported_types = _ALL_TYPES
    requires_credentials = False

    def extract(self, file_path: Path) -> ExtractionResult:
        from ingestbench.extraction.file_types import detect_file_type

        t0 = time.perf_counter()
        file_type = detect_file_type(file_path)

        if not _DOCLING_AVAILABLE:
            return ExtractionResult(
                extractor_name=self.name,
                file_name=file_path.name,
                file_type=file_type,
                success=False,
                quality_flags=["docling_not_installed"],
                extraction_time_s=round(time.perf_counter() - t0, 4),
            )

        try:
            result = self._run_docling(file_path, file_type)
        except Exception as exc:
            result = ExtractionResult(
                extractor_name=self.name,
                file_name=file_path.name,
                file_type=file_type,
                success=False,
                quality_flags=[f"extraction_error:{exc}"],
            )

        result.extraction_time_s = round(time.perf_counter() - t0, 4)
        return result

    def _run_docling(self, file_path: Path, file_type: FileType) -> ExtractionResult:
        # Docling's public API (v2+): DocumentConverter
        from docling.document_converter import DocumentConverter

        converter = DocumentConverter()
        doc_result = converter.convert(str(file_path))
        doc = doc_result.document
        raw_text = doc.export_to_markdown()
        page_count = len(doc.pages) if hasattr(doc, "pages") else 0

        return ExtractionResult(
            extractor_name=self.name,
            file_name=file_path.name,
            file_type=file_type,
            success=True,
            char_count=len(raw_text),
            page_count=page_count,
            raw_text=raw_text,
            layout_notes="docling_rich_layout",
            config_used={"library": "docling"},
        )


registry.register_extractor(DoclingExtractor())
