"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import BenchmarkVisualizations from "@/components/BenchmarkVisualizations";
import Leaderboard from "@/components/Leaderboard";
import RecommendationCards from "@/components/RecommendationCards";
import ScoreBreakdown from "@/components/ScoreBreakdown";
import SkippedComponentsPanel from "@/components/SkippedComponentsPanel";
import TradeoffAnalysis from "@/components/TradeoffAnalysis";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getRun, reportUrl, type RunDetail } from "@/lib/api-client";
import { buildExecutiveSummary } from "@/lib/narrative";
import { collectSkippedComponents, fullySkippedStages, pickRecommendations, scoreConfigurations } from "@/lib/scoring";

const STAGE_LABELS: Record<string, string> = {
  extractor: "Extraction",
  chunker: "Chunking",
  metadata_generator: "Metadata generation",
  embedder: "Embedding",
  vector_store: "Vector store writes",
};

function StatusDot({ status }: { status: RunDetail["status"] }) {
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-[12px] font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
        Running
      </span>
    );
  }
  if (status === "complete") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-[12px] font-medium text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-foreground/30" />
        Complete
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-destructive/30 bg-destructive/5 px-3 py-1 text-[12px] font-medium text-destructive dark:border-destructive/50">
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-[12px] text-muted-foreground">
      Pending
    </span>
  );
}

export default function RunDashboardPage() {
  const params = useParams<{ runId: string }>();
  const runId = params.runId;

  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function poll() {
      try {
        const data = await getRun(runId);
        setDetail(data);
        if (data.status === "complete" || data.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }

    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [runId]);

  const analysis = useMemo(() => {
    if (!detail?.result) return null;
    const configurations = scoreConfigurations(detail.result);
    const recommendations = pickRecommendations(configurations);
    const skipped = collectSkippedComponents(detail.result);
    const unavailableStages = Array.from(fullySkippedStages(detail.result));
    return { configurations, recommendations, skipped, unavailableStages };
  }, [detail]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Unable to load run</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!detail) {
    return <p className="pt-16 text-sm text-muted-foreground">Loading run…</p>;
  }

  return (
    <div className="flex flex-col gap-12 py-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            Benchmark run
          </p>
          <h1 className="mt-2 text-2xl font-medium tracking-tight text-foreground">
            {detail.run_name || detail.run_id}
          </h1>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">{detail.run_id}</p>
        </div>
        <StatusDot status={detail.status} />
      </div>

      {/* In-progress state */}
      {(detail.status === "pending" || detail.status === "running") && (
        <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
          <p className="text-sm text-muted-foreground">Benchmark running — refreshing every 2 seconds</p>
        </div>
      )}

      {/* Failed state */}
      {detail.status === "failed" && (
        <pre className="overflow-auto rounded-lg border border-destructive/20 bg-destructive/5 p-5 text-xs text-destructive">
          {detail.error}
        </pre>
      )}

      {/* Complete — main content */}
      {detail.status === "complete" && detail.result && analysis?.recommendations && (
        <>
          {/* Scope adjustment notice — small, not alarming */}
          {analysis.unavailableStages.length > 0 && (
            <div className="rounded-md border border-border bg-secondary/60 px-5 py-4">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Scoring scope adjusted. </span>
                {analysis.unavailableStages.map((s) => STAGE_LABELS[s] ?? s).join(", ")}{" "}
                {analysis.unavailableStages.length === 1 ? "was" : "were"} unavailable in this
                environment and excluded from quality weighting rather than penalising every
                configuration equally. Configure the missing credentials and rerun for a complete picture.
              </p>
            </div>
          )}

          {/* Verdict — the primary output */}
          <RecommendationCards recommendations={analysis.recommendations} />

          {/* Leaderboard — always visible */}
          <Leaderboard configurations={analysis.configurations} />

          {/* Tradeoffs */}
          <TradeoffAnalysis
            recommendations={analysis.recommendations}
            configurations={analysis.configurations}
          />

          {/* Skipped components */}
          <SkippedComponentsPanel items={analysis.skipped} />

          {/* Measurement detail — collapsed by default */}
          <details className="group border-t border-border pt-6">
            <summary className="cursor-pointer list-none">
              <span className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground transition-colors group-open:text-foreground hover:text-foreground">
                <span className="group-open:hidden">↓ Measurement detail</span>
                <span className="hidden group-open:inline">↑ Measurement detail</span>
              </span>
            </summary>
            <div className="mt-8 space-y-8">
              <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
                <span>{detail.result.extraction_results.length} extraction results</span>
                <span>{detail.result.chunk_results.length} chunking results</span>
                <span>{detail.result.metadata_results.length} metadata results</span>
                <span>{detail.result.embedding_results.length} embedding results</span>
                <span>{detail.result.vectorstore_results.length} vector-store results</span>
              </div>

              <div>
                <p className="mb-6 text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
                  Score breakdown — recommended configuration
                </p>
                <ScoreBreakdown config={analysis.recommendations.overall} />
              </div>

              <BenchmarkVisualizations
                configurations={analysis.configurations}
                recommended={analysis.recommendations.overall}
              />

              <a
                href={reportUrl(runId)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
              >
                Download full report (.md) ↗
              </a>
            </div>
          </details>
        </>
      )}

      {/* Complete but no usable recommendation */}
      {detail.status === "complete" && detail.result && !analysis?.recommendations && (
        <div className="rounded-md border border-border bg-secondary/60 px-5 py-4">
          <p className="text-sm font-medium text-foreground">No usable recommendation</p>
          <p className="mt-1 text-sm text-muted-foreground">
            No configuration produced a usable result in this run. Review skipped components
            and detailed metrics for per-component errors before treating this benchmark as
            decision evidence.
          </p>
        </div>
      )}
    </div>
  );
}
