#!/usr/bin/env python3
"""Unit tests for validate-distances.py — pure helpers and report build."""

from __future__ import annotations

import math
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_helpers import load_kebab_sibling  # noqa: E402

vd = load_kebab_sibling(__file__, "validate_distances", "validate-distances.py")


class FractionalDiffTests(unittest.TestCase):
    def test_signed_relative_to_paper(self) -> None:
        self.assertAlmostEqual(vd.fractional_diff(110.0, 100.0), 0.10)
        self.assertAlmostEqual(vd.fractional_diff(90.0, 100.0), -0.10)
        self.assertAlmostEqual(vd.fractional_diff(100.0, 100.0), 0.0)

    def test_nan_on_nonpositive_paper(self) -> None:
        self.assertTrue(math.isnan(vd.fractional_diff(100.0, 0.0)))
        self.assertTrue(math.isnan(vd.fractional_diff(100.0, -5.0)))


class AggregateStatsTests(unittest.TestCase):
    def test_known_percentiles(self) -> None:
        # |diffs| = [0.01, 0.04, 0.05, 0.10, 0.20]
        stats = vd.aggregate_stats([0.01, -0.04, 0.05, -0.10, 0.20])
        self.assertEqual(stats["count"], 5)
        self.assertAlmostEqual(stats["median"], 0.05)
        self.assertAlmostEqual(stats["max"], 0.20)
        # 84th-pct of a 5-element sorted list at linear-interp:
        # rank = 0.84 * 4 = 3.36 → 0.10 + 0.36 * (0.20 - 0.10) = 0.136
        self.assertAlmostEqual(stats["p84"], 0.136)

    def test_empty_returns_nans(self) -> None:
        stats = vd.aggregate_stats([])
        self.assertEqual(stats["count"], 0)
        self.assertTrue(math.isnan(stats["median"]))
        self.assertTrue(math.isnan(stats["p84"]))
        self.assertTrue(math.isnan(stats["max"]))

    def test_single_value(self) -> None:
        stats = vd.aggregate_stats([0.07])
        self.assertEqual(stats["count"], 1)
        self.assertAlmostEqual(stats["median"], 0.07)
        self.assertAlmostEqual(stats["p84"], 0.07)
        self.assertAlmostEqual(stats["max"], 0.07)

    def test_drops_nan_inputs(self) -> None:
        # `fractional_diff` returns NaN on non-positive paper_pc; ensure
        # those don't corrupt the median via undefined NaN sort order.
        stats = vd.aggregate_stats([0.10, math.nan, -0.20, math.nan, 0.30])
        self.assertEqual(stats["count"], 3)
        self.assertAlmostEqual(stats["median"], 0.20)
        self.assertAlmostEqual(stats["max"], 0.30)

    def test_all_nan_collapses_to_empty(self) -> None:
        stats = vd.aggregate_stats([math.nan, math.nan])
        self.assertEqual(stats["count"], 0)
        self.assertTrue(math.isnan(stats["median"]))


class TopNDisagreementsTests(unittest.TestCase):
    def _disagreement(self, name: str, fd: float) -> vd.Disagreement:
        return vd.Disagreement(
            name=name, source_id=0, catalog_pc=1.0, paper_pc=1.0,
            frac_diff=fd, snr_tot=10.0,
        )

    def test_sorts_by_absolute_descending(self) -> None:
        items = [
            self._disagreement("A", 0.10),
            self._disagreement("B", -0.50),
            self._disagreement("C", 0.30),
            self._disagreement("D", -0.20),
        ]
        top3 = vd.top_n_disagreements(items, n=3)
        self.assertEqual([d.name for d in top3], ["B", "C", "D"])


class ReadBailerJonesTsvTests(unittest.TestCase):
    def test_skips_masked_photogeo_rows(self) -> None:
        body = (
            "source_id\tr_med_geo\tr_lo_geo\tr_hi_geo\tr_med_photogeo\t"
            "r_lo_photogeo\tr_hi_photogeo\tflag\n"
            "100\t250.0\t245.0\t255.0\t252.5\t247.0\t258.0\t10033\n"
            "200\t300.0\t290.0\t310.0\t--\t--\t--\t10000\n"
            "300\t150.5\t148.0\t153.0\t151.0\t148.5\t153.5\t10033\n"
        )
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "bj.tsv"
            p.write_text(body)
            out = vd.read_bailer_jones_tsv(p)
        # source 200 has masked photogeo → dropped; 100 and 300 survive.
        self.assertEqual(out, {100: 252.5, 300: 151.0})


class FormatReportTests(unittest.TestCase):
    """Pin the `validate-distances:` headline markers — they're documented
    as stable identifiers for CI / shell-scripting downstream and changes
    to their wording could silently break consumer scripts."""

    def _disagreement(self, name: str, fd: float) -> vd.Disagreement:
        return vd.Disagreement(
            name=name, source_id=42, catalog_pc=100.0, paper_pc=110.0,
            frac_diff=fd, snr_tot=8.0,
        )

    def _report(self, *, with_unresolved: bool = False, large: int = 0) -> vd.ValidationReport:
        return vd.ValidationReport(
            edsd_total=10, edsd_compared=8,
            edsd_unresolved=["X", "Y"] if with_unresolved else [],
            edsd_stats={"median": 0.05, "p84": 0.10, "max": 0.60, "count": 8},
            edsd_large=[self._disagreement("BIG", 0.60)] * large,
            edsd_top=[self._disagreement("BIG", 0.60), self._disagreement("MED", 0.20)],
            bj_total=2, bj_compared=2,
            bj_unresolved=[],
            bj_stats={"median": 0.0, "p84": 0.0, "max": 0.0, "count": 2},
            bj_top=[self._disagreement("SC", 0.0)],
        )

    def test_emits_expected_headlines(self) -> None:
        out = vd.format_report(self._report(with_unresolved=True, large=1))
        # The 5 stable headline markers any downstream grep can rely on:
        self.assertIn("validate-distances: EDSD_new subset — compared 8/10", out)
        self.assertIn("validate-distances: EDSD_new unresolved (2): X, Y", out)
        self.assertIn("validate-distances: EDSD_new |frac diff|>50%: 1 (bar ≤ 5)", out)
        self.assertIn("validate-distances: EDSD_new top-5 disagreements:", out)
        self.assertIn("validate-distances: BJ_old subset (report-only) — compared 2/2", out)

    def test_skips_unresolved_line_when_empty(self) -> None:
        out = vd.format_report(self._report(with_unresolved=False))
        self.assertNotIn("EDSD_new unresolved", out)

    def test_nan_stats_render_as_na(self) -> None:
        report = self._report()
        report = report._replace(
            edsd_stats={"median": math.nan, "p84": math.nan, "max": math.nan, "count": 0},
        )
        out = vd.format_report(report)
        self.assertIn("median |frac diff|=n/a", out)


class BuildReportTests(unittest.TestCase):
    """The end-to-end behaviour the validator's exit code rides on.
    Builds a 3-EDSD / 2-BJ reference + B-J map by hand and asserts the
    computed stats, the unresolved buckets, and the acceptance gate."""

    def _ref(self, name: str, sid: int | None, d_bj: float, d_new: float, adopted: str) -> vd.RefRow:
        return vd.RefRow(
            name=name, gaia_source_id=sid,
            d_bj_paper_pc=d_bj, d_new_pc=d_new,
            snr_tot=10.0, adopted=adopted,
        )

    def test_edsd_subset_stats_and_acceptance(self) -> None:
        refs = [
            # In-catalog: 5% / 8% / 12% / 60%  fractional diffs.
            self._ref("A", 1, 0.0, 100.0, vd.ADOPTED_EDSD_NEW),  # cat=105 → +5%
            self._ref("B", 2, 0.0, 100.0, vd.ADOPTED_EDSD_NEW),  # cat=108 → +8%
            self._ref("C", 3, 0.0, 100.0, vd.ADOPTED_EDSD_NEW),  # cat=112 → +12%
            self._ref("D", 4, 0.0, 100.0, vd.ADOPTED_EDSD_NEW),  # cat=160 → +60%
            # Unresolved (source_id present but not in B-J map).
            self._ref("E", 99, 0.0, 100.0, vd.ADOPTED_EDSD_NEW),
            # BJ_old self-consistency rows: paper d_bj should equal catalog.
            self._ref("F", 5, 50.0, 0.0, vd.ADOPTED_BJ_OLD),  # cat=50 → 0%
            self._ref("G", 6, 80.0, 0.0, vd.ADOPTED_BJ_OLD),  # cat=80 → 0%
        ]
        bj = {1: 105.0, 2: 108.0, 3: 112.0, 4: 160.0, 5: 50.0, 6: 80.0}
        report = vd.build_report(refs, bj)
        self.assertEqual(report.edsd_total, 5)
        self.assertEqual(report.edsd_compared, 4)
        self.assertEqual(report.edsd_unresolved, ["E"])
        # |diffs| = [0.05, 0.08, 0.12, 0.60]; median = (0.08+0.12)/2 = 0.10
        self.assertAlmostEqual(report.edsd_stats["median"], 0.10)
        self.assertEqual(len(report.edsd_large), 1)
        self.assertEqual(report.edsd_large[0].name, "D")
        # BJ_old subset: zero diff by construction.
        self.assertEqual(report.bj_total, 2)
        self.assertEqual(report.bj_compared, 2)
        self.assertAlmostEqual(report.bj_stats["median"], 0.0)
        # Median 10% ≤ 15% and 1 large diff ≤ 5 → PASS.
        self.assertTrue(vd.passes_acceptance_bars(report))

    def test_too_many_large_diffs_fails(self) -> None:
        refs = [
            self._ref(f"S{i}", i, 0.0, 100.0, vd.ADOPTED_EDSD_NEW) for i in range(1, 7)
        ]
        # 6 stars all at 80% diff → fails the LARGE_DIFF_COUNT_MAX bar.
        bj = {i: 180.0 for i in range(1, 7)}
        report = vd.build_report(refs, bj)
        self.assertEqual(len(report.edsd_large), 6)
        self.assertFalse(vd.passes_acceptance_bars(report))

    def test_high_median_fails(self) -> None:
        # 5 stars at 20% diff: passes large-count (0 > 50%) but fails median.
        refs = [
            self._ref(f"S{i}", i, 0.0, 100.0, vd.ADOPTED_EDSD_NEW) for i in range(1, 6)
        ]
        bj = {i: 120.0 for i in range(1, 6)}
        report = vd.build_report(refs, bj)
        self.assertEqual(len(report.edsd_large), 0)
        self.assertAlmostEqual(report.edsd_stats["median"], 0.20)
        self.assertFalse(vd.passes_acceptance_bars(report))


if __name__ == "__main__":
    unittest.main()
