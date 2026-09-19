#!/usr/bin/env python3
"""Refresh data/gaia/gaia_dr3_apsis.tsv — Gaia DR3 Apsis astrophysical
parameters (Teff, logg, [M/H], A0, ESP-HS spectral type) over the
catalogue's deep population. See data/gaia/README.md."""

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
REQUEST = ROOT / "data" / "gaia" / "gaia_catalog_source_id_request.tsv"
OUT = ROOT / "data" / "gaia" / "gaia_dr3_apsis.tsv"

TABLE = "gaiadr3.astrophysical_parameters"

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

# Counts every matched row, all-NULL Apsis rows included — not the
# union-(teff+logg) projection below it. Measured 1,246,769 on 2026-09-19.
EXPECTED_MAGNITUDE_ROWS_MIN = 1_222_000
EXPECTED_MAGNITUDE_ROWS_MAX = 1_260_000

# Union-(teff+logg) coverage — the actual ingestable bucket. Floor sits
# ~5 pts below the ~84.8% observed at last probe, absorbing Apsis
# pipeline-version variation without false-failing.
EXPECTED_UNION_COVERAGE_MIN = 0.80

# scripts/refresh/README.md § Gaia TAP: synchronous endpoints only.
SYNC_MAXREC = rl.slice_sync_maxrec(EXPECTED_MAGNITUDE_ROWS_MAX)

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

    if not force and rl.is_up_to_date(OUT, [Path(__file__), REQUEST]):
        print(f"{OUT.relative_to(ROOT)} up to date — skipping (use --force to rebuild)")
        return

    lines: dict[int, str] = {}
    spot_ids = {spec["source_id"] for spec in SPOT_CHECKS}
    spot_rows: dict[int, Any] = {}
    gspphot = 0
    gspspec = 0
    union = 0
    spectraltype_filled = 0

    def on_row(row: Any) -> None:
        nonlocal gspphot, gspspec, union, spectraltype_filled
        source_id = int(row["source_id"])
        if source_id in spot_ids:
            spot_rows[source_id] = row
        phot = _has_teff_logg(row, "teff_gspphot", "logg_gspphot")
        spec = _has_teff_logg(row, "teff_gspspec", "logg_gspspec")
        gspphot += phot
        gspspec += spec
        union += phot or spec
        esphs = rl.coerce_masked(row["spectraltype_esphs"])
        spectraltype_filled += bool(esphs is not None and str(esphs).strip())
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
        hint="DR3 is frozen, so a count outside the band means the floor, the "
        "slice edges or the archive's own reduction moved — investigate "
        "before re-pinning.",
    )

    union_coverage = rl.report_coverage_counts(
        len(pulled.seen), len(pulled.seen),
        [
            ("(teff_gspphot AND logg_gspphot)", gspphot),
            ("(teff_gspspec AND logg_gspspec)", gspspec),
        ],
        union,
        label="pulled source_ids",
    )
    if union_coverage < EXPECTED_UNION_COVERAGE_MIN:
        raise SystemExit(
            f"{SCRIPT_NAME}: union (teff+logg) coverage "
            f"{union_coverage:.1%} below floor "
            f"{EXPECTED_UNION_COVERAGE_MIN:.0%} — Apsis pipeline output has "
            f"regressed; investigate."
        )

    spectraltype_coverage = spectraltype_filled / len(pulled.seen)
    print(
        f"  spectraltype_esphs non-null:     {spectraltype_filled:>9,} "
        f"({100*spectraltype_coverage:.1f}%)"
    )
    if spectraltype_coverage < EXPECTED_SPECTRALTYPE_COVERAGE_MIN:
        raise SystemExit(
            f"{SCRIPT_NAME}: spectraltype_esphs coverage "
            f"{spectraltype_coverage:.1%} below floor "
            f"{EXPECTED_SPECTRALTYPE_COVERAGE_MIN:.0%} — verify the SELECT "
            f"includes spectraltype_esphs and that ESP-HS returns real values."
        )

    rl.validate_spot_rows(spot_rows, SPOT_CHECKS, script_name=SCRIPT_NAME)

    # Emit sorted by source_id so re-runs are byte-identical.
    written = rl.write_tsv_lines(
        (lines[sid] for sid in sorted(lines)), TSV_COLUMNS, OUT
    )
    print(
        f"wrote {OUT.relative_to(ROOT)} ({written:,} rows) in "
        f"{(time.time() - start) / 60:.1f}m"
    )


if __name__ == "__main__":
    main()
