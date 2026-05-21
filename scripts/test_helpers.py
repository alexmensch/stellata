"""Shared test-side utilities for scripts/*/*.test.py files.

`.test.py` siblings of kebab-cased source files (build-binaries.py,
build-vaidman-tsv.py, validate-distances.py, …) cannot `import
build-binaries` directly — the hyphen is a syntax error. This module
wraps `importlib.util.spec_from_file_location` so each test file
declares the load in one line instead of seven."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType


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
