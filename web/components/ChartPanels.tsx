"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BenchmarkRun } from "@/lib/api-client";

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export interface RunSeries {
  label: string;
  run: BenchmarkRun;
}

function aggregateBy<T>(items: T[], keyFn: (item: T) => string, valueFn: (item: T) => number) {
  const totals = new Map<string, { sum: number; count: number }>();
  for (const item of items) {
    const key = keyFn(item);
    const value = valueFn(item);
    const existing = totals.get(key) ?? { sum: 0, count: 0 };
    totals.set(key, { sum: existing.sum + value, count: existing.count + 1 });
  }
  return Array.from(totals.entries()).map(([key, { sum, count }]) => ({
    key,
    avg: count > 0 ? sum / count : 0,
  }));
}

function buildChartRows(series: RunSeries[], extract: (run: BenchmarkRun) => Array<{ key: string; avg: number }>) {
  const rows = new Map<string, Record<string, number | string>>();
  for (const { label, run } of series) {
    for (const point of extract(run)) {
      const row = rows.get(point.key) ?? { name: point.key };
      row[label] = Math.round(point.avg * 1000) / 1000;
      rows.set(point.key, row);
    }
  }
  return Array.from(rows.values());
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64 w-full">{children}</div>
      </CardContent>
    </Card>
  );
}

function GroupedBarChart({
  data,
  seriesLabels,
  yLabel,
}: {
  data: Array<Record<string, number | string>>;
  seriesLabels: string[];
  yLabel: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          interval={0}
          angle={-20}
          textAnchor="end"
          height={50}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          label={{ value: yLabel, angle: -90, fontSize: 11, position: "insideLeft", fill: "var(--muted-foreground)" }}
        />
        <Tooltip />
        {seriesLabels.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {seriesLabels.map((label, index) => (
          <Bar key={label} dataKey={label} fill={COLORS[index % COLORS.length]} radius={2} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function ChartPanels({ series }: { series: RunSeries[] }) {
  const labels = series.map((s) => s.label);

  const extractionTime = buildChartRows(series, (run) =>
    aggregateBy(run.extraction_results, (r) => r.extractor_name, (r) => r.extraction_time_s)
  );
  const chunkingSize = buildChartRows(series, (run) =>
    aggregateBy(run.chunk_results, (r) => r.chunker_name, (r) => r.avg_chunk_size)
  );
  const embeddingCost = buildChartRows(series, (run) =>
    aggregateBy(run.embedding_results, (r) => r.embedder_name, (r) => r.estimated_cost_usd)
  );
  const vectorWriteTime = buildChartRows(series, (run) =>
    aggregateBy(run.vectorstore_results, (r) => r.store_name, (r) => r.upsert_time_s)
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Panel title="Extraction time by extractor (s, avg)">
        <GroupedBarChart data={extractionTime} seriesLabels={labels} yLabel="seconds" />
      </Panel>
      <Panel title="Avg chunk size by chunker (chars)">
        <GroupedBarChart data={chunkingSize} seriesLabels={labels} yLabel="chars" />
      </Panel>
      <Panel title="Embedding cost by embedder (USD, avg)">
        <GroupedBarChart data={embeddingCost} seriesLabels={labels} yLabel="USD" />
      </Panel>
      <Panel title="Vector DB write time by store (s, avg)">
        <GroupedBarChart data={vectorWriteTime} seriesLabels={labels} yLabel="seconds" />
      </Panel>
    </div>
  );
}
