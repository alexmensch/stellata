#!/usr/bin/env python3
"""Unit tests for gaia_astrometry_pull (no network). Run via
`python3 scripts/refresh/gaia_astrometry_pull.test.py`."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import gaia_astrometry_pull as gap  # noqa: E402


class WriteRowTests(unittest.TestCase):
    def _row(self, **over):
        base = {c: 1.0 for c in gap.TSV_COLUMNS}
        base["source_id"] = 4472832130942575872
        base["ipd_frac_multi_peak"] = 3
        base.update(over)
        return base

    def test_source_id_stays_full_int(self) -> None:
        out = gap.write_row(self._row())
        self.assertEqual(out["source_id"], 4472832130942575872)

    def test_rounds_per_column_decimals(self) -> None:
        out = gap.write_row(self._row(ra=12.3456789012, pmra=-801.55103))
        self.assertEqual(out["ra"], f"{12.3456789012:.{gap.DEG_DECIMALS}f}")
        self.assertEqual(out["pmra"], f"{-801.55103:.{gap.ERR_DECIMALS}f}")

    def test_non_rounded_column_passthrough(self) -> None:
        out = gap.write_row(self._row(ipd_frac_multi_peak=7))
        self.assertEqual(out["ipd_frac_multi_peak"], 7)

    def test_masked_cell_becomes_none(self) -> None:
        import numpy as np

        out = gap.write_row(self._row(parallax=np.ma.masked))
        self.assertIsNone(out["parallax"])


if __name__ == "__main__":
    unittest.main()
