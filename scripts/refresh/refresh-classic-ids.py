#!/usr/bin/env python3
"""Refresh the four frozen CDS classic-designation cross indexes under
data/classic-ids/ (HD↔TYC, Bayer/Flamsteed, HR↔HD, GJ↔Gaia). Sources and
join routes: docs/catalog-driver.md § 2."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "util"))

from paths import REPO_ROOT  # noqa: E402
from vizier_slice import VizierSlice, pull_slices  # noqa: E402

OUT_DIR = REPO_ROOT / "data" / "classic-ids"

# TYC1/TYC2/TYC3 stay separate upstream columns; the "1000-1006-1" form the
# Gaia best-neighbour cross-walks key on is composed by the TS parser, so
# this file remains a faithful slice of IV/25.
TYC2_HD = VizierSlice(
    table="IV/25/tyc2_hd",
    output=OUT_DIR / "tyc2_hd.tsv",
    columns={
        "TYC1": "tyc1",
        "TYC2": "tyc2",
        "TYC3": "tyc3",
        "HD": "hd",
        "n_HD": "n_hd",
        "n_TYC": "n_tyc",
    },
    schema={"TYC1": int, "TYC2": int, "TYC3": int, "HD": int, "n_HD": int, "n_TYC": int},
    row_count_min=350_000,
    row_count_max=357_000,
    order_by=("TYC1", "TYC2", "TYC3"),
    spot_key="HD",
    spot_rows=(
        {"HD": 172167, "TYC1": 3105, "TYC2": 2070, "TYC3": 1, "n_HD": 1, "n_TYC": 1},
        {"HD": 48915, "TYC1": 5949, "TYC2": 2777, "TYC3": 1, "n_HD": 1, "n_TYC": 1},
    ),
)

# `Cst` is the constellation the Bayer / Flamsteed designation belongs to —
# NOT the IAU-positional constellation the catalogue assigns per record
# (docs/catalog-driver.md § 5). Bayer letters arrive in IV/27A's own
# lowercase three-letter form ("alf", "kap"), not AT-HYG's ("Alp").
CROSS_INDEX = VizierSlice(
    table="IV/27A/catalog",
    output=OUT_DIR / "cross_index.tsv",
    columns={
        "HD": "hd",
        "HR": "hr",
        "HIP": "hip",
        "Bayer": "bayer",
        "Fl": "flamsteed",
        "Cst": "cst",
    },
    schema={"HD": int, "HR": int, "HIP": int, "Bayer": str, "Fl": int, "Cst": str},
    row_count_min=3_600,
    row_count_max=3_800,
    order_by=("HD",),
    spot_key="HD",
    spot_rows=(
        {"HD": 172167, "HR": 7001, "HIP": 91262, "Bayer": "alf", "Fl": 3, "Cst": "Lyr"},
        {"HD": 48915, "HR": 2491, "HIP": 32349, "Bayer": "alf", "Fl": 9, "Cst": "CMa"},
    ),
)

BSC5 = VizierSlice(
    table="V/50/catalog",
    output=OUT_DIR / "bsc5.tsv",
    columns={"HR": "hr", "HD": "hd", "Name": "name"},
    schema={"HR": int, "HD": int, "Name": str},
    row_count_min=9_000,
    row_count_max=9_200,
    order_by=("HR",),
    spot_key="HR",
    spot_rows=(
        {"HR": 7001, "HD": 172167, "Name": "3Alp Lyr"},
        {"HR": 2491, "HD": 48915, "Name": "9Alp CMa"},
    ),
)

# `GaiaDR3` is an EDR3 source_id, which shares DR3's source_id space, so it
# joins the overlay directly. `Comp` is the component letter within the GJ
# number; the "Gl 559A" / "GJ 1294A" display prefix rule is the
# naming-authority ladder's call, not this file's.
# `RAJ2000` vs `Epoch`: data/classic-ids/README.md § The astrometry re-slice.
CNS5 = VizierSlice(
    table="J/A+A/670/A19/cns5",
    output=OUT_DIR / "cns5.tsv",
    columns={
        "CNS5": "cns5",
        "GJ": "gj",
        "Comp": "gj_comp",
        "GaiaDR3": "gaia_source_id",
        "HIP": "hip",
        "RAJ2000": "ra_deg",
        "DEJ2000": "de_deg",
        "Epoch": "pos_epoch",
        "r_pos": "pos_bibcode",
        "plx": "plx_mas",
        "e_plx": "e_plx_mas",
        "r_plx": "plx_bibcode",
        "pmRA": "pm_ra",
        "e_pmRA": "e_pm_ra",
        "pmDE": "pm_de",
        "e_pmDE": "e_pm_de",
        "r_pmRA": "pm_bibcode",
    },
    schema={
        "CNS5": int, "GJ": str, "Comp": str, "GaiaDR3": int, "HIP": int,
        "RAJ2000": float, "DEJ2000": float, "Epoch": float, "r_pos": str,
        "plx": float, "e_plx": float, "r_plx": str,
        "pmRA": float, "e_pmRA": float, "pmDE": float, "e_pmDE": float,
        "r_pmRA": str,
    },
    row_count_min=5_800,
    row_count_max=6_000,
    order_by=("CNS5",),
    spot_key="CNS5",
    spot_rows=(
        {"CNS5": 3591, "GJ": "551", "Comp": "C",
         "GaiaDR3": 5853498713190525696, "HIP": 70890,
         "RAJ2000": (217.39232147201, 1e-8),
         "DEJ2000": (-62.67607511677, 1e-8),
         "Epoch": (2016.0, 1e-6),
         "plx": (768.07, 0.005), "e_plx": (0.06, 0.005),
         "pmRA": (-3781.74, 0.005), "e_pmRA": (0.031, 0.0005),
         "pmDE": (769.47, 0.005), "e_pmDE": (0.051, 0.0005),
         "r_pos": "2020yCat.1350....0G",
         "r_plx": "2020yCat.1350....0G",
         "r_pmRA": "2020yCat.1350....0G"},
    ),
)

SLICES = (TYC2_HD, CROSS_INDEX, BSC5, CNS5)


def main() -> None:
    pull_slices(
        SLICES,
        script_name="refresh-classic-ids",
        sources=[Path(__file__)],
        argv=sys.argv[1:],
    )


if __name__ == "__main__":
    main()
