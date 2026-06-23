"""Uniform timing + logging for every stage call.

Every concrete Extractor/Chunker/MetadataGenerator/Embedder/VectorStore
method wraps its core method with @timed_stage(...) so timing data is
captured the same way everywhere, instead of being hand-rolled (and
sometimes forgotten) per implementation.
"""

from __future__ import annotations

import functools
import time
from typing import Callable, TypeVar

from ingestbench.core.logging_setup import get_logger

F = TypeVar("F", bound=Callable)

# Maps stage name -> the result-model field that should receive the
# measured elapsed time, if the field is still at its default (0.0).
_STAGE_TIME_FIELDS = {
    "extraction": "extraction_time_s",
    "metadata": "generation_time_s",
    "embedding": "embedding_time_s",
    "vectorstore": "upsert_time_s",
}


def timed_stage(stage: str) -> Callable[[F], F]:
    def decorator(func: F) -> F:
        @functools.wraps(func)
        def wrapper(self, *args, **kwargs):
            log = get_logger(stage=stage, component=getattr(self, "name", type(self).__name__))
            start = time.perf_counter()
            try:
                result = func(self, *args, **kwargs)
            except Exception as exc:
                elapsed = round(time.perf_counter() - start, 4)
                log.error("stage_failed", duration_s=elapsed, error=str(exc))
                raise

            elapsed = round(time.perf_counter() - start, 4)
            time_field = _STAGE_TIME_FIELDS.get(stage)
            if time_field is not None and hasattr(result, time_field):
                if not getattr(result, time_field):
                    setattr(result, time_field, elapsed)
            log.info("stage_complete", duration_s=elapsed, status="success")
            return result

        return wrapper

    return decorator
