#!/usr/bin/env python3
"""Refresh data/gliese/gliese_v70a.tsv — the printed value columns of the
Gliese & Jahreiss third catalogue of nearby stars. Cascade placement:
docs/catalog-driver.md § 5."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "util"))

from paths import REPO_ROOT  # noqa: E402
from vizier_slice import VizierSlice, pull_slices  # noqa: E402

OUT_DIR = REPO_ROOT / "data" / "gliese"

# `Name` is NOT unique: a resolved system carries one row per component, so
# the join key is Name + Comp (Gl 559 A and Gl 559 B are two rows, Gl 165 AB
# is one row covering both). data/gliese/README.md § The join key.
GLIESE = VizierSlice(
    table="V/70A/catalog",
    output=OUT_DIR / "gliese_v70a.tsv",
    columns={
        "Name": "name",
        "Comp": "comp",
        "Vmag": "vmag",
        "n_Vmag": "n_vmag",
        "r_Vmag": "r_vmag",
        "B-V": "bv",
        "n_B-V": "n_bv",
        "r_B-V": "r_bv",
        "Sp": "sp",
        "r_Sp": "r_sp",
        "plx": "plx_mas",
        "e_plx": "e_plx_mas",
        "n_plx": "n_plx",
        "trplx": "trplx_mas",
        "RV": "rv",
        "n_RV": "n_rv",
        "HD": "hd",
    },
    schema={
        "Name": str, "Comp": str,
        "Vmag": float, "n_Vmag": str, "r_Vmag": str,
        "B-V": float, "n_B-V": str, "r_B-V": str,
        "Sp": str, "r_Sp": str,
        "plx": float, "e_plx": float, "n_plx": str, "trplx": float,
        "RV": float, "n_RV": str,
        "HD": int,
    },
    row_count_min=3_700,
    row_count_max=3_900,
    order_by=("Name", "Comp"),
    spot_key="Name",
    spot_rows=(
        # Barnard's Star — the corpus's canonical high-PM row.
        {"Name": "Gl 699", "Comp": "", "Vmag": (9.55, 0.005),
         "B-V": (1.74, 0.005), "Sp": "M5 V"},
        # One of the sixteen rows this ingest exists for: no TYC, no HIP, no
        # Gaia photometry, and SIMBAD holds no V flux for it at all.
        {"Name": "NN 3417", "Comp": "", "Vmag": (13.65, 0.005), "Sp": "m"},
    ),
)

SLICES = (GLIESE,)


def main() -> None:
    pull_slices(
        SLICES,
        script_name="refresh-gliese",
        sources=[Path(__file__)],
        argv=sys.argv[1:],
    )


if __name__ == "__main__":
    main()
