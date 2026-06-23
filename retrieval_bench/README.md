# retrieval_bench (not implemented)

This package is intentionally empty.

When retrieval benchmarking is built, it lives here -- reading from the
`VectorStoreResult`/collections that `ingestbench` already wrote (Qdrant
collections, pgvector tables) and producing its own report. The dependency
is one-directional: `retrieval_bench` depends on `ingestbench`'s outputs,
and `ingestbench` has zero dependency on `retrieval_bench`. That means
retrieval benchmarking can be designed and built later without touching
any ingestion code.

See ARCHITECTURE.md section 18 ("Extensibility") for the full reasoning.
