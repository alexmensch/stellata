#!/usr/bin/env python3
"""Import pin for the manual measure_relief_lighting.py, which no build step
loads. Run directly: python3 measure_relief_lighting.test.py (needs NumPy + Pillow)."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


class ImportTests(unittest.TestCase):
    def test_the_module_loads_and_reads_the_shared_shading_constants(self) -> None:
        spec = importlib.util.spec_from_file_location("measure_relief_lighting", HERE / "measure_relief_lighting.py")
        assert spec and spec.loader
        mrl = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mrl)
        self.assertEqual(set(mrl.ALBEDO), set(mrl.CONSTANTS["surfaceRelief"]["bodies"]))


if __name__ == "__main__":
    unittest.main()
