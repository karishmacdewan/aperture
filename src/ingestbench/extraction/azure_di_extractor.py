"""Azure Document Intelligence extractor (key-gated).

Skips gracefully when AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT or
AZURE_DOCUMENT_INTELLIGENCE_KEY env vars are not set.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

from ingestbench.core.interfaces import Extractor
from ingestbench.core.models import ExtractionResult, FileType
from ingestbench.core.registry import registry

_SUPPORTED = [FileType.PDF_NATIVE, FileType.PDF_SCANNED, FileType.IMAGE, FileType.DOCX]


class AzureDIExtractor(Extractor):
    name = "azure_di"
    supported_types = _SUPPORTED
    requires_credentials = True

    def extract(self, file_path: Path) -> ExtractionResult:
        from ingestbench.extraction.file_types import detect_file_type

        t0 = time.perf_counter()
        file_type = detect_file_type(file_path)

        endpoint = os.environ.get("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", "")
        key = os.environ.get("AZURE_DOCUMENT_INTELLIGENCE_KEY", "")

        if not endpoint or not key:
            return ExtractionResult(
                extractor_name=self.name,
                file_name=file_path.name,
                file_type=file_type,
                success=False,
                quality_flags=["credentials_not_set"],
                extraction_time_s=round(time.perf_counter() - t0, 4),
            )

        try:
            result = self._run_azure_di(file_path, file_type, endpoint, key)
        except Exception as exc:
            result = ExtractionResult(
                extractor_name=self.name,
                file_name=file_path.name,
                file_type=file_type,
                success=False,
                quality_flags=[f"extraction_error:{exc}"],
            )

        result.extraction_time_s = round(time.perf_counter() - t0, 4)
        result.ocr_required = file_type == FileType.PDF_SCANNED
        result.ocr_method_used = "azure_di" if result.ocr_required else None
        return result

    def _run_azure_di(
        self, file_path: Path, file_type: FileType, endpoint: str, key: str
    ) -> ExtractionResult:
        from azure.ai.documentintelligence import DocumentIntelligenceClient
        from azure.core.credentials import AzureKeyCredential

        client = DocumentIntelligenceClient(endpoint=endpoint, credential=AzureKeyCredential(key))

        with open(file_path, "rb") as fh:
            poller = client.begin_analyze_document(
                "prebuilt-layout",
                analyze_request=fh,
                content_type="application/octet-stream",
            )
        result_di = poller.result()

        paragraphs: list[str] = []
        tables_detected = 0

        for page in result_di.pages or []:
            for line in page.lines or []:
                paragraphs.append(line.content)

        for _ in result_di.tables or []:
            tables_detected += 1

        raw_text = "\n".join(paragraphs)
        page_count = len(result_di.pages) if result_di.pages else 0

        return ExtractionResult(
            extractor_name=self.name,
            file_name=file_path.name,
            file_type=file_type,
            success=True,
            char_count=len(raw_text),
            page_count=page_count,
            tables_detected=tables_detected,
            raw_text=raw_text,
            layout_notes="azure_di_prebuilt_layout",
            config_used={"model": "prebuilt-layout", "library": "azure-ai-documentintelligence"},
        )


registry.register_extractor(AzureDIExtractor())
