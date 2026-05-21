"""Shared helpers for the distance-validation harness — the regime
constants written to vaidman-2025-supergiants.tsv's `adopted` column
(wire format between build-vaidman-tsv.py and validate-distances.py)
and the TSV-row iterator both consumers read with."""

from __future__ import annotations

from pathlib import Path
from typing import Iterator

ADOPTED_EDSD_NEW = "EDSD_new"
ADOPTED_BJ_OLD = "BJ_old"


def read_tsv_rows(path: Path) -> Iterator[dict[str, str]]:
    """Yield `{column: cell}` dicts for each non-header row of a tab-
    separated file with a single header row at the top. Caller is
    responsible for type-coercion of cells."""
    with path.open(encoding="utf-8") as f:
        header = f.readline().rstrip("\n").split("\t")
        for line in f:
            cells = line.rstrip("\n").split("\t")
            yield dict(zip(header, cells))
