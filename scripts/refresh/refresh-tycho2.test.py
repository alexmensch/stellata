#!/usr/bin/env python3
"""Unit tests for refresh-tycho2.py's request-set derivation, TYC1 range
cover, local filter and coverage gates. Run directly — the kebab filename
trips ``python -m unittest``."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_helpers import load_kebab_sibling  # noqa: E402

t2 = load_kebab_sibling(__file__, "refresh_tycho2", "refresh-tycho2.py")


def _write(dirpath: Path, name: str, header: list[str], rows: list[list[str]]) -> Path:
    path = dirpath / name
    lines = ["\t".join(header)]
    lines += ["\t".join(row) for row in rows]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


class ParseTyc(unittest.TestCase):
    def test_round_trips_a_well_formed_designation(self):
        self.assertEqual(t2.parse_tyc("3694-2544-1"), (3694, 2544, 1))
        self.assertEqual(t2.format_tyc((3694, 2544, 1)), "3694-2544-1")

    def test_strips_surrounding_whitespace(self):
        self.assertEqual(t2.parse_tyc("  55-256-1 "), (55, 256, 1))

    def test_rejects_malformed_and_empty_cells(self):
        for bad in ("", "   ", "3694-2544", "3694-2544-1-2", "TYC 1-2-1",
                    "3694--1", "a-b-c", "3694-2544-x"):
            self.assertIsNone(t2.parse_tyc(bad), bad)


class RequestSet(unittest.TestCase):
    def test_unions_the_spine_column_with_iv25s_own_tycs(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            spine = _write(
                root, "spine.tsv", ["tyc", "hip"],
                [["1-2-1", "10"], ["3-4-1", "11"], ["", "12"]],
            )
            iv25 = _write(
                root, "tyc2_hd.tsv", ["tyc1", "tyc2", "tyc3", "hd"],
                [["3", "4", "1", "999"], ["5", "6", "1", "998"]],
            )
            self.assertEqual(
                t2.read_mentioned_tycs(spine, iv25),
                {(1, 2, 1), (3, 4, 1), (5, 6, 1)},
            )
            self.assertEqual(t2.read_spine_tycs(spine), {(1, 2, 1), (3, 4, 1)})

    def test_a_spine_row_with_no_tyc_contributes_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            spine = _write(root, "spine.tsv", ["tyc"], [[""], ["  "]])
            iv25 = _write(root, "tyc2_hd.tsv", ["tyc1", "tyc2", "tyc3"], [])
            self.assertEqual(t2.read_mentioned_tycs(spine, iv25), set())


class Tyc1Ranges(unittest.TestCase):
    def test_covers_every_region_exactly_once(self):
        seen: list[int] = []
        for lo, hi in t2.tyc1_ranges():
            self.assertLessEqual(lo, hi)
            seen.extend(range(lo, hi + 1))
        self.assertEqual(seen, list(range(t2.TYC1_MIN, t2.TYC1_MAX + 1)))

    def test_the_last_range_clamps_to_the_catalogue_ceiling(self):
        self.assertEqual(t2.tyc1_ranges()[-1][1], t2.TYC1_MAX)

    def test_a_ragged_batch_size_still_covers_the_ceiling(self):
        ranges = t2.tyc1_ranges(per_query=1000)
        self.assertEqual(ranges[0][0], t2.TYC1_MIN)
        self.assertEqual(ranges[-1][1], t2.TYC1_MAX)


class SelectMentioned(unittest.TestCase):
    @staticmethod
    def _row(tyc1: int, tyc2: int, tyc3: int) -> dict[str, int]:
        return {"TYC1": tyc1, "TYC2": tyc2, "TYC3": tyc3}

    def test_keeps_only_rows_whose_full_identifier_was_requested(self):
        table = [self._row(1, 2, 1), self._row(1, 2, 2), self._row(9, 9, 1)]
        kept = list(t2.select_mentioned(table, {(1, 2, 1), (9, 9, 1)}))
        self.assertEqual([tyc for tyc, _ in kept], [(1, 2, 1), (9, 9, 1)])

    def test_a_differing_component_is_a_different_star(self):
        self.assertEqual(
            list(t2.select_mentioned([self._row(1, 2, 2)], {(1, 2, 1)})), []
        )


class Adql(unittest.TestCase):
    def test_the_range_predicate_bounds_the_scan(self):
        adql = t2.MAIN.adql(401, 800)
        self.assertIn('FROM "I/259/tyc2"', adql)
        self.assertIn("WHERE TYC1 BETWEEN 401 AND 800", adql)

    def test_every_projected_column_is_quoted(self):
        for spec in t2.TABLES:
            adql = spec.adql(1, 1)
            for column in spec.column_map:
                self.assertIn(f'"{column}"', adql, f"{spec.vizier_table}/{column}")

    def test_the_schema_gate_covers_every_projected_column(self):
        for spec in t2.TABLES:
            self.assertEqual(
                set(spec.column_map), set(spec.expected_schema), spec.vizier_table
            )


class SpineCoverage(unittest.TestCase):
    def test_full_cover_passes(self):
        t2.assert_spine_covered(
            {(1, 2, 1)}, {(1, 2, 1), (5, 5, 1)}, log=lambda _: None
        )

    def test_an_unreached_spine_tyc_is_a_membership_event_not_a_short_pull(self):
        with self.assertRaises(SystemExit) as caught:
            t2.assert_spine_covered(
                {(1, 2, 1), (3, 4, 1)}, {(1, 2, 1)}, log=lambda _: None
            )
        self.assertIn("3-4-1", str(caught.exception))
        self.assertIn("membership event", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
