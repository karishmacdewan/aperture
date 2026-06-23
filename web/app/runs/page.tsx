"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { listRuns, type RunSummary } from "@/lib/api-client";
import { cn } from "@/lib/utils";

function statusLabel(status: RunSummary["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusClass(status: RunSummary["status"]): string {
  if (status === "running") return "text-amber-700 dark:text-amber-400";
  if (status === "complete") return "text-foreground";
  if (status === "failed") return "text-destructive";
  return "text-muted-foreground";
}

export default function RunsHistoryPage() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listRuns()
      .then(setRuns)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  function toggleSelected(runId: string) {
    setSelected((prev) =>
      prev.includes(runId) ? prev.filter((id) => id !== runId) : [...prev, runId]
    );
  }

  return (
    <div className="py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Aperture</p>
          <h1 className="mt-2 text-2xl font-medium tracking-tight text-foreground">Run history</h1>
        </div>
        {selected.length >= 2 && (
          <Link
            href={`/runs/compare?ids=${selected.join(",")}`}
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Compare {selected.length} runs →
          </Link>
        )}
      </div>

      {error && (
        <Alert variant="destructive" className="mt-8">
          <AlertTitle>Unable to load run history</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {runs && runs.length === 0 && (
        <div className="mt-16 text-center">
          <p className="text-sm text-muted-foreground">No benchmark runs yet.</p>
          <Link
            href="/runs/new"
            className="mt-4 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Configure a benchmark
          </Link>
        </div>
      )}

      {runs && runs.length > 0 && (
        <div className="mt-8 overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/60">
                <th className="w-10 py-3 pl-4" />
                <th className="py-3 px-4 text-left text-[11px] uppercase tracking-[0.2em] font-medium text-muted-foreground">Run</th>
                <th className="py-3 px-4 text-left text-[11px] uppercase tracking-[0.2em] font-medium text-muted-foreground">Status</th>
                <th className="py-3 pr-4 text-right text-[11px] uppercase tracking-[0.2em] font-medium text-muted-foreground">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {runs.map((run) => (
                <tr key={run.run_id} className="hover:bg-secondary/40 transition-colors">
                  <td className="py-3.5 pl-4">
                    <Checkbox
                      checked={selected.includes(run.run_id)}
                      onCheckedChange={() => toggleSelected(run.run_id)}
                      aria-label={`Select ${run.run_name || run.run_id}`}
                    />
                  </td>
                  <td className="py-3.5 px-4">
                    <Link
                      href={`/runs/${run.run_id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {run.run_name || run.run_id}
                    </Link>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{run.run_id}</p>
                  </td>
                  <td className={cn("py-3.5 px-4 text-[13px]", statusClass(run.status))}>
                    {statusLabel(run.status)}
                  </td>
                  <td className="py-3.5 pr-4 text-right text-[13px] text-muted-foreground">
                    {new Date(run.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {selected.length === 1 && (
            <p className="border-t border-border px-4 py-3 text-[12px] text-muted-foreground">
              Select one more completed run to compare.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
