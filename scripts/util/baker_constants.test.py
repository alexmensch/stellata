#!/usr/bin/env python3
"""Stdlib-unittest pins for baker_constants.merge_shared. Run directly:
python3 baker_constants.test.py."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.util.baker_constants import merge_shared  # noqa: E402


class MergeSharedTests(unittest.TestCase):
    def test_adds_each_rows_shared_facts(self) -> None:
        merged = merge_shared({"moon": {"src": "a"}}, {"moon": {"r": 2}}, lambda s: {"radius": s["r"]})
        self.assertEqual(merged, {"moon": {"src": "a", "radius": 2}})

    def test_refuses_a_source_row_with_no_shared_entry(self) -> None:
        with self.assertRaises(AssertionError):
            merge_shared({"moon": {}, "mars": {}}, {"moon": {}}, lambda s: {})

    def test_refuses_a_shared_entry_with_no_source_row(self) -> None:
        with self.assertRaises(AssertionError):
            merge_shared({"moon": {}}, {"moon": {}, "mars": {}}, lambda s: {})


if __name__ == "__main__":
    unittest.main()
