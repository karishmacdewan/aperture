# Enterprise Ingestion Benchmarking Tool — Architecture & Implementation Plan

**Status:** Proposal for review — no code written yet. (v2 — updated with decisions below.)
**Scope boundary:** Pipeline ends at vector database write. Retrieval, reranking, generation, and agents are explicitly out of scope (but the design leaves a clean seam for adding a retrieval-benchmarking module later).

**Decisions locked in for this revision:**
- OCR: Tesseract is the default, no-credentials-required fallback for scanned PDFs. Azure Document Intelligence remains implemented as a pluggable, optional comparison extractor (skipped gracefully if no API key is configured).
- Vector DBs: Qdrant and pgvector both run locally via Docker Compose — no cloud dependency for V1.
- Sample corpus: a generated synthetic benchmark set (not a real client corpus) covering structured documents, scanned PDFs, PowerPoints, and image-heavy documents.
- VLM extraction: GPT-4o is the first implementation; the extractor interface stays model-agnostic so Claude or other VLMs can be added later.
- Report format: Markdown only for V1. HTML/PDF export deferred.
- **New stage added: Metadata Generation**, inserted between chunking and embedding, as its own independently benchmarkable, swappable component — not a side effect of another stage.
- **Product surface: full-stack web app.** A Next.js frontend and a FastAPI backend sit on top of the engine described in Sections 1-19. The engine itself is unchanged — see Section 20 for the end-state product architecture.

---

## 1. Goals and Non-Goals

**Goals**
- Let a consultant point the tool at a small enterprise document set and get back an evidence-based recommendation for extraction, chunking, metadata, embedding, and vector-DB choices.
- Make every stage swappable and independently benchmarkable — this is a comparison engine, not a single fixed pipeline.
- Produce a client-facing report, not just raw logs.
- Be portfolio-quality: clean interfaces, typed data models, structured logging, sample output.

**Non-goals (V1)**
- Retrieval quality (precision/recall, MRR, etc.)
- Reranking
- LLM answer generation
- Agentic orchestration (no LangGraph, no multi-step agents)
- Production-scale ingestion (this is a benchmarking/eval tool for a *small* representative doc set, not a bulk ingestion pipeline)
- Cloud-hosted infrastructure (everything runs locally via Docker Compose)

---

## 2. High-Level Pipeline

```
Documents (synthetic benchmark corpus)
   │
   ▼
[1] File Type Detection ──────────────► routes each file to candidate extractors
   │
   ▼
[2] Extraction / Parsing  (native | Docling | Tesseract | Azure DI* | GPT-4o VLM)
   │                                                        *optional, key-gated
   ▼
[3] Cleaning / Normalization  (whitespace, encoding, dehyphenation, table linearization)
   │
   ▼
[4] Chunking  (fixed-size | heading-based | recursive)
   │
   ▼
[5] Metadata Generation  (rule-based | LLM-enrichment via GPT-4o-mini)   ← NEW STAGE
   │
   ▼
[6] Embedding  (text-embedding-3-small | -large)
   │
   ▼
[7] Vector DB Write  (Qdrant | pgvector — both local via Docker Compose)
   │
   ▼
[8] Benchmark Aggregation → Report Generator → client-facing report (Markdown)
```

Every stage [2]–[7] is run **once per requested configuration**, not once total. A "benchmark run" is a matrix: `{documents} × {extractors} × {chunkers} × {metadata generators} × {embedders} × {vector stores}`. The orchestrator executes each cell, records metrics, and the report compares cells against each other. This is the core design idea — the tool is a comparison harness, not a pipeline runner. (See §5 for how the matrix is kept tractable now that there are five swappable stages instead of four.)

---

## 3. Design Principles

1. **Every stage is an interface, not a function.** `Extractor`, `Chunker`, `MetadataGenerator`, `Embedder`, `VectorStore` are abstract base classes (Python `Protocol`/`ABC`). Concrete implementations register themselves; the orchestrator only ever talks to the interface.
2. **Registry pattern over hardcoded branching.** New extractors/chunkers/metadata generators/embedders/vector stores are added by writing one class and registering it under a string key (e.g. `"docling"`, `"azure_di"`, `"llm_metadata"`). No orchestrator code changes when a new implementation is added — this directly satisfies the "easy to add LlamaParse / Unstructured / Google Document AI / Claude-vision later" requirement.
3. **Stage outputs are typed, serializable data models** (pydantic), not ad-hoc dicts. This is what makes the report generator possible — it consumes structured `ExtractionResult`, `ChunkSetResult`, `MetadataResult`, `EmbeddingResult`, `VectorStoreResult` objects, never raw text.
4. **Every stage is independently timed and logged**, using a shared decorator/context manager, so timing data is consistent and never hand-rolled per stage.
5. **Config drives the run, not code.** A YAML file declares which documents, extractors, chunkers, metadata generators, embedders, and vector stores to test. Re-running a different comparison means editing config, not code.
6. **Ingestion and retrieval are separate packages from day one**, even though retrieval isn't built yet. This avoids a painful refactor later — see §16.
7. **Metadata generation is a first-class stage, not a side effect.** It's tempting to fold metadata into chunking or embedding, but enterprises make real tradeoffs here (rule-based is free and instant; LLM-enriched metadata costs money and time but produces richer payloads for future filtering). Giving it its own interface means it can be benchmarked, swapped, and reported on exactly like every other stage.
8. **Every paid external call goes through the same cost ledger.** GPT-4o vision calls (extraction), GPT-4o-mini calls (metadata), and OpenAI embedding calls all read rates from one `pricing.yaml` and write to one cost-tracking field — there's a single place that knows "how much did this run cost," not three.

---

## 4. Core Interfaces (contracts, not implementations)

These are the seams the whole system hangs off. Showing signatures only — no implementation logic — since the request is for architecture, not code.

```
Extractor (ABC)
  name: str
  supported_types: list[FileType]
  requires_credentials: bool         # True for azure_di, gpt4o_vlm — orchestrator skips gracefully if unset
  extract(file_path) -> ExtractionResult

Chunker (ABC)
  name: str
  chunk(extraction_result: ExtractionResult, config) -> ChunkSetResult

MetadataGenerator (ABC)              # NEW
  name: str
  is_llm_based: bool
  generate(chunk_set: ChunkSetResult) -> MetadataResult
  estimate_cost(token_count: int) -> float   # 0 for rule-based

Embedder (ABC)
  name: str
  dimension: int
  embed(chunk_set: ChunkSetResult, metadata: MetadataResult) -> EmbeddingResult
  estimate_cost(token_count: int) -> float

VectorStore (ABC)
  name: str
  create_collection(dimension, metadata_schema) -> None
  upsert(embedding_result: EmbeddingResult) -> VectorStoreResult
  describe() -> dict   # operational notes, e.g. index type, supported filters
```

### Data models (pydantic), what each stage actually records

**`ExtractionResult`**
extractor_name, file_name, file_type, success, extraction_time_s, char_count, page_count, tables_detected, images_detected, ocr_required (bool), ocr_method_used (none/tesseract/azure_di), failed_pages, quality_flags (list[str]), layout_notes, raw_text, structured_elements (headings/tables if available)

**`ChunkSetResult`**
chunker_name, source_extraction_id, chunks (list of `Chunk{text, char_len, metadata}`), num_chunks, avg/min/max chunk size, size_distribution_histogram, overlap_used, pct_undersized, pct_oversized, tables_split (bool/count)

**`MetadataResult`** (NEW)
generator_name, is_llm_based, source_chunk_set_id, num_chunks_processed, num_failed, fields_generated (e.g. `["title", "section", "keywords", "summary"]`), coverage_pct (chunks with every required field populated), generation_time_s, llm_input_tokens, llm_output_tokens, estimated_cost_usd, schema_consistency_flag, sample_outputs (a few example metadata payloads for the report)

**`EmbeddingResult`**
embedder_name, dimension, num_chunks_embedded, num_failed, embedding_time_s, total_tokens, estimated_cost_usd

**`VectorStoreResult`**
store_name, num_vectors_written, upsert_time_s, write_failures, metadata_fields_supported, metadata_payload_size_bytes (avg — rule-based vs LLM metadata produce very different payload sizes, worth surfacing), setup_notes, operational_notes

**`BenchmarkRun`**
run_id, timestamp, config_snapshot, list of all results above (including `metadata_results`), environment info (model versions, library versions), total_run_cost_usd (sum across extraction/metadata/embedding) — this is what gets persisted and fed to the report generator.

Each result model also carries a `config_used` field, so the report can always trace a metric back to the exact parameters (e.g. chunk_size=500, overlap=50, metadata_generator=llm) that produced it.

---

## 5. Orchestration

A single `BenchmarkOrchestrator`:
1. Loads `run_config.yaml` (documents, components to test per stage, parameters per component).
2. Builds the comparison matrix — see "ablation vs. full-factorial" below.
3. Runs each cell through stages 2→7, wrapping each stage call in the timing/logging context manager.
4. Persists every `*Result` object as it's produced (so a crash mid-run doesn't lose completed cells) — stored as JSON Lines under `runs/<run_id>/`.
5. Hands the full `BenchmarkRun` to the report generator at the end.

**Ablation mode vs. full-factorial mode (design decision):** with five swappable stages, a true cartesian product (5 extractors × 3 chunkers × 2 metadata generators × 2 embedders × 2 vector stores ≈ 120 cells per document) gets expensive and slow fast, and most of those cells aren't interesting — a client rarely needs to know how Tesseract output interacts with pgvector specifically. So the orchestrator defaults to **ablation mode**: pick one sensible default per stage, then sweep one stage at a time against that fixed baseline (this is what the sample report in §11 shows). **Full-factorial mode** is available as an explicit opt-in flag in `run_config.yaml` for smaller stage counts or when a client specifically wants the full grid. This keeps the common case fast and the report readable, while leaving the thorough option available.

Failure handling: a failed cell (e.g. Azure DI throws on a corrupt scanned PDF, or it's skipped entirely because no API key is configured) is recorded as a failed/skipped result, not a crash — the orchestrator continues the matrix and the report surfaces this as a finding ("Azure DI skipped — no credentials configured; Tesseract used as fallback for all scanned PDFs").

---

## 6. Logging & Timing

- One structured logger (`structlog` or stdlib `logging` + JSON formatter), one log line per stage invocation: `{stage, component, doc_id, run_id, duration_s, status, error}`.
- A `@timed_stage("extraction")` decorator wraps every interface method so timing capture is uniform and can't be forgotten in a new extractor/chunker/metadata-generator implementation.
- Logs write to `runs/<run_id>/run.log`; metrics also get written structured (not just printed) so the report generator never re-derives numbers from log text.

---

## 7. Cost Estimation

Cost is no longer just an embedding-layer concern — GPT-4o vision calls (extraction) and GPT-4o-mini calls (LLM metadata generation) are real paid stages too. One `pricing.yaml` holds $/1M-token rates for every model used anywhere in the pipeline:

```yaml
# embedding models (input only — no output tokens for embeddings)
text-embedding-3-small: { input_per_1m_usd: 0.02 }
text-embedding-3-large:  { input_per_1m_usd: 0.13 }

# chat/vision models (input + output tokens)
gpt-4o:       { input_per_1m_usd: 2.50, output_per_1m_usd: 10.00 }   # VLM extraction
gpt-4o-mini:  { input_per_1m_usd: 0.15, output_per_1m_usd: 0.60 }    # LLM metadata generation
```

(Current OpenAI list pricing as of mid-2026 — see Sources.) Keeping this in config rather than hardcoded means the tool doesn't go stale when pricing changes — it's a one-line edit. `estimate_cost()` on each interface reads this table and multiplies by actual token counts (via `tiktoken` for text, and OpenAI's documented image-tokenization rule for GPT-4o vision input), giving real, defensible cost numbers rather than rough guesses.

The report's cost section therefore covers three line items, not one: **extraction cost** (only non-zero when GPT-4o VLM was used — native/Docling/Tesseract/Azure DI are flat-fee or free), **metadata generation cost** (only non-zero for the LLM-based generator), and **embedding cost**. All three are extrapolated to "cost per 1,000 pages" so clients can scale the estimate to their actual corpus size, and a `total_run_cost_usd` rolls them up for the executive summary.

---

## 8. Extraction Layer (V1 detail)

| Extractor | Best for | Credentials? | V1? |
|---|---|---|---|
| Native (PyMuPDF / pdfplumber for PDF, python-docx, python-pptx) | Machine-readable PDFs, Word, PowerPoint — fast, free | None | Yes |
| Docling (IBM, open source) | Layout-aware extraction, tables, reading order, mixed PDFs | None | Yes |
| **Tesseract (default OCR fallback)** | Scanned PDFs / image-only pages — open source, runs anywhere | None | Yes — default |
| Azure Document Intelligence (pluggable) | Higher-fidelity OCR, forms, complex tables — compared against Tesseract when a key is available | API key | Yes — optional, skipped gracefully if unconfigured |
| **GPT-4o VLM (first VLM implementation)** | Images/screenshots, diagrams, visually dense slides | API key | Yes |
| LlamaParse | Complex PDFs, markdown-faithful output | — | Deferred — registry stub only |
| Unstructured | Broad format coverage, partitioning | — | Deferred — registry stub only |
| Google Document AI | Enterprise OCR/forms alternative to Azure | — | Deferred — registry stub only |
| Claude-vision (or other VLM) | Alternate VLM for comparison against GPT-4o | API key | Deferred — registry stub only, same `VLMExtractor` interface as GPT-4o |

File-type detection (stage 1) uses extension + MIME sniff + a quick heuristic (e.g., near-zero extractable text on a PDF page ⇒ flag `ocr_required=True`, route to Tesseract by default, and additionally to Azure DI if configured, so the two can be compared side by side on the same pages).

**Why Tesseract as default rather than Azure DI:** it requires no account, no key, and no network call, so the tool works out of the box for anyone cloning the repo — a meaningful portfolio consideration. Azure DI is kept fully implemented (not just a stub) because it's a realistic enterprise choice and the report should be able to say "Tesseract recovered 71% of characters on this scan; Azure DI recovered 94% — here's the cost/quality tradeoff" whenever a key is present.

---

## 9. Chunking Layer (V1 detail)

- **Fixed-size**: character/token windows with configurable overlap. Simplest baseline.
- **Heading-based**: uses structural signal captured by the extractor (markdown headers, DOCX heading styles, detected PDF section headers) to chunk along document structure.
- **Recursive**: hierarchical splitter (paragraph → sentence → character fallback) implemented directly — not via a LangChain dependency, to keep the dependency surface clean and avoid any confusion with the excluded agent/orchestration frameworks.
- **Semantic chunking**: registry stub for V2 (embedding-similarity-based splitting), not implemented now since it depends on the embedding layer and would couple stages.

All chunkers report whether a detected table was split across chunk boundaries — a known failure mode worth surfacing to clients directly.

---

## 10. Metadata Generation Layer (NEW — V1 detail)

This stage takes a `ChunkSetResult` and produces structured metadata per chunk, intended for the payload that eventually gets stored alongside each vector. It does not touch the chunk text itself.

| Generator | What it produces | Cost | V1? |
|---|---|---|---|
| **Rule-based** | Pulled directly from structure already captured upstream: source filename, page number, detected heading/section path, chunk index, char length, table/image flags inherited from extraction | Free, near-instant | Yes — default |
| **LLM-enrichment (GPT-4o-mini)** | Adds a 1-sentence chunk summary, 3–5 keywords, and a coarse content-type tag (e.g. "procedure", "definition", "table data") generated per chunk | Paid (input + output tokens), see §7 | Yes |

**Comparison axes captured:** generation time, cost, coverage (% of chunks with every expected field populated — rule-based should be ~100%, LLM-based can fail/timeout on a chunk), schema consistency (does the LLM reliably return parseable JSON, or does it drift), and a handful of sample payloads included directly in the report so a reader can judge metadata quality themselves rather than trust a single score.

**Why this is its own stage and not bundled into chunking or embedding:** rule-based and LLM-based metadata have genuinely different operational profiles (free/instant vs. paid/slower, and qualitatively different payload richness), and a client choosing between them is making a real architecture decision independent of which chunker or embedder they pick. Modeling it as a parallel swappable stage — rather than an option flag buried inside the chunker — keeps it benchmarkable on its own terms and keeps the `Chunker` and `Embedder` interfaces from growing responsibilities they shouldn't have.

---

## 11. Embedding & Vector DB Layers (V1 detail)

**Embedding**: `text-embedding-3-small` and `text-embedding-3-large` via OpenAI SDK, batched calls with retry/backoff, token counting via `tiktoken` for accurate cost estimates, dimension and failure tracking. The embedder receives both the chunk text and the generated metadata, since metadata fields (e.g. a chunk summary) are a legitimate input to embedding strategy comparisons later, even though V1 always embeds chunk text only — the signature is shaped now so that decision doesn't require an interface change later.

**Vector DB**: Qdrant and pgvector, **both running locally via Docker Compose** (`docker-compose.yml` at the repo root spins up both services — no cloud account needed to reproduce results). Qdrant offers a native vector index with rich payload filtering; pgvector is the relevant comparison for enterprises with existing Postgres infrastructure and a preference for "boring," already-operated infra. Both implement the same `VectorStore` interface, so write performance, metadata payload handling, and operational tradeoffs are reported side by side.

---

## 12. Synthetic Benchmark Document Set

Since this is a portfolio tool rather than a client engagement, the sample corpus is **generated, not sourced** — `sample_docs/generate_synthetic_docs.py` deterministically produces a small, reproducible benchmark set across four categories, each exercising a different part of the extraction layer:

| Category | Format | Generated with | Exercises |
|---|---|---|---|
| Structured documents | DOCX + machine-readable PDF, with headings, paragraphs, and at least one multi-row table | `python-docx`, `reportlab` | Native extraction, heading-based chunking |
| Scanned PDFs | PDF with no extractable text layer (text rendered to an image, then assembled into a PDF — i.e. an actual scan, not a PDF with a hidden text layer) | `Pillow` + `reportlab` | OCR routing, Tesseract vs. Azure DI |
| PowerPoints | PPTX with title slides, bulleted content, and at least one embedded chart image | `python-pptx`, `matplotlib` (for the chart image) | Native PPTX extraction, image detection |
| Image-heavy documents | Standalone PNG/JPG "screenshots" containing dense text and a simple diagram | `Pillow` | GPT-4o VLM extraction |

Each generated document carries a small **ground-truth manifest** (known heading count, known table count, known page count, the exact text that was rendered) stored alongside it as JSON. This lets the extraction comparison report a real accuracy figure ("Docling recovered 8/9 known headings; native PDF extraction recovered 3/9") instead of only self-reported confidence — a meaningfully stronger claim for a portfolio piece, and something a synthetic corpus makes easy precisely because the ground truth is known by construction.

**Caveat carried into the report:** a synthetic corpus validates the engineering (the pipeline works, the comparisons are fair) but isn't a substitute for testing against a client's actual documents, which have messier formatting, inconsistent structure, and domain-specific layout quirks. The sample report's Risks/Caveats section says this explicitly.

---

## 13. Report Generator

Report is built from a Jinja2 template over the final `BenchmarkRun` object, rendered to **Markdown only for V1** (HTML/PDF export deferred — registry-level hook left in place so a renderer can be swapped in later without touching the template content). Sections map directly to the requested output, with one addition for the new metadata stage:

1. Executive Summary
2. Tested Configurations (the full matrix or ablation sweep, in a table)
3. Extraction Comparison (per-extractor metrics, ground-truth accuracy where available, qualitative notes)
4. Chunking Comparison
5. **Metadata Generation Comparison** (NEW — coverage, cost, sample payloads)
6. Cost Comparison (extraction VLM cost + metadata LLM cost + embedding cost, with cost-per-1,000-pages extrapolation)
7. Vector DB Storage Comparison
8. Recommended Ingestion Configuration (the answer to "what should we use and why")
9. Risks / Caveats (failures, skipped components, synthetic-corpus caveat, edge cases)
10. Next Recommended Step (always: "retrieval benchmarking" — written deliberately to hand off into the future retrieval module)

A condensed sample excerpt (full mock report will be produced once the pipeline runs against the synthetic corpus):

```
## Recommended Ingestion Configuration

For this synthetic benchmark set (4 categories: structured docs, scanned
PDFs, PowerPoints, image-heavy documents):

- Extraction: Docling for structured docs and PPTX; Tesseract for scanned
  PDFs (Azure DI not configured for this run — see Risks); GPT-4o VLM for
  image-heavy documents (native/Docling extracted 0 characters from these).
- Chunking: Heading-based, 400-600 char target, 15% overlap — fixed-size
  split 2 of 3 known tables mid-row; heading-based did not.
- Metadata: Rule-based for this corpus size — LLM-enrichment added
  $0.04 and 1.8s per document for keyword/summary tags that didn't change
  the recommendation; revisit if downstream filtering needs become richer.
- Embedding: text-embedding-3-small — large model's quality delta did not
  justify a 6.5x cost increase for this corpus.
- Vector DB: Qdrant — faster upsert at this volume; pgvector remains
  preferable if the client already operates Postgres at scale.
```

---

## 14. Project Folder Structure

```
ingestion-benchmark/
├── README.md
├── ARCHITECTURE.md
├── pyproject.toml
├── docker-compose.yml             # qdrant + postgres(pgvector) services, local-only
├── configs/
│   ├── run_config.yaml           # which docs/components to test, ablation vs. full-factorial
│   └── pricing.yaml              # embedding + chat/vision model $ rates (editable)
├── sample_docs/
│   ├── generate_synthetic_docs.py
│   ├── structured/                # DOCX + machine-readable PDF + ground_truth.json
│   ├── scanned/                   # rendered-to-image PDF + ground_truth.json
│   ├── powerpoint/                # PPTX with embedded chart + ground_truth.json
│   └── image_heavy/               # PNG/JPG screenshots + ground_truth.json
├── src/
│   └── ingestbench/
│       ├── core/
│       │   ├── interfaces.py     # Extractor/Chunker/MetadataGenerator/Embedder/VectorStore ABCs
│       │   ├── models.py         # pydantic result models
│       │   ├── registry.py       # component registration
│       │   ├── timing.py         # @timed_stage decorator
│       │   ├── cost_ledger.py    # reads pricing.yaml, rolls up total_run_cost_usd
│       │   └── logging_setup.py
│       ├── extraction/
│       │   ├── native_extractor.py
│       │   ├── docling_extractor.py
│       │   ├── tesseract_extractor.py
│       │   ├── azure_di_extractor.py      # key-gated, skipped gracefully if unset
│       │   ├── gpt4o_vlm_extractor.py
│       │   └── stubs/            # llamaparse.py, unstructured.py, google_docai.py, claude_vlm.py
│       ├── chunking/
│       │   ├── fixed_size.py
│       │   ├── heading_based.py
│       │   └── recursive.py
│       ├── metadata/              # NEW
│       │   ├── rule_based_metadata.py
│       │   ├── llm_metadata.py    # GPT-4o-mini
│       │   └── stubs/
│       ├── embedding/
│       │   └── openai_embedder.py
│       ├── vectorstore/
│       │   ├── qdrant_store.py
│       │   └── pgvector_store.py
│       ├── orchestration/
│       │   ├── orchestrator.py   # ablation + full-factorial modes
│       │   └── run_config_loader.py
│       └── reporting/
│           ├── report_builder.py
│           └── templates/
│               └── benchmark_report.md.j2
├── runs/                          # persisted run outputs (gitignored)
│   └── <run_id>/{run.log, results.jsonl, report.md}
├── retrieval_bench/                # EMPTY placeholder package for the future
│   └── README.md                   # "not implemented — see ARCHITECTURE.md §16 for the seam"
└── tests/
    └── ...mirrors src structure...
```

`retrieval_bench/` exists as an empty, documented placeholder specifically so the extensibility requirement is visible in the repo itself, not just promised in prose.

---

## 15. Tech Stack (with rationale)

| Choice | Why |
|---|---|
| Python 3.11+ | Native ecosystem support for every tool listed (Docling, Tesseract bindings, Azure SDK, OpenAI SDK, Qdrant/psycopg) |
| pydantic v2 | Typed, serializable result models — required for the report generator to consume structured data instead of parsing logs |
| Typer (CLI) | Thin, typed CLI for `run`, `report`, `list-components`, `generate-sample-docs` commands |
| YAML configs | Human-editable run matrix and pricing table, no code changes to re-run a comparison |
| JSON Lines for run storage | Crash-safe incremental writes, simple to inspect/diff between runs |
| Jinja2 | Report templating, separates content from presentation |
| `tiktoken` | Accurate token counts for cost estimation (text and chat models) |
| Docker Compose | Local Qdrant + Postgres/pgvector, zero cloud dependency, one command to stand up both backends |
| `pytesseract` + system Tesseract | Default, no-credentials OCR path |
| Docling, Azure AI Document Intelligence SDK, OpenAI SDK (embeddings + GPT-4o + GPT-4o-mini), `qdrant-client`, `psycopg[binary]` + `pgvector` | One library per external dependency, each isolated behind its interface implementation |

---

## 16. MVP Scope (V1)

**In scope for V1**
- Document types: machine-readable PDF, scanned PDF, DOCX, PPTX, images/screenshots, plain text/Markdown — covered via the four synthetic corpus categories (plain text/Markdown included as a trivial positive control with near-zero extraction risk).
- Extractors: native, Docling, Tesseract (default), Azure DI (optional, key-gated), GPT-4o VLM.
- Chunkers: fixed-size, heading-based, recursive.
- Metadata generators: rule-based (default), LLM-enrichment via GPT-4o-mini.
- Embedders: text-embedding-3-small, text-embedding-3-large.
- Vector DBs: Qdrant, pgvector — both via Docker Compose.
- Report generator: Markdown only.
- Synthetic benchmark corpus generator with ground-truth manifests.

**Explicitly deferred (registry stubs only, not built)**
- LlamaParse, Unstructured, Google Document AI, Claude-vision extractors.
- Semantic chunking.
- HTML/PDF report export.
- Retrieval benchmarking module.
- Any agent/orchestration layer (LangGraph or otherwise).

This MVP scope is intentionally the full breadth the brief asked for, made tractable by depth-limiting each component (one or two reasonable default implementations per slot) rather than narrowing the document/format coverage — coverage breadth is the differentiator for a consultant-facing tool.

---

## 17. Phased Implementation Plan

| Phase | Deliverable |
|---|---|
| 0 | Repo scaffold, interfaces, data models, registry, logging/timing utilities, cost ledger, `docker-compose.yml`, `pricing.yaml`, config loader |
| 1 | Synthetic document generator — all four categories, with ground-truth manifests |
| 2 | Extraction layer: native, Docling, Tesseract, Azure DI (optional), GPT-4o VLM — validated against ground truth on the synthetic set |
| 3 | Chunking layer: all three strategies running on Phase 2 outputs, distribution/quality metrics |
| 4 | **Metadata generation layer**: rule-based + LLM-enrichment, cost tracking wired to `pricing.yaml` |
| 5 | Embedding layer: both OpenAI models, cost estimator wired to `pricing.yaml` |
| 6 | Vector DB layer: Qdrant + pgvector via Docker Compose |
| 7 | Orchestrator: ablation mode end-to-end, full-factorial mode as opt-in, persisted results |
| 8 | Report generator: Markdown template, real sample report against the synthetic corpus |
| 9 | Polish: README, tests, edge cases (corrupt PDF, empty file, a deliberately low-quality scan to confirm the Tesseract fallback actually triggers) |

---

## 18. Extensibility (how future additions plug in)

- **New extractor** (e.g. LlamaParse, Claude-vision): implement `Extractor`, register under a new key in `extraction/`, add one line to `run_config.yaml`. No orchestrator, model, or report changes required.
- **New metadata generator** (e.g. a cheaper local model, or entity extraction): same pattern in `metadata/`.
- **Retrieval benchmarking later**: lives entirely in `retrieval_bench/`, reads from the same `VectorStoreResult`/collections this tool already wrote, and produces its own report. It depends on this tool's outputs; this tool has zero dependency on it — one-directional coupling, safe to build later without touching ingestion code.

---

## 19. Risks, Caveats & Open Questions

1. **Combinatorial matrix size**: with 5 swappable stages, full-factorial mode produces a large number of cells even on a small corpus. Ablation mode is the default for this reason (see §5) — flag if you'd rather default to full-factorial for the synthetic corpus specifically, since it's small enough to make that affordable.
2. **GPT-4o-mini as the LLM metadata generator**: chosen over full GPT-4o for cost, since chunk-level summary/keyword tagging doesn't obviously need the larger model. Flag if you want GPT-4o itself as the LLM option instead, or both as separate registry entries.
3. **Tesseract quality ceiling**: Tesseract is free and dependency-light but generally less accurate than cloud OCR on noisy/dense scans. That's expected and is exactly the tradeoff the report should surface — flagging only so it's not mistaken for a bug when Tesseract's recovered-character-count looks worse than Azure DI's in the comparison.
4. **Synthetic corpus realism**: validates engineering correctness, not real-world document messiness. The report will state this caveat explicitly rather than implicitly overclaiming.

---

## 20. End-State Product Architecture (Web Application)

**Decision locked in:** the engine described in Sections 1-19 ships unchanged. A product layer sits on top of it: a Next.js frontend talking to a FastAPI backend that wraps the orchestrator. This section is the single source of truth for that layer.

### 20.1 Four layers

1. **Frontend product (new)** — Next.js. The browser UI: upload, configure, view results, browse history, compare runs.
2. **Backend API / product service (new)** — FastAPI. Turns engine calls into a multi-user, asynchronous web product: job orchestration, persistence, file storage.
3. **Backend benchmark engine (existing, Sections 1-19, unchanged)** — `ingestbench`. Knows nothing about HTTP, users, or jobs.
4. **Benchmarked infrastructure (existing, unchanged)** — Qdrant, pgvector, OpenAI, Azure DI, Tesseract: the systems being evaluated, not part of the product stack.

The dependency direction is one-way: the API imports `ingestbench` and calls its public interfaces (`Registry`, `BenchmarkOrchestrator`, the pydantic result models). The engine has zero awareness of the API — the same one-directional principle already used for `retrieval_bench/` (Section 18).

### 20.2 Frontend (Next.js) — pages

| Route | Purpose | Key API calls |
|---|---|---|
| `/upload` | Drag-and-drop document upload, immediate file-type detection feedback | `POST /api/documents` |
| `/runs/new` | Benchmark configuration builder: ablation vs. full-factorial, per-stage component pickers populated live from the registry | `GET /api/components`, `POST /api/runs` |
| `/runs/[runId]` | Results dashboard: live status while running; once complete, recommended configuration, cost breakdown, and four chart panels (extraction, chunking, embedding, vector DB metrics) rendered with Recharts directly from the structured `BenchmarkRun` JSON | `GET /api/runs/{id}` (polled while running) |
| `/runs` | Benchmark history: every past run, status, corpus, config summary | `GET /api/runs` |
| `/runs/compare?ids=a,b` | Side-by-side comparison: the same four chart panels overlaid across two or more runs, plus a diff of recommended configuration | `GET /api/runs/{id}` for each selected id |

Every results/comparison page also has a "Download report (.md)" button calling `GET /api/runs/{id}/report.md` — the existing Jinja2 Markdown template (Section 13), generated on demand, unchanged. The charts are the primary read surface; Markdown is an export, not the UI.

### 20.3 Backend API (FastAPI) — endpoints

| Endpoint | Wraps | Notes |
|---|---|---|
| `GET /api/components` | `registry.names(stage)` for every stage | The registry built for pluggability (Design Principle 2) is the API's source of truth for what's selectable — the frontend never hardcodes a component list |
| `POST /api/documents` | Storage abstraction + file-type detection | Engine logic, unchanged |
| `POST /api/runs` | Validates config, creates a run record, enqueues a background job | Calls `BenchmarkOrchestrator` |
| `GET /api/runs` | Lists run history from the app database | — |
| `GET /api/runs/{id}` | Run status while running; full `BenchmarkRun` JSON once complete | The pydantic model already exists (Section 4) — FastAPI serializes it directly, no new schema layer |
| `GET /api/runs/{id}/report.md` | Renders the Markdown report on demand | `reporting/report_builder.py`, unchanged |
| `GET /api/runs/compare` | Fetches and merges multiple `BenchmarkRun` records | Powers the comparison view |

### 20.4 What stays exactly as designed

- The orchestrator, all five pipeline stages, the registry, the cost ledger, the logging/timing decorator, the Markdown report template — none of this changes. The API layer's only job is to call the orchestrator and persist/serve the result.
- The pydantic v2 result models (Section 4) double as the API's response schemas — the payoff of Design Principle 3 (typed, serializable stage outputs), originally justified by "the report generator needs structured data," turns out to be exactly what an API needs too.
- The registry pattern (Design Principle 2) doubles as the `/components` endpoint. Adding a new extractor later (Section 18) still requires zero changes to the API or frontend — it shows up as a new option in the configuration UI automatically.

### 20.5 New infrastructure this adds

- **Job execution, tiered:** V1 — FastAPI background tasks, no new infra. V2 — swap in a real queue (arq/Celery + Redis) when concurrent multi-user runs are needed, without touching the orchestrator call site.
- **Persistence:** Postgres for run/job metadata (runs, jobs, uploaded-file records) — a logically separate database from the pgvector instance being benchmarked, even if both run on the same local Docker Postgres server for convenience.
- **File/artifact storage:** local disk for V1 (uploaded docs, generated reports, run logs), behind a small pluggable storage interface so object storage (S3-compatible) is a later swap, not a rewrite.
- **Live progress:** REST polling for V1 — the orchestrator already persists each result incrementally as JSON Lines (Section 5), so polling `/api/runs/{id}` just reads further into that stream. SSE/WebSocket streaming is a natural upgrade, not a redesign.
- **Charting:** Recharts on the frontend, fed directly from the `BenchmarkRun` JSON — no separate analytics service.
- **Auth:** out of scope for V1 (single consultant, local or single-tenant use); a V2 concern if this is ever hosted multi-tenant.

### 20.6 Folder structure addendum

```
ingestion-benchmark/
├── src/ingestbench/        # unchanged -- the engine, Sections 1-19
├── api/                     # NEW -- FastAPI service
│   ├── main.py
│   ├── routers/             # components.py, documents.py, runs.py
│   ├── jobs.py              # background job runner wrapping BenchmarkOrchestrator
│   ├── db/                  # SQLAlchemy models + migrations for run/job metadata
│   └── storage.py           # pluggable file/artifact storage interface
├── web/                     # NEW -- Next.js frontend
│   ├── app/
│   │   ├── upload/
│   │   └── runs/
│   │       ├── new/
│   │       ├── [runId]/
│   │       └── compare/
│   ├── components/          # chart panels, config builder, upload widget
│   └── lib/api-client.ts
├── sample_docs/             # unchanged
├── docker-compose.yml       # gains an app-db Postgres service (or a separate database on the existing one)
└── ...
```

`api/` imports `ingestbench` as a normal pip dependency and never reaches into internals beyond the public interfaces, registry, and models that already exist. `web/` never talks to Python directly — it only calls the FastAPI HTTP layer.

### 20.7 Phased plan addendum

| Phase | Deliverable |
|---|---|
| 10 | FastAPI service: `/components`, `/documents`, `/runs` (create/list/detail), job runner, Postgres-backed run/job persistence, local file storage |
| 11 | `/api/runs/{id}/report.md` export endpoint -- thin wrapper around the existing report_builder |
| 12 | Next.js app: upload page, configuration builder, results dashboard with the four chart panels (extraction, chunking, embedding, vector DB) |
| 13 | Benchmark history list + run comparison view |

Phases 2-9 (the engine itself) are unaffected by and unordered relative to 10-13 -- the API layer can be scaffolded in parallel once the engine's interfaces are stable, which they already are as of Phase 0.

---

## Sources (pricing data used in §7)

- [text-embedding-3-small Model | OpenAI API](https://developers.openai.com/api/docs/models/text-embedding-3-small)
- [text-embedding-3-large Model | OpenAI API](https://platform.openai.com/docs/models/text-embedding-3-large)
- [OpenAI Embedding Pricing 2026 — TokenMix](https://tokenmix.ai/blog/openai-embedding-pricing)
- [OpenAI API Pricing](https://openai.com/api/pricing/)
- [GPT-4o API Pricing 2026 — PricePerToken](https://pricepertoken.com/pricing-page/model/openai-gpt-4o)
- [GPT-4o-mini API Pricing 2026 — PricePerToken](https://pricepertoken.com/pricing-page/model/openai-gpt-4o-mini)
