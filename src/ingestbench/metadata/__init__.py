"""Metadata generation layer (Stage 5) -- new in this revision.

Phase 4 fills in: rule_based_metadata.py (default, free) and
llm_metadata.py (GPT-4o-mini enrichment). See ARCHITECTURE.md section 10
for why this is its own stage rather than an option on Chunker/Embedder.
"""

from ingestbench.metadata import llm_metadata, rule_based_metadata  # noqa: F401
