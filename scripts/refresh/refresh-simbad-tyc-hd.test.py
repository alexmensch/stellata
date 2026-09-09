#!/usr/bin/env python3
"""Unit tests for refresh-simbad-tyc-hd.py: request-set union, the
space-padded ident join, and the compose gates. Run directly — the kebab
filename trips ``python -m unittest``."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import refresh_lib as rl  # noqa: E402
from simbad import query  # noqa: E402
from simbad.specs import HD, MAIN_ID, TYC  # noqa: E402
from test_helpers import FakeTable, fake_tap_client, load_kebab_sibling  # noqa: E402

mod = load_kebab_sibling(__file__, "refresh_simbad_tyc_hd", "refresh-simbad-tyc-hd.py")


def write_tsv(tmp: Path, name: str, header: list[str], rows: list[list[str]]) -> Path:
    path = tmp / name
    lines = ["\t".join(header)] + ["\t".join(r) for r in rows]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


class ReadRequestSet(unittest.TestCase):
    """The union itself is `rl.read_mentioned_tycs`, pinned in
    refresh-tycho2.test.py where it lives. What is this shell's own is
    formatting that set as the sorted `1-381-1` keys the TAP request asks
    under."""

    def test_request_is_the_shared_union_as_sorted_string_keys(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            iv = write_tsv(
                tmp, "tyc2_hd.tsv", ["tyc1", "tyc2", "tyc3", "hd"],
                [["40", "1338", "1", "12447"], ["7570", "1585", "1", "24072"]],
            )
            man = write_tsv(
                tmp, "manifest.tsv", ["tyc", "hd"],
                [["40-1338-1", "12446"], ["9999-1-1", "1"]],
            )
            self.assertEqual(
                mod.read_tyc_request(man, iv),
                ["40-1338-1", "7570-1585-1", "9999-1-1"],
            )
            self.assertEqual(
                {rl.format_tyc(t) for t in rl.read_mentioned_tycs(man, iv)},
                set(mod.read_tyc_request(man, iv)),
            )


class PaddedIdentJoin(unittest.TestCase):
    def test_stored_padding_joins_back_to_the_unpadded_request(self) -> None:
        """SIMBAD right-aligns a TYC's first field, so the id it returns is
        not the string the request asked under. Keying on the raw returned id
        would drop every short-TYC1 row silently."""
        client = fake_tap_client(rl, FakeTable(
            [{"oidref": 6373490, "id": "TYC   40-1338-1"}], ["oidref", "id"],
        ))
        self.assertEqual(
            query.resolve_oids_by_prefix(client, ["40-1338-1"], TYC),
            {"40-1338-1": 6373490},
        )


class ComposeRows(unittest.TestCase):
    def setUp(self) -> None:
        self.basic = {1: {MAIN_ID.alias: "* f Eri A"}}

    def test_resolved_tyc_with_an_hd_ships_one_row(self) -> None:
        rows = mod.compose_rows(
            ["7570-1585-1"], {"7570-1585-1": 1},
            {1: {HD.tsv_name: {"24072"}}}, self.basic,
        )
        self.assertEqual(rows, [{
            "tyc": "7570-1585-1", "simbad_oid": 1,
            "simbad_main_id": "* f Eri A", "hd": "24072",
        }])

    def test_unresolved_tyc_ships_nothing(self) -> None:
        self.assertEqual(mod.compose_rows(["1-1-1"], {}, {}, {}), [])

    def test_resolved_tyc_whose_object_holds_no_hd_ships_nothing(self) -> None:
        """A row asserting no HD would read as an answer; absence from the
        table is the honest statement and needs no row."""
        self.assertEqual(
            mod.compose_rows(["1-1-1"], {"1-1-1": 1}, {1: {HD.tsv_name: set()}}, {}),
            [],
        )
        self.assertEqual(
            mod.compose_rows(["1-1-1"], {"1-1-1": 1}, {}, {}), [],
        )

    def test_several_hd_idents_join_sorted_and_are_not_reduced_to_one(self) -> None:
        """An unresolved pair's entry carries both components' numbers, which
        is the ambiguity a consumer is asking about — picking a winner here
        would destroy it."""
        rows = mod.compose_rows(
            ["1-1-1"], {"1-1-1": 1},
            {1: {HD.tsv_name: {"12448", "12447"}}}, {},
        )
        self.assertEqual(rows[0]["hd"], "12447|12448")

    def test_component_letter_survives_the_suffix_parse(self) -> None:
        rows = mod.compose_rows(
            ["1-1-1"], {"1-1-1": 1}, {1: {HD.tsv_name: {"24071B"}}}, {},
        )
        self.assertEqual(rows[0]["hd"], "24071B")

    def test_missing_main_id_becomes_an_empty_cell(self) -> None:
        rows = mod.compose_rows(
            ["1-1-1"], {"1-1-1": 1}, {1: {HD.tsv_name: {"1"}}}, {},
        )
        self.assertEqual(rows[0]["simbad_main_id"], "")

    def test_output_order_follows_the_request(self) -> None:
        """The request is sorted, so following it makes the committed TSV
        byte-identical across re-runs against an unchanged SIMBAD."""
        rows = mod.compose_rows(
            ["1-1-1", "2-2-2"], {"1-1-1": 1, "2-2-2": 2},
            {1: {HD.tsv_name: {"1"}}, 2: {HD.tsv_name: {"2"}}}, {},
        )
        self.assertEqual([r["tyc"] for r in rows], ["1-1-1", "2-2-2"])


class Gates(unittest.TestCase):
    def test_row_count_band_rejects_a_collapsed_request_set(self) -> None:
        with self.assertRaises(SystemExit):
            rl.assert_row_count(
                12, mod.ROW_COUNT_LOW, mod.ROW_COUNT_HIGH, "simbad_tyc_hd",
            )

    def test_spot_rows_hard_fail_when_a_pinned_tyc_is_absent(self) -> None:
        with self.assertRaises(SystemExit):
            rl.validate_spot_rows(
                {}, mod.SPOT_ROWS,
                script_name="refresh-simbad-tyc-hd", key_field="tyc",
            )

    def test_spot_rows_hard_fail_when_a_pinned_hd_drifts(self) -> None:
        pinned = mod.SPOT_ROWS[0]
        drifted = {pinned["tyc"]: {**pinned, "hd": "999999"}}
        with self.assertRaises(SystemExit):
            rl.validate_spot_rows(
                drifted, [pinned],
                script_name="refresh-simbad-tyc-hd", key_field="tyc",
            )

    def test_every_pinned_tyc_is_in_the_request_set_shape(self) -> None:
        """A pinned row the request never asks for could never be validated,
        so the pins have to look like Tycho ids the readers produce."""
        for spec in mod.SPOT_ROWS:
            self.assertRegex(spec["tyc"], r"^\d+-\d+-\d+$")


if __name__ == "__main__":
    unittest.main(verbosity=2)
