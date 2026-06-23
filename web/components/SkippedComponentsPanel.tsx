import { businessLabel, STAGE_BUSINESS_LABELS } from "@/lib/componentLabels";
import type { SkippedComponent } from "@/lib/scoring";
import { humanizeSkipReason } from "@/lib/skipReasons";

function actionFor(reason: string | null): string {
  if (!reason) return "Inspect component logs before using this option.";
  const text = humanizeSkipReason(reason);
  if (text.includes("API key")) return "Configure the required credential and rerun.";
  if (text.includes("docker compose")) return "Start local services and rerun.";
  if (text.includes("not implemented")) return "Exclude from recommendations until implemented.";
  if (text.includes("not installed")) return "Install the local dependency and rerun.";
  return "Treat this component as unvalidated for this run.";
}

export default function SkippedComponentsPanel({ items }: { items: SkippedComponent[] }) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Coverage</p>
        <p className="mt-1.5 text-[15px] font-medium text-foreground">
          Components not measured in this run
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {items.length} component{items.length === 1 ? "" : "s"} skipped or unavailable.
          These are excluded from the recommendation rather than penalising every configuration equally.
        </p>
      </div>

      <div className="divide-y divide-border rounded-lg border border-border">
        {items.map((item) => (
          <div
            key={`${item.stage}:${item.name}`}
            className="grid gap-3 px-5 py-4 sm:grid-cols-[auto_1fr_1fr_1fr]"
          >
            <div className="flex items-start gap-3">
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground whitespace-nowrap">
                {STAGE_BUSINESS_LABELS[item.stage] ?? item.stage}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{businessLabel(item.name)}</p>
              <p className="font-mono text-[10px] text-muted-foreground">{item.name}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              {item.skipReason ? humanizeSkipReason(item.skipReason) : "Did not succeed."}
            </p>
            <p className="text-sm text-muted-foreground">
              {actionFor(item.skipReason)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
