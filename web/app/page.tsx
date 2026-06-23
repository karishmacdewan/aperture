import Link from "next/link";
import { PipelineStrip } from "@/components/Pipeline";

export default function Home() {
  return (
    <div className="py-12 lg:py-16">
      {/* Pipeline mark — the product's signature motif */}
      <PipelineStrip />

      {/* Hero */}
      <div className="mt-8">
        <h1 className="font-heading max-w-3xl text-5xl leading-[1.12] tracking-tight text-foreground md:text-6xl">
          Your AI stack&rsquo;s performance starts at ingestion.
        </h1>
        <p className="mt-7 max-w-xl text-[16px] leading-8 text-muted-foreground">
          Aperture benchmarks extraction, chunking, metadata generation, embedding and
          vector-write strategies across your document corpus — before architecture decisions
          harden into production cost.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-5">
          <Link
            href="/runs/new"
            className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Configure benchmark
          </Link>
          <Link
            href="/upload"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Upload your corpus →
          </Link>
        </div>
      </div>

      {/* Divider */}
      <div className="mt-24 border-t border-border" />

      {/* Secondary nav */}
      <div className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Link href="/runs/new" className="group block">
            <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
              Step 1
            </p>
            <h2 className="mt-3 text-[15px] font-medium text-foreground group-hover:underline">
              Configure a benchmark
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Choose a strategy, select the ingestion components to compare, and set the
              document corpus.
            </p>
          </Link>
        </div>
        <div>
          <Link href="/upload" className="group block">
            <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
              Optional
            </p>
            <h2 className="mt-3 text-[15px] font-medium text-foreground group-hover:underline">
              Upload your documents
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Bring a representative sample from your actual corpus. Or benchmark against
              the built-in synthetic set.
            </p>
          </Link>
        </div>
        <div>
          <Link href="/runs" className="group block">
            <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
              Review
            </p>
            <h2 className="mt-3 text-[15px] font-medium text-foreground group-hover:underline">
              Audit run history
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Review past recommendations, compare runs across corpus changes, and export
              evidence for stakeholder sign-off.
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
