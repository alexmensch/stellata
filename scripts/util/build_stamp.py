"""Content-hash freshness stamps for build steps — Python sibling of
build-stamp.ts, same stamp format. See scripts/util/README.md."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Iterable, Mapping, NamedTuple, Optional

from scripts.util.paths import REPO_ROOT

STAMP_DIR = REPO_ROOT / "build" / "stamps"

FileHashes = Mapping[str, Optional[str]]

_HASH_CHUNK_BYTES = 1 << 22


class Stamp(NamedTuple):
    inputs: FileHashes
    outputs: FileHashes


def stamp_path(name: str) -> Path:
    return STAMP_DIR / f"{name}.json"


def hash_file(path: Path) -> str:
    h = hashlib.sha1()
    with path.open("rb") as f:
        while chunk := f.read(_HASH_CHUNK_BYTES):
            h.update(chunk)
    return h.hexdigest()


def file_hashes(paths: Iterable[Path]) -> dict[str, Optional[str]]:
    return {
        Path(os.path.relpath(p, REPO_ROOT)).as_posix(): hash_file(p) if p.exists() else None
        for p in sorted({p.resolve() for p in paths})
    }


def read_stamp(stamp: Path) -> Optional[Stamp]:
    if not stamp.exists():
        return None
    parsed = json.loads(stamp.read_text())
    if "inputs" not in parsed or "outputs" not in parsed:
        return None
    return Stamp(parsed["inputs"], parsed["outputs"])


def changed_since(recorded: FileHashes) -> list[str]:
    """Recorded paths whose content on disk no longer matches the recorded hash."""
    current = file_hashes(REPO_ROOT / p for p in recorded)
    return [p for p in recorded if current.get(p) != recorded[p]]


def stamp_is_current(stamp: Path, inputs: FileHashes) -> bool:
    recorded = read_stamp(stamp)
    return (
        recorded is not None
        and dict(recorded.inputs) == dict(inputs)
        and not changed_since(recorded.outputs)
    )


def clear_stamp(stamp: Path) -> None:
    """Must run before a build writes any output, so a build that dies midway
    leaves no stamp vouching for its partial outputs."""
    stamp.unlink(missing_ok=True)


def write_stamp(stamp: Path, inputs: FileHashes, outputs: Iterable[Path]) -> None:
    output_hashes = file_hashes(outputs)
    missing = [p for p, h in output_hashes.items() if h is None]
    if not output_hashes or missing:
        raise RuntimeError(f"write_stamp({stamp}): outputs missing or none given: {missing}")
    stamp.parent.mkdir(parents=True, exist_ok=True)
    stamp.write_text(
        json.dumps({"inputs": dict(inputs), "outputs": output_hashes}, indent=2, sort_keys=True)
        + "\n"
    )
