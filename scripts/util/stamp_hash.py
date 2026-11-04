"""The one hash every Python stamp-side digest is taken with. See
scripts/util/README.md."""

from __future__ import annotations

import hashlib
from pathlib import Path

HASH_CHUNK_BYTES = 1 << 22


def hash_bytes(data: bytes) -> str:
    return hashlib.sha1(data).hexdigest()


def hash_file(path: Path) -> str:
    h = hashlib.sha1()
    with path.open("rb") as f:
        while chunk := f.read(HASH_CHUNK_BYTES):
            h.update(chunk)
    return h.hexdigest()
