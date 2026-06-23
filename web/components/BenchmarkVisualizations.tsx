import { Fragment } from "react";
import { STAGE_BUSINESS_LABELS, businessLabel } from "@/lib/componentLabels";
import { STAGES, configurationLabel, type ScoredConfiguration, type StageName } from "@/lib/scoring";

// Achromatic-by-default chart colors, one per stage, matching the app's
// monochromatic blue chart scale. Brand blue (--primary) is reserved for the
// recommended configuration only, per the design system's "one ink color"
// rule -- these are not a ten-color legend.
const STAGE_COLOR_VAR: Record<StageName, string> = {
  extractor: "var(--chart-1)",
  chunker: "var(--chart-2)",
  metadata_generator: "var(--chart-3)",
  embedder: "var(--chart-4)",
  vector_store: "var(--chart-5)",
};

const STAGE_WEIGHTS: Record<StageName, number> = {
  extractor: 0.4,
  chunker: 0.15,
  metadata_generator: 0.15,
  embedder: 0.15,
  vector_store: 0.15,
};

function formatCost(usd: number): string {
  if (usd < 0.001) return "< $0.001";
  if (usd < 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function StageLegend({ withRecommended = true }: { withRecommended?: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1.5">
      {STAGES.map((stage) => (
        <span key={stage} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: STAGE_COLOR_VAR[stage] }}
          />
          {STAGE_BUSINESS_LABELS[stage]}
        </span>
      ))}
      {withRecommended && (
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-primary" />
          Recommended
        </span>
      )}
    </div>
  );
}

/** 1. Score distribution strip — every tested configuration as a dot on a 0-100 axis. */
function ScoreDistributionStrip({
  configurations,
  recommendedId,
}: {
  configurations: ScoredConfiguration[];
  recommendedId: string;
}) {
  const width = 640;
  const height = 56;
  const padding = 16;
  const axisY = 16;
  const usableWidth = width - padding * 2;
  const xFor = (score: number) => padding + (Math.max(0, Math.min(100, score)) / 100) * usableWidth;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Score distribution</p>
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
          Every tested configuration, plotted by overall score. A tight cluster means little separates
          the options; a wide spread means the choice of stack materially changes the outcome.
        </p>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} role="img" aria-label="Score distribution">
        <line x1={padding} y1={axisY} x2={width - padding} y2={axisY} stroke="var(--border)" strokeWidth={1} />
        {[0, 25, 50, 75, 100].map((tick) => (
          <Fragment key={tick}>
            <line x1={xFor(tick)} y1={axisY - 3} x2={xFor(tick)} y2={axisY + 3} stroke="var(--border)" strokeWidth={1} />
            <text x={xFor(tick)} y={height - 4} textAnchor="middle" fontSize={9} fill="var(--muted-foreground)">
              {tick}
            </text>
          </Fragment>
        ))}
        {configurations.map((config) => {
          const isRecommended = config.id === recommendedId;
          const color =
            config.varyingStage === "baseline" ? "var(--muted-foreground)" : STAGE_COLOR_VAR[config.varyingStage];
          return (
            <circle
              key={config.id}
              cx={xFor(config.overallScore)}
              cy={axisY}
              r={isRecommended ? 5 : 3.5}
              fill={isRecommended ? "var(--primary)" : color}
              opacity={isRecommended ? 1 : 0.55}
              stroke={isRecommended ? "var(--background)" : "none"}
              strokeWidth={isRecommended ? 1.5 : 0}
            >
              <title>
                {configurationLabel(config)} — {config.overallScore}/100
              </title>
            </circle>
          );
        })}
      </svg>
      <StageLegend />
    </div>
  );
}

/** 2. Stage contribution bar — how much each stage contributed to the recommended config's quality score. */
function StageContributionBar({ config }: { config: ScoredConfiguration }) {
  const segments = STAGES.map((stage) => ({
    stage,
    contribution: config.stageNotes[stage].value * STAGE_WEIGHTS[stage] * 100,
  }));

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Stage contribution</p>
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
          How each ingestion stage contributed to the recommended configuration&rsquo;s{" "}
          {config.qualityScore}/100 quality score. The unfilled portion is headroom to a perfect score.
        </p>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {segments.map(({ stage, contribution }) => (
          <div
            key={stage}
            style={{ width: `${contribution}%`, backgroundColor: STAGE_COLOR_VAR[stage] }}
            title={`${STAGE_BUSINESS_LABELS[stage]}: ${contribution.toFixed(1)} pts`}
          />
        ))}
      </div>
      <div className="grid gap-2.5 sm:grid-cols-5">
        {segments.map(({ stage, contribution }) => (
          <div key={stage} className="flex items-start gap-2">
            <span
              className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: STAGE_COLOR_VAR[stage] }}
            />
            <div className="min-w-0">
              <p className="text-[11px] leading-4 text-muted-foreground">{STAGE_BUSINESS_LABELS[stage]}</p>
              <p className="text-[12px] font-medium tabular-nums text-foreground">{contribution.toFixed(1)} pts</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function paretoFrontierIds(configurations: ScoredConfiguration[]): Set<string> {
  const frontier = new Set<string>();
  for (const candidate of configurations) {
    const dominated = configurations.some(
      (other) =>
        other.id !== candidate.id &&
        other.estimatedCostUsd <= candidate.estimatedCostUsd &&
        other.qualityScore >= candidate.qualityScore &&
        (other.estimatedCostUsd < candidate.estimatedCostUsd || other.qualityScore > candidate.qualityScore)
    );
    if (!dominated) frontier.add(candidate.id);
  }
  return frontier;
}

/** 3. Cost / quality scatter — the one chart a CTO will actually read. */
function CostQualityScatter({
  configurations,
  recommendedId,
}: {
  configurations: ScoredConfiguration[];
  recommendedId: string;
}) {
  const width = 640;
  const height = 260;
  const padL = 44;
  const padR = 16;
  const padT = 16;
  const padB = 32;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const maxCost = Math.max(...configurations.map((c) => c.estimatedCostUsd), 0.000001);
  const xFor = (cost: number) => padL + (cost / maxCost) * plotW;
  const yFor = (quality: number) => padT + (1 - Math.max(0, Math.min(100, quality)) / 100) * plotH;

  const frontierIds = paretoFrontierIds(configurations);
  const frontierPoints = configurations
    .filter((c) => frontierIds.has(c.id))
    .sort((a, b) => a.estimatedCostUsd - b.estimatedCostUsd);
  const recommended = configurations.find((c) => c.id === recommendedId);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Cost vs. quality</p>
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
          Each tested configuration by estimated cost and measured quality. The connected line is the
          efficient frontier — configurations no other option beats on both axes.
        </p>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} role="img" aria-label="Cost vs quality scatter">
        {/* Axes */}
        <line x1={padL} y1={padT} x2={padL} y2={height - padB} stroke="var(--border)" strokeWidth={1} />
        <line x1={padL} y1={height - padB} x2={width - padR} y2={height - padB} stroke="var(--border)" strokeWidth={1} />
        {[0, 25, 50, 75, 100].map((tick) => (
          <Fragment key={tick}>
            <line x1={padL - 3} y1={yFor(tick)} x2={padL} y2={yFor(tick)} stroke="var(--border)" strokeWidth={1} />
            <text x={padL - 6} y={yFor(tick) + 3} textAnchor="end" fontSize={9} fill="var(--muted-foreground)">
              {tick}
            </text>
          </Fragment>
        ))}
        <text x={padL} y={height - padB + 14} fontSize={9} fill="var(--muted-foreground)">
          {formatCost(0)}
        </text>
        <text x={width - padR} y={height - padB + 14} textAnchor="end" fontSize={9} fill="var(--muted-foreground)">
          {formatCost(maxCost)}
        </text>
        <text
          x={-(height / 2)}
          y={14}
          fontSize={9}
          fill="var(--muted-foreground)"
          transform="rotate(-90)"
          textAnchor="middle"
        >
          Quality score
        </text>
        <text x={width / 2} y={height - 4} fontSize={9} fill="var(--muted-foreground)" textAnchor="middle">
          Estimated cost
        </text>

        {/* Efficient frontier */}
        {frontierPoints.length > 1 && (
          <polyline
            points={frontierPoints.map((c) => `${xFor(c.estimatedCostUsd)},${yFor(c.qualityScore)}`).join(" ")}
            fill="none"
            stroke="var(--muted-foreground)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {/* Points */}
        {configurations.map((config) => {
          const isRecommended = config.id === recommendedId;
          const onFrontier = frontierIds.has(config.id);
          return (
            <circle
              key={config.id}
              cx={xFor(config.estimatedCostUsd)}
              cy={yFor(config.qualityScore)}
              r={isRecommended ? 6 : onFrontier ? 4 : 3}
              fill={isRecommended ? "var(--primary)" : "var(--foreground)"}
              opacity={isRecommended ? 1 : onFrontier ? 0.75 : 0.35}
              stroke={isRecommended ? "var(--background)" : "none"}
              strokeWidth={isRecommended ? 1.5 : 0}
            >
              <title>
                {configurationLabel(config)} — {config.qualityScore}/100 quality, {formatCost(config.estimatedCostUsd)}
              </title>
            </circle>
          );
        })}

        {recommended && (
          <text
            x={xFor(recommended.estimatedCostUsd)}
            y={yFor(recommended.qualityScore) - 10}
            textAnchor="middle"
            fontSize={10}
            fontWeight={500}
            fill="var(--primary)"
          >
            Recommended
          </text>
        )}
      </svg>
    </div>
  );
}

/** The three visualizations the design review identifies as the ones worth showing — evidence, not headlines. */
export default function BenchmarkVisualizations({
  configurations,
  recommended,
}: {
  configurations: ScoredConfiguration[];
  recommended: ScoredConfiguration;
}) {
  return (
    <div className="space-y-10">
      <ScoreDistributionStrip configurations={configurations} recommendedId={recommended.id} />
      <StageContributionBar config={recommended} />
      <CostQualityScatter configurations={configurations} recommendedId={recommended.id} />
      <p className="text-[11px] leading-5 text-muted-foreground">
        Recommended: {businessLabel(recommended.extractor)} / {businessLabel(recommended.chunker)} /{" "}
        {businessLabel(recommended.metadata_generator)} / {businessLabel(recommended.embedder)} /{" "}
        {businessLabel(recommended.vector_store)}
      </p>
    </div>
  );
}
