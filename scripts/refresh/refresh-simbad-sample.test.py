#!/usr/bin/env python3
"""Unit tests for refresh-simbad-sample.py row formatting.
Run directly — the kebab filename trips ``python -m unittest``.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_helpers import load_kebab_sibling  # noqa: E402

rss = load_kebab_sibling(__file__, "refresh_simbad_sample", "refresh-simbad-sample.py")


def _row(**overrides):
    row = {
        "oid": 12345,
        "main_id": "HD 1",
        "ra": 1.0,
        "dec": 2.0,
        "plx_value": 100.0,
        "plx_err": 0.1,
        "pmra": 0.0,
        "pmdec": 0.0,
        "v_mag": 5.0,
        "sp_type": "G2V",
        "otype": "*",
    }
    row.update(overrides)
    return row


class BuildOutputRowTests(unittest.TestCase):

    def test_normal_row_derives_distance_and_absmag(self):
        out = rss.build_output_row(_row(), {"hip": 1, "gaia": 42})
        self.assertEqual(out["distance_pc"], "10.000")
        self.assertEqual(out["absmag"], "5.000")
        self.assertEqual(out["hip"], 1)

    def test_null_v_mag_raises_naming_the_oid(self):
        with self.assertRaises(ValueError) as ctx:
            rss.build_output_row(_row(v_mag=None), None)
        self.assertIn("12345", str(ctx.exception))
        self.assertIn("v_mag", str(ctx.exception))

    def test_nonpositive_parallax_leaves_distance_blank(self):
        out = rss.build_output_row(_row(plx_value=-0.5), None)
        self.assertEqual(out["distance_pc"], "")
        self.assertEqual(out["absmag"], "")


if __name__ == "__main__":
    unittest.main()
