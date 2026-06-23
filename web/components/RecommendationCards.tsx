"use client";

import { useState } from "react";
import { PipelineViz } from "@/components/Pipeline";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { businessLabel, componentDescription, STAGE_BUSINESS_LABELS } from "@/lib/componentLabels";
import { buildVerdictLine, SCOPE_FOOTNOTE } from "@/lib/narrative";
import { ChevronDown } from "lucide-react";
import type { Recommendations, ScoredConfiguration, StageName } from "@/lib/scoring";

function formatCost(usd: number): string {
  if (usd < 0.001) return "< $0.001";
  if (usd < 0.01) return `$${usd.toFixed(3)}`;
  if (usd < 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(2)}`;
}

function ScoreArc({ score, size = 120 }: { score: number; size?: number }) {
  const strokeWidth = 2;
  const r = size / 2 - strokeWidth - 8;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(1, score / 100)) * circumference;

  return (
    <div style={{ width: size, height: size }} className="relative flex-shrink-0">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0" aria-hidden="true">
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-border"
        />
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          strokeWidth={strokeWidth}
          strokeDasharray={`${filled} ${circumference - filled}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          className="stroke-primary"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-heading text-4xl font-normal leading-none tabular-nums text-foreground">
          {Math.round(score)}
        </span>
        <span className="mt-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          / 100
        </span>
      </div>
    </div>
  );
}

const STAGE_KEYS: StageName[] = ["extractor", "chunker", "metadata_generator", "embedder", "vector_store"];

function MethodologyDialog() {
  return (
    <Dialog>
      <DialogTrigger render={
        <button className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground">
          Scoring methodology
        </button>
      } />
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Scoring Methodology</DialogTitle>
          <DialogDescription>How Aperture computes the recommendation score.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm leading-7 text-muted-foreground">
          <p>
            The overall score blends ingestion quality (highest weight), estimated API cost,
            and estimated runtime. Quality is weighted most because a cheaper or faster stack
            that loses document signal is not useful.
          </p>
          <p>
            Current quality metrics are ingestion-stage proxies: extraction text yield,
            chunk sizing and table-split signals, metadata coverage and schema consistency,
            embedding success rate, and vector-write reliability. Downstream retrieval and
            answer quality are outside this benchmark&rsquo;s scope.
          </p>
          <p>
            Candidates are drawn from the tested ablation neighborhood only — the all-defaults
            baseline plus each variant where exactly one stage is changed. No untested
            full-stack combinations are invented.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The primary verdict block — the recommendation and its evidence in one view. */
export default function RecommendationCards({ recommendations }: { recommendations: Recommendations }) {
  const { overall, bestQuality, fastest, cheapest } = recommendations;
  const verdictLine = buildVerdictLine();

  const alternatives = [
    { label: "Quality ceiling", config: bestQuality },
    { label: "Fastest path", config: fastest },
    { label: "Cost floor", config: cheapest },
  ];

  return (
    <div className="space-y-10">
      {/* Verdict */}
      <div className="border border-border rounded-lg p-8 bg-card">
        <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
          Recommended architecture &middot; {overall.confidenceLevel} confidence
        </p>

        <div className="mt-8 grid gap-8 lg:grid-cols-[120px_1fr] lg:items-start">
          {/* Score arc */}
          <ScoreArc score={overall.overallScore} size={120} />

          {/* Pipeline + rationale */}
          <div className="space-y-7">
            <PipelineViz config={overall} />

            <p className="max-w-2xl text-[15px] leading-7 text-foreground">{verdictLine}</p>

            {/* Dimension stats */}
            <div className="flex flex-wrap gap-8 border-t border-border pt-6">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Quality</p>
                <p className="mt-1.5 text-xl font-medium tabular-nums text-foreground">{overall.qualityScore}/100</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Runtime</p>
                <p className="mt-1.5 text-xl font-medium tabular-nums text-foreground">{overall.estimatedRuntimeS.toFixed(1)}s</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Est. cost</p>
                <p className="mt-1.5 text-xl font-medium tabular-nums text-foreground">{formatCost(overall.estimatedCostUsd)}</p>
              </div>
              <div className="ml-auto flex items-end">
                <MethodologyDialog />
              </div>
            </div>

            {/* Scope footnote -- small print, not buried in the main verdict copy */}
            <p className="max-w-2xl text-[11px] leading-5 text-muted-foreground/80">{SCOPE_FOOTNOTE}</p>

            {/* Stage detail — expandable, anchored right to the verdict it explains */}
            <details className="group border-t border-border pt-6">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-foreground/30">
                <span className="group-open:hidden">Stage-by-stage detail</span>
                <span className="hidden group-open:inline">Collapse stage detail</span>
                <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {STAGE_KEYS.map((stage) => {
                  const name = overall[stage];
                  const note = overall.stageNotes[stage];
                  return (
                    <div key={stage} className="border border-border rounded-md p-4">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                        {STAGE_BUSINESS_LABELS[stage]}
                      </p>
                      <p className="mt-2 text-sm font-medium text-foreground">{businessLabel(name)}</p>
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">{name}</p>
                      <p className="mt-3 text-xs leading-5 text-muted-foreground">{componentDescription(name)}</p>
                      {note && (
                        <div className="mt-3 border-t border-border pt-3">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">Why</p>
                          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{note.note}</p>
                          {!note.skipped && (
                            <p className="mt-2 text-[11px] tabular-nums text-foreground/80">
                              Signal: {Math.round(note.value * 100)}/100
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
          </div>
        </div>
      </div>

      {/* Alternatives — minimal, no cards */}
      <div className="grid gap-0 border-t border-border sm:grid-cols-3">
        {alternatives.map(({ label, config }, i) => (
          <div
            key={label}
            className={`py-7 ${i > 0 ? "sm:border-l sm:border-border sm:pl-8" : ""} ${i < alternatives.length - 1 ? "border-b border-border sm:border-b-0 sm:pr-8" : ""}`}
          >
            <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">{label}</p>
            <p className="mt-3 text-[15px] font-medium text-foreground">
              {businessLabel(config.extractor)}
            </p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">{config.extractor}</p>
            <p className="mt-3 text-sm tabular-nums text-muted-foreground">
              {config.overallScore}/100 overall
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
