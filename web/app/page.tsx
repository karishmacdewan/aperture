"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PipelineStrip } from "@/components/Pipeline";
import { listRuns, getRun } from "@/lib/api-client";
import { scoreConfigurations, pickRecommendations } from "@/lib/scoring";

interface ProofConfig {
  overallScore: number;
  qualityScore: number;
  estimatedRuntimeS: number;
  estimatedCostUsd: number;
  extractor: string;
  chunker: string;
  embedder: string;
}

// Shown until a real completed run is found -- clearly labeled "Example run"
// below so it's never mistaken for an actual result.
const EXAMPLE_PROOF: ProofConfig = {
  overallScore: 92,
  qualityScore: 94,
  estimatedRuntimeS: 4.2,
  estimatedCostUsd: 0.014,
  extractor: "docling",
  chunker: "semantic_chunking",
  embedder: "text-embedding-3-large",
};

function formatCost(usd: number): string {
  if (usd < 0.001) return "< $0.001";
  if (usd < 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function ProofScoreArc({ score, size = 56 }: { score: number; size?: number }) {
  const strokeWidth = 4;
  const r = size / 2 - strokeWidth;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(1, score / 100)) * circumference;

  return (
    <div style={{ width: size, height: size }} className="relative flex-shrink-0">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0" aria-hidden="true">
        <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={strokeWidth} className="stroke-border" />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          strokeWidth={strokeWidth}
          strokeDasharray={`${filled} ${circumference - filled}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          className="stroke-primary"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center font-mono text-base font-medium tabular-nums text-foreground">
        {Math.round(score)}
      </div>
    </div>
  );
}

export default function Home() {
  const [proof, setProof] = useState<{ isExample: boolean; docCount: number | null; config: ProofConfig }>({
    isExample: true,
    docCount: null,
    config: EXAMPLE_PROOF,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const runs = await listRuns();
        const completed = runs
          .filter((r) => r.status === "complete")
          .sort(
            (a, b) =>
              new Date(b.completed_at ?? b.created_at).getTime() - new Date(a.completed_at ?? a.created_at).getTime()
          );
        if (completed.length === 0 || cancelled) return;

        const detail = await getRun(completed[0].run_id);
        if (!detail.result || cancelled) return;

        const recs = pickRecommendations(scoreConfigurations(detail.result));
        if (!recs || cancelled) return;

        const docCount = new Set(detail.result.extraction_results.map((r) => r.file_name)).size;
        setProof({
          isExample: false,
          docCount,
          config: {
            overallScore: recs.overall.overallScore,
            qualityScore: recs.overall.qualityScore,
            estimatedRuntimeS: recs.overall.estimatedRuntimeS,
            estimatedCostUsd: recs.overall.estimatedCostUsd,
            extractor: recs.overall.extractor,
            chunker: recs.overall.chunker,
            embedder: recs.overall.embedder,
          },
        });
      } catch {
        // Homepage, not an error surface -- keep the static example on failure.
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const { config } = proof;

  return (
    <div className="py-12 lg:py-16">
      {/* Pipeline mark — the product's signature motif */}
      <PipelineStrip />

      {/* Hero — asymmetric: headline+copy on the left, a real (or example) result on the right */}
      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_260px] lg:items-start">
        <div>
          <h1 className="font-heading font-semibold max-w-2xl text-5xl leading-[1.1] tracking-tight text-foreground md:text-6xl">
            Your AI stack&rsquo;s performance starts at ingestion.
          </h1>
          <p className="mt-7 max-w-xl text-[16px] leading-8 text-muted-foreground">
            Aperture benchmarks extraction, chunking, metadata generation, embedding and
            vector-write strategies across your document corpus — before architecture decisions
            harden into production cost.
          </p>

          <div className="mt-8 flex max-w-xl flex-wrap gap-x-8 gap-y-2 border-t border-border pt-5 font-mono text-[11px] text-muted-foreground">
            <span>
              <span className="text-muted-foreground/60">stages</span> 5
            </span>
            <span>
              <span className="text-muted-foreground/60">components</span> 14
            </span>
            <span>
              <span className="text-muted-foreground/60">corpus</span> synthetic / yours
            </span>
          </div>

          <div className="mt-9 flex flex-wrap items-center gap-5">
            <Link
              href="/runs/new"
              className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Configure benchmark
            </Link>
            <Link
              href="/upload"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Upload your corpus →
            </Link>
          </div>
        </div>

        {/* Proof card — shows an actual scored result instead of more marketing copy */}
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {proof.isExample ? "Example run" : `Last run · ${proof.docCount} doc${proof.docCount === 1 ? "" : "s"}`}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <ProofScoreArc score={config.overallScore} />
            <div className="min-w-0 font-mono text-[11px] leading-[1.6] text-muted-foreground">
              <p className="truncate">{config.extractor}</p>
              <p className="truncate">{config.chunker}</p>
              <p className="truncate">{config.embedder}</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3">
            <div>
              <p className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Quality</p>
              <p className="mt-0.5 text-sm font-medium tabular-nums text-foreground">{Math.round(config.qualityScore)}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Runtime</p>
              <p className="mt-0.5 text-sm font-medium tabular-nums text-foreground">{config.estimatedRuntimeS.toFixed(1)}s</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Cost</p>
              <p className="mt-0.5 text-sm font-medium tabular-nums text-foreground">{formatCost(config.estimatedCostUsd)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="mt-20 border-t border-border" />

      {/* Secondary nav — index numbers instead of generic step labels, to read as one system with the spec list above */}
      <div className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Link href="/runs/new" className="group block">
            <p className="font-mono text-lg text-muted-foreground/50">01</p>
            <h2 className="mt-2 text-[15px] font-medium text-foreground group-hover:underline">
              Configure a benchmark
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Choose a strategy, select the ingestion components to compare, and set the
              document corpus.
            </p>
          </Link>
        </div>
        <div>
          <Link href="/upload" className="group block">
            <p className="font-mono text-lg text-muted-foreground/50">02</p>
            <h2 className="mt-2 text-[15px] font-medium text-foreground group-hover:underline">
              Upload your documents
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Bring a representative sample from your actual corpus. Or benchmark against
              the built-in synthetic set.
            </p>
          </Link>
        </div>
        <div>
          <Link href="/runs" className="group block">
            <p className="font-mono text-lg text-muted-foreground/50">03</p>
            <h2 className="mt-2 text-[15px] font-medium text-foreground group-hover:underline">
              Audit run history
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Review past recommendations, compare runs across corpus changes, and export
              evidence for stakeholder sign-off.
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
