// The recommendation engine. Turns a completed BenchmarkRun's raw,
// per-component results into ranked, scored "configurations" (one full
// extractor+chunker+metadata+embedder+vector_store stack) so the UI can
// answer "which stack should I use, and why" -- not just show charts.
//
// IMPORTANT ON METHODOLOGY: the engine runs in "ablation" mode (see
// ARCHITECTURE.md section 5 and configs/run_config.yaml) -- every stage is
// held at its configured default except the one being swept. That means
// the only stack combinations actually exercised together are: the all-
// defaults baseline, and "defaults with exactly one stage swapped". This
// module only ever constructs candidates from that real ablation
// neighborhood -- it does not fabricate untested cross-products.
//
// QUALITY SCORING TODO: true extraction quality (OCR/table/layout accuracy
// against ground truth) and chunk coherence are not measured by the engine
// yet. Today's "quality" score is an ingestion-only proxy built from signals
// the engine does measure: char yield, schema consistency, success rates,
// chunk sizing, and vector-write reliability.

import type { BenchmarkRun } from "./api-client";

export const STAGES = ["extractor", "chunker", "metadata_generator", "embedder", "vector_store"] as const;
export type StageName = (typeof STAGES)[number];

export interface ConfigurationCandidate {
  id: string;
  varyingStage: StageName | "baseline";
  extractor: string;
  chunker: string;
  metadata_generator: string;
  embedder: string;
  vector_store: string;
}

export interface StageScore {
  /** 0-1, higher is better. */
  value: number;
  /** Why the score is what it is -- shown in tradeoff/leaderboard notes. */
  note: string;
  /** True if this component didn't actually run (missing key, not installed, stub, etc). */
  skipped: boolean;
  skipReason: string | null;
}

export interface ScoredConfiguration extends ConfigurationCandidate {
  qualityScore: number; // 0-100
  costScore: number; // 0-100 (100 = cheapest)
  speedScore: number; // 0-100 (100 = fastest)
  overallScore: number; // 0-100, weighted blend
  estimatedCostUsd: number;
  estimatedRuntimeS: number;
  stageNotes: Record<StageName, StageScore>;
  /** True if any stage in this configuration was skipped/failed. */
  hasSkippedStage: boolean;
  confidenceLevel: "High" | "Medium" | "Low";
  confidenceReason: string;
}

// Quality is weighted highest on purpose -- speed/cost alone must not
// drive the recommendation. Retrieval quality has a reserved weight of 0
// for now (see RETRIEVAL PLACEHOLDER below) and will take over much of
// the "quality" weight once it's measured.
const WEIGHTS = { quality: 0.5, cost: 0.25, speed: 0.25 };

function avg(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

// ---- Per-stage aggregation -------------------------------------------------

interface ExtractionAgg {
  avgTimeS: number;
  qualityProxy: number; // 0-1: avg char yield relative to the best extractor per file
  skipped: boolean;
  skipReason: string | null;
}

function aggregateExtraction(run: BenchmarkRun): Map<string, ExtractionAgg> {
  const byFile = new Map<string, number>(); // file_name -> max char_count among successes
  for (const r of run.extraction_results) {
    if (r.success && r.char_count > 0) {
      byFile.set(r.file_name, Math.max(byFile.get(r.file_name) ?? 0, r.char_count));
    }
  }

  const byExtractor = new Map<string, { times: number[]; yields: number[]; flags: string[]; anySuccess: boolean }>();
  for (const r of run.extraction_results) {
    const bucket = byExtractor.get(r.extractor_name) ?? { times: [], yields: [], flags: [], anySuccess: false };
    bucket.times.push(r.extraction_time_s);
    if (r.success && r.char_count > 0) {
      const best = byFile.get(r.file_name) ?? r.char_count;
      bucket.yields.push(best > 0 ? r.char_count / best : 1);
      bucket.anySuccess = true;
    } else {
      bucket.yields.push(0);
      bucket.flags.push(...r.quality_flags);
    }
    byExtractor.set(r.extractor_name, bucket);
  }

  const result = new Map<string, ExtractionAgg>();
  for (const [name, bucket] of byExtractor) {
    result.set(name, {
      avgTimeS: avg(bucket.times),
      qualityProxy: avg(bucket.yields),
      skipped: !bucket.anySuccess,
      skipReason: bucket.flags[0] ?? null,
    });
  }
  return result;
}

interface ChunkAgg {
  structureProxy: number; // 0-1, proxy from pct_oversized + tables_split
  skipped: boolean;
  skipReason: string | null;
}

function aggregateChunking(run: BenchmarkRun): Map<string, ChunkAgg> {
  const byChunker = new Map<string, { oversized: number[]; tablesSplit: number[]; failed: boolean; error: string | null }>();
  for (const r of run.chunk_results) {
    const bucket = byChunker.get(r.chunker_name) ?? { oversized: [], tablesSplit: [], failed: false, error: null };
    const error = r.config_used?.error;
    if (typeof error === "string" && r.num_chunks === 0) {
      bucket.failed = true;
      bucket.error = error;
    } else {
      bucket.oversized.push(r.pct_oversized);
      bucket.tablesSplit.push(r.tables_split);
    }
    byChunker.set(r.chunker_name, bucket);
  }

  const result = new Map<string, ChunkAgg>();
  for (const [name, bucket] of byChunker) {
    const tablesSplitPenalty = avg(bucket.tablesSplit) > 0 ? 0.1 : 0;
    result.set(name, {
      // PLACEHOLDER: structure-preservation proxy from oversized-chunk rate.
      // TODO: replace with real "structure preservation" / "chunk coherence"
      // metrics once the engine measures them (see ARCHITECTURE.md section 9).
      structureProxy: bucket.oversized.length ? Math.max(0, 1 - avg(bucket.oversized) / 100 - tablesSplitPenalty) : 0,
      skipped: bucket.failed && bucket.oversized.length === 0,
      skipReason: bucket.error,
    });
  }
  return result;
}

interface MetadataAgg {
  coverageProxy: number; // 0-1
  schemaOk: boolean;
  avgCostUsd: number;
  avgTimeS: number;
  skipped: boolean;
  skipReason: string | null;
}

function aggregateMetadata(run: BenchmarkRun): Map<string, MetadataAgg> {
  const byGenerator = new Map<
    string,
    { coverage: number[]; schemaOk: boolean[]; cost: number[]; time: number[]; anySuccess: boolean; flag: string | null }
  >();
  for (const r of run.metadata_results) {
    const bucket =
      byGenerator.get(r.generator_name) ?? { coverage: [], schemaOk: [], cost: [], time: [], anySuccess: false, flag: null };
    if (r.num_chunks_processed > 0) {
      bucket.coverage.push(r.coverage_pct);
      bucket.schemaOk.push(r.schema_consistency_flag);
      bucket.cost.push(r.estimated_cost_usd);
      bucket.time.push(r.generation_time_s ?? 0);
      bucket.anySuccess = true;
    } else {
      const skipReason = r.config_used?.skip_reason;
      const error = r.config_used?.error;
      bucket.flag = typeof skipReason === "string" ? skipReason : typeof error === "string" ? `error:${error}` : "no chunks processed";
    }
    byGenerator.set(r.generator_name, bucket);
  }

  const result = new Map<string, MetadataAgg>();
  for (const [name, bucket] of byGenerator) {
    result.set(name, {
      coverageProxy: avg(bucket.coverage) / 100,
      schemaOk: bucket.schemaOk.every(Boolean),
      avgCostUsd: avg(bucket.cost),
      avgTimeS: avg(bucket.time),
      skipped: !bucket.anySuccess,
      skipReason: bucket.flag,
    });
  }
  return result;
}

interface EmbeddingAgg {
  successRate: number; // 0-1
  avgCostUsd: number;
  avgTimeS: number;
  skipped: boolean;
  skipReason: string | null;
}

function aggregateEmbedding(run: BenchmarkRun): Map<string, EmbeddingAgg> {
  const byEmbedder = new Map<
    string,
    { embedded: number[]; failed: number[]; cost: number[]; time: number[]; flag: string | null }
  >();
  for (const r of run.embedding_results) {
    const bucket = byEmbedder.get(r.embedder_name) ?? { embedded: [], failed: [], cost: [], time: [], flag: null };
    bucket.embedded.push(r.num_chunks_embedded);
    bucket.failed.push(r.num_failed);
    bucket.cost.push(r.estimated_cost_usd);
    bucket.time.push(r.embedding_time_s);
    if (r.num_chunks_embedded === 0 && r.num_failed > 0) {
      const skipReason = r.config_used?.skip_reason;
      const error = r.config_used?.error;
      bucket.flag = typeof skipReason === "string" ? skipReason : typeof error === "string" ? `error:${error}` : bucket.flag;
    }
    byEmbedder.set(r.embedder_name, bucket);
  }

  const result = new Map<string, EmbeddingAgg>();
  for (const [name, bucket] of byEmbedder) {
    const totalEmbedded = bucket.embedded.reduce((a, b) => a + b, 0);
    const totalFailed = bucket.failed.reduce((a, b) => a + b, 0);
    const total = totalEmbedded + totalFailed;
    result.set(name, {
      successRate: total > 0 ? totalEmbedded / total : 0,
      avgCostUsd: avg(bucket.cost),
      avgTimeS: avg(bucket.time),
      skipped: totalEmbedded === 0,
      skipReason: bucket.flag,
    });
  }
  return result;
}

interface VectorAgg {
  successRate: number; // 0-1
  avgTimeS: number;
  skipped: boolean;
  skipReason: string | null;
}

function aggregateVectorStore(run: BenchmarkRun): Map<string, VectorAgg> {
  const byStore = new Map<string, { written: number[]; failures: number[]; time: number[]; notes: string | null }>();
  for (const r of run.vectorstore_results) {
    const bucket = byStore.get(r.store_name) ?? { written: [], failures: [], time: [], notes: null };
    bucket.written.push(r.num_vectors_written);
    bucket.failures.push(r.write_failures);
    bucket.time.push(r.upsert_time_s);
    if (r.num_vectors_written === 0 && r.setup_notes && r.setup_notes !== "no_vectors_to_write") {
      bucket.notes = r.setup_notes;
    }
    byStore.set(r.store_name, bucket);
  }

  const result = new Map<string, VectorAgg>();
  for (const [name, bucket] of byStore) {
    const totalWritten = bucket.written.reduce((a, b) => a + b, 0);
    const totalFailures = bucket.failures.reduce((a, b) => a + b, 0);
    const total = totalWritten + totalFailures;
    result.set(name, {
      successRate: total > 0 ? totalWritten / total : 0,
      avgTimeS: avg(bucket.time),
      // Distinguish "nothing to write because embeddings were skipped"
      // (not this stage's fault) from a genuine vector-store failure.
      skipped: total === 0 ? false : totalWritten === 0,
      skipReason: bucket.notes,
    });
  }
  return result;
}

// ---- Candidate construction (ablation neighborhood) ------------------------

export function buildConfigurationCandidates(run: BenchmarkRun): ConfigurationCandidate[] {
  const defaults = (run.config_snapshot.defaults ?? {}) as Record<string, string>;
  const sweep = (run.config_snapshot.sweep ?? {}) as Record<string, string[]>;

  const baseline: ConfigurationCandidate = {
    id: "baseline",
    varyingStage: "baseline",
    extractor: defaults.extractor ?? "",
    chunker: defaults.chunker ?? "",
    metadata_generator: defaults.metadata_generator ?? "",
    embedder: defaults.embedder ?? "",
    vector_store: defaults.vector_store ?? "",
  };

  const candidates: ConfigurationCandidate[] = [baseline];
  for (const stage of STAGES) {
    for (const option of sweep[stage] ?? []) {
      if (option === defaults[stage]) continue;
      candidates.push({ ...baseline, id: `${stage}:${option}`, varyingStage: stage, [stage]: option });
    }
  }
  return candidates;
}

// ---- Skipped/failed component summary (for empty states) -------------------

export interface SkippedComponent {
  stage: StageName;
  name: string;
  skipReason: string | null;
}

export function collectSkippedComponents(run: BenchmarkRun): SkippedComponent[] {
  const out: SkippedComponent[] = [];
  for (const [name, agg] of aggregateExtraction(run)) {
    if (agg.skipped) out.push({ stage: "extractor", name, skipReason: agg.skipReason });
  }
  for (const [name, agg] of aggregateChunking(run)) {
    if (agg.skipped) out.push({ stage: "chunker", name, skipReason: agg.skipReason });
  }
  for (const [name, agg] of aggregateMetadata(run)) {
    if (agg.skipped) out.push({ stage: "metadata_generator", name, skipReason: agg.skipReason });
  }
  for (const [name, agg] of aggregateEmbedding(run)) {
    if (agg.skipped) out.push({ stage: "embedder", name, skipReason: agg.skipReason });
  }
  for (const [name, agg] of aggregateVectorStore(run)) {
    if (agg.skipped) out.push({ stage: "vector_store", name, skipReason: agg.skipReason });
  }
  return out;
}

// ---- Scoring ----------------------------------------------------------------

const STAGE_WEIGHTS: Record<StageName, number> = {
  extractor: 0.4,
  chunker: 0.15,
  metadata_generator: 0.15,
  embedder: 0.15,
  vector_store: 0.15,
};

/**
 * A stage is "structurally unavailable" in this environment (e.g. no
 * OPENAI_API_KEY at all, so *every* embedder option is skipped) rather
 * than a property of any one candidate's choices. Those stages must not
 * tank every candidate's score equally -- that would make the scores
 * meaningless rather than just lower. Re-run with the missing
 * credentials/services configured to bring a fully-skipped stage back
 * into the comparison.
 */
export function fullySkippedStages(run: BenchmarkRun): Set<StageName> {
  const maps: Record<StageName, Map<string, { skipped: boolean }>> = {
    extractor: aggregateExtraction(run),
    chunker: aggregateChunking(run),
    metadata_generator: aggregateMetadata(run),
    embedder: aggregateEmbedding(run),
    vector_store: aggregateVectorStore(run),
  };
  const result = new Set<StageName>();
  for (const stage of STAGES) {
    const entries = Array.from(maps[stage].values());
    if (entries.length === 0 || entries.every((e) => e.skipped)) {
      result.add(stage);
    }
  }
  return result;
}

export function scoreConfigurations(run: BenchmarkRun): ScoredConfiguration[] {
  const extraction = aggregateExtraction(run);
  const chunking = aggregateChunking(run);
  const metadata = aggregateMetadata(run);
  const embedding = aggregateEmbedding(run);
  const vectorStore = aggregateVectorStore(run);
  const unavailableStages = fullySkippedStages(run);

  const candidates = buildConfigurationCandidates(run);

  const unscored = candidates.map((candidate) => {
    const ext = extraction.get(candidate.extractor);
    const chunk = chunking.get(candidate.chunker);
    const meta = metadata.get(candidate.metadata_generator);
    const emb = embedding.get(candidate.embedder);
    const vec = vectorStore.get(candidate.vector_store);

    const stageNotes: Record<StageName, StageScore> = {
      extractor: {
        value: ext?.qualityProxy ?? 0,
        note: ext?.skipped
          ? "Extraction did not succeed for this component."
          : `Recovered ~${Math.round((ext?.qualityProxy ?? 0) * 100)}% as much text as the best extractor on the same files.`,
        skipped: ext?.skipped ?? true,
        skipReason: ext?.skipReason ?? null,
      },
      chunker: {
        value: chunk?.structureProxy ?? 0,
        note: chunk?.skipped
          ? "Chunking did not succeed for this component."
          : `Kept ${Math.round((chunk?.structureProxy ?? 0) * 100)}% of chunks within the target size limit (oversized-chunk proxy; chunk-coherence scoring will replace this once measured).`,
        skipped: chunk?.skipped ?? true,
        skipReason: chunk?.skipReason ?? null,
      },
      metadata_generator: {
        value: meta ? (meta.coverageProxy + (meta.schemaOk ? 1 : 0)) / 2 : 0,
        note: meta?.skipped
          ? "Metadata generation did not succeed for this component."
          : `${Math.round((meta?.coverageProxy ?? 0) * 100)}% field coverage, schema ${meta?.schemaOk ? "consistent" : "inconsistent"}.`,
        skipped: meta?.skipped ?? true,
        skipReason: meta?.skipReason ?? null,
      },
      embedder: {
        value: emb?.successRate ?? 0,
        note: emb?.skipped ? "Embedding did not succeed for this component." : "Embedded successfully across tested chunks.",
        skipped: emb?.skipped ?? true,
        skipReason: emb?.skipReason ?? null,
      },
      vector_store: {
        value: vec?.successRate ?? 0,
        note: vec?.skipped ? "Vector write did not succeed for this component." : "Vectors written successfully.",
        skipped: vec?.skipped ?? false,
        skipReason: vec?.skipReason ?? null,
      },
    };

    // Stages that are structurally unavailable in this environment (every
    // option skipped, e.g. no API key at all) are excluded from quality
    // weighting entirely, with the remaining stages' weights renormalized
    // to sum to 1 -- otherwise every candidate would be penalized equally
    // for something none of them could have avoided.
    const availableWeightTotal = STAGES.filter((s) => !unavailableStages.has(s)).reduce((sum, s) => sum + STAGE_WEIGHTS[s], 0);
    const ingestionQuality = STAGES.filter((s) => !unavailableStages.has(s)).reduce(
      (sum, s) => sum + stageNotes[s].value * (STAGE_WEIGHTS[s] / (availableWeightTotal || 1)),
      0
    );

    const qualityScore = ingestionQuality * 100;

    const estimatedCostUsd = (meta?.avgCostUsd ?? 0) + (emb?.avgCostUsd ?? 0);
    const estimatedRuntimeS = (ext?.avgTimeS ?? 0) + (meta?.avgTimeS ?? 0) + (emb?.avgTimeS ?? 0) + (vec?.avgTimeS ?? 0);

    // Only penalize a candidate for a skipped stage when other options in
    // that same stage actually worked -- i.e. this candidate's specific
    // choice is responsible, not an environment-wide limitation.
    const hasSkippedStage = STAGES.some((s) => !unavailableStages.has(s) && stageNotes[s].skipped);

    return { candidate, qualityScore, estimatedCostUsd, estimatedRuntimeS, stageNotes, hasSkippedStage };
  });

  const maxCost = Math.max(...unscored.map((u) => u.estimatedCostUsd), 0.000001);
  const maxRuntime = Math.max(...unscored.map((u) => u.estimatedRuntimeS), 0.000001);

  return unscored.map(({ candidate, qualityScore, estimatedCostUsd, estimatedRuntimeS, stageNotes, hasSkippedStage }) => {
    const costScore = (1 - estimatedCostUsd / maxCost) * 100;
    const speedScore = (1 - estimatedRuntimeS / maxRuntime) * 100;
    const overallScore = hasSkippedStage
      ? qualityScore * WEIGHTS.quality * 0.3 // heavily penalize configurations with a non-functional stage
      : qualityScore * WEIGHTS.quality + costScore * WEIGHTS.cost + speedScore * WEIGHTS.speed;
    const unavailableCount = unavailableStages.size;
    const confidenceLevel: ScoredConfiguration["confidenceLevel"] = hasSkippedStage
      ? "Low"
      : unavailableCount > 0 || qualityScore < 70
        ? "Medium"
        : "High";
    const confidenceReason = hasSkippedStage
      ? "One or more selected stages skipped or failed while alternatives were available."
      : unavailableCount > 0
        ? `${unavailableCount} stage${unavailableCount === 1 ? "" : "s"} could not run in this environment and were excluded from scoring.`
        : qualityScore < 70
          ? "The recommendation is based on complete run data, but the measured quality proxy is moderate."
          : "All scored stages produced usable evidence and no environment-wide stage was excluded.";

    return {
      ...candidate,
      qualityScore: Math.round(qualityScore * 10) / 10,
      costScore: Math.round(costScore * 10) / 10,
      speedScore: Math.round(speedScore * 10) / 10,
      overallScore: Math.round(overallScore * 10) / 10,
      estimatedCostUsd,
      estimatedRuntimeS,
      stageNotes,
      hasSkippedStage,
      confidenceLevel,
      confidenceReason,
    };
  });
}

export interface Recommendations {
  overall: ScoredConfiguration;
  bestQuality: ScoredConfiguration;
  fastest: ScoredConfiguration;
  cheapest: ScoredConfiguration;
}

export function pickRecommendations(scored: ScoredConfiguration[]): Recommendations | null {
  const viable = scored.filter((s) => !s.hasSkippedStage);
  const pool = viable.length > 0 ? viable : scored;
  if (pool.length === 0) return null;

  const by = (key: keyof ScoredConfiguration) => [...pool].sort((a, b) => (b[key] as number) - (a[key] as number))[0];

  return {
    overall: by("overallScore"),
    bestQuality: by("qualityScore"),
    fastest: by("speedScore"),
    cheapest: by("costScore"),
  };
}

export function configurationLabel(c: ConfigurationCandidate): string {
  return `${c.extractor} + ${c.chunker} + ${c.metadata_generator} + ${c.embedder} + ${c.vector_store}`;
}
