#!/usr/bin/env python3
"""Refresh data/gaia/gaia_dr3_magnitude_pull.tsv — the Gaia-native
magnitude term of catalogue membership, every gaiadr3.gaia_source row at
G <= 11. See scripts/refresh/README.md and data/gaia/README.md."""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "util"))

import gaia_astrometry_pull as gap  # noqa: E402
import refresh_lib as rl  # noqa: E402
from magnitude import magnitude_pull as mp  # noqa: E402
from paths import REPO_ROOT  # noqa: E402

SCRIPT_NAME = "refresh-gaia-magnitude"
ROOT = REPO_ROOT
OUT = ROOT / "data" / "gaia" / "gaia_dr3_magnitude_pull.tsv"

# see data/gaia/README.md § Why the floor carries no margin
G_MAG_FLOOR = mp.G_MAG_FLOOR
G_MAG_COLUMN = mp.G_MAG_COLUMN
SLICE_COUNT = mp.SLICE_COUNT
EDGE_DECIMALS = mp.EDGE_DECIMALS

# DR3 is a published static release, so the count should not move at all;
# the band absorbs an archive reload, not a change of selection.
EXPECTED_ROW_COUNT_MIN = 1_222_000
EXPECTED_ROW_COUNT_MAX = 1_273_000

# scripts/refresh/README.md § Gaia TAP: synchronous endpoints only.
SYNC_MAXREC = mp.slice_sync_maxrec(EXPECTED_ROW_COUNT_MAX)

# Pinned from the live ESA archive 2026-09-19, spanning the selection:
# eta UMa is its brightest row and carries a 2p solution, so it also pins the
# null-astrometry write shape a 5p-only assumption would corrupt; Barnard's
# Star is the shared anchor with refresh-gaia-astrometry-catalog (highest
# proper motion, and an rv, which a silently all-null RVS column would not
# survive); the third is the faintest row the floor admits, so it pins that
# the bound is inclusive and placed where this script says it is.
SPOT_CHECKS: list[dict[str, Any]] = [
    {
        "source_id":          1576683529448755328,   # eta UMa
        "ref_epoch":          (gap.EXPECTED_REF_EPOCH, gap.REF_EPOCH_TOL),
        "parallax":           None,
        "pmra":               None,
        "pmdec":              None,
        "ruwe":               None,
        "phot_g_mean_mag":    (1.731607, 0.0001),
        "phot_bp_mean_mag":   (2.469120, 0.0001),
        "phot_rp_mean_mag":   (2.130753, 0.0001),
    },
    {
        "source_id":          4472832130942575872,   # Barnard's Star
        "ref_epoch":          (gap.EXPECTED_REF_EPOCH, gap.REF_EPOCH_TOL),
        "parallax":           (546.9759, 0.001),
        "pmra":               (-801.5510, 0.001),
        "pmdec":              (10362.3942, 0.001),
        "phot_g_mean_mag":    (8.193974, 0.0001),
        "radial_velocity":    (-110.4682, 0.001),
    },
    {
        "source_id":          5878248887353382016,   # faintest row admitted
        "ref_epoch":          (gap.EXPECTED_REF_EPOCH, gap.REF_EPOCH_TOL),
        "parallax":           (1.2740, 0.001),
        "phot_g_mean_mag":    (10.999999, 0.0001),
        "radial_velocity":    (-20.0825, 0.001),
    },
]

magnitude_slices = mp.magnitude_slices


def slice_adql(bounds: mp.MagnitudeSlice) -> str:
    return f"{gap.SELECT_CLAUSE} WHERE {mp.magnitude_predicate(bounds, G_MAG_COLUMN)}"


def assert_within_floor(source_id: int, g_mag: Any) -> None:
    """A row the slice bounds should never have reached is a partition fault,
    not a value to filter: silently dropping it would hide the edge that let
    it through, and keeping it would put the floor somewhere other than where
    this script states it."""
    if g_mag is None:
        raise SystemExit(
            f"{SCRIPT_NAME}: source_id {source_id} returned a null "
            f"phot_g_mean_mag — no magnitude predicate can admit it."
        )
    if float(g_mag) > G_MAG_FLOOR:
        raise SystemExit(
            f"{SCRIPT_NAME}: source_id {source_id} has G={float(g_mag)} above "
            f"the floor {G_MAG_FLOOR} — a slice bound is wrong."
        )


def pull(
    client: rl.TapClient,
    checkpoint: rl.BatchCheckpoint | None,
    *,
    log: Any = print,
) -> tuple[list[tuple[int, str]], dict[int, Any]]:
    """Query every slice and return `(source_id, output line)` pairs in
    arrival order, plus the raw rows the spot checks are pinned on.

    Rows are kept as formatted lines rather than mappings — see
    `refresh_lib.format_tsv_row`.
    """
    slices = magnitude_slices()
    spot_ids = {spec["source_id"] for spec in SPOT_CHECKS}
    rows: list[tuple[int, str]] = []
    spot_rows: dict[int, Any] = {}

    def collect(table: Any) -> None:
        for row in table:
            source_id = int(row["source_id"])
            assert_within_floor(source_id, rl.coerce_masked(row["phot_g_mean_mag"]))
            if source_id in spot_ids:
                spot_rows[source_id] = row
            rows.append(
                (source_id, rl.format_tsv_row(gap.write_row(row), gap.TSV_COLUMNS))
            )

    rl.run_in_batches(
        slices,
        1,
        lambda batch: client.run(slice_adql(batch[0])),
        collect,
        schema=gap.EXPECTED_SCHEMA,
        schema_label="gaiadr3.gaia_source",
        checkpoint=checkpoint,
        log=log,
    )
    return rows, spot_rows


def main() -> None:
    force = "--force" in sys.argv
    script_path = Path(__file__).resolve()
    if not force and rl.is_up_to_date(OUT, [script_path, gap.MODULE_PATH, mp.MODULE_PATH]):
        print(f"{OUT.relative_to(ROOT)} up to date — skipping (use --force to rebuild)")
        return

    print(
        f"pulling gaiadr3.gaia_source at G <= {G_MAG_FLOOR} in {SLICE_COUNT} "
        f"magnitude slices (MAXREC {SYNC_MAXREC:,})"
    )
    start = time.time()
    rows, spot_rows = pull(
        rl.gaia_sync_client(SYNC_MAXREC),
        rl.BatchCheckpoint(OUT.with_suffix(OUT.suffix + ".ckpt")),
    )

    mp.assert_partitioned(
        len(rows), len({source_id for source_id, _ in rows}), SCRIPT_NAME
    )
    rl.assert_row_count(
        len(rows),
        EXPECTED_ROW_COUNT_MIN,
        EXPECTED_ROW_COUNT_MAX,
        SCRIPT_NAME,
        hint=(
            "DR3 is a static release, so a count outside the band means the "
            "floor, the slice edges or the archive's own reduction moved — "
            "investigate before re-pinning."
        ),
    )
    rl.validate_spot_rows(
        spot_rows,
        SPOT_CHECKS,
        script_name=SCRIPT_NAME,
        missing_hint=(
            "missing from the pull — a pinned row cannot leave a static "
            "release, so a slice edge or the floor has moved."
        ),
    )

    rows.sort(key=lambda row: row[0])
    written = rl.write_tsv_lines(
        (line for _, line in rows), gap.TSV_COLUMNS, OUT
    )
    print(
        f"wrote {OUT.relative_to(ROOT)} ({written:,} rows) in "
        f"{(time.time() - start) / 60:.1f}m"
    )


if __name__ == "__main__":
    main()
