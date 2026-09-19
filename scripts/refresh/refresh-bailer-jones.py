#!/usr/bin/env python3
"""Refresh data/bailer-jones/bailer-jones-dr3.tsv — Bailer-Jones 2021
Bayesian DR3 distance posteriors over the catalogue's deep population.
See data/bailer-jones/README.md."""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "util"))

import refresh_lib as rl  # noqa: E402
from paths import REPO_ROOT  # noqa: E402

SCRIPT_NAME = "refresh-bailer-jones"
ROOT = REPO_ROOT
REQUEST = ROOT / "data" / "gaia" / "gaia_catalog_source_id_request.tsv"
OUT = ROOT / "data" / "bailer-jones" / "bailer-jones-dr3.tsv"

# see data/bailer-jones/README.md § Why the pull is ESA-side
TABLE = "external.gaiaedr3_distance"

TSV_COLUMNS = [
    "source_id",
    "r_med_geo",
    "r_lo_geo",
    "r_hi_geo",
    "r_med_photogeo",
    "r_lo_photogeo",
    "r_hi_photogeo",
    "flag",
]

# `flag` is a five-digit decision-tree code the build does not read; it is
# a VARCHAR on the archive, so it passes through as a string.
STRING_COLUMNS: frozenset[str] = frozenset({"flag"})

EXPECTED_SCHEMA: dict[str, type | tuple[type, ...]] = {
    "source_id": int,
    "r_med_geo": float,
    "r_lo_geo": float,
    "r_hi_geo": float,
    "r_med_photogeo": float,
    "r_lo_photogeo": float,
    "r_hi_photogeo": float,
    "flag": str,
}

# Distance precision: B-J posterior intervals are typically ±10% of the
# median (e.g. ±30 pc on a 350 pc star), so 0.001 pc (millipc) preserves
# all useful signal without bloating the TSV.
DISTANCE_DECIMALS = 3

# The magnitude leg's own band. Measured 2026-09-19: 1,236,322 of the
# 1,247,240 sources at G <= 11 carry a posterior (99.1%) — a source without
# one published no usable parallax. DR3 is static, so the band absorbs an
# archive reload rather than a change of selection.
EXPECTED_MAGNITUDE_ROWS_MIN = 1_210_000
EXPECTED_MAGNITUDE_ROWS_MAX = 1_262_000

# Coverage floor over the request set. The empirical first 5000-id probe
# returned 98.7%, so >= 90%.
EXPECTED_COVERAGE_MIN = 0.90

# scripts/refresh/README.md § Gaia TAP: synchronous endpoints only.
SYNC_MAXREC = rl.slice_sync_maxrec(EXPECTED_MAGNITUDE_ROWS_MAX)

# Pinned posterior rows. Unlike the HIP / Tyc xmatch tables, the external
# anchor here IS the Gaia source_id — which a future DR4 maintenance reload
# could quietly retire for 1-2 IDs in a 5-ID sample. Tolerate up to
# MAX_MISSING_PINS quiet retirements (logged as a warning); above that,
# hard-fail. The helper still raises immediately on any present-but-drifting
# row, so the regression-detection goal is preserved.
MAX_MISSING_PINS = 1

# Five fixtures cross-listed with scripts/catalog/record/catalog-pure.test.ts —
# the four catastrophic-parallax-inversion supergiants (HIP 22365, 25733,
# 38430, 46144) and the well-measured F-dwarf HIP 23785 control. Pinning
# both r_med_geo + r_med_photogeo guards against a column-rename or unit
# shift either pipeline.
SPOT_CHECKS: list[dict[str, Any]] = [
    {
        "source_id":      204531088580182016,    # HIP 22365 (37% B-J pullback)
        "r_med_geo":      (6366.668, 0.5),
        "r_med_photogeo": (6244.791, 0.5),
        "flag":           "10033",
    },
    {
        "source_id":      183255985260080896,    # HIP 25733 (62% B-J pullback)
        "r_med_geo":      (5839.921, 0.5),
        "r_med_photogeo": (5466.246, 0.5),
        "flag":           "10033",
    },
    {
        "source_id":      5602025904044961536,   # HIP 38430 (51% B-J pullback)
        "r_med_geo":      (6622.035, 0.5),
        "r_med_photogeo": (6215.232, 0.5),
        "flag":           "10033",
    },
    {
        "source_id":      1040043514891491968,   # HIP 46144 (18% B-J pullback)
        "r_med_geo":      (7509.293, 0.5),
        "r_med_photogeo": (7515.496, 0.5),
        "flag":           "10022",
    },
    {
        "source_id":      4773096563064098432,   # HIP 23785 (F-dwarf, within 5%)
        "r_med_geo":      (93.528, 0.5),
        "r_med_photogeo": (92.871, 0.5),
        "flag":           "10023",
    },
]


def write_row(row: Any) -> dict[str, Any]:
    out: dict[str, Any] = {"source_id": int(row["source_id"])}
    for col in TSV_COLUMNS[1:]:
        v = rl.coerce_masked(row[col])
        if v is None:
            out[col] = None
        elif col in STRING_COLUMNS:
            out[col] = str(v)
        else:
            out[col] = f"{float(v):.{DISTANCE_DECIMALS}f}"
    return out


def main() -> None:
    force = "--force" in sys.argv

    if not force and rl.is_up_to_date(OUT, [Path(__file__), REQUEST]):
        print(f"{OUT.relative_to(ROOT)} up to date — skipping (use --force to rebuild)")
        return

    lines: dict[int, str] = {}
    spot_ids = {spec["source_id"] for spec in SPOT_CHECKS}
    spot_rows: dict[int, Any] = {}
    photogeo = 0
    geo = 0
    usable = 0

    def on_row(row: Any) -> None:
        nonlocal photogeo, geo, usable
        source_id = int(row["source_id"])
        if source_id in spot_ids:
            spot_rows[source_id] = row
        has_photogeo = rl.coerce_masked(row["r_med_photogeo"]) is not None
        has_geo = rl.coerce_masked(row["r_med_geo"]) is not None
        photogeo += has_photogeo
        geo += has_geo
        usable += has_photogeo or has_geo
        lines[source_id] = rl.format_tsv_row(write_row(row), TSV_COLUMNS)

    start = time.time()
    pulled = rl.pull_deep_population(
        rl.gaia_sync_client(SYNC_MAXREC),
        table=TABLE,
        columns=TSV_COLUMNS,
        request_path=REQUEST,
        on_row=on_row,
        script_name=SCRIPT_NAME,
        maxrec=SYNC_MAXREC,
        checkpoint_base=OUT,
        schema=EXPECTED_SCHEMA,
        schema_label=TABLE,
    )

    rl.assert_row_count(
        pulled.from_magnitude,
        EXPECTED_MAGNITUDE_ROWS_MIN,
        EXPECTED_MAGNITUDE_ROWS_MAX,
        SCRIPT_NAME,
        hint=(
            "DR3 and the Bailer-Jones catalogue are both static, so a count "
            "outside the band means the floor, the slice edges or the "
            "archive's own reduction moved — investigate before re-pinning."
        ),
    )

    rl.report_coverage_counts(
        len(pulled.seen), len(pulled.seen),
        [("r_med_photogeo", photogeo), ("r_med_geo", geo)],
        usable,
        label="pulled source_ids",
    )
    rl.assert_request_coverage(pulled, EXPECTED_COVERAGE_MIN, SCRIPT_NAME)

    rl.check_spot_rows_tolerant(
        spot_rows, SPOT_CHECKS, script_name=SCRIPT_NAME,
        max_missing=MAX_MISSING_PINS,
        warn_template="  WARNING: pinned source_id {key} not in result "
        "(a DR4 maintenance reload may have retired this ID)",
        fail_hint="the archive has dropped more rows than expected; "
        "investigate before re-pinning.",
    )

    written = rl.write_tsv_lines(
        (lines[sid] for sid in sorted(lines)), TSV_COLUMNS, OUT
    )
    print(
        f"wrote {OUT.relative_to(ROOT)} ({written:,} rows) in "
        f"{(time.time() - start) / 60:.1f}m"
    )


if __name__ == "__main__":
    main()
