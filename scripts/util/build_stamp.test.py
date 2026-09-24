#!/usr/bin/env python3
"""Stdlib-unittest pins for scripts/util/build_stamp.py."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.util.build_stamp import (  # noqa: E402
    changed_since,
    clear_stamp,
    file_hashes,
    imported_script_modules,
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

    def write(self) -> None:
        write_stamp(self.stamp, file_hashes([self.input]), [self.output])

    def current(self, *inputs: Path) -> bool:
        return stamp_is_current(self.stamp, file_hashes(inputs or (self.input,)))

    def test_stale_without_stamp(self) -> None:
        self.assertFalse(self.current())

    def test_current_for_unchanged_inputs_and_outputs(self) -> None:
        self.write()
        self.assertTrue(self.current())

    def test_touched_input_with_same_content_stays_current(self) -> None:
        self.write()
        later = time.time() + 60
        os.utime(self.input, (later, later))
        self.assertTrue(self.current())

    def test_changed_content_is_stale(self) -> None:
        self.write()
        self.input.write_text("a\tc\n")
        self.assertFalse(self.current())

    def test_absent_input_recorded_as_none_and_its_arrival_is_a_change(self) -> None:
        later = self.input.parent / "later.tsv"
        hashes = file_hashes([self.input, later])
        self.assertIn(None, hashes.values())
        write_stamp(self.stamp, hashes, [self.output])
        self.assertTrue(self.current(self.input, later))
        later.write_text("x")
        self.assertFalse(self.current(self.input, later))

    def test_missing_output_is_stale(self) -> None:
        self.write()
        self.output.unlink()
        self.assertFalse(self.current())

    def test_output_rewritten_elsewhere_is_stale(self) -> None:
        self.write()
        self.output.write_text("built by another commit")
        self.assertFalse(self.current())
        self.assertEqual(len(changed_since(read_stamp(self.stamp).outputs)), 1)

    def test_stamp_without_outputs_reads_as_none(self) -> None:
        self.stamp.parent.mkdir(parents=True)
        self.stamp.write_text(json.dumps({"inputs": file_hashes([self.input])}))
        self.assertIsNone(read_stamp(self.stamp))
        self.assertFalse(self.current())

    def test_truncated_stamp_reads_as_none_and_write_leaves_no_temp(self) -> None:
        self.write()
        self.assertFalse(self.stamp.with_name(self.stamp.name + ".tmp").exists())
        self.stamp.write_text('{"inputs": {')
        self.assertIsNone(read_stamp(self.stamp))
        self.assertFalse(self.current())

    def test_refuses_missing_or_no_outputs(self) -> None:
        self.output.unlink()
        with self.assertRaisesRegex(RuntimeError, "outputs missing"):
            self.write()
        with self.assertRaisesRegex(RuntimeError, "none given"):
            write_stamp(self.stamp, file_hashes([self.input]), [])
        self.assertFalse(self.stamp.exists())

    def test_imported_script_modules_is_the_import_graph(self) -> None:
        names = {p.name for p in imported_script_modules()}
        self.assertIn("build_stamp.py", names)
        self.assertIn("paths.py", names)
        self.assertNotIn("build_stamp.test.py", names)
        self.assertNotIn("component_tokens.py", names)

    def test_clear_stamp(self) -> None:
        self.write()
        clear_stamp(self.stamp)
        self.assertIsNone(read_stamp(self.stamp))
        clear_stamp(self.stamp)


if __name__ == "__main__":
    unittest.main()
