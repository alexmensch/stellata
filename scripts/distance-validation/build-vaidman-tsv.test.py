#!/usr/bin/env python3
"""Unit tests for build-vaidman-tsv.py — PDF parsing and source-id join."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_helpers import load_kebab_sibling  # noqa: E402

bv = load_kebab_sibling(__file__, "build_vaidman_tsv", "build-vaidman-tsv.py")


class ParseAppendixRowTests(unittest.TestCase):
    def test_two_token_name(self) -> None:
        line = (
            "    1     HD 1070   2516.03    97.81    0.92    7.83    "
            "2641.01   174.85    15.32   2012.80"
        )
        row = bv.parse_appendix_row(line, bv.ADOPTED_EDSD_NEW)
        self.assertIsNotNone(row)
        assert row is not None  # narrowing for type-checker
        self.assertEqual(row["name"], "HD 1070")
        self.assertAlmostEqual(row["d_bj_paper_pc"], 2516.03)
        self.assertAlmostEqual(row["sigma_d_bj_paper_pc"], 97.81)
        self.assertAlmostEqual(row["ruwe"], 0.92)
        self.assertAlmostEqual(row["g_mag"], 7.83)
        self.assertAlmostEqual(row["d_new_pc"], 2641.01)
        self.assertAlmostEqual(row["sigma_d_new_pc"], 174.85)
        self.assertAlmostEqual(row["snr_tot"], 15.32)
        self.assertAlmostEqual(row["prior_scale_pc"], 2012.80)
        self.assertEqual(row["adopted"], bv.ADOPTED_EDSD_NEW)

    def test_three_token_name_with_greek_and_digit(self) -> None:
        # 'θ 2 Tau' is the only 3-token name in the appendix; it must
        # absorb both middle tokens into `name` and still extract the
        # trailing 8 numerics.
        line = "11 θ 2 Tau 45.84 0.89 4.61 3.38 46.80 3.55 13.61 300.00"
        row = bv.parse_appendix_row(line, bv.ADOPTED_BJ_OLD)
        self.assertIsNotNone(row)
        assert row is not None
        self.assertEqual(row["name"], "θ 2 Tau")
        self.assertAlmostEqual(row["d_new_pc"], 46.80)
        self.assertEqual(row["adopted"], bv.ADOPTED_BJ_OLD)

    def test_single_token_unicode_constellation(self) -> None:
        # 'ϵ CMa' is two tokens (greek + constellation); parses cleanly.
        line = "119 ϵ CMa 131.01 0.35 0.96 8.38 131.05 0.46 283.79 300.00"
        row = bv.parse_appendix_row(line, bv.ADOPTED_EDSD_NEW)
        self.assertIsNotNone(row)
        assert row is not None
        self.assertEqual(row["name"], "ϵ CMa")
        self.assertAlmostEqual(row["g_mag"], 8.38)

    def test_returns_none_for_header_row(self) -> None:
        line = "N Name dBJ σd,BJ RUWE G dnew σd SNRtot L"
        self.assertIsNone(bv.parse_appendix_row(line, bv.ADOPTED_EDSD_NEW))

    def test_returns_none_for_too_few_tokens(self) -> None:
        line = "1 HD 1070 2516.03"
        self.assertIsNone(bv.parse_appendix_row(line, bv.ADOPTED_EDSD_NEW))

    def test_returns_none_for_non_numeric_trailing_cols(self) -> None:
        line = "1 HD 1070 2516.03 97.81 0.92 7.83 not_a_number 174.85 15.32 2012.80"
        self.assertIsNone(bv.parse_appendix_row(line, bv.ADOPTED_EDSD_NEW))

    def test_returns_none_for_non_integer_leading_token(self) -> None:
        # Section titles like 'Table A1. Cont.' start with 'Table' — must
        # fall through, not match.
        line = "Table A1. Cont."
        self.assertIsNone(bv.parse_appendix_row(line, bv.ADOPTED_EDSD_NEW))


class ExtractTablesTests(unittest.TestCase):
    """End-to-end parse over a stitched-together fixture that mimics the
    pdftotext output: A1 header, one row, A2 header, one row, References.
    """

    FIXTURE = (
        "Appendix A\n"
        "Table A1. Distances and Gaia parameters for Galactic BA supergiants.\n"
        "  N    Name      dBJ    σd,BJ   RUWE   G    dnew    σd     SNRtot   L\n"
        "  1    HD 1070   2516.03 97.81  0.92   7.83 2641.01 174.85 15.32   2012.80\n"
        "Table A1. Cont.\n"
        "  N    Name      dBJ    σd,BJ   RUWE   G    dnew    σd     SNRtot   L\n"
        "  2    BD+60 51  3638.11 126.18 0.83   9.01 3909.82 385.57 10.46   2500.00\n"
        "Table A2. Full machine-readable output of the Gaia distance pipeline.\n"
        "  N Name        dBJ    σd,BJ   RUWE  G     dnew    σd      SNRtot  L\n"
        "  1 φ Cas       4171.53 1012.79 0.92 4.74  5723.41 2433.01 2.63    2500.00\n"
        "References\n"
        "1. some paper\n"
    )

    def test_splits_a1_and_a2_with_correct_adopted_tag(self) -> None:
        a1, a2 = bv.extract_tables(self.FIXTURE)
        self.assertEqual([r["name"] for r in a1], ["HD 1070", "BD+60 51"])
        self.assertEqual([r["name"] for r in a2], ["φ Cas"])
        for r in a1:
            self.assertEqual(r["adopted"], bv.ADOPTED_EDSD_NEW)
        for r in a2:
            self.assertEqual(r["adopted"], bv.ADOPTED_BJ_OLD)

    def test_references_section_terminates_a2(self) -> None:
        # Add a stray numeric-looking line AFTER References to confirm
        # we don't keep parsing past the terminator.
        fixture = self.FIXTURE + "  999 STRAY 1.0 2.0 3.0 4.0 5.0 6.0 7.0 8.0\n"
        _, a2 = bv.extract_tables(fixture)
        self.assertEqual([r["name"] for r in a2], ["φ Cas"])


class AttachGaiaSourceIdsTests(unittest.TestCase):
    def test_populates_known_names(self) -> None:
        rows = [{"name": "HD 1070"}, {"name": "BD+60 51"}]
        mapping = {"HD 1070": 1, "BD+60 51": 2}
        missing = bv.attach_gaia_source_ids(rows, mapping)
        self.assertEqual(missing, [])
        self.assertEqual([r["gaia_source_id"] for r in rows], [1, 2])

    def test_reports_missing_names(self) -> None:
        rows = [{"name": "HD 1070"}, {"name": "UNKNOWN"}]
        mapping = {"HD 1070": 1}
        missing = bv.attach_gaia_source_ids(rows, mapping)
        self.assertEqual(missing, ["UNKNOWN"])
        self.assertEqual(rows[0]["gaia_source_id"], 1)
        self.assertIsNone(rows[1]["gaia_source_id"])

    def test_pinned_mapping_size(self) -> None:
        # Drift guard: any future addition to NAME_TO_GAIA_DR3 must come
        # with a matching paper-row count change in the expected-rows
        # constants. The 132 figure is the sum of EXPECTED_A1_ROWS (119)
        # and EXPECTED_A2_ROWS (13).
        self.assertEqual(
            len(bv.NAME_TO_GAIA_DR3),
            bv.EXPECTED_A1_ROWS + bv.EXPECTED_A2_ROWS,
        )


if __name__ == "__main__":
    unittest.main()
