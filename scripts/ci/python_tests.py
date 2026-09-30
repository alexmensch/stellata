#!/usr/bin/env python3
"""Run every scripts/**/*.test.py, each in its own interpreter, and fail on
any failure, error or skip. `pnpm run test:py`; see README.md#python-suites."""

from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from enum import Enum
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / "scripts"


class Outcome(Enum):
    PASSED = 0
    FAILED = 1
    SKIPPED = 3


def discover(root: Path = SCRIPTS) -> list[Path]:
    return sorted(root.rglob("*.test.py"))


def outcome_of(result: unittest.TestResult) -> Outcome:
    if result.failures or result.errors or result.unexpectedSuccesses:
        return Outcome.FAILED
    if result.skipped or result.testsRun == 0:
        return Outcome.SKIPPED
    return Outcome.PASSED


def outcome_from_exit(code: int) -> Outcome:
    try:
        return Outcome(code)
    except ValueError:
        return Outcome.FAILED


def run_one(path: Path) -> Outcome:
    # A script run puts its own folder first on sys.path; the suites' sibling imports rely on it.
    sys.path[0] = str(path.parent)
    name = "suite_" + path.name.removesuffix(".test.py").replace("-", "_").replace(".", "_")
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    suite = unittest.defaultTestLoader.loadTestsFromModule(module)
    result = unittest.TextTestRunner(stream=sys.stderr, verbosity=1).run(suite)
    for test, reason in result.skipped:
        print(f"SKIPPED {test.id()}: {reason}", file=sys.stderr)
    return outcome_of(result)


def spawn(path: Path) -> tuple[Path, Outcome, str]:
    proc = subprocess.run(
        [sys.executable, __file__, "--one", str(path)],
        cwd=REPO_ROOT, capture_output=True, text=True,
    )
    return path, outcome_from_exit(proc.returncode), proc.stdout + proc.stderr


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[0] == "--one":
        return run_one(Path(argv[1]).resolve()).value
    paths = discover()
    with ThreadPoolExecutor(max_workers=os.cpu_count() or 2) as pool:
        runs = list(pool.map(spawn, paths))
    bad = [(path, outcome, output) for path, outcome, output in runs if outcome is not Outcome.PASSED]
    for path, outcome, output in bad:
        print(f"::group::{outcome.name} {path.relative_to(REPO_ROOT)}\n{output}::endgroup::")
    for path, outcome, _ in runs:
        print(f"{outcome.name:8} {path.relative_to(REPO_ROOT)}")
    print(f"{len(runs)} suites, {len(bad)} not passing")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
