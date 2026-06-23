"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import ChartPanels, { type RunSeries } from "@/components/ChartPanels";
import { extractMarkdownSection } from "@/lib/report";
import { getRun, reportUrl } from "@/lib/api-client";

interface ComparedRun extends RunSeries {
  runId: string;
  recommendation: string | null;
}

function CompareRunsContent() {
  const searchParams = useSearchParams();
  const idsParam = searchParams.get("ids") ?? "";
  const ids = useMemo(() => idsParam.split(",").filter(Boolean), [idsParam]);

  const [runs, setRuns] = useState<ComparedRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ids.length === 0) return;
    Promise.all(
      ids.map(async (runId) => {
        const detail = await getRun(runId);
        if (!detail.result) return null;
        const reportText = await fetch(reportUrl(runId)).then((r) => r.text());
        return {
          runId,
          label: detail.run_name || runId,
          run: detail.result,
          recommendation: extractMarkdownSection(reportText, "## Recommended Configuration"),
        } satisfies ComparedRun;
      })
    )
      .then((results) => setRuns(results.filter((r): r is ComparedRun => r !== null)))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [ids]);

  if (ids.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        Select at least two completed runs from Run History to compare.
      </p>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-5 py-4">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!runs) {
    return <p className="text-sm text-muted-foreground">Loading runs…</p>;
  }

  return (
    <div className="flex flex-col gap-10 py-8">
      <div>
        <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Aperture</p>
        <h1 className="mt-2 text-2xl font-medium tracking-tight text-foreground">Compare runs</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {runs.map((run) => (
          <div key={run.runId} className="rounded-lg border border-border p-5">
            <h2 className="text-sm font-medium text-foreground">{run.label}</h2>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{run.runId}</p>
            {run.recommendation && (
              <p className="mt-3 text-[13px] leading-5 text-muted-foreground">{run.recommendation}</p>
            )}
          </div>
        ))}
      </div>

      <div>
        <p className="mb-6 text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
          Measurement detail
        </p>
        <ChartPanels series={runs.map(({ label, run }) => ({ label, run }))} />
      </div>
    </div>
  );
}

export default function CompareRunsPage() {
  return (
    <Suspense fallback={<p className="py-8 text-sm text-muted-foreground">Loading…</p>}>
      <CompareRunsContent />
    </Suspense>
  );
}
