#!/usr/bin/env python3
"""Unit tests for refresh-tycho2.py: request-set derivation, TYC1 range
cover, local filter, and the pull/write gates against an in-memory TAP
backend. Run directly — the kebab filename trips ``python -m unittest``."""

from __future__ import annotations

import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import refresh_lib as rl  # noqa: E402
from test_helpers import FakeTable, fake_tap_client, load_kebab_sibling  # noqa: E402

t2 = load_kebab_sibling(__file__, "refresh_tycho2", "refresh-tycho2.py")

MAIN_COLS = list(t2.MAIN.expected_schema)


def _tyc2_row(tyc1: int, tyc2: int, tyc3: int, **over: object) -> dict:
    """One I/259/tyc2 row, keyed on the VizieR column names."""
    row = dict.fromkeys(MAIN_COLS, 0.0)
    row.update(TYC1=tyc1, TYC2=tyc2, TYC3=tyc3, pflag="", prox=999, HIP=0)
    row.update(over)
    return row


def _table(rows: list[dict]) -> FakeTable:
    return FakeTable(rows, MAIN_COLS)


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
    def test_unions_the_manifest_column_with_iv25s_own_tycs(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            manifest = _write(
                root, "manifest.tsv", ["tyc", "hip"],
                [["1-2-1", "10"], ["3-4-1", "11"], ["", "12"]],
            )
            iv25 = _write(
                root, "tyc2_hd.tsv", ["tyc1", "tyc2", "tyc3", "hd"],
                [["3", "4", "1", "999"], ["5", "6", "1", "998"]],
            )
            self.assertEqual(
                t2.read_mentioned_tycs(manifest, iv25),
                {(1, 2, 1), (3, 4, 1), (5, 6, 1)},
            )
            self.assertEqual(t2.read_membership_tycs(manifest), {(1, 2, 1), (3, 4, 1)})

    def test_a_manifest_row_with_no_tyc_contributes_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            manifest = _write(root, "manifest.tsv", ["tyc"], [[""], ["  "]])
            iv25 = _write(root, "tyc2_hd.tsv", ["tyc1", "tyc2", "tyc3"], [])
            self.assertEqual(t2.read_mentioned_tycs(manifest, iv25), set())


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


class RequestScannable(unittest.TestCase):
    def test_a_tyc1_inside_the_scanned_span_passes(self):
        t2.assert_request_scannable({(1, 2, 1), (t2.TYC1_MAX, 5, 1)})

    def test_a_tyc1_past_the_ceiling_is_never_silently_unqueried(self):
        with self.assertRaises(SystemExit) as caught:
            t2.assert_request_scannable({(t2.TYC1_MAX + 1, 5, 1)})
        self.assertIn(f"{t2.TYC1_MAX + 1}-5-1", str(caught.exception))


class PullTable(unittest.TestCase):
    """The gates on one table's pull, against an in-memory TAP backend."""

    WANTED = {(1, 2, 1), (2, 3, 1), (3, 4, 1), (4, 5, 1)}

    def _pull(self, rows: list[dict], wanted: set | None = None, **spec_over):
        spec_over.setdefault("spot_rows", ())
        return t2.pull_table(
            replace(t2.MAIN, **spec_over),
            fake_tap_client(rl, lambda _q: _table(rows)),
            self.WANTED if wanted is None else wanted,
            log=lambda _m: None,
        )

    def test_returns_canonical_rows_not_the_upstream_projection(self):
        kept = self._pull([_tyc2_row(1, 2, 1, RAmdeg=12.5)], wanted={(1, 2, 1)})
        self.assertEqual(set(kept), {(1, 2, 1)})
        self.assertEqual(kept[(1, 2, 1)]["ra_mdeg"], 12.5)
        self.assertNotIn("RAmdeg", kept[(1, 2, 1)])

    def test_a_kept_fraction_below_the_band_fails(self):
        with self.assertRaises(SystemExit) as caught:
            self._pull([_tyc2_row(1, 2, 1)])
        self.assertIn("of the mentioned-TYC request set", str(caught.exception))

    def test_a_full_cover_sits_inside_the_band(self):
        kept = self._pull([_tyc2_row(*t) for t in sorted(self.WANTED)])
        self.assertEqual(len(kept), 4)

    def test_an_absent_pinned_row_fails(self):
        with self.assertRaises(SystemExit) as caught:
            self._pull(
                [_tyc2_row(*t) for t in sorted(self.WANTED)],
                spot_rows=({"tyc": "9-9-1", "ra_mdeg": (12.5, 1e-6)},),
            )
        self.assertIn("request-set or ADQL regression", str(caught.exception))

    def test_a_drifted_pinned_row_fails(self):
        rows = [_tyc2_row(*t) for t in sorted(self.WANTED)]
        rows[0]["RAmdeg"] = 99.0
        with self.assertRaises(SystemExit):
            self._pull(rows, spot_rows=({"tyc": "1-2-1", "ra_mdeg": (12.5, 1e-6)},))

    def test_a_matching_pinned_row_passes(self):
        rows = [_tyc2_row(*t) for t in sorted(self.WANTED)]
        rows[0]["RAmdeg"] = 12.5
        kept = self._pull(rows, spot_rows=({"tyc": "1-2-1", "ra_mdeg": (12.5, 1e-6)},))
        self.assertEqual(len(kept), 4)

    def test_pull_writes_nothing_so_a_later_gate_can_still_veto(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "tycho2_main.tsv"
            self._pull([_tyc2_row(*t) for t in sorted(self.WANTED)], output=out)
            self.assertFalse(out.exists())


class WriteTable(unittest.TestCase):
    def test_writes_canonical_header_and_tyc_sorted_rows(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "out.tsv"
            spec = replace(t2.MAIN, output=out)
            kept = {
                (2, 3, 1): dict.fromkeys(spec.column_map.values(), ""),
                (1, 2, 1): dict.fromkeys(spec.column_map.values(), ""),
            }
            for tyc in kept:
                kept[tyc].update(tyc1=tyc[0], tyc2=tyc[1], tyc3=tyc[2])
            t2.write_table(spec, kept, log=lambda _m: None)
            lines = out.read_text().splitlines()
            self.assertEqual(lines[0].split("\t")[:3], ["tyc1", "tyc2", "tyc3"])
            self.assertEqual([ln.split("\t")[:3] for ln in lines[1:]],
                             [["1", "2", "1"], ["2", "3", "1"]])


class SpineCoverage(unittest.TestCase):
    def test_full_cover_passes(self):
        t2.assert_membership_covered(
            {(1, 2, 1)}, {(1, 2, 1), (5, 5, 1)}, log=lambda _: None
        )

    def test_an_unreached_manifest_tyc_is_a_membership_event_not_a_short_pull(self):
        with self.assertRaises(SystemExit) as caught:
            t2.assert_membership_covered(
                {(1, 2, 1), (3, 4, 1)}, {(1, 2, 1)}, log=lambda _: None
            )
        self.assertIn("3-4-1", str(caught.exception))
        self.assertIn("membership event", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
