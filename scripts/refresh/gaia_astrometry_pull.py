#!/usr/bin/env python3
"""Shared batched Gaia DR3 5-parameter astrometry pull. Two request
scopes drive it: the binaries per-component list and the full-catalog
list. See scripts/refresh/README.md."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import refresh_lib as rl

_MODULE_PATH = Path(__file__).resolve()

TSV_COLUMNS = [
    "source_id",
    "ra",
    "ra_error",
    "dec",
    "dec_error",
    "parallax",
    "parallax_error",
    "pmra",
    "pmra_error",
    "pmdec",
    "pmdec_error",
    "ref_epoch",
    "ruwe",
    "ipd_frac_multi_peak",
    "phot_g_mean_mag",
    "phot_bp_mean_mag",
    "phot_rp_mean_mag",
    "radial_velocity",
    "radial_velocity_error",
]

ADQL_TEMPLATE = (
    "SELECT " + ", ".join(TSV_COLUMNS) + " "
    "FROM gaiadr3.gaia_source "
    "WHERE source_id IN ({inlist})"
)

# Gaia DR3 dtype shape: ``ipd_frac_multi_peak`` is a short (0-100
# percent) integer; everything else is float64 except ``source_id``
# (int64) and the photometry magnitudes (float32). The
# refresh_lib._dtype_matches supertype map handles width variance.
EXPECTED_SCHEMA: dict[str, type | tuple[type, ...]] = {
    "source_id": int,
    "ra": float,
    "ra_error": float,
    "dec": float,
    "dec_error": float,
    "parallax": float,
    "parallax_error": float,
    "pmra": float,
    "pmra_error": float,
    "pmdec": float,
    "pmdec_error": float,
    "ref_epoch": float,
    "ruwe": float,
    "ipd_frac_multi_peak": int,
    "phot_g_mean_mag": float,
    "phot_bp_mean_mag": float,
    "phot_rp_mean_mag": float,
    "radial_velocity": float,
    "radial_velocity_error": float,
}

# 5000 ids per IN-clause — Gaia archive's IN-list cap and the empirical
# bailer-jones / apsis sweet spot.
BATCH_SIZE = 5_000

# Coverage floor — output row count must match input ±5%, i.e. ≥ 95% of
# input ids resolve. The shortfall captures retracted DR3 sources + the
# rare ID-only-in-cross-match-table edge cases.
EXPECTED_COVERAGE_MIN = 0.95

# Astrometric precision retained. Gaia DR3 angular astrometry is sub-mas
# (~1e-3 arcsec); 9 decimals on ra/dec (degrees) preserves the full
# precision Gaia publishes. Errors and PMs use 4 decimals — 0.1 µas on
# parallax/PM is well below the noise floor of any DR3 source. RVS
# radial velocities are good to ~0.1 km/s at best, so 4 decimals (0.1 m/s)
# is likewise below the noise floor.
DEG_DECIMALS = 9
ERR_DECIMALS = 4
RUWE_DECIMALS = 4
MAG_DECIMALS = 6
RV_DECIMALS = 4
REF_EPOCH_DECIMALS = 2

# Per-column rounding rules.
COLUMN_DECIMALS: dict[str, int] = {
    "ra":                  DEG_DECIMALS,
    "dec":                 DEG_DECIMALS,
    "ra_error":            ERR_DECIMALS,
    "dec_error":           ERR_DECIMALS,
    "parallax":            ERR_DECIMALS,
    "parallax_error":      ERR_DECIMALS,
    "pmra":                ERR_DECIMALS,
    "pmra_error":          ERR_DECIMALS,
    "pmdec":               ERR_DECIMALS,
    "pmdec_error":         ERR_DECIMALS,
    "ruwe":                RUWE_DECIMALS,
    "phot_g_mean_mag":     MAG_DECIMALS,
    "phot_bp_mean_mag":    MAG_DECIMALS,
    "phot_rp_mean_mag":    MAG_DECIMALS,
    "radial_velocity":     RV_DECIMALS,
    "radial_velocity_error": RV_DECIMALS,
}

# DR3 reference epoch is J2016.0 for the full catalogue. Pin it so a
# DR4 swap-in (which would change to J2017.5) is caught immediately —
# downstream epoch propagation assumes 2016.0.
EXPECTED_REF_EPOCH = 2016.0
REF_EPOCH_TOL = 0.01


def query_batch(client: rl.TapClient, ids: list[int]):
    inlist = ",".join(str(i) for i in ids)
    return client.run(ADQL_TEMPLATE.format(inlist=inlist))


def write_row(row: Any) -> dict[str, Any]:
    """Build one output dict — coerce_masked every cell, pre-round
    floats per COLUMN_DECIMALS so write_tsv emits stable widths."""
    out: dict[str, Any] = {"source_id": int(row["source_id"])}
    for col in TSV_COLUMNS[1:]:
        v = rl.coerce_masked(row[col])
        if v is None:
            out[col] = None
        elif col in COLUMN_DECIMALS:
            out[col] = f"{float(v):.{COLUMN_DECIMALS[col]}f}"
        else:
            out[col] = v
    return out


def run_pull(
    *,
    request: Path,
    out: Path,
    spot_checks: list[dict[str, Any]],
    script_name: str,
    script_path: Path,
    root: Path,
    force: bool,
    coverage_min: float = EXPECTED_COVERAGE_MIN,
) -> None:
    """Pull 5p astrometry for every source_id in ``request`` and write it
    to ``out`` in request order. Idempotency folds ``script_path`` (the
    caller) and this module's own mtime alongside the request file, so a
    fix here or in either wrapper invalidates a cached output.
    """
    if not force and rl.is_up_to_date(out, [script_path, _MODULE_PATH, request]):
        print(f"{out.relative_to(root)} up to date — skipping (use --force to rebuild)")
        return

    if not request.exists():
        raise SystemExit(
            f"{script_name}: request file {request.relative_to(root)} is missing "
            f"— generate it first (see scripts/refresh/README.md)."
        )

    source_ids = rl.read_source_id_request(request)
    total = len(source_ids)
    if total == 0:
        raise SystemExit(f"{script_name}: no source_ids in {request.relative_to(root)}")
    n_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE
    print(
        f"reading {total} source_ids → {n_batches} batches of "
        f"{BATCH_SIZE} on Gaia TAP (gaiadr3.gaia_source)"
    )

    client = rl.gaia_sync_client(BATCH_SIZE * 2)
    rows_by_id: dict[int, Any] = {}

    def collect(table: Any) -> None:
        for row in table:
            rows_by_id[int(row["source_id"])] = row

    start = time.time()
    rl.run_in_batches(
        source_ids, BATCH_SIZE, lambda b: query_batch(client, b), collect,
        schema=EXPECTED_SCHEMA, schema_label="gaiadr3.gaia_source",
        checkpoint=rl.BatchCheckpoint(out.with_suffix(out.suffix + ".ckpt")),
    )

    matched = len(rows_by_id)
    coverage = matched / total
    # Report the shortfall as a count, not only a percentage: a handful of
    # unreturned ids rounds to 100.0% and reads as complete, while for the
    # catalog scope every unreturned candidate is a binding the gate will accept
    # without weighing (scripts/catalog/astrometry-request/README.md).
    print(
        f"matched {matched}/{total} = {coverage*100:.1f}% "
        f"({total - matched} requested ids returned no row) in "
        f"{(time.time()-start)/60:.1f}m"
    )
    if coverage < coverage_min:
        raise SystemExit(
            f"{script_name}: coverage {coverage:.1%} below floor {coverage_min:.0%} "
            f"— the request emitted source_ids the live gaia_source table no longer "
            f"carries; investigate before re-pinning."
        )

    for spec in spot_checks:
        if not rl.check_spot_row(rows_by_id, spec, script_name=script_name):
            raise SystemExit(
                f"{script_name}: spot-check source_id {spec['source_id']} missing "
                f"from query result — upstream selection has changed."
            )

    # Emit in the request file's order — stable across runs because the
    # request file is itself sorted by source_id. Rows present in the
    # request but missing from gaia_source are dropped silently; the
    # coverage check above gates.
    rows = (write_row(rows_by_id[sid]) for sid in source_ids if sid in rows_by_id)
    written = rl.write_tsv(rows, columns=TSV_COLUMNS, output=out)
    print(f"wrote {out.relative_to(root)} ({written} rows)")
