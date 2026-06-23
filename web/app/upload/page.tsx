"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { uploadDocuments, type UploadResponse } from "@/lib/api-client";

export default function UploadPage() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload() {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const response = await uploadDocuments(files);
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="py-8">
      <div>
        <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Aperture</p>
        <h1 className="mt-2 text-2xl font-medium tracking-tight text-foreground">Upload documents</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          Upload a representative sample from your corpus. Detected file types are confirmed
          immediately. You can skip this step and benchmark the built-in synthetic corpus instead.
        </p>
      </div>

      <div className="mt-10 max-w-lg space-y-5">
        <div className="rounded-lg border border-dashed border-border bg-secondary/40 px-6 py-8">
          <p className="mb-4 text-sm font-medium text-foreground">Document set</p>
          <p className="mb-5 text-[13px] text-muted-foreground">
            Upload a small representative sample, not a full production corpus.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <input
              type="file"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="text-sm text-muted-foreground file:mr-3 file:rounded file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
            />
            <button
              onClick={handleUpload}
              disabled={files.length === 0 || uploading}
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Upload failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {result && (
          <div className="rounded-lg border border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <p className="text-sm font-medium text-foreground">Upload ready</p>
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {result.upload_batch_id}
                </p>
              </div>
              <span className="text-[13px] text-muted-foreground">
                {result.files.length} file{result.files.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="divide-y divide-border">
              {result.files.map((file) => (
                <div key={file.filename} className="flex items-center justify-between gap-4 px-5 py-3">
                  <span className="min-w-0 truncate text-sm text-foreground">{file.filename}</span>
                  <span className="font-mono text-[11px] text-muted-foreground shrink-0">{file.file_type}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-border px-5 py-4">
              <button
                onClick={() =>
                  router.push(`/runs/new?upload_batch_id=${encodeURIComponent(result.upload_batch_id)}`)
                }
                className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Configure a run against these files →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
