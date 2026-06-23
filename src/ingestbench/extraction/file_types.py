"""File-type detection for the extraction stage.

Detection is two-tiered: extension first, then (for PDFs only) a cheap
text-layer probe via pdfplumber to tell a native PDF apart from a scanned
one -- this is exactly the signal the orchestrator uses to decide whether
OCR/VLM extractors are even applicable to a given document.
"""

from __future__ import annotations

from pathlib import Path

from ingestbench.core.models import FileType

_EXTENSION_MAP = {
    ".docx": FileType.DOCX,
    ".pptx": FileType.PPTX,
    ".png": FileType.IMAGE,
    ".jpg": FileType.IMAGE,
    ".jpeg": FileType.IMAGE,
    ".tif": FileType.IMAGE,
    ".tiff": FileType.IMAGE,
    ".bmp": FileType.IMAGE,
    ".md": FileType.TEXT_MARKDOWN,
    ".txt": FileType.TEXT_MARKDOWN,
}

# A PDF page with fewer than this many extractable characters is treated as
# having no usable text layer. Real scanned pages produce 0; this small
# floor tolerates stray OCR artifacts from a previous bad scan-to-pdf pass.
_MIN_CHARS_PER_PAGE_FOR_NATIVE = 2


def detect_file_type(file_path: Path) -> FileType:
    suffix = file_path.suffix.lower()
    if suffix == ".pdf":
        return _detect_pdf_subtype(file_path)
    return _EXTENSION_MAP.get(suffix, FileType.UNKNOWN)


def _detect_pdf_subtype(file_path: Path) -> FileType:
    import pdfplumber

    try:
        with pdfplumber.open(str(file_path)) as pdf:
            if not pdf.pages:
                return FileType.PDF_SCANNED
            total_chars = sum(len((p.extract_text() or "").strip()) for p in pdf.pages)
            avg_chars_per_page = total_chars / len(pdf.pages)
    except Exception:
        # Unreadable/corrupt PDF -- treat as scanned so OCR/VLM still get a try.
        return FileType.PDF_SCANNED

    if avg_chars_per_page < _MIN_CHARS_PER_PAGE_FOR_NATIVE:
        return FileType.PDF_SCANNED
    return FileType.PDF_NATIVE
