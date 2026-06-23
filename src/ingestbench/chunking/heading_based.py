"""Heading-aware chunker for documents with visible section structure."""

from __future__ import annotations

import re

from ingestbench.chunking._helpers import build_chunk_result, make_chunk
from ingestbench.core.interfaces import Chunker
from ingestbench.core.models import ChunkSetResult, ExtractionResult
from ingestbench.core.registry import registry

_MARKDOWN_HEADING_RE = re.compile(r"^#{1,6}\s+.+")
_NUMBERED_HEADING_RE = re.compile(r"^\d+(?:\.\d+)*[.)]?\s+.+")


class HeadingBasedChunker(Chunker):
    name = "heading_based"

    def chunk(
        self,
        extraction_result: ExtractionResult,
        max_chunk_size: int = 600,
        **params,
    ) -> ChunkSetResult:
        if max_chunk_size <= 0:
            raise ValueError("max_chunk_size must be > 0")

        sections = self._split_sections(extraction_result.raw_text or "")
        chunks = []
        chunk_index = 0

        for heading, body in sections:
            section_text = "\n".join(part for part in [heading, body] if part).strip()
            for part_index, part in enumerate(self._split_to_limit(section_text, max_chunk_size)):
                chunks.append(
                    make_chunk(
                        part,
                        chunk_index=chunk_index,
                        heading=heading,
                        section_part=part_index,
                    )
                )
                chunk_index += 1

        return build_chunk_result(
            chunker_name=self.name,
            extraction_result=extraction_result,
            chunks=chunks,
            target_size=max_chunk_size,
            config_used={"max_chunk_size": max_chunk_size, **params},
        )

    def _split_sections(self, text: str) -> list[tuple[str | None, str]]:
        lines = [line.strip() for line in text.splitlines()]
        sections: list[tuple[str | None, list[str]]] = []
        current_heading: str | None = None
        current_body: list[str] = []

        for line in lines:
            if not line:
                if current_body:
                    current_body.append("")
                continue
            if self._is_heading(line):
                if current_heading is not None or current_body:
                    sections.append((current_heading, current_body))
                current_heading = line.lstrip("#").strip()
                current_body = []
            else:
                current_body.append(line)

        if current_heading is not None or current_body:
            sections.append((current_heading, current_body))

        if not sections and text.strip():
            return [(None, text.strip())]

        return [(heading, "\n".join(body).strip()) for heading, body in sections]

    def _is_heading(self, line: str) -> bool:
        if len(line) > 100 or line.endswith("."):
            return False
        if _MARKDOWN_HEADING_RE.match(line) or _NUMBERED_HEADING_RE.match(line):
            return True

        words = [word for word in re.split(r"\s+", line) if word and word not in {"-", ":", "|"}]
        if not words or len(words) > 8:
            return False

        titleish_words = 0
        for word in words:
            stripped = word.strip("():,/-")
            if not stripped:
                continue
            if stripped[0].isupper() or stripped[0].isdigit() or stripped.isupper():
                titleish_words += 1
        return titleish_words / len(words) >= 0.75

    def _split_to_limit(self, text: str, max_chunk_size: int) -> list[str]:
        if len(text) <= max_chunk_size:
            return [text] if text.strip() else []

        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
        parts: list[str] = []
        current = ""

        for paragraph in paragraphs:
            candidate = f"{current}\n\n{paragraph}".strip() if current else paragraph
            if len(candidate) <= max_chunk_size:
                current = candidate
                continue
            if current:
                parts.append(current)
            if len(paragraph) <= max_chunk_size:
                current = paragraph
            else:
                parts.extend(_hard_wrap(paragraph, max_chunk_size))
                current = ""

        if current:
            parts.append(current)
        return parts


def _hard_wrap(text: str, width: int) -> list[str]:
    words = text.split()
    parts: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip() if current else word
        if len(candidate) <= width:
            current = candidate
            continue
        if current:
            parts.append(current)
        current = word
    if current:
        parts.append(current)
    return parts


registry.register_chunker(HeadingBasedChunker())
