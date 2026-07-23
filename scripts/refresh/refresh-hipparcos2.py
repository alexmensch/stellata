#!/usr/bin/env python3
"""Refresh data/hipparcos/hip2_van_leeuwen.tsv — Hipparcos-2
(van Leeuwen 2007, VizieR I/311/hip2) astrometric reduction at J1991.25."""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "util"))

import refresh_lib as rl  # noqa: E402
from paths import REPO_ROOT  # noqa: E402

ROOT = REPO_ROOT
OUT = ROOT / "data" / "hipparcos" / "hip2_van_leeuwen.tsv"

# Bounds around HIP2's published row count (117,955). Slack accommodates
# the small drift Vizier mirrors occasionally show without false-negatives.
EXPECTED_ROW_COUNT_MIN = 117_000
EXPECTED_ROW_COUNT_MAX = 118_500

# VizieR-on-the-wire → Stellata-canonical TSV column mapping. The keys are
# the case-sensitive column names exposed by I/311/hip2 on VizieR TAP;
# the values are the lowercase names downstream consumers will read.
# Note: `RArad`/`DErad` despite the suffix store values in DEGREES, not
# radians (verified by live probe against Sirius A and Polaris).
VIZIER_TO_CANONICAL = {
    "HIP":    "hip",
    "RArad":  "ra_icrs",
    "DErad":  "de_icrs",
    "Plx":    "plx",
    "e_Plx":  "e_plx",
    "pmRA":   "pm_ra",
    "pmDE":   "pm_de",
    "e_pmRA": "e_pm_ra",
    "e_pmDE": "e_pm_de",
    "F2":     "goodness_of_fit",
    "Ntr":    "n_transits",
}

TSV_COLUMNS = list(VIZIER_TO_CANONICAL.values())

EXPECTED_SCHEMA: dict[str, type | tuple[type, ...]] = {
    "HIP":    int,
    "RArad":  float,
    "DErad":  float,
    "Plx":    float,
    "e_Plx":  float,
    "pmRA":   float,
    "pmDE":   float,
    "e_pmRA": float,
    "e_pmDE": float,
    "F2":     float,
    "Ntr":    int,
}

ADQL = (
    'SELECT "HIP", "RArad", "DErad", '
    '"Plx", "e_Plx", '
    '"pmRA", "pmDE", "e_pmRA", "e_pmDE", '
    '"F2", "Ntr" '
    'FROM "I/311/hip2" '
    'ORDER BY "HIP"'
)

# Sirius A (HIP 32349) reference PM from the live VizieR mirror — the
# script asserts the spot-check survives the refresh so a future schema or
# data drift surfaces immediately. Tolerance covers the ~0.05 mas/yr
# variation seen between Vizier mirrors and the paper's nominal values.
SPOT_HIP = 32349
SPOT_PM_RA = -546.01
SPOT_PM_DE = -1223.07
SPOT_TOL = 0.1


def main() -> None:
    force = "--force" in sys.argv

    if not force and rl.is_up_to_date(OUT, [Path(__file__)]):
        print(f"{OUT.relative_to(ROOT)} up to date — skipping (use --force to rebuild)")
        return

    client = rl.TapClient(backends=[rl.cds_backend()])
    print('querying CDS TAP — "I/311/hip2" (whole catalogue, ~118 k rows) …')
    t0 = time.time()
    table = client.run(ADQL)
    elapsed = time.time() - t0

    rl.validate_schema(table, EXPECTED_SCHEMA, label="hipparcos-2 I/311/hip2")

    n = len(table)
    print(f"  {n} rows in {elapsed:.1f}s")
    rl.assert_row_count(
        n, EXPECTED_ROW_COUNT_MIN, EXPECTED_ROW_COUNT_MAX, "refresh-hipparcos2"
    )

    sirius = [r for r in table if int(r["HIP"]) == SPOT_HIP]
    if not sirius:
        raise SystemExit(
            f"refresh-hipparcos2: spot-check HIP {SPOT_HIP} (Sirius A) missing "
            f"from query result — upstream filter or selection has changed."
        )
    s = sirius[0]
    if abs(float(s["pmRA"]) - SPOT_PM_RA) > SPOT_TOL or abs(float(s["pmDE"]) - SPOT_PM_DE) > SPOT_TOL:
        raise SystemExit(
            f"refresh-hipparcos2: spot-check HIP {SPOT_HIP} (Sirius A) PM drift — "
            f"got pmRA={float(s['pmRA'])}, pmDE={float(s['pmDE'])}; "
            f"expected ~{SPOT_PM_RA} / {SPOT_PM_DE} (±{SPOT_TOL} mas/yr)."
        )

    rows = (
        {canonical: row[vizier] for vizier, canonical in VIZIER_TO_CANONICAL.items()}
        for row in table
    )
    written = rl.write_tsv(rows, columns=TSV_COLUMNS, output=OUT)
    print(f"wrote {OUT.relative_to(ROOT)} ({written} rows)")


if __name__ == "__main__":
    main()
