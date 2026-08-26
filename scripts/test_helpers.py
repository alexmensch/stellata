"""Shared test-side utilities for scripts/*/*.test.py files: kebab-cased
sibling loading, and an in-memory stand-in for a TAP query result so the
refresh pulls can be gated without a network."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType
from typing import Any, Callable, Sequence


def load_kebab_sibling(test_file: str, module_name: str, filename: str) -> ModuleType:
    """Load the sibling `.py` file `filename` (resolved relative to
    `test_file`'s directory) under canonical `module_name`. The loaded
    module is registered in `sys.modules` so subsequent imports inside
    the loaded module that reference `module_name` resolve correctly."""
    here = Path(test_file).resolve().parent
    spec = importlib.util.spec_from_file_location(module_name, here / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class FakeColumn(list):
    """A column whose `.dtype` is the Python type of its first cell, which is
    all `refresh_lib.validate_schema` reads off a non-numpy table."""

    @property
    def dtype(self) -> type:
        return type(self[0]) if self else str


class FakeTable(list):
    """Minimal astropy-Table stand-in: a row list plus `colnames`."""

    def __init__(self, rows: Sequence[dict], colnames: Sequence[str]) -> None:
        super().__init__(rows)
        self.colnames = list(colnames)

    def __getitem__(self, key):  # noqa: ANN001, ANN204
        if isinstance(key, str):
            return FakeColumn(r[key] for r in self)
        return super().__getitem__(key)


def fake_tap_client(
    refresh_lib: ModuleType, answer: Callable[[str], Any] | Any
) -> Any:
    """A `refresh_lib.TapClient` answering every query from memory.

    `answer` is either a fixed table or a callable taking the ADQL string —
    the callable form is what lets a batched pull return a different slice
    per batch.
    """
    run = answer if callable(answer) else (lambda _q: answer)
    return refresh_lib.TapClient(
        backends=[refresh_lib.TapBackend(name="fake", run=run)]
    )
