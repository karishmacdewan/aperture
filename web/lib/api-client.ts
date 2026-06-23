// Thin client around the FastAPI service in `../api`. Never talks to
// Python directly -- only HTTP. See ARCHITECTURE.md section 20.

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

// Used in error messages so a failed request tells the user exactly which
// URL it tried, rather than a generic "check your config" message.
export function describeFetchFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `${message} -- the app tried to reach the API at ${API_BASE_URL}. Is it running there? ` +
    `Check the NEXT_PUBLIC_API_BASE_URL environment variable (currently "${API_BASE_URL}") if not.`;
}

export type ComponentsByStage = Record<
  "extractor" | "chunker" | "metadata_generator" | "embedder" | "vector_store",
  string[]
>;

export interface UploadedFile {
  filename: string;
  file_type: string;
  path: string;
}

export interface UploadResponse {
  upload_batch_id: string;
  files: UploadedFile[];
}

export interface CorpusSummary {
  total_documents: number;
  pdfs: number;
  scanned_pdfs: number;
  powerpoints: number;
  images: number;
  word_documents: number;
}

export interface UploadBatchDetail extends UploadResponse {
  summary: CorpusSummary;
}

export interface RunSummary {
  run_id: string;
  run_name: string;
  status: "pending" | "running" | "complete" | "failed";
  created_at: string;
  completed_at: string | null;
}

export interface ExtractionResult {
  extractor_name: string;
  file_name: string;
  file_type: string;
  success: boolean;
  extraction_time_s: number;
  char_count: number;
  page_count: number;
  tables_detected: number;
  images_detected: number;
  quality_flags: string[];
}

export interface ChunkSetResult {
  chunker_name: string;
  num_chunks: number;
  avg_chunk_size: number;
  pct_oversized: number;
  tables_split: number;
  config_used?: Record<string, unknown>;
}

export interface MetadataResult {
  generator_name: string;
  num_chunks_processed: number;
  num_failed: number;
  coverage_pct: number;
  estimated_cost_usd: number;
  generation_time_s?: number;
  schema_consistency_flag: boolean;
  config_used?: Record<string, unknown>;
}

export interface EmbeddingResult {
  embedder_name: string;
  dimension: number;
  num_chunks_embedded: number;
  num_failed: number;
  total_tokens: number;
  estimated_cost_usd: number;
  embedding_time_s: number;
  config_used?: Record<string, unknown>;
}

export interface VectorStoreResult {
  store_name: string;
  num_vectors_written: number;
  upsert_time_s: number;
  write_failures: number;
  setup_notes: string | null;
}

export interface BenchmarkRun {
  run_id: string;
  run_name: string;
  timestamp: string;
  config_snapshot: Record<string, unknown>;
  extraction_results: ExtractionResult[];
  chunk_results: ChunkSetResult[];
  metadata_results: MetadataResult[];
  embedding_results: EmbeddingResult[];
  vectorstore_results: VectorStoreResult[];
}

export interface RunDetail extends RunSummary {
  error: string | null;
  result?: BenchmarkRun;
}

export interface CreateRunRequest {
  run_name?: string;
  mode?: "ablation" | "full_factorial";
  documents: {
    source: "sample" | "upload";
    categories?: string[];
    upload_batch_id?: string;
  };
  defaults?: Record<string, string>;
  sweep?: Record<string, string[]>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, init);
  } catch (err) {
    throw new Error(describeFetchFailure(err));
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${init?.method ?? "GET"} ${API_BASE_URL}${path} failed (${response.status}): ${body}`);
  }
  return response.json() as Promise<T>;
}

export function getComponents(): Promise<ComponentsByStage> {
  return request<ComponentsByStage>("/api/components");
}

export function getUploadBatch(uploadBatchId: string): Promise<UploadBatchDetail> {
  return request<UploadBatchDetail>(`/api/documents/${uploadBatchId}`);
}

export async function uploadDocuments(files: File[]): Promise<UploadResponse> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/documents`, {
      method: "POST",
      body: formData,
    });
  } catch (err) {
    throw new Error(describeFetchFailure(err));
  }
  if (!response.ok) {
    throw new Error(`upload to ${API_BASE_URL}/api/documents failed (${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<UploadResponse>;
}

export function createRun(payload: CreateRunRequest): Promise<{ run_id: string; status: string }> {
  return request("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function listRuns(): Promise<RunSummary[]> {
  return request<RunSummary[]>("/api/runs");
}

export function getRun(runId: string): Promise<RunDetail> {
  return request<RunDetail>(`/api/runs/${runId}`);
}

export function reportUrl(runId: string): string {
  return `${API_BASE_URL}/api/runs/${runId}/report.md`;
}
