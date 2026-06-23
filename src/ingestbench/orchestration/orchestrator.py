"""Pipeline orchestrator for extraction through vector-store write."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from ingestbench.core.models import (
    BenchmarkRun,
    ChunkSetResult,
    EmbeddingResult,
    ExtractionResult,
    MetadataResult,
    VectorStoreResult,
)
from ingestbench.core.registry import registry
from ingestbench.extraction.file_types import detect_file_type
from ingestbench.orchestration.run_config_loader import load_run_config


class BenchmarkOrchestrator:
    def __init__(self, config_path: Path | str = Path("configs/run_config.yaml")) -> None:
        self.config_path = Path(config_path)
        self.config = load_run_config(self.config_path)
        self.project_root = self.config_path.resolve().parents[1]
        self._import_components()

    def run(self, run_id: str | None = None) -> BenchmarkRun:
        run_id = run_id or uuid.uuid4().hex[:12]
        run_dir = self.project_root / "runs" / run_id
        run_dir.mkdir(parents=True, exist_ok=True)

        run = BenchmarkRun(
            run_id=run_id,
            run_name=self.config.get("run_name", ""),
            config_snapshot=self.config,
            environment={"project_root": str(self.project_root)},
        )

        documents = self._documents()
        chosen_extractions: list[ExtractionResult] = []
        for document in documents:
            extraction_results = self._run_extractors(document)
            run.extraction_results.extend(extraction_results)
            chosen = self._best_extraction(extraction_results)
            if chosen:
                chosen_extractions.append(chosen)

        chosen_chunks: list[ChunkSetResult] = []
        for extraction in chosen_extractions:
            chunk_results = self._run_chunkers(extraction)
            run.chunk_results.extend(chunk_results)
            chosen = self._default_or_first(chunk_results, self.config["defaults"]["chunker"])
            if chosen:
                chosen_chunks.append(chosen)

        chosen_metadata = []
        for chunk_set in chosen_chunks:
            metadata_results = self._run_metadata_generators(chunk_set)
            run.metadata_results.extend(metadata_results)
            chosen = self._default_or_first(metadata_results, self.config["defaults"]["metadata_generator"])
            if chosen:
                chosen_metadata.append((chunk_set, chosen))

        chosen_embeddings = []
        for chunk_set, metadata in chosen_metadata:
            embedding_results = self._run_embedders(chunk_set, metadata)
            run.embedding_results.extend(embedding_results)
            for embedding in embedding_results:
                chosen_embeddings.append((embedding, metadata))

        for embedding, metadata in chosen_embeddings:
            run.vectorstore_results.extend(self._run_vectorstores(embedding, metadata))

        self._persist(run, run_dir)
        return run

    def _import_components(self) -> None:
        import ingestbench.chunking  # noqa: F401
        import ingestbench.embedding  # noqa: F401
        import ingestbench.extraction  # noqa: F401
        import ingestbench.metadata  # noqa: F401
        import ingestbench.vectorstore  # noqa: F401

    def _documents(self) -> list[Path]:
        docs_cfg = self.config.get("documents", {})
        source_dir = self.project_root / docs_cfg.get("source_dir", "sample_docs")
        categories = docs_cfg.get("categories", [])
        documents: list[Path] = []
        for category in categories:
            category_dir = source_dir / category
            for path in sorted(category_dir.iterdir()):
                if path.name == "ground_truth.json" or path.name.startswith("."):
                    continue
                if path.is_file():
                    documents.append(path)
        return documents

    def _run_extractors(self, document: Path) -> list[ExtractionResult]:
        file_type = detect_file_type(document)
        results = []
        for name in self.config.get("sweep", {}).get("extractor", [self.config["defaults"]["extractor"]]):
            extractor = registry.get_extractor(name)
            if isinstance(extractor, type):
                # Deferred stubs (e.g. google_docai) register their class,
                # not an instance, via the generic @registry.register
                # decorator -- unlike fully-implemented extractors, which
                # register an instance directly.
                extractor = extractor()
            if file_type not in extractor.supported_types:
                continue
            try:
                results.append(extractor.extract(document))
            except Exception as exc:
                # A deferred/experimental extractor failing (e.g. raising
                # NotImplementedError) shouldn't take down the whole
                # benchmark run -- record it as a failed result, same as
                # any other extraction failure.
                results.append(
                    ExtractionResult(
                        extractor_name=name,
                        file_name=document.name,
                        file_type=file_type,
                        success=False,
                        quality_flags=[f"extraction_error:{exc}"],
                    )
                )
        return results

    def _run_chunkers(self, extraction: ExtractionResult):
        results = []
        params = self.config.get("chunking_params", {})
        for name in self.config.get("sweep", {}).get("chunker", [self.config["defaults"]["chunker"]]):
            chunker = registry.get("chunker", name)
            if isinstance(chunker, type):
                chunker = chunker()
            try:
                results.append(chunker.chunk(extraction, **params.get(name, {})))
            except Exception as exc:
                results.append(
                    ChunkSetResult(
                        chunker_name=name,
                        source_extraction_id=f"{extraction.extractor_name}:{extraction.file_name}",
                        config_used={"error": f"chunking_error:{exc}"},
                    )
                )
        return results

    def _run_metadata_generators(self, chunk_set: ChunkSetResult):
        results = []
        for name in self.config.get("sweep", {}).get("metadata_generator", [self.config["defaults"]["metadata_generator"]]):
            generator = registry.get("metadata_generator", name)
            if isinstance(generator, type):
                generator = generator()
            try:
                results.append(generator.generate(chunk_set))
            except Exception as exc:
                results.append(
                    MetadataResult(
                        generator_name=name,
                        source_chunk_set_id=chunk_set.source_extraction_id,
                        num_failed=chunk_set.num_chunks,
                        schema_consistency_flag=False,
                        config_used={"error": f"metadata_error:{exc}"},
                    )
                )
        return results

    def _run_embedders(self, chunk_set: ChunkSetResult, metadata):
        results = []
        for name in self.config.get("sweep", {}).get("embedder", [self.config["defaults"]["embedder"]]):
            embedder = registry.get("embedder", name)
            if isinstance(embedder, type):
                embedder = embedder()
            try:
                results.append(embedder.embed(chunk_set, metadata))
            except Exception as exc:
                results.append(
                    EmbeddingResult(
                        embedder_name=name,
                        num_failed=chunk_set.num_chunks,
                        config_used={"error": f"embedding_error:{exc}"},
                    )
                )
        return results

    def _run_vectorstores(self, embedding, metadata):
        results = []
        for name in self.config.get("sweep", {}).get("vector_store", [self.config["defaults"]["vector_store"]]):
            store = registry.get("vector_store", name)
            if isinstance(store, type):
                store = store()
            try:
                store.create_collection(embedding.dimension, {})
                results.append(store.upsert(embedding, metadata))
            except Exception as exc:
                results.append(VectorStoreResult(store_name=name, write_failures=len(embedding.vectors), setup_notes=f"vectorstore_error:{exc}"))
        return results

    def _best_extraction(self, results: list[ExtractionResult]) -> ExtractionResult | None:
        successful = [result for result in results if result.success and result.char_count > 0]
        if not successful:
            return None
        return sorted(successful, key=lambda result: (result.char_count, -result.extraction_time_s), reverse=True)[0]

    def _default_or_first(self, results: list[Any], default_name: str):
        if not results:
            return None
        for result in results:
            name = getattr(result, "chunker_name", None) or getattr(result, "generator_name", None)
            if name == default_name:
                return result
        return results[0]

    def _persist(self, run: BenchmarkRun, run_dir: Path) -> None:
        (run_dir / "results.json").write_text(run.model_dump_json(indent=2), encoding="utf-8")
        with (run_dir / "results.jsonl").open("w", encoding="utf-8") as fh:
            for stage, items in [
                ("extraction", run.extraction_results),
                ("chunking", run.chunk_results),
                ("metadata", run.metadata_results),
                ("embedding", run.embedding_results),
                ("vectorstore", run.vectorstore_results),
            ]:
                for item in items:
                    fh.write(json.dumps({"stage": stage, **item.model_dump(mode="json")}) + "\n")
