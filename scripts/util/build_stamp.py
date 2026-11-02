"""Records what a Python step reads, lists, probes and writes, for the runner
to stamp. See scripts/util/README.md."""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Iterable, Optional

_HASH_CHUNK_BYTES = 1 << 22


def hash_file(path: Path) -> str:
    h = hashlib.sha1()
    with path.open("rb") as f:
        while chunk := f.read(_HASH_CHUNK_BYTES):
            h.update(chunk)
    return h.hexdigest()


def listing_hash(names: Iterable[str]) -> str:
    """A directory listing's hash: its sorted names, so an added or removed
    file changes it and a reordering does not. Same formula as build-stamp.ts."""
    return hashlib.sha1("\n".join(sorted(names)).encode()).hexdigest()


_WRITE_MODE_CHARS = frozenset("wax+")
_UNRECORDED_PARTS = frozenset({"__pycache__", ".venv"})
_WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC


def _from_import_system() -> bool:
    """True when the import machinery is scanning a sys.path folder for a
    module, which is a lookup, not a listing the step reads."""
    frame = sys._getframe(2)
    while frame is not None:
        if frame.f_code.co_filename.startswith("<frozen importlib"):
            return True
        frame = frame.f_back
    return False


class _Recorder:
    """What one step's process reads, lists, probes and writes under `root`,
    collected through the audit hook."""

    def __init__(self, root: Path, record: Path) -> None:
        self.root = root.resolve()
        self.record = record.resolve()
        self.reads: dict[str, Optional[str]] = {}
        self.listings: dict[str, str] = {}
        self.probes: dict[str, bool] = {}
        self.opened_for_write: set[str] = set()
        self.renamed: dict[str, str] = {}
        self._busy = False

    def _inside(self, raw: object) -> Optional[Path]:
        if isinstance(raw, bytes):
            raw = os.fsdecode(raw)
        if not isinstance(raw, (str, os.PathLike)):
            return None
        path = Path(os.path.abspath(raw))
        if path == self.record or _UNRECORDED_PARTS & set(path.parts) or not path.is_relative_to(self.root):
            return None
        return path

    def _written(self, key: str) -> bool:
        return key in self.opened_for_write or key in self.renamed.values()

    def read(self, path: Path) -> None:
        key = str(path)
        if key in self.reads or self._written(key) or path.is_dir():
            return
        self.reads[key] = hash_file(path) if path.exists() else None

    def hook(self, event: str, args: tuple) -> None:
        if self._busy:
            return
        self._busy = True
        try:
            self._on(event, args)
        finally:
            self._busy = False

    def _on(self, event: str, args: tuple) -> None:
        if event == "open":
            path = self._inside(args[0])
            if path is None:
                return
            mode, flags = args[1], args[2]
            writing = (
                any(c in _WRITE_MODE_CHARS for c in mode) if isinstance(mode, str)
                else bool(flags & _WRITE_FLAGS)
            )
            if writing:
                self.opened_for_write.add(str(path))
            else:
                self.read(path)
        elif event in ("os.rename", "os.replace"):
            src, dst = self._inside(args[0]), self._inside(args[1])
            if dst is not None:
                self.renamed[str(src) if src else str(dst)] = str(dst)
        elif event in ("os.listdir", "os.scandir") and not _from_import_system():
            raw = "." if args[0] is None else args[0]
            path = self._inside(raw)
            if path is not None and str(path) not in self.listings and path.is_dir():
                self.listings[str(path)] = listing_hash(os.listdir(path))

    def finish(self) -> dict:
        for module in list(sys.modules.values()):
            path = self._inside(getattr(module, "__file__", None))
            if path is not None and path.suffix == ".py":
                self.read(path)
        writes = {
            p for p in self.opened_for_write if p not in self.renamed and Path(p).exists()
        } | set(self.renamed.values())
        return {
            "reads": self.reads,
            "listings": self.listings,
            "probes": self.probes,
            "writes": sorted(writes),
        }


_recorder: Optional[_Recorder] = None


def probe(path: Path) -> bool:
    """`path.exists()` for a step running under the runner, which records the
    answer as an input: an existence check opens no file, so the audit hook
    cannot see it."""
    exists = path.exists()
    if _recorder is not None:
        inside = _recorder._inside(path)
        if inside is not None:
            _recorder.probes[str(inside)] = exists
    return exists


def record_run(root: Path, record: Path, entry: Path, args: list[str]) -> int:
    """Run `entry` as `__main__`, recording what it touches under `root` into
    `record` as JSON. Returns the step's exit status."""
    import runpy

    global _recorder
    _recorder = _Recorder(root, record)
    sys.addaudithook(_recorder.hook)
    sys.argv = [str(entry), *args]
    sys.path.insert(0, str(entry.resolve().parent))
    status = 0
    try:
        runpy.run_path(str(entry), run_name="__main__")
    except SystemExit as exit_:
        code = exit_.code
        status = code if isinstance(code, int) else (0 if code is None else 1)
    finally:
        result = _recorder.finish()
        _recorder._busy = True
        record.parent.mkdir(parents=True, exist_ok=True)
        record.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    return status

