"""Turns a finished BenchmarkRun into a client-facing report.

Phase 8 fills in: report_builder.py + templates/benchmark_report.md.j2.
Markdown only for V1 -- HTML/PDF export deferred (see ARCHITECTURE.md
section 13), but the renderer is called through one function so swapping
in another output format later doesn't touch the template content.
"""

from ingestbench.reporting.report_builder import build_markdown_report, write_markdown_report  # noqa: F401
