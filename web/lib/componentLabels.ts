import type { StageName } from "./scoring";

interface ComponentProfile {
  businessLabel: string;
  description: string;
}

const COMPONENT_PROFILES: Record<string, ComponentProfile> = {
  native: {
    businessLabel: "Native Text Extraction",
    description: "Best for machine-readable office documents and simple PDFs.",
  },
  docling: {
    businessLabel: "Docling",
    description: "Best for mixed document layouts, tables, and reading-order preservation.",
  },
  tesseract: {
    businessLabel: "Tesseract OCR",
    description: "No-credential OCR path for scanned PDFs and image-only pages.",
  },
  azure_di: {
    businessLabel: "Azure Document Intelligence",
    description: "Credential-gated OCR and form extraction for complex scanned documents.",
  },
  gpt4o_vlm: {
    businessLabel: "GPT-4o Vision",
    description: "Credential-gated extraction for screenshots, diagrams, and dense visual pages.",
  },
  google_docai: {
    businessLabel: "Google Document AI",
    description: "Deferred enterprise OCR alternative.",
  },
  claude_vlm: {
    businessLabel: "Claude vision extraction",
    description: "Deferred alternate vision-model extractor.",
  },
  llamaparse: {
    businessLabel: "LlamaParse document parsing",
    description: "Deferred parser for markdown-faithful PDF extraction.",
  },
  unstructured: {
    businessLabel: "Broad-format partitioning",
    description: "Deferred parser for broad document format coverage.",
  },
  fixed_size: {
    businessLabel: "Fixed Window Chunking",
    description: "Simple baseline chunking with configurable overlap.",
  },
  heading_based: {
    businessLabel: "Heading-Based Chunking",
    description: "Uses headings and document structure to preserve business context.",
  },
  recursive: {
    businessLabel: "Recursive Chunking",
    description: "Splits by larger semantic boundaries before falling back to character windows.",
  },
  semantic: {
    businessLabel: "Semantic chunking",
    description: "Deferred embedding-similarity chunking option.",
  },
  rule_based: {
    businessLabel: "Rule-Based Metadata",
    description: "Free, predictable metadata from source and structure signals.",
  },
  llm_metadata: {
    businessLabel: "LLM-Enriched Metadata",
    description: "Paid summaries, keywords, and content tags for richer downstream filtering.",
  },
  "text-embedding-3-small": {
    businessLabel: "OpenAI Small Embeddings",
    description: "Lower-cost OpenAI embedding model for broad baseline coverage.",
  },
  "text-embedding-3-large": {
    businessLabel: "OpenAI Large Embeddings",
    description: "Higher-cost OpenAI embedding model with larger vector dimensionality.",
  },
  qdrant: {
    businessLabel: "Qdrant",
    description: "Specialized vector database with payload filtering and scale-oriented operations.",
  },
  pgvector: {
    businessLabel: "pgvector",
    description: "Vector search inside an existing Postgres operating model.",
  },
};

export const STAGE_BUSINESS_LABELS: Record<StageName, string> = {
  extractor: "Extraction strategy",
  chunker: "Chunking strategy",
  metadata_generator: "Metadata strategy",
  embedder: "Embedding model",
  vector_store: "Vector platform",
};

export function businessLabel(name: string): string {
  return COMPONENT_PROFILES[name]?.businessLabel ?? name;
}

export function componentDescription(name: string): string {
  return COMPONENT_PROFILES[name]?.description ?? "No business profile is available for this component yet.";
}

export function componentDisplay(name: string): string {
  const label = businessLabel(name);
  return label === name ? name : `${label} (${name})`;
}
