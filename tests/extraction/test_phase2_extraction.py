from __future__ import annotations

import json
from pathlib import Path

from ingestbench.core.models import FileType
from ingestbench.extraction.azure_di_extractor import AzureDIExtractor
from ingestbench.extraction.docling_extractor import DoclingExtractor
from ingestbench.extraction.file_types import detect_file_type
from ingestbench.extraction.gpt4o_vlm_extractor import GPT4oVLMExtractor
from ingestbench.extraction.native_extractor import NativeExtractor
from ingestbench.extraction.tesseract_extractor import TesseractExtractor

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SAMPLE_DOCS = PROJECT_ROOT / "sample_docs"


def _ground_truth(category: str) -> dict:
    return json.loads((SAMPLE_DOCS / category / "ground_truth.json").read_text())


def test_file_type_detection_on_synthetic_corpus():
    assert detect_file_type(SAMPLE_DOCS / "structured" / "sample_structured.pdf") == FileType.PDF_NATIVE
    assert detect_file_type(SAMPLE_DOCS / "structured" / "sample_structured.docx") == FileType.DOCX
    assert detect_file_type(SAMPLE_DOCS / "powerpoint" / "sample_deck.pptx") == FileType.PPTX
    assert detect_file_type(SAMPLE_DOCS / "scanned" / "sample_scanned.pdf") == FileType.PDF_SCANNED
    assert detect_file_type(SAMPLE_DOCS / "image_heavy" / "screenshot_1.png") == FileType.IMAGE


def test_native_extractor_recovers_structured_pdf_and_docx_ground_truth():
    truth = _ground_truth("structured")
    extractor = NativeExtractor()

    for file_name, expected_type in [
        ("sample_structured.pdf", FileType.PDF_NATIVE),
        ("sample_structured.docx", FileType.DOCX),
    ]:
        result = extractor.extract(SAMPLE_DOCS / "structured" / file_name)

        assert result.success is True
        assert result.extractor_name == "native"
        assert result.file_type == expected_type
        assert result.tables_detected == truth["num_tables"]
        assert result.ocr_required is False
        assert result.char_count > 0
        for heading in truth["headings"]:
            assert heading in result.raw_text
        for row in truth["tables"][0]["rows"]:
            assert row[0] in result.raw_text


def test_native_extractor_recovers_powerpoint_text_and_image_count():
    truth = _ground_truth("powerpoint")
    result = NativeExtractor().extract(SAMPLE_DOCS / "powerpoint" / "sample_deck.pptx")

    assert result.success is True
    assert result.file_type == FileType.PPTX
    assert result.page_count == truth["num_slides"]
    assert result.images_detected == truth["num_embedded_images"]
    for slide in truth["slides"]:
        assert slide["title"] in result.raw_text
        for bullet in slide["bullets"]:
            assert bullet in result.raw_text


def test_tesseract_extractor_succeeds_or_skips_gracefully_for_scanned_pdf():
    result = TesseractExtractor().extract(SAMPLE_DOCS / "scanned" / "sample_scanned.pdf")

    assert result.file_type == FileType.PDF_SCANNED
    assert result.ocr_required is True
    assert result.ocr_method_used == "tesseract"

    if result.success:
        assert result.page_count == _ground_truth("scanned")["num_pages"]
        assert "MEMORANDUM" in result.raw_text
        assert "Warehouse Inventory Audit Schedule" in result.raw_text
    else:
        assert result.quality_flags
        assert any(
            flag == "pytesseract_not_installed" or flag.startswith("extraction_error:")
            for flag in result.quality_flags
        )


def test_optional_extractors_skip_without_local_dependencies_or_credentials(monkeypatch):
    scanned_pdf = SAMPLE_DOCS / "scanned" / "sample_scanned.pdf"

    docling = DoclingExtractor().extract(scanned_pdf)
    if not docling.success:
        assert any(
            flag == "docling_not_installed" or flag.startswith("extraction_error:")
            for flag in docling.quality_flags
        )

    monkeypatch.delenv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", raising=False)
    monkeypatch.delenv("AZURE_DOCUMENT_INTELLIGENCE_KEY", raising=False)
    azure = AzureDIExtractor().extract(scanned_pdf)
    assert azure.success is False
    assert "credentials_not_set" in azure.quality_flags

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    vlm = GPT4oVLMExtractor().extract(scanned_pdf)
    assert vlm.success is False
    assert "credentials_not_set" in vlm.quality_flags
