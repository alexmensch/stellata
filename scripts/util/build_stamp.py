"""Content-hash freshness stamps for build steps — Python sibling of
build-stamp.ts, same stamp format. See scripts/util/README.md."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Iterable, Mapping, Optional

from scripts.util.paths import REPO_ROOT

STAMP_DIR = REPO_ROOT / "build" / "stamps"

InputHashes = Mapping[str, Optional[str]]

_HASH_CHUNK_BYTES = 1 << 22


def stamp_path(name: str) -> Path:
    return STAMP_DIR / f"{name}.json"


def hash_file(path: Path) -> str:
    h = hashlib.sha1()
    with path.open("rb") as f:
        while chunk := f.read(_HASH_CHUNK_BYTES):
            h.update(chunk)
    return h.hexdigest()


def input_hashes(paths: Iterable[Path]) -> dict[str, Optional[str]]:
    return {
        Path(os.path.relpath(p, REPO_ROOT)).as_posix(): hash_file(p) if p.exists() else None
        for p in sorted({p.resolve() for p in paths})
    }


def read_stamp(stamp: Path) -> Optional[InputHashes]:
    if not stamp.exists():
        return None
    return json.loads(stamp.read_text())["inputs"]


def stamp_is_current(stamp: Path, hashes: InputHashes, outputs: Iterable[Path]) -> bool:
    recorded = read_stamp(stamp)
    return recorded is not None and all(o.exists() for o in outputs) and dict(recorded) == dict(hashes)


def clear_stamp(stamp: Path) -> None:
    """Must run before a build writes any output, so a build that dies midway
    leaves no stamp vouching for its partial outputs."""
    stamp.unlink(missing_ok=True)


def write_stamp(stamp: Path, hashes: InputHashes) -> None:
    stamp.parent.mkdir(parents=True, exist_ok=True)
    stamp.write_text(json.dumps({"inputs": dict(hashes)}, indent=2, sort_keys=True) + "\n")
