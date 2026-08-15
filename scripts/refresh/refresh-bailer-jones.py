#!/usr/bin/env python3
"""Refresh data/bailer-jones/bailer-jones-dr3.tsv — Bailer-Jones 2021
(VizieR I/352) Bayesian DR3 distance posteriors per spine source_id."""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "util"))

import refresh_lib as rl  # noqa: E402
from paths import REPO_ROOT  # noqa: E402

ROOT = REPO_ROOT
SPINE = ROOT / "data" / "athyg" / "inherited-spine.tsv"
OUT = ROOT / "data" / "bailer-jones" / "bailer-jones-dr3.tsv"

# 5000 ids → ~98 KB query, ~80 s round-trip on CDS TAP. 10000 was ~5 min
# (superlinear server cost in IN-clause length).
BATCH_SIZE = 5_000

# Pinned coverage bounds. AT-HYG has ~315 k source_ids; the empirical first
# 5000-id probe returned 98.7%, so ≥ 90% (~283 k) is the floor and the
# upper bound is just AT-HYG itself (can't exceed input set size).
EXPECTED_COVERAGE_MIN = 0.90
EXPECTED_ROW_COUNT_MAX = 320_000

# Distance precision: B-J posterior intervals are typically ±10% of the
# median (e.g. ±30 pc on a 350 pc star), so 0.001 pc (millipc) preserves
# all useful signal without bloating the TSV.
DISTANCE_DECIMALS = 3

# VizieR-on-the-wire → paper-name TSV column mapping. The keys are the
# case-sensitive column names exposed by I/352/gedr3dis on the VizieR
# TAP service; the values are the Bailer-Jones 2021 paper's names (and
# what downstream consumers — build-catalog.ts etc. — will read).
VIZIER_TO_PAPER = {
    "Source": "source_id",
    "rgeo": "r_med_geo",
    "b_rgeo": "r_lo_geo",
    "B_rgeo": "r_hi_geo",
    "rpgeo": "r_med_photogeo",
    "b_rpgeo": "r_lo_photogeo",
    "B_rpgeo": "r_hi_photogeo",
    "Flag": "flag",
}

# Output column order — see file docstring for semantics.
TSV_COLUMNS = list(VIZIER_TO_PAPER.values())

# Schema expected from the VizieR TAP table (validated post-query).
EXPECTED_SCHEMA: dict[str, type | tuple[type, ...]] = {
    "Source": int,
    "rgeo": float,
    "b_rgeo": float,
    "B_rgeo": float,
    "rpgeo": float,
    "b_rpgeo": float,
    "B_rpgeo": float,
    "Flag": int,
}

ADQL_TEMPLATE = (
    'SELECT "Source", "rgeo", "b_rgeo", "B_rgeo", '
    '"rpgeo", "b_rpgeo", "B_rpgeo", "Flag" '
    'FROM "I/352/gedr3dis" '
    'WHERE "Source" IN ({inlist})'
)

SCRIPT_NAME = "refresh-bailer-jones"

# Pinned source_id → posterior rows from VizieR I/352/gedr3dis (the
# machine-readable form of Bailer-Jones et al. 2021, AJ 161, 147). Unlike
# the HIP / Tyc xmatch tables, the external anchor here IS the Gaia
# source_id — which a future DR4 maintenance reload could quietly retire
# for 1-2 IDs in a 5-ID sample. Tolerate up to MAX_MISSING_PINS quiet
# retirements (logged as a warning); above that, hard-fail. The helper
# still raises immediately on any present-but-drifting row, so the
# regression-detection goal is preserved.
MAX_MISSING_PINS = 1

# Five fixtures cross-listed with scripts/catalog/catalog-pure.test.ts —
# the four catastrophic-parallax-inversion supergiants (HIP 22365, 25733,
# 38430, 46144) and the well-measured F-dwarf HIP 23785 control. r_med_*
# values agree to the per-row resolution published in the paper; pinning
# both r_med_geo + r_med_photogeo guards against a column-rename or unit
# shift either pipeline.
SPOT_CHECKS: list[dict[str, Any]] = [
    {
        "source_id":      204531088580182016,    # HIP 22365 (37% B-J pullback)
        "r_med_geo":      (6366.668, 0.5),
        "r_med_photogeo": (6244.791, 0.5),
        "flag":           10033,
    },
    {
        "source_id":      183255985260080896,    # HIP 25733 (62% B-J pullback)
        "r_med_geo":      (5839.921, 0.5),
        "r_med_photogeo": (5466.246, 0.5),
        "flag":           10033,
    },
    {
        "source_id":      5602025904044961536,   # HIP 38430 (51% B-J pullback)
        "r_med_geo":      (6622.035, 0.5),
        "r_med_photogeo": (6215.232, 0.5),
        "flag":           10033,
    },
    {
        "source_id":      1040043514891491968,   # HIP 46144 (18% B-J pullback)
        "r_med_geo":      (7509.293, 0.5),
        "r_med_photogeo": (7515.496, 0.5),
        "flag":           10022,
    },
    {
        "source_id":      4773096563064098432,   # HIP 23785 (F-dwarf, within 5%)
        "r_med_geo":      (93.528, 0.5),
        "r_med_photogeo": (92.871, 0.5),
        "flag":           10023,
    },
]


def query_batch(client: rl.TapClient, ids: list[int]):
    inlist = ",".join(str(i) for i in ids)
    return client.run(ADQL_TEMPLATE.format(inlist=inlist))


def rename_row(row, vizier_to_paper: dict[str, str]) -> dict[str, object]:
    return {paper: row[vizier] for vizier, paper in vizier_to_paper.items()}


def main() -> None:
    force = "--force" in sys.argv

    if not force and rl.is_up_to_date(OUT, [Path(__file__), SPINE]):
        print(f"{OUT.relative_to(ROOT)} up to date — skipping (use --force to rebuild)")
        return

    source_ids = rl.read_spine_source_ids(SPINE)
    total = len(source_ids)
    if total == 0:
        raise SystemExit(f"refresh-bailer-jones: no source_ids in {SPINE}")
    n_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE
    print(
        f"reading {total} spine source_ids → {n_batches} batches of "
        f"{BATCH_SIZE} on CDS TAP (I/352/gedr3dis)"
    )

    client = rl.TapClient(backends=[rl.cds_backend()])
    rows: list[dict[str, object]] = []

    def collect(table: Any) -> None:
        for row in table:
            rows.append(rename_row(row, VIZIER_TO_PAPER))

    start = time.time()
    rl.run_in_batches(
        source_ids, BATCH_SIZE, lambda b: query_batch(client, b), collect,
        schema=EXPECTED_SCHEMA, schema_label="bailer-jones I/352/gedr3dis",
        checkpoint=rl.BatchCheckpoint(OUT.with_suffix(OUT.suffix + ".ckpt")),
    )

    matched = len(rows)
    coverage = matched / total
    print(f"matched in {(time.time()-start)/60:.1f}m")
    rl.report_coverage(
        rows, total,
        [
            ("r_med_geo",
             lambda r: rl.coerce_masked(r["r_med_geo"]) is not None),
            ("r_med_photogeo",
             lambda r: rl.coerce_masked(r["r_med_photogeo"]) is not None),
        ],
        label="AT-HYG source_ids",
    )
    if coverage < EXPECTED_COVERAGE_MIN:
        raise SystemExit(
            f"{SCRIPT_NAME}: coverage {coverage:.1%} below floor "
            f"{EXPECTED_COVERAGE_MIN:.0%} — VizieR table or AT-HYG source_id "
            f"set has changed; investigate before re-pinning."
        )
    if matched > EXPECTED_ROW_COUNT_MAX:
        raise SystemExit(
            f"{SCRIPT_NAME}: row count {matched} above ceiling "
            f"{EXPECTED_ROW_COUNT_MAX} — input set must have grown; "
            f"raise the ceiling intentionally."
        )

    rows_by_id = {int(r["source_id"]): r for r in rows}
    rl.check_spot_rows_tolerant(
        rows_by_id, SPOT_CHECKS, script_name=SCRIPT_NAME,
        max_missing=MAX_MISSING_PINS,
        warn_template="  WARNING: pinned source_id {key} not in result "
        "(a DR4 maintenance reload may have retired this ID)",
        fail_hint="VizieR I/352 has dropped more rows than expected; "
        "investigate before re-pinning.",
    )

    written = rl.write_tsv(
        rows,
        columns=TSV_COLUMNS,
        output=OUT,
        round_floats=DISTANCE_DECIMALS,
    )
    print(f"wrote {OUT.relative_to(ROOT)} ({written} rows)")


if __name__ == "__main__":
    main()
