"""Markdown report generation for completed benchmark runs."""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path

from ingestbench.core.models import BenchmarkRun


def load_run(path: Path | str) -> BenchmarkRun:
    return BenchmarkRun.model_validate_json(Path(path).read_text(encoding="utf-8"))


def write_markdown_report(run: BenchmarkRun, output_path: Path | str) -> Path:
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(build_markdown_report(run), encoding="utf-8")
    return output_path


def build_markdown_report(run: BenchmarkRun) -> str:
    lines = [
        f"# Ingestion Benchmark Report: {run.run_name or run.run_id}",
        "",
        f"- Run ID: `{run.run_id}`",
        f"- Timestamp: `{run.timestamp.isoformat()}`",
        f"- Total estimated API cost: `${run.total_run_cost_usd:.6f}`",
        "",
        "## Recommended Configuration",
        "",
        _recommendation(run),
        "",
        "## Stage Summary",
        "",
        f"- Extraction results: {len(run.extraction_results)}",
        f"- Chunking results: {len(run.chunk_results)}",
        f"- Metadata results: {len(run.metadata_results)}",
        f"- Embedding results: {len(run.embedding_results)}",
        f"- Vector-store results: {len(run.vectorstore_results)}",
        "",
        "## Extraction",
        "",
        _extraction_table(run),
        "",
        "## Chunking",
        "",
        _chunking_table(run),
        "",
        "## Metadata",
        "",
        _metadata_table(run),
        "",
        "## Embeddings",
        "",
        _embedding_table(run),
        "",
        "## Vector Stores",
        "",
        _vectorstore_table(run),
        "",
        "## Skips And Caveats",
        "",
        _caveats(run),
        "",
    ]
    return "\n".join(lines)


def _recommendation(run: BenchmarkRun) -> str:
    successful_extractions = [r for r in run.extraction_results if r.success and r.char_count > 0]
    if successful_extractions:
        best = sorted(successful_extractions, key=lambda r: (r.char_count, -r.extraction_time_s), reverse=True)[0]
        extractor = f"`{best.extractor_name}` for `{best.file_type.value}` documents"
    else:
        extractor = "no successful extractor in this environment"

    chunker = _best_chunker(run) or "heading_based"
    metadata = _best_metadata(run) or "rule_based"
    embedder = _least_failed(run.embedding_results, "embedder_name") or "text-embedding-3-small"
    store = _least_failed(run.vectorstore_results, "store_name") or "qdrant"

    return (
        f"Use {extractor}, `{chunker}` chunking, `{metadata}` metadata, "
        f"`{embedder}` embeddings, and `{store}` for vector writes. "
        "Credential-gated stages that skipped here should be rerun with keys configured before making a paid-tool decision."
    )


def _extraction_table(run: BenchmarkRun) -> str:
    rows = ["| File | Type | Extractor | Status | Chars | Pages | Tables | Images | Time (s) | Notes |", "|---|---|---|---:|---:|---:|---:|---:|---:|---|"]
    for r in run.extraction_results:
        status = "ok" if r.success else "skip/fail"
        notes = ", ".join(r.quality_flags) or (r.layout_notes or "")
        rows.append(
            f"| {r.file_name} | {r.file_type.value} | {r.extractor_name} | {status} | {r.char_count} | "
            f"{r.page_count} | {r.tables_detected} | {r.images_detected} | {r.extraction_time_s:.4f} | {notes} |"
        )
    return "\n".join(rows)


def _chunking_table(run: BenchmarkRun) -> str:
    grouped = defaultdict(list)
    for r in run.chunk_results:
        grouped[r.chunker_name].append(r)
    rows = ["| Chunker | Runs | Avg chunks | Avg chunk size | Oversized % | Tables split |", "|---|---:|---:|---:|---:|---:|"]
    for name, results in sorted(grouped.items()):
        rows.append(
            f"| {name} | {len(results)} | {_avg([r.num_chunks for r in results]):.2f} | "
            f"{_avg([r.avg_chunk_size for r in results]):.2f} | {_avg([r.pct_oversized for r in results]):.2f} | "
            f"{sum(r.tables_split for r in results)} |"
        )
    return "\n".join(rows)


def _metadata_table(run: BenchmarkRun) -> str:
    rows = ["| Generator | Chunks processed | Failed | Coverage % | Cost | Schema ok |", "|---|---:|---:|---:|---:|---|"]
    for r in run.metadata_results:
        rows.append(
            f"| {r.generator_name} | {r.num_chunks_processed} | {r.num_failed} | {r.coverage_pct:.2f} | "
            f"${r.estimated_cost_usd:.6f} | {r.schema_consistency_flag} |"
        )
    return "\n".join(rows)


def _embedding_table(run: BenchmarkRun) -> str:
    rows = ["| Embedder | Embedded | Failed | Dimension | Tokens | Cost | Time (s) | Notes |", "|---|---:|---:|---:|---:|---:|---:|---|"]
    for r in run.embedding_results:
        notes = r.config_used.get("skip_reason") or r.config_used.get("error", "")
        rows.append(
            f"| {r.embedder_name} | {r.num_chunks_embedded} | {r.num_failed} | {r.dimension} | {r.total_tokens} | "
            f"${r.estimated_cost_usd:.6f} | {r.embedding_time_s:.4f} | {notes} |"
        )
    return "\n".join(rows)


def _vectorstore_table(run: BenchmarkRun) -> str:
    rows = ["| Store | Written | Failures | Payload bytes | Time (s) | Notes |", "|---|---:|---:|---:|---:|---|"]
    for r in run.vectorstore_results:
        rows.append(
            f"| {r.store_name} | {r.num_vectors_written} | {r.write_failures} | {r.metadata_payload_size_bytes:.0f} | "
            f"{r.upsert_time_s:.4f} | {r.setup_notes or ''} |"
        )
    return "\n".join(rows)


def _caveats(run: BenchmarkRun) -> str:
    notes = []
    if any(r.config_used.get("skip_reason") == "credentials_not_set" for r in run.embedding_results):
        notes.append("- OpenAI embeddings skipped because `OPENAI_API_KEY` is not set.")
    if any("credentials_not_set" in r.quality_flags for r in run.extraction_results):
        notes.append("- Azure DI and/or GPT-4o VLM extraction skipped because credentials are not set.")
    if any(r.setup_notes and "unavailable" in r.setup_notes for r in run.vectorstore_results):
        notes.append("- At least one vector store was unavailable in this environment.")
    if not notes:
        notes.append("- No environment caveats recorded.")
    return "\n".join(notes)


def _avg(values) -> float:
    values = list(values)
    return sum(values) / len(values) if values else 0.0


def _best_chunker(run: BenchmarkRun) -> str | None:
    if not run.chunk_results:
        return None
    default = run.config_snapshot.get("defaults", {}).get("chunker")
    grouped = defaultdict(list)
    for result in run.chunk_results:
        grouped[result.chunker_name].append(result)
    return sorted(
        grouped,
        key=lambda name: (
            _avg([r.pct_oversized for r in grouped[name]]),
            0 if name == default else 1,
            _avg([r.num_chunks for r in grouped[name]]),
        ),
    )[0]


def _best_metadata(run: BenchmarkRun) -> str | None:
    successful = [r for r in run.metadata_results if r.coverage_pct > 0 and r.num_failed == 0]
    if not successful:
        return None
    return sorted(successful, key=lambda r: r.coverage_pct, reverse=True)[0].generator_name


def _least_failed(results, attr: str) -> str | None:
    if not results:
        return None
    return getattr(sorted(results, key=lambda r: getattr(r, "num_failed", getattr(r, "write_failures", 0)))[0], attr)
