#!/usr/bin/env python3
"""Refresh data/hipparcos/hip_main_vmag.tsv — printed Johnson V from the
Hipparcos main catalogue (VizieR I/239/hip_main), the bright/printed tier of
the V-magnitude cascade (docs/catalog-driver.md § 5)."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "util"))

from paths import REPO_ROOT  # noqa: E402
from vizier_slice import VizierSlice, pull_slices  # noqa: E402

HIP_MAIN_VMAG = VizierSlice(
    table="I/239/hip_main",
    output=REPO_ROOT / "data" / "hipparcos" / "hip_main_vmag.tsv",
    columns={"HIP": "hip", "Vmag": "vmag"},
    schema={"HIP": int, "Vmag": float},
    row_count_min=117_000,
    row_count_max=119_000,
    order_by=("HIP",),
    spot_key="HIP",
    spot_rows=(
        {"HIP": 32349, "Vmag": (-1.44, 0.005)},
        {"HIP": 71683, "Vmag": (-0.01, 0.005)},
        {"HIP": 91262, "Vmag": (0.03, 0.005)},
    ),
    round_floats=3,
)


def main() -> None:
    pull_slices(
        [HIP_MAIN_VMAG],
        script_name="refresh-hipparcos-vmag",
        sources=[Path(__file__)],
        argv=sys.argv[1:],
    )


if __name__ == "__main__":
    main()
