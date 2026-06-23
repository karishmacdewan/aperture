"""Structured (JSON) logging shared by every stage.

Every stage invocation produces one log line:
  {stage, component, doc_id, run_id, duration_s, status, error}
written to both stdout and runs/<run_id>/run.log, so the report generator
never has to re-derive numbers by parsing free-text logs -- metrics live in
the typed result models (core/models.py), and these logs are purely for
human/debugging visibility.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import IO

import structlog


class _MultiWriter:
    """Writes every message to several streams (console + run.log)."""

    def __init__(self, *streams: IO[str]) -> None:
        self._streams = streams

    def write(self, msg: str) -> None:
        for stream in self._streams:
            stream.write(msg)

    def flush(self) -> None:
        for stream in self._streams:
            stream.flush()


def configure_logging(run_id: str, runs_dir: Path = Path("runs")) -> Path:
    """Call once at the start of an orchestrator run. Returns the log path."""
    run_dir = runs_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    log_path = run_dir / "run.log"

    file_stream = open(log_path, "a", buffering=1)
    multi = _MultiWriter(sys.stdout, file_stream)

    structlog.configure(
        processors=[
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.add_log_level,
            structlog.processors.JSONRenderer(),
        ],
        logger_factory=structlog.PrintLoggerFactory(file=multi),
        cache_logger_on_first_use=False,
    )
    return log_path


def get_logger(**initial_context):
    """structlog.get_logger(), pre-bound with whatever context is given."""
    logger = structlog.get_logger()
    return logger.bind(**initial_context) if initial_context else logger
