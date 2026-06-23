"""POST /api/documents -- upload files for a benchmark run.

Uses the engine's own file-type detection (unchanged) so the upload
response gives immediate feedback on what was recognized.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, UploadFile

from api.db import DocumentRecord, get_session
from api.storage import storage
from ingestbench.extraction.file_types import detect_file_type

router = APIRouter()


def _summarize_file_types(files: list[DocumentRecord]) -> dict:
    counts = {
        "total_documents": len(files),
        "pdfs": 0,
        "scanned_pdfs": 0,
        "powerpoints": 0,
        "images": 0,
        "word_documents": 0,
    }
    for file in files:
        if file.file_type in {"pdf_native", "pdf_scanned"}:
            counts["pdfs"] += 1
        if file.file_type == "pdf_scanned":
            counts["scanned_pdfs"] += 1
        if file.file_type == "pptx":
            counts["powerpoints"] += 1
        if file.file_type == "image":
            counts["images"] += 1
        if file.file_type == "docx":
            counts["word_documents"] += 1
    return counts


@router.post("/documents")
async def upload_documents(files: list[UploadFile], upload_batch_id: str | None = None) -> dict:
    batch_id = upload_batch_id or storage.new_batch_id()
    session = get_session()
    uploaded = []
    try:
        for file in files:
            content = await file.read()
            dest = storage.save(batch_id, file.filename, content)
            file_type = detect_file_type(dest)

            record = DocumentRecord(
                id=f"{batch_id}-{file.filename}",
                upload_batch_id=batch_id,
                original_filename=file.filename,
                stored_path=str(dest),
                file_type=file_type.value,
            )
            session.merge(record)
            uploaded.append({"filename": file.filename, "file_type": file_type.value, "path": str(dest)})
        session.commit()
    finally:
        session.close()

    return {"upload_batch_id": batch_id, "files": uploaded}


@router.get("/documents/{upload_batch_id}")
def get_upload_batch(upload_batch_id: str) -> dict:
    session = get_session()
    try:
        records = (
            session.query(DocumentRecord)
            .filter(DocumentRecord.upload_batch_id == upload_batch_id)
            .order_by(DocumentRecord.original_filename.asc())
            .all()
        )
        if not records:
            raise HTTPException(404, f"Unknown upload_batch_id '{upload_batch_id}'")
        return {
            "upload_batch_id": upload_batch_id,
            "summary": _summarize_file_types(records),
            "files": [
                {
                    "filename": record.original_filename,
                    "file_type": record.file_type,
                    "path": record.stored_path,
                }
                for record in records
            ],
        }
    finally:
        session.close()
