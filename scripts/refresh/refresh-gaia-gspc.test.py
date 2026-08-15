#!/usr/bin/env python3
"""Unit tests for refresh-gaia-gspc.py row formatting and the flag-domain
gate. Run directly — the kebab filename trips ``python -m unittest``.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_helpers import load_kebab_sibling  # noqa: E402

gspc = load_kebab_sibling(__file__, "refresh_gaia_gspc", "refresh-gaia-gspc.py")


def _row(**overrides):
    row = {
        "source_id": 4472832130942575872,
        "b_jkc_mag": 11.249152,
        "b_jkc_flux": 1.2345678901e-16,
        "b_jkc_flux_error": 1.7e-17,
        "b_jkc_flag": 0,
        "v_jkc_mag": 9.555117,
        "v_jkc_flux": 2.0e-16,
        "v_jkc_flux_error": 2.8e-17,
        "v_jkc_flag": 0,
    }
    row.update(overrides)
    return row


class WriteRowTests(unittest.TestCase):
    def test_emits_every_column_in_schema_order(self) -> None:
        out = gspc.write_row(_row())
        self.assertEqual(list(out), gspc.TSV_COLUMNS)

    def test_magnitudes_round_to_mag_decimals(self) -> None:
        out = gspc.write_row(_row(v_jkc_mag=9.5551169))
        self.assertEqual(out["v_jkc_mag"], "9.555117")

    def test_fluxes_carry_float32_width_and_no_more(self) -> None:
        # `.Ne` emits N+1 significant digits, so this is float32's ~7 and the
        # committed column carries no digits the dtype cannot hold.
        out = gspc.write_row(_row())
        self.assertEqual(out["b_jkc_flux"], "1.234568e-16")
        self.assertEqual(len(out["b_jkc_flux"].split("e")[0].replace(".", "")), 7)

    def test_flags_stay_integers_not_formatted_floats(self) -> None:
        out = gspc.write_row(_row(b_jkc_flag=1))
        self.assertEqual(out["b_jkc_flag"], 1)

    def test_absent_band_yields_none_across_its_columns(self) -> None:
        # The per-band-null shape: V present, B absent. A both-bands-or-nothing
        # write would emit "nan" cells here.
        out = gspc.write_row(
            _row(b_jkc_mag=None, b_jkc_flux=None, b_jkc_flux_error=None)
        )
        self.assertIsNone(out["b_jkc_mag"])
        self.assertIsNone(out["b_jkc_flux"])
        self.assertEqual(out["v_jkc_mag"], "9.555117")


class BandPredicateTests(unittest.TestCase):
    def test_both_bands_present_needs_both_magnitudes(self) -> None:
        self.assertTrue(gspc._both_bands_present(_row()))
        self.assertFalse(gspc._both_bands_present(_row(b_jkc_mag=None)))

    def test_validated_range_needs_flag_1_in_both_bands(self) -> None:
        self.assertTrue(gspc._both_flags_valid(_row(b_jkc_flag=1, v_jkc_flag=1)))
        self.assertFalse(gspc._both_flags_valid(_row(b_jkc_flag=1, v_jkc_flag=0)))
        # Polarity is the whole tier's load-bearing assumption: 1 is IN range
        # (Montegriffo+ 2023 § 6.2), so an all-zero row is not validated.
        self.assertFalse(gspc._both_flags_valid(_row()))


class AssertFlagDomainTests(unittest.TestCase):
    def test_accepts_the_published_two_valued_domain(self) -> None:
        gspc.assert_flag_domain([_row(), _row(b_jkc_flag=1, v_jkc_flag=1)])

    def test_accepts_a_null_flag(self) -> None:
        gspc.assert_flag_domain([_row(b_jkc_flag=None)])

    def test_rejects_a_third_value(self) -> None:
        # A widened domain would silently re-partition every downstream
        # validated-range gate rather than failing the pull.
        with self.assertRaises(SystemExit):
            gspc.assert_flag_domain([_row(v_jkc_flag=2)])


if __name__ == "__main__":
    unittest.main()
