"""Command-line entry point for ingestbench."""

from __future__ import annotations

import argparse
from pathlib import Path

from ingestbench.orchestration import BenchmarkOrchestrator
from ingestbench.reporting.report_builder import load_run, write_markdown_report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ingestbench")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run", help="Run benchmark and write a Markdown report")
    run_parser.add_argument("--config", default="configs/run_config.yaml")
    run_parser.add_argument("--run-id", default=None)

    report_parser = subparsers.add_parser("report", help="Render report.md from an existing results.json")
    report_parser.add_argument("results_json")
    report_parser.add_argument("--out", default=None)

    subparsers.add_parser("list-components", help="List registered pipeline components")

    args = parser.parse_args(argv)

    if args.command == "run":
        config_path = Path(args.config)
        orchestrator = BenchmarkOrchestrator(config_path)
        run = orchestrator.run(run_id=args.run_id)
        run_dir = config_path.resolve().parents[1] / "runs" / run.run_id
        report_path = write_markdown_report(run, run_dir / "report.md")
        print(f"Run complete: {run_dir}")
        print(f"Report: {report_path}")
        return 0

    if args.command == "report":
        run = load_run(args.results_json)
        out = Path(args.out) if args.out else Path(args.results_json).with_name("report.md")
        report_path = write_markdown_report(run, out)
        print(f"Report: {report_path}")
        return 0

    if args.command == "list-components":
        _import_components()
        from ingestbench.core.registry import registry

        for stage in ["extractor", "chunker", "metadata_generator", "embedder", "vector_store"]:
            print(f"{stage}: {', '.join(registry.names(stage))}")
        return 0

    return 1


def _import_components() -> None:
    import ingestbench.chunking  # noqa: F401
    import ingestbench.embedding  # noqa: F401
    import ingestbench.extraction  # noqa: F401
    import ingestbench.metadata  # noqa: F401
    import ingestbench.vectorstore  # noqa: F401


if __name__ == "__main__":
    raise SystemExit(main())
