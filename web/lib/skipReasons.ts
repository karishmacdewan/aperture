// Translates the engine's machine-readable skip/failure flags (e.g.
// "credentials_not_set", "docling_not_installed", "qdrant_unavailable:...")
// into plain English so a non-technical reader knows what action (if any)
// is required, instead of seeing a raw flag string or stack trace.

interface SkipPattern {
  test: (flag: string) => boolean;
  describe: (flag: string) => string;
}

const PATTERNS: SkipPattern[] = [
  {
    test: (f) => f === "credentials_not_set",
    describe: () => "Skipped -- API key not configured",
  },
  {
    test: (f) => f.includes("docling_not_installed"),
    describe: () => "Skipped -- Docling is not installed in this environment",
  },
  {
    test: (f) => f.includes("pytesseract_not_installed") || f.includes("tesseract is not installed"),
    describe: () => "Skipped -- Tesseract OCR is not installed in this environment",
  },
  {
    test: (f) => f.includes("registered stub") || f.includes("deferred past V1"),
    describe: () => "Not implemented yet -- deferred component, planned for a later version",
  },
  {
    test: (f) => f.includes("pgvector_unavailable") && (f.includes("Connection refused") || f.includes("connection failed")),
    describe: () => "Skipped -- Postgres/pgvector is not reachable (is `docker compose up -d` running?)",
  },
  {
    test: (f) => f.includes("qdrant_unavailable") && f.includes("already accessed by another instance"),
    describe: () => "Skipped -- Qdrant's local storage is locked by another process",
  },
  {
    test: (f) => f.includes("qdrant_unavailable") || f.includes("pgvector_unavailable"),
    describe: () => "Skipped -- vector database service unavailable",
  },
  {
    test: (f) => f.includes("Unable to get page count") || f.includes("poppler"),
    describe: () => "Skipped -- poppler (pdf2image dependency) is not installed in this environment",
  },
  {
    test: (f) =>
      f.startsWith("extraction_error:") ||
      f.startsWith("chunking_error:") ||
      f.startsWith("metadata_error:") ||
      f.startsWith("embedding_error:") ||
      f.startsWith("vectorstore_error:") ||
      f.startsWith("error:"),
    describe: (f) => `Failed -- ${f.split(":").slice(1).join(":").trim() || "unknown error"}`,
  },
];

export function humanizeSkipReason(flag: string): string {
  for (const pattern of PATTERNS) {
    if (pattern.test(flag)) return pattern.describe(flag);
  }
  return flag;
}

export function isSkippedOrFailed(flags: string[] | undefined | null): boolean {
  return Boolean(flags && flags.length > 0);
}

export function firstHumanReadableReason(flags: string[] | undefined | null): string | null {
  if (!flags || flags.length === 0) return null;
  return humanizeSkipReason(flags[0]);
}
