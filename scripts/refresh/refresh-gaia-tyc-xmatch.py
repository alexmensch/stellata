#!/usr/bin/env python3
"""Refresh data/gaia/gaia_dr3_tyc_xmatch.tsv — Tycho-2 / TDSC → Gaia DR3
source_id cross-walk from gaiadr3.tycho2tdsc_merge_best_neighbour."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import refresh_lib as rl  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
OUT = ROOT / "data" / "gaia" / "gaia_dr3_tyc_xmatch.tsv"

ADQL = """
SELECT
  original_ext_source_id AS tyc,
  source_id              AS gaia_source_id,
  angular_distance,
  number_of_neighbours,
  xm_flag
FROM gaiadr3.tycho2tdsc_merge_best_neighbour
WHERE source_id IS NOT NULL
ORDER BY original_ext_source_id
"""

TSV_COLUMNS = [
    "tyc",
    "gaia_source_id",
    "angular_distance",
    "number_of_neighbours",
    "xm_flag",
]

EXPECTED_SCHEMA = {
    "tyc": str,
    "gaia_source_id": int,
    "angular_distance": float,
    "number_of_neighbours": int,
    "xm_flag": int,
}

# Tight bounds around the empirically-observed Gaia DR3 row count (2,518,330).
# DR3 is a frozen release so the count should not change; the small slack
# tolerates a hypothetical archive re-index without false-negatives.
EXPECTED_ROW_COUNT_MIN = 2_510_000
EXPECTED_ROW_COUNT_MAX = 2_530_000

# arcsec precision retained on angular_distance. Matches refresh-gaia-hip-xmatch.py.
ANGULAR_DISTANCE_DECIMALS = 6

SCRIPT_NAME = "refresh-gaia-tyc-xmatch"

# Pinned tyc → gaia_source_id rows. Tycho-2 identifiers are the
# external anchor (stable across Gaia releases), so absence of a
# pinned row is a real signal — hard-fail rather than pin-with-
# tolerance. Spread across the Tycho region-number range so a single
# regional re-indexing surfaces.
SPOT_CHECKS: list[dict[str, Any]] = [
    {
        "tyc":                  "2726-2257-1",
        "gaia_source_id":       1948934357952258304,
        "angular_distance":     (0.160929, 0.001),
        "number_of_neighbours": 1,
        "xm_flag":              8,
    },
    {
        "tyc":                  "4352-1171-1",
        "gaia_source_id":       486100417131058048,
        "angular_distance":     (0.019045, 0.001),
        "number_of_neighbours": 1,
        "xm_flag":              8,
    },
    {
        "tyc":                  "6455-874-1",
        "gaia_source_id":       5083243951169606016,
        "angular_distance":     (0.046136, 0.001),
        "number_of_neighbours": 1,
        "xm_flag":              8,
    },
]


def main() -> None:
    force = "--force" in sys.argv

    if not force and rl.is_up_to_date(OUT, [Path(__file__)]):
        print(f"{OUT.relative_to(ROOT)} up to date — skipping (use --force to rebuild)")
        return

    client = rl.TapClient()
    print("querying ESA Gaia TAP (fallback: CDS) — gaiadr3.tycho2tdsc_merge_best_neighbour …")
    table = client.run(ADQL)

    rl.validate_schema(table, EXPECTED_SCHEMA, label="tycho2tdsc_merge_best_neighbour")

    n = len(table)
    if not (EXPECTED_ROW_COUNT_MIN <= n <= EXPECTED_ROW_COUNT_MAX):
        raise SystemExit(
            f"{SCRIPT_NAME}: row count {n} outside expected "
            f"[{EXPECTED_ROW_COUNT_MIN}, {EXPECTED_ROW_COUNT_MAX}] — "
            f"upstream schema or selection has changed; investigate before re-pinning."
        )

    rows_by_tyc = {str(r["tyc"]): r for r in table}
    for spec in SPOT_CHECKS:
        if not rl.check_spot_row(
            rows_by_tyc, spec, script_name=SCRIPT_NAME, key_field="tyc",
        ):
            raise SystemExit(
                f"{SCRIPT_NAME}: pinned tyc={spec['tyc']} missing from "
                f"xmatch — Gaia DR3 has dropped this row; investigate "
                f"before re-pinning."
            )

    rows = ({col: row[col] for col in TSV_COLUMNS} for row in table)
    written = rl.write_tsv(
        rows,
        columns=TSV_COLUMNS,
        output=OUT,
        round_floats=ANGULAR_DISTANCE_DECIMALS,
    )
    print(f"wrote {OUT.relative_to(ROOT)} ({written} rows)")


if __name__ == "__main__":
    main()
