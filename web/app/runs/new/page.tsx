"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { businessLabel, componentDescription } from "@/lib/componentLabels";
import {
  createRun,
  getComponents,
  getUploadBatch,
  type ComponentsByStage,
  type CorpusSummary,
  type UploadedFile,
} from "@/lib/api-client";
import { cn } from "@/lib/utils";

type StageKey = keyof ComponentsByStage;

const STAGES: StageKey[] = ["extractor", "chunker", "metadata_generator", "embedder", "vector_store"];

const STAGE_COPY: Record<StageKey, { title: string; description: string }> = {
  extractor: {
    title: "Extraction",
    description: "Parse source files into text, layout and structure signals.",
  },
  chunker: {
    title: "Chunking",
    description: "Shape extracted content into coherent units for embedding.",
  },
  metadata_generator: {
    title: "Metadata",
    description: "Attach payload fields for filtering, traceability and governance.",
  },
  embedder: {
    title: "Embedding",
    description: "Measure vectorisation reliability, timing, token use and cost.",
  },
  vector_store: {
    title: "Vector store",
    description: "Measure vector write behaviour and payload compatibility.",
  },
};

const SAMPLE_CORPUS_SUMMARY: CorpusSummary = {
  total_documents: 5,
  pdfs: 2,
  scanned_pdfs: 1,
  powerpoints: 1,
  images: 2,
  word_documents: 1,
};

const EMPTY_CORPUS_SUMMARY: CorpusSummary = {
  total_documents: 0,
  pdfs: 0,
  scanned_pdfs: 0,
  powerpoints: 0,
  images: 0,
  word_documents: 0,
};

function estimateStageExecutions(summary: CorpusSummary, sweep: Record<string, string[]>): number {
  const extraction = sweep.extractor?.length ?? 0;
  const chunking = sweep.chunker?.length ?? 0;
  const metadata = sweep.metadata_generator?.length ?? 0;
  const embedding = sweep.embedder?.length ?? 0;
  const vectorStores = sweep.vector_store?.length ?? 0;
  return summary.total_documents * (extraction + chunking + metadata + embedding + embedding * vectorStores);
}

function estimateRuntime(summary: CorpusSummary, sweep: Record<string, string[]>): string {
  const executions = estimateStageExecutions(summary, sweep);
  const externalServices = [...(sweep.extractor ?? []), ...(sweep.metadata_generator ?? []), ...(sweep.embedder ?? [])].some(
    (name) => ["azure_di", "gpt4o_vlm", "llm_metadata", "text-embedding-3-small", "text-embedding-3-large"].includes(name)
  );
  if (executions === 0) return "Not ready";
  if (summary.total_documents <= 2 && executions <= 30 && !externalServices) return "< 5 min";
  if (summary.total_documents <= 5 && executions <= 80) return externalServices ? "5–15 min" : "5–10 min";
  return "15+ min";
}

type StrategyKey = "balanced" | "fidelity" | "cost";

const STRATEGIES: Record<
  StrategyKey,
  {
    title: string;
    eyebrow: string;
    description: string;
    defaults: Partial<Record<StageKey, string>>;
    sweep: Partial<Record<StageKey, string[]>>;
  }
> = {
  balanced: {
    title: "Balanced advisory",
    eyebrow: "Recommended",
    description:
      "A consulting-grade first pass: compare realistic options across every ingestion stage while keeping cost and runtime contained.",
    defaults: {
      extractor: "docling",
      chunker: "heading_based",
      metadata_generator: "rule_based",
      embedder: "text-embedding-3-small",
      vector_store: "qdrant",
    },
    sweep: {
      extractor: ["native", "docling", "tesseract", "azure_di", "gpt4o_vlm"],
      chunker: ["fixed_size", "heading_based", "recursive"],
      metadata_generator: ["rule_based", "llm_metadata"],
      embedder: ["text-embedding-3-small", "text-embedding-3-large"],
      vector_store: ["qdrant", "pgvector"],
    },
  },
  fidelity: {
    title: "Fidelity-first",
    eyebrow: "For complex corpora",
    description:
      "Prioritises layout, OCR, vision and enriched metadata evidence when document quality risk matters more than run cost.",
    defaults: {
      extractor: "docling",
      chunker: "heading_based",
      metadata_generator: "llm_metadata",
      embedder: "text-embedding-3-large",
      vector_store: "qdrant",
    },
    sweep: {
      extractor: ["docling", "tesseract", "azure_di", "gpt4o_vlm"],
      chunker: ["heading_based", "recursive"],
      metadata_generator: ["rule_based", "llm_metadata"],
      embedder: ["text-embedding-3-small", "text-embedding-3-large"],
      vector_store: ["qdrant", "pgvector"],
    },
  },
  cost: {
    title: "Cost-controlled",
    eyebrow: "Lean run",
    description:
      "Focuses on no-credential and lower-cost paths first, while still checking whether stronger parsers materially change the recommendation.",
    defaults: {
      extractor: "native",
      chunker: "heading_based",
      metadata_generator: "rule_based",
      embedder: "text-embedding-3-small",
      vector_store: "pgvector",
    },
    sweep: {
      extractor: ["native", "docling", "tesseract"],
      chunker: ["fixed_size", "heading_based"],
      metadata_generator: ["rule_based"],
      embedder: ["text-embedding-3-small"],
      vector_store: ["qdrant", "pgvector"],
    },
  },
};

function availableOnly(options: string[], requested: string[]): string[] {
  const filtered = requested.filter((name) => options.includes(name));
  return filtered.length > 0 ? filtered : options.slice(0, 1);
}

function strategyConfig(components: ComponentsByStage, strategy: StrategyKey) {
  const spec = STRATEGIES[strategy];
  const nextDefaults: Record<string, string> = {};
  const nextSweep: Record<string, string[]> = {};

  for (const stage of STAGES) {
    const options = components[stage];
    const requestedDefault = spec.defaults[stage];
    const requestedSweep = spec.sweep[stage] ?? options;
    nextDefaults[stage] = requestedDefault && options.includes(requestedDefault) ? requestedDefault : options[0] ?? "";
    nextSweep[stage] = availableOnly(options, requestedSweep);
    if (nextDefaults[stage] && !nextSweep[stage].includes(nextDefaults[stage])) {
      nextSweep[stage] = [nextDefaults[stage], ...nextSweep[stage]];
    }
  }

  return { defaults: nextDefaults, sweep: nextSweep };
}

function CorpusSummaryView({
  summary,
  files,
  sourceLabel,
}: {
  summary: CorpusSummary;
  files: UploadedFile[];
  sourceLabel: string;
}) {
  const corpusParts = [
    [summary.pdfs, "PDF", "PDFs"],
    [summary.scanned_pdfs, "scanned PDF", "scanned PDFs"],
    [summary.powerpoints, "PowerPoint", "PowerPoints"],
    [summary.images, "image", "images"],
    [summary.word_documents, "Word document", "Word documents"],
  ]
    .filter(([value]) => Number(value) > 0)
    .map(([value, singular, plural]) => `${value} ${Number(value) === 1 ? singular : plural}`);

  return (
    <div className="space-y-5">
      <div className="border-y border-border py-6">
        <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Corpus</p>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <p className="text-2xl font-medium tracking-tight text-foreground">
            {summary.total_documents} {summary.total_documents === 1 ? "document" : "documents"}
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            {corpusParts.length > 0 ? corpusParts.join(" / ") : "No uploaded documents detected"}
          </p>
        </div>
        <p className="mt-3 max-w-2xl text-[13px] leading-6 text-muted-foreground">{sourceLabel}</p>
      </div>

      {files.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none text-sm font-medium text-foreground transition-colors group-open:text-muted-foreground hover:text-muted-foreground">
            <span className="group-open:hidden">↓ Show uploaded files</span>
            <span className="hidden group-open:inline">↑ Hide</span>
          </summary>
          <div className="mt-4 divide-y divide-border border-y border-border">
            {files.map((file) => (
              <div key={file.filename} className="flex items-center justify-between gap-4 py-3.5 text-sm">
                <span className="min-w-0 truncate text-foreground">{file.filename}</span>
                <span className="font-mono text-[11px] text-muted-foreground shrink-0">{file.file_type}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function StrategyDecision({
  selected,
  onSelect,
  defaults,
  sweep,
  corpusSummary,
}: {
  selected: StrategyKey;
  onSelect: (strategy: StrategyKey) => void;
  defaults: Record<string, string>;
  sweep: Record<string, string[]>;
  corpusSummary: CorpusSummary;
}) {
  const selectedStrategy = STRATEGIES[selected];
  const totalCompared = STAGES.reduce((count, stage) => count + (sweep[stage]?.length ?? 0), 0);

  return (
    <section className="border-t border-border pt-8 pb-6">
      {/* Three strategy options */}
      <p className="mb-4 text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Benchmark strategy</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {(Object.keys(STRATEGIES) as StrategyKey[]).map((key) => {
          const strategy = STRATEGIES[key];
          const isSelected = key === selected;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              className={cn(
                "rounded-lg border p-5 text-left transition-colors",
                isSelected
                  ? "border-primary/25 bg-accent"
                  : "border-border bg-card hover:bg-secondary/60"
              )}
            >
              <p className={cn(
                "text-[11px] uppercase tracking-[0.22em]",
                isSelected ? "text-primary" : "text-muted-foreground"
              )}>
                {strategy.eyebrow}
              </p>
              <p className={cn(
                "mt-2 text-[15px] font-medium leading-snug",
                isSelected ? "text-foreground" : "text-muted-foreground"
              )}>
                {strategy.title}
              </p>
              <p className="mt-2 text-[12px] leading-5 text-muted-foreground line-clamp-2">
                {strategy.description.split(".")[0]}.
              </p>
            </button>
          );
        })}
      </div>

      {/* Selected strategy detail */}
      <div className="mt-8 rounded-lg border border-border bg-card p-6 sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
              {selectedStrategy.eyebrow}
            </p>
            <h3 className="mt-3 max-w-2xl text-2xl font-medium leading-tight tracking-tight text-foreground">
              {selectedStrategy.title}
            </h3>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
              {selectedStrategy.description} Components are compared independently against this baseline.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-6 border-t border-border pt-5 sm:min-w-[200px] sm:border-l sm:border-t-0 sm:pl-7 sm:pt-0">
            <div>
              <p className="text-2xl font-medium tabular-nums tracking-tight text-foreground">
                {estimateStageExecutions(corpusSummary, sweep)}
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Evaluations</p>
            </div>
            <div>
              <p className="text-2xl font-medium tracking-tight text-foreground">
                {estimateRuntime(corpusSummary, sweep)}
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Runtime</p>
            </div>
          </div>
        </div>

        {/* Baseline pipeline */}
        <div className="mt-8 grid gap-4 border-y border-border py-6 sm:grid-cols-2 lg:grid-cols-5">
          {STAGES.map((stage) => (
            <div key={stage}>
              <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                {STAGE_COPY[stage].title}
              </p>
              <p className="mt-2 text-sm font-medium text-foreground">{businessLabel(defaults[stage] ?? "")}</p>
            </div>
          ))}
        </div>

        <details className="mt-6">
          <summary className="cursor-pointer list-none text-[11px] uppercase tracking-[0.22em] text-muted-foreground transition-colors hover:text-foreground">
            <span className="group-open:hidden">↓ Benchmark details</span>
          </summary>
          <div className="mt-5 grid gap-6 text-sm leading-7 text-muted-foreground lg:grid-cols-2">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-foreground">Baseline path</p>
              <p className="mt-2 text-foreground">
                {STAGES.map((stage) => businessLabel(defaults[stage] ?? "")).join(" / ")}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-foreground">Benchmark breadth</p>
              <p className="mt-2">{totalCompared} components across five ingestion stages.</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-foreground">Not measured</p>
              <p className="mt-2">Retrieval quality, answer quality, production concurrency and user-facing latency.</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-foreground">Recommendation basis</p>
              <p className="mt-2">Measured ingestion signals, baseline-aware tradeoffs, skipped components and cost exposure.</p>
            </div>
          </div>
        </details>
      </div>
    </section>
  );
}

function StageEditor({
  stage,
  options,
  baseline,
  selected,
  onBaselineChange,
  onToggle,
}: {
  stage: StageKey;
  options: string[];
  baseline: string;
  selected: string[];
  onBaselineChange: (value: string) => void;
  onToggle: (value: string) => void;
}) {
  return (
    <div className="grid gap-8 border-t border-border py-10 lg:grid-cols-[200px_1fr]">
      <div>
        <h3 className="text-[15px] font-medium text-foreground">{STAGE_COPY[stage].title}</h3>
        <p className="mt-2 text-[13px] leading-6 text-muted-foreground">{STAGE_COPY[stage].description}</p>
      </div>

      <div className="space-y-8">
        <div className="grid gap-4 sm:grid-cols-[1fr_240px] sm:items-end">
          <div>
            <label className="text-sm font-medium text-foreground">Baseline component</label>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
              Reference configuration for this stage. Baseline output flows into subsequent stages.
            </p>
          </div>
          <select
            value={baseline}
            onChange={(event) => onBaselineChange(event.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {businessLabel(option)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">Components to benchmark</p>
              <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                These will be executed and compared during the benchmark.
              </p>
            </div>
            <span className="text-[12px] tabular-nums text-muted-foreground">{selected.length} selected</span>
          </div>

          <div className="divide-y divide-border border-y border-border">
            {options.map((option) => {
              const checked = selected.includes(option);
              return (
                <label key={option} className="flex cursor-pointer gap-4 py-4">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => onToggle(option)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm", checked ? "font-medium text-foreground" : "font-normal text-muted-foreground")}>
                      {businessLabel(option)}
                    </span>
                    <span className="mt-0.5 block max-w-2xl text-[13px] leading-5 text-muted-foreground">
                      {componentDescription(option)}
                    </span>
                    <details className="mt-1.5">
                      <summary className="w-fit cursor-pointer text-[11px] text-muted-foreground/60 hover:text-muted-foreground">
                        Technical ID
                      </summary>
                      <code className="mt-1 block w-fit font-mono text-[11px] text-muted-foreground">{option}</code>
                    </details>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function NewRunContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const uploadBatchId = searchParams.get("upload_batch_id");

  const [components, setComponents] = useState<ComponentsByStage | null>(null);
  const [runName, setRunName] = useState("");
  const [sweep, setSweep] = useState<Record<string, string[]>>({});
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyKey>("balanced");
  const [corpusSummary, setCorpusSummary] = useState<CorpusSummary>(
    uploadBatchId ? EMPTY_CORPUS_SUMMARY : SAMPLE_CORPUS_SUMMARY
  );
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getComponents()
      .then((data) => {
        setComponents(data);
        const config = strategyConfig(data, "balanced");
        setSweep(config.sweep);
        setDefaults(config.defaults);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (!uploadBatchId) return;
    getUploadBatch(uploadBatchId)
      .then((batch) => {
        setCorpusSummary(batch.summary);
        setUploadedFiles(batch.files);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [uploadBatchId]);

  const emptySelection = useMemo(
    () => STAGES.some((stage) => components && (sweep[stage] ?? []).length === 0),
    [components, sweep]
  );

  const sourceLabel = uploadBatchId
    ? `Uploaded batch ${uploadBatchId}`
    : "Built-in synthetic corpus prepared for ingestion benchmark validation.";

  function applyStrategy(strategy: StrategyKey) {
    if (!components) return;
    const config = strategyConfig(components, strategy);
    setSelectedStrategy(strategy);
    setSweep(config.sweep);
    setDefaults(config.defaults);
  }

  function toggleSweepOption(stage: string, option: string) {
    setSweep((prev) => {
      const current = prev[stage] ?? [];
      const next = current.includes(option)
        ? current.filter((value) => value !== option)
        : [...current, option];
      return { ...prev, [stage]: next };
    });
  }

  async function handleSubmit() {
    if (emptySelection) {
      setError("Select at least one component to benchmark in every stage.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const documents = uploadBatchId
        ? { source: "upload" as const, upload_batch_id: uploadBatchId }
        : { source: "sample" as const };
      const { run_id } = await createRun({ run_name: runName, documents, defaults, sweep });
      router.push(`/runs/${run_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  if (error && !components) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Unable to load benchmark setup</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!components) {
    return <p className="pt-16 text-sm text-muted-foreground">Loading available ingestion components…</p>;
  }

  return (
    <div className="mx-auto max-w-6xl py-8">
      <div>
        <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Aperture</p>
        <h1 className="mt-2 text-2xl font-medium tracking-tight text-foreground">
          Configure benchmark
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          Choose a strategy, review the evidence it will generate, and start the run.
        </p>
      </div>

      <StrategyDecision
        selected={selectedStrategy}
        onSelect={applyStrategy}
        defaults={defaults}
        sweep={sweep}
        corpusSummary={corpusSummary}
      />

      <section className="grid gap-8 border-t border-border py-8 lg:grid-cols-[1fr_300px]">
        <CorpusSummaryView summary={corpusSummary} files={uploadedFiles} sourceLabel={sourceLabel} />
        <div>
          <label className="block text-sm font-medium text-foreground">Run name</label>
          <input
            value={runName}
            onChange={(event) => setRunName(event.target.value)}
            placeholder="acme-policy-docs"
            className="mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
      </section>

      <details className="border-t border-border py-10">
        <summary className="cursor-pointer list-none">
          <span className="text-sm font-medium text-foreground">Advanced benchmark controls</span>
          <span className="ml-3 text-[13px] text-muted-foreground">
            Baselines, component sweeps, technical identifiers
          </span>
        </summary>
        <div className="mt-8">
          {STAGES.map((stage) => (
            <StageEditor
              key={stage}
              stage={stage}
              options={components[stage]}
              baseline={defaults[stage] ?? ""}
              selected={sweep[stage] ?? []}
              onBaselineChange={(value) => setDefaults((prev) => ({ ...prev, [stage]: value }))}
              onToggle={(value) => toggleSweepOption(stage, value)}
            />
          ))}
        </div>
      </details>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>Run could not be started</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Sticky footer CTA */}
      <div className="sticky bottom-0 -mx-6 border-t border-border bg-background/95 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <p className="text-[13px] text-muted-foreground">
            {estimateStageExecutions(corpusSummary, sweep)} evaluations &middot; {estimateRuntime(corpusSummary, sweep)}
          </p>
          <Button onClick={handleSubmit} disabled={submitting || emptySelection} size="lg">
            {submitting ? "Starting…" : "Start benchmark"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function NewRunPage() {
  return (
    <Suspense fallback={<p className="pt-16 text-sm text-muted-foreground">Loading…</p>}>
      <NewRunContent />
    </Suspense>
  );
}
