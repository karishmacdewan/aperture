import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { STAGE_BUSINESS_LABELS, businessLabel } from "@/lib/componentLabels";
import type { ScoredConfiguration, StageName } from "@/lib/scoring";

const STAGES: Array<{ stage: StageName; weight: string }> = [
  { stage: "extractor", weight: "40%" },
  { stage: "chunker", weight: "15%" },
  { stage: "metadata_generator", weight: "15%" },
  { stage: "embedder", weight: "15%" },
  { stage: "vector_store", weight: "15%" },
];

function formatCost(usd: number): string {
  if (usd < 0.001) return "< $0.001";
  if (usd < 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export default function ScoreBreakdown({ config }: { config: ScoredConfiguration }) {
  return (
    <div className="space-y-6">
      {/* Summary row */}
      <div className="grid gap-5 sm:grid-cols-4">
        {[
          { label: "Overall", value: `${config.overallScore}/100` },
          { label: "Quality", value: `${config.qualityScore}/100` },
          { label: "Est. cost", value: formatCost(config.estimatedCostUsd) },
          { label: "Est. runtime", value: `${config.estimatedRuntimeS.toFixed(1)}s` },
        ].map(({ label, value }) => (
          <div key={label}>
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-medium tabular-nums text-foreground">{value}</p>
          </div>
        ))}
      </div>

      {/* Stage breakdown table */}
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/60">
              <th className="py-3 pl-4 text-left text-[11px] uppercase tracking-[0.2em] font-medium text-muted-foreground">Stage</th>
              <th className="py-3 px-4 text-left text-[11px] uppercase tracking-[0.2em] font-medium text-muted-foreground">Component</th>
              <th className="py-3 px-4 text-right text-[11px] uppercase tracking-[0.2em] font-medium text-muted-foreground">Weight</th>
              <th className="py-3 px-4 text-right text-[11px] uppercase tracking-[0.2em] font-medium text-muted-foreground">Signal</th>
              <th className="py-3 pr-4 text-left text-[11px] uppercase tracking-[0.2em] font-medium text-muted-foreground hidden md:table-cell">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {STAGES.map(({ stage, weight }) => {
              const note = config.stageNotes[stage];
              const name = config[stage];
              return (
                <tr key={stage}>
                  <td className="py-3.5 pl-4 text-muted-foreground">{STAGE_BUSINESS_LABELS[stage]}</td>
                  <td className="py-3.5 px-4">
                    <p className="font-medium text-foreground">{businessLabel(name)}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">{name}</p>
                  </td>
                  <td className="py-3.5 px-4 text-right tabular-nums text-muted-foreground">{weight}</td>
                  <td className="py-3.5 px-4 text-right tabular-nums text-foreground font-medium">
                    {Math.round(note.value * 100)}/100
                  </td>
                  <td className="py-3.5 pr-4 text-[12px] leading-5 text-muted-foreground hidden md:table-cell max-w-xs">
                    {note.note}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
