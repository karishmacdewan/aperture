"use client";

import { useState } from "react";
import { businessLabel } from "@/lib/componentLabels";
import { type ScoredConfiguration } from "@/lib/scoring";
import { humanizeSkipReason } from "@/lib/skipReasons";
import { cn } from "@/lib/utils";

type SortKey = "overallScore" | "qualityScore" | "costScore" | "speedScore";

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "overallScore", label: "Overall" },
  { key: "qualityScore", label: "Quality" },
  { key: "costScore", label: "Cost" },
  { key: "speedScore", label: "Speed" },
];

function formatCost(usd: number): string {
  if (usd < 0.001) return "< $0.001";
  if (usd < 0.01) return `$${usd.toFixed(3)}`;
  if (usd < 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(2)}`;
}

function primaryChange(config: ScoredConfiguration): string {
  if (config.varyingStage === "baseline") return "Baseline stack";
  return businessLabel(config[config.varyingStage]);
}

function notesFor(config: ScoredConfiguration): string {
  const skipped = Object.entries(config.stageNotes).filter(([, s]) => s.skipped);
  if (skipped.length === 0) {
    return config.varyingStage === "baseline" ? "All-defaults baseline" : `${config.varyingStage.replace("_", " ")} varies`;
  }
  return skipped
    .map(([stage, s]) => `${stage.replace("_", " ")}: ${s.skipReason ? humanizeSkipReason(s.skipReason) : "did not run"}`)
    .join("; ");
}

function confidenceColor(level: ScoredConfiguration["confidenceLevel"]): string {
  if (level === "High") return "text-foreground";
  if (level === "Medium") return "text-muted-foreground";
  return "text-muted-foreground/60";
}

export default function Leaderboard({ configurations }: { configurations: ScoredConfiguration[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("overallScore");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const sorted = [...configurations].sort((a, b) => b[sortKey] - a[sortKey]);
  const visible = showAll ? sorted : sorted.slice(0, 7);

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Evidence</p>
          <h2 className="mt-1.5 text-[15px] font-medium text-foreground">Configuration leaderboard</h2>
        </div>
        <div className="flex gap-1">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setSortKey(opt.key)}
              className={cn(
                "rounded px-3 py-1.5 text-xs font-medium transition-colors",
                sortKey === opt.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/60">
              <th className="w-10 py-3 pl-4 text-left text-[11px] uppercase tracking-[0.2em] font-medium text-muted-foreground">#</th>
              <th className="py-3 px-4 text-left text-[11px] uppercase tracking-[0.2em] font-medium text-muted-foreground">Configuration</th>
              <th className="py-3 px-4 text-right text-[11px] uppercase tracking-[0.2em] font-medium text-muted-foreground">Score</th>
              <th className="py-3 px-4 text-right text-[11px] uppercase tracking-[0.2em] font-medium text-muted-foreground hidden md:table-cell">Quality</th>
              <th className="py-3 px-4 text-right text-[11px] uppercase tracking-[0.2em] font-medium text-muted-foreground hidden md:table-cell">Runtime</th>
              <th className="py-3 px-4 text-right text-[11px] uppercase tracking-[0.2em] font-medium text-muted-foreground hidden lg:table-cell">Cost</th>
              <th className="py-3 pr-4 text-right text-[11px] uppercase tracking-[0.2em] font-medium text-muted-foreground hidden lg:table-cell">Confidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((config, index) => {
              const rank = sorted.indexOf(config) + 1;
              const isTop = rank === 1;
              const isExpanded = expanded === config.id;

              return [
                <tr
                  key={config.id}
                  onClick={() => setExpanded(isExpanded ? null : config.id)}
                  className={cn(
                    "cursor-pointer transition-colors hover:bg-secondary/50",
                    isTop && "border-l-2 border-l-primary",
                    config.hasSkippedStage && "opacity-75"
                  )}
                >
                  <td className={cn("py-3.5 text-sm font-medium tabular-nums text-muted-foreground", isTop ? "pl-3" : "pl-4")}>
                    {rank}
                  </td>
                  <td className="py-3.5 px-4">
                    <p className={cn("font-medium", isTop ? "text-foreground" : "text-foreground/80")}>
                      {primaryChange(config)}
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {businessLabel(config.extractor)} / {businessLabel(config.chunker)} / {businessLabel(config.vector_store)}
                    </p>
                  </td>
                  <td className={cn("py-3.5 px-4 text-right font-medium tabular-nums", isTop ? "text-primary" : "text-foreground")}>
                    {config.overallScore}
                  </td>
                  <td className="py-3.5 px-4 text-right tabular-nums text-muted-foreground hidden md:table-cell">
                    {config.qualityScore}
                  </td>
                  <td className="py-3.5 px-4 text-right tabular-nums text-muted-foreground hidden md:table-cell">
                    {config.estimatedRuntimeS.toFixed(1)}s
                  </td>
                  <td className="py-3.5 px-4 text-right tabular-nums text-muted-foreground hidden lg:table-cell">
                    {formatCost(config.estimatedCostUsd)}
                  </td>
                  <td className={cn("py-3.5 pr-4 text-right text-[12px] hidden lg:table-cell", confidenceColor(config.confidenceLevel))}>
                    {config.confidenceLevel}
                  </td>
                </tr>,

                /* Expanded detail row */
                isExpanded && (
                  <tr key={`${config.id}-detail`} className="bg-secondary/30">
                    <td />
                    <td colSpan={6} className="px-4 pb-5 pt-3">
                      <p className="text-[12px] leading-5 text-muted-foreground">{notesFor(config)}</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-5">
                        {(["extractor", "chunker", "metadata_generator", "embedder", "vector_store"] as const).map((stage) => {
                          const note = config.stageNotes[stage];
                          return (
                            <div key={stage}>
                              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{stage.replace("_", " ")}</p>
                              <p className="mt-1 text-[12px] font-medium text-foreground">{businessLabel(config[stage])}</p>
                              {note?.skipped ? (
                                <p className="mt-0.5 text-[11px] text-muted-foreground/60">
                                  {note.skipReason ? humanizeSkipReason(note.skipReason) : "Did not run"}
                                </p>
                              ) : (
                                <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                                  {Math.round((note?.value ?? 0) * 100)}/100
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>

      {sorted.length > 7 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {showAll ? "Show fewer" : `Show all ${sorted.length} configurations ↓`}
        </button>
      )}
    </div>
  );
}
