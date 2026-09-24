#!/usr/bin/env python3
"""Stdlib-unittest pins for scripts/util/build_stamp.py."""

from __future__ import annotations

import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.util.build_stamp import (  # noqa: E402
    clear_stamp,
    input_hashes,
    read_stamp,
    stamp_is_current,
    write_stamp,
)


class BuildStampTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        d = Path(self._tmp.name)
        self.input = d / "input.tsv"
        self.output = d / "output.bin"
        self.stamp = d / "stamps" / "step.json"
        self.input.write_text("a\tb\n")
        self.output.write_text("built")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def current(self, *inputs: Path) -> bool:
        return stamp_is_current(self.stamp, input_hashes(inputs or (self.input,)), [self.output])

    def test_stale_without_stamp(self) -> None:
        self.assertFalse(self.current())

    def test_current_for_unchanged_inputs(self) -> None:
        write_stamp(self.stamp, input_hashes([self.input]))
        self.assertTrue(self.current())

    def test_touched_input_with_same_content_stays_current(self) -> None:
        write_stamp(self.stamp, input_hashes([self.input]))
        later = time.time() + 60
        os.utime(self.input, (later, later))
        self.assertTrue(self.current())

    def test_changed_content_is_stale(self) -> None:
        write_stamp(self.stamp, input_hashes([self.input]))
        self.input.write_text("a\tc\n")
        self.assertFalse(self.current())

    def test_absent_input_recorded_as_none_and_its_arrival_is_a_change(self) -> None:
        later = self.input.parent / "later.tsv"
        hashes = input_hashes([self.input, later])
        self.assertIn(None, hashes.values())
        write_stamp(self.stamp, hashes)
        self.assertTrue(self.current(self.input, later))
        later.write_text("x")
        self.assertFalse(self.current(self.input, later))

    def test_missing_output_is_stale(self) -> None:
        write_stamp(self.stamp, input_hashes([self.input]))
        self.output.unlink()
        self.assertFalse(self.current())

    def test_clear_stamp(self) -> None:
        write_stamp(self.stamp, input_hashes([self.input]))
        clear_stamp(self.stamp)
        self.assertIsNone(read_stamp(self.stamp))
        clear_stamp(self.stamp)


if __name__ == "__main__":
    unittest.main()
