"""GET /api/components -- the registry is the single source of truth for
what's selectable, so the frontend never hardcodes a component list."""

from __future__ import annotations

from fastapi import APIRouter

from ingestbench.core.registry import STAGES, registry

router = APIRouter()


@router.get("/components")
def list_components() -> dict[str, list[str]]:
    return {stage: registry.names(stage) for stage in STAGES}
