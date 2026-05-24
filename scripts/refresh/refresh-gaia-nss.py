#!/usr/bin/env python3
"""Refresh data/gaia/gaia_dr3_nss_two_body.tsv — full
gaiadr3.nss_two_body_orbit table (Thiele-Innes orbital solutions)."""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import refresh_lib as rl  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
OUT = ROOT / "data" / "gaia" / "gaia_dr3_nss_two_body.tsv"

TSV_COLUMNS = [
    "source_id",
    "nss_solution_type",
    "period",
    "period_error",
    "t_periastron",
    "t_periastron_error",
    "eccentricity",
    "eccentricity_error",
    "a_thiele_innes",
    "a_thiele_innes_error",
    "b_thiele_innes",
    "b_thiele_innes_error",
    "f_thiele_innes",
    "f_thiele_innes_error",
    "g_thiele_innes",
    "g_thiele_innes_error",
    "c_thiele_innes",
    "c_thiele_innes_error",
    "h_thiele_innes",
    "h_thiele_innes_error",
    "inclination",
    "inclination_error",
    "arg_periastron",
    "arg_periastron_error",
    "mass_ratio",
    "mass_ratio_error",
    "goodness_of_fit",
    "significance",
]

ADQL = (
    "SELECT "
    + ", ".join(TSV_COLUMNS)
    + " FROM gaiadr3.nss_two_body_orbit "
    + "ORDER BY source_id"
)

EXPECTED_SCHEMA: dict[str, type | tuple[type, ...]] = {
    "source_id": int,
    "nss_solution_type": str,
    "period": float,
    "period_error": float,
    "t_periastron": float,
    "t_periastron_error": float,
    "eccentricity": float,
    "eccentricity_error": float,
    "a_thiele_innes": float,
    "a_thiele_innes_error": float,
    "b_thiele_innes": float,
    "b_thiele_innes_error": float,
    "f_thiele_innes": float,
    "f_thiele_innes_error": float,
    "g_thiele_innes": float,
    "g_thiele_innes_error": float,
    "c_thiele_innes": float,
    "c_thiele_innes_error": float,
    "h_thiele_innes": float,
    "h_thiele_innes_error": float,
    "inclination": float,
    "inclination_error": float,
    "arg_periastron": float,
    "arg_periastron_error": float,
    "mass_ratio": float,
    "mass_ratio_error": float,
    "goodness_of_fit": float,
    "significance": float,
}

# DR3 is frozen — observed 443,205 on 2026-05-18 from the live ESA archive.
# Tight bounds; an out-of-range count means the upstream selection has
# changed (re-pin intentionally).
EXPECTED_ROW_COUNT_MIN = 440_000
EXPECTED_ROW_COUNT_MAX = 446_000

# Self-consistency spot-checks against pinned DR3 NSS rows. DR3 is frozen
# so values can be pinned tightly; tolerances are set to ~1% of the formal
# uncertainty quoted in DR3 (looser than archive-side rounding, tighter
# than any plausible drift the refresh script could itself introduce).
#
# Three rows across three solution types so a DR4 column-rename, unit
# change, or solution-type re-routing surfaces against at least one row
# whose code-path it touched:
#   - Orbital                : pure-astrometric, exercises Thiele-Innes
#   - OrbitalTargetedSearch  : variant routed through a different fit
#   - SB1                    : spectroscopic-only, exercises masked
#                              Thiele-Innes (a/b/f/g = NULL by design)
#
# Replaces the bead's original 70 Oph (HIP 88601) check, which is doubly
# impossible: HIP 88601 saturates Gaia's HIP2 cross-match (V=4.03), and
# 70 Oph's 88-year period is far beyond NSS's max observed period
# (~9,936 d / 27 yr — DR3 NSS only fits orbits with phase coverage that
# beats the 5-parameter astrometric solution's linear-trend absorption).
#
# Pattern matches refresh-hipparcos2.py's Sirius pmRA/pmDE check, but
# extended to multiple rows so single-target drift can't pass silently.
SPOT_CHECKS: list[dict[str, Any]] = [
    {
        "source_id":         6360853029303982592,  # Orbital — Thiele-Innes pinned
        "nss_solution_type": "Orbital",
        "period":            (466.2104, 0.001),
        "eccentricity":      (0.7918, 0.001),
        "a_thiele_innes":    (-4.6393, 0.001),
        "b_thiele_innes":    (-0.0809, 0.001),
        "f_thiele_innes":    (3.5245, 0.001),
        "g_thiele_innes":    (1.1596, 0.001),
        "mass_ratio":        None,                 # masked — null on write
    },
    {
        "source_id":         5823248090239625088,  # OrbitalTargetedSearch (HIP 74946)
        "nss_solution_type": "OrbitalTargetedSearch",
        "period":            (488.4292, 0.001),
        "eccentricity":      (0.1495, 0.001),
        "a_thiele_innes":    (0.1156, 0.001),
        "b_thiele_innes":    (-0.1710, 0.001),
        "f_thiele_innes":    (1.2353, 0.001),
        "g_thiele_innes":    (2.1121, 0.001),
        "mass_ratio":        None,
    },
    {
        "source_id":         4648984790038560256,  # SB1 — Thiele-Innes null
        "nss_solution_type": "SB1",
        "period":            (524.0654, 0.001),
        "eccentricity":      (0.0815, 0.001),
        "a_thiele_innes":    None,
        "b_thiele_innes":    None,
        "f_thiele_innes":    None,
        "g_thiele_innes":    None,
        "mass_ratio":        None,
    },
]


SCRIPT_NAME = "refresh-gaia-nss"


def main() -> None:
    force = "--force" in sys.argv

    if not force and rl.is_up_to_date(OUT, [Path(__file__)]):
        print(f"{OUT.relative_to(ROOT)} up to date — skipping (use --force to rebuild)")
        return

    client = rl.TapClient()
    print("querying ESA Gaia TAP (fallback: CDS) — gaiadr3.nss_two_body_orbit (~443 k rows) …")
    t0 = time.time()
    table = client.run(ADQL)
    elapsed = time.time() - t0

    rl.validate_schema(table, EXPECTED_SCHEMA, label="gaiadr3.nss_two_body_orbit")

    n = len(table)
    print(f"  {n} rows in {elapsed:.1f}s")
    if not (EXPECTED_ROW_COUNT_MIN <= n <= EXPECTED_ROW_COUNT_MAX):
        raise SystemExit(
            f"refresh-gaia-nss: row count {n} outside expected "
            f"[{EXPECTED_ROW_COUNT_MIN}, {EXPECTED_ROW_COUNT_MAX}] — "
            f"upstream schema or selection has changed; investigate before re-pinning."
        )

    rows_by_id = {int(r["source_id"]): r for r in table}
    for spec in SPOT_CHECKS:
        if not rl.check_spot_row(rows_by_id, spec, script_name=SCRIPT_NAME):
            raise SystemExit(
                f"{SCRIPT_NAME}: spot-check source_id {spec['source_id']} "
                f"missing from query result — upstream selection has changed."
            )

    rows = (
        {col: rl.coerce_masked(row[col]) for col in TSV_COLUMNS}
        for row in table
    )
    written = rl.write_tsv(rows, columns=TSV_COLUMNS, output=OUT)
    print(f"wrote {OUT.relative_to(ROOT)} ({written} rows)")


if __name__ == "__main__":
    main()
