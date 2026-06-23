"""Background job runner wrapping BenchmarkOrchestrator.

V1 uses FastAPI's BackgroundTasks (no new infra); Starlette runs sync
callables like this one in a threadpool automatically, so the event loop
stays free while a run executes. Swapping in a real queue (arq/Celery +
Redis) later only means changing how this function gets called, not its
body -- see ARCHITECTURE.md section 20.5.
"""

from __future__ import annotations

import traceback
from pathlib import Path

import yaml

from api.db import RunRecord, get_session
from api.storage import PROJECT_ROOT
from ingestbench.orchestration.orchestrator import BenchmarkOrchestrator
from ingestbench.reporting.report_builder import write_markdown_report

RUN_CONFIGS_DIR = PROJECT_ROOT / "configs"


def write_run_config(run_id: str, config: dict) -> Path:
    # BenchmarkOrchestrator derives project_root as config_path.parents[1], so
    # the generated config must live exactly one level below the project
    # root -- same depth as configs/run_config.yaml -- not in a subdirectory.
    RUN_CONFIGS_DIR.mkdir(parents=True, exist_ok=True)
    path = RUN_CONFIGS_DIR / f"_generated_{run_id}.yaml"
    path.write_text(yaml.safe_dump(config), encoding="utf-8")
    return path


def execute_run(run_id: str, config_path: str) -> None:
    session = get_session()
    try:
        record = session.get(RunRecord, run_id)
        if record is None:
            return
        record.status = "running"
        session.commit()

        orchestrator = BenchmarkOrchestrator(config_path=config_path)
        run = orchestrator.run(run_id=run_id)
        run_dir = PROJECT_ROOT / "runs" / run.run_id
        write_markdown_report(run, run_dir / "report.md")

        record = session.get(RunRecord, run_id)
        record.status = "complete"
        from datetime import datetime, timezone

        record.completed_at = datetime.now(timezone.utc)
        session.commit()
    except Exception:
        record = session.get(RunRecord, run_id)
        if record is not None:
            record.status = "failed"
            record.error = traceback.format_exc()
            session.commit()
    finally:
        session.close()
