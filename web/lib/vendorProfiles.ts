// Qualitative vendor characteristics that are NOT measured by this
// benchmark run -- general, widely-known operational tradeoffs used only
// for the "Best for Enterprise Scale" tradeoff card. Kept separate from
// scoring.ts (which is built entirely from measured data) so it's always
// visually and structurally obvious which parts of the UI are benchmark
// results versus domain knowledge.

export const VECTOR_STORE_SCALE_NOTES: Record<string, string> = {
  qdrant:
    "Purpose-built vector engine. Scales horizontally via clustering/sharding and is generally the simpler path to high-QPS similarity search at large scale.",
  pgvector:
    "Runs inside Postgres. Lower operational overhead if Postgres is already in your stack, but very large-scale vector search typically needs careful indexing, sharding, or read replicas.",
};

export function vectorStoreScaleNote(name: string): string {
  return VECTOR_STORE_SCALE_NOTES[name] ?? "No qualitative scale profile available for this vector store yet.";
}
