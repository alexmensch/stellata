#!/usr/bin/env python3
"""Refresh data/gaia/gaia_dr2_neighbourhood.tsv — gaiadr3.dr2_neighbourhood
cross-match candidates for the Gaia-only stars in the committed request
file. Drives the SID DR-reconciliation dry run (docs/sid.md § 6.2)."""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "util"))

import gaia_astrometry_pull as gap  # noqa: E402
import refresh_lib as rl  # noqa: E402
from paths import REPO_ROOT  # noqa: E402

ROOT = REPO_ROOT
REQUEST = ROOT / "data" / "gaia" / "gaia_dr2_neighbourhood_request.tsv"
OUT = ROOT / "data" / "gaia" / "gaia_dr2_neighbourhood.tsv"

ADQL_TEMPLATE = (
    "SELECT dr2_source_id, dr3_source_id, angular_distance, "
    "magnitude_difference, proper_motion_propagation "
    "FROM gaiadr3.dr2_neighbourhood "
    "WHERE dr3_source_id IN ({inlist})"
)

TSV_COLUMNS = [
    "dr2_source_id",
    "dr3_source_id",
    "angular_distance",
    "magnitude_difference",
    "proper_motion_propagation",
]

EXPECTED_SCHEMA: dict[str, type | tuple[type, ...]] = {
    "dr2_source_id": int,
    "dr3_source_id": int,
    "angular_distance": float,
    "magnitude_difference": float,
    "proper_motion_propagation": bool,
}

# angular_distance is in mas (NOT arcsec, unlike the best_neighbour
# tables) — 3 decimals keeps µas precision.
ANGULAR_DISTANCE_DECIMALS = 3

BATCH_SIZE = 2_500

# A dr3_source_id may return zero rows (no DR2 antecedent) or several
# (crowded field / split candidates). Observed at pin time: 5,912 rows
# for 5,085 requested ids, 98.9% of ids with ≥1 row. The floor guards
# against a silently truncated pull; the ceiling against an upstream
# selection change.
EXPECTED_ROW_COUNT_MIN = 5_700
EXPECTED_ROW_COUNT_MAX = 6_100
EXPECTED_ID_COVERAGE_MIN = 0.97

SCRIPT_NAME = "refresh-gaia-dr2-neighbourhood"

# Pinned (dr2_source_id, dr3_source_id) rows from the live ESA archive
# on 2026-07-07: a same-id 1:1 carry-forward, and both DR3 halves of a
# DR2 source the release split (the reconciliation procedure's split
# showcase). dr2_neighbourhood is a frozen DR3 product, so drift here
# means the archive re-indexed — investigate before re-pinning.
SPOT_CHECKS: list[dict[str, Any]] = [
    {
        "pair":                      (9178383766474496, 9178383766474496),
        "angular_distance":          (0.265, 0.01),
        "magnitude_difference":      (-0.0169, 0.001),
        "proper_motion_propagation": 1,
    },
    {
        "pair":                      (3017253180145915136, 3017253180145915136),
        "angular_distance":          (22.073, 0.01),
        "magnitude_difference":      (0.2460, 0.001),
        "proper_motion_propagation": 1,
    },
    {
        "pair":                      (3017253180145915136, 3017253184443743616),
        "angular_distance":          (357.027, 0.01),
        "magnitude_difference":      (-0.0445, 0.001),
        "proper_motion_propagation": 0,
    },
]


def main() -> None:
    force = "--force" in sys.argv

    if not force and rl.is_up_to_date(OUT, [Path(__file__), REQUEST]):
        print(f"{OUT.relative_to(ROOT)} up to date — skipping (use --force to rebuild)")
        return

    if not REQUEST.exists():
        raise SystemExit(
            f"{SCRIPT_NAME}: request file {REQUEST.relative_to(ROOT)} is missing "
            f"— see data/gaia/README.md for the derivation recipe."
        )

    dr3_ids = gap.read_source_ids(REQUEST)
    total = len(dr3_ids)
    n_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE
    print(
        f"reading {total} dr3 source_ids → {n_batches} batches of "
        f"{BATCH_SIZE} on Gaia TAP (gaiadr3.dr2_neighbourhood)"
    )

    sync_maxrec = 50_000
    client = rl.TapClient(
        backends=[
            rl.gaia_sync_backend("ESA-sync", base_url=rl.GAIA_ESA_SYNC_TAP_URL, maxrec=sync_maxrec),
            rl.gaia_sync_backend("ARI-sync", base_url=rl.GAIA_ARI_SYNC_TAP_URL, maxrec=sync_maxrec),
        ],
        retry_kwargs={"max_attempts": 5, "base_delay_s": 2.0},
    )

    rows: list[dict[str, Any]] = []
    start = time.time()
    for batch_idx, offset in enumerate(range(0, total, BATCH_SIZE), start=1):
        batch = dr3_ids[offset : offset + BATCH_SIZE]
        t0 = time.time()
        table = client.run(ADQL_TEMPLATE.format(inlist=",".join(str(i) for i in batch)))
        if batch_idx == 1:
            rl.validate_schema(table, EXPECTED_SCHEMA, label="gaiadr3.dr2_neighbourhood")
        for r in table:
            dmag = rl.coerce_masked(r["magnitude_difference"])
            rows.append({
                "dr2_source_id": int(r["dr2_source_id"]),
                "dr3_source_id": int(r["dr3_source_id"]),
                "angular_distance": float(r["angular_distance"]),
                "magnitude_difference": None if dmag is None else float(dmag),
                "proper_motion_propagation": int(r["proper_motion_propagation"]),
            })
        print(
            f"  batch {batch_idx}/{n_batches}: {len(table):4d} rows "
            f"in {time.time()-t0:5.1f}s (total rows {len(rows)})"
        )

    n = len(rows)
    if not (EXPECTED_ROW_COUNT_MIN <= n <= EXPECTED_ROW_COUNT_MAX):
        raise SystemExit(
            f"{SCRIPT_NAME}: row count {n} outside expected "
            f"[{EXPECTED_ROW_COUNT_MIN}, {EXPECTED_ROW_COUNT_MAX}] — "
            f"request file or upstream table changed; investigate before re-pinning."
        )
    covered = len({r["dr3_source_id"] for r in rows})
    coverage = covered / total
    print(f"{covered}/{total} dr3 ids with ≥1 row ({coverage*100:.1f}%) in {time.time()-start:.1f}s")
    if coverage < EXPECTED_ID_COVERAGE_MIN:
        raise SystemExit(
            f"{SCRIPT_NAME}: id coverage {coverage:.1%} below floor "
            f"{EXPECTED_ID_COVERAGE_MIN:.0%} — investigate before re-pinning."
        )

    rows_by_pair = {(r["dr2_source_id"], r["dr3_source_id"]): r for r in rows}
    for spec in SPOT_CHECKS:
        if not rl.check_spot_row(
            rows_by_pair, spec, script_name=SCRIPT_NAME, key_field="pair",
        ):
            raise SystemExit(
                f"{SCRIPT_NAME}: pinned pair {spec['pair']} missing from pull — "
                f"upstream cross-match changed; investigate before re-pinning."
            )

    rows.sort(key=lambda r: (r["dr3_source_id"], r["angular_distance"]))
    written = rl.write_tsv(
        rows,
        columns=TSV_COLUMNS,
        output=OUT,
        round_floats=ANGULAR_DISTANCE_DECIMALS,
    )
    print(f"wrote {OUT.relative_to(ROOT)} ({written} rows)")


if __name__ == "__main__":
    main()
