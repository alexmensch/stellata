#!/usr/bin/env python3
"""Unit tests for scripts/refresh/wds_xids_overrides.py — load_overrides
parser semantics + validate_against_components orphan detection.

Run: python3 scripts/refresh/wds_xids_overrides.test.py
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from wds_xids_overrides import (  # noqa: E402
    HEADER_COLUMNS,
    load_overrides,
    validate_against_components,
)


HEADER_LINE = "\t".join(HEADER_COLUMNS) + "\n"


def write_tsv(text: str) -> Path:
    """Write `text` to a tempfile and return its Path."""
    fh = tempfile.NamedTemporaryFile(
        mode="w", suffix=".tsv", delete=False, encoding="utf-8"
    )
    fh.write(text)
    fh.close()
    return Path(fh.name)


class LoadOverridesTests(unittest.TestCase):

    def test_missing_file_returns_empty_dict(self):
        self.assertEqual(
            load_overrides(Path("/tmp/definitely-not-a-real-overrides-file.tsv")),
            {},
        )

    def test_parses_single_row(self):
        path = write_tsv(
            HEADER_LINE + "06451-1643\tB\t930049\tSirius B\n"
        )
        try:
            self.assertEqual(load_overrides(path), {("06451-1643", "B"): 930049})
        finally:
            path.unlink()

    def test_skips_comment_and_blank_lines(self):
        path = write_tsv(
            "# top comment\n"
            "\n"
            "# another comment\n"
            + HEADER_LINE
            + "\n"
            "# inline comment between rows\n"
            "06451-1643\tB\t930049\tSirius B\n"
            "\n"
        )
        try:
            self.assertEqual(load_overrides(path), {("06451-1643", "B"): 930049})
        finally:
            path.unlink()

    def test_multiple_rows(self):
        path = write_tsv(
            HEADER_LINE
            + "06451-1643\tB\t930049\tSirius B\n"
            + "12345+6789\tC\t111\tFake row for test coverage\n"
        )
        try:
            self.assertEqual(
                load_overrides(path),
                {("06451-1643", "B"): 930049, ("12345+6789", "C"): 111},
            )
        finally:
            path.unlink()

    def test_rejects_header_mismatch(self):
        path = write_tsv("wds_id\tcomponent\toid\treason\n")
        try:
            with self.assertRaisesRegex(ValueError, "header mismatch"):
                load_overrides(path)
        finally:
            path.unlink()

    def test_rejects_wrong_field_count(self):
        path = write_tsv(
            HEADER_LINE + "06451-1643\tB\t930049\n"  # missing reason
        )
        try:
            with self.assertRaisesRegex(ValueError, "has 3 fields"):
                load_overrides(path)
        finally:
            path.unlink()

    def test_rejects_non_integer_oid(self):
        path = write_tsv(
            HEADER_LINE + "06451-1643\tB\tnotanint\tbad row\n"
        )
        try:
            with self.assertRaisesRegex(ValueError, "not an integer"):
                load_overrides(path)
        finally:
            path.unlink()

    def test_rejects_duplicate_key(self):
        path = write_tsv(
            HEADER_LINE
            + "06451-1643\tB\t930049\tfirst\n"
            + "06451-1643\tB\t999\tduplicate — should error\n"
        )
        try:
            with self.assertRaisesRegex(ValueError, "duplicate override"):
                load_overrides(path)
        finally:
            path.unlink()


class ValidateAgainstComponentsTests(unittest.TestCase):

    def test_no_orphans_passes(self):
        overrides = {("06451-1643", "B"): 930049}
        components = [("06451-1643", "A"), ("06451-1643", "B")]
        # Returns None (no exception) — silent success.
        self.assertIsNone(validate_against_components(overrides, components))

    def test_empty_overrides_passes(self):
        self.assertIsNone(
            validate_against_components({}, [("06451-1643", "A")])
        )

    def test_orphan_raises_with_listing(self):
        overrides = {("99999+9999", "Z"): 42, ("06451-1643", "B"): 930049}
        components = [("06451-1643", "A"), ("06451-1643", "B")]
        with self.assertRaises(ValueError) as ctx:
            validate_against_components(overrides, components)
        self.assertIn("99999+9999", str(ctx.exception))
        self.assertIn("'Z'", str(ctx.exception))
        # Resolved row should NOT appear in the orphan list.
        self.assertNotIn("06451-1643", str(ctx.exception).replace("99999+9999", ""))


if __name__ == "__main__":
    unittest.main()
