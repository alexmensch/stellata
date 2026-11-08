#!/usr/bin/env python3
"""The Gaia DR3 5p astrometry schema and row writer the magnitude pull
projects. See scripts/refresh/README.md."""

from __future__ import annotations

from typing import Any

import refresh_lib as rl

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

SELECT_CLAUSE = "SELECT " + ", ".join(TSV_COLUMNS) + " FROM gaiadr3.gaia_source"

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

