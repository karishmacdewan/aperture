"""GPT-4o VLM extractor (key-gated).

Converts each page to an image and sends it to gpt-4o with a structured prompt.
Skips gracefully when OPENAI_API_KEY is not set.
"""

from __future__ import annotations

import base64
import io
import os
import time
from pathlib import Path

from ingestbench.core.interfaces import Extractor
from ingestbench.core.models import ExtractionResult, FileType
from ingestbench.core.registry import registry

_SUPPORTED = [FileType.PDF_NATIVE, FileType.PDF_SCANNED, FileType.IMAGE]

_SYSTEM_PROMPT = (
    "You are an expert document extraction assistant. "
    "Extract ALL text visible in the document image faithfully, preserving structure. "
    "Output only the extracted text with no commentary."
)


class GPT4oVLMExtractor(Extractor):
    name = "gpt4o_vlm"
    supported_types = _SUPPORTED
    requires_credentials = True

    def __init__(self, model: str = "gpt-4o", max_tokens: int = 4096, dpi: int = 150) -> None:
        self.model = model
        self.max_tokens = max_tokens
        self.dpi = dpi

    def extract(self, file_path: Path) -> ExtractionResult:
        from ingestbench.extraction.file_types import detect_file_type

        t0 = time.perf_counter()
        file_type = detect_file_type(file_path)

        if not os.environ.get("OPENAI_API_KEY"):
            return ExtractionResult(
                extractor_name=self.name,
                file_name=file_path.name,
                file_type=file_type,
                success=False,
                quality_flags=["credentials_not_set"],
                extraction_time_s=round(time.perf_counter() - t0, 4),
            )

        try:
            result = self._run_vlm(file_path, file_type)
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

    def _run_vlm(self, file_path: Path, file_type: FileType) -> ExtractionResult:
        from openai import OpenAI

        client = OpenAI()
        images_b64 = self._to_base64_images(file_path, file_type)
        page_texts: list[str] = []
        total_input_tokens = 0
        total_output_tokens = 0
        failed_pages: list[int] = []

        for i, img_b64 in enumerate(images_b64):
            try:
                response = client.chat.completions.create(
                    model=self.model,
                    max_tokens=self.max_tokens,
                    messages=[
                        {"role": "system", "content": _SYSTEM_PROMPT},
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "image_url",
                                    "image_url": {"url": f"data:image/png;base64,{img_b64}"},
                                },
                                {"type": "text", "text": "Extract all text from this page."},
                            ],
                        },
                    ],
                )
                page_texts.append(response.choices[0].message.content or "")
                if response.usage:
                    total_input_tokens += response.usage.prompt_tokens
                    total_output_tokens += response.usage.completion_tokens
            except Exception:
                failed_pages.append(i + 1)
                page_texts.append("")

        raw_text = "\n\n".join(t for t in page_texts if t.strip())
        return ExtractionResult(
            extractor_name=self.name,
            file_name=file_path.name,
            file_type=file_type,
            success=True,
            char_count=len(raw_text),
            page_count=len(images_b64),
            images_detected=len(images_b64),
            failed_pages=failed_pages,
            ocr_required=True,
            ocr_method_used="gpt4o_vlm",
            raw_text=raw_text,
            layout_notes="vlm_extracted",
            structured_elements={"input_tokens": total_input_tokens, "output_tokens": total_output_tokens},
            config_used={"model": self.model, "max_tokens": self.max_tokens, "dpi": self.dpi},
        )

    def _to_base64_images(self, file_path: Path, file_type: FileType) -> list[str]:
        if file_type == FileType.IMAGE:
            from PIL import Image

            img = Image.open(str(file_path)).convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            return [base64.b64encode(buf.getvalue()).decode()]

        # PDF (native or scanned) -- rasterize each page
        from pdf2image import convert_from_path

        images = convert_from_path(str(file_path), dpi=self.dpi)
        result: list[str] = []
        for img in images:
            buf = io.BytesIO()
            img.convert("RGB").save(buf, format="PNG")
            result.append(base64.b64encode(buf.getvalue()).decode())
        return result


registry.register_extractor(GPT4oVLMExtractor())
