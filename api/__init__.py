"""FastAPI product layer over the unchanged `ingestbench` engine.

See ARCHITECTURE.md section 20 -- this package only calls the engine's
public interfaces (registry, BenchmarkOrchestrator, pydantic models) and
adds job orchestration, persistence, and file storage on top.
"""
