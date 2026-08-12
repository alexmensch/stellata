#!/usr/bin/env python3
"""Refresh data/gaia/gaia_dr3_astrometry_catalog.tsv — Gaia DR3
5-parameter astrometry for every catalog-resolvable source_id (the
direction cascade). Shared pull machinery in gaia_astrometry_pull.py."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "util"))

import gaia_astrometry_pull as gap  # noqa: E402
from paths import REPO_ROOT  # noqa: E402

ROOT = REPO_ROOT
REQUEST = ROOT / "data" / "gaia" / "gaia_catalog_source_id_request.tsv"
OUT = ROOT / "data" / "gaia" / "gaia_dr3_astrometry_catalog.tsv"

# Self-consistency spot-checks pinned from the live ESA Gaia archive on
# 2026-07-02. Three rows spanning the request file — first row, a
# mid-file row, and Barnard's Star (the highest-proper-motion star,
# PM ≈ (-802, +10362) mas/yr — a strong end-to-end anchor). Sirius A is
# deliberately absent from this file (Gaia has no 5p solution for it —
# the HIP2 tier handles it), so it is not a spot-check target here.
#
# Barnard's Star also pins `radial_velocity`: RVS reaches only ~a third of
# sources, so a column that silently came back all-null would still pass the
# row-count and coverage gates. A row known to carry one is what catches it.
SPOT_CHECKS: list[dict[str, Any]] = [
    {
        "source_id":          7632157690368,       # request file row 1
        "ref_epoch":          (gap.EXPECTED_REF_EPOCH, gap.REF_EPOCH_TOL),
        "parallax":           (5.6023, 0.001),
        "pmra":               (45.4660, 0.001),
        "pmdec":              (-6.8343, 0.001),
        "phot_g_mean_mag":    (8.068802, 0.0001),
    },
    {
        "source_id":          4040814466068502656,  # mid-file row
        "ref_epoch":          (gap.EXPECTED_REF_EPOCH, gap.REF_EPOCH_TOL),
        "parallax":           (3.4911, 0.001),
        "pmra":               (2.6759, 0.001),
        "pmdec":              (-5.6790, 0.001),
        "phot_g_mean_mag":    (8.888946, 0.0001),
    },
    {
        "source_id":          4472832130942575872,  # Barnard's Star
        "ref_epoch":          (gap.EXPECTED_REF_EPOCH, gap.REF_EPOCH_TOL),
        "parallax":           (546.9759, 0.001),
        "pmra":               (-801.5510, 0.001),
        "pmdec":              (10362.3942, 0.001),
        "phot_g_mean_mag":    (8.193974, 0.0001),
        "radial_velocity":    (-110.4682, 0.001),
        "radial_velocity_error": (0.1313, 0.001),
    },
]


def main() -> None:
    gap.run_pull(
        request=REQUEST,
        out=OUT,
        spot_checks=SPOT_CHECKS,
        script_name="refresh-gaia-astrometry-catalog",
        script_path=Path(__file__).resolve(),
        root=ROOT,
        force="--force" in sys.argv,
    )


if __name__ == "__main__":
    main()
