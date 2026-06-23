"""Pluggable file/artifact storage. Local disk for V1; the interface is
narrow enough that swapping in S3-compatible storage later is a new
implementation of this class, not a rewrite of the routers that use it.
"""

from __future__ import annotations

import uuid
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
UPLOADS_DIR = PROJECT_ROOT / "uploads"


class LocalStorage:
    def __init__(self, base_dir: Path = UPLOADS_DIR) -> None:
        self.base_dir = base_dir

    def new_batch_id(self) -> str:
        return uuid.uuid4().hex[:12]

    def batch_dir(self, upload_batch_id: str) -> Path:
        path = self.base_dir / upload_batch_id / "files"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def save(self, upload_batch_id: str, filename: str, content: bytes) -> Path:
        dest = self.batch_dir(upload_batch_id) / filename
        dest.write_bytes(content)
        return dest


storage = LocalStorage()
