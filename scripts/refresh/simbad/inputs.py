"""Iterators that read project data files and yield identifier streams
ready to feed into query.resolve_oids_by_prefix or the orchestration
shell's oid request set."""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Iterator

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import refresh_lib as rl  # noqa: E402


def iter_athyg_hip_for_no_gaia(csv_path: Path) -> Iterator[int]:
    """Yield AT-HYG HIPs for rows that have a HIP identifier AND no Gaia
    source_id — the fallback that picks up Gaia-saturated bright stars
    (Sirius, Vega, Procyon) absent from DR3 because the 5-parameter fit
    fails on saturated sources. AT-HYG sentinels (``""``/``"0"``)
    collapse to None via athyg_int_or_none."""
    with csv_path.open(newline="") as fh:
        reader = csv.reader(fh)
        header = next(reader)
        hi = header.index("hip")
        gi = header.index("gaia")
        for row in reader:
            gaia = rl.athyg_int_or_none(row[gi])
            if gaia is not None:
                continue
            hip = rl.athyg_int_or_none(row[hi])
            if hip is not None:
                yield hip


def iter_wds_xids_oids(tsv_path: Path) -> Iterator[int]:
    """Yield SIMBAD oids from simbad_wds_xids.tsv. Blank cells are
    skipped — the cross-walk doesn't resolve every WDS component."""
    with tsv_path.open(newline="") as fh:
        reader = csv.reader(fh, delimiter="\t")
        header = next(reader)
        oi = header.index("simbad_oid")
        for row in reader:
            cell = row[oi].strip()
            if not cell:
                continue
            try:
                yield int(cell)
            except ValueError:
                continue
