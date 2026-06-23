"""Tesseract OCR extractor.

Handles PDF_SCANNED and IMAGE file types. For scanned PDFs, converts each page
to an image via pdf2image then runs pytesseract. For bare image files, runs
pytesseract directly.
"""

from __future__ import annotations

import time
from pathlib import Path

from ingestbench.core.interfaces import Extractor
from ingestbench.core.models import ExtractionResult, FileType
from ingestbench.core.registry import registry


class TesseractExtractor(Extractor):
    name = "tesseract"
    supported_types = [FileType.PDF_SCANNED, FileType.IMAGE]
    requires_credentials = False

    def __init__(self, dpi: int = 200, lang: str = "eng") -> None:
        self.dpi = dpi
        self.lang = lang

    def extract(self, file_path: Path) -> ExtractionResult:
        from ingestbench.extraction.file_types import detect_file_type

        t0 = time.perf_counter()
        file_type = detect_file_type(file_path)

        try:
            import pytesseract  # noqa: F401
        except ImportError:
            result = ExtractionResult(
                extractor_name=self.name,
                file_name=file_path.name,
                file_type=file_type,
                success=False,
                quality_flags=["pytesseract_not_installed"],
                extraction_time_s=round(time.perf_counter() - t0, 4),
            )
            result.ocr_required = file_type in self.supported_types
            result.ocr_method_used = "tesseract" if result.ocr_required else None
            return result

        try:
            if file_type == FileType.PDF_SCANNED:
                result = self._extract_scanned_pdf(file_path)
            elif file_type == FileType.IMAGE:
                result = self._extract_image(file_path)
            else:
                result = ExtractionResult(
                    extractor_name=self.name,
                    file_name=file_path.name,
                    file_type=file_type,
                    success=False,
                    quality_flags=[f"unsupported_file_type:{file_type}"],
                )
        except Exception as exc:
            result = ExtractionResult(
                extractor_name=self.name,
                file_name=file_path.name,
                file_type=file_type,
                success=False,
                quality_flags=[f"extraction_error:{exc}"],
            )

        result.extraction_time_s = round(time.perf_counter() - t0, 4)
        result.ocr_required = True
        result.ocr_method_used = "tesseract"
        return result

    def _extract_scanned_pdf(self, file_path: Path) -> ExtractionResult:
        import pytesseract
        from pdf2image import convert_from_path

        images = convert_from_path(str(file_path), dpi=self.dpi)
        page_texts: list[str] = []
        failed_pages: list[int] = []

        for i, img in enumerate(images):
            try:
                text = pytesseract.image_to_string(img, lang=self.lang)
                page_texts.append(text.strip())
            except Exception:
                failed_pages.append(i + 1)
                page_texts.append("")

        raw_text = "\n\n".join(t for t in page_texts if t)
        return ExtractionResult(
            extractor_name=self.name,
            file_name=file_path.name,
            file_type=FileType.PDF_SCANNED,
            success=True,
            char_count=len(raw_text),
            page_count=len(images),
            failed_pages=failed_pages,
            raw_text=raw_text,
            config_used={"dpi": self.dpi, "lang": self.lang, "library": "pytesseract+pdf2image"},
        )

    def _extract_image(self, file_path: Path) -> ExtractionResult:
        import pytesseract
        from PIL import Image

        img = Image.open(str(file_path))
        text = pytesseract.image_to_string(img, lang=self.lang).strip()
        return ExtractionResult(
            extractor_name=self.name,
            file_name=file_path.name,
            file_type=FileType.IMAGE,
            success=True,
            char_count=len(text),
            page_count=1,
            images_detected=1,
            raw_text=text,
            config_used={"dpi": self.dpi, "lang": self.lang, "library": "pytesseract+pillow"},
        )


registry.register_extractor(TesseractExtractor())
