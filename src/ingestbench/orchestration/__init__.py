"""Builds and runs the comparison matrix (ablation or full-factorial mode).

Phase 7 fills in: orchestrator.py, run_config_loader.py.
See ARCHITECTURE.md section 5 for ablation-vs-full-factorial reasoning.
"""

from ingestbench.orchestration.orchestrator import BenchmarkOrchestrator  # noqa: F401
from ingestbench.orchestration.run_config_loader import load_run_config  # noqa: F401
