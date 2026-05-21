"""Iterator helpers that read project data files and yield identifier
streams ready to feed into ``query.resolve_oids_by_prefix``.

Each helper returns a list of ints (Gaia DR3 source_ids, HIPs, SIMBAD
oids) drawn from one canonical input file. The orchestration shell
composes the helpers it needs and unions the resulting oid request set.

Adding a new input source — say, AT-HYG HD-numbered rows that have
neither HIP nor Gaia — is a new helper here plus a one-line addition
to the orchestration shell's source composition.
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Iterator

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import refresh_lib as rl  # noqa: E402


def iter_athyg_hip_for_no_gaia(csv_path: Path) -> Iterator[int]:
    """Yield AT-HYG HIPs for rows that have a HIP identifier AND no Gaia
    source_id. Used as the second tier when resolving SIMBAD oids — the
    AT-HYG-native ``gaia`` column already covers >95% of rows; the HIP
    fallback picks up Gaia-saturated bright stars (Sirius, Vega, Procyon,
    …) that are absent from DR3 because the 5-parameter fit fails on
    saturated sources.

    AT-HYG sentinels (``""`` and ``"0"``) collapse to None via
    ``athyg_int_or_none``, so a row with hip="0" and gaia="" returns
    nothing here — there's no resolvable identifier.
    """
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
    """Yield SIMBAD oids from ``data/simbad/simbad_wds_xids.tsv`` — the
    per-component WDS cross-walk produced by ``refresh-simbad-wds-xids.py``
    (dch.60). Each row has at most one ``simbad_oid``; blank cells are
    skipped (the cross-walk doesn't resolve every WDS component).
    """
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
