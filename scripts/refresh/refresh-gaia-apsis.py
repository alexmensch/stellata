#!/usr/bin/env python3
"""Refresh data/gaia/gaia_dr3_apsis.tsv — Gaia DR3 Apsis astrophysical
parameters (Teff, logg, [M/H], A0, ESP-HS spectral type) per membership
source_id."""

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
MEMBERSHIP = ROOT / "data" / "membership" / "membership-manifest.tsv"
OUT = ROOT / "data" / "gaia" / "gaia_dr3_apsis.tsv"

TSV_COLUMNS = [
    "source_id",
    "teff_gspphot",
    "logg_gspphot",
    "mh_gspphot",
    "azero_gspphot",
    "teff_gspspec",
    "logg_gspspec",
    "mh_gspspec",
    "spectraltype_esphs",
]

# Columns that must be passed through as strings on write — distinguishes
# the ESP-HS enum from the numeric Apsis fields. Adding a new categorical
# column means one append here in addition to TSV_COLUMNS + EXPECTED_SCHEMA.
STRING_COLUMNS: frozenset[str] = frozenset({"spectraltype_esphs"})

ADQL_TEMPLATE = (
    "SELECT " + ", ".join(TSV_COLUMNS) + " "
    "FROM gaiadr3.astrophysical_parameters "
    "WHERE source_id IN ({inlist})"
)

# upstream dtypes: int64 + 7 × float32 (live probe 2026-05-18).
# validate_schema maps `float` to np.floating via _dtype_matches so the
# float32 width passes — bailer-jones uses the same pattern.
EXPECTED_SCHEMA: dict[str, type | tuple[type, ...]] = {
    "source_id": int,
    "teff_gspphot": float,
    "logg_gspphot": float,
    "mh_gspphot": float,
    "azero_gspphot": float,
    "teff_gspspec": float,
    "logg_gspspec": float,
    "mh_gspspec": float,
    "spectraltype_esphs": str,
}

# 5000 ids per IN-clause — same empirical sweet spot as refresh-bailer-jones.py
# (CDS / ESA TAP runtime is superlinear in IN-clause length beyond ~5k).
BATCH_SIZE = 5_000

# DR3 is frozen — the 1000-source-id probe returned 999 rows (99.9% of
# input). The manifest binds ~370 k source_ids, so ~370 k ± 5% is the
# expected count: the query's matched-row count (unfiltered TAP returns
# every matched row, all-NULL Apsis rows included), not the union-(teff+logg)
# coverage projection below it. The band tracks the membership term's size.
EXPECTED_ROW_COUNT_MIN = 350_000
EXPECTED_ROW_COUNT_MAX = 390_000

# Union-(teff+logg) coverage — the actual ingestable bucket. Floor sits
# ~5 pts below the ~84.8% observed at last probe, absorbing Apsis
# pipeline-version variation without false-failing.
EXPECTED_UNION_COVERAGE_MIN = 0.80

# ESP-HS spectral-type enum coverage floor. ESP-HS is the hottest-star
# branch of the Apsis chain and resolves spectraltype_esphs for ~30%+
# of DR3 sources. Below this floor the pull is likely broken.
EXPECTED_SPECTRALTYPE_COVERAGE_MIN = 0.20

# Teff has order ~1-10 K formal uncertainty, logg ~0.01-0.1 dex,
# [M/H] ~0.01-0.1 dex, A_0 ~0.01-0.1 mag. 4 decimals on logg/mh/azero
# preserves all useful signal; teff stays integer-K (1 decimal handles
# the rare fractional values Gaia emits).
TEFF_DECIMALS = 1
DEX_DECIMALS = 4

# Self-consistency spot-checks against pinned DR3 Apsis rows. DR3 is
# frozen so values can be pinned tightly; tolerance set to ~1% of the
# formal uncertainty quoted in DR3 (looser than archive-side rounding,
# tighter than any plausible drift this script could itself introduce).
#
# Three rows × 8 fields across the three Apsis coverage shapes so a
# DR3.x reload, column rename, or null-handling regression surfaces
# against at least one row whose code-path it touched. The all-null row
# is critical — it exercises `coerce_masked` for every column
# simultaneously, the most common silent-corruption shape.
#
#   - JOINT     : gspphot + gspspec both populated (joint case)
#   - PHOT_ONLY : gspphot populated, gspspec masked  (BP/RP only)
#   - ALL_NULL  : astrophysical_parameters row exists but every Apsis
#                 cell is masked (no Apsis processing for this source)
#
# Pattern matches refresh-gaia-nss.py's 3-rows × 3-solution-type
# robustness extension, applied to the Apsis coverage axis instead.
SPOT_CHECKS: list[dict[str, Any]] = [
    {
        "source_id":     164919361120841856,  # JOINT — gspphot + gspspec
        "teff_gspphot":  (6115.373, 0.01),
        "logg_gspphot":  (3.4688, 0.001),
        "mh_gspphot":    (-0.4904, 0.001),
        "azero_gspphot": (0.677, 0.001),
        "teff_gspspec":  (6624.0, 0.1),
        "logg_gspspec":  (4.17, 0.01),
        "mh_gspspec":    (-0.07, 0.01),
    },
    {
        "source_id":     1631144127080202752,  # PHOT_ONLY — gspspec masked
        "teff_gspphot":  (6807.42, 0.01),
        "logg_gspphot":  (3.6578, 0.001),
        "mh_gspphot":    (-0.3636, 0.001),
        "azero_gspphot": (0.0655, 0.001),
        "teff_gspspec":  None,
        "logg_gspspec":  None,
        "mh_gspspec":    None,
    },
    {
        "source_id":     3305738406773071744,  # ALL_NULL — every column masked
        "teff_gspphot":  None,
        "logg_gspphot":  None,
        "mh_gspphot":    None,
        "azero_gspphot": None,
        "teff_gspspec":  None,
        "logg_gspspec":  None,
        "mh_gspspec":    None,
    },
]


def query_batch(client: rl.TapClient, ids: list[int]):
    inlist = ",".join(str(i) for i in ids)
    return client.run(ADQL_TEMPLATE.format(inlist=inlist))


SCRIPT_NAME = "refresh-gaia-apsis"


def _has_teff_logg(row: Any, teff: str, logg: str) -> bool:
    """A pipeline covers a row when both its Teff and log g are non-null.
    Union coverage across pipelines is the headline number motivating Apsis
    ingest — see research/star-spectral-rendition/README.md § Tier 2.
    """
    return (
        rl.coerce_masked(row[teff]) is not None
        and rl.coerce_masked(row[logg]) is not None
    )


def write_row(row: Any) -> dict[str, Any]:
    """Build one output dict — coerce_masked every cell, round floats so
    write_tsv emits stable widths. Teff stays at 1 decimal; logg / [M/H]
    / A_0 at 4 decimals (~1% of formal uncertainty, see DEX_DECIMALS).
    Categorical columns in ``STRING_COLUMNS`` pass through as strings."""
    out: dict[str, Any] = {"source_id": int(row["source_id"])}
    for col in TSV_COLUMNS[1:]:
        v = rl.coerce_masked(row[col])
        if v is None:
            out[col] = None
        elif col in STRING_COLUMNS:
            out[col] = str(v)
        elif col.startswith("teff_"):
            out[col] = f"{float(v):.{TEFF_DECIMALS}f}"
        else:
            out[col] = f"{float(v):.{DEX_DECIMALS}f}"
    return out


def main() -> None:
    force = "--force" in sys.argv

    if not force and rl.is_up_to_date(OUT, [Path(__file__), MEMBERSHIP]):
        print(f"{OUT.relative_to(ROOT)} up to date — skipping (use --force to rebuild)")
        return

    source_ids = rl.read_membership_source_ids(MEMBERSHIP)
    total = len(source_ids)
    if total == 0:
        raise SystemExit(f"refresh-gaia-apsis: no source_ids in {MEMBERSHIP}")
    n_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE
    print(
        f"reading {total} manifest source_ids → {n_batches} batches of "
        f"{BATCH_SIZE} on Gaia TAP (gaiadr3.astrophysical_parameters)"
    )

    client = rl.gaia_sync_client(BATCH_SIZE * 2)
    rows_by_id: dict[int, Any] = {}

    def collect(table: Any) -> None:
        for row in table:
            rows_by_id[int(row["source_id"])] = row

    start = time.time()
    rl.run_in_batches(
        source_ids, BATCH_SIZE, lambda b: query_batch(client, b), collect,
        schema=EXPECTED_SCHEMA, schema_label="gaiadr3.astrophysical_parameters",
        checkpoint=rl.BatchCheckpoint(OUT.with_suffix(OUT.suffix + ".ckpt")),
    )

    matched = len(rows_by_id)
    print(f"matched {matched}/{total} in {(time.time()-start)/60:.1f}m")

    rl.assert_row_count(
        matched, EXPECTED_ROW_COUNT_MIN, EXPECTED_ROW_COUNT_MAX, SCRIPT_NAME,
        hint="upstream selection or the manifest's source_id set has changed; "
        "investigate before re-pinning.",
    )

    union_coverage = rl.report_coverage(
        rows_by_id.values(), total,
        [
            ("(teff_gspphot AND logg_gspphot)",
             lambda r: _has_teff_logg(r, "teff_gspphot", "logg_gspphot")),
            ("(teff_gspspec AND logg_gspspec)",
             lambda r: _has_teff_logg(r, "teff_gspspec", "logg_gspspec")),
        ],
        label="manifest source_ids",
    )
    if union_coverage < EXPECTED_UNION_COVERAGE_MIN:
        raise SystemExit(
            f"refresh-gaia-apsis: union (teff+logg) coverage "
            f"{union_coverage:.1%} below floor "
            f"{EXPECTED_UNION_COVERAGE_MIN:.0%} — Apsis pipeline output "
            f"or the manifest's bindings have regressed; investigate."
        )

    spectraltype_filled = sum(
        1 for r in rows_by_id.values()
        if rl.coerce_masked(r["spectraltype_esphs"]) is not None
        and str(rl.coerce_masked(r["spectraltype_esphs"])).strip()
    )
    spectraltype_coverage = spectraltype_filled / total
    print(
        f"  spectraltype_esphs non-null:     {spectraltype_filled:>6} "
        f"({100*spectraltype_coverage:.1f}%)"
    )
    if spectraltype_coverage < EXPECTED_SPECTRALTYPE_COVERAGE_MIN:
        raise SystemExit(
            f"refresh-gaia-apsis: spectraltype_esphs coverage "
            f"{spectraltype_coverage:.1%} below floor "
            f"{EXPECTED_SPECTRALTYPE_COVERAGE_MIN:.0%} — verify the SELECT "
            f"includes spectraltype_esphs and that ESP-HS returns real values."
        )

    rl.validate_spot_rows(rows_by_id, SPOT_CHECKS, script_name=SCRIPT_NAME)

    # Emit sorted by source_id so re-runs are byte-identical.
    rows = (write_row(rows_by_id[sid]) for sid in sorted(rows_by_id))
    written = rl.write_tsv(rows, columns=TSV_COLUMNS, output=OUT)
    print(f"wrote {OUT.relative_to(ROOT)} ({written} rows)")


if __name__ == "__main__":
    main()
