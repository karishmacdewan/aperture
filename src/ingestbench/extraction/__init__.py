"""Extraction layer (Stage 2).

Phase 2 fills in: native_extractor.py, docling_extractor.py,
tesseract_extractor.py, azure_di_extractor.py, gpt4o_vlm_extractor.py.

Extractors deferred past V1 (LlamaParse, Unstructured, Google Document AI,
Claude-vision) are already registered as stubs below -- see stubs/ -- so
run_config.yaml can already name them, and implementing one later is a
one-file change: write extract(), nothing else.
"""

from ingestbench.extraction import (  # noqa: F401
    azure_di_extractor,
    docling_extractor,
    gpt4o_vlm_extractor,
    native_extractor,
    tesseract_extractor,
)
from ingestbench.extraction.stubs import claude_vlm, google_docai, llamaparse, unstructured  # noqa: F401
