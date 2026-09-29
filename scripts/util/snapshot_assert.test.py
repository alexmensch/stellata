#!/usr/bin/env python3
"""Unit tests for snapshot_assert.py: the count diff and the assert/refresh."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.util.snapshot_assert import (  # noqa: E402
    UPDATE_COUNTS_ENV_VAR,
    assert_or_update_counts,
    compare_build_counts,
    format_count_diff,
)

LABEL = "test"


class CompareBuildCountsTests(unittest.TestCase):
    def test_match_when_equal(self) -> None:
        a = {"x": 1, "y": 2}
        diff = compare_build_counts(a, a)
        self.assertTrue(all(d.status == "match" for d in diff))

    def test_mismatch_signed_delta(self) -> None:
        diff = compare_build_counts({"x": 10, "y": 5}, {"x": 12, "y": 5})
        statuses = {d.key: d.status for d in diff}
        self.assertEqual(statuses, {"x": "mismatch", "y": "match"})

    def test_missing_keys_classified(self) -> None:
        diff = compare_build_counts({"a": 1, "b": 2}, {"b": 2, "c": 3})
        statuses = {d.key: d.status for d in diff}
        self.assertEqual(statuses["a"], "missing_actual")
        self.assertEqual(statuses["b"], "match")
        self.assertEqual(statuses["c"], "missing_expected")


class FormatCountDiffTests(unittest.TestCase):
    def test_header_names_the_step(self) -> None:
        out = format_count_diff(compare_build_counts({"x": 1}, {"x": 1}), "build-runtime-binaries")
        self.assertEqual(out, "build-runtime-binaries counts: all 1 counts match")

    def test_lists_a_count_absent_from_either_side(self) -> None:
        out = format_count_diff(compare_build_counts({"a": 1}, {"b": 2}), LABEL)
        self.assertIn("2 of 2 counts differ", out)
        self.assertIn("expected 1, missing in actual", out)
        self.assertIn("new key, got 2 (no snapshot)", out)


class AssertOrUpdateCountsTests(unittest.TestCase):
    def test_writes_initial_snapshot_when_missing(self) -> None:
        import json as _json
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "snapshot.json"
            ok = assert_or_update_counts({"x": 1, "y": 2}, p, LABEL)
            self.assertTrue(ok)
            self.assertTrue(p.exists())
            written = _json.loads(p.read_text())
        self.assertEqual(written, {"x": 1, "y": 2})

    def test_compares_against_existing_snapshot_match(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "snapshot.json"
            p.write_text('{"x": 1, "y": 2}\n')
            ok = assert_or_update_counts({"x": 1, "y": 2}, p, LABEL)
        self.assertTrue(ok)

    def test_compares_against_existing_snapshot_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "snapshot.json"
            p.write_text('{"x": 1, "y": 2}\n')
            ok = assert_or_update_counts({"x": 1, "y": 3}, p, LABEL)
            self.assertFalse(ok)
            # Snapshot file must NOT be silently rewritten on mismatch.
            self.assertEqual(p.read_text(), '{"x": 1, "y": 2}\n')

    def test_env_var_forces_update_on_mismatch(self) -> None:
        import json as _json
        import os as _os
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "snapshot.json"
            p.write_text('{"x": 1}\n')
            try:
                _os.environ[UPDATE_COUNTS_ENV_VAR] = "1"
                ok = assert_or_update_counts({"x": 2}, p, LABEL)
            finally:
                _os.environ.pop(UPDATE_COUNTS_ENV_VAR, None)
            self.assertTrue(ok)
            written = _json.loads(p.read_text())
        self.assertEqual(written, {"x": 2})


if __name__ == "__main__":
    unittest.main()
