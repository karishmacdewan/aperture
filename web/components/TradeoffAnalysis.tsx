import { businessLabel } from "@/lib/componentLabels";
import { type Recommendations, type ScoredConfiguration } from "@/lib/scoring";
import { vectorStoreScaleNote } from "@/lib/vendorProfiles";

function formatCost(usd: number): string {
  if (usd < 0.001) return "< $0.001";
  if (usd < 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function pct(n: number) {
  return `${Math.round(n)}`;
}

interface TradeoffSpec {
  title: string;
  config: ScoredConfiguration;
  gain: string;
  sacrifice: string;
}

function TradeoffCard({ title, config, gain, sacrifice }: TradeoffSpec) {
  return (
    <div className="border border-border rounded-lg p-6">
      <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">{title}</p>
      <p className="mt-3 text-[15px] font-medium text-foreground">
        {businessLabel(config.extractor)}
      </p>
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">{config.extractor}</p>
      <div className="mt-5 space-y-2.5">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Gain</p>
          <p className="mt-1 text-sm leading-6 text-foreground">{gain}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Tradeoff</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{sacrifice}</p>
        </div>
      </div>
    </div>
  );
}

export default function TradeoffAnalysis({
  recommendations,
  configurations,
}: {
  recommendations: Recommendations;
  configurations: ScoredConfiguration[];
}) {
  const { overall, bestQuality, cheapest, fastest } = recommendations;

  const vectorStoresUsed = Array.from(new Set(configurations.map((c) => c.vector_store)));
  const scaleStore =
    vectorStoresUsed.find(
      (name) =>
        name === "qdrant" &&
        configurations.some((c) => c.vector_store === name && !c.stageNotes.vector_store.skipped)
    ) ?? vectorStoresUsed[0];
  const enterpriseConfig =
    [...configurations]
      .filter((c) => c.vector_store === scaleStore)
      .sort((a, b) => b.overallScore - a.overallScore)[0] ?? overall;

  const cards: TradeoffSpec[] = [
    {
      title: "Best for accuracy",
      config: bestQuality,
      gain: `Highest measured quality (${pct(bestQuality.qualityScore)}/100 vs ${pct(overall.qualityScore)}/100 overall pick).`,
      sacrifice:
        bestQuality.estimatedCostUsd > overall.estimatedCostUsd ||
        bestQuality.estimatedRuntimeS > overall.estimatedRuntimeS
          ? `${bestQuality.estimatedRuntimeS.toFixed(1)}s runtime and ${formatCost(bestQuality.estimatedCostUsd)} cost vs ${overall.estimatedRuntimeS.toFixed(1)}s / ${formatCost(overall.estimatedCostUsd)} for the overall recommendation.`
          : "No meaningful cost or speed penalty observed in this run.",
    },
    {
      title: "Best for cost",
      config: cheapest,
      gain: `Lowest estimated API cost (${formatCost(cheapest.estimatedCostUsd)} vs ${formatCost(overall.estimatedCostUsd)} overall pick).`,
      sacrifice:
        cheapest.qualityScore < overall.qualityScore
          ? `Quality of ${pct(cheapest.qualityScore)}/100 vs ${pct(overall.qualityScore)}/100 for the overall recommendation.`
          : "No meaningful quality penalty observed in this run.",
    },
    {
      title: "Best for speed",
      config: fastest,
      gain: `Lowest estimated runtime (${fastest.estimatedRuntimeS.toFixed(1)}s vs ${overall.estimatedRuntimeS.toFixed(1)}s overall pick).`,
      sacrifice:
        fastest.qualityScore < overall.qualityScore
          ? `Quality of ${pct(fastest.qualityScore)}/100 vs ${pct(overall.qualityScore)}/100 for the overall recommendation.`
          : "No meaningful quality penalty observed in this run.",
    },
    {
      title: "Best for enterprise scale",
      config: enterpriseConfig,
      gain: vectorStoreScaleNote(enterpriseConfig.vector_store),
      sacrifice:
        "Scale characteristics are qualitative vendor properties, not a measured benchmark dimension. Validate concurrency and query volume separately.",
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Tradeoffs</p>
        <h2 className="mt-1.5 text-[15px] font-medium text-foreground">Optimisation alternatives</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map((card) => (
          <TradeoffCard key={card.title} {...card} />
        ))}
      </div>
    </div>
  );
}
