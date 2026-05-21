#!/usr/bin/env python3
"""Refresh data/gaia/gaia_dr3_tyc_xmatch.tsv — Tycho-2 → Gaia DR3 source_id cross-walk.

Phase 1 of the source-ID-anchored catalogue-pipeline rewrite (stellata-dch).
Companion to scripts/refresh/refresh-gaia-hip-xmatch.py: HIP covers V ≲ 9 and
Tycho-2 (with TDSC merged in) extends down to V ~ 11.5, so this TSV is
how the Stage 1 indexer resolves any Tycho-2 / TDSC component to a Gaia
DR3 source_id without a position match.

ADQL
    SELECT
      original_ext_source_id AS tyc,
      source_id              AS gaia_source_id,
      angular_distance,
      number_of_neighbours,
      xm_flag
    FROM gaiadr3.tycho2tdsc_merge_best_neighbour
    WHERE source_id IS NOT NULL
    ORDER BY original_ext_source_id

`gaiadr3.tycho2tdsc_merge_best_neighbour` is the official Gaia DR3 ×
(Tycho-2 + TDSC) cross-match — ~2.52M rows, all with a non-null
source_id. The merged source catalogue rolls TDSC double-star
components into Tycho-2 identifiers; rows are keyed by the bare
`NNNN-NNNN-N` form (no "TYC " prefix).

TSV columns (5)
    tyc                  str   — Tycho-2 / TDSC identifier ("NNNN-NNNN-N")
    gaia_source_id       int   — Gaia DR3 source_id
    angular_distance     float — match separation, arcsec (6 decimals)
    number_of_neighbours int   — ambiguity flag (1 = unique Gaia neighbour)
    xm_flag              int   — Gaia cross-match flag (see DR3 docs)

Identical 5-column shape to refresh-gaia-hip-xmatch.py so Stage 1 can
ingest both with one parser.

Runtime: ~1-3 min (single ESA Gaia TAP query, ~2.5M rows).

Idempotent — exits early if the output is newer than this script. Pass
`--force` to rebuild unconditionally. Backend fallback (ESA → CDS) is
provided by refresh_lib.TapClient.

Venv setup (see scripts/requirements-refresh.txt):
    python3 -m venv .venv
    .venv/bin/pip install -r scripts/requirements-refresh.txt
    .venv/bin/python scripts/refresh/refresh-gaia-tyc-xmatch.py
"""

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
