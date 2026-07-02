#!/usr/bin/env python3
"""Refresh data/gaia/gaia_dr3_astrometry.tsv — Gaia DR3 5-parameter
astrometry for the source_ids in the build-binaries Stage 2 request
file. Shared pull machinery in gaia_astrometry_pull.py."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "util"))

import gaia_astrometry_pull as gap  # noqa: E402
from paths import REPO_ROOT  # noqa: E402

ROOT = REPO_ROOT
REQUEST = ROOT / "data" / "gaia" / "gaia_astrometry_source_id_request.tsv"
OUT = ROOT / "data" / "gaia" / "gaia_dr3_astrometry.tsv"

# Self-consistency spot-checks against pinned DR3 ``gaia_source`` rows.
# DR3 is frozen so values can be pinned tightly. Three rows spanning the
# binaries request file — first row (largest at-bat for ingest-side
# row-1 bugs), the row at batch boundary 5000, and the first HIP-anchored
# row — so a DR4 column rename, unit change, or epoch swap surfaces
# against at least one row whose code-path it touched.
SPOT_CHECKS: list[dict[str, Any]] = [
    {
        "source_id":          594595272471808,    # request file row 1
        "ref_epoch":          (gap.EXPECTED_REF_EPOCH, gap.REF_EPOCH_TOL),
        "parallax":           (11.0297, 0.001),
        "pmra":               (49.4157, 0.001),
        "pmdec":              (-45.9419, 0.001),
        "phot_g_mean_mag":    (11.953011, 0.0001),
    },
    {
        "source_id":          3723554268436602240,  # request file row 5000
        "ref_epoch":          (gap.EXPECTED_REF_EPOCH, gap.REF_EPOCH_TOL),
        "parallax":           (3.0991, 0.001),
        "pmra":               (-189.5386, 0.001),
        "pmdec":              (-70.4150, 0.001),
        "phot_g_mean_mag":    (5.874960, 0.0001),
    },
    {
        "source_id":          4923860051276772608,  # HIP 65 (first HIP)
        "ref_epoch":          (gap.EXPECTED_REF_EPOCH, gap.REF_EPOCH_TOL),
        "parallax":           (16.1641, 0.001),
        "pmra":               (-202.7111, 0.001),
        "pmdec":              (-71.6125, 0.001),
        "phot_g_mean_mag":    (10.588468, 0.0001),
    },
]


def main() -> None:
    gap.run_pull(
        request=REQUEST,
        out=OUT,
        spot_checks=SPOT_CHECKS,
        script_name="refresh-gaia-astrometry",
        script_path=Path(__file__).resolve(),
        root=ROOT,
        force="--force" in sys.argv,
    )


if __name__ == "__main__":
    main()
