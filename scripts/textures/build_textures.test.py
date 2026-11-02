#!/usr/bin/env python3
"""Stdlib-unittest pins for build-textures.py: the relief-row merge, the
horizon-plane encoding, and the provenance rows' colour claims. Run directly:
python3 build_textures.test.py (needs NumPy + Pillow)."""

from __future__ import annotations

import importlib.util
import re
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1]))

_spec = importlib.util.spec_from_file_location("build_textures", HERE / "build-textures.py")
assert _spec and _spec.loader
bt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bt)

PROVENANCE = HERE.parents[1] / "data" / "textures" / "src" / "README.md"
HALFWAY_GRAY = re.compile(r"pulled halfway to gray")


class ReliefRowTests(unittest.TestCase):
    def test_each_part_merges_into_the_row_the_others_wrote(self) -> None:
        """The normal map, horizon pair and sky view sit behind separate
        up-to-date gates, so any one runs while the others are skipped; a
        replace there drops the skipped parts' stats from relief.json."""
        relief = {"moon": {"width": 4096, "skyView": {"width": 2048}}}
        bt.merge_relief_row(relief, "moon", {"horizon": {"width": 2048}})
        bt.merge_relief_row(relief, "moon", {"medianTiltDeg": 3.0})
        self.assertEqual(relief["moon"], {
            "width": 4096,
            "medianTiltDeg": 3.0,
            "horizon": {"width": 2048},
            "skyView": {"width": 2048},
        })


class HorizonPlaneTests(unittest.TestCase):
    def test_alpha_zero_keeps_its_rgb(self) -> None:
        """Alpha is the fourth azimuth, not coverage: without libwebp's exact
        mode a 0 there rewrites the other three azimuths' skyline."""
        plane = np.zeros((4, 8, 4), np.uint8)
        plane[..., 0] = 200
        plane[..., 1] = 17
        plane[..., 2] = 99
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "plane.webp"
            bt.save_horizon_plane(plane, path)
            back = np.asarray(Image.open(path).convert("RGBA"))
        np.testing.assert_array_equal(back, plane)


class ProvenanceTests(unittest.TestCase):
    @staticmethod
    def rows() -> dict[str, str]:
        out = {}
        for line in PROVENANCE.read_text().splitlines():
            m = re.match(r"^\| `([^`]+)`", line)
            if m:
                out[m.group(1)] = line
        return out

    def test_every_desaturated_body_says_so_and_no_other_does(self) -> None:
        """The pull-back is invented rather than measured, so the row is the only
        record of it; a retune that leaves the prose behind fails, and so does
        prose claiming a treatment the build does not apply."""
        rows = self.rows()
        claiming = {f for f, row in rows.items() if HALFWAY_GRAY.search(row)}
        self.assertEqual(set(bt.DESATURATE.values()), {0.5})
        self.assertEqual(
            {f.split("-")[0] for f in claiming}, set(bt.DESATURATE)
        )


if __name__ == "__main__":
    unittest.main()
