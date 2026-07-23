#!/usr/bin/env python3
"""Stdlib-unittest pins for the binary pipeline stages.
Run directly — the dotted filename trips ``python -m unittest``.
"""

from __future__ import annotations

import math
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.test_helpers import load_kebab_sibling  # noqa: E402

bb = load_kebab_sibling(__file__, "build_binaries", "build-binaries.py")

from scripts.binaries import parsers as _parsers_mod  # noqa: E402


def _write(dirpath: Path, name: str, body: str) -> Path:
    p = dirpath / name
    p.write_text(body)
    return p


class AthygTests(unittest.TestCase):
    HEADER = (
        '"id","tyc","gaia","hyg","hip","hd","hr","gl","bayer","flam","con",'
        '"proper","ra","dec","pos_src","dist","x0","y0","z0","dist_src",'
        '"mag","absmag","ci","mag_src","rv","rv_src","pm_ra","pm_dec",'
        '"pm_src","vx","vy","vz","spect","spect_src"'
    )

    def test_surfaces_hip_tyc_gaia(self) -> None:
        # One Sol-like row (no Tyc/Gaia/HIP), one fully-classical-IDs row.
        body = "\n".join([
            self.HEADER,
            '1,"",,0,,,"","","","","",Sol,0.0,0.0,OTHER,0.0,0.000005,0.0,'
            '0.0,OTHER,-26.7,4.85,0.656,OTHER,,OTHER,,,OTHER,,,,G2 V,OTHER',
            '21,"5841-1155-1",2341871673090078592,0,2,,"","","","","",,'
            '0.0008,75.48,Hip,219.30,55.93,0.42,212.74,Hip,9.27,-1.45,1.46,'
            'Hip,,OTHER,,,Hip,,,,K0V,Hip',
        ]) + "\n"
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "athyg.csv", body)
            rows = bb.parse_athyg(p)
        self.assertEqual(len(rows), 2)

        sol = rows[0]
        self.assertEqual(sol.proper, "Sol")
        self.assertIsNone(sol.hip)
        self.assertIsNone(sol.tyc)
        self.assertIsNone(sol.gaia)

        hip2 = rows[1]
        self.assertEqual(hip2.hip, 2)
        self.assertEqual(hip2.tyc, "5841-1155-1")
        self.assertEqual(hip2.gaia, 2341871673090078592)
        self.assertAlmostEqual(hip2.ra_deg, 0.0008 * 15.0)
        self.assertAlmostEqual(hip2.dec_deg, 75.48)
        self.assertAlmostEqual(hip2.absmag, -1.45)
        self.assertAlmostEqual(hip2.ci or 0.0, 1.46)


class AthygMissingSentinelTests(unittest.TestCase):
    """AT-HYG uses '' or '0' as the missing-sentinel for
    hip/tyc/gaia/hd. Both must collapse to None at parse time so
    downstream indices keyed on these ids never include a sentinel-0
    row.
    """

    HEADER = AthygTests.HEADER

    def test_zero_sentinel_yields_none_for_hip_and_gaia(self) -> None:
        # hip='0' and gaia='0' are AT-HYG's "no identifier" sentinel —
        # parse_athyg must collapse to None alongside the empty case.
        body = "\n".join([
            self.HEADER,
            '99,"","0",0,0,,"","","","","",HistoricalEntry,1.0,10.0,OTHER,'
            '100.0,80.0,40.0,40.0,OTHER,8.5,5.0,0.5,OTHER,,OTHER,,,'
            'OTHER,,,,K0V,Hip',
        ]) + "\n"
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "athyg.csv", body)
            rows = bb.parse_athyg(p)
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0].hip)
        self.assertIsNone(rows[0].gaia)
        # build_indices must not install rows under a sentinel-0 key.
        idx = bb.build_indices(
            athyg=rows, hip2=[],
            hip_to_gaia={}, tyc_to_gaia={}, src_to_nss={},
        )
        self.assertNotIn(0, idx.hip_to_athyg)
        self.assertNotIn(0, idx.src_to_athyg)

    def test_zero_sentinel_yields_none_for_tyc(self) -> None:
        # tyc='0' is the same sentinel — must not install a TYC key of '0'.
        body = "\n".join([
            AthygTests.HEADER,
            '50,"0",,0,,,"","","","","",TycSentinel,2.0,20.0,OTHER,150.0,'
            '50.0,40.0,40.0,OTHER,9.0,5.0,0.5,OTHER,,OTHER,,,OTHER,,,,'
            'F8V,Hip',
        ]) + "\n"
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "athyg.csv", body)
            rows = bb.parse_athyg(p)
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0].tyc)
        idx = bb.build_indices(
            athyg=rows, hip2=[],
            hip_to_gaia={}, tyc_to_gaia={}, src_to_nss={},
        )
        self.assertNotIn("0", idx.tyc_to_athyg)


class AthygMissingColumnRaisesTests(unittest.TestCase):
    """parse_athyg must NOT silently drop every row when a required
    column header is renamed. A missing required column is a fatal
    misconfiguration; the build should surface it loudly.
    """

    def test_missing_required_column_raises(self) -> None:
        # Header omits 'dist' — the body's positional alignment is
        # irrelevant since DictReader keys by header name. Every row
        # used to silently drop via `except KeyError`; now KeyError
        # propagates to the caller on the first row.
        header_missing_dist = (
            '"id","tyc","gaia","hyg","hip","hd","hr","gl","bayer","flam",'
            '"con","proper","ra","dec","pos_src","x0","y0","z0",'
            '"dist_src","mag","absmag","ci","mag_src","rv","rv_src",'
            '"pm_ra","pm_dec","pm_src","vx","vy","vz","spect","spect_src"'
        )
        body = (
            header_missing_dist + "\n"
            '1,"",,0,,,"","","","","",Sol,0.0,0.0,OTHER,0.000005,0.0,'
            '0.0,OTHER,-26.7,4.85,0.656,OTHER,,OTHER,,,OTHER,,,,G2 V,OTHER\n'
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "athyg.csv", body)
            with self.assertRaises(KeyError):
                bb.parse_athyg(p)


class WdsSummTests(unittest.TestCase):
    def test_parses_precise_coord_and_components(self) -> None:
        # 130-char fixed-width WDS_SUMM record (synthetic, mirrors a real
        # row's column offsets). Padding ensures every field reaches the
        # column the parser expects.
        line = (
            "00000+7530A  1248      1904 1982    5 246 235   0.8   0.6 "
            "10.27 11.5  A7IV      +034+005          +74 1056      "
            "000006.64+752859.8"
        ).ljust(130)
        # WDS files include a header block our parser skips — verify the
        # regex catches it.
        body = (
            "<some HTML\n"
            "Identifier             Frst Last      Fst Lst First  Last  "
            "Pri   Sec  Type      RA\" DEC\" RA\" DEC\"                 "
            "Coordinate      \n"
            "\n"
            f"{line}\n"
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "wds.txt", body)
            pairs = bb.parse_wds_summ(p)
        self.assertEqual(len(pairs), 1)
        pr = pairs[0]
        self.assertEqual(pr.wds_id, "00000+7530")
        self.assertEqual(pr.discoverer, "A  1248")
        self.assertEqual(pr.date_last, 1982)
        self.assertIsNotNone(pr.precise_ra_deg)
        self.assertIsNotNone(pr.precise_dec_deg)
        assert pr.precise_dec_deg is not None
        self.assertAlmostEqual(pr.precise_dec_deg, 75.4833, places=2)


class WdsDedupTests(unittest.TestCase):
    """dedup_wds_pair_rows — the WDS file carries duplicate
    (wds_id, discoverer, components) rows with contradictory geometry
    (Pismis 24 CD); exactly one must survive."""

    @staticmethod
    def _pair(n_obs: int | None, rho: float | None = 1.0) -> "bb.WdsPair":
        return bb.WdsPair(
            wds_id="17247-3412", discoverer="WSI  62", components="CD",
            date_last=2016, rho_last=rho, theta_last=205.0,
            mag_pri=10.0, mag_sec=10.5, spectral="", notes="    ",
            precise_ra_deg=None, precise_dec_deg=None, n_obs=n_obs,
        )

    def test_keeps_most_observed_duplicate(self) -> None:
        low = self._pair(n_obs=3, rho=1.5)
        high = self._pair(n_obs=7, rho=3.5)
        deduped, dropped = bb.dedup_wds_pair_rows([low, high])
        self.assertEqual(dropped, 1)
        self.assertEqual(deduped, [high])

    def test_tie_keeps_first_in_file_order(self) -> None:
        first = self._pair(n_obs=3, rho=3.5)
        second = self._pair(n_obs=3, rho=1.5)
        deduped, dropped = bb.dedup_wds_pair_rows([first, second])
        self.assertEqual(dropped, 1)
        self.assertEqual(deduped, [first])

    def test_distinct_keys_pass_through_in_order(self) -> None:
        cd = self._pair(n_obs=3)
        ab = bb.WdsPair(
            wds_id="17247-3412", discoverer="WSI  62", components="AB",
            date_last=2016, rho_last=1.0, theta_last=100.0,
            mag_pri=9.0, mag_sec=9.5, spectral="", notes="    ",
            precise_ra_deg=None, precise_dec_deg=None, n_obs=2,
        )
        deduped, dropped = bb.dedup_wds_pair_rows([cd, ab])
        self.assertEqual(dropped, 0)
        self.assertEqual(deduped, [cd, ab])


class WdsSepPaSentinelTests(unittest.TestCase):
    def test_negative_parses_to_none(self) -> None:
        self.assertIsNone(_parsers_mod.parse_wds_sep_pa("-1.0"))
        self.assertIsNone(_parsers_mod.parse_wds_sep_pa("  -1"))
        self.assertIsNone(_parsers_mod.parse_wds_sep_pa(""))
        self.assertEqual(_parsers_mod.parse_wds_sep_pa("  0.8"), 0.8)
        self.assertEqual(_parsers_mod.parse_wds_sep_pa("246"), 246.0)

    def test_overflow_sentinel_parses_to_none(self) -> None:
        self.assertIsNone(_parsers_mod.parse_wds_sep_pa("999.9"))
        self.assertEqual(_parsers_mod.parse_wds_sep_pa("999.8"), 999.8)
        self.assertEqual(_parsers_mod.parse_wds_sep_pa("999.0"), 999.0)

    def test_wds_row_no_measurement_sentinel_yields_none(self) -> None:
        base = (
            "00000+7530A  1248      1904 1982    5 246 235   0.8   0.6 "
            "10.27 11.5  A7IV      +034+005          +74 1056      "
            "000006.64+752859.8"
        ).ljust(130)
        chars = list(base)
        chars[42:45] = list("-1 ")     # theta_last column
        chars[52:57] = list("-1.0 ")   # rho_last column
        line = "".join(chars)
        body = (
            "<some HTML\n"
            "Identifier             Frst Last      Fst Lst First  Last  "
            "Pri   Sec  Type      RA\" DEC\" RA\" DEC\"                 "
            "Coordinate      \n"
            "\n"
            f"{line}\n"
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "wds.txt", body)
            pairs = bb.parse_wds_summ(p)
        self.assertEqual(len(pairs), 1)
        self.assertIsNone(pairs[0].rho_last)
        self.assertIsNone(pairs[0].theta_last)

    def test_wds_row_overflow_sentinel_yields_none(self) -> None:
        base = (
            "00000+7530A  1248      1904 1982    5 246 235   0.8   0.6 "
            "10.27 11.5  A7IV      +034+005          +74 1056      "
            "000006.64+752859.8"
        ).ljust(130)
        chars = list(base)
        chars[52:57] = list("999.9")   # rho_last column
        line = "".join(chars)
        body = (
            "<some HTML\n"
            "Identifier             Frst Last      Fst Lst First  Last  "
            "Pri   Sec  Type      RA\" DEC\" RA\" DEC\"                 "
            "Coordinate      \n"
            "\n"
            f"{line}\n"
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "wds.txt", body)
            pairs = bb.parse_wds_summ(p)
        self.assertEqual(len(pairs), 1)
        self.assertIsNone(pairs[0].rho_last)


class Orb6Tests(unittest.TestCase):
    def test_parses_row_with_components(self) -> None:
        # Real-shape ORB6 line with an Aa,Ab component designator at the
        # tail of the discoverer field. Positions follow the banner ruler
        # in data/orb6_orbits.txt.
        line = "000233.44+184100.1 00026+1841 HDS   2Aa,Ab   .     225000    201   8.49  10.62     22.68    y   0.34       0.1106 a  0.0028   59.8      1.3     17.4       2.3     2020.967       0.074    0.6313   0.0130   302.2      3.1    2000 2023 3 n Tok2024a wds00026+1841b.png"
        body = (
            "Sixth Catalog of Orbits of Visual Binary Stars: Orbits\n"
            "0000000000111111111122222\n"
            "0123456789012345678901234\n"
            f"{line}\n"
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "orb6.txt", body)
            rows = bb.parse_orb6(p)
        self.assertEqual(len(rows), 1)
        e = rows[0]
        self.assertEqual(e.wds_id, "00026+1841")
        self.assertEqual(e.components, "Aa,Ab")
        self.assertEqual(e.grade, 3)
        self.assertEqual(e.hip, 201)
        self.assertEqual(e.P_unit, "y")

    def test_parses_row_without_components(self) -> None:
        # Discoverer field "I  1477        " has no component designator —
        # parser must still load the row, with components = "".
        line = "000019.10-441726.0 00003-4417 I  1477        .     224750     25   6.80   7.56    115.4     y   2.9        0.435  a  0.014    65.6      2.6    147.5       1.5     2011.58    y   0.86     0.717    0.020    297.3      2.2    2000 2022 3   Tok2023a wds00003-4417d.png"
        body = "banner line\n" + line + "\n"
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "orb6.txt", body)
            rows = bb.parse_orb6(p)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].wds_id, "00003-4417")
        self.assertEqual(rows[0].components, "")
        self.assertEqual(rows[0].grade, 3)
        self.assertEqual(rows[0].hip, 25)

    def test_splits_discoverer_from_components_when_unspaced(self) -> None:
        # ``STF1110AB`` shape — discoverer code packed against the
        # component letters with no internal space. The fixed-width
        # column split must isolate ``STF1110`` from ``AB``; a regex
        # anchored on trailing letter-runs cannot distinguish the two
        # because both look like ``[A-Za-z]+[0-9]+[A-Z]+``. Castor
        # STF1110 AB (HIP 36850) is the canary — pre-fix it parsed as
        # ``components="STF1110AB"`` and orb6_hip never fired against
        # the WDS pair whose components column was ``"AB"``.
        line = "073435.86+315317.8 07346+3153 STF1110AB       6175  60178  36850   1.93   2.97    459.1     y   2.3        6.722  a  0.021   115.107    0.060   41.304     0.085   1959.59    y   0.021    0.3382   0.0023   251.84     0.38   2000 2021 3 n CIA2022d wds07346+3153r.png"
        body = "banner\n" + line + "\n"
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "orb6.txt", body)
            rows = bb.parse_orb6(p)
        self.assertEqual(len(rows), 1)
        e = rows[0]
        self.assertEqual(e.wds_id, "07346+3153")
        self.assertEqual(e.discoverer, "STF1110")
        self.assertEqual(e.components, "AB")
        self.assertEqual(e.hip, 36850)
        self.assertEqual(e.hd, 60178)
        self.assertEqual(e.grade, 3)

    def test_period_overflowing_left_of_nominal_edge_parses_in_full(self) -> None:
        # 36 And (00550+2338 AB): P = 61183. d right-justifies its
        # leading digit one column left of the nominal field edge. The
        # pre-widening slice read 1183. — a 167-yr orbit rendered as
        # 3.2 yr.
        line = "005458.02+233742.4 00550+2338 STF  73AB        755   5286   4288   6.12   6.54  61183.      d  69.         0.9837 a  0.0011   44.57     0.11   173.66      0.13   35543.      m  21.       0.30603  0.00078  358.62     0.21   2000 2008 2 n Mut2010b wds00550+2338b.png"
        body = "banner\n" + line + "\n"
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "orb6.txt", body)
            rows = bb.parse_orb6(p)
        self.assertEqual(len(rows), 1)
        e = rows[0]
        self.assertEqual(e.P_val, 61183.0)
        self.assertEqual(e.P_unit, "d")

    def test_omega_overflowing_left_of_nominal_edge_parses_in_full(self) -> None:
        # 17563-1549 Aa1,2: ω = 252.3° overflows one column left the
        # same way; the pre-widening slice read 52.3.
        line = "175619.04-154844.5 17563-1549 WAI   1Aa1,2   10891 163336  87813   6.45k  7.50k    13.4191  d   0.0003     2.0    m  0.1     151.      17.     306.3       5.8    57900.0     d   0.2      0.36     0.02    252.3       4.7              3 n WAI2023  wds17563-1549b.png"
        body = "banner\n" + line + "\n"
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "orb6.txt", body)
            rows = bb.parse_orb6(p)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].omega_deg, 252.3)


# ─── Fixed-width parser sanity nets ──────────────────────────────────

# Synthetic-row builders for the column-offset-drift tests. Each helper
# produces a real-shape line; the `drift` variant truncates / blanks the
# headline column so the parser's per-row safe_float / precise-coord
# parse returns None.

def _wds_line(*, with_precise: bool) -> str:
    base = (
        "00000+7530A  1248      1904 1982    5 246 235   0.8   0.6 "
        "10.27 11.5  A7IV      +034+005          +74 1056      "
    )
    if with_precise:
        return (base + "000006.64+752859.8").ljust(130)
    return base.ljust(130)  # cols 112-130 blank → precise coord is None


def _orb6_line(*, with_period: bool) -> str:
    # Real ORB6 row with a 11.06y period at cols 81:92. Blank that
    # span for the drift variant; the rest of the line is unchanged.
    line = "000233.44+184100.1 00026+1841 HDS   2Aa,Ab   .     225000    201   8.49  10.62     22.68    y   0.34       0.1106 a  0.0028   59.8      1.3     17.4       2.3     2020.967       0.074    0.6313   0.0130   302.2      3.1    2000 2023 3 n Tok2024a wds00026+1841b.png"
    if with_period:
        return line
    return line[:81] + (" " * 11) + line[92:]


class WdsSummSanityNetTests(unittest.TestCase):
    def test_passes_when_precise_coord_present(self) -> None:
        # 20 rows, all with precise coords → no SystemExit.
        body = "banner\n" + "\n".join(
            [_wds_line(with_precise=True) for _ in range(20)]
        ) + "\n"
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "wds.txt", body)
            pairs = bb.parse_wds_summ(p)
        self.assertEqual(len(pairs), 20)

    def test_raises_when_precise_coord_drifts_below_floor(self) -> None:
        # 20 rows, 18 blank precise coords (10% non-null) → SystemExit.
        # Floor is 95% so this is well below.
        lines = [_wds_line(with_precise=False) for _ in range(18)]
        lines += [_wds_line(with_precise=True) for _ in range(2)]
        body = "banner\n" + "\n".join(lines) + "\n"
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "wds.txt", body)
            with self.assertRaises(SystemExit) as cm:
                bb.parse_wds_summ(p)
        msg = str(cm.exception)
        self.assertIn("parse_wds_summ", msg)
        self.assertIn("precise_ra_deg", msg)
        self.assertIn("column-offset drift", msg)


class Orb6SanityNetTests(unittest.TestCase):
    def test_passes_when_period_present(self) -> None:
        lines = [_orb6_line(with_period=True) for _ in range(20)]
        body = "banner\n" + "\n".join(lines) + "\n"
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "orb6.txt", body)
            rows = bb.parse_orb6(p)
        self.assertEqual(len(rows), 20)

    def test_raises_when_period_column_drifts_below_floor(self) -> None:
        # 20 rows, 19 with blanked-out period column → 5% non-null.
        # Floor is 90% so this is well below.
        lines = [_orb6_line(with_period=False) for _ in range(19)]
        lines += [_orb6_line(with_period=True) for _ in range(1)]
        body = "banner\n" + "\n".join(lines) + "\n"
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "orb6.txt", body)
            with self.assertRaises(SystemExit) as cm:
                bb.parse_orb6(p)
        msg = str(cm.exception)
        self.assertIn("parse_orb6", msg)
        self.assertIn("P_val", msg)
        self.assertIn("column-offset drift", msg)


class AssertFieldCoverageTests(unittest.TestCase):
    """The shared helper itself — covers the empty-input + floor-band
    cases the per-parser tests don't directly exercise."""

    def test_empty_rows_is_a_noop(self) -> None:
        # No rows: no SystemExit (the helper can't tell drift from a
        # legitimately empty input).
        _parsers_mod._assert_field_coverage(
            [], "parse_test", "field", 0.99,
        )

    def test_passes_at_exact_floor(self) -> None:
        # Floor is inclusive only above — rate >= floor passes.
        from dataclasses import dataclass

        @dataclass
        class Row:
            x: int | None

        rows = [Row(1), Row(1), Row(1), Row(1), Row(None)]  # 80%
        _parsers_mod._assert_field_coverage(
            rows, "parse_test", "x", 0.80,
        )

    def test_raises_below_floor_with_diagnostic(self) -> None:
        from dataclasses import dataclass

        @dataclass
        class Row:
            x: int | None

        rows = [Row(1), Row(None), Row(None), Row(None), Row(None)]  # 20%
        with self.assertRaises(SystemExit) as cm:
            _parsers_mod._assert_field_coverage(
                rows, "parse_test", "x", 0.50,
            )
        msg = str(cm.exception)
        self.assertIn("parse_test", msg)
        self.assertIn("'x'", msg)
        self.assertIn("20.0%", msg)
        self.assertIn("50%", msg)


class GcvsTests(unittest.TestCase):
    def test_parses_rows_and_crossids(self) -> None:
        gcvs_body = (
            "#\n"
            "#   VizieR header\n"
            "#\n"
            "---\n"
            "010001 |R     And *|002401.95 +383437.3 |M         |  5.8    "
            "|  15.2      |            |V |53820.      |     |   409.2   "
            "|38   |S3,5e-S8,8e(M7e) |HIP   00002|           |-0.016 -0.035|"
            "2000.0  | |Hip      |M         |R     And |\n"
        )
        crossid_body = (
            "---\n"
            "GCVS R     And                |    =HIP    2| | |\n"
            "GCVS S     And                |    =M31   V0894| | |\n"
        )
        with tempfile.TemporaryDirectory() as td:
            tdp = Path(td)
            gp = _write(tdp, "gcvs5.txt", gcvs_body)
            xp = _write(tdp, "crossid.txt", crossid_body)
            rows = bb.parse_gcvs(gp)
            xid = bb.parse_gcvs_crossid(xp)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].gcvs_id, "010001")
        self.assertEqual(rows[0].designation, "R     And *")
        self.assertEqual(rows[0].var_type, "M")
        self.assertIn("R     And", xid)
        self.assertEqual(xid["R     And"], ["HIP    2"])


class CcdmTests(unittest.TestCase):
    def test_skips_vizier_header(self) -> None:
        body = (
            "#\n"
            "#   VizieR header\n"
            "#\n"
            "HIP\tCCDM\tMultFlag\n"
            " \t \t\n"
            "------\t----------\t-\n"
            "     3\t00000+3852\t\n"
            "    18\t          \tO\n"
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "ccdm.tsv", body)
            rows = bb.parse_ccdm(p)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0].hip, 3)
        self.assertEqual(rows[0].ccdm, "00000+3852")
        self.assertEqual(rows[1].hip, 18)
        self.assertEqual(rows[1].mult_flag, "O")

    def test_survives_reformatted_separator_row(self) -> None:
        # Data detection keys on the first field parsing as a HIP, not
        # on the dash separator — a VizieR reformat (=====, or no
        # separator at all) must not blank the parse.
        body = (
            "#   VizieR header\n"
            "HIP\tCCDM\tMultFlag\n"
            "======\t==========\t=\n"
            "     3\t00000+3852\t\n"
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "ccdm.tsv", body)
            rows = bb.parse_ccdm(p)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].hip, 3)
        self.assertEqual(rows[0].ccdm, "00000+3852")


class Hip2Tests(unittest.TestCase):
    def test_parses_astrometry_row(self) -> None:
        body = (
            "hip\tra_icrs\tde_icrs\tplx\te_plx\tpm_ra\tpm_de\te_pm_ra\t"
            "e_pm_de\tgoodness_of_fit\tn_transits\n"
            "2\t0.00379738\t-19.49883738\t20.85\t1.13\t182.88\t-1.31\t1.22"
            "\t0.66\t0.06\t121\n"
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "hip2.tsv", body)
            rows = bb.parse_hip2(p)
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual(r.hip, 2)
        self.assertEqual(r.plx_mas, 20.85)
        self.assertEqual(r.n_transits, 121)


class GaiaXmatchTests(unittest.TestCase):
    def test_hip_xmatch_keeps_nearest(self) -> None:
        body = (
            "hip\tgaia_source_id\tangular_distance\tnumber_of_neighbours\txm_flag\n"
            "2\t2341871673090078592\t0.043826\t1\t8\n"
            "2\t9999999999999999999\t1.234\t1\t8\n"   # farther — should lose
            "3\t2881742980523997824\t0.001604\t1\t8\n"
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "xm.tsv", body)
            m = bb.parse_gaia_hip_xmatch(p)
        self.assertEqual(m[2], 2341871673090078592)
        self.assertEqual(m[3], 2881742980523997824)

    def test_hip_xmatch_malformed_angular_distance_loses(self) -> None:
        # A row with empty / malformed angular_distance must not coerce
        # to 0.0 (the most-preferred value) and silently displace a real
        # match. Confirm the real match (0.5″) wins over the malformed
        # row.
        body = (
            "hip\tgaia_source_id\tangular_distance\tnumber_of_neighbours\txm_flag\n"
            "42\t1111111111111111111\t\t1\t8\n"      # malformed: empty
            "42\t2222222222222222222\t0.5\t1\t8\n"   # real match
            "43\t3333333333333333333\tnope\t1\t8\n"  # malformed: garbage
            "43\t4444444444444444444\t0.7\t1\t8\n"   # real match
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "xm.tsv", body)
            m = bb.parse_gaia_hip_xmatch(p)
        self.assertEqual(m[42], 2222222222222222222)
        self.assertEqual(m[43], 4444444444444444444)

    def test_hip_xmatch_skips_nonpositive_keys(self) -> None:
        # hip and gaia_source_id are positive integers; hip <= 0, negative
        # gaia, and partial-numeric hip must all drop (parity with the TS
        # parseGaiaHipXmatchTsv guards).
        body = (
            "hip\tgaia_source_id\tangular_distance\n"
            "0\t1111111111111111111\t0.1\n"     # hip 0
            "-4\t2222222222222222222\t0.1\n"    # negative hip
            "12abc\t3333333333333333333\t0.1\n"  # partial-numeric hip
            "20\t-8888888888888888888\t0.1\n"   # negative gaia
            "21\t4444444444444444444\t0.1\n"    # the one valid row
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "xm.tsv", body)
            m = bb.parse_gaia_hip_xmatch(p)
        self.assertEqual(m, {21: 4444444444444444444})

    def test_tyc_xmatch(self) -> None:
        body = (
            "tyc\tgaia_source_id\tangular_distance\tnumber_of_neighbours\txm_flag\n"
            "1000-1006-1\t4493609606459508864\t0.065120\t1\t8\n"
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "tyc.tsv", body)
            m = bb.parse_gaia_tyc_xmatch(p)
        self.assertEqual(m["1000-1006-1"], 4493609606459508864)

    def test_tyc_xmatch_malformed_angular_distance_loses(self) -> None:
        # Companion to test_hip_xmatch_malformed_angular_distance_loses.
        # Same coercion rule applies to the Tycho cross-walk.
        body = (
            "tyc\tgaia_source_id\tangular_distance\tnumber_of_neighbours\txm_flag\n"
            "9-1-1\t5555555555555555555\t\t1\t8\n"      # malformed
            "9-1-1\t6666666666666666666\t0.3\t1\t8\n"   # real match
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "tyc.tsv", body)
            m = bb.parse_gaia_tyc_xmatch(p)
        self.assertEqual(m["9-1-1"], 6666666666666666666)

    def test_nss_returns_raw_row(self) -> None:
        body = (
            "source_id\tnss_solution_type\tperiod\tperiod_error\n"
            "33711199137024\tOrbital\t773.09\t27.35\n"
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "nss.tsv", body)
            m = bb.parse_gaia_nss(p)
        self.assertEqual(set(m.keys()), {33711199137024})
        self.assertEqual(m[33711199137024]["nss_solution_type"], "Orbital")
        self.assertEqual(m[33711199137024]["period"], "773.09")


class ParseSimbadWdsXidsTests(unittest.TestCase):
    HEADER = (
        "wds_id\tcomponent\tsimbad_oid\tsimbad_main_id\tgaia_source_id\thip"
    )

    def test_parses_row_with_full_xrefs(self) -> None:
        body = (
            f"{self.HEADER}\n"
            "00491+5749\tA\t106647\t* eta Cas\t425040000962559616\t3821\n"
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "simbad_wds_xids.tsv", body)
            out = bb.parse_simbad_wds_xids(p)
        self.assertEqual(len(out), 1)
        row = out[("00491+5749", "A")]
        self.assertEqual(row.simbad_oid, 106647)
        self.assertEqual(row.simbad_main_id, "* eta Cas")
        self.assertEqual(row.gaia_source_id, 425040000962559616)
        self.assertEqual(row.hip, 3821)

    def test_blank_gaia_source_id_yields_none(self) -> None:
        # α Cen A-shape: SIMBAD oid + HIP present, Gaia DR3 blank
        # (saturation gap). The parser must surface that as ``None``
        # not 0, so downstream cascade logic stays correct.
        body = (
            f"{self.HEADER}\n"
            "14396-6050\tA\t3396054\t* alf Cen A\t\t71683\n"
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "simbad_wds_xids.tsv", body)
            out = bb.parse_simbad_wds_xids(p)
        row = out[("14396-6050", "A")]
        self.assertIsNone(row.gaia_source_id)
        self.assertEqual(row.hip, 71683)

    def test_skips_rows_missing_essential_keys(self) -> None:
        # Defensive: any of wds_id / component / simbad_oid blank →
        # skip the row rather than indexing it as a partial record.
        body = (
            f"{self.HEADER}\n"
            "\tA\t1\tx\t\t\n"        # blank wds_id
            "X\t\t2\tx\t\t\n"        # blank component
            "X\tA\t\tx\t\t\n"        # blank simbad_oid
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "simbad_wds_xids.tsv", body)
            out = bb.parse_simbad_wds_xids(p)
        self.assertEqual(out, {})


class ParseSimbadWdsSpectraTests(unittest.TestCase):
    SPTYPE_HEADER = (
        "simbad_oid\tsimbad_main_id\tsp_type\tsp_qual\tsp_bibcode\totype\thip\tsource_id"
    )
    XIDS_HEADER = (
        "wds_id\tcomponent\tsimbad_oid\tsimbad_main_id\tgaia_source_id\thip"
    )

    def test_joins_xids_to_sptype_on_simbad_oid(self) -> None:
        # 40 Eri: A=K0V, B=DA2.9, C=M4.5V — three components, three
        # SIMBAD oids. The join must return all three as per-component
        # sp_type strings.
        sptype = (
            f"{self.SPTYPE_HEADER}\n"
            "702026\t* omi02 Eri\tK0V\tB\tref1\tPM*\t19849\t3195919528989223040\n"
            "701944\t* omi02 Eri B\tDA2.9\tC\tref2\tWD*\t\t3195919254111315712\n"
            "701829\t* omi02 Eri C\tM4.5V\tB\tref3\tPM*\t\t3195919254111314816\n"
        )
        xids = (
            f"{self.XIDS_HEADER}\n"
            "04153-0739\tA\t702026\t* omi02 Eri\t3195919528989223040\t19849\n"
            "04153-0739\tB\t701944\t* omi02 Eri B\t3195919254111315712\t\n"
            "04153-0739\tC\t701829\t* omi02 Eri C\t3195919254111314816\t\n"
        )
        with tempfile.TemporaryDirectory() as td:
            sp = _write(Path(td), "simbad_sptype.tsv", sptype)
            xd = _write(Path(td), "simbad_wds_xids.tsv", xids)
            out = bb.parse_simbad_wds_spectra(sp, xd)
        self.assertEqual(out[("04153-0739", "A")], "K0V")
        self.assertEqual(out[("04153-0739", "B")], "DA2.9")
        self.assertEqual(out[("04153-0739", "C")], "M4.5V")

    def test_omits_components_without_simbad_sptype(self) -> None:
        # Sirius A is in WDS xids and SIMBAD has sp_type; Sirius B is in
        # WDS xids but SIMBAD has no sp_type entry for the oid (blank
        # cell). The B component must be ABSENT from the result so
        # stage 6's caller falls through to AT-HYG rather than
        # overwriting with an empty string.
        sptype = (
            f"{self.SPTYPE_HEADER}\n"
            "8399845\t* alf CMa\tA0mA1Va\tC\tref\tSB*\t32349\t\n"
            "8399846\t* alf CMa B\t\t\t\tWD*\t\t\n"      # blank sp_type
        )
        xids = (
            f"{self.XIDS_HEADER}\n"
            "06451-1643\tA\t8399845\t* alf CMa\t\t32349\n"
            "06451-1643\tB\t8399846\t* alf CMa B\t\t\n"
        )
        with tempfile.TemporaryDirectory() as td:
            sp = _write(Path(td), "simbad_sptype.tsv", sptype)
            xd = _write(Path(td), "simbad_wds_xids.tsv", xids)
            out = bb.parse_simbad_wds_spectra(sp, xd)
        self.assertEqual(out, {("06451-1643", "A"): "A0mA1Va"})

    def test_omits_xids_with_no_sptype_row(self) -> None:
        # WDS xid references simbad_oid 999, but the sptype TSV has no
        # row at that oid — defensive fallthrough.
        sptype = (
            f"{self.SPTYPE_HEADER}\n"
            "1\tmain\tG2V\t\t\t\t\t\n"
        )
        xids = (
            f"{self.XIDS_HEADER}\n"
            "X\tA\t999\tnomatch\t\t\n"
        )
        with tempfile.TemporaryDirectory() as td:
            sp = _write(Path(td), "simbad_sptype.tsv", sptype)
            xd = _write(Path(td), "simbad_wds_xids.tsv", xids)
            out = bb.parse_simbad_wds_spectra(sp, xd)
        self.assertEqual(out, {})

    def test_column_order_independence(self) -> None:
        # Future column additions (rv, photometry, …) must not break
        # this consumer. Verify reordered columns parse cleanly by
        # name, not by position.
        sptype = (
            "source_id\thip\tsimbad_main_id\tsimbad_oid\totype\t"
            "sp_bibcode\tsp_qual\tsp_type\n"
            "\t1\tmain\t42\t**\t\t\tF5V\n"
        )
        xids = (
            f"{self.XIDS_HEADER}\n"
            "X\tA\t42\tmain\t\t1\n"
        )
        with tempfile.TemporaryDirectory() as td:
            sp = _write(Path(td), "simbad_sptype.tsv", sptype)
            xd = _write(Path(td), "simbad_wds_xids.tsv", xids)
            out = bb.parse_simbad_wds_spectra(sp, xd)
        self.assertEqual(out, {("X", "A"): "F5V"})


class ComponentSptypeOverridesTests(unittest.TestCase):
    def test_parses_overrides_skipping_preamble(self) -> None:
        content = (
            "# preamble line\n"
            "# another\n"
            "wds_id\tcomponent\tsp_type\tsource\n"
            "03082+4057\t2\tK0IV\tKolbas et al. 2015\n"
            "08447-5443\tAb\tA4V\tMerand et al. 2011\n"
            "X\tA\t\tblank sp_type is skipped\n"
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "component_sptype_overrides.tsv", content)
            out = bb.parse_component_sptype_overrides(p)
        self.assertEqual(out, {
            ("03082+4057", "2"): "K0IV",
            ("08447-5443", "Ab"): "A4V",
        })

    def test_shipped_overrides_file_parses_and_covers_algol(self) -> None:
        out = bb.parse_component_sptype_overrides(
            bb.SRC_COMPONENT_SPTYPE_OVERRIDES,
        )
        self.assertEqual(out[("03082+4057", "2")], "K0IV")

    def test_resolve_spect_curated_tier_wins(self) -> None:
        from scripts.binaries import stage6_multiples as s6
        indices = bb.build_indices(
            [], [], {}, {}, {},
            simbad_wds_spectra={("W", "B"): "G5V"},
            component_sptype_overrides={("W", "B"): "K0IV"},
        )
        spect, via = s6._resolve_spect("W", "B", None, indices)
        self.assertEqual((spect, via), ("K0IV", "curated"))
        spect, via = s6._resolve_spect("W", "A", None, indices)
        self.assertEqual((spect, via), ("", "none"))


class AstrometryExclusionsTests(unittest.TestCase):
    def test_parses_source_ids_skipping_preamble(self) -> None:
        content = (
            "# preamble\n"
            "gaia_source_id\tcomponent\twds_id\treason\n"
            "2947050466531873024\tB\t06451-1643\tSirius B blended\n"
            "\tA\tX\tblank source_id is skipped\n"
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "astrometry_exclusions.tsv", content)
            out = bb.parse_astrometry_exclusions(p)
        self.assertEqual(set(out.keys()), {2947050466531873024})
        self.assertIn("Sirius B", out[2947050466531873024])

    def test_shipped_file_parses_and_covers_sirius_b(self) -> None:
        out = bb.parse_astrometry_exclusions(bb.SRC_ASTROMETRY_EXCLUSIONS)
        self.assertIn(2947050466531873024, out)


class SplitComponentsTests(unittest.TestCase):
    def test_two_letter_pair(self) -> None:
        self.assertEqual(bb.split_components("AB"), ("A", "B"))

    def test_comma_separated_pair(self) -> None:
        self.assertEqual(bb.split_components("Aa,Ab"), ("Aa", "Ab"))
        self.assertEqual(bb.split_components("BC,D"), ("BC", "D"))

    def test_skips_blank_field(self) -> None:
        self.assertIsNone(bb.split_components(""))
        self.assertIsNone(bb.split_components("   "))

    def test_skips_ambiguous_three_letter(self) -> None:
        # "ABC" could be A+BC or AB+C — refuse rather than guess.
        self.assertIsNone(bb.split_components("ABC"))

    def test_skips_single_letter(self) -> None:
        self.assertIsNone(bb.split_components("A"))


def _blank_pair(
    *, wds_id: str, discoverer: str = "TST   1",
    precise_ra: float | None = None, precise_dec: float | None = None,
) -> "bb.WdsPair":
    return bb.WdsPair(
        wds_id=wds_id, discoverer=discoverer, components="",
        date_last=None, rho_last=None, theta_last=None,
        mag_pri=None, mag_sec=None, spectral="", notes="    ",
        precise_ra_deg=precise_ra, precise_dec_deg=precise_dec,
    )


class RescueBlankComponentsTests(unittest.TestCase):
    def _rescue(self, **kw: object) -> tuple[int, int]:
        kw.setdefault("orb6", [])
        kw.setdefault("simbad_xids", {})
        kw.setdefault("synthesized_orb6_pairs", [])
        return bb.rescue_blank_components_pairs(**kw)  # type: ignore[arg-type]

    def test_gate1_orb6_orbit_rescues_and_aligns_orb6_key(self) -> None:
        # Antares shape: blank WDS row + blank ORB6 row for the same
        # wds_id. Both rewrite to "AB" so the strict orbit lookup lands.
        pair = _blank_pair(wds_id="16294-2626")
        orb6 = [_orb6(wds_id="16294-2626", components="", hip=80763)]
        rescued, deferred = self._rescue(pairs=[pair], orb6=orb6)
        self.assertEqual((rescued, deferred), (1, 0))
        self.assertEqual(pair.components, "AB")
        self.assertEqual(orb6[0].components, "AB")

    def test_gate1_leaves_nonblank_orb6_row_untouched(self) -> None:
        # An ORB6 sub-pair row for the same system still triggers gate 1,
        # but its own (non-blank) components field is not rewritten.
        pair = _blank_pair(wds_id="16294-2626")
        orb6 = [_orb6(wds_id="16294-2626", components="Aa,Ab", hip=80763)]
        rescued, _ = self._rescue(pairs=[pair], orb6=orb6)
        self.assertEqual(rescued, 1)
        self.assertEqual(pair.components, "AB")
        self.assertEqual(orb6[0].components, "Aa,Ab")

    def test_gate2_simbad_xid_rescues(self) -> None:
        pair = _blank_pair(wds_id="20414+4517")
        xids = {
            ("20414+4517", "A"): bb.SimbadWdsXid(
                simbad_oid=1, simbad_main_id="* alf Cyg",
                gaia_source_id=None, hip=102098,
            ),
        }
        rescued, deferred = self._rescue(pairs=[pair], simbad_xids=xids)
        self.assertEqual((rescued, deferred), (1, 0))
        self.assertEqual(pair.components, "AB")

    def test_position_only_blank_row_deferred(self) -> None:
        # Deneb shape: primary is a catalog star but the system has no
        # ORB6 orbit and no SIMBAD xid. Position-only anchoring is
        # deferred to the full blank→AB ingest — not rescued here.
        pair = _blank_pair(
            wds_id="20414+4517", precise_ra=310.0, precise_dec=45.0,
        )
        rescued, deferred = self._rescue(pairs=[pair])
        self.assertEqual((rescued, deferred), (0, 1))
        self.assertEqual(pair.components, "")

    def test_unanchored_blank_row_deferred(self) -> None:
        pair = _blank_pair(wds_id="99999+9999")
        rescued, deferred = self._rescue(pairs=[pair])
        self.assertEqual((rescued, deferred), (0, 1))
        self.assertEqual(pair.components, "")

    def test_orb6_orphan_donor_row_excluded(self) -> None:
        # A blank row already donated to a synthesized orphan sub-pair is
        # represented by that pair — rescuing it would double-emit.
        pair = _blank_pair(wds_id="14296-6241", discoverer="RHD   1")
        orb6 = [_orb6(wds_id="14296-6241", components="Ca,Cb", hip=71681)]
        synth = [_wds_pair_with_pos(
            wds_id="14296-6241", components="Ca,Cb",
        )]
        synth[0].discoverer = "RHD   1"
        rescued, deferred = self._rescue(
            pairs=[pair], orb6=orb6, synthesized_orb6_pairs=synth,
        )
        self.assertEqual((rescued, deferred), (0, 0))
        self.assertEqual(pair.components, "")

    def test_existing_ab_row_excluded(self) -> None:
        # A non-blank "AB" row already enumerates the pair; the blank row
        # under the same (wds_id, discoverer) is not double-minted.
        blank = _blank_pair(wds_id="16294-2626")
        explicit = _wds_pair(wds_id="16294-2626", components="AB")
        orb6 = [_orb6(wds_id="16294-2626", components="AB", hip=80763)]
        rescued, deferred = self._rescue(
            pairs=[blank, explicit], orb6=orb6,
        )
        self.assertEqual((rescued, deferred), (0, 0))
        self.assertEqual(blank.components, "")

    def test_multiple_blank_rows_same_system_rescued_once(self) -> None:
        # Two blank rows for one wds_id under different discoverers both
        # name the implied A,B pair; only one is promoted so the pair
        # doesn't double-emit (dedup_wds_pair_rows keys on discoverer and
        # runs upstream, so it can't collapse them itself).
        p1 = _blank_pair(wds_id="16294-2626", discoverer="STF   1")
        p2 = _blank_pair(wds_id="16294-2626", discoverer="BU    2")
        orb6 = [_orb6(wds_id="16294-2626", components="", hip=80763)]
        rescued, deferred = self._rescue(pairs=[p1, p2], orb6=orb6)
        self.assertEqual((rescued, deferred), (1, 0))
        self.assertEqual([p.components for p in (p1, p2)].count("AB"), 1)

    def test_existing_ab_other_discoverer_excludes_blank(self) -> None:
        # The implied AB pair is identified by wds_id alone, so a blank
        # row under a DIFFERENT discoverer than an explicit AB row is the
        # same physical pair and is not promoted — a second AB row would
        # double-emit.
        blank = _blank_pair(wds_id="16294-2626", discoverer="BU    2")
        explicit = _wds_pair(wds_id="16294-2626", components="AB")
        orb6 = [_orb6(wds_id="16294-2626", components="AB", hip=80763)]
        rescued, deferred = self._rescue(pairs=[blank, explicit], orb6=orb6)
        self.assertEqual((rescued, deferred), (0, 0))
        self.assertEqual(blank.components, "")


def _wds_pair(*, wds_id: str = "00000+0000", components: str = "AB") -> "bb.WdsPair":
    return bb.WdsPair(
        wds_id=wds_id, discoverer="TST   1", components=components,
        date_last=None, rho_last=None, theta_last=None,
        mag_pri=None, mag_sec=None, spectral="", notes="    ",
        precise_ra_deg=None, precise_dec_deg=None,
    )


def _athyg_row(
    *, hip: int | None = None, gaia: int | None = None,
    ra_deg: float = 0.0, dec_deg: float = 0.0,
    v_mag: float | None = None, hd: int | None = None,
) -> "bb.AthygRow":
    return bb.AthygRow(
        hip=hip, tyc=None, gaia=gaia, hd=hd,
        ra_deg=ra_deg, dec_deg=dec_deg,
        x_pc=0.0, y_pc=0.0, z_pc=0.0,
        dist_pc=1.0, v_mag=v_mag, absmag=5.0,
        ci=None, spect="", proper="",
        pm_ra_masyr=None, pm_de_masyr=None,
    )


def _indices(
    *,
    hip_to_gaia: dict[int, int] | None = None,
    athyg: list["bb.AthygRow"] | None = None,
) -> "bb.IdentifierIndices":
    return bb.build_indices(
        athyg=athyg or [],
        hip2=[],
        hip_to_gaia=hip_to_gaia or {},
        tyc_to_gaia={},
        src_to_nss={},
    )


def _orb6(*, wds_id: str, components: str, hip: int | None) -> "bb.Orb6Entry":
    return bb.Orb6Entry(
        wds_id=wds_id, discoverer="TST   1", components=components,
        hd=None, hip=hip,
        P_val=None, P_unit="", a_val=None, a_unit="",
        i_deg=None, Omega_deg=None, omega_deg=None,
        e=None, T0_val=None, T0_unit="", grade=5, ref="",
    )


class ResolveComponentTests(unittest.TestCase):
    def test_tier1_orb6_hip_for_primary(self) -> None:
        # ORB6 publishes HIP for the pair; Gaia HIP xwalk covers it.
        pair = _wds_pair(wds_id="06451-1643", components="AB")
        orb6 = [_orb6(wds_id="06451-1643", components="AB", hip=32349)]
        idx = _indices(hip_to_gaia={32349: 2947050466531873024})
        r = bb.resolve_component(
            pair, "A", is_primary=True,
            orb6_for_pair=orb6, indices=idx,
        )
        self.assertEqual(r.resolve_via, "orb6_hip")
        self.assertEqual(r.gaia_source_id, 2947050466531873024)

    def test_tier1_does_not_fire_for_secondary(self) -> None:
        # ORB6 has one HIP per orbit row (the primary's by convention).
        # Secondary must fall through to a later tier.
        pair = _wds_pair(components="AB")
        orb6 = [_orb6(wds_id=pair.wds_id, components="AB", hip=100)]
        idx = _indices(hip_to_gaia={100: 999})
        r = bb.resolve_component(
            pair, "B", is_primary=False,
            orb6_for_pair=orb6, indices=idx,
        )
        self.assertEqual(r.resolve_via, "unresolved")
        self.assertIsNone(r.gaia_source_id)

    def test_tier2_athyg_when_orb6_hip_misses_xwalk(self) -> None:
        # ORB6 hip exists, Gaia HIP xwalk misses; AT-HYG carries gaia
        # natively for that HIP.
        pair = _wds_pair(components="AB")
        orb6 = [_orb6(wds_id=pair.wds_id, components="AB", hip=42)]
        idx = _indices(
            hip_to_gaia={},  # xwalk does not cover HIP 42
            athyg=[_athyg_row(hip=42, gaia=12345,
                              ra_deg=pair.precise_ra_deg,
                              dec_deg=pair.precise_dec_deg)],
        )
        r = bb.resolve_component(
            pair, "A", is_primary=True,
            orb6_for_pair=orb6, indices=idx,
        )
        self.assertEqual(r.resolve_via, "athyg_gaia_native")
        self.assertEqual(r.gaia_source_id, 12345)

    def test_unresolved_when_no_hip_signal(self) -> None:
        pair = _wds_pair(components="AB")
        idx = _indices(hip_to_gaia={1: 1})
        r = bb.resolve_component(
            pair, "A", is_primary=True,
            orb6_for_pair=[], indices=idx,
        )
        self.assertEqual(r.resolve_via, "unresolved")
        self.assertIsNone(r.gaia_source_id)

    def test_orb6_hip_rejected_when_position_far_from_pair_coord(self) -> None:
        # ε Equ shape: ORB6 publishes a typo'd HIP that resolves to a
        # real but unrelated star tens of degrees off the pair's WDS
        # precise coord. The gate drops the HIP entirely — no orb6_hip
        # resolution, and the bad HIP is not even carried forward for
        # Stage 3's HIP2 fallback.
        pair = _wds_pair(
            wds_id="20591+0418", components="Aa,Ab",
            precise_ra_deg=315.0, precise_dec_deg=4.3,
        )
        orb6 = [_orb6(wds_id=pair.wds_id, components="Aa,Ab", hip=103579)]
        idx = _indices(
            hip_to_gaia={103579: 2018523585846555648},
            athyg=[_athyg_row(hip=103579, gaia=2018523585846555648,
                              ra_deg=315.4, dec_deg=44.1)],
        )
        r = bb.resolve_component(
            pair, "Aa", is_primary=True,
            orb6_for_pair=orb6, indices=idx,
        )
        self.assertEqual(r.resolve_via, "unresolved")
        self.assertIsNone(r.gaia_source_id)
        self.assertIsNone(r.hip)

    def test_orb6_hip_accepted_when_position_matches_pair_coord(self) -> None:
        # Same tier, HIP positions on top of the pair's precise coord —
        # the gate trusts it.
        pair = _wds_pair(
            wds_id="06451-1643", components="AB",
            precise_ra_deg=101.3, precise_dec_deg=-16.7,
        )
        orb6 = [_orb6(wds_id=pair.wds_id, components="AB", hip=32349)]
        idx = _indices(
            hip_to_gaia={32349: 2947050466531873024},
            athyg=[_athyg_row(hip=32349, gaia=2947050466531873024,
                              ra_deg=101.3, dec_deg=-16.7)],
        )
        r = bb.resolve_component(
            pair, "A", is_primary=True,
            orb6_for_pair=orb6, indices=idx,
        )
        self.assertEqual(r.resolve_via, "orb6_hip")
        self.assertEqual(r.gaia_source_id, 2947050466531873024)

    def test_orb6_hip_trusted_when_pair_has_no_precise_coord(self) -> None:
        # No WDS precise coord to validate against → trust the ORB6 HIP
        # (the coord-less-pair path every pre-gate resolution took).
        pair = _wds_pair(
            wds_id="06451-1643", components="AB",
            precise_ra_deg=None, precise_dec_deg=None,
        )
        orb6 = [_orb6(wds_id=pair.wds_id, components="AB", hip=32349)]
        idx = _indices(
            hip_to_gaia={32349: 2947050466531873024},
            athyg=[_athyg_row(hip=32349, gaia=2947050466531873024,
                              ra_deg=101.3, dec_deg=-16.7)],
        )
        r = bb.resolve_component(
            pair, "A", is_primary=True,
            orb6_for_pair=orb6, indices=idx,
        )
        self.assertEqual(r.resolve_via, "orb6_hip")

    def test_orb6_hip_trusted_when_hip_position_unknown(self) -> None:
        # HIP has no AT-HYG row and no Gaia astrometry — the gate cannot
        # validate, so it trusts the attribution rather than reject blind.
        pair = _wds_pair(
            wds_id="06451-1643", components="AB",
            precise_ra_deg=101.3, precise_dec_deg=-16.7,
        )
        orb6 = [_orb6(wds_id=pair.wds_id, components="AB", hip=32349)]
        idx = _indices(hip_to_gaia={32349: 2947050466531873024})
        r = bb.resolve_component(
            pair, "A", is_primary=True,
            orb6_for_pair=orb6, indices=idx,
        )
        self.assertEqual(r.resolve_via, "orb6_hip")

    def test_priority_xwalk_beats_athyg(self) -> None:
        # Both tier 1 and the HIP branch of tier 2 would succeed for
        # the same HIP — tier 1 wins because the Gaia HIP xwalk is
        # canonical.
        pair = _wds_pair(components="AB")
        orb6 = [_orb6(wds_id=pair.wds_id, components="AB", hip=10)]
        idx = _indices(
            hip_to_gaia={10: 100},
            athyg=[_athyg_row(hip=10, gaia=999,   # disagreeing AT-HYG
                              ra_deg=pair.precise_ra_deg,
                              dec_deg=pair.precise_dec_deg)],
        )
        r = bb.resolve_component(
            pair, "A", is_primary=True,
            orb6_for_pair=orb6, indices=idx,
        )
        self.assertEqual(r.resolve_via, "orb6_hip")
        self.assertEqual(r.gaia_source_id, 100)


class GroupOrb6ByPairTests(unittest.TestCase):
    def test_strict_components_key(self) -> None:
        ab = _orb6(wds_id="X", components="AB", hip=1)
        ac = _orb6(wds_id="X", components="AC", hip=2)
        sys = _orb6(wds_id="X", components="", hip=3)
        grouped = bb.group_orb6_by_pair([ab, ac, sys])
        self.assertEqual(grouped[("X", "AB")], [ab])
        self.assertEqual(grouped[("X", "AC")], [ac])
        self.assertEqual(grouped[("X", "")], [sys])


class ResolveAllPairsTests(unittest.TestCase):
    def test_pipeline_emits_primary_and_secondary(self) -> None:
        # Primary resolves via ORB6's HIP; secondary has no HIP signal
        # and no SIMBAD side-file passed in, so it falls through to
        # ``unresolved``. The SIMBAD-fed variant is covered below.
        pair = _wds_pair(components="AB")
        orb6 = [_orb6(wds_id=pair.wds_id, components="AB", hip=1)]
        idx = _indices(hip_to_gaia={1: 1001})
        results = bb.resolve_all_pairs(
            pairs=[pair], orb6=orb6, indices=idx, athyg=[],
        )
        self.assertEqual(len(results), 2)
        primary, secondary = results
        self.assertTrue(primary.is_primary)
        self.assertEqual(primary.resolve_via, "orb6_hip")
        self.assertEqual(primary.gaia_source_id, 1001)
        self.assertFalse(secondary.is_primary)
        self.assertEqual(secondary.resolve_via, "unresolved")
        self.assertIsNone(secondary.gaia_source_id)

    def test_skips_system_level_rows(self) -> None:
        pair = _wds_pair(components="")
        idx = _indices()
        results = bb.resolve_all_pairs(
            pairs=[pair], orb6=[], indices=idx, athyg=[],
        )
        self.assertEqual(results, [])

    def test_pipeline_resolves_via_simbad_when_id_signal_absent(self) -> None:
        # Secondary has no ORB6 HIP and no AT-HYG via HIP. SIMBAD's
        # side-file provides the (wds_id, component) → Gaia binding —
        # cascade tags this as ``simbad_xid``.
        pair = _wds_pair(wds_id="00491+5749", components="AB")
        idx = _indices()
        xids = {
            ("00491+5749", "B"): bb.SimbadWdsXid(
                simbad_oid=106493, simbad_main_id="* eta Cas B",
                gaia_source_id=425040000962497792, hip=None,
            ),
        }
        results = bb.resolve_all_pairs(
            pairs=[pair], orb6=[], indices=idx, athyg=[],
            simbad_xids=xids,
        )
        self.assertEqual(len(results), 2)
        primary, secondary = results
        self.assertEqual(primary.resolve_via, "unresolved")
        self.assertEqual(secondary.resolve_via, "simbad_xid")
        self.assertEqual(secondary.gaia_source_id, 425040000962497792)


def _wds_pair_with_pos(
    *, wds_id: str = "14296-6241", components: str = "Ca,Cb",
    precise_ra: float | None = None, precise_dec: float | None = None,
    rho: float | None = None, theta: float | None = None,
) -> "bb.WdsPair":
    return bb.WdsPair(
        wds_id=wds_id, discoverer="TST   1", components=components,
        date_last=None, rho_last=rho, theta_last=theta,
        mag_pri=None, mag_sec=None, spectral="", notes="    ",
        precise_ra_deg=precise_ra, precise_dec_deg=precise_dec,
    )


def _athyg_row_at(
    *, ra: float, dec: float, gaia: int | None,
    hip: int | None = None,
    pm_ra_masyr: float | None = None,
    pm_de_masyr: float | None = None,
) -> "bb.AthygRow":
    return bb.AthygRow(
        hip=hip, tyc=None, gaia=gaia, hd=None,
        ra_deg=ra, dec_deg=dec,
        x_pc=0.0, y_pc=0.0, z_pc=0.0,
        dist_pc=1.0, v_mag=None, absmag=5.0,
        ci=None, spect="", proper="",
        pm_ra_masyr=pm_ra_masyr, pm_de_masyr=pm_de_masyr,
    )


class PositionGeometryTests(unittest.TestCase):
    def test_predict_secondary_due_north(self) -> None:
        # ρ = 3600″ = 1°, θ = 0° → secondary is 1° north of primary.
        ra, dec = bb.predict_secondary_position(
            primary_ra_deg=100.0, primary_dec_deg=0.0,
            rho_arcsec=3600.0, theta_deg=0.0,
        )
        self.assertAlmostEqual(ra, 100.0, places=6)
        self.assertAlmostEqual(dec, 1.0, places=6)

    def test_predict_secondary_due_east(self) -> None:
        # θ = 90° (east), at dec=60° → ra offset is 1°/cos(60°) = 2°.
        ra, dec = bb.predict_secondary_position(
            primary_ra_deg=100.0, primary_dec_deg=60.0,
            rho_arcsec=3600.0, theta_deg=90.0,
        )
        self.assertAlmostEqual(ra, 102.0, places=3)
        self.assertAlmostEqual(dec, 60.0, places=6)


class PositionMatchTests(unittest.TestCase):
    def test_within_tolerance_matches(self) -> None:
        athyg = [_athyg_row_at(ra=100.0, dec=20.0, gaia=42)]
        grid = bb.build_athyg_position_grid(athyg)
        # Query 1″ east of target (≈ 0.000297° at dec=20°). Inside 2″ tol.
        idx = bb.find_nearest_athyg_at_position(
            ra_deg=100.0 + 1.0 / 3600.0 / math.cos(math.radians(20.0)),
            dec_deg=20.0,
            grid=grid, athyg=athyg, tol_arcsec=2.0,
        )
        self.assertEqual(idx, 0)

    def test_outside_tolerance_misses(self) -> None:
        athyg = [_athyg_row_at(ra=100.0, dec=20.0, gaia=42)]
        grid = bb.build_athyg_position_grid(athyg)
        # 5″ east of target — outside 2″ tolerance.
        idx = bb.find_nearest_athyg_at_position(
            ra_deg=100.0 + 5.0 / 3600.0 / math.cos(math.radians(20.0)),
            dec_deg=20.0,
            grid=grid, athyg=athyg, tol_arcsec=2.0,
        )
        self.assertIsNone(idx)

    def test_exclude_idx_skips_known_row(self) -> None:
        # Two AT-HYG rows, both within tolerance — exclude_idx forces
        # the secondary slot to find the OTHER one.
        athyg = [
            _athyg_row_at(ra=100.0, dec=0.0, gaia=10),
            _athyg_row_at(ra=100.0 + 0.0002, dec=0.0, gaia=20),
        ]
        grid = bb.build_athyg_position_grid(athyg)
        idx = bb.find_nearest_athyg_at_position(
            ra_deg=100.0, dec_deg=0.0,
            grid=grid, athyg=athyg, tol_arcsec=2.0,
            exclude_idx=0,
        )
        self.assertEqual(idx, 1)


class ResolveViaPositionTests(unittest.TestCase):
    def test_primary_matches_athyg_when_no_hip_signal(self) -> None:
        pair = _wds_pair_with_pos(
            components="Ca,Cb",
            precise_ra=217.4296, precise_dec=-62.6795,
        )
        # AT-HYG row at the same coordinates with a gaia value.
        athyg = [_athyg_row_at(ra=217.4296, dec=-62.6795, gaia=5853498713190525696)]
        # No HIP signals; tier 1/2/3-by-id all return unresolved.
        components = [
            bb.ResolvedComponent(
                wds_id=pair.wds_id, discoverer=pair.discoverer,
                component="Ca", is_primary=True,
                gaia_source_id=None, resolve_via="unresolved",
            ),
        ]
        bb.resolve_via_position(
            components=components, pairs=[pair], athyg=athyg,
            tolerance_arcsec=2.0,
        )
        self.assertEqual(components[0].resolve_via, "athyg_gaia_native")
        self.assertEqual(components[0].gaia_source_id, 5853498713190525696)

    def test_secondary_resolves_via_predicted_position(self) -> None:
        pair = _wds_pair_with_pos(
            components="AB",
            precise_ra=100.0, precise_dec=0.0,
            rho=360.0, theta=0.0,    # secondary 0.1° north of primary
        )
        athyg = [
            _athyg_row_at(ra=100.0, dec=0.0, gaia=111),       # primary
            _athyg_row_at(ra=100.0, dec=0.1, gaia=222),       # secondary
        ]
        components = [
            bb.ResolvedComponent(
                wds_id=pair.wds_id, discoverer=pair.discoverer,
                component="A", is_primary=True,
                gaia_source_id=None, resolve_via="unresolved",
            ),
            bb.ResolvedComponent(
                wds_id=pair.wds_id, discoverer=pair.discoverer,
                component="B", is_primary=False,
                gaia_source_id=None, resolve_via="unresolved",
            ),
        ]
        bb.resolve_via_position(
            components=components, pairs=[pair], athyg=athyg,
            tolerance_arcsec=2.0,
        )
        self.assertEqual(components[0].gaia_source_id, 111)
        self.assertEqual(components[1].gaia_source_id, 222)
        self.assertEqual(components[1].resolve_via, "athyg_gaia_native")

    def test_skips_resolved_components(self) -> None:
        pair = _wds_pair_with_pos(
            components="AB",
            precise_ra=100.0, precise_dec=0.0,
        )
        athyg = [_athyg_row_at(ra=100.0, dec=0.0, gaia=999)]
        # Component already resolved via tier 1; position pass must leave it.
        c = bb.ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True,
            gaia_source_id=100, resolve_via="orb6_hip",
        )
        bb.resolve_via_position([c], pairs=[pair], athyg=athyg)
        self.assertEqual(c.resolve_via, "orb6_hip")
        self.assertEqual(c.gaia_source_id, 100)

    def test_skips_when_athyg_row_has_no_gaia(self) -> None:
        # The matched AT-HYG row exists but its gaia field is empty —
        # position-match must not invent a value; component stays
        # unresolved.
        pair = _wds_pair_with_pos(
            components="AB",
            precise_ra=100.0, precise_dec=0.0,
        )
        athyg = [_athyg_row_at(ra=100.0, dec=0.0, gaia=None)]
        c = bb.ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        bb.resolve_via_position([c], pairs=[pair], athyg=athyg)
        self.assertEqual(c.resolve_via, "unresolved")
        self.assertIsNone(c.gaia_source_id)

    def test_skips_row_whose_hip_a_disjoint_letter_binds(self) -> None:
        # Rigel-shaped: the BC pair row carries the SYSTEM coordinate,
        # so B's primary match lands on A's AT-HYG row — but A already
        # binds that row's HIP, and A is neither B's lineage nor B's
        # pair partner. Without the claims gate B wears A's identity
        # and photometry.
        pair_bc = _wds_pair_with_pos(
            wds_id="05145-0812", components="BC",
            precise_ra=100.0, precise_dec=0.0,
            rho=0.1, theta=30.0,
        )
        athyg = [_athyg_row_at(ra=100.0, dec=0.0, gaia=555, hip=24436)]
        a_comp = bb.ResolvedComponent(
            wds_id="05145-0812", discoverer=pair_bc.discoverer,
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved", hip=24436,
        )
        b_comp = bb.ResolvedComponent(
            wds_id="05145-0812", discoverer=pair_bc.discoverer,
            component="B", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        stats: dict[str, int] = {}
        bb.resolve_via_position(
            components=[a_comp, b_comp], pairs=[pair_bc], athyg=athyg,
            stats=stats,
        )
        self.assertIsNone(b_comp.hip)
        self.assertIsNone(b_comp.gaia_source_id)
        self.assertEqual(b_comp.resolve_via, "unresolved")
        self.assertEqual(stats["athyg_match_sibling_claimed_rejected"], 1)

    def test_own_claimed_row_still_matches(self) -> None:
        # The matched row's HIP is one the component itself already
        # binds — the claims gate must not block a letter from its own
        # identity.
        pair = _wds_pair_with_pos(
            wds_id="00000+0000", components="AB",
            precise_ra=100.0, precise_dec=0.0,
            rho=0.5, theta=0.0,
        )
        athyg = [_athyg_row_at(ra=100.0, dec=0.0, gaia=555, hip=42)]
        a_comp = bb.ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved", hip=42,
        )
        stats: dict[str, int] = {}
        bb.resolve_via_position(
            components=[a_comp], pairs=[pair], athyg=athyg, stats=stats,
        )
        self.assertEqual(a_comp.gaia_source_id, 555)
        self.assertEqual(a_comp.resolve_via, "athyg_gaia_native")
        self.assertEqual(
            stats.get("athyg_match_sibling_claimed_rejected", 0), 0,
        )


class ResolveViaSimbadTests(unittest.TestCase):
    def test_binds_gaia_and_hip_when_both_present(self) -> None:
        # SIMBAD carries both Gaia DR3 and HIP for the component —
        # bind both, retag ``resolve_via`` to ``simbad_xid``.
        c = bb.ResolvedComponent(
            wds_id="00491+5749", discoverer="STF   60",
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        xids = {
            ("00491+5749", "A"): bb.SimbadWdsXid(
                simbad_oid=106647, simbad_main_id="* eta Cas",
                gaia_source_id=425040000962559616, hip=3821,
            ),
        }
        bb.resolve_via_simbad([c], xids)
        self.assertEqual(c.resolve_via, "simbad_xid")
        self.assertEqual(c.gaia_source_id, 425040000962559616)
        self.assertEqual(c.hip, 3821)

    def test_binds_hip_only_when_gaia_missing(self) -> None:
        # α Cen A-shaped: SIMBAD has the oid + HIP but no Gaia DR3
        # source_id (bright-star saturation gap). HIP must bind so
        # Stage 3's HIP2 fallback engages; resolve_via stays
        # ``unresolved`` so the cascade can keep going.
        c = bb.ResolvedComponent(
            wds_id="14396-6050", discoverer="RHD   1",
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        xids = {
            ("14396-6050", "A"): bb.SimbadWdsXid(
                simbad_oid=3396054, simbad_main_id="* alf Cen A",
                gaia_source_id=None, hip=71683,
            ),
        }
        bb.resolve_via_simbad([c], xids)
        self.assertEqual(c.resolve_via, "unresolved")
        self.assertIsNone(c.gaia_source_id)
        self.assertEqual(c.hip, 71683)

    def test_skips_already_resolved_components(self) -> None:
        # ``orb6_hip`` already bound — SIMBAD pass must not overwrite,
        # even if SIMBAD would have published a different source_id.
        c = bb.ResolvedComponent(
            wds_id="X", discoverer="D", component="A", is_primary=True,
            gaia_source_id=42, resolve_via="orb6_hip", hip=99,
        )
        xids = {
            ("X", "A"): bb.SimbadWdsXid(
                simbad_oid=1, simbad_main_id="other",
                gaia_source_id=999, hip=999,
            ),
        }
        bb.resolve_via_simbad([c], xids)
        self.assertEqual(c.resolve_via, "orb6_hip")
        self.assertEqual(c.gaia_source_id, 42)
        self.assertEqual(c.hip, 99)

    def test_does_not_override_existing_hip(self) -> None:
        # Component carried a HIP forward from ``resolve_component`` —
        # SIMBAD's HIP must NOT clobber it. The two could disagree
        # (e.g. ORB6's HIP for the system vs SIMBAD's per-component
        # suffix); preferring resolve_component's keeps Stage 3's
        # HIP2 routing aligned with the rest of the cascade.
        c = bb.ResolvedComponent(
            wds_id="X", discoverer="D", component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved", hip=32349,
        )
        xids = {
            ("X", "A"): bb.SimbadWdsXid(
                simbad_oid=1, simbad_main_id="other",
                gaia_source_id=None, hip=99,
            ),
        }
        bb.resolve_via_simbad([c], xids)
        self.assertEqual(c.hip, 32349)
        self.assertEqual(c.resolve_via, "unresolved")

    def test_skips_components_not_in_simbad(self) -> None:
        c = bb.ResolvedComponent(
            wds_id="X", discoverer="D", component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        bb.resolve_via_simbad([c], {})
        self.assertEqual(c.resolve_via, "unresolved")
        self.assertIsNone(c.gaia_source_id)
        self.assertIsNone(c.hip)


class ResolveViaCcdmTests(unittest.TestCase):
    """CCDM-anchored sibling-HIP tier. Sits between ``simbad_xid`` and
    ``position_pm`` — restricts the candidate HIP set to CCDM co-system
    rows, position-matches a sibling to the component, then routes the
    bound HIP through the same Gaia xwalk / AT-HYG-native lookups the
    earlier tiers use.
    """

    def _indices_with_ccdm(
        self, *,
        ccdm_rows: list["bb.CcdmRow"],
        athyg: list["bb.AthygRow"] | None = None,
        hip_to_gaia: dict[int, int] | None = None,
    ) -> "bb.IdentifierIndices":
        return bb.build_indices(
            athyg=athyg or [],
            hip2=[],
            hip_to_gaia=hip_to_gaia or {},
            tyc_to_gaia={},
            src_to_nss={},
            ccdm=ccdm_rows,
        )

    def test_secondary_bound_to_ccdm_sibling_via_predicted_pos(self) -> None:
        # α Cen-shaped: ORB6 gave the primary's HIP, the secondary has
        # no per-component identifier, and CCDM lists both HIPs in the
        # same system. The (ρ, θ)-predicted secondary position picks
        # the right sibling HIP out of the candidate set, then the
        # AT-HYG row's natively-stored gaia field surfaces.
        pair = _wds_pair_with_pos(
            wds_id="14396-6050", components="AB",
            precise_ra=100.0, precise_dec=0.0,
            rho=10.0, theta=0.0,    # secondary 10″ north of primary
        )
        athyg = [
            # CCDM sibling 71681 already at the predicted secondary
            # position (no PM needed for this test — separate tests
            # exercise the PM-propagation path explicitly).
            _athyg_row_at(
                ra=100.0, dec=10.0 / 3600.0,
                gaia=5877748442128924544, hip=71681,
            ),
        ]
        ccdm_rows = [
            bb.CcdmRow(hip=71683, ccdm="14396-6050", mult_flag=""),
            bb.CcdmRow(hip=71681, ccdm="14396-6050", mult_flag=""),
        ]
        indices = self._indices_with_ccdm(
            ccdm_rows=ccdm_rows, athyg=athyg,
        )
        primary = bb.ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved", hip=71683,
        )
        secondary = bb.ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="B", is_primary=False,
            gaia_source_id=None, resolve_via="unresolved",
        )
        bb.resolve_via_ccdm(
            components=[primary, secondary], pairs=[pair], indices=indices,
        )
        # Secondary: CCDM sibling 71681 bound and AT-HYG-native gaia surfaces.
        self.assertEqual(secondary.hip, 71681)
        self.assertEqual(secondary.gaia_source_id, 5877748442128924544)
        self.assertEqual(secondary.resolve_via, "ccdm_hip")
        # Primary: already had hip=71683 via SIMBAD/ORB6; CCDM confirms
        # but leaves resolve_via as-is when no Gaia source is reachable.
        self.assertEqual(primary.hip, 71683)
        self.assertIsNone(primary.gaia_source_id)

    def test_primary_bound_from_ccdm_when_position_match_picks_sibling(self) -> None:
        # No HIP on the primary yet — CCDM lists exactly one candidate
        # HIP whose AT-HYG row sits near the WDS precise_coord. CCDM
        # binds the HIP and the Gaia xwalk surfaces the source.
        pair = _wds_pair_with_pos(
            wds_id="00000+0000", components="AB",
            precise_ra=10.0, precise_dec=20.0,
        )
        athyg = [_athyg_row_at(
            ra=10.0, dec=20.0, gaia=None, hip=42,
        )]
        ccdm_rows = [bb.CcdmRow(hip=42, ccdm="00000+0000", mult_flag="")]
        indices = self._indices_with_ccdm(
            ccdm_rows=ccdm_rows, athyg=athyg,
            hip_to_gaia={42: 5000},
        )
        primary = bb.ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        bb.resolve_via_ccdm([primary], pairs=[pair], indices=indices)
        self.assertEqual(primary.hip, 42)
        self.assertEqual(primary.gaia_source_id, 5000)
        self.assertEqual(primary.resolve_via, "ccdm_hip")

    def test_secondary_short_circuits_when_rho_at_overflow(self) -> None:
        # Wide-pair (ρ=999.9″) — predicted-secondary path is degenerate
        # so CCDM's secondary leg refuses to bind whichever sibling
        # happened to sit near the meaningless predicted coord. The
        # primary still binds (overflow only affects secondary path).
        pair = _wds_pair_with_pos(
            wds_id="14396-6050", components="AC",
            precise_ra=219.9021, precise_dec=-60.834,
            rho=999.9, theta=225.0,
        )
        athyg = [
            _athyg_row_at(
                ra=219.9141, dec=-60.83948, gaia=999,
                hip=71681,
            ),
        ]
        ccdm_rows = [
            bb.CcdmRow(hip=71683, ccdm="14396-6050", mult_flag=""),
            bb.CcdmRow(hip=71681, ccdm="14396-6050", mult_flag=""),
        ]
        indices = self._indices_with_ccdm(
            ccdm_rows=ccdm_rows, athyg=athyg,
        )
        secondary = bb.ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="C", is_primary=False,
            gaia_source_id=None, resolve_via="unresolved",
        )
        bb.resolve_via_ccdm([secondary], pairs=[pair], indices=indices)
        # No binding: 999.9 sentinel short-circuits the prediction.
        self.assertIsNone(secondary.gaia_source_id)
        self.assertIsNone(secondary.hip)

    def test_sibling_owned_candidate_rejected_for_disjoint_letter(self) -> None:
        # Rigel-shaped: the BC pair's precise coord sits 9.4″ from
        # HIP 24436 (= A), inside the 10″ tolerance, but A's own letter
        # position is essentially ON the HIP's AT-HYG row — the
        # candidate is A's identity and must bind to neither B nor C.
        pair_ab = _wds_pair_with_pos(
            wds_id="05145-0812", components="AB",
            precise_ra=100.0, precise_dec=0.0,
            rho=9.4, theta=180.0,
        )
        pair_bc = _wds_pair_with_pos(
            wds_id="05145-0812", components="BC",
            precise_ra=100.0, precise_dec=-9.4 / 3600.0,
            rho=0.1, theta=30.0,
        )
        athyg = [_athyg_row_at(ra=100.0, dec=0.0, gaia=None, hip=24436)]
        ccdm_rows = [bb.CcdmRow(hip=24436, ccdm="05145-0812", mult_flag="")]
        indices = self._indices_with_ccdm(
            ccdm_rows=ccdm_rows, athyg=athyg,
            hip_to_gaia={24436: 7777},
        )
        b_primary = bb.ResolvedComponent(
            wds_id=pair_bc.wds_id, discoverer=pair_bc.discoverer,
            component="B", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        c_secondary = bb.ResolvedComponent(
            wds_id=pair_bc.wds_id, discoverer=pair_bc.discoverer,
            component="C", is_primary=False,
            gaia_source_id=None, resolve_via="unresolved",
        )
        stats: dict[str, int] = {}
        bb.resolve_via_ccdm(
            components=[b_primary, c_secondary],
            pairs=[pair_ab, pair_bc], indices=indices, stats=stats,
        )
        self.assertIsNone(b_primary.hip)
        self.assertIsNone(b_primary.gaia_source_id)
        self.assertEqual(b_primary.resolve_via, "unresolved")
        self.assertIsNone(c_secondary.hip)
        self.assertIsNone(c_secondary.gaia_source_id)
        self.assertEqual(stats["ccdm_sibling_owned_rejected"], 2)

    def test_partner_letter_never_rejects(self) -> None:
        # σ Ori-shaped blend convention: the candidate sits nearer the
        # PAIR PARTNER's position (A, 1.2″) than the secondary being
        # resolved (B, 0.8″). Partner sharing is the WDS blend
        # convention, so the binding stands.
        pair = _wds_pair_with_pos(
            wds_id="00000+0000", components="AB",
            precise_ra=100.0, precise_dec=0.0,
            rho=2.0, theta=180.0,
        )
        athyg = [_athyg_row_at(
            ra=100.0, dec=-1.2 / 3600.0, gaia=None, hip=99,
        )]
        ccdm_rows = [bb.CcdmRow(hip=99, ccdm="00000+0000", mult_flag="")]
        indices = self._indices_with_ccdm(ccdm_rows=ccdm_rows, athyg=athyg)
        secondary = bb.ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="B", is_primary=False,
            gaia_source_id=None, resolve_via="unresolved",
        )
        stats: dict[str, int] = {}
        bb.resolve_via_ccdm(
            components=[secondary], pairs=[pair], indices=indices,
            stats=stats,
        )
        self.assertEqual(secondary.hip, 99)
        self.assertEqual(stats.get("ccdm_sibling_owned_rejected", 0), 0)

    def test_near_tie_non_partner_sibling_does_not_reject(self) -> None:
        # The candidate sits at comparable distances from the query
        # letter C (0.2″) and the non-partner letter B (0.2″) — inside
        # the 2× decisiveness ratio, so ownership is ambiguous and the
        # nearest-candidate binding stands.
        pair_ab = _wds_pair_with_pos(
            wds_id="00000+0000", components="AB",
            precise_ra=100.0, precise_dec=0.0,
            rho=2.0, theta=180.0,
        )
        pair_ac = _wds_pair_with_pos(
            wds_id="00000+0000", components="AC",
            precise_ra=100.0, precise_dec=0.0,
            rho=2.4, theta=180.0,
        )
        athyg = [_athyg_row_at(
            ra=100.0, dec=-2.2 / 3600.0, gaia=None, hip=99,
        )]
        ccdm_rows = [bb.CcdmRow(hip=99, ccdm="00000+0000", mult_flag="")]
        indices = self._indices_with_ccdm(ccdm_rows=ccdm_rows, athyg=athyg)
        secondary = bb.ResolvedComponent(
            wds_id=pair_ac.wds_id, discoverer=pair_ac.discoverer,
            component="C", is_primary=False,
            gaia_source_id=None, resolve_via="unresolved",
        )
        stats: dict[str, int] = {}
        bb.resolve_via_ccdm(
            components=[secondary], pairs=[pair_ab, pair_ac],
            indices=indices, stats=stats,
        )
        self.assertEqual(secondary.hip, 99)
        self.assertEqual(stats.get("ccdm_sibling_owned_rejected", 0), 0)

    def test_claimed_hip_rejected_even_at_system_coordinate(self) -> None:
        # The real Rigel shape: WDS stamps the BC pair row with the
        # SYSTEM coordinate, so geometry places the candidate ON the
        # query letter — but A already binds the HIP (SIMBAD xid), and
        # a non-partner letter's HIP is another star's identity.
        pair_a_bc = _wds_pair_with_pos(
            wds_id="05145-0812", components="A,BC",
            precise_ra=100.0, precise_dec=0.0,
            rho=9.4, theta=204.0,
        )
        pair_bc = _wds_pair_with_pos(
            wds_id="05145-0812", components="BC",
            precise_ra=100.0, precise_dec=0.0,
            rho=0.1, theta=30.0,
        )
        athyg = [_athyg_row_at(ra=100.0, dec=0.0, gaia=None, hip=24436)]
        ccdm_rows = [bb.CcdmRow(hip=24436, ccdm="05145-0812", mult_flag="")]
        indices = self._indices_with_ccdm(
            ccdm_rows=ccdm_rows, athyg=athyg,
            hip_to_gaia={24436: 7777},
        )
        a_primary = bb.ResolvedComponent(
            wds_id=pair_a_bc.wds_id, discoverer=pair_a_bc.discoverer,
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved", hip=24436,
        )
        b_primary = bb.ResolvedComponent(
            wds_id=pair_bc.wds_id, discoverer=pair_bc.discoverer,
            component="B", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        stats: dict[str, int] = {}
        bb.resolve_via_ccdm(
            components=[a_primary, b_primary],
            pairs=[pair_a_bc, pair_bc], indices=indices, stats=stats,
        )
        self.assertIsNone(b_primary.hip)
        self.assertIsNone(b_primary.gaia_source_id)
        self.assertEqual(stats["ccdm_sibling_owned_rejected"], 1)

    def test_letter_positions_prefer_primary_slot_over_predicted(self) -> None:
        pair_ab = _wds_pair_with_pos(
            wds_id="05145-0812", components="AB",
            precise_ra=100.0, precise_dec=0.0,
            rho=9.4, theta=180.0,
        )
        pair_bc = _wds_pair_with_pos(
            wds_id="05145-0812", components="BC",
            precise_ra=100.0, precise_dec=-9.5 / 3600.0,
            rho=0.1, theta=30.0,
        )
        positions = bb.build_system_letter_positions([pair_ab, pair_bc])
        letters = positions["05145-0812"]
        # B was first recorded from AB's (ρ, θ) prediction, then
        # upgraded to BC's measured primary-slot coord.
        self.assertEqual(letters["B"], (100.0, -9.5 / 3600.0))
        self.assertEqual(letters["A"], (100.0, 0.0))
        self.assertIn("C", letters)

    def test_skips_systems_with_no_ccdm_candidates(self) -> None:
        pair = _wds_pair_with_pos(
            wds_id="UNKNOWN", components="AB",
            precise_ra=0.0, precise_dec=0.0,
        )
        indices = self._indices_with_ccdm(ccdm_rows=[])
        c = bb.ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        bb.resolve_via_ccdm([c], pairs=[pair], indices=indices)
        self.assertEqual(c.resolve_via, "unresolved")
        self.assertIsNone(c.gaia_source_id)

    def test_primary_match_pm_propagates_high_pm_sibling(self) -> None:
        # CCDM sibling's AT-HYG row is stored at J1991.25-effective
        # (high-PM HIP-sourced row). The PM-propagation step inside
        # the candidate-position check brings the sibling's J2000
        # position within the 10″ tolerance — without it the sibling
        # is 33″ off from the WDS J2000 precise_coord and the bind
        # would silently miss.
        pair = _wds_pair_with_pos(
            wds_id="00000+0000", components="AB",
            precise_ra=100.0, precise_dec=0.0,
        )
        # Stored ra is 30″ east of WDS precise — the propagation should
        # walk it west by ~30″ using the row's PM over 8.75 yr.
        # 30″ over 8.75 yr at dec=0 ⇒ pm_ra = -30/8.75 * 1000 ≈ -3428.6 mas/yr
        athyg = [_athyg_row_at(
            ra=100.0 + 30.0 / 3600.0, dec=0.0,
            gaia=None, hip=42,
            pm_ra_masyr=-3428.6, pm_de_masyr=0.0,
        )]
        ccdm_rows = [bb.CcdmRow(hip=42, ccdm="00000+0000", mult_flag="")]
        indices = self._indices_with_ccdm(
            ccdm_rows=ccdm_rows, athyg=athyg,
            hip_to_gaia={42: 5000},
        )
        c = bb.ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        bb.resolve_via_ccdm([c], pairs=[pair], indices=indices)
        self.assertEqual(c.hip, 42)
        self.assertEqual(c.gaia_source_id, 5000)
        self.assertEqual(c.resolve_via, "ccdm_hip")

    def test_primary_prefers_existing_hip_over_position_match(self) -> None:
        # When the component already carries a HIP (from ORB6/SIMBAD)
        # AND that HIP is in the CCDM sibling list, the tier reuses it
        # rather than competing with a position-match. Position-match
        # could pick a sibling at a stale-position AT-HYG row that
        # coincidentally sits closer; the carried-forward HIP is the
        # stronger evidence.
        pair = _wds_pair_with_pos(
            wds_id="00000+0000", components="AB",
            precise_ra=100.0, precise_dec=0.0,
        )
        athyg = [
            _athyg_row_at(ra=100.0, dec=0.0, gaia=8000, hip=8),
            _athyg_row_at(ra=100.0, dec=0.0, gaia=9000, hip=9),
        ]
        ccdm_rows = [
            bb.CcdmRow(hip=8, ccdm="00000+0000", mult_flag=""),
            bb.CcdmRow(hip=9, ccdm="00000+0000", mult_flag=""),
        ]
        indices = self._indices_with_ccdm(
            ccdm_rows=ccdm_rows, athyg=athyg,
        )
        primary = bb.ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved", hip=9,
        )
        bb.resolve_via_ccdm([primary], pairs=[pair], indices=indices)
        self.assertEqual(primary.hip, 9)
        self.assertEqual(primary.gaia_source_id, 9000)
        self.assertEqual(primary.resolve_via, "ccdm_hip")


class AthygPositionAtEpochTests(unittest.TestCase):
    """``_athyg_position_at_epoch`` PM-propagates a row from
    ``ATHYG_REFERENCE_EPOCH`` (J1991.25) to the target epoch using its
    own PM. The 8.75-yr propagation reconciles HIP-sourced AT-HYG rows
    (stored at J1991.25) with WDS precise_coord (J2000).
    """

    def test_high_pm_alpha_cen_a_propagates_to_j2000(self) -> None:
        # α Cen A: AT-HYG ra=219.92041 is HIP1's J1991.25 native RA.
        # Propagating forward by 8.75 yr using PM should land on the
        # J2000 ra ≈ 219.9020, which is what WDS precise_coord stores.
        row = _athyg_row_at(
            ra=219.92041, dec=-60.83515, gaia=None, hip=71683,
            pm_ra_masyr=-3678.19, pm_de_masyr=481.84,
        )
        ra_j2000, dec_j2000 = bb._athyg_position_at_epoch(
            row, target_epoch=bb.WDS_PRECISE_COORD_EPOCH,
        )
        # WDS precise_coord for α Cen RHD 1 AB is 219.9021, -60.8340.
        self.assertAlmostEqual(ra_j2000, 219.9021, places=3)
        self.assertAlmostEqual(dec_j2000, -60.8340, places=3)

    def test_zero_pm_row_is_unchanged(self) -> None:
        row = _athyg_row_at(
            ra=100.0, dec=20.0, gaia=None,
            pm_ra_masyr=None, pm_de_masyr=None,
        )
        ra, dec = bb._athyg_position_at_epoch(row, target_epoch=2000.0)
        self.assertEqual(ra, 100.0)
        self.assertEqual(dec, 20.0)

    def test_low_pm_row_drifts_well_below_tolerance(self) -> None:
        # 10 mas/yr · 8.75 yr = 87.5 mas = 0.0875″ — far below the 2″
        # position-match tolerance, so the propagation is a no-op for
        # rows that AT-HYG already stores at J2000.
        row = _athyg_row_at(
            ra=100.0, dec=0.0, gaia=None,
            pm_ra_masyr=10.0, pm_de_masyr=10.0,
        )
        ra, dec = bb._athyg_position_at_epoch(row, target_epoch=2000.0)
        self.assertLess(abs(ra - 100.0) * 3600.0, 0.5)
        self.assertLess(abs(dec - 0.0) * 3600.0, 0.5)


class PropagatePositionTests(unittest.TestCase):
    """``_propagate_position`` is the shared PM-propagation core behind
    both the AT-HYG (J1991.25) and Gaia (J2016.0) branches of the
    ORB6-HIP coordinate gate — each is brought to the WDS J2000 frame
    before comparison.
    """

    def test_gaia_epoch_propagates_backward_to_j2000(self) -> None:
        # J2016 → J2000 is a 16-yr BACKWARD step (dt < 0), so the
        # position moves opposite the PM. 3600 mas/yr · -16 yr = -0.016°.
        ra, dec = bb._propagate_position(
            100.0, 0.0, 3600.0, 0.0,
            ref_epoch=2016.0, target_epoch=bb.WDS_PRECISE_COORD_EPOCH,
        )
        self.assertAlmostEqual(ra, 99.984, places=6)
        self.assertAlmostEqual(dec, 0.0, places=9)

    def test_missing_pm_returns_position_unchanged(self) -> None:
        ra, dec = bb._propagate_position(
            100.0, 20.0, None, None,
            ref_epoch=2016.0, target_epoch=2000.0,
        )
        self.assertEqual(ra, 100.0)
        self.assertEqual(dec, 20.0)


class PositionMatchPMPropagationTests(unittest.TestCase):
    """``resolve_via_position`` PM-propagates AT-HYG rows to
    ``WDS_PRECISE_COORD_EPOCH`` before the 2″ comparison so high-PM
    HIP-sourced rows (α Cen A, Sirius A) still match.
    """

    def test_alpha_cen_a_resolves_with_pm_propagation(self) -> None:
        # WDS precise_coord = J2000 (219.9021, -60.834). AT-HYG stores
        # HIP-sourced positions at J1991.25 (219.92041, -60.83515) —
        # 66″ from WDS precise in raw RA. Without PM-propagation the
        # 2″ tolerance misses; with it the match fires.
        pair = _wds_pair_with_pos(
            wds_id="14396-6050", components="AB",
            precise_ra=219.9021, precise_dec=-60.834,
        )
        athyg = [_athyg_row_at(
            ra=219.92041, dec=-60.83515,
            gaia=5877748442128924544, hip=71683,
            pm_ra_masyr=-3678.19, pm_de_masyr=481.84,
        )]
        c = bb.ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        bb.resolve_via_position(
            components=[c], pairs=[pair], athyg=athyg,
            tolerance_arcsec=2.0,
        )
        self.assertEqual(c.gaia_source_id, 5877748442128924544)
        self.assertEqual(c.hip, 71683)
        self.assertEqual(c.resolve_via, "athyg_gaia_native")

    def test_secondary_short_circuits_at_wds_overflow_sentinel(self) -> None:
        # ρ ≥ 999.9″ — the (ρ, θ) prediction is meaningless. The
        # secondary leg refuses to predict so it can't bind whichever
        # AT-HYG row happens to sit near the spurious coord.
        pair = _wds_pair_with_pos(
            wds_id="X", components="AC",
            precise_ra=100.0, precise_dec=0.0,
            rho=999.9, theta=225.0,
        )
        athyg = [
            # An AT-HYG row 0.05° south-west of the primary — would
            # match the predicted secondary coord without the overflow
            # check. The point of the check is that this match is
            # spurious for wide-pair systems.
            _athyg_row_at(ra=99.96, dec=-0.04, gaia=777),
        ]
        c = bb.ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="C", is_primary=False,
            gaia_source_id=None, resolve_via="unresolved",
        )
        bb.resolve_via_position(
            components=[c], pairs=[pair], athyg=athyg,
            tolerance_arcsec=2.0,
        )
        self.assertEqual(c.resolve_via, "unresolved")
        self.assertIsNone(c.gaia_source_id)


class PropagateWithinSystemTests(unittest.TestCase):
    def test_inherits_letter_binding_across_pairs(self) -> None:
        # Component "A" of system X resolved in pair "AB". The same
        # letter as primary of pair "AC" must inherit the binding.
        ab_a = bb.ResolvedComponent(
            wds_id="X", discoverer="DA", component="A", is_primary=True,
            gaia_source_id=42, resolve_via="orb6_hip",
        )
        ac_a = bb.ResolvedComponent(
            wds_id="X", discoverer="DA", component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        ac_c = bb.ResolvedComponent(
            wds_id="X", discoverer="DA", component="C", is_primary=False,
            gaia_source_id=None, resolve_via="unresolved",
        )
        components = [ab_a, ac_a, ac_c]
        bb.propagate_within_system(components)
        self.assertEqual(ac_a.gaia_source_id, 42)
        self.assertEqual(ac_a.resolve_via, "orb6_hip")
        # Unrelated letter "C" must stay unresolved.
        self.assertIsNone(ac_c.gaia_source_id)

    def test_does_not_cross_systems(self) -> None:
        # Same letter "A" but different wds_id → no propagation.
        x_a = bb.ResolvedComponent(
            wds_id="X", discoverer="D", component="A", is_primary=True,
            gaia_source_id=100, resolve_via="orb6_hip",
        )
        y_a = bb.ResolvedComponent(
            wds_id="Y", discoverer="D", component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        bb.propagate_within_system([x_a, y_a])
        self.assertIsNone(y_a.gaia_source_id)

    def test_priority_aware_tag_when_letters_tie(self) -> None:
        # Three rows share (X, "A"): simbad_xid iterates first, orb6_hip
        # second, then an unresolved A. The OLD setdefault-based code
        # would surface simbad_xid for the propagated tag because it
        # claimed the slot first; priority-aware selection must surface
        # orb6_hip (the stronger tier per RESOLVE_VIA_PRIORITY) and
        # propagate that tag onto the unresolved entry. The
        # gaia_source_id is identical across rows by construction —
        # same letter / same physical star — only the tag differs.
        simbad_first = bb.ResolvedComponent(
            wds_id="X", discoverer="DA", component="A", is_primary=True,
            gaia_source_id=42, resolve_via="simbad_xid",
        )
        orb6_later = bb.ResolvedComponent(
            wds_id="X", discoverer="DB", component="A", is_primary=True,
            gaia_source_id=42, resolve_via="orb6_hip",
        )
        unresolved_a = bb.ResolvedComponent(
            wds_id="X", discoverer="DC", component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        bb.propagate_within_system([simbad_first, orb6_later, unresolved_a])
        self.assertEqual(unresolved_a.gaia_source_id, 42)
        self.assertEqual(unresolved_a.resolve_via, "orb6_hip")
        # The directly-resolved rows keep the tag they entered with —
        # propagation never rewrites an already-resolved row.
        self.assertEqual(simbad_first.resolve_via, "simbad_xid")
        self.assertEqual(orb6_later.resolve_via, "orb6_hip")

    def test_bare_letter_inherits_from_subcomponent(self) -> None:
        # Castor-shaped: ``CIA 29 Aa`` resolves via SIMBAD to a Gaia
        # source. ``STF1110 A`` (the same physical star at a different
        # WDS sub-component granularity) starts unresolved and must
        # inherit ``Aa``'s binding. Gaia rarely resolves sub-arcsec
        # subcomponents — A, Aa, Ab share one Gaia source whose centroid
        # sits at the brighter Aa.
        aa = bb.ResolvedComponent(
            wds_id="07346+3153", discoverer="CIA  29",
            component="Aa", is_primary=True,
            gaia_source_id=1234, resolve_via="simbad_xid",
            hip=36850,
        )
        a = bb.ResolvedComponent(
            wds_id="07346+3153", discoverer="STF1110",
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        bb.propagate_within_system([aa, a])
        self.assertEqual(a.gaia_source_id, 1234)
        self.assertEqual(a.resolve_via, "simbad_xid")
        self.assertEqual(a.hip, 36850)

    def test_subcomponent_does_not_inherit_from_parent(self) -> None:
        # Reverse direction is intentionally NOT propagated — ``A`` is
        # a coarser slot and may not match the brighter ``Aa``'s source
        # if a future pipeline resolved ``Aa`` and ``Ab`` separately.
        a = bb.ResolvedComponent(
            wds_id="X", discoverer="DA", component="A", is_primary=True,
            gaia_source_id=42, resolve_via="orb6_hip",
        )
        aa = bb.ResolvedComponent(
            wds_id="X", discoverer="DB", component="Aa", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        bb.propagate_within_system([a, aa])
        self.assertIsNone(aa.gaia_source_id)

    def test_subcomponent_inheritance_respects_priority(self) -> None:
        # Two subcomponents resolve A — Aa via ``simbad_xid`` and Ab
        # via ``orb6_hip``. The bare ``A`` inherits the higher-priority
        # tag (``orb6_hip``) per RESOLVE_VIA_PRIORITY.
        aa = bb.ResolvedComponent(
            wds_id="X", discoverer="D1", component="Aa", is_primary=True,
            gaia_source_id=42, resolve_via="simbad_xid",
        )
        ab = bb.ResolvedComponent(
            wds_id="X", discoverer="D2", component="Ab", is_primary=False,
            gaia_source_id=42, resolve_via="orb6_hip",
        )
        bare_a = bb.ResolvedComponent(
            wds_id="X", discoverer="D3", component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        bb.propagate_within_system([aa, ab, bare_a])
        self.assertEqual(bare_a.gaia_source_id, 42)
        self.assertEqual(bare_a.resolve_via, "orb6_hip")


class ResolutionCountsTests(unittest.TestCase):
    def test_every_canonical_key_present(self) -> None:
        comps = [
            bb.ResolvedComponent(
                wds_id="X", discoverer="D", component="A", is_primary=True,
                gaia_source_id=1, resolve_via="orb6_hip",
            ),
            bb.ResolvedComponent(
                wds_id="X", discoverer="D", component="B", is_primary=False,
                gaia_source_id=None, resolve_via="unresolved",
            ),
        ]
        counts = bb.resolution_counts(comps)
        # All keys present (zeros for absent strategies), totals match.
        self.assertEqual(set(counts.keys()), set(bb.RESOLVE_VIA_VALUES))
        self.assertEqual(counts["orb6_hip"], 1)
        self.assertEqual(counts["unresolved"], 1)
        self.assertEqual(counts["position_pm"], 0)


class AstrometryRequestTests(unittest.TestCase):
    def test_dedupes_and_skips_unresolved(self) -> None:
        comps = [
            bb.ResolvedComponent(
                wds_id="X", discoverer="D", component="A", is_primary=True,
                gaia_source_id=222, resolve_via="orb6_hip",
            ),
            bb.ResolvedComponent(
                wds_id="X", discoverer="D", component="B", is_primary=False,
                gaia_source_id=111, resolve_via="athyg_gaia_native",
            ),
            bb.ResolvedComponent(
                wds_id="Y", discoverer="D", component="A", is_primary=True,
                gaia_source_id=222, resolve_via="athyg_gaia_native",
            ),
            bb.ResolvedComponent(
                wds_id="Z", discoverer="D", component="A", is_primary=True,
                gaia_source_id=None, resolve_via="unresolved",
            ),
        ]
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "request.tsv"
            n = bb.write_astrometry_request(comps, p)
            body = p.read_text().splitlines()
        self.assertEqual(n, 2)
        # Header + sorted unique ids; unresolved row contributes nothing.
        self.assertEqual(body, ["gaia_source_id", "111", "222"])

        # Magnitude-gate-rejected candidates stay in the request: the
        # gate can only keep rejecting a binding whose G is in the pull.
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "request.tsv"
            n = bb.write_astrometry_request(
                comps, p, rejected_source_ids=[333, 111],
            )
            body = p.read_text().splitlines()
        self.assertEqual(n, 3)
        self.assertEqual(body, ["gaia_source_id", "111", "222", "333"])


class BuildIndicesTests(unittest.TestCase):
    def _row(
        self, *, hip: int | None = None,
        tyc: str | None = None, gaia: int | None = None,
    ) -> "bb.AthygRow":
        return bb.AthygRow(
            hip=hip, tyc=tyc, gaia=gaia, hd=None,
            ra_deg=0.0, dec_deg=0.0,
            x_pc=0.0, y_pc=0.0, z_pc=0.0,
            dist_pc=1.0, v_mag=None, absmag=5.0,
            ci=None, spect="", proper="",
            pm_ra_masyr=None, pm_de_masyr=None,
        )

    def test_three_athyg_views(self) -> None:
        athyg = [
            self._row(hip=1, tyc="100-1-1", gaia=111),
            self._row(hip=2, tyc=None, gaia=222),
            self._row(hip=None, tyc="200-2-1", gaia=None),
        ]
        idx = bb.build_indices(
            athyg=athyg, hip2=[],
            hip_to_gaia={1: 999}, tyc_to_gaia={"100-1-1": 998},
            src_to_nss={111: {"period": "10.0"}},
        )
        self.assertEqual(set(idx.hip_to_athyg.keys()), {1, 2})
        self.assertEqual(set(idx.tyc_to_athyg.keys()), {"100-1-1", "200-2-1"})
        self.assertEqual(set(idx.src_to_athyg.keys()), {111, 222})
        self.assertEqual(idx.hip_to_gaia, {1: 999})
        self.assertEqual(idx.tyc_to_gaia, {"100-1-1": 998})
        self.assertEqual(idx.src_to_nss[111]["period"], "10.0")
        # Empty astrometry index when no Gaia astrometry passed.
        self.assertEqual(idx.src_to_astrometry, {})

    def test_src_to_hip_inverts_hip_to_gaia(self) -> None:
        idx = bb.build_indices(
            athyg=[], hip2=[],
            hip_to_gaia={1: 100, 2: 200, 3: 300},
            tyc_to_gaia={}, src_to_nss={},
        )
        self.assertEqual(idx.src_to_hip, {100: 1, 200: 2, 300: 3})

    def test_src_to_hip_collision_keeps_first(self) -> None:
        # Tight systems can map two HIPs to one Gaia source. Either HIP
        # is fine for HIP2 lookup; pick the first deterministically.
        idx = bb.build_indices(
            athyg=[], hip2=[],
            hip_to_gaia={1: 100, 2: 100},
            tyc_to_gaia={}, src_to_nss={},
        )
        # dict iteration order is insertion order in CPython 3.7+.
        self.assertIn(idx.src_to_hip[100], {1, 2})

    def test_src_to_astrometry_surfaced(self) -> None:
        row = _gaia_astrometry_row(source_id=42, ruwe=0.9)
        idx = bb.build_indices(
            athyg=[], hip2=[],
            hip_to_gaia={}, tyc_to_gaia={}, src_to_nss={},
            src_to_astrometry={42: row},
        )
        self.assertEqual(idx.src_to_astrometry[42].ruwe, 0.9)

    def test_ccdm_maps_aggregate_siblings(self) -> None:
        # α Cen-shaped: three HIPs (71683 A, 71681 B, 70890 C) all map
        # to CCDM 14396-6050. The forward map keys per-HIP; the reverse
        # map gives the full sibling list keyed by CCDM identifier.
        ccdm_rows = [
            bb.CcdmRow(hip=71683, ccdm="14396-6050", mult_flag=""),
            bb.CcdmRow(hip=71681, ccdm="14396-6050", mult_flag=""),
            bb.CcdmRow(hip=70890, ccdm="14396-6050", mult_flag=""),
            # Empty CCDM identifier is dropped from both maps.
            bb.CcdmRow(hip=99999, ccdm="", mult_flag="O"),
        ]
        idx = bb.build_indices(
            athyg=[], hip2=[],
            hip_to_gaia={}, tyc_to_gaia={}, src_to_nss={},
            ccdm=ccdm_rows,
        )
        self.assertEqual(idx.hip_to_ccdm[71683], "14396-6050")
        self.assertEqual(
            sorted(idx.ccdm_to_hips["14396-6050"]),
            [70890, 71681, 71683],
        )
        self.assertNotIn(99999, idx.hip_to_ccdm)
        self.assertNotIn("", idx.ccdm_to_hips)


class ResolveViaCanonicalKeysTests(unittest.TestCase):
    """``RESOLVE_VIA_VALUES`` is the canonical priority list every tier
    label is keyed off. ``ccdm_hip`` sits between ``simbad_xid`` and
    ``position_pm``.
    """

    def test_ccdm_hip_present_and_above_position_tiers(self) -> None:
        values = bb.RESOLVE_VIA_VALUES
        self.assertIn("ccdm_hip", values)
        self.assertLess(
            values.index("simbad_xid"),
            values.index("ccdm_hip"),
        )
        self.assertLess(
            values.index("ccdm_hip"),
            values.index("position_pm"),
        )

    def test_priority_dict_matches_values_tuple(self) -> None:
        self.assertEqual(
            bb.RESOLVE_VIA_PRIORITY,
            {tag: i for i, tag in enumerate(bb.RESOLVE_VIA_VALUES)},
        )


# ─── Stage 3 fixtures + tests ────────────────────────────────────────


def _gaia_astrometry_row(
    *,
    source_id: int = 100,
    ra_deg: float = 100.0, dec_deg: float = 0.0,
    parallax_mas: float | None = 10.0,
    parallax_error_mas: float | None = 0.05,
    pmra_masyr: float | None = 1.0,
    pmra_error_masyr: float | None = 0.05,
    pmdec_masyr: float | None = -1.0,
    pmdec_error_masyr: float | None = 0.05,
    ref_epoch: float = 2016.0,
    ruwe: float | None = 1.0,
    ipd_frac_multi_peak: float | None = 0.0,
    g_mag: float | None = None,
    bp_mag: float | None = None,
    rp_mag: float | None = None,
) -> "bb.GaiaAstrometryRow":
    return bb.GaiaAstrometryRow(
        source_id=source_id,
        ra_deg=ra_deg, dec_deg=dec_deg,
        parallax_mas=parallax_mas,
        parallax_error_mas=parallax_error_mas,
        pmra_masyr=pmra_masyr, pmra_error_masyr=pmra_error_masyr,
        pmdec_masyr=pmdec_masyr, pmdec_error_masyr=pmdec_error_masyr,
        ref_epoch=ref_epoch,
        ruwe=ruwe, ipd_frac_multi_peak=ipd_frac_multi_peak,
        g_mag=g_mag, bp_mag=bp_mag, rp_mag=rp_mag,
    )


def _hip2_row(
    *,
    hip: int,
    pm_ra_masyr: float | None = 1.0,
    pm_de_masyr: float | None = -1.0,
    plx_mas: float | None = 10.0,
    ra_deg: float = 100.0, dec_deg: float = 0.0,
) -> "bb.Hip2Row":
    return bb.Hip2Row(
        hip=hip,
        ra_deg=ra_deg, dec_deg=dec_deg,
        plx_mas=plx_mas, e_plx_mas=None,
        pm_ra_masyr=pm_ra_masyr, pm_de_masyr=pm_de_masyr,
        e_pm_ra_masyr=None, e_pm_de_masyr=None,
        goodness_of_fit=None, n_transits=None,
    )


def _resolved(
    *,
    gaia: int | None,
    wds_id: str = "WDS-1", discoverer: str = "TST   1",
    component: str = "A", is_primary: bool = True,
    via: str = "orb6_hip",
    hip: int | None = None,
    hd: int | None = None,
) -> "bb.ResolvedComponent":
    return bb.ResolvedComponent(
        wds_id=wds_id, discoverer=discoverer,
        component=component, is_primary=is_primary,
        gaia_source_id=gaia, resolve_via=via,
        hip=hip, hd=hd,
    )


def _indices_with_astrometry(
    *,
    src_to_astrometry: dict[int, "bb.GaiaAstrometryRow"] | None = None,
    src_to_nss: dict[int, dict[str, str]] | None = None,
    hip_to_gaia: dict[int, int] | None = None,
    hip2: list["bb.Hip2Row"] | None = None,
    athyg: list["bb.AthygRow"] | None = None,
    simbad_wds_spectra: dict[tuple[str, str], str] | None = None,
) -> "bb.IdentifierIndices":
    return bb.build_indices(
        athyg=athyg or [], hip2=hip2 or [],
        hip_to_gaia=hip_to_gaia or {},
        tyc_to_gaia={},
        src_to_nss=src_to_nss or {},
        src_to_astrometry=src_to_astrometry or {},
        simbad_wds_spectra=simbad_wds_spectra or {},
    )


class GaiaBindingMagnitudeGateTests(unittest.TestCase):
    """build_indices' one-sided G-vs-V consistency gate on HIP-anchored
    Gaia bindings (xwalk rows and AT-HYG gaia cells)."""

    def test_xwalk_binding_fainter_than_v_is_rejected(self) -> None:
        # Castor A shape: the V=1.58 star bound to the companion's
        # G=2.92 source — past any physical G−V.
        athyg = [_athyg_row(hip=36850, v_mag=1.58)]
        astro = {892: _gaia_astrometry_row(source_id=892, g_mag=2.92)}
        idx = _indices_with_astrometry(
            athyg=athyg, hip_to_gaia={36850: 892}, src_to_astrometry=astro,
        )
        self.assertNotIn(36850, idx.hip_to_gaia)
        self.assertNotIn(892, idx.src_to_hip)
        self.assertEqual(idx.xwalk_mag_rejected, [(36850, 892)])

    def test_xwalk_binding_within_blend_ceiling_is_kept(self) -> None:
        # ζ Sgr shape: +0.65 — inside the equal-pair blend ceiling.
        athyg = [_athyg_row(hip=93506, v_mag=2.60)]
        astro = {77: _gaia_astrometry_row(source_id=77, g_mag=3.25)}
        idx = _indices_with_astrometry(
            athyg=athyg, hip_to_gaia={93506: 77}, src_to_astrometry=astro,
        )
        self.assertEqual(idx.hip_to_gaia.get(93506), 77)
        self.assertEqual(idx.xwalk_mag_rejected, [])

    def test_red_star_brighter_g_is_kept(self) -> None:
        # G brighter than V is the normal red-star regime — the gate is
        # one-sided and must never fire on it.
        athyg = [_athyg_row(hip=1, v_mag=8.0)]
        astro = {5: _gaia_astrometry_row(source_id=5, g_mag=6.0)}
        idx = _indices_with_astrometry(
            athyg=athyg, hip_to_gaia={1: 5}, src_to_astrometry=astro,
        )
        self.assertEqual(idx.hip_to_gaia.get(1), 5)

    def test_unverifiable_bindings_are_trusted(self) -> None:
        # Missing V, source absent from the astrometry pull, or missing
        # G — nothing to compare, binding kept.
        athyg = [
            _athyg_row(hip=1, v_mag=None),
            _athyg_row(hip=2, v_mag=5.0),
            _athyg_row(hip=3, v_mag=5.0),
        ]
        astro = {30: _gaia_astrometry_row(source_id=30, g_mag=None)}
        idx = _indices_with_astrometry(
            athyg=athyg,
            hip_to_gaia={1: 10, 2: 20, 3: 30},
            src_to_astrometry=astro,
        )
        self.assertEqual(idx.hip_to_gaia, {1: 10, 2: 20, 3: 30})
        self.assertEqual(idx.xwalk_mag_rejected, [])

    def test_athyg_gaia_cell_is_scrubbed(self) -> None:
        # α Cen B shape: the row's own gaia cell (ingested from the same
        # cross-walk) points at a G=20.95 background source. The cell is
        # cleared at the ingest boundary; the HIP survives for Stage 3's
        # HIP2 fallback.
        row = _athyg_row(hip=71681, gaia=587, v_mag=1.35)
        astro = {587: _gaia_astrometry_row(source_id=587, g_mag=20.95)}
        idx = _indices_with_astrometry(
            athyg=[row], src_to_astrometry=astro,
        )
        self.assertIsNone(row.gaia)
        self.assertNotIn(587, idx.src_to_athyg)
        self.assertEqual(idx.athyg_gaia_mag_rejected, [(71681, 587)])
        self.assertIn(71681, idx.hip_to_athyg)


class ParseGaiaAstrometryTests(unittest.TestCase):
    def test_parses_row_with_all_fields(self) -> None:
        body = (
            "source_id\tra\tra_error\tdec\tdec_error\tparallax\tparallax_error"
            "\tpmra\tpmra_error\tpmdec\tpmdec_error\tref_epoch\truwe"
            "\tipd_frac_multi_peak\tphot_g_mean_mag\tphot_bp_mean_mag"
            "\tphot_rp_mean_mag\n"
            "2947050466531873024\t101.287155\t0.04\t-16.716116\t0.03\t"
            "374.49\t0.23\t-461.57\t0.05\t-914.52\t0.03\t2016.00\t1.78\t"
            "0.012\t-1.30\t-0.92\t-1.74\n"
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "astrometry.tsv", body)
            m = bb.parse_gaia_astrometry(p)
        self.assertEqual(set(m.keys()), {2947050466531873024})
        row = m[2947050466531873024]
        self.assertAlmostEqual(row.pmra_masyr or 0.0, -461.57)
        self.assertAlmostEqual(row.parallax_error_mas or 0.0, 0.23)
        self.assertAlmostEqual(row.pmra_error_masyr or 0.0, 0.05)
        self.assertAlmostEqual(row.pmdec_error_masyr or 0.0, 0.03)
        self.assertEqual(row.ref_epoch, 2016.00)
        self.assertEqual(row.ruwe, 1.78)
        self.assertEqual(row.ipd_frac_multi_peak, 0.012)

    def test_skips_row_with_missing_required_fields(self) -> None:
        # ra missing on the second row → must be skipped, not crash.
        body = (
            "source_id\tra\tdec\tparallax\tpmra\tpmdec\tref_epoch\truwe"
            "\tipd_frac_multi_peak\n"
            "1\t10.0\t20.0\t5.0\t1.0\t1.0\t2016.0\t1.0\t0.0\n"
            "2\t\t30.0\t5.0\t1.0\t1.0\t2016.0\t1.0\t0.0\n"
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "astrometry.tsv", body)
            m = bb.parse_gaia_astrometry(p)
        self.assertEqual(set(m.keys()), {1})


class Gaia5pUnreliableTests(unittest.TestCase):
    def test_clean_row_passes(self) -> None:
        row = _gaia_astrometry_row(ruwe=1.0, ipd_frac_multi_peak=0.0)
        self.assertFalse(bb.gaia_5p_unreliable(row))

    def test_high_ruwe_trips(self) -> None:
        row = _gaia_astrometry_row(ruwe=1.5, ipd_frac_multi_peak=0.0)
        self.assertTrue(bb.gaia_5p_unreliable(row))

    def test_at_threshold_does_not_trip(self) -> None:
        # Threshold is strict-greater-than 1.4. Equal is fine.
        row = _gaia_astrometry_row(ruwe=1.4, ipd_frac_multi_peak=0.0)
        self.assertFalse(bb.gaia_5p_unreliable(row))

    def test_high_ipd_trips(self) -> None:
        # ipd_frac_multi_peak is percent-valued (0-100); 5 = 5% > the 2% gate.
        row = _gaia_astrometry_row(ruwe=1.0, ipd_frac_multi_peak=5.0)
        self.assertTrue(bb.gaia_5p_unreliable(row))

    def test_missing_values_do_not_trip(self) -> None:
        # Either flag missing must not force the source onto NSS-systemic.
        row = _gaia_astrometry_row(ruwe=None, ipd_frac_multi_peak=None)
        self.assertFalse(bb.gaia_5p_unreliable(row))


class AttachAstrometryTests(unittest.TestCase):
    def test_unresolved_when_no_gaia_source_id_and_no_hip(self) -> None:
        idx = _indices_with_astrometry()
        a = bb.attach_astrometry(_resolved(gaia=None), None, idx)
        self.assertEqual(a.astrometry_via, "unresolved")
        self.assertIsNone(a.ra_deg)
        self.assertIsNone(a.pmra_masyr)

    def test_unresolved_when_no_astrometry_and_no_hip(self) -> None:
        # source_id resolved but astrometry table doesn't cover it,
        # and the component carries no fallback HIP.
        idx = _indices_with_astrometry(src_to_astrometry={})
        a = bb.attach_astrometry(_resolved(gaia=42), 1.0, idx)
        self.assertEqual(a.astrometry_via, "unresolved")

    def test_hip2_fallback_when_no_gaia_source(self) -> None:
        # Sirius-shape: Gaia saturates, no source_id, but ORB6 surfaced
        # the HIP. HIP2 covers it → route via hip2_long_baseline
        # without any PM-disagreement comparison (no Gaia to compare).
        hip2 = _hip2_row(hip=32349, pm_ra_masyr=-546.0, pm_de_masyr=-1223.0)
        idx = _indices_with_astrometry(hip2=[hip2])
        a = bb.attach_astrometry(
            _resolved(gaia=None, hip=32349), None, idx,
        )
        self.assertEqual(a.astrometry_via, "hip2_long_baseline")
        self.assertEqual(a.pmra_masyr, -546.0)
        self.assertEqual(a.ref_epoch, 1991.25)

    def test_hip2_fallback_when_gaia_source_lacks_astrometry(self) -> None:
        # The component has a Gaia source_id but the astrometry table
        # doesn't cover it (e.g. the upstream ADQL refresh dropped the
        # row). With a known HIP we still fall back to HIP2 rather than
        # emit unresolved.
        hip2 = _hip2_row(hip=99, pm_ra_masyr=10.0, pm_de_masyr=10.0)
        idx = _indices_with_astrometry(
            src_to_astrometry={},
            hip2=[hip2],
        )
        a = bb.attach_astrometry(
            _resolved(gaia=42, hip=99), None, idx,
        )
        self.assertEqual(a.astrometry_via, "hip2_long_baseline")

    def test_hip2_fallback_when_gaia_row_has_null_parallax(self) -> None:
        # Castor STF1110 AB shape: Gaia detected the source and stored
        # ra/dec but couldn't fit a 5p solution, so the gaia_dr3_astrometry
        # row exists with parallax=None. HIP2 has the parallax (Castor at
        # 64.12 mas → 15.6 pc). Stage 3 must route through hip2_long_baseline
        # rather than ``gaia_5p`` — otherwise downstream consumers see an
        # astrometry row with no position constraint and Stage 6 drops the
        # pair as Gaia-blind.
        gaia_row = _gaia_astrometry_row(
            source_id=1000, parallax_mas=None, parallax_error_mas=None,
        )
        hip2 = _hip2_row(hip=36850, plx_mas=64.12)
        idx = _indices_with_astrometry(
            src_to_astrometry={1000: gaia_row},
            hip2=[hip2],
        )
        a = bb.attach_astrometry(
            _resolved(gaia=1000, hip=36850), None, idx,
        )
        self.assertEqual(a.astrometry_via, "hip2_long_baseline")
        self.assertEqual(a.parallax_mas, 64.12)

    def test_null_parallax_gaia_falls_through_to_gaia_5p_when_hip2_missing(
        self,
    ) -> None:
        # Symmetric edge: Gaia row exists with null parallax AND no HIP2
        # row available. The route falls through to ``gaia_5p`` (carrying
        # the null parallax) rather than ``unresolved`` so downstream
        # stages still see the row's ra/dec positional anchor.
        gaia_row = _gaia_astrometry_row(
            source_id=1000, parallax_mas=None, parallax_error_mas=None,
        )
        idx = _indices_with_astrometry(src_to_astrometry={1000: gaia_row})
        a = bb.attach_astrometry(_resolved(gaia=1000, hip=99), None, idx)
        self.assertEqual(a.astrometry_via, "gaia_5p")
        self.assertIsNone(a.parallax_mas)

    def test_no_gaia_no_hip2_still_unresolved(self) -> None:
        # HIP known but HIP2 doesn't cover it — unresolved.
        idx = _indices_with_astrometry(hip2=[])
        a = bb.attach_astrometry(_resolved(gaia=None, hip=99), None, idx)
        self.assertEqual(a.astrometry_via, "unresolved")

    def test_gaia_5p_default_route(self) -> None:
        gaia = _gaia_astrometry_row(source_id=42, ruwe=1.0, ipd_frac_multi_peak=0.0)
        idx = _indices_with_astrometry(src_to_astrometry={42: gaia})
        a = bb.attach_astrometry(_resolved(gaia=42), None, idx)
        self.assertEqual(a.astrometry_via, "gaia_5p")
        self.assertEqual(a.ra_deg, gaia.ra_deg)
        self.assertEqual(a.pmra_masyr, gaia.pmra_masyr)
        self.assertEqual(a.ref_epoch, 2016.0)

    def test_nss_systemic_when_ruwe_high(self) -> None:
        gaia = _gaia_astrometry_row(source_id=7, ruwe=2.5)
        idx = _indices_with_astrometry(
            src_to_astrometry={7: gaia},
            src_to_nss={7: {"period": "100"}},
        )
        a = bb.attach_astrometry(_resolved(gaia=7), None, idx)
        self.assertEqual(a.astrometry_via, "gaia_nss_systemic")
        # Values come from the same Gaia row — Gaia DR3 refits to the
        # centre-of-mass for NSS sources, so the tag is what changes.
        self.assertEqual(a.ra_deg, gaia.ra_deg)

    def test_nss_systemic_when_ipd_high(self) -> None:
        gaia = _gaia_astrometry_row(
            source_id=7, ruwe=1.0, ipd_frac_multi_peak=5.0,
        )
        idx = _indices_with_astrometry(
            src_to_astrometry={7: gaia},
            src_to_nss={7: {"period": "100"}},
        )
        a = bb.attach_astrometry(_resolved(gaia=7), None, idx)
        self.assertEqual(a.astrometry_via, "gaia_nss_systemic")

    def test_nss_present_but_5p_clean_routes_to_gaia_5p(self) -> None:
        # NSS row alone is not sufficient — the 5p must also be flagged.
        gaia = _gaia_astrometry_row(source_id=7, ruwe=1.0, ipd_frac_multi_peak=0.0)
        idx = _indices_with_astrometry(
            src_to_astrometry={7: gaia},
            src_to_nss={7: {"period": "100"}},
        )
        a = bb.attach_astrometry(_resolved(gaia=7), 1.0, idx)
        self.assertEqual(a.astrometry_via, "gaia_5p")

    def test_hip2_long_baseline_when_pmra_disagrees(self) -> None:
        # Sirius-like: Gaia pmra=-462, HIP2 pmra=-546. Δ=84 > 50.
        gaia = _gaia_astrometry_row(
            source_id=1000, pmra_masyr=-462.0, pmdec_masyr=-914.0,
        )
        hip2 = _hip2_row(hip=32349, pm_ra_masyr=-546.0, pm_de_masyr=-1223.0)
        idx = _indices_with_astrometry(
            src_to_astrometry={1000: gaia},
            hip_to_gaia={32349: 1000},
            hip2=[hip2],
        )
        a = bb.attach_astrometry(_resolved(gaia=1000), 3.0, idx)
        self.assertEqual(a.astrometry_via, "hip2_long_baseline")
        # Values come from HIP2, not Gaia.
        self.assertEqual(a.pmra_masyr, -546.0)
        self.assertEqual(a.ref_epoch, 1991.25)

    def test_hip2_long_baseline_when_pmde_disagrees(self) -> None:
        gaia = _gaia_astrometry_row(
            source_id=1000, pmra_masyr=10.0, pmdec_masyr=-100.0,
        )
        hip2 = _hip2_row(hip=999, pm_ra_masyr=15.0, pm_de_masyr=-200.0)  # Δde=100 > 50
        idx = _indices_with_astrometry(
            src_to_astrometry={1000: gaia},
            hip_to_gaia={999: 1000},
            hip2=[hip2],
        )
        a = bb.attach_astrometry(_resolved(gaia=1000), 2.0, idx)
        self.assertEqual(a.astrometry_via, "hip2_long_baseline")

    def test_hip2_route_skipped_when_pair_too_wide(self) -> None:
        # 50″ separation — no orbital contamination expected at this
        # spacing, so even with a PM disagreement we stick with Gaia 5p.
        gaia = _gaia_astrometry_row(
            source_id=1000, pmra_masyr=10.0, pmdec_masyr=10.0,
        )
        hip2 = _hip2_row(hip=999, pm_ra_masyr=100.0, pm_de_masyr=100.0)
        idx = _indices_with_astrometry(
            src_to_astrometry={1000: gaia},
            hip_to_gaia={999: 1000},
            hip2=[hip2],
        )
        a = bb.attach_astrometry(_resolved(gaia=1000), 50.0, idx)
        self.assertEqual(a.astrometry_via, "gaia_5p")

    def test_hip2_route_skipped_when_pm_agrees(self) -> None:
        gaia = _gaia_astrometry_row(
            source_id=1000, pmra_masyr=10.0, pmdec_masyr=10.0,
        )
        hip2 = _hip2_row(hip=999, pm_ra_masyr=15.0, pm_de_masyr=5.0)  # Δ<50 on both
        idx = _indices_with_astrometry(
            src_to_astrometry={1000: gaia},
            hip_to_gaia={999: 1000},
            hip2=[hip2],
        )
        a = bb.attach_astrometry(_resolved(gaia=1000), 1.0, idx)
        self.assertEqual(a.astrometry_via, "gaia_5p")

    def test_hip2_route_skipped_when_source_has_no_hip(self) -> None:
        # Tycho-only star — no HIP2 lookup possible.
        gaia = _gaia_astrometry_row(source_id=1000)
        idx = _indices_with_astrometry(
            src_to_astrometry={1000: gaia},
            hip_to_gaia={},
            hip2=[],
        )
        a = bb.attach_astrometry(_resolved(gaia=1000), 1.0, idx)
        self.assertEqual(a.astrometry_via, "gaia_5p")

    def test_nss_beats_hip2_when_both_would_fire(self) -> None:
        # Bright close binary with NSS row + bad ruwe AND big PM
        # disagreement. NSS-systemic wins by priority.
        gaia = _gaia_astrometry_row(
            source_id=1000, ruwe=2.0, pmra_masyr=10.0, pmdec_masyr=10.0,
        )
        hip2 = _hip2_row(hip=999, pm_ra_masyr=200.0, pm_de_masyr=200.0)
        idx = _indices_with_astrometry(
            src_to_astrometry={1000: gaia},
            src_to_nss={1000: {"period": "10"}},
            hip_to_gaia={999: 1000},
            hip2=[hip2],
        )
        a = bb.attach_astrometry(_resolved(gaia=1000), 1.0, idx)
        self.assertEqual(a.astrometry_via, "gaia_nss_systemic")


class ResolvedComponentHipTests(unittest.TestCase):
    """Stage 2 records the HIP when known even if no Gaia source_id
    could be resolved, so Stage 3's HIP2 fallback engages for
    Gaia-saturated bright primaries.
    """

    def test_unresolved_primary_retains_orb6_hip(self) -> None:
        pair = _wds_pair(wds_id="06451-1643", components="AB")
        orb6 = [_orb6(wds_id=pair.wds_id, components="AB", hip=32349)]
        # No Gaia xwalk entry for HIP 32349, no AT-HYG row carrying gaia.
        idx = _indices(hip_to_gaia={}, athyg=[])
        r = bb.resolve_component(
            pair, "A", is_primary=True,
            orb6_for_pair=orb6, indices=idx,
        )
        self.assertEqual(r.resolve_via, "unresolved")
        self.assertIsNone(r.gaia_source_id)
        # The ORB6 HIP propagates onto the component so Stage 3's HIP2
        # fallback has something to dispatch on.
        self.assertEqual(r.hip, 32349)

    def test_orb6_hip_resolution_records_hip(self) -> None:
        pair = _wds_pair(wds_id="W", components="AB")
        orb6 = [_orb6(wds_id=pair.wds_id, components="AB", hip=42)]
        idx = _indices(hip_to_gaia={42: 100})
        r = bb.resolve_component(
            pair, "A", is_primary=True,
            orb6_for_pair=orb6, indices=idx,
        )
        self.assertEqual(r.resolve_via, "orb6_hip")
        self.assertEqual(r.gaia_source_id, 100)
        self.assertEqual(r.hip, 42)

    def test_position_match_records_hip_from_athyg_row(self) -> None:
        pair = _wds_pair_with_pos(
            components="AB",
            precise_ra=100.0, precise_dec=0.0,
        )
        # AT-HYG row at the same coord carrying both hip and gaia.
        athyg = [bb.AthygRow(
            hip=99, tyc=None, gaia=42, hd=None,
            ra_deg=100.0, dec_deg=0.0,
            x_pc=0.0, y_pc=0.0, z_pc=0.0,
            dist_pc=1.0, v_mag=None, absmag=5.0,
            ci=None, spect="", proper="",
            pm_ra_masyr=None, pm_de_masyr=None,
        )]
        c = bb.ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        bb.resolve_via_position(
            components=[c], pairs=[pair], athyg=athyg,
            tolerance_arcsec=2.0,
        )
        self.assertEqual(c.gaia_source_id, 42)
        self.assertEqual(c.hip, 99)


class PropagateWithinSystemHipTests(unittest.TestCase):
    """HIP propagates by component-letter across pair rows even when
    Gaia source_id never resolved (Sirius A appears in AB/AC/AD/AE/AF
    pair rows but only ORB6's AB row carries the HIP).
    """

    def test_hip_propagates_to_other_pair_rows(self) -> None:
        ab_a = bb.ResolvedComponent(
            wds_id="X", discoverer="D", component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved", hip=32349,
        )
        ac_a = bb.ResolvedComponent(
            wds_id="X", discoverer="D", component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved", hip=None,
        )
        ad_a = bb.ResolvedComponent(
            wds_id="X", discoverer="D", component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved", hip=None,
        )
        bb.propagate_within_system([ab_a, ac_a, ad_a])
        self.assertEqual(ac_a.hip, 32349)
        self.assertEqual(ad_a.hip, 32349)


class ComputeMinRhoPerSourceTests(unittest.TestCase):
    def test_takes_minimum_across_pairs(self) -> None:
        # Same source_id in a tight AB pair and a wide AC pair — the
        # 2″ ρ wins so this star will trip the HIP2 5″ gate.
        ab = bb.WdsPair(
            wds_id="X", discoverer="D", components="AB",
            date_last=None, rho_last=2.0, theta_last=0.0,
            mag_pri=None, mag_sec=None, spectral="", notes="    ",
            precise_ra_deg=None, precise_dec_deg=None,
        )
        ac = bb.WdsPair(
            wds_id="X", discoverer="D", components="AC",
            date_last=None, rho_last=50.0, theta_last=0.0,
            mag_pri=None, mag_sec=None, spectral="", notes="    ",
            precise_ra_deg=None, precise_dec_deg=None,
        )
        comp_ab = _resolved(gaia=42, wds_id="X", discoverer="D", component="A", is_primary=True)
        comp_ac = _resolved(gaia=42, wds_id="X", discoverer="D", component="A", is_primary=True)
        idx = bb.build_pair_by_wds_disc([ab, ac])
        min_rho = bb.compute_min_rho_per_source([comp_ab, comp_ac], idx)
        self.assertEqual(min_rho[42], 2.0)

    def test_skips_components_with_no_pair_or_no_rho(self) -> None:
        bare = bb.WdsPair(
            wds_id="Y", discoverer="D", components="AB",
            date_last=None, rho_last=None, theta_last=None,
            mag_pri=None, mag_sec=None, spectral="", notes="    ",
            precise_ra_deg=None, precise_dec_deg=None,
        )
        comp = _resolved(gaia=7, wds_id="Y", discoverer="D")
        idx = bb.build_pair_by_wds_disc([bare])
        min_rho = bb.compute_min_rho_per_source([comp], idx)
        self.assertNotIn(7, min_rho)


class AttachAstrometryAllTests(unittest.TestCase):
    def test_parallel_list_contract(self) -> None:
        gaia = _gaia_astrometry_row(source_id=42)
        idx = _indices_with_astrometry(src_to_astrometry={42: gaia})
        c1 = _resolved(gaia=42, wds_id="X", discoverer="D", component="A", is_primary=True)
        c2 = _resolved(gaia=None, wds_id="X", discoverer="D", component="B", is_primary=False)
        pair = bb.WdsPair(
            wds_id="X", discoverer="D", components="AB",
            date_last=None, rho_last=10.0, theta_last=0.0,
            mag_pri=None, mag_sec=None, spectral="", notes="    ",
            precise_ra_deg=None, precise_dec_deg=None,
        )
        out = bb.attach_astrometry_all([c1, c2], pairs=[pair], indices=idx)
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0].astrometry_via, "gaia_5p")
        self.assertEqual(out[1].astrometry_via, "unresolved")

    def test_tight_pair_routes_to_hip2(self) -> None:
        # End-to-end: AB pair with 2″ separation + PM disagreement →
        # primary routes to hip2_long_baseline.
        gaia = _gaia_astrometry_row(
            source_id=42, pmra_masyr=-462.0, pmdec_masyr=-914.0,
        )
        hip2 = _hip2_row(hip=99, pm_ra_masyr=-546.0, pm_de_masyr=-1223.0)
        idx = _indices_with_astrometry(
            src_to_astrometry={42: gaia},
            hip_to_gaia={99: 42},
            hip2=[hip2],
        )
        c = _resolved(gaia=42, wds_id="X", discoverer="D", component="A", is_primary=True)
        pair = bb.WdsPair(
            wds_id="X", discoverer="D", components="AB",
            date_last=None, rho_last=2.0, theta_last=0.0,
            mag_pri=None, mag_sec=None, spectral="", notes="    ",
            precise_ra_deg=None, precise_dec_deg=None,
        )
        out = bb.attach_astrometry_all([c], pairs=[pair], indices=idx)
        self.assertEqual(out[0].astrometry_via, "hip2_long_baseline")

    def test_min_rho_drives_routing_across_pair_rows(self) -> None:
        # Same source A in both an AB (2″) and an AC (50″) row.
        # The 2″ ρ trips the HIP2 5″ gate; both A-rows route together.
        gaia = _gaia_astrometry_row(
            source_id=42, pmra_masyr=10.0, pmdec_masyr=10.0,
        )
        hip2 = _hip2_row(hip=99, pm_ra_masyr=200.0, pm_de_masyr=10.0)
        idx = _indices_with_astrometry(
            src_to_astrometry={42: gaia},
            hip_to_gaia={99: 42},
            hip2=[hip2],
        )
        ab_a = _resolved(gaia=42, wds_id="X", discoverer="D", component="A", is_primary=True)
        ac_a = _resolved(gaia=42, wds_id="X", discoverer="D", component="A", is_primary=True)
        ab = bb.WdsPair(
            wds_id="X", discoverer="D", components="AB",
            date_last=None, rho_last=2.0, theta_last=0.0,
            mag_pri=None, mag_sec=None, spectral="", notes="    ",
            precise_ra_deg=None, precise_dec_deg=None,
        )
        ac = bb.WdsPair(
            wds_id="X", discoverer="D", components="AC",
            date_last=None, rho_last=50.0, theta_last=0.0,
            mag_pri=None, mag_sec=None, spectral="", notes="    ",
            precise_ra_deg=None, precise_dec_deg=None,
        )
        out = bb.attach_astrometry_all([ab_a, ac_a], pairs=[ab, ac], indices=idx)
        # Both A-rows in the same system route together because the
        # per-source min-ρ (2″) gates the HIP2 fallback.
        self.assertEqual(out[0].astrometry_via, "hip2_long_baseline")
        self.assertEqual(out[1].astrometry_via, "hip2_long_baseline")


class AstrometryCountsTests(unittest.TestCase):
    def test_every_canonical_key_present(self) -> None:
        items = [
            bb.ComponentAstrometry(
                astrometry_via="gaia_5p",
                ra_deg=1.0, dec_deg=1.0, parallax_mas=1.0,
                parallax_error_mas=0.05,
                pmra_masyr=1.0, pmdec_masyr=1.0, ref_epoch=2016.0,
            ),
            bb.ComponentAstrometry(
                astrometry_via="unresolved",
                ra_deg=None, dec_deg=None, parallax_mas=None,
                parallax_error_mas=None,
                pmra_masyr=None, pmdec_masyr=None, ref_epoch=None,
            ),
        ]
        counts = bb.astrometry_counts(items)
        self.assertEqual(set(counts.keys()), set(bb.ASTROMETRY_VIA_VALUES))
        self.assertEqual(counts["gaia_5p"], 1)
        self.assertEqual(counts["unresolved"], 1)
        self.assertEqual(counts["gaia_nss_systemic"], 0)
        self.assertEqual(counts["hip2_long_baseline"], 0)
        self.assertEqual(counts["athyg_position"], 0)


class AthygPositionFallbackTests(unittest.TestCase):
    """Stage 3's AT-HYG-position fallback. Fires when both Gaia 5p and
    HIP2 miss for a component but the WDS precise_coord position-matches
    an AT-HYG row whose stored ra/dec/dist_pc carry a usable astrometric
    anchor. Canonical population: ξ UMa-shape systems where the bright
    primary is Gaia-saturated AND HIP2 dropped the entry (van Leeuwen
    excludes orbit-corrupted HIP fits).
    """

    def test_athyg_position_fires_when_gaia_and_hip2_miss(self) -> None:
        pair = _wds_pair_with_pos(
            wds_id="11182+3132", components="AB",
            precise_ra=169.5454, precise_dec=31.5292,
            rho=2.6, theta=135.0,
        )
        # AT-HYG row at the same coord. dist_pc=10.4 (ξ UMa-like).
        # pm fields populated but the J1991.25→J2000 propagation has to
        # round-trip via the row's stored ra/dec — see the dual-epoch
        # match helper.
        athyg = [_athyg_row_at(
            ra=169.5454, dec=31.5292, gaia=None, hip=None,
            pm_ra_masyr=-425.24, pm_de_masyr=-581.01,
        )]
        athyg[0].dist_pc = 10.4
        # Both components carry a Gaia source_id from SIMBAD xid but
        # neither source is in the 5p table.
        components = [
            bb.ResolvedComponent(
                wds_id=pair.wds_id, discoverer=pair.discoverer,
                component="A", is_primary=True,
                gaia_source_id=756853643638639104, resolve_via="simbad_xid",
                hip=55203,  # ORB6 hip, but HIP2 doesn't cover it.
            ),
            bb.ResolvedComponent(
                wds_id=pair.wds_id, discoverer=pair.discoverer,
                component="B", is_primary=False,
                gaia_source_id=756853643637996160, resolve_via="simbad_xid",
            ),
        ]
        idx = _indices_with_astrometry(
            src_to_astrometry={},  # no 5p coverage
            athyg=athyg,
            hip2=[],  # HIP 55203 missing from HIP2
        )
        out = bb.attach_astrometry_all(
            components, pairs=[pair], indices=idx, athyg=athyg,
        )
        self.assertEqual(out[0].astrometry_via, "athyg_position")
        self.assertEqual(out[1].astrometry_via, "athyg_position")
        # Parallax derived from dist_pc.
        self.assertAlmostEqual(out[0].parallax_mas or 0.0, 1000.0 / 10.4, places=4)

    def test_gaia_5p_beats_athyg_position(self) -> None:
        # The Gaia / HIP2 cascade runs first; the AT-HYG fallback only
        # touches components still tagged unresolved.
        gaia = _gaia_astrometry_row(source_id=42)
        athyg = [_athyg_row_at(ra=100.0, dec=20.0, gaia=42)]
        athyg[0].dist_pc = 50.0
        pair = _wds_pair_with_pos(
            wds_id="X", components="AB",
            precise_ra=100.0, precise_dec=20.0, rho=5.0, theta=0.0,
        )
        c = _resolved(gaia=42, wds_id="X", discoverer=pair.discoverer,
                      component="A", is_primary=True)
        idx = _indices_with_astrometry(
            src_to_astrometry={42: gaia}, athyg=athyg,
        )
        out = bb.attach_astrometry_all(
            [c], pairs=[pair], indices=idx, athyg=athyg,
        )
        self.assertEqual(out[0].astrometry_via, "gaia_5p")

    def test_hip2_beats_athyg_position(self) -> None:
        # Sirius-shape: no Gaia source but HIP is known and HIP2 covers
        # it. AT-HYG fallback must not run because the cascade resolved
        # via hip2_long_baseline.
        hip2 = _hip2_row(hip=32349)
        athyg = [_athyg_row_at(ra=100.0, dec=20.0, gaia=None, hip=32349)]
        athyg[0].dist_pc = 2.6
        pair = _wds_pair_with_pos(
            wds_id="06451-1643", components="AB",
            precise_ra=100.0, precise_dec=20.0, rho=10.0, theta=0.0,
        )
        c = _resolved(
            gaia=None, hip=32349,
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True,
        )
        idx = _indices_with_astrometry(
            src_to_astrometry={}, hip2=[hip2], athyg=athyg,
        )
        out = bb.attach_astrometry_all(
            [c], pairs=[pair], indices=idx, athyg=athyg,
        )
        self.assertEqual(out[0].astrometry_via, "hip2_long_baseline")

    def test_secondary_inherits_primary_athyg_row_when_blend(self) -> None:
        # Hipparcos-unresolved AB blend: both components share one
        # AT-HYG row (same x/y/z). Secondary's predicted position is
        # within tolerance of the same row, so primary_idx exclusion
        # forces the secondary slot back to the primary's row.
        pair = _wds_pair_with_pos(
            wds_id="11182+3132", components="AB",
            precise_ra=169.5454, precise_dec=31.5292,
            rho=2.6, theta=90.0,
        )
        athyg = [_athyg_row_at(
            ra=169.5454, dec=31.5292, gaia=None, hip=None,
        )]
        athyg[0].dist_pc = 10.4
        components = [
            bb.ResolvedComponent(
                wds_id=pair.wds_id, discoverer=pair.discoverer,
                component="A", is_primary=True,
                gaia_source_id=1, resolve_via="simbad_xid",
            ),
            bb.ResolvedComponent(
                wds_id=pair.wds_id, discoverer=pair.discoverer,
                component="B", is_primary=False,
                gaia_source_id=2, resolve_via="simbad_xid",
            ),
        ]
        idx = _indices_with_astrometry(
            src_to_astrometry={}, athyg=athyg, hip2=[],
        )
        out = bb.attach_astrometry_all(
            components, pairs=[pair], indices=idx, athyg=athyg,
        )
        self.assertEqual(out[0].astrometry_via, "athyg_position")
        self.assertEqual(out[1].astrometry_via, "athyg_position")

    def test_no_athyg_match_stays_unresolved(self) -> None:
        # The component is unresolved AND the WDS precise_coord doesn't
        # land within tolerance of any AT-HYG row.
        pair = _wds_pair_with_pos(
            wds_id="X", components="AB",
            precise_ra=200.0, precise_dec=-40.0, rho=3.0, theta=0.0,
        )
        athyg = [_athyg_row_at(ra=100.0, dec=20.0, gaia=None, hip=None)]
        athyg[0].dist_pc = 5.0
        c = _resolved(
            gaia=99, wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True, via="simbad_xid",
        )
        idx = _indices_with_astrometry(
            src_to_astrometry={}, athyg=athyg,
        )
        out = bb.attach_astrometry_all(
            [c], pairs=[pair], indices=idx, athyg=athyg,
        )
        self.assertEqual(out[0].astrometry_via, "unresolved")

    def test_no_athyg_passed_keeps_unresolved(self) -> None:
        # In-process orchestrator path with no AT-HYG context (tests
        # that don't load AT-HYG). Fallback must not run.
        pair = _wds_pair_with_pos(
            wds_id="X", components="AB",
            precise_ra=100.0, precise_dec=20.0, rho=3.0, theta=0.0,
        )
        c = _resolved(
            gaia=99, wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True, via="simbad_xid",
        )
        idx = _indices_with_astrometry(src_to_astrometry={})
        out = bb.attach_astrometry_all([c], pairs=[pair], indices=idx)
        self.assertEqual(out[0].astrometry_via, "unresolved")

    def test_unpropagated_branch_matches_high_pm_gj_row(self) -> None:
        # AT-HYG GJ-sourced row stores ra/dec at J2000; the row has
        # high PM populated. Propagating by 8.75 yr would shift the
        # row 4-6″ from the WDS precise_coord and miss the 2″
        # tolerance, so the dual-epoch helper retries with no
        # propagation. ξ UMa is the canonical case.
        pair = _wds_pair_with_pos(
            wds_id="11182+3132", components="AB",
            precise_ra=169.5454, precise_dec=31.5292,
            rho=2.6, theta=135.0,
        )
        athyg = [_athyg_row_at(
            ra=169.5454, dec=31.5292, gaia=None, hip=None,
            pm_ra_masyr=-425.24, pm_de_masyr=-581.01,
        )]
        athyg[0].dist_pc = 10.4
        c = _resolved(
            gaia=1, wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True, via="simbad_xid",
        )
        idx = _indices_with_astrometry(
            src_to_astrometry={}, athyg=athyg,
        )
        out = bb.attach_astrometry_all(
            [c], pairs=[pair], indices=idx, athyg=athyg,
        )
        self.assertEqual(out[0].astrometry_via, "athyg_position")
        # Position comes from the AT-HYG row's stored J2000 coord
        # (the no-propagation branch).
        self.assertAlmostEqual(out[0].ra_deg or 0.0, 169.5454)
        self.assertAlmostEqual(out[0].dec_deg or 0.0, 31.5292)

    def test_wide_pair_skips_predicted_secondary_match(self) -> None:
        # The WDS overflow sentinel (999.9) is nulled at parse, so an
        # ultra-wide pair reaches Stage 3 with ρ = None and no usable
        # (ρ, θ) prediction. The secondary's own predicted-position
        # match is skipped; with the primary still matched,
        # blend-inheritance fires and the secondary inherits its row.
        pair = _wds_pair_with_pos(
            wds_id="X", components="AB",
            precise_ra=100.0, precise_dec=20.0,
            rho=None, theta=None,
        )
        # The second AT-HYG row sits where a real (ρ, θ) prediction would
        # have placed a secondary; with ρ nulled no prediction is made,
        # so the secondary must inherit the primary's row, not this decoy.
        athyg = [
            _athyg_row_at(ra=100.0, dec=20.0, gaia=None, hip=None),
            _athyg_row_at(ra=100.0, dec=20.0 + 999.0 / 3600.0,
                          gaia=None, hip=None),
        ]
        athyg[0].dist_pc = 10.0
        athyg[1].dist_pc = 50.0
        components = [
            bb.ResolvedComponent(
                wds_id=pair.wds_id, discoverer=pair.discoverer,
                component="A", is_primary=True,
                gaia_source_id=1, resolve_via="simbad_xid",
            ),
            bb.ResolvedComponent(
                wds_id=pair.wds_id, discoverer=pair.discoverer,
                component="B", is_primary=False,
                gaia_source_id=2, resolve_via="simbad_xid",
            ),
        ]
        idx = _indices_with_astrometry(
            src_to_astrometry={}, athyg=athyg, hip2=[],
        )
        out = bb.attach_astrometry_all(
            components, pairs=[pair], indices=idx, athyg=athyg,
        )
        self.assertEqual(out[0].astrometry_via, "athyg_position")
        self.assertEqual(out[1].astrometry_via, "athyg_position")
        # Both rows share the primary's parallax (=1000/10) — confirms
        # blend-inheritance picked athyg[0], not athyg[1].
        self.assertAlmostEqual(out[1].parallax_mas or 0.0, 100.0, places=4)

    def test_zero_dist_athyg_stays_unresolved(self) -> None:
        # Defensive: AT-HYG row with dist_pc=0 carries no usable
        # parallax — synthesis returns None and the component stays
        # tagged unresolved rather than emitting a 1/0 parallax.
        pair = _wds_pair_with_pos(
            wds_id="X", components="AB",
            precise_ra=100.0, precise_dec=20.0,
        )
        athyg = [_athyg_row_at(ra=100.0, dec=20.0, gaia=None, hip=None)]
        athyg[0].dist_pc = 0.0
        c = _resolved(
            gaia=99, wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True, via="simbad_xid",
        )
        idx = _indices_with_astrometry(
            src_to_astrometry={}, athyg=athyg,
        )
        out = bb.attach_astrometry_all(
            [c], pairs=[pair], indices=idx, athyg=athyg,
        )
        self.assertEqual(out[0].astrometry_via, "unresolved")


# ─── Stage 4: orbital-element selection ──────────────────────────────


def _ti_from_campbell(
    a_mas: float, i_rad: float, Omega_rad: float, omega_rad: float,
) -> tuple[float, float, float, float]:
    """Forward Thiele-Innes from Campbell — Halbwachs+ 2023 Eq. (16)
    convention. The unit tests round-trip through ``_thiele_innes_to_
    campbell`` so any sign/ordering drift in the inverse algebra
    surfaces immediately.
    """
    co, so = math.cos(omega_rad), math.sin(omega_rad)
    cO, sO = math.cos(Omega_rad), math.sin(Omega_rad)
    ci = math.cos(i_rad)
    A = a_mas * (co * cO - so * sO * ci)
    B = a_mas * (co * sO + so * cO * ci)
    F = a_mas * (-so * cO - co * sO * ci)
    G = a_mas * (-so * sO + co * cO * ci)
    return A, B, F, G


class ThieleInnesAlgebraTests(unittest.TestCase):
    def test_roundtrip_recovers_campbell(self) -> None:
        # Pick a non-trivial orbit well away from any boundary case
        # (i!=0, Ω in upper half, ω in lower half).
        a_in, i_in = 12.5, math.radians(57.3)
        Omega_in, omega_in = math.radians(110.0), math.radians(45.0)
        A, B, F, G = _ti_from_campbell(a_in, i_in, Omega_in, omega_in)
        got = bb._thiele_innes_to_campbell(A, B, F, G)
        self.assertIsNotNone(got)
        assert got is not None
        a_out, i_out, Omega_out, omega_out = got
        self.assertAlmostEqual(a_out, a_in, places=9)
        self.assertAlmostEqual(i_out, i_in, places=9)
        self.assertAlmostEqual(Omega_out, Omega_in, places=9)
        self.assertAlmostEqual(omega_out, omega_in, places=9)

    def test_omega_wrapped_into_upper_half(self) -> None:
        # Feed a Campbell with Ω in the lower half — the inverse must
        # collapse it into [0, π) and rotate ω by π so the physical
        # orbit stays the same.
        a_in, i_in = 10.0, math.radians(45.0)
        Omega_in = math.radians(220.0)   # > π
        omega_in = math.radians(60.0)
        A, B, F, G = _ti_from_campbell(a_in, i_in, Omega_in, omega_in)
        got = bb._thiele_innes_to_campbell(A, B, F, G)
        self.assertIsNotNone(got)
        assert got is not None
        a_out, i_out, Omega_out, omega_out = got
        self.assertAlmostEqual(a_out, a_in, places=9)
        self.assertAlmostEqual(i_out, i_in, places=9)
        self.assertGreaterEqual(Omega_out, 0.0)
        self.assertLess(Omega_out, math.pi)
        # The physical orbit is invariant under (Ω → Ω+π, ω → ω+π).
        self.assertAlmostEqual(Omega_out, Omega_in - math.pi, places=9)
        self.assertAlmostEqual(
            omega_out, (omega_in + math.pi) % (2.0 * math.pi), places=9,
        )

    def test_degenerate_ti_returns_none(self) -> None:
        # All zero TI quartet → degenerate. Helper returns None.
        self.assertIsNone(bb._thiele_innes_to_campbell(0.0, 0.0, 0.0, 0.0))


def _nss_orbital_row(
    *, a_mas: float = 12.5, i_deg: float = 57.3,
    Omega_deg: float = 110.0, omega_deg: float = 45.0,
    period_days: float = 365.0,
    t_periastron_rel_days: float = 100.0,
    eccentricity: float = 0.1,
) -> dict[str, str]:
    A, B, F, G = _ti_from_campbell(
        a_mas, math.radians(i_deg),
        math.radians(Omega_deg), math.radians(omega_deg),
    )
    return {
        "nss_solution_type": "Orbital",
        "period": f"{period_days}",
        "t_periastron": f"{t_periastron_rel_days}",
        "eccentricity": f"{eccentricity}",
        "a_thiele_innes": f"{A}",
        "b_thiele_innes": f"{B}",
        "f_thiele_innes": f"{F}",
        "g_thiele_innes": f"{G}",
    }


class NssToCanonicalElementsTests(unittest.TestCase):
    def test_orbital_type_recovers_angles_withholds_a0(self) -> None:
        plx = 10.0
        row = _nss_orbital_row(
            a_mas=20.0, i_deg=60.0,
            Omega_deg=30.0, omega_deg=120.0,
            period_days=730.5, t_periastron_rel_days=200.0,
            eccentricity=0.3,
        )
        o = bb.nss_to_canonical_elements(row, plx)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.P_days or 0.0, 730.5)
        self.assertAlmostEqual(
            o.T_jd or 0.0, 200.0 + bb.GAIA_DR3_REF_EPOCH_JD,
        )
        self.assertAlmostEqual(o.e or 0.0, 0.3)
        self.assertIsNone(o.a_AU)
        self.assertAlmostEqual(o.i_rad or 0.0, math.radians(60.0))
        self.assertAlmostEqual(o.Omega_rad or 0.0, math.radians(30.0))
        self.assertAlmostEqual(o.omega_rad or 0.0, math.radians(120.0))
        self.assertIsNone(o.q)
        self.assertAlmostEqual(o.distance_pc or 0.0, 100.0)

    def test_orbital_without_parallax_also_drops_distance(self) -> None:
        row = _nss_orbital_row(a_mas=20.0)
        o = bb.nss_to_canonical_elements(row, None)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertIsNone(o.a_AU)
        self.assertIsNone(o.distance_pc)
        self.assertIsNotNone(o.i_rad)
        self.assertIsNotNone(o.Omega_rad)
        self.assertIsNotNone(o.omega_rad)

    def test_photocentre_a0_never_scales_to_relative_a_au(self) -> None:
        # Synthetic pair: a_rel = 10 AU at 100 pc (plx 10 mas), mass
        # fraction q = 0.4, flux fraction β = 0.1 → the TI constants
        # Gaia would publish encode a0 = (q − β)·a_rel = 3 AU = 30 mas,
        # not a_rel.
        a_rel_AU, q, beta, plx = 10.0, 0.4, 0.1, 10.0
        a0_mas = (q - beta) * a_rel_AU * plx
        row = _nss_orbital_row(a_mas=a0_mas, i_deg=45.0)
        A = float(row["a_thiele_innes"])
        B = float(row["b_thiele_innes"])
        F = float(row["f_thiele_innes"])
        G = float(row["g_thiele_innes"])
        camp = bb._thiele_innes_to_campbell(A, B, F, G)
        assert camp is not None
        self.assertAlmostEqual(camp[0], a0_mas, places=9)
        self.assertNotAlmostEqual(camp[0], a_rel_AU * plx, places=1)
        o = bb.nss_to_canonical_elements(row, plx)
        assert o is not None
        self.assertIsNone(o.a_AU)

    def test_eclipsing_reads_stored_inclination_and_omega(self) -> None:
        row = {
            "nss_solution_type": "EclipsingBinary",
            "period": "1.5",
            "t_periastron": "0.0",
            "eccentricity": "0.0",
            "inclination": "89.5",
            "arg_periastron": "45.0",
        }
        o = bb.nss_to_canonical_elements(row, 5.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.P_days or 0.0, 1.5)
        self.assertAlmostEqual(o.i_rad or 0.0, math.radians(89.5))
        self.assertAlmostEqual(o.omega_rad or 0.0, math.radians(45.0))
        self.assertIsNone(o.a_AU)
        self.assertIsNone(o.Omega_rad)

    def test_eclipsing_spectro_carries_mass_ratio(self) -> None:
        # mass_ratio is Gaia's M_S/M_P ratio; q stores the M_2/(M_1+M_2)
        # fraction, so 0.6 → 0.6/1.6 = 0.375.
        row = {
            "nss_solution_type": "EclipsingSpectro",
            "period": "2.0", "t_periastron": "1.0", "eccentricity": "0.0",
            "inclination": "88.0", "arg_periastron": "10.0",
            "mass_ratio": "0.6",
        }
        o = bb.nss_to_canonical_elements(row, 5.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.q or 0.0, 0.6 / 1.6)

    def test_sb1_only_carries_omega(self) -> None:
        row = {
            "nss_solution_type": "SB1",
            "period": "100.0", "t_periastron": "10.0", "eccentricity": "0.2",
            "arg_periastron": "75.0",
        }
        o = bb.nss_to_canonical_elements(row, 8.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.omega_rad or 0.0, math.radians(75.0))
        self.assertIsNone(o.i_rad)
        self.assertIsNone(o.Omega_rad)
        self.assertIsNone(o.a_AU)

    def test_mass_ratio_above_one_converts_to_bounded_fraction(self) -> None:
        # M_S/M_P can exceed 1 (heavier secondary); q must still land in
        # [0,1) as the M_2/(M_1+M_2) fraction — 2.0 → 2/3.
        row = {
            "nss_solution_type": "EclipsingSpectro",
            "period": "50.0", "t_periastron": "5.0", "eccentricity": "0.1",
            "inclination": "80.0", "arg_periastron": "30.0",
            "mass_ratio": "2.0",
        }
        o = bb.nss_to_canonical_elements(row, 8.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.q or 0.0, 2.0 / 3.0)

    def test_sb1c_compact_has_no_geometry_beyond_pte(self) -> None:
        # "Compact" SB1C variant — only P/T/e stored. No omega.
        row = {
            "nss_solution_type": "SB1C",
            "period": "12.0", "t_periastron": "3.0", "eccentricity": "0.05",
        }
        o = bb.nss_to_canonical_elements(row, 5.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.P_days or 0.0, 12.0)
        self.assertIsNone(o.omega_rad)
        self.assertIsNone(o.i_rad)
        self.assertIsNone(o.Omega_rad)
        self.assertIsNone(o.a_AU)

    def test_unsupported_solution_type_returns_none(self) -> None:
        row = {"nss_solution_type": "FutureNewType", "period": "1.0"}
        self.assertIsNone(bb.nss_to_canonical_elements(row, 5.0))


def _orb6_visual(
    *, P_val: float = 50.0, P_unit: str = "y",
    a_val: float = 1.0, a_unit: str = "a",
    i_deg: float = 90.0, Omega_deg: float = 45.0, omega_deg: float = 30.0,
    e: float = 0.5,
    T0_val: float = 1990.0, T0_unit: str = "y",
    grade: int = 2, ref: str = "Ref2020",
) -> "bb.Orb6Entry":
    return bb.Orb6Entry(
        wds_id="00000+0000", discoverer="TST   1", components="AB",
        hd=None, hip=None,
        P_val=P_val, P_unit=P_unit,
        a_val=a_val, a_unit=a_unit,
        i_deg=i_deg, Omega_deg=Omega_deg, omega_deg=omega_deg,
        e=e, T0_val=T0_val, T0_unit=T0_unit,
        grade=grade, ref=ref,
    )


class Orb6ToCanonicalElementsTests(unittest.TestCase):
    def test_years_arcsec_julian_year(self) -> None:
        # α Cen-shaped row: P=79.762 y, a=17.493 arcsec.
        entry = _orb6_visual(
            P_val=79.762, P_unit="y",
            a_val=17.493, a_unit="a",
            i_deg=79.0, Omega_deg=204.0, omega_deg=232.0,
            e=0.5179, T0_val=1875.66, T0_unit="y",
        )
        o = bb.orb6_to_canonical_elements(entry, plx_mas=755.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.P_days or 0.0, 79.762 * 365.25)
        # a_AU = 17.493 arcsec / 0.755" = 23.17 AU (α Cen sanity-check).
        self.assertAlmostEqual(o.a_AU or 0.0, 17.493 * 1000.0 / 755.0)
        self.assertAlmostEqual(o.i_rad or 0.0, math.radians(79.0))
        self.assertAlmostEqual(o.T_jd or 0.0,
                               bb.J2000_REF_EPOCH_JD + (1875.66 - 2000.0) * 365.25)
        self.assertAlmostEqual(o.distance_pc or 0.0, 1000.0 / 755.0)

    def test_days_mas_truncated_jd(self) -> None:
        # Short-period close binary stored in days + mas + truncated JD.
        # ORB6's 'd' code is JD − 2,400,000, not a full JD (Algol Aa1,Aa2
        # carries 41771.353 = HJD 2441771.353).
        entry = _orb6_visual(
            P_val=10.0, P_unit="d",
            a_val=500.0, a_unit="m",
            T0_val=51545.0, T0_unit="d",
        )
        o = bb.orb6_to_canonical_elements(entry, plx_mas=100.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.P_days or 0.0, 10.0)
        self.assertAlmostEqual(o.a_AU or 0.0, 500.0 / 100.0)
        self.assertAlmostEqual(o.T_jd or 0.0, 51545.0 + bb.TRUNCATED_JD_TO_JD_OFFSET)

    def test_mjd_t0_offset(self) -> None:
        entry = _orb6_visual(T0_val=51544.5, T0_unit="m")
        o = bb.orb6_to_canonical_elements(entry, plx_mas=10.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.T_jd or 0.0, 51544.5 + bb.MJD_TO_JD_OFFSET)

    def test_year_flag_mislabelled_truncated_jd_is_recovered(self) -> None:
        # ORB6 mislabels ~50 truncated-JD epochs with the 'y' flag (WDS
        # 04227+1503 Aa,Ab: 59501.496 for a 4-day pair). The year formula
        # would throw this past JD 2e7; the guard reinterprets it as a
        # truncated JD.
        entry = _orb6_visual(P_val=4.0, P_unit="d", T0_val=59501.496, T0_unit="y")
        o = bb.orb6_to_canonical_elements(entry, plx_mas=10.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.T_jd or 0.0, 59501.496 + bb.TRUNCATED_JD_TO_JD_OFFSET)

    def test_year_flag_genuine_year_unchanged(self) -> None:
        # A real Besselian-year epoch stays on the year formula.
        entry = _orb6_visual(T0_val=1990.0, T0_unit="y")
        o = bb.orb6_to_canonical_elements(entry, plx_mas=10.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(
            o.T_jd or 0.0, bb.J2000_REF_EPOCH_JD + (1990.0 - 2000.0) * 365.25)

    def test_unrecognised_t0_flag_returns_none(self) -> None:
        # Stray '1'/'5'/'7'/'c'/blank flags from fixed-column
        # misalignment carry no usable epoch → T_jd None (renderer falls
        # back to WDS-epoch placement); the rest of the orbit survives.
        entry = _orb6_visual(T0_val=111111111111.0, T0_unit="1")
        o = bb.orb6_to_canonical_elements(entry, plx_mas=10.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertIsNone(o.T_jd)
        self.assertIsNotNone(o.P_days)

    def test_year_flag_out_of_range_both_readings_returns_none(self) -> None:
        # A 'y' value implausible as both a year and a truncated JD drops
        # to None rather than a synthesised epoch.
        entry = _orb6_visual(T0_val=300000.0, T0_unit="y")
        o = bb.orb6_to_canonical_elements(entry, plx_mas=10.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertIsNone(o.T_jd)

    def test_centuries_period(self) -> None:
        entry = _orb6_visual(P_val=15.0, P_unit="c")
        o = bb.orb6_to_canonical_elements(entry, plx_mas=10.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.P_days or 0.0, 15.0 * 100.0 * 365.25)

    def test_unknown_period_unit_returns_none(self) -> None:
        # ORB6 has a handful of stray '0'/'9'/'3'/'1' codes from
        # fixed-column misalignment — skip rather than guess.
        entry = _orb6_visual(P_unit="0")
        self.assertIsNone(bb.orb6_to_canonical_elements(entry, plx_mas=10.0))

    def test_zero_period_returns_none(self) -> None:
        # A P_val of 0.0 must never mint elements: FLAG_HAS_ORBIT with
        # P=0 makes the runtime's M = 2π(t−T)/P NaN every frame.
        entry = _orb6_visual(P_val=0.0, P_unit="d")
        self.assertIsNone(bb.orb6_to_canonical_elements(entry, plx_mas=10.0))

    def test_missing_parallax_drops_a_au_but_keeps_angles(self) -> None:
        entry = _orb6_visual()
        o = bb.orb6_to_canonical_elements(entry, plx_mas=None)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertIsNone(o.a_AU)
        self.assertIsNone(o.distance_pc)
        self.assertIsNotNone(o.i_rad)
        self.assertIsNotNone(o.Omega_rad)
        self.assertIsNotNone(o.omega_rad)


class PickBestOrb6Tests(unittest.TestCase):
    def test_lowest_grade_wins(self) -> None:
        a = _orb6_visual(grade=4, ref="Old2010")
        b = _orb6_visual(grade=2, ref="Old1995")
        c = _orb6_visual(grade=3, ref="New2024")
        self.assertIs(bb._pick_best_orb6([a, b, c]), b)

    def test_grade_tie_breaks_to_most_recent_ref(self) -> None:
        a = _orb6_visual(grade=2, ref="Ake2021")
        b = _orb6_visual(grade=2, ref="Hei1995")
        c = _orb6_visual(grade=2, ref="Kpt2025")
        self.assertIs(bb._pick_best_orb6([a, b, c]), c)

    def test_ref_without_year_sorts_to_bottom_on_tie(self) -> None:
        a = _orb6_visual(grade=2, ref="Hei1995")
        b = _orb6_visual(grade=2, ref="OldRef")     # no parseable year
        self.assertIs(bb._pick_best_orb6([a, b]), a)


class SystemParallaxMasTests(unittest.TestCase):
    def test_primary_preferred(self) -> None:
        p = bb.ComponentAstrometry(
            astrometry_via="gaia_5p", ra_deg=0.0, dec_deg=0.0,
            parallax_mas=5.0, parallax_error_mas=0.05, pmra_masyr=0.0, pmdec_masyr=0.0,
            ref_epoch=2016.0,
        )
        s = bb.ComponentAstrometry(
            astrometry_via="gaia_5p", ra_deg=0.0, dec_deg=0.0,
            parallax_mas=4.5, parallax_error_mas=0.05, pmra_masyr=0.0, pmdec_masyr=0.0,
            ref_epoch=2016.0,
        )
        self.assertEqual(bb._system_parallax_mas([p, s]), 5.0)

    def test_secondary_fallback_when_primary_missing(self) -> None:
        p = bb.ComponentAstrometry(
            astrometry_via="unresolved", ra_deg=None, dec_deg=None,
            parallax_mas=None, parallax_error_mas=None, pmra_masyr=None, pmdec_masyr=None,
            ref_epoch=None,
        )
        s = bb.ComponentAstrometry(
            astrometry_via="gaia_5p", ra_deg=0.0, dec_deg=0.0,
            parallax_mas=3.2, parallax_error_mas=0.05, pmra_masyr=0.0, pmdec_masyr=0.0,
            ref_epoch=2016.0,
        )
        self.assertEqual(bb._system_parallax_mas([p, s]), 3.2)

    def test_no_parallax_returns_none(self) -> None:
        a = bb.ComponentAstrometry(
            astrometry_via="unresolved", ra_deg=None, dec_deg=None,
            parallax_mas=None, parallax_error_mas=None, pmra_masyr=None, pmdec_masyr=None,
            ref_epoch=None,
        )
        self.assertIsNone(bb._system_parallax_mas([a, a]))

    def test_non_positive_parallax_skipped(self) -> None:
        # Negative-parallax DR3 rows (within the noise of distant
        # sources) are skipped at the system level — they would map
        # to a negative distance otherwise.
        bad = bb.ComponentAstrometry(
            astrometry_via="gaia_5p", ra_deg=0.0, dec_deg=0.0,
            parallax_mas=-1.0, parallax_error_mas=0.05, pmra_masyr=0.0, pmdec_masyr=0.0,
            ref_epoch=2016.0,
        )
        good = bb.ComponentAstrometry(
            astrometry_via="gaia_5p", ra_deg=0.0, dec_deg=0.0,
            parallax_mas=2.5, parallax_error_mas=0.05, pmra_masyr=0.0, pmdec_masyr=0.0,
            ref_epoch=2016.0,
        )
        self.assertEqual(bb._system_parallax_mas([bad, good]), 2.5)


def _ast(
    parallax_mas: float | None = 10.0,
    parallax_error_mas: float | None = 0.05,
) -> "bb.ComponentAstrometry":
    return bb.ComponentAstrometry(
        astrometry_via="gaia_5p",
        ra_deg=0.0, dec_deg=0.0,
        parallax_mas=parallax_mas,
        parallax_error_mas=parallax_error_mas,
        pmra_masyr=0.0, pmdec_masyr=0.0,
        ref_epoch=2016.0,
    )


def _indices_for_orbit(
    *, src_to_nss: dict[int, dict[str, str]] | None = None,
) -> "bb.IdentifierIndices":
    return bb.build_indices(
        athyg=[], hip2=[],
        hip_to_gaia={}, tyc_to_gaia={},
        src_to_nss=src_to_nss or {},
    )


class SelectOrbitTests(unittest.TestCase):
    def test_orb6_visual_beats_nss_inside_regime(self) -> None:
        nss_row = _nss_orbital_row(period_days=200.0)
        idx = _indices_for_orbit(src_to_nss={42: nss_row})
        prim = _resolved(gaia=42, component="A", is_primary=True)
        sec = _resolved(gaia=None, component="B", is_primary=False)
        orb = [_orb6_visual(grade=1, ref="Hei2020")]
        orbit, via = bb.select_orbit(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(), secondary_astrometry=_ast(),
            orb6_for_pair=orb, indices=idx,
        )
        self.assertEqual(via, "orb6")
        self.assertIsNotNone(orbit)
        assert orbit is not None
        self.assertIsNotNone(orbit.a_AU)

    def test_nss_claims_pair_without_orb6_visual(self) -> None:
        nss_row = _nss_orbital_row(period_days=200.0)
        idx = _indices_for_orbit(src_to_nss={42: nss_row})
        prim = _resolved(gaia=42, component="A", is_primary=True)
        sec = _resolved(gaia=None, component="B", is_primary=False)
        orbit, via = bb.select_orbit(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(), secondary_astrometry=_ast(),
            orb6_for_pair=[], indices=idx,
        )
        self.assertEqual(via, "gaia_nss")
        self.assertIsNotNone(orbit)
        assert orbit is not None
        self.assertIsNone(orbit.a_AU)

    def test_nss_out_of_regime_routes_none_without_orb6(self) -> None:
        # P = 10 yr, a0 not below 1″ from TI (synthesised at
        # 5_000 mas = 5″ — outside both gates).
        nss_row = _nss_orbital_row(period_days=10 * 365.25, a_mas=5000.0)
        idx = _indices_for_orbit(src_to_nss={42: nss_row})
        prim = _resolved(gaia=42, component="A", is_primary=True)
        sec = _resolved(gaia=None, component="B", is_primary=False)
        orbit, via = bb.select_orbit(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(), secondary_astrometry=_ast(),
            orb6_for_pair=[], indices=idx,
        )
        self.assertEqual(via, "none")
        self.assertIsNone(orbit)

    def test_nss_long_period_but_sub_arcsec_still_claims(self) -> None:
        # 10 yr but a0 = 500 mas → < 1″ gate trips, NSS claims the
        # (ORB6-less) pair.
        nss_row = _nss_orbital_row(period_days=10 * 365.25, a_mas=500.0)
        idx = _indices_for_orbit(src_to_nss={42: nss_row})
        prim = _resolved(gaia=42, component="A", is_primary=True)
        sec = _resolved(gaia=None, component="B", is_primary=False)
        orbit, via = bb.select_orbit(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(), secondary_astrometry=_ast(),
            orb6_for_pair=[], indices=idx,
        )
        self.assertEqual(via, "gaia_nss")
        self.assertIsNotNone(orbit)

    def test_secondary_nss_row_used_when_primary_unresolved(self) -> None:
        nss_row = _nss_orbital_row(period_days=100.0)
        idx = _indices_for_orbit(src_to_nss={99: nss_row})
        prim = _resolved(gaia=None, component="A", is_primary=True)
        sec = _resolved(gaia=99, component="B", is_primary=False)
        orbit, via = bb.select_orbit(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(), secondary_astrometry=_ast(),
            orb6_for_pair=[], indices=idx,
        )
        self.assertEqual(via, "gaia_nss")
        self.assertIsNotNone(orbit)

    def test_nss_skipped_when_partner_is_distinct_source(self) -> None:
        # The NSS orbit describes source 99's own sub-companion; the
        # AB pair's other side is a DIFFERENT resolved source, so
        # attaching the orbit to AB would misattribute it (it belongs
        # to a synthesized inner pair — see subdivide.py).
        nss_row = _nss_orbital_row(period_days=100.0)
        idx = _indices_for_orbit(src_to_nss={99: nss_row})
        prim = _resolved(gaia=42, component="A", is_primary=True)
        sec = _resolved(gaia=99, component="B", is_primary=False)
        orbit, via = bb.select_orbit(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(), secondary_astrometry=_ast(),
            orb6_for_pair=[], indices=idx,
        )
        self.assertEqual(via, "none")
        self.assertIsNone(orbit)

    def test_nss_attaches_when_pair_shares_blended_source(self) -> None:
        # Castor CIA 29 shape: both sides carry the same blended
        # source, so the NSS orbit IS the pair's own.
        nss_row = _nss_orbital_row(period_days=100.0)
        idx = _indices_for_orbit(src_to_nss={42: nss_row})
        prim = _resolved(gaia=42, component="Aa", is_primary=True)
        sec = _resolved(gaia=42, component="Ab", is_primary=False)
        _, via = bb.select_orbit(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(), secondary_astrometry=_ast(),
            orb6_for_pair=[], indices=idx,
        )
        self.assertEqual(via, "gaia_nss")

    def test_nss_rejected_when_wds_separation_far_exceeds_orbit(self) -> None:
        # υ⁴ Eri shape: a 0.97-day inner NSS orbit on the blended
        # primary, partner unresolved (passes the distinct-source gate),
        # but the WDS pair is 5.5″ wide at ~54 pc (~297 AU) — orders of
        # magnitude too wide for a sub-day orbit at any mass, so the
        # separation-sanity gate rejects and the wide pair routes to none.
        nss_row = _nss_orbital_row(period_days=0.9702)
        idx = _indices_for_orbit(src_to_nss={42: nss_row})
        prim = _resolved(gaia=42, component="A", is_primary=True)
        sec = _resolved(gaia=None, component="B", is_primary=False)
        orbit, via = bb.select_orbit(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(18.5), secondary_astrometry=_ast(18.5),
            orb6_for_pair=[], indices=idx,
            wds_rho_arcsec=5.5,
        )
        self.assertEqual(via, "none")
        self.assertIsNone(orbit)

    def test_nss_kept_when_pair_is_sub_resolution(self) -> None:
        # The subdivide.py-synthesized inner pair (the orbit's true home)
        # is sub-resolution: ρ = 0.0. The gate can't evaluate a zero
        # separation, so it stays consistent and the orbit attaches.
        nss_row = _nss_orbital_row(period_days=0.9702)
        idx = _indices_for_orbit(src_to_nss={42: nss_row})
        prim = _resolved(gaia=42, component="Aa", is_primary=True)
        sec = _resolved(gaia=42, component="Ab", is_primary=False)
        _, via = bb.select_orbit(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(18.5), secondary_astrometry=_ast(18.5),
            orb6_for_pair=[], indices=idx,
            wds_rho_arcsec=0.0,
        )
        self.assertEqual(via, "gaia_nss")

    def test_nss_kept_when_wds_separation_consistent(self) -> None:
        # A genuine resolved-scale NSS pair: 200-day orbit, ρ = 0.05″ at
        # 100 pc (~5 AU) sits well inside the Kepler upper-bound envelope,
        # so the orbit attaches.
        nss_row = _nss_orbital_row(period_days=200.0)
        idx = _indices_for_orbit(src_to_nss={42: nss_row})
        prim = _resolved(gaia=42, component="A", is_primary=True)
        sec = _resolved(gaia=None, component="B", is_primary=False)
        _, via = bb.select_orbit(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(10.0), secondary_astrometry=_ast(10.0),
            orb6_for_pair=[], indices=idx,
            wds_rho_arcsec=0.05,
        )
        self.assertEqual(via, "gaia_nss")

    def test_nss_gate_uses_system_parallax_when_pair_unresolved(self) -> None:
        # ε Cep shape: the pair's own two components both resolved to
        # `unresolved` (no pair-local parallax), so the gate falls back to
        # the system-anchor parallax compute_system_parallaxes supplies.
        # A sub-day orbit vs a 5.5″ pair at ~54 pc is rejected on that
        # anchor distance; with no anchor the gate can't evaluate ρ and
        # the orbit attaches — so the fallback is what fires the reject.
        nss_row = _nss_orbital_row(period_days=0.9702)
        idx = _indices_for_orbit(src_to_nss={42: nss_row})
        prim = _resolved(gaia=42, component="A", is_primary=True)
        sec = _resolved(gaia=None, component="B", is_primary=False)
        kwargs = dict(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(None), secondary_astrometry=_ast(None),
            orb6_for_pair=[], indices=idx,
            wds_rho_arcsec=5.5,
        )
        _, via_no_anchor = bb.select_orbit(**kwargs)
        self.assertEqual(via_no_anchor, "gaia_nss")
        _, via_with_anchor = bb.select_orbit(**kwargs, system_parallax_mas=18.5)
        self.assertEqual(via_with_anchor, "none")

    def test_orb6_grade_tiebreak_lowest_wins(self) -> None:
        idx = _indices_for_orbit()
        prim = _resolved(gaia=42, component="A", is_primary=True)
        sec = _resolved(gaia=None, component="B", is_primary=False)
        # Tag each grade with a distinct T0_val so the assertion below
        # confirms which entry was actually picked.
        orb = [
            _orb6_visual(grade=4, ref="Old1990", T0_val=1990.0),
            _orb6_visual(grade=2, ref="Old1985", T0_val=1985.0),
            _orb6_visual(grade=3, ref="New2025", T0_val=2025.0),
        ]
        orbit, via = bb.select_orbit(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(), secondary_astrometry=_ast(),
            orb6_for_pair=orb, indices=idx,
        )
        self.assertEqual(via, "orb6")
        self.assertIsNotNone(orbit)
        assert orbit is not None
        self.assertAlmostEqual(
            orbit.T_jd or 0.0,
            bb.J2000_REF_EPOCH_JD + (1985.0 - 2000.0) * 365.25,
        )

    def test_orb6_spectroscopic_grade_9_when_no_visual(self) -> None:
        idx = _indices_for_orbit()
        prim = _resolved(gaia=42, component="A", is_primary=True)
        sec = _resolved(gaia=None, component="B", is_primary=False)
        orb = [_orb6_visual(grade=9, ref="Spc2020")]
        orbit, via = bb.select_orbit(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(), secondary_astrometry=_ast(),
            orb6_for_pair=orb, indices=idx,
        )
        self.assertEqual(via, "orb6_spectroscopic")
        self.assertIsNotNone(orbit)

    def test_visual_orb6_beats_spectroscopic_when_both_present(self) -> None:
        idx = _indices_for_orbit()
        prim = _resolved(gaia=42, component="A", is_primary=True)
        sec = _resolved(gaia=None, component="B", is_primary=False)
        orb = [
            _orb6_visual(grade=4, ref="Vis1990"),
            _orb6_visual(grade=9, ref="Spc2025"),
        ]
        _, via = bb.select_orbit(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(), secondary_astrometry=_ast(),
            orb6_for_pair=orb, indices=idx,
        )
        self.assertEqual(via, "orb6")

    def test_visual_only_pair_with_no_orbits_routes_to_none(self) -> None:
        idx = _indices_for_orbit()
        prim = _resolved(gaia=42, component="A", is_primary=True)
        sec = _resolved(gaia=None, component="B", is_primary=False)
        orbit, via = bb.select_orbit(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(), secondary_astrometry=_ast(),
            orb6_for_pair=[], indices=idx,
        )
        self.assertEqual(via, "none")
        self.assertIsNone(orbit)

    def test_grade_7_orb6_routes_spectroscopic(self) -> None:
        # Grade 7 (photometric / eclipsing fits — YY Gem) rides the
        # non-visual route alongside 8/9, never the visual one.
        idx = _indices_for_orbit()
        prim = _resolved(gaia=42, component="A", is_primary=True)
        sec = _resolved(gaia=None, component="B", is_primary=False)
        orb = [_orb6_visual(grade=7, ref="Sgr2000")]
        _, via = bb.select_orbit(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(), secondary_astrometry=_ast(),
            orb6_for_pair=orb, indices=idx,
        )
        self.assertEqual(via, "orb6_spectroscopic")


class NssSeparationConsistentTests(unittest.TestCase):
    def test_wide_separation_for_short_period_is_inconsistent(self) -> None:
        row = _nss_orbital_row(period_days=0.9702)
        self.assertFalse(
            bb._nss_separation_consistent(row, wds_rho_arcsec=5.5, plx_mas=18.5)
        )

    def test_missing_or_zero_rho_is_consistent(self) -> None:
        row = _nss_orbital_row(period_days=0.9702)
        self.assertTrue(
            bb._nss_separation_consistent(row, wds_rho_arcsec=None, plx_mas=18.5)
        )
        self.assertTrue(
            bb._nss_separation_consistent(row, wds_rho_arcsec=0.0, plx_mas=18.5)
        )

    def test_missing_parallax_is_consistent(self) -> None:
        row = _nss_orbital_row(period_days=0.9702)
        self.assertTrue(
            bb._nss_separation_consistent(row, wds_rho_arcsec=5.5, plx_mas=None)
        )

    def test_missing_period_is_consistent(self) -> None:
        row = _nss_orbital_row(period_days=0.9702)
        row["period"] = ""
        self.assertTrue(
            bb._nss_separation_consistent(row, wds_rho_arcsec=5.5, plx_mas=18.5)
        )


class IterDecomposingPairsTests(unittest.TestCase):
    def test_skips_non_decomposing_pair(self) -> None:
        # Pair "ABC" doesn't split (3-letter unbraced is ambiguous).
        # Resolve_all_pairs would emit zero components for it; the
        # iterator must skip without consuming a slot.
        p1 = _wds_pair(wds_id="W1", components="AB")
        p2 = _wds_pair(wds_id="W2", components="ABC")
        p3 = _wds_pair(wds_id="W3", components="CD")
        comps = [
            _resolved(gaia=1, wds_id="W1", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="W1", component="B", is_primary=False),
            _resolved(gaia=3, wds_id="W3", component="C", is_primary=True),
            _resolved(gaia=4, wds_id="W3", component="D", is_primary=False),
        ]
        ast = [_ast(), _ast(), _ast(), _ast()]
        yielded = list(bb.iter_decomposing_pairs([p1, p2, p3], comps, ast))
        self.assertEqual(len(yielded), 2)
        self.assertEqual(yielded[0][0].wds_id, "W1")
        self.assertEqual(yielded[1][0].wds_id, "W3")

    def test_cursor_desync_raises(self) -> None:
        # Inject a mismatch: pair W1 expects components named W1 but
        # the parallel list has W2 in slot 0 → must raise.
        p = _wds_pair(wds_id="W1", components="AB")
        comps = [
            _resolved(gaia=1, wds_id="W2", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="W2", component="B", is_primary=False),
        ]
        ast = [_ast(), _ast()]
        with self.assertRaises(RuntimeError):
            list(bb.iter_decomposing_pairs([p], comps, ast))

    def test_length_mismatch_raises(self) -> None:
        p = _wds_pair(wds_id="W1", components="AB")
        with self.assertRaises(ValueError):
            list(bb.iter_decomposing_pairs(
                [p],
                [_resolved(gaia=1)],
                [_ast(), _ast()],
            ))


class IterDecomposingPairComponentsTests(unittest.TestCase):
    """The astrometry-free walk (Stage 2 passes that run before
    astrometry exists) shares the same skip + validation primitive as
    ``iter_decomposing_pairs``."""

    def test_yields_primary_secondary_skipping_nondecomposing(self) -> None:
        p1 = _wds_pair(wds_id="W1", components="AB")
        p2 = _wds_pair(wds_id="W2", components="ABC")  # ambiguous → skipped
        comps = [
            _resolved(gaia=1, wds_id="W1", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="W1", component="B", is_primary=False),
        ]
        yielded = list(bb.iter_decomposing_pair_components([p1, p2], comps))
        self.assertEqual([(y[1].component, y[2].component) for y in yielded],
                         [("A", "B")])

    def test_cursor_desync_raises(self) -> None:
        p = _wds_pair(wds_id="W1", components="AB")
        comps = [
            _resolved(gaia=1, wds_id="W2", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="W2", component="B", is_primary=False),
        ]
        with self.assertRaises(RuntimeError):
            list(bb.iter_decomposing_pair_components([p], comps))


class SelectOrbitsAllTests(unittest.TestCase):
    def test_per_pair_emission_order_matches_pairs(self) -> None:
        nss_row = _nss_orbital_row(period_days=200.0)
        p1 = _wds_pair(wds_id="W1", components="AB", rho_last=0.0)
        p2 = _wds_pair(wds_id="W2", components="AB")
        comps = [
            _resolved(gaia=42, wds_id="W1", component="A", is_primary=True),
            _resolved(gaia=None, wds_id="W1", component="B", is_primary=False),
            _resolved(gaia=43, wds_id="W2", component="A", is_primary=True),
            _resolved(gaia=None, wds_id="W2", component="B", is_primary=False),
        ]
        ast = [_ast(), _ast(), _ast(), _ast()]
        idx = _indices_for_orbit(src_to_nss={42: nss_row})
        # Visual ORB6 only on W2.
        orb6 = [_orb6_visual(grade=2, ref="Hei2020")]
        orb6[0] = bb.Orb6Entry(  # rebind to W2's id+components
            wds_id="W2", discoverer="TST   1", components="AB",
            hd=None, hip=None,
            P_val=50.0, P_unit="y", a_val=1.0, a_unit="a",
            i_deg=90.0, Omega_deg=45.0, omega_deg=30.0, e=0.5,
            T0_val=1990.0, T0_unit="y",
            grade=2, ref="Ref2020",
        )
        out = bb.select_orbits_all(
            pairs=[p1, p2], components=comps, astrometry=ast,
            orb6=orb6, indices=idx,
        )
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0][1], "gaia_nss")
        self.assertEqual(out[1][1], "orb6")


class OrbitCountsTests(unittest.TestCase):
    def test_every_canonical_key_present(self) -> None:
        rows: list[tuple[bb.OrbitElements | None, str]] = [
            (None, "gaia_nss"),
            (None, "orb6"),
            (None, "none"),
        ]
        counts = bb.orbit_counts(rows)
        self.assertEqual(set(counts.keys()), set(bb.ORBIT_VIA_VALUES))
        self.assertEqual(counts["gaia_nss"], 1)
        self.assertEqual(counts["orb6"], 1)
        self.assertEqual(counts["orb6_spectroscopic"], 0)
        self.assertEqual(counts["none"], 1)


# ─── Stage 5 (optical-pair filter) ───────────────────────────────────


def _wds_pair(
    *,
    wds_id: str = "WDS-1",
    discoverer: str = "TST   1",
    components: str = "AB",
    notes: str = "    ",
    rho_last: float | None = 5.0,
    theta_last: float | None = 90.0,
    mag_pri: float | None = 4.0,
    mag_sec: float | None = 6.0,
    precise_ra_deg: float | None = 100.0,
    precise_dec_deg: float | None = 0.0,
    date_last: int | None = 2020,
    spectral: str = "",
    date_first: int | None = None,
    theta_first: float | None = None,
    rho_first: float | None = None,
) -> "bb.WdsPair":
    return bb.WdsPair(
        wds_id=wds_id, discoverer=discoverer, components=components,
        date_last=date_last, rho_last=rho_last, theta_last=theta_last,
        mag_pri=mag_pri, mag_sec=mag_sec, spectral=spectral,
        notes=notes,
        precise_ra_deg=precise_ra_deg, precise_dec_deg=precise_dec_deg,
        date_first=date_first, theta_first=theta_first,
        rho_first=rho_first,
    )


class ClassifyPairOpticalTests(unittest.TestCase):
    """Stage 5 cascade per-tier branches. Each test pins one tier with
    a fixture that no other tier can decide, so the routing is
    unambiguous."""

    def _classify(
        self,
        *,
        notes: str = "    ",
        primary_gaia: int | None = None,
        secondary_gaia: int | None = None,
        primary_hip: int | None = None,
        secondary_hip: int | None = None,
        src_to_astrometry: dict[int, "bb.GaiaAstrometryRow"] | None = None,
        hip2: list["bb.Hip2Row"] | None = None,
        mag_pri: float | None = None,
        mag_sec: float | None = None,
        orbit_via: str = "none",
        rho_last: float | None = 5.0,
        system_parallax_anchor: "tuple[float, float | None] | None" = None,
        total_mass_msun: float | None = None,
    ) -> "bb.OpticalClassification":
        pair = _wds_pair(
            notes=notes, mag_pri=mag_pri, mag_sec=mag_sec, rho_last=rho_last,
        )
        primary = _resolved(
            gaia=primary_gaia, hip=primary_hip,
            component="A", is_primary=True,
        )
        secondary = _resolved(
            gaia=secondary_gaia, hip=secondary_hip,
            component="B", is_primary=False,
        )
        indices = _indices_with_astrometry(
            src_to_astrometry=src_to_astrometry or {},
            hip2=hip2 or [],
        )
        return bb.classify_pair_optical(
            pair, primary, secondary, orbit_via, indices,
            system_parallax_anchor, total_mass_msun,
        )

    def test_wds_notes_physical_keeps(self) -> None:
        result = self._classify(notes="V   ")
        self.assertTrue(result.is_physical)
        self.assertEqual(result.optical_via, "wds_notes_kept")

    def test_wds_notes_optical_rejects(self) -> None:
        result = self._classify(notes="U   ")
        self.assertFalse(result.is_physical)
        self.assertEqual(result.optical_via, "wds_notes_rejected")

    def test_wds_notes_optical_wins_over_physical_when_both_present(self) -> None:
        result = self._classify(notes="VU  ")
        self.assertFalse(result.is_physical)
        self.assertEqual(result.optical_via, "wds_notes_rejected")

    def test_both_gaia_consistent_plx_keeps(self) -> None:
        p = _gaia_astrometry_row(
            source_id=1, parallax_mas=10.0, parallax_error_mas=0.05,
            pmra_masyr=10.0, pmdec_masyr=-5.0,
        )
        s = _gaia_astrometry_row(
            source_id=2, parallax_mas=10.01, parallax_error_mas=0.05,
            pmra_masyr=10.1, pmdec_masyr=-4.9,
        )
        result = self._classify(
            primary_gaia=1, secondary_gaia=2,
            src_to_astrometry={1: p, 2: s},
        )
        self.assertTrue(result.is_physical)
        self.assertEqual(result.optical_via, "gaia_kept")

    def test_both_gaia_within_limit_disagreement_falls_to_velocity(self) -> None:
        # 10.0 vs 10.05 mas with σ=0.001 each: 3σ-discordant but only
        # ~0.5 pc apart. A within-limit parallax disagreement no longer
        # rejects on its own (blend-corrupted close-pair parallaxes must
        # not split a bound pair); it falls to the escape-velocity
        # sub-gate, and with matching PM (Δv=0) the pair is kept. A larger
        # >1 pc split rejects at the separation gate (tier 3); a beyond-
        # limit both-Gaia split rejects in _both_gaia_consistent —
        # see test_both_gaia_beyond_limit_disagreement_rejects.
        p = _gaia_astrometry_row(
            source_id=1, parallax_mas=10.0, parallax_error_mas=0.001,
        )
        s = _gaia_astrometry_row(
            source_id=2, parallax_mas=10.05, parallax_error_mas=0.001,
        )
        result = self._classify(
            primary_gaia=1, secondary_gaia=2,
            src_to_astrometry={1: p, 2: s},
        )
        self.assertTrue(result.is_physical)
        self.assertEqual(result.optical_via, "gaia_kept")

    def test_both_gaia_beyond_limit_disagreement_rejects(self) -> None:
        # The tier-4 parallax reject fires only beyond the bound-pair
        # limit — the same guard tier 5 applies. Tested on the helper
        # directly: via classify_pair_optical a beyond-limit well-measured
        # pair rejects one tier earlier (tier 3), so this path is only
        # reachable for a Gaia parallax below tier 3's poe floor.
        # 10.0 vs 5.0 mas (100 vs 200 pc, ~100 pc apart), no ρ.
        p = _gaia_astrometry_row(
            source_id=1, parallax_mas=10.0, parallax_error_mas=0.001,
        )
        s = _gaia_astrometry_row(
            source_id=2, parallax_mas=5.0, parallax_error_mas=0.001,
        )
        self.assertIs(
            bb._both_gaia_consistent(p, s, None, 6.0), False,
        )

    def test_both_gaia_escape_velocity_rejects(self) -> None:
        # Parallax agrees, but the PM difference implies a transverse
        # velocity far above escape for the pair's mass/separation —
        # unrelated space motion, an optical double at the same distance.
        p = _gaia_astrometry_row(
            source_id=1, parallax_mas=10.0, parallax_error_mas=0.05,
            pmra_masyr=0.0, pmdec_masyr=0.0,
        )
        s = _gaia_astrometry_row(
            source_id=2, parallax_mas=10.0, parallax_error_mas=0.05,
            pmra_masyr=200.0, pmdec_masyr=0.0,
        )
        result = self._classify(
            primary_gaia=1, secondary_gaia=2,
            src_to_astrometry={1: p, 2: s},
        )
        self.assertFalse(result.is_physical)
        self.assertEqual(result.optical_via, "gaia_rejected")

    def test_both_gaia_escape_velocity_keeps_orbital_motion(self) -> None:
        # η Cas-shape: parallax agrees, a real orbital PM split that
        # stays well inside escape velocity → kept (the old 5 mas/yr PM
        # cut would have wrongly rejected this).
        p = _gaia_astrometry_row(
            source_id=1, parallax_mas=10.0, parallax_error_mas=0.05,
            pmra_masyr=0.0, pmdec_masyr=0.0,
        )
        s = _gaia_astrometry_row(
            source_id=2, parallax_mas=10.0, parallax_error_mas=0.05,
            pmra_masyr=10.0, pmdec_masyr=0.0,
        )
        result = self._classify(
            primary_gaia=1, secondary_gaia=2,
            src_to_astrometry={1: p, 2: s},
        )
        self.assertTrue(result.is_physical)
        self.assertEqual(result.optical_via, "gaia_kept")

    def test_escape_gate_orbital_pm_budget_raises_reject_threshold(self) -> None:
        # 22039-2451 AC shape: parallax-concordant CPM pair whose Δpm
        # carries the host component's orbital motion. v_t ≈ 14.2 km/s at
        # 100 pc vs 2.5·v_esc ≈ 11.5 km/s → rejected with no budget, kept
        # once the sub-pair's ~5 km/s orbital-PM budget raises the bar.
        p = _gaia_astrometry_row(
            source_id=1, parallax_mas=10.0, parallax_error_mas=0.01,
            pmra_masyr=0.0, pmdec_masyr=0.0,
        )
        s = _gaia_astrometry_row(
            source_id=2, parallax_mas=10.0, parallax_error_mas=0.01,
            pmra_masyr=30.0, pmdec_masyr=0.0,
        )
        pair = _wds_pair(rho_last=5.0)
        primary = _resolved(gaia=1, component="A", is_primary=True)
        secondary = _resolved(gaia=2, component="C", is_primary=False)
        indices = _indices_with_astrometry(src_to_astrometry={1: p, 2: s})
        rejected = bb.classify_pair_optical(
            pair, primary, secondary, "none", indices,
        )
        self.assertEqual(rejected.optical_via, "gaia_rejected")
        kept = bb.classify_pair_optical(
            pair, primary, secondary, "none", indices,
            orbital_pm_budget_km_s=5.0,
        )
        self.assertEqual(kept.optical_via, "gaia_kept")

    def test_escape_gate_budget_needs_positive_collocation(self) -> None:
        # AR Cas AF/AG shape: distant pair whose parallax errors leave a
        # ~pc-scale depth uncertainty — the pair is not POSITIVELY inside
        # the tidal limit, so the orbital-PM budget is withheld and the
        # unbound-association rejection stands.
        p = _gaia_astrometry_row(
            source_id=1, parallax_mas=4.9, parallax_error_mas=0.03,
            pmra_masyr=0.0, pmdec_masyr=0.0,
        )
        s = _gaia_astrometry_row(
            source_id=2, parallax_mas=4.9, parallax_error_mas=0.03,
            pmra_masyr=3.6, pmdec_masyr=0.0,
        )
        pair = _wds_pair(rho_last=67.0)
        primary = _resolved(gaia=1, component="A", is_primary=True)
        secondary = _resolved(gaia=2, component="F", is_primary=False)
        indices = _indices_with_astrometry(src_to_astrometry={1: p, 2: s})
        result = bb.classify_pair_optical(
            pair, primary, secondary, "none", indices,
            total_mass_msun=9.9,
            orbital_pm_budget_km_s=10.0,
        )
        self.assertEqual(result.optical_via, "gaia_rejected")

    def test_orbital_pm_budget_from_tighter_hosted_subpairs(self) -> None:
        # System: AC under test (ρ 28″) + AB at 3.4″ (measured, no
        # elements) + Aa,Ab spectroscopic (P = 6 d — averaged out of the
        # Gaia PM fit) + an unrelated-side BC-wider pair. Budget = v_circ
        # of AB only.
        ac = _wds_pair(wds_id="22039-2451", components="AC", rho_last=28.0)
        ab = _wds_pair(wds_id="22039-2451", components="AB", rho_last=3.4)
        aa_ab = _wds_pair(
            wds_id="22039-2451", components="Aa,Ab", rho_last=0.0,
        )
        pairs = [ac, ab, aa_ab]
        orbits: list[tuple] = [
            (None, "none"),
            (None, "none"),
            (bb.OrbitElements(
                P_days=6.066, T_jd=None, e=None, a_AU=0.08,
                i_rad=None, omega_rad=None, Omega_rad=None,
                q=None, distance_pc=None,
            ), "msc"),
        ]
        masses = [1.2, 1.6, 1.5]
        anchor_plx = 21.2  # d ≈ 47.17 pc
        budget = bb._orbital_pm_budget_km_s(
            0, ("A", "C"), ac.rho_last, [0, 1, 2], pairs, orbits, masses,
            anchor_plx,
        )
        r_ab_au = 3.4 * (1000.0 / anchor_plx)
        expected = 2.0 * math.pi * bb.KM_S_PER_AU_YR * math.sqrt(1.6 / r_ab_au)
        self.assertAlmostEqual(budget, expected, places=6)
        # The pair's own row contributes nothing to itself; a pair under
        # test with no measured ρ gets no budget at all.
        self.assertEqual(
            bb._orbital_pm_budget_km_s(
                2, ("Aa", "Ab"), aa_ab.rho_last, [0, 1, 2], pairs, orbits,
                masses, anchor_plx,
            ),
            0.0,
        )

    def test_orbital_pm_budget_ignores_unrelated_and_wider_pairs(self) -> None:
        # BD's components don't move with A or C; DE is wider than the
        # pair under test. Neither contributes.
        ac = _wds_pair(wds_id="W-1", components="AC", rho_last=28.0)
        bd = _wds_pair(wds_id="W-1", components="BD", rho_last=3.0)
        de = _wds_pair(wds_id="W-1", components="DE", rho_last=90.0)
        pairs = [ac, bd, de]
        orbits: list[tuple] = [(None, "none")] * 3
        budget = bb._orbital_pm_budget_km_s(
            0, ("A", "C"), ac.rho_last, [0, 1, 2], pairs, orbits, None, 21.2,
        )
        self.assertEqual(budget, 0.0)

    def test_classify_all_pairs_applies_orbital_pm_budget(self) -> None:
        # End-to-end: the AC verdict flips to kept because the same
        # system's AB pair budgets A's orbital PM. Δpm 22.4 mas/yr at
        # ~47 pc → v_t ≈ 5.0 km/s vs 2.5·v_esc ≈ 3.2 km/s alone,
        # ≤ 3.2 + 3.0 with AB's budget.
        rows = {
            1: _gaia_astrometry_row(
                source_id=1, parallax_mas=21.29, parallax_error_mas=0.05,
                pmra_masyr=0.0, pmdec_masyr=0.0,
            ),
            2: _gaia_astrometry_row(
                source_id=2, parallax_mas=21.19, parallax_error_mas=0.05,
                pmra_masyr=22.4, pmdec_masyr=0.0,
            ),
            3: _gaia_astrometry_row(
                source_id=3, parallax_mas=21.25, parallax_error_mas=0.05,
                pmra_masyr=1.0, pmdec_masyr=0.0,
            ),
        }
        indices = _indices_with_astrometry(src_to_astrometry=rows)
        ac = _wds_pair(wds_id="22039-2451", components="AC", rho_last=28.0)
        ab = _wds_pair(wds_id="22039-2451", components="AB", rho_last=3.4)
        components = [
            _resolved(gaia=1, wds_id="22039-2451", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="22039-2451", component="C", is_primary=False),
            _resolved(gaia=1, wds_id="22039-2451", component="A", is_primary=True),
            _resolved(gaia=3, wds_id="22039-2451", component="B", is_primary=False),
        ]
        anchors = {"22039-2451": (21.2, 0.1)}
        out = bb.classify_all_pairs(
            [ac, ab], components, [(None, "none"), (None, "none")],
            indices, system_parallax_anchors=anchors,
            pair_masses=[1.2, 1.6],
        )
        self.assertEqual(out[0].optical_via, "gaia_kept")
        # Without the sibling pair the same Δpm rejects.
        alone = bb.classify_all_pairs(
            [ac], components[:2], [(None, "none")],
            indices, system_parallax_anchors=anchors, pair_masses=[1.2],
        )
        self.assertEqual(alone[0].optical_via, "gaia_rejected")

    def test_sep_limit_rejects_discordant_companion(self) -> None:
        # Pollux F shape: the primary is Gaia-saturated (tiers 4/5 silent
        # for it), the secondary carries a well-measured own Gaia distance
        # (~297 pc) far beyond the system parallax anchor (~10.4 pc).
        s = _gaia_astrometry_row(
            source_id=2, ra_deg=100.0, dec_deg=0.0,
            parallax_mas=3.36, parallax_error_mas=0.31,  # ~297 pc, poe ~11
        )
        result = self._classify(
            secondary_gaia=2, src_to_astrometry={2: s},
            rho_last=57.3, system_parallax_anchor=(96.5, 0.3),  # ~10.4 pc
        )
        self.assertFalse(result.is_physical)
        self.assertEqual(result.optical_via, "sep_limit_rejected")

    def test_sep_limit_keeps_concordant_companion(self) -> None:
        # Own distance agrees with the anchor within the bound-pair limit
        # → tier 3 silent, falls through to the mag-gap backstop (kept).
        s = _gaia_astrometry_row(
            source_id=2, ra_deg=100.0, dec_deg=0.0,
            parallax_mas=100.5, parallax_error_mas=0.05,  # ~9.95 pc
        )
        result = self._classify(
            secondary_gaia=2, src_to_astrometry={2: s},
            mag_pri=4.0, mag_sec=6.0,
            system_parallax_anchor=(100.0, 0.05),  # ~10 pc
        )
        self.assertTrue(result.is_physical)
        self.assertEqual(result.optical_via, "mag_heuristic_kept")

    def test_sep_limit_silent_without_anchor(self) -> None:
        s = _gaia_astrometry_row(
            source_id=2, parallax_mas=3.36, parallax_error_mas=0.31,
        )
        result = self._classify(
            secondary_gaia=2, src_to_astrometry={2: s},
            mag_pri=4.0, mag_sec=6.0,
            system_parallax_anchor=None,
        )
        self.assertEqual(result.optical_via, "mag_heuristic_kept")

    def test_sep_limit_low_poe_not_rejected(self) -> None:
        # Far and discordant, but poorly measured (poe ~3.4 < floor) —
        # the audit's UNCERTAIN bucket: leave it be.
        s = _gaia_astrometry_row(
            source_id=2, ra_deg=100.0, dec_deg=0.0,
            parallax_mas=3.36, parallax_error_mas=1.0,
        )
        result = self._classify(
            secondary_gaia=2, src_to_astrometry={2: s},
            mag_pri=4.0, mag_sec=6.0,
            system_parallax_anchor=(100.0, 0.05),
        )
        self.assertTrue(result.is_physical)
        self.assertEqual(result.optical_via, "mag_heuristic_kept")

    def test_mag_heuristic_keeps_close_pair(self) -> None:
        result = self._classify(mag_pri=4.0, mag_sec=6.0)
        self.assertTrue(result.is_physical)
        self.assertEqual(result.optical_via, "mag_heuristic_kept")

    def test_mag_heuristic_rejects_wide_gap(self) -> None:
        result = self._classify(mag_pri=2.0, mag_sec=10.0)
        self.assertFalse(result.is_physical)
        self.assertEqual(result.optical_via, "mag_heuristic_rejected")

    def test_mag_heuristic_keeps_when_no_data(self) -> None:
        result = self._classify()
        self.assertTrue(result.is_physical)
        self.assertEqual(result.optical_via, "mag_heuristic_kept")

    def test_orbit_on_file_overrides_mag_gap_sirius_ab(self) -> None:
        # Sirius A-B archetype: 9.9-mag gap, but a grade-2 ORB6 visual
        # orbit is on file → orbit_kept wins.
        result = self._classify(
            mag_pri=-1.47, mag_sec=8.44, orbit_via="orb6",
        )
        self.assertTrue(result.is_physical)
        self.assertEqual(result.optical_via, "orbit_kept")

    def test_orbit_on_file_overrides_no_data_case(self) -> None:
        result = self._classify(orbit_via="gaia_nss")
        self.assertTrue(result.is_physical)
        self.assertEqual(result.optical_via, "orbit_kept")

    def test_orbit_overrides_within_bounds_gaia_disagreement(self) -> None:
        # An orbit on file overrides a both-Gaia σ-disagreement: the
        # orbit tier (tier 2) short-circuits above the separation (tier 3)
        # and both-Gaia (tier 4) gates. (Distances 100 vs ~99.5 pc:
        # 3σ-discordant on tiny errors, but < 1 pc apart.)
        p = _gaia_astrometry_row(
            source_id=1, parallax_mas=10.0, parallax_error_mas=0.001,
        )
        s = _gaia_astrometry_row(
            source_id=2, parallax_mas=10.05, parallax_error_mas=0.001,
        )
        result = self._classify(
            primary_gaia=1, secondary_gaia=2,
            src_to_astrometry={1: p, 2: s},
            orbit_via="orb6",
        )
        self.assertTrue(result.is_physical)
        self.assertEqual(result.optical_via, "orbit_kept")

    def test_orbit_overrides_separation_limit(self) -> None:
        # An orbit on file wins over the separation gate: a close visual
        # pair's blended Gaia parallaxes (here a spurious ~kpc split) do
        # not beat a tracked relative orbit. (NSS leaks onto genuinely
        # wide companions are blocked upstream in Stage 4, so the pairs
        # the separation gate must catch carry no orbit.)
        s = _gaia_astrometry_row(
            source_id=2, ra_deg=100.0, dec_deg=0.0,
            parallax_mas=3.36, parallax_error_mas=0.31,
        )
        result = self._classify(
            secondary_gaia=2, src_to_astrometry={2: s},
            orbit_via="orb6", rho_last=57.3,
            system_parallax_anchor=(96.5, 0.3),
        )
        self.assertTrue(result.is_physical)
        self.assertEqual(result.optical_via, "orbit_kept")

    def test_asymm_gaia_sirius_shaped_rejects(self) -> None:
        # Sirius A-C archetype: A at 378 mas (HIP2, ~2.64 pc), C at
        # ~0.5 mas (Gaia, ~2 kpc). The Gaia parallax is poorly measured
        # (poe ~3.3 < the separation gate's floor, so that gate stays
        # silent), but the ~kpc split is 2500σ-discordant against the
        # HIP2 anchor → the asymmetric tier rejects it. (A well-measured
        # Gaia parallax at this distance routes through the separation
        # gate instead — same reject, different tier.)
        s = _gaia_astrometry_row(
            source_id=2, parallax_mas=0.5, parallax_error_mas=0.15,
        )
        hip2 = _hip2_row(hip=32349, plx_mas=378.0)
        result = self._classify(
            primary_gaia=None, secondary_gaia=2,
            primary_hip=32349,
            src_to_astrometry={2: s},
            hip2=[hip2],
        )
        self.assertFalse(result.is_physical)
        self.assertEqual(result.optical_via, "asymm_rejected")

    def test_asymm_gaia_consistent_keeps(self) -> None:
        s = _gaia_astrometry_row(
            source_id=2, parallax_mas=10.0, parallax_error_mas=0.1,
        )
        hip2 = _hip2_row(hip=1, plx_mas=10.01)
        result = self._classify(
            primary_gaia=None, secondary_gaia=2,
            primary_hip=1,
            src_to_astrometry={2: s},
            hip2=[hip2],
        )
        self.assertTrue(result.is_physical)
        self.assertEqual(result.optical_via, "asymm_kept")

    def test_asymm_symmetric_primary_gaia_secondary_hip2(self) -> None:
        p = _gaia_astrometry_row(
            source_id=1, parallax_mas=10.0, parallax_error_mas=0.1,
        )
        hip2 = _hip2_row(hip=2, plx_mas=10.01)
        result = self._classify(
            primary_gaia=1, secondary_gaia=None,
            secondary_hip=2,
            src_to_astrometry={1: p},
            hip2=[hip2],
        )
        self.assertTrue(result.is_physical)
        self.assertEqual(result.optical_via, "asymm_kept")

    def test_asymm_within_physical_tolerance_keeps(self) -> None:
        # AU Mic-shape: Gaia (~9.7 pc) vs HIP2 anchor (~10.6 pc). The
        # 3σ-significant parallax difference is a HIP2-vs-Gaia zero-point
        # systematic worth < 1 pc — kept, not split.
        s = _gaia_astrometry_row(
            source_id=2, parallax_mas=103.1, parallax_error_mas=0.02,
        )
        hip2 = _hip2_row(hip=5, plx_mas=94.3)
        result = self._classify(
            primary_gaia=None, secondary_gaia=2,
            primary_hip=5,
            src_to_astrometry={2: s},
            hip2=[hip2],
        )
        self.assertTrue(result.is_physical)
        self.assertEqual(result.optical_via, "asymm_kept")


class SeparationGeometryTests(unittest.TestCase):
    """Tier-3/tier-5 separation helpers. Projected term from ρ at the
    reference distance; radial term counted only when the parallax
    difference clears the combined-error significance threshold."""

    def test_projected_only_when_radial_insignificant(self) -> None:
        # Same distance to within error: only the ρ-projected term counts.
        sep = bb._separation_au(10.0, 0.05, 10.0, 0.05, rho_arcsec=5.0)
        self.assertAlmostEqual(sep, 5.0 * 100.0, places=3)  # ρ × 100 pc

    def test_radial_counted_when_significant(self) -> None:
        # Pollux F: 96.5 vs 3.36 mas → ~287 pc radial gap dominates.
        sep_pc = bb._separation_au(96.5, 0.3, 3.36, 0.31, 57.3) / bb.AU_PER_PC
        self.assertGreater(sep_pc, 280.0)

    def test_radial_suppressed_within_combined_error(self) -> None:
        # A depth gap smaller than 3σ of the combined error is treated as
        # noise — radial term drops, only ρ-projection remains.
        sep = bb._separation_au(10.0, 5.0, 9.0, 5.0, rho_arcsec=1.0)
        d_ref = 1000.0 / 10.0
        self.assertAlmostEqual(sep, 1.0 * d_ref, places=3)

    def test_exceeds_limit_true_for_optical_double(self) -> None:
        self.assertTrue(
            bb._separation_exceeds_limit(96.5, 0.3, 3.36, 0.31, 57.3),
        )

    def test_exceeds_limit_false_within_one_pc(self) -> None:
        # 10.6 vs 9.7 pc ≈ 0.9 pc gap, under the 1 pc limit.
        self.assertFalse(
            bb._separation_exceeds_limit(94.3, None, 103.1, 0.02, 5.0),
        )


def _cpm_pair(
    *,
    date_first: int | None = 1900,
    theta_first: float | None = 90.0,
    rho_first: float | None = 5.0,
    date_last: int | None = 2000,
    theta_last: float | None = 90.0,
    rho_last: float | None = 5.0,
) -> "bb.WdsPair":
    """A 100-yr-baseline pair; defaults hold the relative geometry
    static (the CPM-confirmed shape)."""
    return _wds_pair(
        date_first=date_first, theta_first=theta_first,
        rho_first=rho_first, date_last=date_last,
        theta_last=theta_last, rho_last=rho_last,
        mag_pri=4.0, mag_sec=6.0,
    )


class CpmBaselineVerdictTests(unittest.TestCase):
    """cpm_baseline_verdict — the 61 Cyg shape: PM 5.2″/yr over a
    century predicts ~520″ of slip for a background star."""

    PM_HIGH = (4100.0, -3200.0)   # |PM| = 5.2 arcsec/yr

    def test_static_geometry_keeps(self) -> None:
        # Relative sep/PA unchanged across the baseline → co-moving.
        self.assertIs(
            bb.cpm_baseline_verdict(_cpm_pair(), *self.PM_HIGH), False,
        )

    def test_drift_tracking_slip_rejects(self) -> None:
        # 295″ of drift ≥ 0.5 × 520″ predicted slip → background star.
        pair = _cpm_pair(rho_last=300.0)
        self.assertIs(bb.cpm_baseline_verdict(pair, *self.PM_HIGH), True)

    def test_pa_only_drift_rejects(self) -> None:
        # Same ρ, PA swings 90° → tangent-plane drift ρ·√2 ≈ 283″.
        pair = _cpm_pair(rho_first=200.0, rho_last=200.0, theta_last=180.0)
        self.assertIs(bb.cpm_baseline_verdict(pair, *self.PM_HIGH), True)

    def test_intermediate_drift_inconclusive(self) -> None:
        # 100″ drift: above the keep floor, below half the slip → None.
        pair = _cpm_pair(rho_last=105.0)
        self.assertIsNone(bb.cpm_baseline_verdict(pair, *self.PM_HIGH))

    def test_low_pm_primary_silent(self) -> None:
        # 50 mas/yr × 100 yr = 5″ predicted slip < CPM_SLIP_MIN_ARCSEC —
        # no discriminating power even for drifting geometry.
        pair = _cpm_pair(rho_last=300.0)
        self.assertIsNone(bb.cpm_baseline_verdict(pair, 50.0, 0.0))

    def test_missing_first_epoch_silent(self) -> None:
        pair = _cpm_pair(rho_first=None)
        self.assertIsNone(bb.cpm_baseline_verdict(pair, *self.PM_HIGH))

    def test_missing_pm_silent(self) -> None:
        self.assertIsNone(bb.cpm_baseline_verdict(_cpm_pair(), None, -3200.0))

    def test_zero_baseline_silent(self) -> None:
        pair = _cpm_pair(date_first=2000, date_last=2000, rho_last=300.0)
        self.assertIsNone(bb.cpm_baseline_verdict(pair, *self.PM_HIGH))


class CpmTierIntegrationTests(unittest.TestCase):
    """Tier 6a routing inside classify_pair_optical: engages only for an
    inherited/synthesized secondary distance with primary PM on file;
    silent otherwise so tier 6 keeps deciding."""

    def _classify(
        self,
        pair: "bb.WdsPair",
        *,
        secondary_via: str = "unresolved",
        primary_astro: "bb.ComponentAstrometry | None" = None,
        secondary_astro: "bb.ComponentAstrometry | None" = None,
    ) -> "bb.OpticalClassification":
        primary = _resolved(gaia=None, component="A", is_primary=True)
        secondary = _resolved(
            gaia=None, component="B", is_primary=False, via="unresolved",
        )
        if primary_astro is None:
            primary_astro = _component_astrometry(
                astrometry_via="gaia_5p",
                pmra_masyr=4100.0, pmdec_masyr=-3200.0,
            )
        if secondary_astro is None:
            secondary_astro = _component_astrometry(
                astrometry_via=secondary_via,
                parallax_mas=None, parallax_error_mas=None,
                pmra_masyr=None, pmdec_masyr=None,
            )
        indices = _indices_with_astrometry()
        return bb.classify_pair_optical(
            pair, primary, secondary, "none", indices,
            primary_astrometry=primary_astro,
            secondary_astrometry=secondary_astro,
        )

    def test_inherited_secondary_drift_rejects(self) -> None:
        result = self._classify(_cpm_pair(rho_last=300.0))
        self.assertFalse(result.is_physical)
        self.assertEqual(result.optical_via, "cpm_baseline_rejected")

    def test_inherited_secondary_static_keeps(self) -> None:
        result = self._classify(_cpm_pair())
        self.assertTrue(result.is_physical)
        self.assertEqual(result.optical_via, "cpm_baseline_kept")

    def test_athyg_position_secondary_engages(self) -> None:
        result = self._classify(
            _cpm_pair(rho_last=300.0), secondary_via="athyg_position",
        )
        self.assertEqual(result.optical_via, "cpm_baseline_rejected")

    def test_own_parallax_secondary_falls_through(self) -> None:
        # A gaia_5p secondary was already 3D-cross-checked upstream —
        # tier 6a stays silent and the mag gap decides.
        result = self._classify(
            _cpm_pair(rho_last=300.0), secondary_via="gaia_5p",
        )
        self.assertEqual(result.optical_via, "mag_heuristic_kept")

    def test_no_astrometry_falls_through(self) -> None:
        pair = _cpm_pair(rho_last=300.0)
        primary = _resolved(gaia=None, component="A", is_primary=True)
        secondary = _resolved(
            gaia=None, component="B", is_primary=False, via="unresolved",
        )
        result = bb.classify_pair_optical(
            pair, primary, secondary, "none", _indices_with_astrometry(),
        )
        self.assertEqual(result.optical_via, "mag_heuristic_kept")

    def test_pm_less_primary_borrows_system_pm_anchor(self) -> None:
        # An identity-less pair primary (no own PM, rides the Stage-6
        # system anchor) borrows the system PM anchor — the drift
        # verdict survives stripping a stolen identity's PM.
        result = self._classify(
            _cpm_pair(rho_last=300.0),
            primary_astro=_component_astrometry(
                astrometry_via="unresolved",
                parallax_mas=None, parallax_error_mas=None,
                pmra_masyr=None, pmdec_masyr=None,
            ),
        )
        self.assertEqual(result.optical_via, "mag_heuristic_kept")
        pair = _cpm_pair(rho_last=300.0)
        primary = _resolved(gaia=None, component="B", is_primary=True)
        secondary = _resolved(
            gaia=None, component="C", is_primary=False, via="unresolved",
        )
        result = bb.classify_pair_optical(
            pair, primary, secondary, "none", _indices_with_astrometry(),
            primary_astrometry=_component_astrometry(
                astrometry_via="unresolved",
                parallax_mas=None, parallax_error_mas=None,
                pmra_masyr=None, pmdec_masyr=None,
            ),
            secondary_astrometry=_component_astrometry(
                astrometry_via="unresolved",
                parallax_mas=None, parallax_error_mas=None,
                pmra_masyr=None, pmdec_masyr=None,
            ),
            system_pm_anchor=(4100.0, -3200.0),
        )
        self.assertEqual(result.optical_via, "cpm_baseline_rejected")

    def test_classify_all_pairs_astrometry_cardinality(self) -> None:
        pair = _cpm_pair()
        components = [
            _resolved(gaia=None, component="A", is_primary=True),
            _resolved(
                gaia=None, component="B", is_primary=False,
                via="unresolved",
            ),
        ]
        with self.assertRaises(ValueError):
            bb.classify_all_pairs(
                [pair], components, [(None, "none")],
                _indices_with_astrometry(),
                astrometry=[_component_astrometry()],
            )


class PairBeyondSeparationLimitTests(unittest.TestCase):
    """Separation-gate helper. Compares the pair's two components against
    each other (own parallax, or the system anchor when a component has
    none); rejects only off a well-measured own parallax (poe ≥ floor)
    beyond the physical bound-pair limit."""

    ANCHOR = (96.5, 0.3)  # Pollux, ~10.4 pc

    def _pair(
        self, *, primary_gaia=None, secondary_gaia=None,
        src_to_astrometry=None,
    ):
        primary = _resolved(gaia=primary_gaia, component="A", is_primary=True)
        secondary = _resolved(
            gaia=secondary_gaia, component="B", is_primary=False,
        )
        indices = _indices_with_astrometry(
            src_to_astrometry=src_to_astrometry or {},
        )
        return primary, secondary, indices

    def test_pollux_f_shape_beyond_limit(self) -> None:
        # Primary has no own parallax → falls back to the ~10.4 pc anchor;
        # secondary (F) at ~297 pc → beyond limit.
        s = _gaia_astrometry_row(
            source_id=2, ra_deg=100.0, dec_deg=0.0,
            parallax_mas=3.36, parallax_error_mas=0.31,
        )
        p, sec, indices = self._pair(secondary_gaia=2, src_to_astrometry={2: s})
        self.assertTrue(
            bb._pair_beyond_separation_limit(p, sec, self.ANCHOR, 57.3, indices),
        )

    def test_inner_binary_same_source_kept(self) -> None:
        # A synthesized inner binary: both components share one blended
        # source at ~229 pc, far from a ~137 pc system anchor. Comparing
        # the two components to each other → same distance → within limit,
        # not split against the unrelated anchor.
        row = _gaia_astrometry_row(
            source_id=9, ra_deg=100.0, dec_deg=0.0,
            parallax_mas=4.36, parallax_error_mas=0.02,
        )
        p, sec, indices = self._pair(
            primary_gaia=9, secondary_gaia=9, src_to_astrometry={9: row},
        )
        self.assertFalse(
            bb._pair_beyond_separation_limit(p, sec, (7.32, 0.02), 0.0, indices),
        )

    def test_concordant_within_limit(self) -> None:
        s = _gaia_astrometry_row(
            source_id=2, ra_deg=100.0, dec_deg=0.0,
            parallax_mas=100.5, parallax_error_mas=0.05,
        )
        p, sec, indices = self._pair(secondary_gaia=2, src_to_astrometry={2: s})
        self.assertFalse(
            bb._pair_beyond_separation_limit(p, sec, (100.0, 0.05), 5.0, indices),
        )

    def test_low_poe_not_rejected(self) -> None:
        s = _gaia_astrometry_row(
            source_id=2, ra_deg=100.0, dec_deg=0.0,
            parallax_mas=3.36, parallax_error_mas=1.0,  # poe ~3.4 < 5
        )
        p, sec, indices = self._pair(secondary_gaia=2, src_to_astrometry={2: s})
        self.assertFalse(
            bb._pair_beyond_separation_limit(p, sec, self.ANCHOR, 57.3, indices),
        )

    def test_no_parallax_either_side_not_rejected(self) -> None:
        p, sec, indices = self._pair()
        self.assertFalse(
            bb._pair_beyond_separation_limit(p, sec, self.ANCHOR, 57.3, indices),
        )


class EscapeVelocityTests(unittest.TestCase):
    """Escape / transverse velocity helpers underpinning the both-Gaia
    velocity sub-gate."""

    def test_escape_velocity_matches_known_value(self) -> None:
        # 1 M_sun at 1 AU: v_escape = √2 × 29.78 ≈ 42.1 km/s.
        v = bb._escape_velocity_km_s(1.0, 1.0)
        self.assertAlmostEqual(v, 42.12, places=1)

    def test_escape_velocity_none_for_zero_separation(self) -> None:
        self.assertIsNone(bb._escape_velocity_km_s(1.0, 0.0))

    def test_transverse_velocity(self) -> None:
        # 100 mas/yr at 5.95 pc ≈ 2.82 km/s (η Cas orbital split).
        v = bb._transverse_velocity_km_s(100.0, 5.95)
        self.assertAlmostEqual(v, 2.82, places=2)


class OpticalCountsTests(unittest.TestCase):
    def test_every_canonical_key_present(self) -> None:
        rows = [
            bb.OpticalClassification(True, "gaia_kept"),
            bb.OpticalClassification(False, "asymm_rejected"),
            bb.OpticalClassification(True, "wds_notes_kept"),
            bb.OpticalClassification(True, "orbit_kept"),
        ]
        counts = bb.optical_counts(rows)
        self.assertEqual(set(counts.keys()), set(bb.OPTICAL_VIA_VALUES))
        self.assertEqual(counts["gaia_kept"], 1)
        self.assertEqual(counts["asymm_rejected"], 1)
        self.assertEqual(counts["wds_notes_kept"], 1)
        self.assertEqual(counts["orbit_kept"], 1)
        self.assertEqual(counts["mag_heuristic_rejected"], 0)


# ─── Stage 6 (multiples.tsv emit) ────────────────────────────────────


def _component_astrometry(
    *,
    astrometry_via: str = "gaia_5p",
    ra_deg: float | None = 100.0,
    dec_deg: float | None = 0.0,
    parallax_mas: float | None = 10.0,
    parallax_error_mas: float | None = 0.05,
    pmra_masyr: float | None = 1.0,
    pmdec_masyr: float | None = -1.0,
    ref_epoch: float | None = 2016.0,
) -> "bb.ComponentAstrometry":
    return bb.ComponentAstrometry(
        astrometry_via=astrometry_via,
        ra_deg=ra_deg, dec_deg=dec_deg,
        parallax_mas=parallax_mas,
        parallax_error_mas=parallax_error_mas,
        pmra_masyr=pmra_masyr, pmdec_masyr=pmdec_masyr,
        ref_epoch=ref_epoch,
    )


class BuildMultiplesRowsTests(unittest.TestCase):
    def test_drops_optical_classified_pairs(self) -> None:
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True, via="orb6_hip"),
            _resolved(gaia=2, component="B", is_primary=False, via="orb6_hip"),
        ]
        astrometry = [_component_astrometry(), _component_astrometry()]
        orbits = [(None, "none")]
        classifications = [bb.OpticalClassification(False, "gaia_rejected")]
        indices = _indices_with_astrometry()

        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertEqual(rows, [])

    def test_emits_two_rows_per_physical_pair(self) -> None:
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True, via="orb6_hip"),
            _resolved(gaia=2, component="B", is_primary=False, via="athyg_gaia_native"),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        orbits = [(None, "none")]
        classifications = [bb.OpticalClassification(True, "wds_notes_kept")]
        indices = _indices_with_astrometry()

        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0].orbit_role, "primary")
        self.assertEqual(rows[1].orbit_role, "secondary")
        self.assertEqual(rows[0].system_id, "WDS-1-AB")
        self.assertEqual(rows[0].resolve_via, "orb6_hip")
        self.assertEqual(rows[1].resolve_via, "athyg_gaia_native")
        self.assertEqual(rows[0].comp, "A")
        self.assertEqual(rows[1].comp, "B")

    def test_drops_pair_when_both_components_lack_position_and_no_anchor(self) -> None:
        # No other pair in the system has astrometry → the wds_id has no
        # anchor → inheritance can't recover, and the pair drops.
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=None, ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
            _component_astrometry(parallax_mas=None, ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
        ]
        orbits = [(None, "none")]
        classifications = [bb.OpticalClassification(True, "wds_notes_kept")]
        indices = _indices_with_astrometry()

        dropped_no_position: list[str] = []
        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
            dropped_no_position=dropped_no_position,
        )
        self.assertEqual(rows, [])
        self.assertEqual(dropped_no_position, ["WDS-1AB"])

    def test_hd_surfaces_from_component_athyg_row(self) -> None:
        # ξ UMa shape: the AT-HYG row carries HD; the emitted row must
        # surface it so the catalog-side identifier backfill can join
        # HD-only catalog records by HD instead of position.
        pair = _wds_pair(components="AB")
        athyg = [
            _athyg_row(gaia=1, hd=98231),
            _athyg_row(gaia=2),
        ]
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [_component_astrometry(), _component_astrometry()]
        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[bb.OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(athyg=athyg),
        )
        self.assertEqual(rows[0].hd, 98231)
        self.assertIsNone(rows[1].hd)

    def test_hd_falls_back_to_orb6_component_hd(self) -> None:
        # ξ UMa's actual shape: the AT-HYG row binds to a different
        # component, so the pair primary's HD comes from the
        # coord-validated ORB6 entry Stage 2 stashed on the component.
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True,
                      hip=55203, hd=98231),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [_component_astrometry(), _component_astrometry()]
        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[bb.OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(),
        )
        self.assertEqual(rows[0].hd, 98231)

    def test_inherits_system_anchor_when_pair_lacks_position(self) -> None:
        # 40 Eri BC shape — the AB pair anchors the system with A's
        # Gaia 5p; the BC pair's components both have unresolved
        # astrometry (tight inner binary blended out of DR3). System
        # inheritance lets BC emit with A's position and the
        # ``astrometry_via=system_inherited`` tag.
        ab_pair = _wds_pair(wds_id="04153-0739", components="AB")
        bc_pair = _wds_pair(wds_id="04153-0739", components="BC")
        components = [
            _resolved(gaia=1, wds_id="04153-0739", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="04153-0739", component="B", is_primary=False),
            _resolved(gaia=3, wds_id="04153-0739", component="B", is_primary=True),
            _resolved(gaia=4, wds_id="04153-0739", component="C", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0, ra_deg=0.0, dec_deg=0.0),
            _component_astrometry(parallax_mas=None, ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
            _component_astrometry(parallax_mas=None, ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
            _component_astrometry(parallax_mas=None, ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
        ]
        orbits = [(None, "none"), (None, "none")]
        classifications = [
            bb.OpticalClassification(True, "wds_notes_kept"),
            bb.OpticalClassification(True, "wds_notes_kept"),
        ]
        indices = _indices_with_astrometry(simbad_wds_spectra={
            ("04153-0739", "B"): "DA2.9",
        })

        rows = bb.build_multiples_rows(
            pairs=[ab_pair, bc_pair], components=components,
            astrometry=astrometry, orbits=orbits,
            classifications=classifications, indices=indices,
        )
        # AB → 2 rows (A direct, B unresolved-but-inherits anchor).
        # BC → 2 rows (B and C both inherit anchor).
        self.assertEqual(len(rows), 4)
        bc_b = next(r for r in rows if r.system_id == "04153-0739-BC" and r.comp == "B")
        self.assertEqual(bc_b.spect, "DA2.9")
        self.assertEqual(bc_b.spect_via, "simbad")
        self.assertEqual(bc_b.astrometry_via, bb.ASTROMETRY_VIA_SYSTEM_INHERITED)
        self.assertAlmostEqual(bc_b.dist_pc or 0.0, 100.0, places=6)
        # AB-B's astrometry was unresolved but it still inherits the
        # anchor; the via flips to system_inherited.
        ab_b = next(r for r in rows if r.system_id == "04153-0739-AB" and r.comp == "B")
        self.assertEqual(ab_b.astrometry_via, bb.ASTROMETRY_VIA_SYSTEM_INHERITED)
        # AB-A keeps its native gaia_5p tag.
        ab_a = next(r for r in rows if r.system_id == "04153-0739-AB" and r.comp == "A")
        self.assertEqual(ab_a.astrometry_via, "gaia_5p")

    def test_standalone_sweep_emits_simbad_components_outside_pair_walk(self) -> None:
        # A SIMBAD-known (wds_id, component) that doesn't appear as any
        # decomposing-pair side gets a standalone row via the standalone
        # sweep. Position inherits the system anchor; orbit_role is
        # ``standalone``.
        ab_pair = _wds_pair(wds_id="11111+1111", components="AB")
        components = [
            _resolved(gaia=1, wds_id="11111+1111", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="11111+1111", component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0, ra_deg=0.0, dec_deg=0.0),
            _component_astrometry(parallax_mas=10.0, ra_deg=0.0, dec_deg=0.0),
        ]
        orbits = [(None, "none")]
        classifications = [bb.OpticalClassification(True, "wds_notes_kept")]
        simbad_xids = {
            ("11111+1111", "A"): bb.SimbadWdsXid(
                simbad_oid=10, simbad_main_id="* A", gaia_source_id=1, hip=None,
            ),
            ("11111+1111", "B"): bb.SimbadWdsXid(
                simbad_oid=20, simbad_main_id="* B", gaia_source_id=2, hip=None,
            ),
            # C is SIMBAD-known but appears in no pair row.
            ("11111+1111", "C"): bb.SimbadWdsXid(
                simbad_oid=30, simbad_main_id="* C", gaia_source_id=3, hip=42,
            ),
        }
        indices = _indices_with_astrometry(simbad_wds_spectra={
            ("11111+1111", "C"): "M5V",
        })

        rows = bb.build_multiples_rows(
            pairs=[ab_pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices, simbad_xids=simbad_xids,
        )
        # AB → 2 rows; C → 1 standalone row.
        self.assertEqual(len(rows), 3)
        c_row = next(r for r in rows if r.comp == "C")
        self.assertEqual(c_row.system_id, "11111+1111-_C")
        self.assertEqual(c_row.orbit_role, "standalone")
        self.assertEqual(c_row.source, "simbad")
        self.assertEqual(c_row.spect, "M5V")
        self.assertEqual(c_row.spect_via, "simbad")
        self.assertEqual(c_row.regime, 0)
        self.assertEqual(c_row.hip, 42)
        self.assertEqual(c_row.gaia_source_id, 3)
        self.assertEqual(c_row.astrometry_via, bb.ASTROMETRY_VIA_SYSTEM_INHERITED)
        self.assertAlmostEqual(c_row.dist_pc or 0.0, 100.0, places=6)

    def test_standalone_sweep_skips_already_emitted_components(self) -> None:
        # A and B were emitted by the pair walk; the sweep must NOT
        # double-emit them even though they are in simbad_xids.
        ab_pair = _wds_pair(wds_id="22222+2222", components="AB")
        components = [
            _resolved(gaia=1, wds_id="22222+2222", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="22222+2222", component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0, ra_deg=0.0, dec_deg=0.0),
            _component_astrometry(parallax_mas=10.0, ra_deg=0.0, dec_deg=0.0),
        ]
        orbits = [(None, "none")]
        classifications = [bb.OpticalClassification(True, "wds_notes_kept")]
        simbad_xids = {
            ("22222+2222", "A"): bb.SimbadWdsXid(
                simbad_oid=10, simbad_main_id="* A", gaia_source_id=1, hip=None,
            ),
            ("22222+2222", "B"): bb.SimbadWdsXid(
                simbad_oid=20, simbad_main_id="* B", gaia_source_id=2, hip=None,
            ),
        }
        indices = _indices_with_astrometry()

        rows = bb.build_multiples_rows(
            pairs=[ab_pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices, simbad_xids=simbad_xids,
        )
        self.assertEqual(len(rows), 2)
        self.assertEqual(
            {r.orbit_role for r in rows}, {"primary", "secondary"},
        )


class ComputeSystemParallaxesTests(unittest.TestCase):
    def test_picks_first_resolved_parallax_in_system(self) -> None:
        # Primary unresolved, secondary resolves — the secondary's
        # parallax becomes the system value.
        pair = _wds_pair(wds_id="PX-1", components="AB")
        components = [
            _resolved(gaia=1, wds_id="PX-1", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="PX-1", component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=None, ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
            _component_astrometry(parallax_mas=20.0, ra_deg=0.0, dec_deg=0.0),
        ]
        plx = bb.compute_system_parallaxes([pair], components, astrometry)
        self.assertAlmostEqual(plx["PX-1"], 20.0, places=6)

    def test_prefers_primary_when_both_resolved(self) -> None:
        pair = _wds_pair(wds_id="PX-2", components="AB")
        components = [
            _resolved(gaia=1, wds_id="PX-2", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="PX-2", component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0, ra_deg=0.0, dec_deg=0.0),
            _component_astrometry(parallax_mas=20.0, ra_deg=0.0, dec_deg=0.0),
        ]
        plx = bb.compute_system_parallaxes([pair], components, astrometry)
        self.assertAlmostEqual(plx["PX-2"], 10.0, places=6)

    def test_first_pair_row_supplies_anchor_for_later_pair(self) -> None:
        # A multiple system: the AB pair resolves, the AC pair's own two
        # components are both unresolved. The one wds_id entry (from the
        # first system row) is the anchor a later all-unresolved pair
        # reads for the separation-sanity gate.
        pairs = [
            _wds_pair(wds_id="PX-3", components="AB"),
            _wds_pair(wds_id="PX-3", components="AC"),
        ]
        components = [
            _resolved(gaia=1, wds_id="PX-3", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="PX-3", component="B", is_primary=False),
            _resolved(gaia=3, wds_id="PX-3", component="A", is_primary=True),
            _resolved(gaia=4, wds_id="PX-3", component="C", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=12.5, ra_deg=0.0, dec_deg=0.0),
            _component_astrometry(parallax_mas=None, ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
            _component_astrometry(parallax_mas=None, ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
            _component_astrometry(parallax_mas=None, ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
        ]
        plx = bb.compute_system_parallaxes(pairs, components, astrometry)
        self.assertAlmostEqual(plx["PX-3"], 12.5, places=6)

    def test_no_entry_when_system_unresolved(self) -> None:
        pair = _wds_pair(wds_id="PX-4", components="AB")
        components = [
            _resolved(gaia=1, wds_id="PX-4", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="PX-4", component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=None, ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
            _component_astrometry(parallax_mas=None, ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
        ]
        plx = bb.compute_system_parallaxes([pair], components, astrometry)
        self.assertNotIn("PX-4", plx)


class ComputeSystemParallaxAnchorsTests(unittest.TestCase):
    def test_picks_first_resolved_parallax_and_error(self) -> None:
        pair = _wds_pair(wds_id="PA-1", components="AB")
        components = [
            _resolved(gaia=1, wds_id="PA-1", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="PA-1", component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=None, parallax_error_mas=None,
                                  ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
            _component_astrometry(parallax_mas=20.0, parallax_error_mas=0.4,
                                  ra_deg=0.0, dec_deg=0.0),
        ]
        anchors = bb.compute_system_parallax_anchors(
            [pair], components, astrometry,
        )
        self.assertEqual(anchors["PA-1"], (20.0, 0.4))

    def test_carries_none_error_through(self) -> None:
        # HIP2 rows the parser doesn't surface a σ for → error stays None.
        pair = _wds_pair(wds_id="PA-2", components="AB")
        components = [
            _resolved(gaia=1, wds_id="PA-2", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="PA-2", component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=12.0, parallax_error_mas=None,
                                  ra_deg=0.0, dec_deg=0.0,
                                  astrometry_via="hip2_long_baseline"),
            _component_astrometry(parallax_mas=11.0, parallax_error_mas=0.1,
                                  ra_deg=0.0, dec_deg=0.0),
        ]
        anchors = bb.compute_system_parallax_anchors(
            [pair], components, astrometry,
        )
        self.assertEqual(anchors["PA-2"], (12.0, None))

    def test_no_entry_when_system_unresolved(self) -> None:
        pair = _wds_pair(wds_id="PA-3", components="AB")
        components = [
            _resolved(gaia=1, wds_id="PA-3", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="PA-3", component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=None, parallax_error_mas=None,
                                  ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
            _component_astrometry(parallax_mas=None, parallax_error_mas=None,
                                  ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
        ]
        anchors = bb.compute_system_parallax_anchors(
            [pair], components, astrometry,
        )
        self.assertNotIn("PA-3", anchors)


class ComputePairMassesTests(unittest.TestCase):
    def test_sums_spectral_masses_per_pair(self) -> None:
        pair = _wds_pair(wds_id="PM-1", components="AB")
        components = [
            _resolved(gaia=1, wds_id="PM-1", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="PM-1", component="B", is_primary=False),
        ]
        indices = _indices_with_astrometry(
            simbad_wds_spectra={
                ("PM-1", "A"): "G0V",   # ~1.05 M_sun
                ("PM-1", "B"): "K7V",   # ~0.54 M_sun
            },
        )
        masses = bb.compute_pair_masses([pair], components, indices)
        self.assertEqual(len(masses), 1)
        self.assertAlmostEqual(masses[0], 1.05 + 0.54, places=2)

    def test_generous_default_when_type_unknown(self) -> None:
        pair = _wds_pair(wds_id="PM-2", components="AB")
        components = [
            _resolved(gaia=1, wds_id="PM-2", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="PM-2", component="B", is_primary=False),
        ]
        indices = _indices_with_astrometry()
        masses = bb.compute_pair_masses([pair], components, indices)
        self.assertAlmostEqual(
            masses[0], 2.0 * bb.ESCAPE_GATE_DEFAULT_COMPONENT_MASS_MSUN,
            places=6,
        )


class ComputeSystemAnchorsTests(unittest.TestCase):
    def test_picks_first_resolved_component_in_system(self) -> None:
        # Primary has unresolved astrometry, secondary resolves — the
        # secondary's position becomes the anchor.
        pair = _wds_pair(wds_id="ZZ-1", components="AB")
        components = [
            _resolved(gaia=1, wds_id="ZZ-1", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="ZZ-1", component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=None, ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
            _component_astrometry(parallax_mas=10.0, ra_deg=0.0, dec_deg=0.0),
        ]
        anchors = bb.compute_system_anchors([pair], components, astrometry)
        self.assertIn("ZZ-1", anchors)
        x, y, z, dist = anchors["ZZ-1"]
        self.assertAlmostEqual(dist, 100.0, places=6)
        self.assertAlmostEqual(x, 100.0, places=6)

    def test_prefers_primary_when_both_resolved(self) -> None:
        # First (primary) component wins the anchor slot when both have
        # astrometry — set distinctly so the slot is observably the
        # primary's value.
        pair = _wds_pair(wds_id="ZZ-2", components="AB")
        components = [
            _resolved(gaia=1, wds_id="ZZ-2", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="ZZ-2", component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0, ra_deg=0.0, dec_deg=0.0),
            _component_astrometry(parallax_mas=20.0, ra_deg=0.0, dec_deg=0.0),
        ]
        anchors = bb.compute_system_anchors([pair], components, astrometry)
        _, _, _, dist = anchors["ZZ-2"]
        self.assertAlmostEqual(dist, 100.0, places=6)

    def test_emits_no_anchor_when_no_component_in_system_resolves(self) -> None:
        pair = _wds_pair(wds_id="ZZ-3", components="AB")
        components = [
            _resolved(gaia=1, wds_id="ZZ-3", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="ZZ-3", component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=None, ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
            _component_astrometry(parallax_mas=None, ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
        ]
        anchors = bb.compute_system_anchors([pair], components, astrometry)
        self.assertNotIn("ZZ-3", anchors)

    def test_position_pc_from_parallax_and_radec(self) -> None:
        # 10 mas parallax → 100 pc; (RA, Dec) = (0, 0) → x-axis.
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0, ra_deg=0.0, dec_deg=0.0),
            _component_astrometry(parallax_mas=10.0, ra_deg=0.0, dec_deg=0.0),
        ]
        orbits = [(None, "none")]
        classifications = [bb.OpticalClassification(True, "wds_notes_kept")]
        indices = _indices_with_astrometry()

        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertAlmostEqual(rows[0].dist_pc or 0.0, 100.0, places=6)
        self.assertAlmostEqual(rows[0].x_pc or 0.0, 100.0, places=6)
        self.assertAlmostEqual(rows[0].y_pc or 0.0, 0.0, places=6)
        self.assertAlmostEqual(rows[0].z_pc or 0.0, 0.0, places=6)

    def test_position_pc_normalises_mixed_epoch_pair(self) -> None:
        # A bound pair measured at DIFFERENT native epochs — HIP2 primary
        # at J1991.25, Gaia secondary at J2016 — must bake xyz at ONE
        # scene epoch, so the static relative separation is the pair's
        # true J2016 configuration, not corrupted by (epoch gap × systemic
        # PM) — the mixed-epoch static-position bug.
        dist_pc = 100.0
        plx = 1000.0 / dist_pc
        pmra, pmdec = 3600.0, 0.0  # mas/yr systemic; 24.75 yr ≈ 89″ drift
        ra_p, dec_p = 150.0, 10.0  # primary true J2016 direction
        sep_true_arcsec = 5.0
        cosd = math.cos(math.radians(dec_p))
        # Secondary sits 5″ east of the primary at J2016.
        ra_s = ra_p + sep_true_arcsec / (3600.0 * cosd)
        # Primary is MEASURED at J1991.25 — its stored ra/dec is the J2016
        # direction rolled back 24.75 yr along the systemic PM.
        dt = bb.CATALOG_SCENE_EPOCH - 1991.25
        ra_p_1991 = ra_p - pmra * dt / (3600.0 * 1000.0 * cosd)
        dec_p_1991 = dec_p - pmdec * dt / (3600.0 * 1000.0)

        primary = _component_astrometry(
            ra_deg=ra_p_1991, dec_deg=dec_p_1991, parallax_mas=plx,
            pmra_masyr=pmra, pmdec_masyr=pmdec,
            astrometry_via="hip2_long_baseline", ref_epoch=1991.25,
        )
        secondary = _component_astrometry(
            ra_deg=ra_s, dec_deg=dec_p, parallax_mas=plx,
            pmra_masyr=pmra, pmdec_masyr=pmdec, ref_epoch=2016.0,
        )
        px, py, pz, _ = bb._position_pc(primary)
        sx, sy, sz, _ = bb._position_pc(secondary)
        au = 206264.806
        sep_au = math.sqrt((sx - px) ** 2 + (sy - py) ** 2 + (sz - pz) ** 2) * au
        # 5″ at 100 pc = 500 AU: the normalised pair reproduces it.
        self.assertAlmostEqual(sep_au, sep_true_arcsec * dist_pc, delta=1.0)

        # Without normalisation the primary sits at its J1991.25 direction,
        # 24.75 yr × 3.6″/yr ≈ 89″ (~8900 AU) off — the mis-separation the
        # fix removes.
        ux, uy, uz = bb._spherical_to_unit_vec(ra_p_1991, dec_p_1991)
        sep_au_stale = math.sqrt(
            (sx - ux * dist_pc) ** 2 + (sy - uy * dist_pc) ** 2
            + (sz - uz * dist_pc) ** 2
        ) * au
        self.assertGreater(sep_au_stale, 8000.0)

    def test_simbad_spectra_override_athyg_spect(self) -> None:
        # 40 Eri-shape: AT-HYG carries the primary's K0V across all
        # components (per-system inheritance). SIMBAD provides per-
        # component sp_type — DA2.9 for B. Stage 6 must prefer SIMBAD
        # and tag the row's ``spect_via`` accordingly.
        pair = _wds_pair(wds_id="04153-0739", components="AB")
        # AT-HYG rows: primary K0V, secondary inherits the same string
        # (the bug the SIMBAD migration fixes).
        athyg_rows = [
            bb.AthygRow(
                hip=19849, tyc=None, gaia=1, hd=None,
                ra_deg=0.0, dec_deg=0.0,
                x_pc=0.0, y_pc=0.0, z_pc=0.0,
                dist_pc=1.0, v_mag=None, absmag=4.4,
                ci=None, spect="K0V", proper="40 Eri A",
                pm_ra_masyr=None, pm_de_masyr=None,
            ),
            bb.AthygRow(
                hip=None, tyc=None, gaia=2, hd=None,
                ra_deg=0.0, dec_deg=0.0,
                x_pc=0.0, y_pc=0.0, z_pc=0.0,
                dist_pc=1.0, v_mag=None, absmag=11.2,
                ci=None, spect="K0V", proper="",
                pm_ra_masyr=None, pm_de_masyr=None,
            ),
        ]
        components = [
            _resolved(gaia=1, wds_id="04153-0739",
                      component="A", is_primary=True),
            _resolved(gaia=2, wds_id="04153-0739",
                      component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        orbits = [(None, "none")]
        classifications = [bb.OpticalClassification(True, "wds_notes_kept")]
        indices = _indices_with_astrometry(
            athyg=athyg_rows,
            simbad_wds_spectra={
                ("04153-0739", "A"): "K0V",
                ("04153-0739", "B"): "DA2.9",
            },
        )

        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0].spect, "K0V")
        self.assertEqual(rows[0].spect_via, "simbad")
        self.assertEqual(rows[1].spect, "DA2.9")
        self.assertEqual(rows[1].spect_via, "simbad")

    def test_athyg_fallback_when_simbad_missing(self) -> None:
        # SIMBAD has no entry for this (wds_id, component) — fall back
        # to AT-HYG and tag ``spect_via="athyg"``.
        pair = _wds_pair(wds_id="XX-1", components="AB")
        athyg_rows = [
            bb.AthygRow(
                hip=None, tyc=None, gaia=10, hd=None,
                ra_deg=0.0, dec_deg=0.0,
                x_pc=0.0, y_pc=0.0, z_pc=0.0,
                dist_pc=1.0, v_mag=None, absmag=5.0,
                ci=None, spect="G2V", proper="",
                pm_ra_masyr=None, pm_de_masyr=None,
            ),
            bb.AthygRow(
                hip=None, tyc=None, gaia=20, hd=None,
                ra_deg=0.0, dec_deg=0.0,
                x_pc=0.0, y_pc=0.0, z_pc=0.0,
                dist_pc=1.0, v_mag=None, absmag=6.0,
                ci=None, spect="G2V", proper="",
                pm_ra_masyr=None, pm_de_masyr=None,
            ),
        ]
        components = [
            _resolved(gaia=10, wds_id="XX-1",
                      component="A", is_primary=True),
            _resolved(gaia=20, wds_id="XX-1",
                      component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        orbits = [(None, "none")]
        classifications = [bb.OpticalClassification(True, "wds_notes_kept")]
        indices = _indices_with_astrometry(athyg=athyg_rows)

        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertEqual(rows[0].spect, "G2V")
        self.assertEqual(rows[0].spect_via, "athyg")
        self.assertEqual(rows[1].spect, "G2V")
        self.assertEqual(rows[1].spect_via, "athyg")

    def test_spect_via_none_when_neither_source_has_spect(self) -> None:
        # AT-HYG row missing (component resolved via WDS-only path) and
        # no SIMBAD entry — spect is empty and ``spect_via="none"``.
        pair = _wds_pair(wds_id="YY-1", components="AB")
        components = [
            _resolved(gaia=1, wds_id="YY-1",
                      component="A", is_primary=True),
            _resolved(gaia=2, wds_id="YY-1",
                      component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        orbits = [(None, "none")]
        classifications = [bb.OpticalClassification(True, "wds_notes_kept")]
        indices = _indices_with_astrometry()

        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertEqual(rows[0].spect, "")
        self.assertEqual(rows[0].spect_via, "none")

    def test_orbit_via_to_regime_mapping(self) -> None:
        # Sanity-check: every ORBIT_VIA_VALUES key maps cleanly, and
        # the legacy regime numbering (0 = none, 2 = full, 3 = spec)
        # is preserved.
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [_component_astrometry(), _component_astrometry()]
        classifications = [bb.OpticalClassification(True, "wds_notes_kept")]
        indices = _indices_with_astrometry()

        for via, expected_regime in (
            ("gaia_nss", 2), ("orb6", 2),
            ("orb6_spectroscopic", 3), ("none", 0),
        ):
            rows = bb.build_multiples_rows(
                pairs=[pair], components=components, astrometry=astrometry,
                orbits=[(None, via)], classifications=classifications,
                indices=indices,
            )
            self.assertEqual(rows[0].regime, expected_regime, msg=via)
            self.assertEqual(rows[1].regime, expected_regime, msg=via)


class SepPaEpochPropagationTests(unittest.TestCase):
    """Stage 6 must thread WDS ``rho_last`` / ``theta_last`` /
    ``date_last`` / Δmag through to the per-pair geometry columns so
    the runtime layer can project Tier-3 (no-orbit) companions at
    their published sky offset and the companion-promotion step in
    build-catalog can impute absmag from Δmag."""

    def test_pair_rows_carry_published_rho_theta_year(self) -> None:
        pair = _wds_pair(
            components="AB", rho_last=8.502, theta_last=174.5, date_last=2015,
            mag_pri=1.46, mag_sec=8.49,
        )
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[bb.OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(),
        )
        self.assertEqual(len(rows), 2)
        for row in rows:
            self.assertEqual(row.sep_arcsec, 8.502)
            self.assertEqual(row.pa_deg, 174.5)
            # 2015.0 → JD 2451545 + 15 * 365.25 = 2457023.75.
            self.assertAlmostEqual(row.sep_pa_epoch_jd, 2457023.75, places=4)
            # Sirius A/B: V_pri = 1.46, V_sec = 8.49 → Δmag = 7.03.
            self.assertAlmostEqual(row.dmag, 7.03, places=4)

    def test_missing_pair_geometry_propagates_as_none(self) -> None:
        pair = _wds_pair(
            components="AB",
            rho_last=None, theta_last=None, date_last=None,
            mag_pri=None, mag_sec=None,
        )
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[bb.OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(),
        )
        for row in rows:
            self.assertIsNone(row.sep_arcsec)
            self.assertIsNone(row.pa_deg)
            self.assertIsNone(row.sep_pa_epoch_jd)
            self.assertIsNone(row.dmag)

    def test_standalone_rows_have_no_pair_geometry(self) -> None:
        # SIMBAD-augmented standalone rows aren't sides of a WDS pair, so
        # the three columns stay None even when the corresponding WDS
        # ``date_last`` exists on the unrelated pair row.
        simbad_xids = {
            ("99999+9999", "X"): bb.SimbadWdsXid(
                simbad_oid=42, simbad_main_id="SIMBAD-X",
                gaia_source_id=None, hip=None,
            ),
        }
        rows = bb.build_standalone_rows(
            simbad_xids=simbad_xids,
            emitted_keys=set(),
            system_anchors={},
            indices=_indices_with_astrometry(),
        )
        # No anchor + no Gaia astrometry → position-less row, but the row
        # still emits (orbit_role=standalone, position cells empty). All
        # three pair-geometry columns are None.
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0].sep_arcsec)
        self.assertIsNone(rows[0].pa_deg)
        self.assertIsNone(rows[0].sep_pa_epoch_jd)
        self.assertIsNone(rows[0].dmag)


class PhotometryViaTests(unittest.TestCase):
    """Stage 6 emits a per-row ``photometry_via`` tag that captures
    whether the absmag/ci on the row is the COMPONENT's own AT-HYG
    photometry (``athyg_own``), the SYSTEM primary's AT-HYG photometry
    inherited via a shared HIP entry (``athyg_system_inherited``), or
    absent (``none``). Companion promotion uses this tag instead of
    a float-equality heuristic on absmag."""

    def test_primary_with_own_athyg_tags_athyg_own(self) -> None:
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        # Two distinct AT-HYG entries — one per component (the normal
        # case for well-separated visual binaries).
        athyg_a = _athyg_row(gaia=1)
        athyg_b = _athyg_row(gaia=2)
        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[bb.OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(athyg=[athyg_a, athyg_b]),
        )
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0].photometry_via, bb.PHOTOMETRY_VIA_OWN)
        self.assertEqual(rows[1].photometry_via, bb.PHOTOMETRY_VIA_OWN)

    def test_secondary_sharing_primary_athyg_tags_inherited(self) -> None:
        # Sirius A/B shape: both components resolve to the SAME AT-HYG
        # row via HIP fall-through (only one HIP in AT-HYG covers the
        # system). photometry_via on the secondary captures that the
        # absmag/ci it surfaced is the primary's, not its own.
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=None, hip=32349, component="A", is_primary=True),
            _resolved(gaia=None, hip=32349, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        # Single AT-HYG row keyed on HIP 32349 — both components hit it.
        shared_athyg = _athyg_row(hip=32349)
        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[bb.OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(athyg=[shared_athyg]),
        )
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0].photometry_via, bb.PHOTOMETRY_VIA_OWN)
        self.assertEqual(rows[1].photometry_via, bb.PHOTOMETRY_VIA_SYSTEM_INHERITED)

    def test_row_with_no_athyg_tags_none(self) -> None:
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[bb.OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(),  # no AT-HYG entries
        )
        for row in rows:
            self.assertEqual(row.photometry_via, bb.PHOTOMETRY_VIA_NONE)

    def test_standalone_rows_tag_none(self) -> None:
        simbad_xids = {
            ("99999+9999", "X"): bb.SimbadWdsXid(
                simbad_oid=42, simbad_main_id="SIMBAD-X",
                gaia_source_id=None, hip=None,
            ),
        }
        rows = bb.build_standalone_rows(
            simbad_xids=simbad_xids,
            emitted_keys=set(),
            system_anchors={},
            indices=_indices_with_astrometry(),
        )
        self.assertEqual(rows[0].photometry_via, bb.PHOTOMETRY_VIA_NONE)


class GaiaPhotometryAbsmagTests(unittest.TestCase):
    """Stage 6 recovers absmag (and ci) for a WDS component that has its
    own Gaia DR3 5p fit but no AT-HYG row, from the component's own
    G/BP/RP + parallax (``photometry_via=gaia_photometry``). Without it
    the row lands with a blank absmag and companion promotion drops it
    for lacking a brightness."""

    def test_ballesteros_bv_from_teff_mirrors_ts(self) -> None:
        # Python port pinned against the TS canonical
        # (scripts/colour/blackbody-lut-pure.ts) across the range — one
        # point drifts silently at the ends, where a mirror is likeliest
        # to diverge. Hot blue → ~0, solar → 0.652, cool red → ~1.71.
        self.assertAlmostEqual(bb.ballesteros_bv_from_teff(10000.0), 0.010, places=3)
        self.assertAlmostEqual(bb.ballesteros_bv_from_teff(5772.0), 0.652, places=3)
        self.assertAlmostEqual(bb.ballesteros_bv_from_teff(3500.0), 1.712, places=3)

    def test_derive_absmag_ci_solar(self) -> None:
        # G = 4.67 at 10 pc (ϖ = 100 mas) → M_G ≈ 4.67; BP−RP = 0.82
        # (solar) → M_V ≈ 4.82 (Sun 4.83), ci ≈ 0.67 (Sun ~0.65).
        absmag, ci = bb.gaia_photometry_absmag_ci(_gaia_astrometry_row(
            parallax_mas=100.0, g_mag=4.67, bp_mag=5.05, rp_mag=4.23,
        ))
        self.assertAlmostEqual(absmag, 4.82, places=1)
        self.assertAlmostEqual(ci, 0.67, places=1)

    def test_derive_no_bp_rp_raw_m_g_null_ci(self) -> None:
        # ϖ = 10 mas → 100 pc → M_G = G + 5·log10(10) − 10 = G − 5 = 5.0;
        # no BP/RP → raw M_G (no G→V), ci None.
        absmag, ci = bb.gaia_photometry_absmag_ci(
            _gaia_astrometry_row(parallax_mas=10.0, g_mag=10.0),
        )
        self.assertAlmostEqual(absmag, 5.0, places=6)
        self.assertIsNone(ci)

    def test_derive_none_without_g_or_parallax(self) -> None:
        self.assertIsNone(bb.gaia_photometry_absmag_ci(
            _gaia_astrometry_row(parallax_mas=None, g_mag=10.0)))
        self.assertIsNone(bb.gaia_photometry_absmag_ci(
            _gaia_astrometry_row(parallax_mas=10.0, g_mag=None)))
        self.assertIsNone(bb.gaia_photometry_absmag_ci(
            _gaia_astrometry_row(parallax_mas=-1.0, g_mag=10.0)))

    def test_bprp_outside_teff_range_null_ci_but_keeps_absmag(self) -> None:
        # Hot blue star (BP−RP = 0.2, below the Teff polynomial's 0.5
        # floor): absmag still derived via the wider-range G→V transform,
        # ci left None → promotion's spectral/solar ci fallback.
        absmag, ci = bb.gaia_photometry_absmag_ci(_gaia_astrometry_row(
            parallax_mas=10.0, g_mag=6.0, bp_mag=6.1, rp_mag=5.9,
        ))
        self.assertIsNotNone(absmag)
        self.assertIsNone(ci)

    def test_secondary_own_gaia_no_athyg_tags_gaia_photometry(self) -> None:
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        # B has no AT-HYG row; its own Gaia 5p row carries the photometry.
        gaia_b = _gaia_astrometry_row(
            source_id=2, parallax_mas=10.0, g_mag=8.0, bp_mag=8.6, rp_mag=7.4,
        )
        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[bb.OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(
                athyg=[_athyg_row(gaia=1)],  # only the primary
                src_to_astrometry={2: gaia_b},
            ),
        )
        self.assertEqual(rows[1].photometry_via, bb.PHOTOMETRY_VIA_GAIA)
        self.assertIsNotNone(rows[1].absmag)
        self.assertIsNotNone(rows[1].ci)

    def test_excluded_source_absent_from_map_stays_none(self) -> None:
        # astrometry_exclusions removes blended sources from
        # src_to_astrometry at Stage 1 (build-binaries.py), so a component
        # keyed on an excluded source finds no Gaia row here and gets no
        # gaia-photometry absmag — its blended G is not turned into one.
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[bb.OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(
                athyg=[_athyg_row(gaia=1)],
                src_to_astrometry={},  # source 2 excluded → absent
            ),
        )
        self.assertEqual(rows[1].photometry_via, bb.PHOTOMETRY_VIA_NONE)
        self.assertIsNone(rows[1].absmag)

    def test_athyg_photometry_wins_over_gaia(self) -> None:
        # A component WITH its own AT-HYG row keeps athyg_own even when a
        # Gaia photometry row is also present — the gaia path only backs
        # rows AT-HYG doesn't cover.
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[bb.OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(
                athyg=[_athyg_row(gaia=1), _athyg_row(gaia=2)],
                src_to_astrometry={2: _gaia_astrometry_row(
                    source_id=2, g_mag=8.0, bp_mag=8.6, rp_mag=7.4)},
            ),
        )
        self.assertEqual(rows[1].photometry_via, bb.PHOTOMETRY_VIA_OWN)

    def test_non_gaia5p_astrometry_does_not_derive(self) -> None:
        # The gate is astrometry_via=gaia_5p: a component positioned by
        # HIP2 (not its own clean Gaia 5p fit) does not borrow the Gaia
        # row's photometry, since that parallax may be orbit-corrupted.
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(
                astrometry_via="hip2_long_baseline", parallax_mas=10.0),
        ]
        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[bb.OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(
                athyg=[_athyg_row(gaia=1)],
                src_to_astrometry={2: _gaia_astrometry_row(
                    source_id=2, g_mag=8.0, bp_mag=8.6, rp_mag=7.4)},
            ),
        )
        self.assertEqual(rows[1].photometry_via, bb.PHOTOMETRY_VIA_NONE)
        self.assertIsNone(rows[1].absmag)

    def test_blend_into_athyg_partner_does_not_derive(self) -> None:
        # Stage 2's blend-identity propagation copies an AT-HYG-backed
        # primary's Gaia source onto a secondary that resolved nothing of
        # its own, so BOTH rows carry one source and the secondary tags
        # gaia_5p — but that source's G is the blended pair's, and the
        # primary already carries the system light through AT-HYG. Deriving
        # here would mint a twin of the primary; the partner-share gate
        # suppresses it. (A's AT-HYG row is keyed by HIP, not the shared
        # Gaia source, so _athyg_row_for_component doesn't catch B for it.)
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, hip=100, component="A", is_primary=True),
            _resolved(gaia=1, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[bb.OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(
                athyg=[_athyg_row(hip=100)],  # A via HIP only, no gaia key
                src_to_astrometry={1: _gaia_astrometry_row(
                    source_id=1, g_mag=8.0, bp_mag=8.6, rp_mag=7.4)},
            ),
        )
        self.assertEqual(rows[1].photometry_via, bb.PHOTOMETRY_VIA_NONE)
        self.assertIsNone(rows[1].absmag)


class WdsDmagTests(unittest.TestCase):
    """``wds_dmag`` returns ``mag_sec − mag_pri`` or ``None`` when
    either magnitude is missing — apparent Δmag = absolute Δmag for two
    components at the same distance, so the runtime can use it
    directly to impute companion absmag."""

    def test_signed_difference(self) -> None:
        # Sirius A V=1.46, Sirius B V=8.49 → Δmag = +7.03 (secondary
        # is dimmer).
        self.assertAlmostEqual(bb.wds_dmag(1.46, 8.49), 7.03, places=4)

    def test_missing_primary_returns_none(self) -> None:
        self.assertIsNone(bb.wds_dmag(None, 8.49))

    def test_missing_secondary_returns_none(self) -> None:
        self.assertIsNone(bb.wds_dmag(1.46, None))


class WdsYearToJdTests(unittest.TestCase):
    """``wds_year_to_jd`` converts a 4-digit observation year to a Julian
    Date anchored at J2000. Sub-day precision is irrelevant — the runtime
    consumer uses the epoch for static-placement projection only."""

    def test_j2000_year_returns_j2000_jd(self) -> None:
        self.assertEqual(bb.wds_year_to_jd(2000), 2451545.0)

    def test_year_offset_uses_julian_year_length(self) -> None:
        # 2020 - 2000 = 20 Julian years × 365.25 d = +7305 d → JD 2458850.
        self.assertEqual(bb.wds_year_to_jd(2020), 2458850.0)

    def test_pre_2000_year_returns_pre_j2000_jd(self) -> None:
        # 1980 - 2000 = -20 Julian years × 365.25 d = -7305 d → JD 2444240.
        self.assertEqual(bb.wds_year_to_jd(1980), 2444240.0)

    def test_none_year_passes_through(self) -> None:
        self.assertIsNone(bb.wds_year_to_jd(None))


class WriteMultiplesTsvTests(unittest.TestCase):
    def test_header_and_row_round_trip(self) -> None:
        row = bb.MultiplesRow(
            system_id="WDS-1-AB", comp="A",
            hip=12345, gaia_source_id=99999,
            x_pc=1.5, y_pc=2.5, z_pc=-3.5,
            absmag=4.5, ci=0.6, spect="G2V", name="Sirius",
            source="athyg", regime=2,
            resolve_via="orb6_hip", astrometry_via="gaia_5p", orbit_via="orb6",
            spect_via="athyg",
            photometry_via="athyg_own",
            a_via="catalog",
            orbit_role="primary",
            P_days=365.25, T_jd=2451545.0, e=0.1, a_AU=1.0,
            i_rad=0.5, omega_rad=0.6, Omega_rad=0.7,
            q=0.5, dist_pc=10.0,
            sep_arcsec=7.123, pa_deg=265.45,
            sep_pa_epoch_jd=2458850.0,
            dmag=7.0234,
        )
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "multiples.tsv"
            n = bb.write_multiples_tsv([row], p)
            self.assertEqual(n, 1)
            lines = p.read_text().splitlines()
        self.assertEqual(len(lines), 2)
        header = lines[0].split("\t")
        self.assertEqual(tuple(header), bb.MULTIPLES_TSV_COLUMNS)
        cells = lines[1].split("\t")
        self.assertEqual(cells[header.index("system_id")], "WDS-1-AB")
        self.assertEqual(cells[header.index("hip")], "12345")
        self.assertEqual(cells[header.index("gaia_source_id")], "99999")
        self.assertEqual(cells[header.index("name")], "Sirius")
        self.assertEqual(cells[header.index("regime")], "2")
        self.assertEqual(cells[header.index("spect_via")], "athyg")
        self.assertEqual(cells[header.index("a_via")], "catalog")
        self.assertEqual(cells[header.index("sep_arcsec")], "7.123")
        self.assertEqual(cells[header.index("pa_deg")], "265.45")
        self.assertEqual(cells[header.index("sep_pa_epoch_jd")], "2458850.0000")
        self.assertEqual(cells[header.index("dmag")], "7.0234")

    def test_empty_optional_fields_emit_empty_cells(self) -> None:
        row = bb.MultiplesRow(
            system_id="WDS-2-AB", comp="A",
            hip=None, gaia_source_id=None,
            x_pc=None, y_pc=None, z_pc=None,
            absmag=None, ci=None, spect="", name="",
            source="wds", regime=0,
            resolve_via="unresolved", astrometry_via="unresolved", orbit_via="none",
            spect_via="none",
            photometry_via="none",
            a_via="none",
            orbit_role="primary",
            P_days=None, T_jd=None, e=None, a_AU=None,
            i_rad=None, omega_rad=None, Omega_rad=None,
            q=None, dist_pc=None,
            sep_arcsec=None, pa_deg=None, sep_pa_epoch_jd=None,
            dmag=None,
        )
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "multiples.tsv"
            bb.write_multiples_tsv([row], p)
            lines = p.read_text().splitlines()
        cells = lines[1].split("\t")
        header = lines[0].split("\t")
        for col in ("hip", "gaia_source_id", "x_pc", "y_pc", "z_pc",
                    "absmag", "ci", "P_days", "T_jd", "e", "a_AU",
                    "i_rad", "omega_rad", "Omega_rad", "q", "dist_pc",
                    "sep_arcsec", "pa_deg", "sep_pa_epoch_jd", "dmag"):
            self.assertEqual(cells[header.index(col)], "",
                             msg=f"empty optional {col} should be empty cell")


# ─── Stage 7 (build-time stats / snapshot compare) ───────────────────


class BuildBinariesCountsTests(unittest.TestCase):
    def test_collects_every_canonical_section(self) -> None:
        # Construct minimal Stage 2-5 outputs and verify every section
        # (resolution / astrometry / orbit / optical) shows up as a
        # flat key prefix.
        counts = bb.build_binaries_counts(
            pairs=[_wds_pair(components="AB")],
            components=[
                _resolved(gaia=1, component="A", is_primary=True),
                _resolved(gaia=2, component="B", is_primary=False),
            ],
            astrometry=[_component_astrometry(), _component_astrometry()],
            orbits=[(None, "none")],
            classifications=[bb.OpticalClassification(True, "wds_notes_kept")],
            multiples_rows=[],
        )
        for tag in bb.RESOLVE_VIA_VALUES:
            self.assertIn(f"resolution_{tag}", counts)
        for tag in bb.ASTROMETRY_VIA_VALUES:
            self.assertIn(f"astrometry_{tag}", counts)
        for tag in bb.ORBIT_VIA_VALUES:
            self.assertIn(f"orbit_{tag}", counts)
        for tag in bb.OPTICAL_VIA_VALUES:
            self.assertIn(f"optical_{tag}", counts)
        self.assertEqual(counts["wds_pairs_total"], 1)
        self.assertEqual(counts["decomposing_pairs"], 1)
        self.assertEqual(counts["components_total"], 2)
        self.assertEqual(counts["optical_wds_notes_kept"], 1)


class CompareBuildCountsTests(unittest.TestCase):
    def test_match_when_equal(self) -> None:
        a = {"x": 1, "y": 2}
        diff = bb.compare_build_counts(a, a)
        self.assertTrue(all(d.status == "match" for d in diff))

    def test_mismatch_signed_delta(self) -> None:
        diff = bb.compare_build_counts({"x": 10, "y": 5}, {"x": 12, "y": 5})
        statuses = {d.key: d.status for d in diff}
        self.assertEqual(statuses, {"x": "mismatch", "y": "match"})

    def test_missing_keys_classified(self) -> None:
        diff = bb.compare_build_counts({"a": 1, "b": 2}, {"b": 2, "c": 3})
        statuses = {d.key: d.status for d in diff}
        self.assertEqual(statuses["a"], "missing_actual")
        self.assertEqual(statuses["b"], "match")
        self.assertEqual(statuses["c"], "missing_expected")


class AssertOrUpdateCountsTests(unittest.TestCase):
    def test_writes_initial_snapshot_when_missing(self) -> None:
        import json as _json
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "snapshot.json"
            ok = bb.assert_or_update_counts({"x": 1, "y": 2}, p)
            self.assertTrue(ok)
            self.assertTrue(p.exists())
            written = _json.loads(p.read_text())
        self.assertEqual(written, {"x": 1, "y": 2})

    def test_compares_against_existing_snapshot_match(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "snapshot.json"
            p.write_text('{"x": 1, "y": 2}\n')
            ok = bb.assert_or_update_counts({"x": 1, "y": 2}, p)
        self.assertTrue(ok)

    def test_compares_against_existing_snapshot_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "snapshot.json"
            p.write_text('{"x": 1, "y": 2}\n')
            ok = bb.assert_or_update_counts({"x": 1, "y": 3}, p)
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
                _os.environ[bb.UPDATE_COUNTS_ENV_VAR] = "1"
                ok = bb.assert_or_update_counts({"x": 2}, p)
            finally:
                _os.environ.pop(bb.UPDATE_COUNTS_ENV_VAR, None)
            self.assertTrue(ok)
            written = _json.loads(p.read_text())
        self.assertEqual(written, {"x": 2})


class BuildBinariesRatesTests(unittest.TestCase):
    def _baseline_counts(self) -> dict[str, int]:
        return {
            "components_total": 10000,
            "decomposing_pairs": 5000,
            "resolution_orb6_hip": 100,
            "resolution_athyg_gaia_native": 1000,
            "resolution_simbad_xid": 3400,
            "resolution_ccdm_hip": 500,
            "resolution_position_pm": 0,
            "resolution_position_nopm": 0,
            "resolution_unresolved": 5000,
            "astrometry_gaia_nss_systemic": 100,
            "astrometry_hip2_long_baseline": 200,
            "astrometry_gaia_5p": 2000,
            "astrometry_unresolved": 7700,
            "orbit_gaia_nss": 150,
            "orbit_orb6": 100,
            "orbit_orb6_spectroscopic": 50,
            "orbit_none": 4700,
            "optical_wds_notes_rejected": 500,
            "optical_gaia_rejected": 100,
            "optical_asymm_rejected": 50,
            "optical_mag_heuristic_rejected": 850,
        }

    def test_gaia_resolve_rate_is_source_id_anchored_fraction(self) -> None:
        rates = bb.build_binaries_rates(self._baseline_counts())
        # (100 + 1000 + 3400) / 10000 = 0.45 — ccdm_hip excluded.
        self.assertAlmostEqual(rates["gaia_resolve_rate"], 0.45)

    def test_optical_rejected_rate_sums_cascade_rejections(self) -> None:
        rates = bb.build_binaries_rates(self._baseline_counts())
        # (500 + 100 + 50 + 850) / 5000 = 0.30
        self.assertAlmostEqual(rates["optical_rejected_rate"], 0.30)

    def test_nss_orbit_rate_uses_only_resolved_orbit_population(self) -> None:
        rates = bb.build_binaries_rates(self._baseline_counts())
        # 150 / (150 + 100 + 50) = 0.5
        self.assertAlmostEqual(rates["nss_orbit_rate"], 0.5)

    def test_hip2_fallback_rate_is_per_component_fraction(self) -> None:
        rates = bb.build_binaries_rates(self._baseline_counts())
        # 200 / 10000 = 0.02
        self.assertAlmostEqual(rates["hip2_fallback_rate"], 0.02)

    def test_zero_denominator_returns_zero_rate(self) -> None:
        rates = bb.build_binaries_rates({
            "components_total": 0,
            "decomposing_pairs": 0,
        })
        for key, value in rates.items():
            self.assertEqual(value, 0.0, msg=key)


class CompareBuildRatesTests(unittest.TestCase):
    def test_match_when_within_tolerance(self) -> None:
        expected = {"r": {"value": 0.50, "tolerance": 0.20}}
        diff = bb.compare_build_rates(expected, {"r": 0.55})
        self.assertEqual(diff[0].status, "match")

    def test_drift_when_outside_tolerance(self) -> None:
        expected = {"r": {"value": 0.50, "tolerance": 0.20}}
        diff = bb.compare_build_rates(expected, {"r": 0.65})
        self.assertEqual(diff[0].status, "drift")

    def test_missing_keys_classified(self) -> None:
        expected = {"r1": {"value": 0.5, "tolerance": 0.2}}
        actual = {"r2": 0.3}
        diff = bb.compare_build_rates(expected, actual)
        statuses = {d.key: d.status for d in diff}
        self.assertEqual(statuses, {"r1": "missing_actual", "r2": "missing_expected"})

    def test_negative_or_zero_expected_does_not_divide_by_zero(self) -> None:
        expected = {"r": {"value": 0.0, "tolerance": 0.20}}
        diff = bb.compare_build_rates(expected, {"r": 0.0})
        self.assertEqual(diff[0].status, "match")
        # Tiny actual against zero expected: ratio uses 1e-9 floor, so
        # any non-zero actual exceeds tolerance.
        diff2 = bb.compare_build_rates(expected, {"r": 0.0001})
        self.assertEqual(diff2[0].status, "drift")


class AssertOrUpdateRatesTests(unittest.TestCase):
    def test_writes_initial_snapshot_with_default_tolerance(self) -> None:
        import json as _json
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "rates.json"
            ok = bb.assert_or_update_rates({"r": 0.42}, p)
            self.assertTrue(ok)
            written = _json.loads(p.read_text())
        self.assertEqual(written["r"]["value"], 0.42)
        self.assertEqual(written["r"]["tolerance"], bb.DEFAULT_RATE_TOLERANCE)

    def test_preserves_hand_edited_tolerance_on_refresh(self) -> None:
        import json as _json
        import os as _os
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "rates.json"
            p.write_text(_json.dumps({"r": {"value": 0.30, "tolerance": 0.05}}))
            try:
                _os.environ[bb.UPDATE_COUNTS_ENV_VAR] = "1"
                ok = bb.assert_or_update_rates({"r": 0.42}, p)
            finally:
                _os.environ.pop(bb.UPDATE_COUNTS_ENV_VAR, None)
            self.assertTrue(ok)
            written = _json.loads(p.read_text())
        self.assertEqual(written["r"]["value"], 0.42)
        # Hand-edited tolerance must survive the refresh.
        self.assertEqual(written["r"]["tolerance"], 0.05)

    def test_returns_false_on_drift_without_rewriting_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "rates.json"
            body = '{"r": {"value": 0.50, "tolerance": 0.10}}'
            p.write_text(body)
            ok = bb.assert_or_update_rates({"r": 0.80}, p)
            self.assertFalse(ok)
            self.assertEqual(p.read_text(), body)


# ─── mass_estimate (Phase 5 — spectral-class-aware mass-ratio q) ─────


from scripts.binaries import mass_estimate as me  # noqa: E402


class ParseSpectralTypeTests(unittest.TestCase):
    def test_plain_main_sequence(self) -> None:
        p = me.parse_spectral_type("G2V")
        assert p is not None
        self.assertEqual((p.classIdx, p.subclass, p.lumClass), (4, 2, 2))
        self.assertFalse(p.isWhiteDwarf)

    def test_subclass_fractional_truncates_to_integer(self) -> None:
        p = me.parse_spectral_type("M3.5V")
        assert p is not None
        self.assertEqual((p.classIdx, p.subclass, p.lumClass), (6, 3, 2))

    def test_white_dwarf_da_with_temperature_subclass(self) -> None:
        p = me.parse_spectral_type("DA1.9")
        assert p is not None
        self.assertTrue(p.isWhiteDwarf)
        self.assertEqual(p.lumClass, 0)

    def test_white_dwarf_composite_subtype(self) -> None:
        # Procyon B's SIMBAD sp_type is "DQZ" — multi-letter composite.
        p = me.parse_spectral_type("DQZ")
        assert p is not None
        self.assertTrue(p.isWhiteDwarf)

    def test_subgiant_iv(self) -> None:
        p = me.parse_spectral_type("F5IV-V")
        assert p is not None
        # IV beats V because the regex anchors at the start of the
        # post-subclass window. F5IV-V → IV.
        self.assertEqual((p.classIdx, p.subclass, p.lumClass), (3, 5, 3))

    def test_giant_iii(self) -> None:
        p = me.parse_spectral_type("K0III")
        assert p is not None
        self.assertEqual((p.classIdx, p.subclass, p.lumClass), (5, 0, 4))

    def test_supergiant_ia(self) -> None:
        p = me.parse_spectral_type("B8Ia")
        assert p is not None
        self.assertEqual((p.classIdx, p.subclass, p.lumClass), (1, 8, 8))

    def test_supergiant_iab(self) -> None:
        p = me.parse_spectral_type("M1Iab")
        assert p is not None
        self.assertEqual(p.lumClass, 7)

    def test_yerkes_dwarf_prefix_overrides_lum_class(self) -> None:
        p = me.parse_spectral_type("dM4.0")
        assert p is not None
        self.assertEqual((p.classIdx, p.subclass, p.lumClass), (6, 4, 2))

    def test_yerkes_giant_prefix(self) -> None:
        p = me.parse_spectral_type("gK0")
        assert p is not None
        self.assertEqual((p.classIdx, p.lumClass), (5, 4))

    def test_subdwarf(self) -> None:
        p = me.parse_spectral_type("sdB5")
        assert p is not None
        self.assertEqual((p.classIdx, p.subclass, p.lumClass), (1, 5, 1))

    def test_wolf_rayet_lands_in_carbon_bucket(self) -> None:
        p = me.parse_spectral_type("WN5")
        assert p is not None
        self.assertEqual(p.classIdx, 7)

    def test_empty_returns_none(self) -> None:
        self.assertIsNone(me.parse_spectral_type(""))
        self.assertIsNone(me.parse_spectral_type(None))
        self.assertIsNone(me.parse_spectral_type("   "))

    def test_unknown_first_letter_returns_none(self) -> None:
        self.assertIsNone(me.parse_spectral_type("XYZ"))


class MassFromSpectralClassTests(unittest.TestCase):
    def test_solar_analog_g2v_near_one_solar_mass(self) -> None:
        m = me.mass_from_spectral_class("G2V")
        assert m is not None
        self.assertAlmostEqual(m, 1.0, places=2)

    def test_a1v_near_two_point_six(self) -> None:
        # Sirius A: A1V. Per the MS table A1V → 2.6 M_sun (Pecaut/Mamajek
        # zero-age values; true Sirius A = 2.06 M_sun, but the table is
        # a generic A1V anchor not a Sirius-specific calibration).
        m = me.mass_from_spectral_class("A1V")
        assert m is not None
        self.assertAlmostEqual(m, 2.6, places=2)

    def test_white_dwarf_default_mass(self) -> None:
        m = me.mass_from_spectral_class("DA1.9")
        self.assertEqual(m, me.WD_MASS_DEFAULT)

    def test_white_dwarf_dqz_default_mass(self) -> None:
        # Procyon B is DQZ — composite-subtype WD; still gets the
        # default 0.6 M_sun.
        m = me.mass_from_spectral_class("DQZ")
        self.assertEqual(m, me.WD_MASS_DEFAULT)

    def test_k1v_companion_mass(self) -> None:
        m = me.mass_from_spectral_class("K1V")
        assert m is not None
        self.assertAlmostEqual(m, 0.76, places=2)

    def test_giant_k0iii(self) -> None:
        m = me.mass_from_spectral_class("K0III")
        assert m is not None
        # Cox 2000: K III ≈ 1.5 M_sun.
        self.assertAlmostEqual(m, 1.5, places=2)

    def test_supergiant_b0ia(self) -> None:
        m = me.mass_from_spectral_class("B0Ia")
        assert m is not None
        # Supergiant table B0Ia is at the high end; mass ~25 M_sun.
        self.assertAlmostEqual(m, 25.0, places=1)

    def test_unparseable_returns_none(self) -> None:
        self.assertIsNone(me.mass_from_spectral_class(""))
        self.assertIsNone(me.mass_from_spectral_class(None))
        self.assertIsNone(me.mass_from_spectral_class("???"))

    def test_subgiant_interpolates_between_ms_and_giant(self) -> None:
        # G2IV should land between G2V (~1.0) and G2III (~2.1).
        m_ms = me.mass_from_spectral_class("G2V")
        m_iv = me.mass_from_spectral_class("G2IV")
        m_iii = me.mass_from_spectral_class("G2III")
        assert m_ms is not None and m_iv is not None and m_iii is not None
        self.assertGreater(m_iv, m_ms)
        self.assertLess(m_iv, m_iii)

    def test_subgiant_f5iv_matches_procyon_a_published_mass(self) -> None:
        # External anchor for the IV interpolation weights: Procyon A
        # (F5IV) has a dynamically measured 1.478 ± 0.05 M_sun (Bond et
        # al. 2015, astrometric orbit). The generic F5IV table value
        # (0.55·1.8 + 0.45·1.4 = 1.62) must stay within 10% of it.
        m_iv = me.mass_from_spectral_class("F5IV")
        assert m_iv is not None
        self.assertAlmostEqual(m_iv, 1.62, places=4)
        self.assertAlmostEqual(m_iv, 1.478, delta=0.148)


class MassRatioFromComponentsTests(unittest.TestCase):
    def test_sirius_like_wd_primary_ms_a1v(self) -> None:
        # Sirius A (A1V) + Sirius B (DA1.9 WD). Model: M_A=2.6, M_B=0.6
        # → q = 0.6 / (2.6 + 0.6) = 0.1875. True external value is 0.33
        # (M_B=1.0, off-track from the WD default); model improves on
        # the q=None baseline but cannot recover Sirius B's anomalously
        # high mass from sp_type alone.
        q = me.mass_ratio_from_components("A1V", "DA1.9")
        assert q is not None
        self.assertAlmostEqual(q, 0.1875, places=3)

    def test_procyon_like_subgiant_primary_wd(self) -> None:
        # Procyon A (F5IV-V) + Procyon B (DQZ WD). Model: M_A is the
        # IV interpolation between F5V (1.4) and F5III (1.8) → 1.62,
        # M_B = 0.6 → q = 0.6 / 2.22.
        q = me.mass_ratio_from_components("F5IV-V", "DQZ")
        assert q is not None
        self.assertAlmostEqual(q, 0.2703, places=4)

    def test_alpha_cen_like_g2v_plus_k1v(self) -> None:
        # α Cen A (G2V) + α Cen B (K1V). Model: M_A=1.0, M_B=0.76 →
        # q ≈ 0.43. External truth (Pourbaix 2016): q=0.453. The MS+MS
        # case lands within ~5% of the external value because there is
        # no WD mass-recovery uncertainty.
        q = me.mass_ratio_from_components("G2V", "K1V")
        assert q is not None
        self.assertAlmostEqual(q, 0.4318, places=4)

    def test_returns_none_when_primary_spect_unparseable(self) -> None:
        self.assertIsNone(me.mass_ratio_from_components("", "K1V"))

    def test_returns_none_when_secondary_spect_unparseable(self) -> None:
        self.assertIsNone(me.mass_ratio_from_components("G2V", ""))


class Stage6QFallbackTests(unittest.TestCase):
    """Stage 6 fills q from spectral-class masses when an ORB6 visual
    orbit was emitted but Gaia NSS didn't supply a mass_ratio."""

    def _orbit_orb6(self) -> "bb.OrbitElements":
        return bb.OrbitElements(
            P_days=29133.07, T_jd=2451545.0, e=0.5,
            a_AU=23.0, i_rad=1.0,
            omega_rad=0.2, Omega_rad=0.3,
            q=None,                       # ORB6 visual route — no q
            distance_pc=1.3,
        )

    def _make_pair_fixture(
        self,
        *,
        primary_spect: str,
        secondary_spect: str | None,
        primary_absmag: float = 4.0,
        secondary_absmag: float = 5.0,
        wds_id: str = "00000+0000",
        orbit: "tuple[bb.OrbitElements | None, str]" = (None, "none"),
        has_secondary_athyg: bool = True,
        optical_via: str = "orbit_kept",
    ) -> "tuple[bb.WdsPair, list, list, list, list, bb.IdentifierIndices]":
        athyg_rows = [
            bb.AthygRow(
                hip=None, tyc=None, gaia=1, hd=None,
                ra_deg=0.0, dec_deg=0.0,
                x_pc=0.0, y_pc=0.0, z_pc=0.0,
                dist_pc=10.0, v_mag=None, absmag=primary_absmag,
                ci=None, spect=primary_spect, proper="",
                pm_ra_masyr=None, pm_de_masyr=None,
            ),
        ]
        if has_secondary_athyg:
            athyg_rows.append(
                bb.AthygRow(
                    hip=None, tyc=None, gaia=2, hd=None,
                    ra_deg=0.0, dec_deg=0.0,
                    x_pc=0.0, y_pc=0.0, z_pc=0.0,
                    dist_pc=10.0, v_mag=None, absmag=secondary_absmag,
                    ci=None, spect=secondary_spect, proper="",
                    pm_ra_masyr=None, pm_de_masyr=None,
                ),
            )
        pair = _wds_pair(wds_id=wds_id, components="AB")
        components = [
            _resolved(gaia=1, wds_id=wds_id, component="A", is_primary=True),
            _resolved(gaia=2, wds_id=wds_id, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=100.0),
            _component_astrometry(parallax_mas=100.0),
        ]
        orbits = [orbit]
        classifications = [bb.OpticalClassification(True, optical_via)]
        indices = _indices_with_astrometry(athyg=athyg_rows)
        return pair, components, astrometry, orbits, classifications, indices

    def test_orb6_visual_fills_q_from_spectral_classes(self) -> None:
        # α Cen-shaped: ORB6 visual orbit, G2V primary + K1V secondary,
        # both with AT-HYG absmag. q is filled on both rows.
        pair, components, astrometry, orbits, classifications, indices = (
            self._make_pair_fixture(
                primary_spect="G2V", secondary_spect="K1V",
                primary_absmag=4.379, secondary_absmag=5.71,
                wds_id="14396-6050", orbit=(self._orbit_orb6(), "orb6"),
            )
        )
        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertEqual(len(rows), 2)
        # Both rows carry the same q (one orbit, both sides of the pair).
        self.assertIsNotNone(rows[0].q)
        self.assertIsNotNone(rows[1].q)
        assert rows[0].q is not None and rows[1].q is not None
        self.assertAlmostEqual(rows[0].q, rows[1].q, places=6)
        # G2V primary (1.0 M_sun) + K1V secondary (0.76) → q ≈ 0.43.
        self.assertAlmostEqual(rows[0].q, 0.432, places=2)

    def test_nss_supplied_q_is_preserved(self) -> None:
        # Gaia NSS already supplied q=0.85. The spectral-class fallback
        # must NOT overwrite it even when both components have spect.
        nss_orbit = bb.OrbitElements(
            P_days=1.0, T_jd=2451545.0, e=0.1,
            a_AU=0.1, i_rad=1.0,
            omega_rad=0.2, Omega_rad=0.3,
            q=0.85,
            distance_pc=26.2,
        )
        pair, components, astrometry, orbits, classifications, indices = (
            self._make_pair_fixture(
                primary_spect="F0V", secondary_spect="A5V",
                primary_absmag=2.088, secondary_absmag=1.048,
                wds_id="22150+5703", orbit=(nss_orbit, "gaia_nss"),
            )
        )
        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0].q, 0.85)
        self.assertEqual(rows[1].q, 0.85)

    def test_orbit_q_present_short_circuits_fallback(self) -> None:
        # The spectral fallback fires only when orbit.q is None: a set
        # orbit.q wins on both rows even though these spectral classes
        # would estimate a DIFFERENT q if the fallback ran.
        nss_orbit = bb.OrbitElements(
            P_days=1.0, T_jd=2451545.0, e=0.1,
            a_AU=0.1, i_rad=1.0,
            omega_rad=0.2, Omega_rad=0.3,
            q=0.85,
            distance_pc=26.2,
        )
        estimated = me.mass_ratio_from_components("F0V", "A5V")
        self.assertIsNotNone(estimated)
        assert estimated is not None
        self.assertNotAlmostEqual(estimated, 0.85, places=2)
        pair, components, astrometry, orbits, classifications, indices = (
            self._make_pair_fixture(
                primary_spect="F0V", secondary_spect="A5V",
                primary_absmag=2.088, secondary_absmag=1.048,
                wds_id="22150+5703", orbit=(nss_orbit, "gaia_nss"),
            )
        )
        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertEqual(rows[0].q, 0.85)
        self.assertEqual(rows[1].q, 0.85)

    def test_no_q_default_for_orb6_visual_when_spect_missing(self) -> None:
        # ORB6 VISUAL orbit with an unclassifiable secondary: the
        # spectral backfill yields None and the estimated-q backstop
        # deliberately does not fire (visual pairs carry real baked
        # placements — see ESTIMATED_ELEMENT_ORBIT_VIAS).
        pair, components, astrometry, orbits, classifications, indices = (
            self._make_pair_fixture(
                primary_spect="G2V", secondary_spect=None,
                wds_id="00000+0001", orbit=(self._orbit_orb6(), "orb6"),
                has_secondary_athyg=False,
            )
        )
        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertEqual(len(rows), 2)
        self.assertIsNone(rows[0].q)
        self.assertIsNone(rows[1].q)

    def test_q_defaults_on_nss_route_when_spect_missing(self) -> None:
        # Same missing-secondary-spect shape on the gaia_nss route:
        # the unknown-companion default fires — a q-less pair would
        # never clear the runtime's has_orbit gate.
        nss_orbit = bb.OrbitElements(
            P_days=12.5, T_jd=2451545.0, e=0.1,
            a_AU=None, i_rad=None,
            omega_rad=0.2, Omega_rad=None,
            q=None, distance_pc=10.0,
        )
        pair, components, astrometry, orbits, classifications, indices = (
            self._make_pair_fixture(
                primary_spect="G2V", secondary_spect=None,
                wds_id="00000+0003", orbit=(nss_orbit, "gaia_nss"),
                has_secondary_athyg=False,
            )
        )
        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertEqual(rows[0].q, me.UNKNOWN_COMPANION_MASS_RATIO_Q)
        self.assertEqual(rows[1].q, me.UNKNOWN_COMPANION_MASS_RATIO_Q)
        self.assertEqual(rows[0].a_via, bb.A_VIA_KEPLER_MASS_ESTIMATE)

    def test_no_q_fill_when_no_orbit(self) -> None:
        # No orbit emitted at all → q is None on both rows even when
        # both have spect. Fallback only kicks in when orbital geometry
        # was resolved but q wasn't.
        pair, components, astrometry, orbits, classifications, indices = (
            self._make_pair_fixture(
                primary_spect="G2V", secondary_spect="K0V",
                wds_id="00000+0002", orbit=(None, "none"),
                optical_via="wds_notes_kept",
            )
        )
        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertEqual(len(rows), 2)
        self.assertIsNone(rows[0].q)
        self.assertIsNone(rows[1].q)


# ─── component_tokens (shared token helpers) ─────────────────────────


import component_tokens as ct  # noqa: E402


class ComponentTokensTests(unittest.TestCase):
    def test_is_component_token(self) -> None:
        for tok in ("A", "Aa", "Aa1", "B", "Cb"):
            self.assertTrue(ct.is_component_token(tok), tok)
        for tok in ("", "AB", "Aab", "a", "95", "Aa12", "r"):
            self.assertFalse(ct.is_component_token(tok), tok)

    def test_expand_wds_truncated_secondary(self) -> None:
        self.assertEqual(ct.expand_wds_truncated_secondary("Aa1", "2"), "Aa2")
        self.assertEqual(ct.expand_wds_truncated_secondary("Aa", "Ab"), "Ab")
        # Primary not digit-terminated → bare-digit secondary is left
        # alone (it isn't a truncation of the primary's stem).
        self.assertEqual(ct.expand_wds_truncated_secondary("Aa", "2"), "2")

    def test_parent_component_token(self) -> None:
        self.assertEqual(ct.parent_component_token("Aa1"), "Aa")
        self.assertEqual(ct.parent_component_token("Aa"), "A")
        self.assertIsNone(ct.parent_component_token("A"))

    def test_child_component_tokens(self) -> None:
        self.assertEqual(ct.child_component_tokens("A"), ("Aa", "Ab"))
        self.assertEqual(ct.child_component_tokens("Ca"), ("Ca1", "Ca2"))
        self.assertIsNone(ct.child_component_tokens("Aa1"))
        self.assertIsNone(ct.child_component_tokens("AB"))


# ─── subdivide (synthesized sub-pair injection) ──────────────────────


class ParseOrb6PreciseCoordTests(unittest.TestCase):
    def test_coordinate_prefix_parsed(self) -> None:
        line = "073435.86+315317.8 07346+3153 STF1110AB       6175  60178  36850   1.93   2.97    459.1     y   2.3        6.722  a  0.021   115.107    0.060   41.304     0.085   1959.59    y   0.021    0.3382   0.0023   251.84     0.38   2000 2021 3 n CIA2022d wds07346+3153r.png"
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "orb6.txt", "banner\n" + line + "\n")
            rows = bb.parse_orb6(p)
        e = rows[0]
        self.assertIsNotNone(e.precise_ra_deg)
        assert e.precise_ra_deg is not None and e.precise_dec_deg is not None
        self.assertAlmostEqual(e.precise_ra_deg, 113.649417, places=5)
        self.assertAlmostEqual(e.precise_dec_deg, 31.888278, places=5)


class Orb6ComponentOverridesTests(unittest.TestCase):
    def test_parse_and_apply(self) -> None:
        body = (
            "# preamble\n"
            "wds_id\tdiscoverer\tcomponents\tsource\n"
            "07346+3153\tYY Gem\tCa,Cb\tTorres & Ribas 2002\n"
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "overrides.tsv", body)
            overrides = bb.parse_orb6_component_overrides(p)
        self.assertEqual(overrides[("07346+3153", "YY Gem")], "Ca,Cb")

        target = _orb6_visual(grade=7)
        target.wds_id = "07346+3153"
        target.discoverer = "YY Gem"
        target.components = ""
        untouched = _orb6_visual(grade=3)
        n = bb.apply_orb6_component_overrides([target, untouched], overrides)
        self.assertEqual(n, 1)
        self.assertEqual(target.components, "Ca,Cb")
        self.assertEqual(untouched.components, "AB")


def _orphan_orb6(
    *, wds_id: str = "00490+1656", discoverer: str = "64 Psc",
    components: str = "Aa,Ab", grade: int = 8,
    precise_ra_deg: float | None = 12.25,
    precise_dec_deg: float | None = 16.94,
) -> "bb.Orb6Entry":
    e = _orb6_visual(grade=grade)
    e.wds_id = wds_id
    e.discoverer = discoverer
    e.components = components
    e.precise_ra_deg = precise_ra_deg
    e.precise_dec_deg = precise_dec_deg
    return e


class SynthesizeOrb6OrphanPairsTests(unittest.TestCase):
    def test_synthesizes_missing_subpair(self) -> None:
        wds = [_wds_pair(wds_id="00490+1656", components="AB")]
        out = bb.synthesize_orb6_orphan_pairs(wds, [_orphan_orb6()])
        self.assertEqual(len(out), 1)
        p = out[0]
        self.assertEqual((p.wds_id, p.components), ("00490+1656", "Aa,Ab"))
        # Sub-resolution convention — no measured geometry exists.
        self.assertEqual(p.rho_last, 0.0)
        self.assertIsNone(p.mag_pri)
        self.assertEqual(p.precise_ra_deg, 12.25)

    def test_skips_existing_wds_key_and_garbage_components(self) -> None:
        wds = [_wds_pair(wds_id="W1", components="Aa,Ab")]
        entries = [
            _orphan_orb6(wds_id="W1", components="Aa,Ab"),   # WDS has it
            _orphan_orb6(wds_id="W1", components="95"),      # misalignment
            _orphan_orb6(wds_id="W1", components="a,Ab"),    # misalignment
            _orphan_orb6(wds_id="W1", components="A,BC"),    # compound side
            _orphan_orb6(wds_id="W1", components=""),        # system-level
        ]
        self.assertEqual(bb.synthesize_orb6_orphan_pairs(wds, entries), [])

    def test_dedups_multiple_fits_per_pair(self) -> None:
        entries = [
            _orphan_orb6(grade=9),
            _orphan_orb6(grade=8),
        ]
        out = bb.synthesize_orb6_orphan_pairs([], entries)
        self.assertEqual(len(out), 1)

    def test_blank_components_discoverer_row_donates_geometry(self) -> None:
        donor = _wds_pair(
            wds_id="00335+4006", discoverer="HO    3", components="",
            rho_last=0.3, theta_last=120.0, mag_pri=4.4, mag_sec=7.2,
            date_last=2019, precise_ra_deg=8.4, precise_dec_deg=40.1,
        )
        entry = _orphan_orb6(
            wds_id="00335+4006", discoverer="HO    3", components="Aa,Ab",
            precise_ra_deg=None, precise_dec_deg=None,
        )
        out = bb.synthesize_orb6_orphan_pairs([donor], [entry])
        self.assertEqual(len(out), 1)
        p = out[0]
        self.assertEqual(p.rho_last, 0.3)
        self.assertEqual(p.mag_pri, 4.4)
        self.assertEqual(p.date_last, 2019)
        self.assertEqual(p.precise_ra_deg, 8.4)

    def test_wds_truncated_secondary_form_accepted(self) -> None:
        out = bb.synthesize_orb6_orphan_pairs(
            [], [_orphan_orb6(components="Aa1,2")],
        )
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0].components, "Aa1,2")


class SeedSynthesizedComponentBindingsTests(unittest.TestCase):
    def test_primary_inherits_parent_token_secondary_inherits_primary(self) -> None:
        row = _athyg_row(gaia=777)
        parent_c = _resolved(
            gaia=777, wds_id="W1", component="C", is_primary=False,
            via="simbad_xid", hip=101,
        )
        parent_c.athyg_row = row
        synth = _wds_pair_full(
            wds_id="W1", discoverer="YY Gem", components="Ca,Cb",
        )
        child_a = _resolved(
            gaia=None, wds_id="W1", discoverer="YY Gem",
            component="Ca", is_primary=True, via="unresolved",
        )
        child_b = _resolved(
            gaia=None, wds_id="W1", discoverer="YY Gem",
            component="Cb", is_primary=False, via="unresolved",
        )
        components = [parent_c, child_a, child_b]
        n = bb.seed_synthesized_component_bindings(components, [synth])
        self.assertEqual(n, 2)
        for child in (child_a, child_b):
            self.assertEqual(child.gaia_source_id, 777)
            self.assertEqual(child.resolve_via, "simbad_xid")
            self.assertEqual(child.hip, 101)
            self.assertIs(child.athyg_row, row)

    def test_own_resolution_wins_over_seed(self) -> None:
        parent_a = _resolved(gaia=777, wds_id="W1", component="A")
        child_a = _resolved(
            gaia=555, wds_id="W1", discoverer="TST   1",
            component="Aa", is_primary=True, via="orb6_hip",
        )
        child_b = _resolved(
            gaia=None, wds_id="W1", discoverer="TST   1",
            component="Ab", is_primary=False, via="unresolved",
        )
        synth = _wds_pair_full(
            wds_id="W1", discoverer="TST   1", components="Aa,Ab",
        )
        bb.seed_synthesized_component_bindings(
            [parent_a, child_a, child_b], [synth],
        )
        # Primary keeps its own ORB6-resolved source; the secondary
        # inherits the PAIR primary's binding (blended-photocentre
        # convention), not the parent token's.
        self.assertEqual(child_a.gaia_source_id, 555)
        self.assertEqual(child_b.gaia_source_id, 555)

    def test_non_synthesized_components_untouched(self) -> None:
        c = _resolved(gaia=None, wds_id="W1", component="B", is_primary=False)
        bb.seed_synthesized_component_bindings(
            [_resolved(gaia=1, wds_id="W1", component="A"), c], [],
        )
        self.assertIsNone(c.gaia_source_id)


def _wds_pair_full(
    *, wds_id: str, discoverer: str, components: str,
) -> "bb.WdsPair":
    return bb.WdsPair(
        wds_id=wds_id, discoverer=discoverer, components=components,
        date_last=None, rho_last=0.0, theta_last=0.0,
        mag_pri=None, mag_sec=None, spectral="", notes="    ",
        precise_ra_deg=None, precise_dec_deg=None,
    )


class SynthesizeNssInnerPairsTests(unittest.TestCase):
    def _run(
        self,
        pairs: "list[bb.WdsPair]",
        components: "list[bb.ResolvedComponent]",
        astrometry: "list[bb.ComponentAstrometry]",
        src_to_nss: dict[int, dict[str, str]],
    ):
        idx = _indices_with_astrometry(src_to_nss=src_to_nss)
        return bb.synthesize_nss_inner_pairs(
            pairs=pairs, components=components,
            astrometry=astrometry, indices=idx,
        )

    def _ab_fixture(self, *, primary_gaia=42, secondary_gaia=99):
        pairs = [_wds_pair(wds_id="W1", components="AB")]
        components = [
            _resolved(gaia=primary_gaia, wds_id="W1", component="A",
                      is_primary=True, via="simbad_xid", hip=7),
            _resolved(gaia=secondary_gaia, wds_id="W1", component="B",
                      is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=50.0),
            _component_astrometry(parallax_mas=50.0),
        ]
        return pairs, components, astrometry

    def test_distinct_partner_source_spawns_inner_pair(self) -> None:
        pairs, components, astrometry = self._ab_fixture()
        new_pairs, new_comps, new_ast, stats = self._run(
            pairs, components, astrometry,
            {42: _nss_orbital_row(period_days=200.0)},
        )
        self.assertEqual(len(new_pairs), 1)
        p = new_pairs[0]
        self.assertEqual(p.components, "Aa,Ab")
        self.assertEqual(p.discoverer, bb.SYNTH_NSS_DISCOVERER)
        self.assertEqual(p.rho_last, 0.0)
        self.assertEqual(len(new_comps), 2)
        self.assertEqual(
            [c.component for c in new_comps], ["Aa", "Ab"],
        )
        for c in new_comps:
            self.assertEqual(c.gaia_source_id, 42)
            self.assertEqual(c.resolve_via, "simbad_xid")
            self.assertEqual(c.hip, 7)
        self.assertIs(new_ast[0], astrometry[0])
        self.assertIs(new_ast[1], astrometry[0])

    def test_blended_partner_shares_source_no_synthesis(self) -> None:
        pairs, components, astrometry = self._ab_fixture(secondary_gaia=42)
        new_pairs, _, _, _ = self._run(
            pairs, components, astrometry,
            {42: _nss_orbital_row(period_days=200.0)},
        )
        self.assertEqual(new_pairs, [])

    def test_deepest_carrier_component_wins(self) -> None:
        # Source 42 rides both A (in AB) and Aa (in Aa,Ab, partner Ab
        # distinct) — the deeper Aa wins and children go one level
        # further down.
        pairs = [
            _wds_pair(wds_id="W1", components="AB"),
            _wds_pair(wds_id="W1", components="Aa,Ab"),
        ]
        components = [
            _resolved(gaia=42, wds_id="W1", component="A", is_primary=True),
            _resolved(gaia=99, wds_id="W1", component="B", is_primary=False),
            _resolved(gaia=42, wds_id="W1", component="Aa", is_primary=True),
            _resolved(gaia=77, wds_id="W1", component="Ab", is_primary=False),
        ]
        astrometry = [_component_astrometry()] * 4
        new_pairs, new_comps, _, _ = self._run(
            pairs, components, astrometry,
            {42: _nss_orbital_row(period_days=200.0)},
        )
        self.assertEqual(len(new_pairs), 1)
        self.assertEqual(new_pairs[0].components, "Aa1,Aa2")

    def test_existing_children_block_synthesis(self) -> None:
        pairs = [
            _wds_pair(wds_id="W1", components="AB"),
            _wds_pair(wds_id="W1", components="Aa,Ab"),
        ]
        components = [
            _resolved(gaia=42, wds_id="W1", component="A", is_primary=True),
            _resolved(gaia=99, wds_id="W1", component="B", is_primary=False),
            # Aa,Ab pair blended onto A's source — same physical star,
            # so the subdivision already exists.
            _resolved(gaia=42, wds_id="W1", component="Aa", is_primary=True),
            _resolved(gaia=42, wds_id="W1", component="Ab", is_primary=False),
        ]
        astrometry = [_component_astrometry()] * 4
        new_pairs, _, _, stats = self._run(
            pairs, components, astrometry,
            {42: _nss_orbital_row(period_days=200.0)},
        )
        self.assertEqual(new_pairs, [])
        self.assertEqual(stats["skipped_children_exist"], 1)

    def test_out_of_regime_skipped(self) -> None:
        pairs, components, astrometry = self._ab_fixture()
        new_pairs, _, _, stats = self._run(
            pairs, components, astrometry,
            {42: _nss_orbital_row(period_days=10 * 365.25, a_mas=5000.0)},
        )
        self.assertEqual(new_pairs, [])
        self.assertEqual(stats["skipped_out_of_regime"], 1)

    def test_incomplete_elements_skipped_circular_accepted(self) -> None:
        pairs, components, astrometry = self._ab_fixture()
        # SB1 with no eccentricity — never renderable, skip.
        sb1_no_e = {
            "nss_solution_type": "SB1",
            "period": "12.5", "t_periastron": "100.0",
            "eccentricity": "", "arg_periastron": "",
        }
        new_pairs, _, _, stats = self._run(
            pairs, components, astrometry, {42: sb1_no_e},
        )
        self.assertEqual(new_pairs, [])
        self.assertEqual(stats["skipped_incomplete_elements"], 1)
        # Circular eclipser without ω IS renderable — Stage 6 backfills
        # the degenerate angle.
        circular = {
            "nss_solution_type": "EclipsingBinary",
            "period": "0.81", "t_periastron": "100.0",
            "eccentricity": "0.0", "inclination": "86.5",
            "arg_periastron": "",
        }
        new_pairs, _, _, _ = self._run(
            pairs, components, astrometry, {42: circular},
        )
        self.assertEqual(len(new_pairs), 1)

    def test_compound_carrier_token_skipped(self) -> None:
        pairs = [_wds_pair(wds_id="W1", components="AB,C")]
        components = [
            _resolved(gaia=42, wds_id="W1", component="AB", is_primary=True),
            _resolved(gaia=99, wds_id="W1", component="C", is_primary=False),
        ]
        astrometry = [_component_astrometry()] * 2
        new_pairs, _, _, stats = self._run(
            pairs, components, astrometry,
            {42: _nss_orbital_row(period_days=200.0)},
        )
        self.assertEqual(new_pairs, [])
        self.assertEqual(stats["skipped_token_shape"], 1)


class PropagateBlendIdentityTests(unittest.TestCase):
    def _fixture(self, *, rho: float | None, secondary_hip: int | None = None):
        pair = _wds_pair(wds_id="W1", components="Aa,Ab", rho_last=rho)
        row = _athyg_row(gaia=42, hip=7)
        primary = _resolved(
            gaia=42, wds_id="W1", component="Aa", is_primary=True,
            via="orb6_hip", hip=7,
        )
        primary.athyg_row = row
        secondary = _resolved(
            gaia=None, wds_id="W1", component="Ab", is_primary=False,
            via="unresolved", hip=secondary_hip,
        )
        return pair, primary, secondary

    def test_rho_zero_secondary_inherits_primary_identity(self) -> None:
        pair, primary, secondary = self._fixture(rho=0.0)
        n = bb.propagate_blend_identity([primary, secondary], [pair])
        self.assertEqual(n, 1)
        self.assertEqual(secondary.gaia_source_id, 42)
        self.assertEqual(secondary.hip, 7)
        self.assertIs(secondary.athyg_row, primary.athyg_row)
        self.assertEqual(secondary.resolve_via, "orb6_hip")

    def test_resolved_pair_untouched(self) -> None:
        pair, primary, secondary = self._fixture(rho=1.5)
        n = bb.propagate_blend_identity([primary, secondary], [pair])
        self.assertEqual(n, 0)
        self.assertIsNone(secondary.gaia_source_id)

    def test_secondary_with_own_binding_untouched(self) -> None:
        # A SIMBAD-bound per-component HIP is real evidence — the blend
        # convention must not overwrite or extend it.
        pair, primary, secondary = self._fixture(rho=0.0, secondary_hip=99)
        n = bb.propagate_blend_identity([primary, secondary], [pair])
        self.assertEqual(n, 0)
        self.assertIsNone(secondary.gaia_source_id)
        self.assertEqual(secondary.hip, 99)


# ─── Kepler a + renderable-element finalization ──────────────────────


class KeplerSemimajorAxisTests(unittest.TestCase):
    def test_earth_pin(self) -> None:
        # P = 1 Julian year around 1 M_sun → exactly 1 AU.
        self.assertAlmostEqual(
            bb.kepler_semimajor_axis_au(365.25, 1.0) or 0.0, 1.0, places=12,
        )

    def test_yy_gem_scale(self) -> None:
        # P = 0.814282 d, M_total = 1.0 M_sun (two M0.5Ve tables at
        # 0.5 each) → 0.017066 AU; published YY Gem a ≈ 0.018 AU.
        self.assertAlmostEqual(
            bb.kepler_semimajor_axis_au(0.814282, 1.0) or 0.0,
            0.017066, places=6,
        )

    def test_non_positive_inputs(self) -> None:
        self.assertIsNone(bb.kepler_semimajor_axis_au(0.0, 1.0))
        self.assertIsNone(bb.kepler_semimajor_axis_au(10.0, 0.0))


class FinalizeRenderableElementsTests(unittest.TestCase):
    def _rows(
        self, orbit: "bb.OrbitElements",
        *, spect: str = "G2V", q: float | None = None,
    ) -> "tuple[bb.MultiplesRow, bb.MultiplesRow]":
        def row(role: str) -> "bb.MultiplesRow":
            return bb.MultiplesRow(
                system_id="W1-AB", comp="A" if role == "primary" else "B",
                hip=None, gaia_source_id=None,
                x_pc=0.0, y_pc=0.0, z_pc=0.0,
                absmag=4.5, ci=None, spect=spect, name="",
                source="athyg", regime=2,
                resolve_via="simbad_xid", astrometry_via="gaia_5p",
                orbit_via="gaia_nss", spect_via="simbad",
                photometry_via="athyg_own",
                a_via=(
                    bb.A_VIA_CATALOG if orbit.a_AU is not None
                    else bb.A_VIA_NONE
                ),
                orbit_role=role,
                P_days=orbit.P_days, T_jd=orbit.T_jd, e=orbit.e,
                a_AU=orbit.a_AU, i_rad=orbit.i_rad,
                omega_rad=orbit.omega_rad, Omega_rad=orbit.Omega_rad,
                q=q, dist_pc=10.0,
                sep_arcsec=0.0, pa_deg=0.0, sep_pa_epoch_jd=None,
                dmag=None,
            )
        return row("primary"), row("secondary")

    def _orbit(
        self, *, P_days: float = 365.25, e: float = 0.1,
        a_AU: float | None = None, omega_rad: float | None = 0.5,
    ) -> "bb.OrbitElements":
        return bb.OrbitElements(
            P_days=P_days, T_jd=2451545.0, e=e, a_AU=a_AU,
            i_rad=None, omega_rad=omega_rad, Omega_rad=None,
            q=None, distance_pc=10.0,
        )

    def test_kepler_a_derived_with_default_q(self) -> None:
        orbit = self._orbit()
        pri, sec = self._rows(orbit)
        bb.finalize_renderable_elements(pri, sec, orbit)
        # G2V → 1.0 M_sun; q defaults to 1/3 → M_total = 1.5;
        # a = 1.5^(1/3) = 1.144714.
        self.assertEqual(pri.q, me.UNKNOWN_COMPANION_MASS_RATIO_Q)
        self.assertAlmostEqual(pri.a_AU or 0.0, 1.5 ** (1.0 / 3.0), places=9)
        self.assertEqual(pri.a_via, bb.A_VIA_KEPLER_MASS_ESTIMATE)
        self.assertEqual(sec.a_AU, pri.a_AU)
        self.assertEqual(sec.a_via, bb.A_VIA_KEPLER_MASS_ESTIMATE)

    def test_catalog_a_left_alone(self) -> None:
        orbit = self._orbit(a_AU=23.0)
        pri, sec = self._rows(orbit, q=0.4)
        bb.finalize_renderable_elements(pri, sec, orbit)
        self.assertEqual(pri.a_AU, 23.0)
        self.assertEqual(pri.a_via, bb.A_VIA_CATALOG)
        self.assertEqual(pri.q, 0.4)

    def test_circular_orbit_omega_backfilled(self) -> None:
        orbit = self._orbit(e=0.0, omega_rad=None)
        pri, sec = self._rows(orbit)
        bb.finalize_renderable_elements(pri, sec, orbit)
        self.assertEqual(pri.omega_rad, bb.CIRCULAR_ORBIT_OMEGA_RAD)
        self.assertEqual(sec.omega_rad, bb.CIRCULAR_ORBIT_OMEGA_RAD)

    def test_eccentric_orbit_missing_omega_stays_none(self) -> None:
        orbit = self._orbit(e=0.3, omega_rad=None)
        pri, sec = self._rows(orbit)
        bb.finalize_renderable_elements(pri, sec, orbit)
        self.assertIsNone(pri.omega_rad)

    def test_unparseable_primary_spect_uses_default_mass(self) -> None:
        orbit = self._orbit()
        pri, sec = self._rows(orbit, spect="")
        bb.finalize_renderable_elements(pri, sec, orbit)
        # M₁ = 1.0 default, q = 1/3 → identical to the G2V pin.
        self.assertAlmostEqual(pri.a_AU or 0.0, 1.5 ** (1.0 / 3.0), places=9)

    def test_no_orbit_is_noop(self) -> None:
        pri, sec = self._rows(self._orbit())
        bb.finalize_renderable_elements(pri, sec, None)
        self.assertIsNone(pri.q)
        self.assertIsNone(pri.a_AU)

    def test_orb6_visual_route_is_noop(self) -> None:
        orbit = self._orbit(e=0.0, omega_rad=None)
        pri, sec = self._rows(orbit)
        pri.orbit_via = sec.orbit_via = "orb6"
        bb.finalize_renderable_elements(pri, sec, orbit)
        self.assertIsNone(pri.q)
        self.assertIsNone(pri.a_AU)
        self.assertIsNone(pri.omega_rad)


# ─── Stage-2 binding-integrity detector ──────────────────────────────

from scripts.binaries import stage2_resolve as _s2  # noqa: E402


def _bi_pair(
    wds_id: str, comps: str, rho: float | None, theta: float | None,
    date: int = 2016,
) -> "bb.WdsPair":
    return bb.WdsPair(
        wds_id=wds_id, discoverer="X 1", components=comps,
        date_last=date, rho_last=rho, theta_last=theta,
        mag_pri=None, mag_sec=None, spectral="", notes="    ",
        precise_ra_deg=None, precise_dec_deg=None,
    )


def _bi_comp(
    wds_id: str, tok: str, is_primary: bool,
    gaia: int | None, hip: int | None = None, via: str = "simbad_xid",
) -> "bb.ResolvedComponent":
    return bb.ResolvedComponent(
        wds_id=wds_id, discoverer="X 1", component=tok,
        is_primary=is_primary,
        gaia_source_id=gaia, resolve_via=(via if gaia is not None else "unresolved"),
        hip=hip,
    )


def _bi_astro(
    sid: int, e_arcsec: float, n_arcsec: float,
    *, pmra: float = 0.0, pmdec: float = 0.0, epoch: float = 2016.0,
) -> "bb.GaiaAstrometryRow":
    """A Gaia astrometry row placed at (E, N) arcsec from RA=180°, Dec=0°."""
    dec = n_arcsec / 3600.0
    ra = 180.0 + (e_arcsec / 3600.0)  # cos(0°) = 1
    return bb.GaiaAstrometryRow(
        source_id=sid, ra_deg=ra, dec_deg=dec,
        parallax_mas=10.0, parallax_error_mas=0.1,
        pmra_masyr=pmra, pmra_error_masyr=0.1,
        pmdec_masyr=pmdec, pmdec_error_masyr=0.1,
        ref_epoch=epoch, ruwe=1.0, ipd_frac_multi_peak=0.0,
        g_mag=5.0, bp_mag=5.0, rp_mag=5.0,
    )


def _bi_indices(
    src_to_astrometry: dict[int, "bb.GaiaAstrometryRow"],
    hip_to_gaia: dict[int, int] | None = None,
) -> "bb.IdentifierIndices":
    return bb.build_indices(
        athyg=[], hip2=[], hip_to_gaia=hip_to_gaia or {},
        tyc_to_gaia={}, src_to_nss={},
        src_to_astrometry=src_to_astrometry,
    )


def _bi_system(
    rows: list[tuple[str, float | None, float | None,
                     tuple[int | None, int | None],
                     tuple[int | None, int | None]]],
    wds_id: str = "10000+0000",
) -> tuple[list["bb.WdsPair"], list["bb.ResolvedComponent"]]:
    """(pairs, components) aligned in pair order (primary, secondary per
    decomposing pair) for the binding-integrity audit. Each row is
    (comps, rho, theta, (p_gaia, p_hip), (s_gaia, s_hip))."""
    pairs: list[bb.WdsPair] = []
    comps: list[bb.ResolvedComponent] = []
    for comps_str, rho, theta, pb, sb in rows:
        p_tok, s_tok = bb.split_components(comps_str)
        pairs.append(_bi_pair(wds_id, comps_str, rho, theta))
        comps.append(_bi_comp(wds_id, p_tok, True, pb[0], pb[1]))
        comps.append(_bi_comp(wds_id, s_tok, False, sb[0], sb[1]))
    return pairs, comps


class BindingRelationTests(unittest.TestCase):
    def test_ancestor_and_hierarchy(self) -> None:
        self.assertTrue(bb.is_hier_ancestor("A", "Aa"))
        self.assertTrue(bb.is_hier_ancestor("A", "Aa1"))
        self.assertTrue(bb.is_hier_ancestor("Aa", "Aa1"))
        self.assertFalse(bb.is_hier_ancestor("A", "B"))
        self.assertFalse(bb.is_hier_ancestor("A", "AB"))  # compound, not child

    def test_compound_containment(self) -> None:
        self.assertTrue(bb.compound_contains("AB", "A"))
        self.assertTrue(bb.compound_contains("AB", "Aa"))
        self.assertFalse(bb.compound_contains("AB", "C"))
        self.assertFalse(bb.compound_contains("AB", "BC"))

    def test_blend_pair_mates_transitive(self) -> None:
        self.assertTrue(_s2._are_pair_mates("A", "B", [("A", "B")]))
        # Transitive through ancestors: A roots Aa, B roots Bb.
        self.assertTrue(_s2._are_pair_mates("A", "B", [("Aa", "Bb")]))
        self.assertFalse(_s2._are_pair_mates("F", "G", [("C", "F"), ("C", "G")]))


class BindingIntegrityDetectorTests(unittest.TestCase):
    def _audit(self, rows, src_to_astrometry, hip_to_gaia=None):
        pairs, comps = _bi_system(rows)
        idx = _bi_indices(src_to_astrometry, hip_to_gaia)
        verdicts = bb.audit_binding_integrity(pairs, comps, idx, apply=False)
        return verdicts, pairs, comps, idx

    def test_source_two_secondaries_decisive(self) -> None:
        # SX bound to B and C (disjoint secondaries); SX actually sits at
        # B's WDS-measured position. Geometry keeps B, unbinds C.
        SA, SX = 100, 200
        rows = [
            ("AB", 3.0, 0.0, (SA, None), (SX, None)),
            ("AC", 10.0, 0.0, (SA, None), (SX, None)),
        ]
        astro = {SA: _bi_astro(SA, 0.0, 0.0), SX: _bi_astro(SX, 0.0, 3.0)}
        verdicts, *_ = self._audit(rows, astro)
        v = [x for x in verdicts if x.shape == _s2.BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].verdict, _s2.BINDING_VERDICT_GEOMETRIC)
        self.assertEqual(v[0].winner.label, "B")
        self.assertEqual(v[0].unbind, [("C", SX)])

    def test_letter_two_sources_decisive(self) -> None:
        # 04049-shape: letter B bound to A's source (blended, offset 0) on
        # one row and its own source (at the WDS separation) on another.
        SA, SB = 100, 200
        rows = [
            ("AB", 0.9, 0.0, (SA, None), (SB, None)),
            ("AC", 5.0, 0.0, (SA, None), (300, None)),
            ("BC", 4.1, 0.0, (SA, None), (300, None)),
        ]
        astro = {
            SA: _bi_astro(SA, 0.0, 0.0), SB: _bi_astro(SB, 0.0, 0.9),
            300: _bi_astro(300, 0.0, 5.0),
        }
        verdicts, *_ = self._audit(rows, astro)
        v = [x for x in verdicts if x.shape == _s2.BINDING_SHAPE_LETTER_SOURCES]
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].verdict, _s2.BINDING_VERDICT_GEOMETRIC)
        self.assertEqual(v[0].winner.source_id, SB)
        self.assertEqual(v[0].rebind_letter, "B")
        self.assertEqual(v[0].rebind_source, SB)

    def test_ancestor_exemption_no_conflict(self) -> None:
        # SX bound to A and Aa (ancestor/descendant) is one physical star.
        SA, SX = 100, 200
        rows = [
            ("AB", 3.0, 0.0, (SA, None), (SX, None)),   # ref A, B carries SX
            ("Aa,Ab", 0.5, 0.0, (SX, None), (400, None)),  # Aa also SX
        ]
        astro = {SA: _bi_astro(SA, 0.0, 0.0), SX: _bi_astro(SX, 0.0, 3.0),
                 400: _bi_astro(400, 0.0, 3.5)}
        verdicts, *_ = self._audit(rows, astro)
        # SX bound to {B, Aa}: B is a leaf, Aa descends from A. B and Aa
        # are disjoint, so this IS a conflict — assert instead the pure
        # ancestor case via the cluster helper.
        clusters = _s2._cluster_tokens({"A", "Aa", "Aa1"}, [])
        self.assertEqual(len(clusters), 1)

    def test_blend_pairmate_exemption(self) -> None:
        # A and B share SX via a sub-resolution (ρ = 0) blend pair — the
        # legitimate WDS convention. No conflict.
        SX = 200
        rows = [("AB", 0.0, 0.0, (SX, None), (SX, None))]
        astro = {SX: _bi_astro(SX, 0.0, 0.0)}
        verdicts, *_ = self._audit(rows, astro)
        self.assertEqual(verdicts, [])

    def test_measured_pairmate_is_conflict(self) -> None:
        # Same bindings but the AB pair has a MEASURED separation — two
        # letters at ρ > 0 cannot be one source. Now a conflict.
        SX, SC = 200, 300
        rows = [
            ("AB", 1.0, 0.0, (SX, None), (SX, None)),
            ("AC", 10.0, 0.0, (SX, None), (SC, None)),
        ]
        astro = {SX: _bi_astro(SX, 0.0, 0.0), SC: _bi_astro(SC, 0.0, 10.0)}
        verdicts, *_ = self._audit(rows, astro)
        v = [x for x in verdicts if x.shape == _s2.BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)

    def test_compound_containment_exemption(self) -> None:
        # SX bound to AB (compound) and A — A is contained in AB.
        clusters = _s2._cluster_tokens({"AB", "A"}, [])
        self.assertEqual(len(clusters), 1)

    def test_ambiguous_unbinds_all(self) -> None:
        # SX sits BETWEEN B and C (no decisive winner) → unbind both.
        SA, SX = 100, 200
        rows = [
            ("AB", 3.0, 0.0, (SA, None), (SX, None)),
            ("AC", 5.0, 0.0, (SA, None), (SX, None)),
        ]
        astro = {SA: _bi_astro(SA, 0.0, 0.0), SX: _bi_astro(SX, 0.0, 4.0)}
        verdicts, *_ = self._audit(rows, astro)
        v = [x for x in verdicts if x.shape == _s2.BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].verdict, _s2.BINDING_VERDICT_UNBOUND_AMBIGUOUS)
        self.assertEqual(sorted(v[0].unbind), [("B", SX), ("C", SX)])

    def test_photocentre_blend_high_err_skipped(self) -> None:
        # Castor shape: A,B are a MEASURED pair whose two components share
        # one Gaia source (a blend). Geometry elects B, but the source sits
        # 1.5" off B — a photocentre between A and B, not on either. Beyond
        # the blend floor → skipped, bindings untouched (no unbind-all).
        SX, SC = 200, 300
        rows = [
            ("AB", 5.0, 0.0, (SX, None), (SX, None)),
            ("AC", 10.0, 0.0, (SX, None), (SC, None)),
        ]
        astro = {SX: _bi_astro(SX, 0.0, -6.5), SC: _bi_astro(SC, 0.0, 0.0)}
        verdicts, _p, comps, _i = self._audit(rows, astro)
        v = [x for x in verdicts if x.shape == _s2.BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(
            v[0].verdict, _s2.BINDING_VERDICT_SKIPPED_PHOTOCENTRE_BLEND,
        )
        self.assertEqual(v[0].unbind, [])

    def test_photocentre_blend_low_err_unbinds(self) -> None:
        # Same measured-blend shape (15268 / 20312), but geometry lands the
        # source ON A (0.3" error, within the blend floor) — Gaia resolved
        # which component, so the loser B is unbound and re-homes.
        SX, SC = 200, 300
        rows = [
            ("AB", 5.0, 0.0, (SX, None), (SX, None)),
            ("AC", 10.0, 0.0, (SX, None), (SC, None)),
        ]
        astro = {SX: _bi_astro(SX, 0.0, -9.7), SC: _bi_astro(SC, 0.0, 0.0)}
        verdicts, *_ = self._audit(rows, astro)
        v = [x for x in verdicts if x.shape == _s2.BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].verdict, _s2.BINDING_VERDICT_GEOMETRIC)
        self.assertEqual(v[0].winner.label, "A")
        self.assertEqual(v[0].unbind, [("B", SX)])

    def test_photocentre_blend_ambiguous_skipped_not_unbound(self) -> None:
        # A blend source with the photocentre exactly between A and B: no
        # decisive winner. A non-blend ambiguous conflict unbinds all; a
        # blend is skipped instead — stripping a real blended source is
        # never right.
        SX, SC = 200, 300
        rows = [
            ("AB", 5.0, 0.0, (SX, None), (SX, None)),
            ("AC", 10.0, 0.0, (SX, None), (SC, None)),
        ]
        astro = {SX: _bi_astro(SX, 0.0, -7.5), SC: _bi_astro(SC, 0.0, 0.0)}
        verdicts, *_ = self._audit(rows, astro)
        v = [x for x in verdicts if x.shape == _s2.BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(
            v[0].verdict, _s2.BINDING_VERDICT_SKIPPED_PHOTOCENTRE_BLEND,
        )
        self.assertEqual(v[0].unbind, [])

    @staticmethod
    def _xid(gaia: int | None, hip: int | None = None) -> "bb.SimbadWdsXid":
        return bb.SimbadWdsXid(
            simbad_oid=1, simbad_main_id="* tst", gaia_source_id=gaia, hip=hip,
        )

    def _audit_with_xids(self, rows, src_to_astrometry, simbad_xids):
        pairs, comps = _bi_system(rows)
        idx = _bi_indices(src_to_astrometry)
        return bb.audit_binding_integrity(
            pairs, comps, idx, apply=True, simbad_xids=simbad_xids,
        ), comps

    def test_photocentre_blend_identity_refuted(self) -> None:
        # 36 Oph shape: SIMBAD's cross-IDs give A its own source and B
        # ownership of the contested one — the "blend" is a crosswalk
        # mis-match, not a photocentre. A (the loser) rebinds to its own
        # source; B keeps the contested source; no shape-(b) verdict for
        # the rebound letter.
        SA, SX, SC = 100, 200, 300
        rows = [
            ("AB", 5.0, 0.0, (SX, None), (SX, None)),
            ("AC", 10.0, 0.0, (SA, None), (SC, None)),
        ]
        astro = {
            SA: _bi_astro(SA, 0.0, 0.0), SX: _bi_astro(SX, 0.0, -6.5),
            SC: _bi_astro(SC, 0.0, 0.0),
        }
        xids = {
            ("10000+0000", "A"): self._xid(SA),
            ("10000+0000", "B"): self._xid(SX),
        }
        verdicts, comps = self._audit_with_xids(rows, astro, xids)
        v = [x for x in verdicts if x.shape == _s2.BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].verdict, _s2.BINDING_VERDICT_IDENTITY_REFUTED)
        self.assertEqual(v[0].winner.label, "B")
        self.assertEqual(v[0].rebind_letter, "A")
        self.assertEqual(v[0].rebind_source, SA)
        self.assertEqual(
            [x for x in verdicts
             if x.shape == _s2.BINDING_SHAPE_LETTER_SOURCES], [],
        )
        by_tok = {(c.component, c.is_primary): c for c in comps}
        self.assertEqual(by_tok[("A", True)].gaia_source_id, SA)
        self.assertEqual(by_tok[("B", False)].gaia_source_id, SX)

    def test_identity_refutes_with_multi_token_owner_cluster(self) -> None:
        # μ Dra shape once the MSC Ba,Bb sub-pair joins the pre-audit
        # graph: the contested source's owner side is the hierarchy
        # cluster {B, Ba, Bb}, identified by its representative B. The
        # loser (A, single token) still rebinds to its own source.
        SA, SX, SC = 100, 200, 300
        rows = [
            ("AB", 5.0, 0.0, (SX, None), (SX, None)),
            ("AC", 10.0, 0.0, (SA, None), (SC, None)),
            ("Ba,Bb", 0.0, 0.0, (SX, None), (SX, None)),
        ]
        astro = {
            SA: _bi_astro(SA, 0.0, 0.0), SX: _bi_astro(SX, 0.0, -6.5),
            SC: _bi_astro(SC, 0.0, 0.0),
        }
        xids = {
            ("10000+0000", "A"): self._xid(SA),
            ("10000+0000", "B"): self._xid(SX),
        }
        verdicts, comps = self._audit_with_xids(rows, astro, xids)
        v = [x for x in verdicts if x.shape == _s2.BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].verdict, _s2.BINDING_VERDICT_IDENTITY_REFUTED)
        self.assertEqual(v[0].winner.label, "B")
        self.assertEqual(sorted(v[0].winner.tokens), ["B", "Ba", "Bb"])
        self.assertEqual(v[0].rebind_letter, "A")
        by_tok = {(c.component, c.is_primary): c for c in comps}
        self.assertEqual(by_tok[("A", True)].gaia_source_id, SA)
        self.assertEqual(by_tok[("Ba", True)].gaia_source_id, SX)

    def test_blend_unidentified_side_stays_skipped(self) -> None:
        # Castor shape: the primary is Gaia-saturated so SIMBAD carries no
        # DR3 source for it — identity can't refute, the blend skip holds.
        SX, SC = 200, 300
        rows = [
            ("AB", 5.0, 0.0, (SX, None), (SX, None)),
            ("AC", 10.0, 0.0, (SX, None), (SC, None)),
        ]
        astro = {SX: _bi_astro(SX, 0.0, -6.5), SC: _bi_astro(SC, 0.0, 0.0)}
        xids = {
            ("10000+0000", "A"): self._xid(None),
            ("10000+0000", "B"): self._xid(SX),
        }
        verdicts, _comps = self._audit_with_xids(rows, astro, xids)
        v = [x for x in verdicts if x.shape == _s2.BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(
            v[0].verdict, _s2.BINDING_VERDICT_SKIPPED_PHOTOCENTRE_BLEND,
        )

    def test_blend_no_owner_stays_skipped(self) -> None:
        # Both sides identified but NEITHER owns the contested source —
        # identities don't explain the binding, so no guess: skip holds.
        SA, SB, SX, SC = 100, 150, 200, 300
        rows = [
            ("AB", 5.0, 0.0, (SX, None), (SX, None)),
            ("AC", 10.0, 0.0, (SX, None), (SC, None)),
        ]
        astro = {SX: _bi_astro(SX, 0.0, -6.5), SC: _bi_astro(SC, 0.0, 0.0)}
        xids = {
            ("10000+0000", "A"): self._xid(SA),
            ("10000+0000", "B"): self._xid(SB),
        }
        verdicts, _comps = self._audit_with_xids(rows, astro, xids)
        v = [x for x in verdicts if x.shape == _s2.BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(
            v[0].verdict, _s2.BINDING_VERDICT_SKIPPED_PHOTOCENTRE_BLEND,
        )

    def test_refutation_via_xid_hip_route(self) -> None:
        # The loser's SIMBAD cross-ID carries only a HIP; the hip→gaia
        # crosswalk supplies its own source. Same refutation.
        SA, SX, SC = 100, 200, 300
        rows = [
            ("AB", 5.0, 0.0, (SX, None), (SX, None)),
            ("AC", 10.0, 0.0, (SA, None), (SC, None)),
        ]
        astro = {
            SA: _bi_astro(SA, 0.0, 0.0), SX: _bi_astro(SX, 0.0, -6.5),
            SC: _bi_astro(SC, 0.0, 0.0),
        }
        pairs, comps = _bi_system(rows)
        idx = _bi_indices(astro, hip_to_gaia={77: SA})
        xids = {
            ("10000+0000", "A"): self._xid(None, hip=77),
            ("10000+0000", "B"): self._xid(SX),
        }
        verdicts = bb.audit_binding_integrity(
            pairs, comps, idx, apply=False, simbad_xids=xids,
        )
        v = [x for x in verdicts if x.shape == _s2.BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].verdict, _s2.BINDING_VERDICT_IDENTITY_REFUTED)
        self.assertEqual(v[0].rebind_source, SA)

    def test_wide_pair_no_longer_rubber_stamped(self) -> None:
        # A non-blend source bound to two distant secondaries, sitting 2.5"
        # off the nearer one. The old sep-scaled tolerance (0.15·sep) would
        # have called this decisive on a wide pair; the flat floor refuses.
        SA, SX = 100, 200
        rows = [
            ("AB", 60.0, 0.0, (SA, None), (SX, None)),
            ("AC", 80.0, 0.0, (SA, None), (SX, None)),
        ]
        astro = {SA: _bi_astro(SA, 0.0, 0.0), SX: _bi_astro(SX, 0.0, 62.5)}
        verdicts, *_ = self._audit(rows, astro)
        v = [x for x in verdicts if x.shape == _s2.BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].verdict, _s2.BINDING_VERDICT_UNBOUND_AMBIGUOUS)

    def test_refute_disconnected_graph_decisive(self) -> None:
        # 03413-shape: SX bound to a blended A/B pair (disconnected from
        # the reference) and to F, G in the C-subsystem. Geometry refutes
        # F and G; A/B is unreachable but the only home left → decisive.
        SX, SC, SB2 = 200, 300, 400
        rows = [
            ("AB", 0.0, 0.0, (SX, None), (SX, None)),   # blend: A,B one cluster
            ("CF", 0.1, 0.0, (SC, None), (SX, None)),   # F mis-bound to SX
            ("CG", 5.0, 90.0, (SC, None), (SX, None)),  # G mis-bound to SX
        ]
        astro = {SX: _bi_astro(SX, 0.0, 20.0), SC: _bi_astro(SC, 0.0, 0.0)}
        verdicts, *_ = self._audit(rows, astro)
        v = [x for x in verdicts if x.shape == _s2.BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].verdict, _s2.BINDING_VERDICT_GEOMETRIC)
        self.assertEqual(set(v[0].winner.tokens), {"A", "B"})
        self.assertEqual(sorted(v[0].unbind), [("F", SX), ("G", SX)])

    def test_skipped_no_reference(self) -> None:
        # SX bound to two disjoint letters and NO uncontested astrometric
        # anchor exists → skipped_no_reference.
        SX = 200
        rows = [
            ("AB", 3.0, 0.0, (SX, None), (SX, None)),
            ("CD", 3.0, 0.0, (SX, None), (SX, None)),
        ]
        astro = {SX: _bi_astro(SX, 0.0, 0.0)}
        verdicts, *_ = self._audit(rows, astro)
        self.assertTrue(verdicts)
        self.assertTrue(all(
            x.verdict == _s2.BINDING_VERDICT_SKIPPED_NO_REFERENCE
            for x in verdicts
        ))

    def test_apply_unbinds_loser_and_maps_hip(self) -> None:
        # Enforcement clears the loser's gaia; hip clears because it
        # cross-walks to the contested source.
        SA, SX = 100, 200
        rows = [
            ("AB", 3.0, 0.0, (SA, None), (SX, 55)),
            ("AC", 10.0, 0.0, (SA, None), (SX, 55)),
        ]
        astro = {SA: _bi_astro(SA, 0.0, 0.0), SX: _bi_astro(SX, 0.0, 3.0)}
        pairs, comps = _bi_system(rows)
        idx = _bi_indices(astro, hip_to_gaia={55: SX})
        bb.audit_binding_integrity(pairs, comps, idx, apply=True)
        c_comp = next(c for c in comps if c.component == "C")
        self.assertIsNone(c_comp.gaia_source_id)
        self.assertIsNone(c_comp.hip)
        self.assertEqual(c_comp.resolve_via, "unresolved")
        b_comp = next(c for c in comps if c.component == "B")
        self.assertEqual(b_comp.gaia_source_id, SX)

    def test_apply_keeps_independently_distinct_hip(self) -> None:
        # The loser's hip does NOT cross-walk to the contested source and
        # differs from the winner's — it survives for Stage 3's HIP2 path.
        SA, SX = 100, 200
        rows = [
            ("AB", 3.0, 0.0, (SA, None), (SX, None)),
            ("AC", 10.0, 0.0, (SA, None), (SX, 99)),
        ]
        astro = {SA: _bi_astro(SA, 0.0, 0.0), SX: _bi_astro(SX, 0.0, 3.0)}
        pairs, comps = _bi_system(rows)
        idx = _bi_indices(astro, hip_to_gaia={})
        bb.audit_binding_integrity(pairs, comps, idx, apply=True)
        c_comp = next(c for c in comps if c.component == "C")
        self.assertIsNone(c_comp.gaia_source_id)
        self.assertEqual(c_comp.hip, 99)

    def test_downward_parent_inheritance(self) -> None:
        # A bound to SA; Aa unbound → inherits A's binding.
        SA = 100
        pairs = [_bi_pair("10000+0000", "A,B", 5.0, 0.0)]
        comps = [
            _bi_comp("10000+0000", "A", True, SA),
            _bi_comp("10000+0000", "B", False, 300),
        ]
        # Add an Aa,Ab pair whose Aa is unbound.
        pairs.append(_bi_pair("10000+0000", "Aa,Ab", 0.0, 0.0))
        comps.append(_bi_comp("10000+0000", "Aa", True, None))
        comps.append(_bi_comp("10000+0000", "Ab", False, None))
        n = bb.inherit_downward_parent_bindings(pairs, comps)
        self.assertEqual(n, 2)  # Aa and Ab both inherit A's binding
        aa = next(c for c in comps if c.component == "Aa")
        ab = next(c for c in comps if c.component == "Ab")
        self.assertEqual(aa.gaia_source_id, SA)
        self.assertEqual(ab.gaia_source_id, SA)

    def test_counts_aggregate(self) -> None:
        v_geo = _s2.BindingVerdict(
            "w", _s2.BINDING_SHAPE_SOURCE_LETTERS,
            _s2.BINDING_VERDICT_GEOMETRIC, "c", None, None, None, [],
        )
        v_amb = _s2.BindingVerdict(
            "w", _s2.BINDING_SHAPE_SOURCE_LETTERS,
            _s2.BINDING_VERDICT_UNBOUND_AMBIGUOUS, "c", None, None, None, [],
        )
        v_skip = _s2.BindingVerdict(
            "w", _s2.BINDING_SHAPE_LETTER_SOURCES,
            _s2.BINDING_VERDICT_SKIPPED_NO_REFERENCE, "c", None, None, None, [],
        )
        v_blend = _s2.BindingVerdict(
            "w", _s2.BINDING_SHAPE_SOURCE_LETTERS,
            _s2.BINDING_VERDICT_SKIPPED_PHOTOCENTRE_BLEND,
            "c", None, None, None, [],
        )
        counts = bb.binding_integrity_counts([v_geo, v_amb, v_skip, v_blend])
        self.assertEqual(counts["binding_conflicts_source_letters"], 3)
        self.assertEqual(counts["binding_conflicts_letter_sources"], 1)
        self.assertEqual(counts["arbitrated_geometric"], 1)
        self.assertEqual(counts["arbitrated_unbound_ambiguous"], 1)
        self.assertEqual(counts["arbitration_skipped_no_reference"], 1)
        self.assertEqual(counts["arbitration_skipped_photocentre_blend"], 1)

    def test_report_only_does_not_mutate(self) -> None:
        SA, SX = 100, 200
        rows = [
            ("AB", 3.0, 0.0, (SA, None), (SX, None)),
            ("AC", 10.0, 0.0, (SA, None), (SX, None)),
        ]
        astro = {SA: _bi_astro(SA, 0.0, 0.0), SX: _bi_astro(SX, 0.0, 3.0)}
        pairs, comps = _bi_system(rows)
        idx = _bi_indices(astro)
        before = [(c.gaia_source_id, c.hip, c.resolve_via) for c in comps]
        bb.audit_binding_integrity(pairs, comps, idx, apply=False)
        after = [(c.gaia_source_id, c.hip, c.resolve_via) for c in comps]
        self.assertEqual(before, after)

    def test_bfs_composes_multi_hop(self) -> None:
        adj = {
            "A": {"B": (5.0, 0.0, 2016.0)},
            "B": {"A": (-5.0, 0.0, 2016.0), "C": (5.0, 0.0, 2015.0)},
            "C": {"B": (-5.0, 0.0, 2015.0)},
        }
        e, n, epoch = _s2._bfs_offset(adj, "A", "C")
        self.assertAlmostEqual(e, 10.0)
        self.assertAlmostEqual(n, 0.0)
        self.assertEqual(epoch, 2015.0)
        self.assertIsNone(_s2._bfs_offset({"A": {}}, "A", "Z"))

    def test_tsv_write_shape(self) -> None:
        SA, SX = 100, 200
        rows = [
            ("AB", 3.0, 0.0, (SA, None), (SX, None)),
            ("AC", 10.0, 0.0, (SA, None), (SX, None)),
        ]
        astro = {SA: _bi_astro(SA, 0.0, 0.0), SX: _bi_astro(SX, 0.0, 3.0)}
        verdicts, *_ = self._audit(rows, astro)
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "verdicts.tsv"
            n = bb.write_binding_verdicts_tsv(verdicts, out)
            lines = out.read_text().splitlines()
        self.assertEqual(n, len(verdicts))
        self.assertEqual(
            lines[0].split("\t"), list(_s2.BINDING_VERDICT_TSV_COLUMNS),
        )
        self.assertEqual(len(lines), len(verdicts) + 1)


class ComputeAnchorOffsetsTests(unittest.TestCase):
    """Stage 6 per-component anchor offsets — tiered BFS over kept →
    rejected → compound-proxy WDS geometry."""

    def _pair_with_comps(
        self,
        components: str,
        rho: float | None,
        theta: float | None,
        *,
        wds_id: str = "WDS-1",
    ) -> tuple["bb.WdsPair", list["bb.ResolvedComponent"]]:
        pair = _wds_pair(
            wds_id=wds_id, components=components,
            rho_last=rho, theta_last=theta,
        )
        toks = bb.split_components(components)
        assert toks is not None
        return pair, [
            _resolved(gaia=None, wds_id=wds_id, component=toks[0],
                      is_primary=True),
            _resolved(gaia=None, wds_id=wds_id, component=toks[1],
                      is_primary=False),
        ]

    def _offsets(
        self,
        specs: list[tuple[str, float | None, float | None, bool]],
    ) -> dict[tuple[str, str], tuple[float, float]]:
        pairs, comps, classifications = [], [], []
        for components, rho, theta, kept in specs:
            p, c = self._pair_with_comps(components, rho, theta)
            pairs.append(p)
            comps.extend(c)
            classifications.append(bb.OpticalClassification(
                kept, "wds_notes_kept" if kept else "wds_notes_rejected",
            ))
        return bb.compute_anchor_offsets(pairs, comps, classifications)

    def test_kept_pair_gives_direct_offset(self) -> None:
        out = self._offsets([("AB", 5.0, 90.0, True)])
        sep, pa = out[("WDS-1", "B")]
        self.assertAlmostEqual(sep, 5.0)
        self.assertAlmostEqual(pa, 90.0)
        self.assertNotIn(("WDS-1", "A"), out)  # anchor itself is absent

    def test_chain_composes_through_intermediate_letter(self) -> None:
        out = self._offsets([
            ("AB", 5.0, 90.0, True),
            ("BC", 5.0, 90.0, True),
        ])
        sep, pa = out[("WDS-1", "C")]
        self.assertAlmostEqual(sep, 10.0)
        self.assertAlmostEqual(pa, 90.0)

    def test_rejected_pair_reaches_component_kept_graph_missed(self) -> None:
        # Acrux shape: the AB row is Stage-5 rejected (WDS U flag) and
        # no kept edge reaches B, so B's offset comes from the rejected
        # row's geometry — real astrometry regardless of boundness.
        out = self._offsets([
            ("AC", 90.0, 202.0, True),
            ("AB", 3.5, 114.0, False),
        ])
        sep, pa = out[("WDS-1", "B")]
        self.assertAlmostEqual(sep, 3.5)
        self.assertAlmostEqual(pa, 114.0)

    def test_direct_rejected_edge_beats_degenerate_kept_chain(self) -> None:
        # Acrux: AC and BC carry identical last measurements (89″/203°),
        # so the kept chain A→C→B cancels to zero. The direct (rejected)
        # AB edge is the honest placement and must win.
        out = self._offsets([
            ("AC", 89.0, 203.0, True),
            ("BC", 89.0, 203.0, True),
            ("AB", 3.5, 111.0, False),
        ])
        sep, pa = out[("WDS-1", "B")]
        self.assertAlmostEqual(sep, 3.5)
        self.assertAlmostEqual(pa, 111.0)

    def test_kept_geometry_wins_over_rejected_for_same_component(self) -> None:
        out = self._offsets([
            ("AB", 5.0, 90.0, True),
            ("AB", 8.0, 45.0, False),
        ])
        sep, pa = out[("WDS-1", "B")]
        self.assertAlmostEqual(sep, 5.0)
        self.assertAlmostEqual(pa, 90.0)

    def test_compound_proxy_places_constituent_letters(self) -> None:
        # omicron And shape: the A,BC compound row lends its photocentre
        # vector to B and C.
        out = self._offsets([
            ("A,BC", 0.5, 299.0, True),
        ])
        for tok in ("B", "C"):
            sep, pa = out[("WDS-1", tok)]
            self.assertAlmostEqual(sep, 0.5)
            self.assertAlmostEqual(pa, 299.0)

    def test_measured_edge_wins_over_compound_proxy(self) -> None:
        out = self._offsets([
            ("A,BC", 80.0, 100.0, True),
            ("AB", 5.0, 90.0, True),
        ])
        sep, pa = out[("WDS-1", "B")]
        self.assertAlmostEqual(sep, 5.0)
        self.assertAlmostEqual(pa, 90.0)
        sep_c, pa_c = out[("WDS-1", "C")]
        self.assertAlmostEqual(sep_c, 80.0)
        self.assertAlmostEqual(pa_c, 100.0)

    def test_unreachable_component_absent(self) -> None:
        out = self._offsets([
            ("AB", 5.0, 90.0, True),
            ("CD", 3.0, 10.0, True),  # disconnected island
        ])
        self.assertIn(("WDS-1", "B"), out)
        self.assertNotIn(("WDS-1", "C"), out)
        self.assertNotIn(("WDS-1", "D"), out)

    def test_anchor_is_most_canonical_kept_primary(self) -> None:
        # No 'A' primary: B (BC row) outranks C. Offsets chain from B.
        out = self._offsets([
            ("BC", 5.0, 90.0, True),
            ("CD", 5.0, 90.0, True),
        ])
        self.assertNotIn(("WDS-1", "B"), out)
        self.assertAlmostEqual(out[("WDS-1", "C")][0], 5.0)
        self.assertAlmostEqual(out[("WDS-1", "D")][0], 10.0)

    def test_sub_resolution_rows_contribute_no_edge(self) -> None:
        out = self._offsets([
            ("AB", 5.0, 90.0, True),
            ("Ba,Bb", 0.0, None, True),
        ])
        self.assertNotIn(("WDS-1", "Ba"), out)
        self.assertNotIn(("WDS-1", "Bb"), out)

    def test_system_with_no_kept_pairs_emits_nothing(self) -> None:
        out = self._offsets([("AB", 5.0, 90.0, False)])
        self.assertEqual(out, {})




# ─── Pulkovo MSC ingest ──────────────────────────────────────────────


def _msc_system(
    wds_id: str = "10000+0000", prim: str = "A", sec: str = "B",
    parent: str = "*", vmag1: float | None = None, spt1: str = "",
    vmag2: float | None = None, spt2: str = "",
) -> "bb.MscSystemRow":
    return bb.MscSystemRow(
        wds_id=wds_id, prim=prim, sec=sec, parent=parent, obs_type="",
        vmag1=vmag1, spt1=spt1, vmag2=vmag2, spt2=spt2,
    )


def _msc_orbit(
    wds_id: str = "10000+0000", syst: str = "Aa,Ab",
    per: float | None = 6.0663, per_unit: str = "d",
    t0: float | None = 40087.19, e: float | None = 0.25,
    a_arcsec: float | None = None, node_deg: float | None = None,
    longp_deg: float | None = 31.4, incl_deg: float | None = None,
    note: str = "",
) -> "bb.MscOrbitRow":
    return bb.MscOrbitRow(
        wds_id=wds_id, syst=syst, per=per, per_unit=per_unit, t0=t0, e=e,
        a_arcsec=a_arcsec, node_deg=node_deg, longp_deg=longp_deg,
        incl_deg=incl_deg, note=note,
    )


class MscParserTests(unittest.TestCase):
    def test_systems_parse_survives_arcsec_quote_cells(self) -> None:
        # MSC's sep_unit cell is a literal `"` — default csv quoting
        # treats it as an opening quote and merges rows.
        body = (
            "wds_id\tprim\tsec\tparent\tobs_type\tper\tper_unit\tsep\t"
            "sep_unit\tpa_deg\tvmag1\tspt1\tvmag2\tspt2\tmass1_msun\t"
            "mass2_msun\n"
            "00003-4417\tAB\tC\t*\tCmp\t107.0695\tk\t40.443\t\"\t318.2\t"
            "17.68\t\t19.89\t\t3.15\t0.13\n"
            "00003-4417\tA\tB\tAB\tV\t119.1\ty\t0.424\t\"\t327.0\t6.8\t"
            "G3IV\t7.56\t\t1.7\t1.45\n"
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "msc_systems.tsv", body)
            rows = bb.parse_msc_systems(p)
        self.assertEqual(len(rows), 2)
        self.assertEqual(
            (rows[1].prim, rows[1].sec, rows[1].parent, rows[1].spt1,
             rows[1].vmag2),
            ("A", "B", "AB", "G3IV", 7.56),
        )

    def test_orbits_parse(self) -> None:
        body = (
            "wds_id\tsyst\tper\tper_unit\tt0\te\ta_arcsec\tnode_deg\t"
            "longp_deg\tincl_deg\tk1_kms\tk2_kms\tv0_kms\tnode_flag\tnote\n"
            "23300+5833\tAa,Ab\t6.0663\td\t40087.1914\t0.25\t\t\t31.4\t\t"
            "56.7\t\t-13.4\tB\tSB9_1445\n"
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "msc_orbits.tsv", body)
            rows = bb.parse_msc_orbits(p)
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual((r.syst, r.per, r.per_unit), ("Aa,Ab", 6.0663, "d"))
        self.assertIsNone(r.a_arcsec)
        self.assertEqual(r.longp_deg, 31.4)

    def test_shipped_msc_files_parse_and_cover_showcases(self) -> None:
        systems = bb.parse_msc_systems(bb.SRC_MSC_SYSTEMS)
        orbits = bb.parse_msc_orbits(bb.SRC_MSC_ORBITS)
        self.assertGreater(len(systems), 13_000)
        self.assertGreater(len(orbits), 4_000)
        ar_cas = [
            o for o in orbits
            if o.wds_id == "23300+5833" and o.syst == "Aa,Ab"
        ]
        self.assertEqual(len(ar_cas), 1)
        self.assertEqual(ar_cas[0].per, 6.0663)


class MscMapTests(unittest.TestCase):
    def test_top_level_and_convention_children_map_identity(self) -> None:
        # AR Cas shape: root ties ('t'), compound constituents, and a
        # WDS-convention sub-pair all map onto themselves.
        rows = [
            _msc_system(prim="AB", sec="FG", parent="t"),
            _msc_system(prim="F", sec="G", parent="FG"),
            _msc_system(prim="A", sec="B", parent="AB"),
            _msc_system(prim="Aa", sec="Ab", parent="A"),
        ]
        mapping = bb.map_msc_labels(rows)
        self.assertEqual(mapping, {
            "AB": "AB", "FG": "FG", "F": "F", "G": "G",
            "A": "A", "B": "B", "Aa": "Aa", "Ab": "Ab",
        })

    def test_union_label_relabels_one_level_down(self) -> None:
        # ν Sco shape: MSC's (Aab,Ac) under A is WDS (Aa,Ab), so MSC's
        # (Aa,Ab) under Aab re-homes to (Aa1,Aa2).
        rows = [
            _msc_system(prim="AB", sec="CD", parent="*"),
            _msc_system(prim="A", sec="B", parent="AB"),
            _msc_system(prim="Aab", sec="Ac", parent="A"),
            _msc_system(prim="Aa", sec="Ab", parent="Aab"),
        ]
        mapping = bb.map_msc_labels(rows)
        self.assertEqual(mapping["Aab"], "Aa")
        self.assertEqual(mapping["Ac"], "Ab")
        self.assertEqual(mapping["Aa"], "Aa1")
        self.assertEqual(mapping["Ab"], "Aa2")

    def test_unmappable_union_at_root_drops_subtree(self) -> None:
        rows = [
            _msc_system(prim="Aab", sec="C", parent="X"),
            _msc_system(prim="Aa", sec="Ab", parent="Aab"),
        ]
        mapping = bb.map_msc_labels(rows)
        self.assertNotIn("Aab", mapping)
        self.assertNotIn("Aa", mapping)
        self.assertEqual(mapping.get("C"), "C")


class MscLookupTests(unittest.TestCase):
    def test_orbit_keys_on_mapped_tokens(self) -> None:
        systems = [
            _msc_system(prim="A", sec="B", parent="*"),
            _msc_system(prim="Aab", sec="Ac", parent="A"),
            _msc_system(prim="Aa", sec="Ab", parent="Aab",
                        vmag1=4.37, spt1="B3V", vmag2=6.9),
        ]
        orbits = [
            _msc_orbit(syst="Aa,Ab"),
            _msc_orbit(syst="A"),  # bare label: unmappable
        ]
        lk = bb.build_msc_lookup(systems, orbits, [])
        self.assertIn(("10000+0000", ("Aa1", "Aa2")), lk.orbits_by_pair)
        self.assertEqual(lk.n_orbits_unmapped, 1)
        self.assertEqual(
            lk.pair_mags[("10000+0000", ("Aa1", "Aa2"))], (4.37, 6.9),
        )
        self.assertEqual(lk.spect_by_comp[("10000+0000", "Aa1")], "B3V")
        self.assertNotIn(("10000+0000", "Aa2"), lk.spect_by_comp)

    def test_components_table_type_beats_pair_side(self) -> None:
        systems = [_msc_system(spt1="B3IV")]
        components = [bb.MscComponentRow(
            wds_id="10000+0000", comp="A", spt="B3V", vmag=None,
        )]
        lk = bb.build_msc_lookup(systems, [], components)
        self.assertEqual(lk.spect_by_comp[("10000+0000", "A")], "B3V")

    def test_compound_sides_never_enter_spect(self) -> None:
        systems = [_msc_system(prim="AB", sec="C", spt1="F7IV", spt2="A1V")]
        lk = bb.build_msc_lookup(systems, [], [])
        self.assertNotIn(("10000+0000", "AB"), lk.spect_by_comp)
        self.assertEqual(lk.spect_by_comp[("10000+0000", "C")], "A1V")


class MscOrbitElementTests(unittest.TestCase):
    def test_period_units(self) -> None:
        self.assertEqual(bb._msc_period_days(_msc_orbit(per=6.0, per_unit="d")), 6.0)
        self.assertEqual(
            bb._msc_period_days(_msc_orbit(per=2.0, per_unit="y")), 730.5,
        )
        self.assertIsNone(bb._msc_period_days(_msc_orbit(per=2.0, per_unit="")))
        self.assertIsNone(bb._msc_period_days(_msc_orbit(per=0.0, per_unit="d")))

    def test_t0_disambiguation(self) -> None:
        # Besselian-year reading (AR Cas A,B-style visual epochs).
        self.assertAlmostEqual(
            bb.msc_T0_jd(1948.33),
            bb.J2000_REF_EPOCH_JD + (1948.33 - 2000.0) * 365.25,
        )
        # Truncated-JD reading (SB subsystems: JD − 2,400,000).
        self.assertAlmostEqual(bb.msc_T0_jd(40087.1914), 2440087.1914)
        self.assertIsNone(bb.msc_T0_jd(None))
        # Implausible under both readings.
        self.assertIsNone(bb.msc_T0_jd(9.9e7))

    def test_sb_row_converts_without_geometry(self) -> None:
        orbit = bb.msc_to_canonical_elements(_msc_orbit(), None)
        self.assertIsNotNone(orbit)
        self.assertEqual(orbit.P_days, 6.0663)
        self.assertAlmostEqual(orbit.T_jd, 2440087.19)
        self.assertEqual(orbit.e, 0.25)
        self.assertAlmostEqual(orbit.omega_rad, math.radians(31.4))
        self.assertIsNone(orbit.i_rad)
        self.assertIsNone(orbit.Omega_rad)
        self.assertIsNone(orbit.a_AU)

    def test_visual_row_converts_a_with_parallax(self) -> None:
        row = _msc_orbit(
            per=500.0, per_unit="y", t0=1672.0, e=0.5,
            a_arcsec=1.126, node_deg=0.9, longp_deg=125.0, incl_deg=91.2,
        )
        orbit = bb.msc_to_canonical_elements(row, 10.0)
        self.assertAlmostEqual(orbit.a_AU, 112.6)
        self.assertAlmostEqual(orbit.i_rad, math.radians(91.2))
        self.assertAlmostEqual(orbit.Omega_rad, math.radians(0.9))
        # No parallax → a stays None, orbit still returned.
        self.assertIsNone(bb.msc_to_canonical_elements(row, None).a_AU)

    def test_renderable_gates(self) -> None:
        self.assertTrue(bb.msc_renderable(_msc_orbit()))
        self.assertFalse(bb.msc_renderable(_msc_orbit(t0=None)))
        self.assertFalse(bb.msc_renderable(_msc_orbit(e=None)))
        # Eccentric with no ω can't render; circular with no ω can
        # (Stage 6 backfills the degenerate angle).
        self.assertFalse(bb.msc_renderable(_msc_orbit(longp_deg=None)))
        self.assertTrue(bb.msc_renderable(_msc_orbit(e=0.0, longp_deg=None)))

    def test_pick_best_msc_completeness_then_last(self) -> None:
        sparse = _msc_orbit(a_arcsec=None, incl_deg=None)
        full_old = _msc_orbit(a_arcsec=0.07, node_deg=346.4, incl_deg=89.7)
        full_new = _msc_orbit(a_arcsec=0.10, node_deg=344.9, incl_deg=90.1)
        self.assertIs(bb._pick_best_msc([sparse, full_old]), full_old)
        # Equal completeness → later edition wins (author updates append).
        self.assertIs(bb._pick_best_msc([full_old, full_new]), full_new)
        self.assertIs(bb._pick_best_msc([full_new, sparse]), full_new)


class SelectOrbitMscTests(unittest.TestCase):
    def _select(self, *, rho, msc_rows, orb6_rows=()):
        primary = _resolved(gaia=None, component="Aa", is_primary=True)
        secondary = _resolved(gaia=None, component="Ab", is_primary=False)
        ast = _component_astrometry(parallax_mas=10.0)
        indices = _indices_with_astrometry()
        return bb.select_orbit(
            primary=primary, secondary=secondary,
            primary_astrometry=ast, secondary_astrometry=ast,
            orb6_for_pair=list(orb6_rows), indices=indices,
            wds_rho_arcsec=rho,
            msc_for_pair=list(msc_rows),
        )

    def test_attaches_on_sub_resolution_pair(self) -> None:
        orbit, via = self._select(rho=0.0, msc_rows=[_msc_orbit()])
        self.assertEqual(via, "msc")
        self.assertEqual(orbit.P_days, 6.0663)

    def test_measured_pair_never_takes_msc(self) -> None:
        orbit, via = self._select(rho=1.4, msc_rows=[_msc_orbit()])
        self.assertEqual((orbit, via), (None, "none"))

    def test_orb6_outranks_msc(self) -> None:
        for grade, expected_via in ((2, "orb6"), (9, "orb6_spectroscopic")):
            orb6 = _orphan_orb6(
                wds_id="10000+0000", components="Aa,Ab", grade=grade,
            )
            _orbit, via = self._select(
                rho=0.0, msc_rows=[_msc_orbit()], orb6_rows=[orb6],
            )
            self.assertEqual(via, expected_via)


class SynthesizeMscInnerPairsTests(unittest.TestCase):
    def _lookup(self, wds_id="10000+0000", tokens=("Aa", "Ab"), rows=None):
        lk = bb.MscLookup()
        lk.orbits_by_pair[(wds_id, tokens)] = (
            rows if rows is not None else [_msc_orbit()]
        )
        return lk

    def test_synthesizes_anchored_missing_subpair(self) -> None:
        wds = [_wds_pair(wds_id="10000+0000", components="AB")]
        out, stats = bb.synthesize_msc_inner_pairs(wds, self._lookup())
        self.assertEqual(len(out), 1)
        p = out[0]
        self.assertEqual((p.wds_id, p.components), ("10000+0000", "Aa,Ab"))
        self.assertEqual(p.discoverer, bb.SYNTH_MSC_DISCOVERER)
        self.assertEqual(p.rho_last, 0.0)
        self.assertEqual(p.precise_ra_deg, 100.0)  # coord donor

    def test_skips(self) -> None:
        wds = [_wds_pair(wds_id="10000+0000", components="AB")]
        cases = [
            (self._lookup(wds_id="99999+9999"), "skipped_unknown_system"),
            (self._lookup(tokens=("A", "BC")), "skipped_token_shape"),
            (
                self._lookup(rows=[_msc_orbit(t0=None)]),
                "skipped_incomplete_elements",
            ),
            (self._lookup(tokens=("A", "B")), "skipped_pair_exists"),
            (self._lookup(tokens=("Ca", "Cb")), "skipped_unanchored"),
        ]
        for lk, reason in cases:
            out, stats = bb.synthesize_msc_inner_pairs(wds, lk)
            self.assertEqual(out, [], reason)
            self.assertEqual(stats[reason], 1, reason)

    def test_skips_when_child_token_already_exists(self) -> None:
        wds = [
            _wds_pair(wds_id="10000+0000", components="AB"),
            _wds_pair(wds_id="10000+0000", components="Aa,B"),
        ]
        out, stats = bb.synthesize_msc_inner_pairs(wds, self._lookup())
        self.assertEqual(out, [])
        self.assertEqual(stats["skipped_children_exist"], 1)


class MscStage6Tests(unittest.TestCase):
    def _indices_with_msc(self, lk):
        return bb.build_indices([], [], {}, {}, {}, msc=lk)

    def test_resolve_spect_msc_between_simbad_and_athyg(self) -> None:
        from scripts.binaries import stage6_multiples as s6
        lk = bb.MscLookup()
        lk.spect_by_comp[("W", "Ab")] = "A6"
        lk.spect_by_comp[("W", "B")] = "K1V"
        indices = bb.build_indices(
            [], [], {}, {}, {},
            simbad_wds_spectra={("W", "B"): "G5V"},
            msc=lk,
        )
        athyg = _athyg_row(gaia=1)
        athyg.spect = "B3V"
        self.assertEqual(
            s6._resolve_spect("W", "Ab", athyg, indices), ("A6", "msc"),
        )
        self.assertEqual(
            s6._resolve_spect("W", "B", athyg, indices), ("G5V", "simbad"),
        )
        self.assertEqual(
            s6._resolve_spect("W", "C", athyg, indices), ("B3V", "athyg"),
        )

    def test_pair_mags_fill_from_msc_when_wds_has_none(self) -> None:
        pair = _wds_pair(components="Aa,Ab", mag_pri=None, mag_sec=None)
        lk = bb.MscLookup()
        lk.pair_mags[("WDS-1", ("Aa", "Ab"))] = (5.02, 7.42)
        components = [
            _resolved(gaia=1, component="Aa", is_primary=True),
            _resolved(gaia=1, component="Ab", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        msc_mag_fills: list[str] = []
        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[bb.OpticalClassification(True, "orbit_kept")],
            indices=self._indices_with_msc(lk),
            msc_mag_fills=msc_mag_fills,
        )
        self.assertEqual(len(rows), 2)
        for row in rows:
            self.assertEqual((row.mag_pri, row.mag_sec), (5.02, 7.42))
            self.assertAlmostEqual(row.dmag, 2.4)
        self.assertEqual(msc_mag_fills, ["WDS-1Aa,Ab"])

    def test_wds_mags_never_overwritten(self) -> None:
        pair = _wds_pair(components="Aa,Ab", mag_pri=4.0, mag_sec=6.0)
        lk = bb.MscLookup()
        lk.pair_mags[("WDS-1", ("Aa", "Ab"))] = (5.02, 7.42)
        components = [
            _resolved(gaia=1, component="Aa", is_primary=True),
            _resolved(gaia=1, component="Ab", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[bb.OpticalClassification(True, "orbit_kept")],
            indices=self._indices_with_msc(lk),
        )
        self.assertEqual((rows[0].mag_pri, rows[0].mag_sec), (4.0, 6.0))


if __name__ == "__main__":
    unittest.main()
