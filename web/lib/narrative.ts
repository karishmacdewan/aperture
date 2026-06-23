// Builds the plain-English "consultant summary" paragraph from scored
// configurations. Deliberately template-based and deterministic (no LLM
// call) -- it reads like consultant output but is fully reproducible and
// traceable back to the numbers that produced it.

import { componentDisplay } from "./componentLabels";
import { configurationLabel, type Recommendations, type ScoredConfiguration } from "./scoring";

function componentClause(label: string, stageScore: ScoredConfiguration["stageNotes"][keyof ScoredConfiguration["stageNotes"]]) {
  if (stageScore.skipped) return null;
  return `${label} (${stageScore.note.replace(/\.$/, "")})`;
}

export function buildExecutiveSummary(rec: Recommendations): string {
  const { overall } = rec;
  const sentences: string[] = [];

  sentences.push(
    `Recommended: ${componentDisplay(overall.extractor)} + ${componentDisplay(overall.chunker)} + ${componentDisplay(overall.metadata_generator)} + ${componentDisplay(overall.embedder)} + ${componentDisplay(overall.vector_store)}.`
  );

  const reasons = [
    componentClause(overall.extractor, overall.stageNotes.extractor),
    componentClause(overall.chunker, overall.stageNotes.chunker),
  ].filter(Boolean);
  if (reasons.length) {
    sentences.push(`It gives the best overall balance of extraction quality, cost and speed -- ${reasons.join("; ")}.`);
  } else {
    sentences.push("It gives the best overall balance of extraction quality, cost and speed among the configurations tested.");
  }

  return sentences.join(" ");
}

/** Single-sentence verdict, shown large -- the pipeline viz already names the
 *  recommended stack, so this only needs to say *why* it won, not repeat it. */
export function buildVerdictLine(): string {
  return "Best overall balance of quality, cost, and speed among the configurations tested.";
}

/** Secondary, smaller-print line covering the one tradeoff worth surfacing
 *  immediately (cost vs. quality on the embedder) without a full paragraph. */
export function buildEmbedderRationale(rec: Recommendations): string {
  const { overall, cheapest } = rec;
  if (overall.embedder !== cheapest.embedder && cheapest.qualityScore >= overall.qualityScore * 0.9) {
    return `${componentDisplay(overall.embedder)} was chosen over cheaper embedding options for measurably higher quality.`;
  }
  return `${componentDisplay(overall.embedder)} gave the best quality-for-cost tradeoff among the embedders tested.`;
}

/** Scope disclaimer -- always shown, but as a footnote rather than buried
 *  inside the main verdict paragraph. */
export const SCOPE_FOOTNOTE =
  "Ingestion-only recommendation, based on extraction completeness, chunking structure, metadata coverage, embedding and vector-write reliability, cost, and speed.";

export function buildNarrative(rec: Recommendations): string {
  const { overall, bestQuality, cheapest, fastest } = rec;
  const parts: string[] = [];

  parts.push(
    `We recommend ${componentDisplay(overall.extractor)} for extraction, ${componentDisplay(overall.chunker)} chunking, ${componentDisplay(overall.metadata_generator)} metadata, ` +
      `${componentDisplay(overall.embedder)} for embeddings, and ${componentDisplay(overall.vector_store)} as the vector store.`
  );

  const extractorNote = overall.stageNotes.extractor;
  if (!extractorNote.skipped) {
    parts.push(`${componentDisplay(overall.extractor)} ${extractorNote.note.toLowerCase()}`);
  }

  const chunkerNote = overall.stageNotes.chunker;
  if (!chunkerNote.skipped) {
    parts.push(`${componentDisplay(overall.chunker)} chunking ${chunkerNote.note.toLowerCase()}`);
  }

  if (overall.embedder !== cheapest.embedder && cheapest.qualityScore >= overall.qualityScore * 0.9) {
    parts.push(
      `${componentDisplay(overall.embedder)} was chosen over cheaper alternatives because it measurably outperformed them on quality; ` +
        `if budget is the overriding constraint, ${componentDisplay(cheapest.embedder)} delivers similar coverage at lower cost.`
    );
  } else {
    parts.push(`${componentDisplay(overall.embedder)} delivered the best quality-for-cost tradeoff among the embedders tested.`);
  }

  parts.push(
    `${componentDisplay(overall.vector_store)} provided the best balance of write performance and reliability among the vector stores tested.`
  );

  if (bestQuality.id !== overall.id) {
    parts.push(
      `For maximum quality regardless of cost, consider ${configurationLabel(bestQuality)} instead -- ` +
        `it scores ${bestQuality.qualityScore} on quality versus ${overall.qualityScore} for the overall recommendation.`
    );
  }
  if (fastest.id !== overall.id) {
    parts.push(`For the fastest pipeline, ${configurationLabel(fastest)} is the better choice.`);
  }

  parts.push(
    "This is an ingestion-only recommendation based on extraction completeness, chunking structure, metadata coverage, " +
      "embedding reliability, vector-write reliability, cost, and speed."
  );

  return parts.join(" ");
}
