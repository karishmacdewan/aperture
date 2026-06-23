import { Fragment } from "react";
import { businessLabel } from "@/lib/componentLabels";
import type { ScoredConfiguration, StageName } from "@/lib/scoring";

const STAGES: Array<{ key: StageName; label: string }> = [
  { key: "extractor", label: "Extract" },
  { key: "chunker", label: "Chunk" },
  { key: "metadata_generator", label: "Enrich" },
  { key: "embedder", label: "Embed" },
  { key: "vector_store", label: "Store" },
];

/** Small SVG pipeline mark — five nodes connected by lines. Used as the brand icon. */
export function PipelineMark({ size = 36 }: { size?: number }) {
  const height = Math.round(size * 12 / 36);
  const xs = [3, 10.5, 18, 25.5, 33];
  const r = 2.5;
  const y = 6;
  return (
    <svg
      width={size}
      height={height}
      viewBox="0 0 36 12"
      fill="none"
      aria-hidden="true"
    >
      {xs.slice(0, -1).map((x, i) => (
        <line
          key={i}
          x1={x + r + 0.5}
          y1={y}
          x2={xs[i + 1] - r - 0.5}
          y2={y}
          stroke="currentColor"
          strokeWidth="0.75"
        />
      ))}
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="currentColor" />
      ))}
    </svg>
  );
}

/** Full pipeline visualization with stage labels and component names. */
export function PipelineViz({ config }: { config: ScoredConfiguration }) {
  return (
    <div className="space-y-2.5">
      {/* Eyebrow labels */}
      <div className="grid grid-cols-5">
        {STAGES.map(({ key, label }) => (
          <p
            key={key}
            className="text-center text-[10px] uppercase tracking-[0.22em] text-muted-foreground"
          >
            {label}
          </p>
        ))}
      </div>

      {/* Nodes + connecting line */}
      <div className="relative">
        <div className="absolute top-1/2 left-0 right-0 h-px -translate-y-1/2 bg-border" />
        <div className="grid grid-cols-5">
          {STAGES.map(({ key }) => (
            <div key={key} className="flex justify-center">
              <div className="relative z-10 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background" />
            </div>
          ))}
        </div>
      </div>

      {/* Component names */}
      <div className="grid grid-cols-5">
        {STAGES.map(({ key }) => (
          <p
            key={key}
            className="px-1 text-center text-[13px] font-medium leading-snug text-foreground"
          >
            {businessLabel(config[key])}
          </p>
        ))}
      </div>

      {/* Technical identifiers */}
      <div className="grid grid-cols-5">
        {STAGES.map(({ key }) => (
          <p
            key={key}
            className="px-1 text-center font-mono text-[10px] leading-snug text-muted-foreground"
          >
            {config[key]}
          </p>
        ))}
      </div>
    </div>
  );
}

/** Compact horizontal pipeline — stage labels only, no component names. For the run config page. */
export function PipelineStrip() {
  return (
    <div className="flex items-center gap-0">
      {STAGES.map(({ key, label }, i) => (
        <Fragment key={key}>
          {i > 0 && (
            <div className="h-px w-6 bg-border flex-shrink-0" />
          )}
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 flex-shrink-0" />
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground whitespace-nowrap">
              {label}
            </span>
          </div>
        </Fragment>
      ))}
    </div>
  );
}
