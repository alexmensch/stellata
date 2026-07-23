#!/usr/bin/env python3
"""Stdlib-unittest pins for scripts/binaries/parsers.py."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.binaries.indices import (  # noqa: E402
    build_indices,
)
from scripts.binaries.parsers import (  # noqa: E402
    WdsPair,
    _assert_field_coverage,
    dedup_wds_pair_rows,
    parse_astrometry_exclusions,
    parse_athyg,
    parse_ccdm,
    parse_component_sptype_overrides,
    parse_gaia_astrometry,
    parse_gaia_hip_xmatch,
    parse_gaia_nss,
    parse_gaia_tyc_xmatch,
    parse_gcvs,
    parse_gcvs_crossid,
    parse_hip2,
    parse_msc_orbits,
    parse_msc_systems,
    parse_orb6,
    parse_simbad_wds_spectra,
    parse_simbad_wds_xids,
    parse_wds_sep_pa,
    parse_wds_summ,
)
from scripts.binaries.stage6_multiples import (  # noqa: E402
    _resolve_spect,
)
from scripts.binaries.pipeline_test_fixtures import (  # noqa: E402
    _orb6_line,
    _wds_line,
    _write,
    SRC_ASTROMETRY_EXCLUSIONS,
    SRC_COMPONENT_SPTYPE_OVERRIDES,
    SRC_MSC_ORBITS,
    SRC_MSC_SYSTEMS,
)


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
            rows = parse_athyg(p)
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
            rows = parse_athyg(p)
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0].hip)
        self.assertIsNone(rows[0].gaia)
        # build_indices must not install rows under a sentinel-0 key.
        idx = build_indices(
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
            rows = parse_athyg(p)
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0].tyc)
        idx = build_indices(
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
                parse_athyg(p)


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
            pairs = parse_wds_summ(p)
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
    def _pair(n_obs: int | None, rho: float | None = 1.0) -> "WdsPair":
        return WdsPair(
            wds_id="17247-3412", discoverer="WSI  62", components="CD",
            date_last=2016, rho_last=rho, theta_last=205.0,
            mag_pri=10.0, mag_sec=10.5, spectral="", notes="    ",
            precise_ra_deg=None, precise_dec_deg=None, n_obs=n_obs,
        )

    def test_keeps_most_observed_duplicate(self) -> None:
        low = self._pair(n_obs=3, rho=1.5)
        high = self._pair(n_obs=7, rho=3.5)
        deduped, dropped = dedup_wds_pair_rows([low, high])
        self.assertEqual(dropped, 1)
        self.assertEqual(deduped, [high])

    def test_tie_keeps_first_in_file_order(self) -> None:
        first = self._pair(n_obs=3, rho=3.5)
        second = self._pair(n_obs=3, rho=1.5)
        deduped, dropped = dedup_wds_pair_rows([first, second])
        self.assertEqual(dropped, 1)
        self.assertEqual(deduped, [first])

    def test_distinct_keys_pass_through_in_order(self) -> None:
        cd = self._pair(n_obs=3)
        ab = WdsPair(
            wds_id="17247-3412", discoverer="WSI  62", components="AB",
            date_last=2016, rho_last=1.0, theta_last=100.0,
            mag_pri=9.0, mag_sec=9.5, spectral="", notes="    ",
            precise_ra_deg=None, precise_dec_deg=None, n_obs=2,
        )
        deduped, dropped = dedup_wds_pair_rows([cd, ab])
        self.assertEqual(dropped, 0)
        self.assertEqual(deduped, [cd, ab])


class WdsSepPaSentinelTests(unittest.TestCase):
    def test_negative_parses_to_none(self) -> None:
        self.assertIsNone(parse_wds_sep_pa("-1.0"))
        self.assertIsNone(parse_wds_sep_pa("  -1"))
        self.assertIsNone(parse_wds_sep_pa(""))
        self.assertEqual(parse_wds_sep_pa("  0.8"), 0.8)
        self.assertEqual(parse_wds_sep_pa("246"), 246.0)

    def test_overflow_sentinel_parses_to_none(self) -> None:
        self.assertIsNone(parse_wds_sep_pa("999.9"))
        self.assertEqual(parse_wds_sep_pa("999.8"), 999.8)
        self.assertEqual(parse_wds_sep_pa("999.0"), 999.0)

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
            pairs = parse_wds_summ(p)
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
            pairs = parse_wds_summ(p)
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
            rows = parse_orb6(p)
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
            rows = parse_orb6(p)
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
            rows = parse_orb6(p)
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
            rows = parse_orb6(p)
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
            rows = parse_orb6(p)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].omega_deg, 252.3)


class WdsSummSanityNetTests(unittest.TestCase):
    def test_passes_when_precise_coord_present(self) -> None:
        # 20 rows, all with precise coords → no SystemExit.
        body = "banner\n" + "\n".join(
            [_wds_line(with_precise=True) for _ in range(20)]
        ) + "\n"
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "wds.txt", body)
            pairs = parse_wds_summ(p)
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
                parse_wds_summ(p)
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
            rows = parse_orb6(p)
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
                parse_orb6(p)
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
        _assert_field_coverage(
            [], "parse_test", "field", 0.99,
        )

    def test_passes_at_exact_floor(self) -> None:
        # Floor is inclusive only above — rate >= floor passes.
        from dataclasses import dataclass

        @dataclass
        class Row:
            x: int | None

        rows = [Row(1), Row(1), Row(1), Row(1), Row(None)]  # 80%
        _assert_field_coverage(
            rows, "parse_test", "x", 0.80,
        )

    def test_raises_below_floor_with_diagnostic(self) -> None:
        from dataclasses import dataclass

        @dataclass
        class Row:
            x: int | None

        rows = [Row(1), Row(None), Row(None), Row(None), Row(None)]  # 20%
        with self.assertRaises(SystemExit) as cm:
            _assert_field_coverage(
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
            rows = parse_gcvs(gp)
            xid = parse_gcvs_crossid(xp)
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
            rows = parse_ccdm(p)
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
            rows = parse_ccdm(p)
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
            rows = parse_hip2(p)
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
            m = parse_gaia_hip_xmatch(p)
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
            m = parse_gaia_hip_xmatch(p)
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
            m = parse_gaia_hip_xmatch(p)
        self.assertEqual(m, {21: 4444444444444444444})

    def test_tyc_xmatch(self) -> None:
        body = (
            "tyc\tgaia_source_id\tangular_distance\tnumber_of_neighbours\txm_flag\n"
            "1000-1006-1\t4493609606459508864\t0.065120\t1\t8\n"
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "tyc.tsv", body)
            m = parse_gaia_tyc_xmatch(p)
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
            m = parse_gaia_tyc_xmatch(p)
        self.assertEqual(m["9-1-1"], 6666666666666666666)

    def test_nss_returns_raw_row(self) -> None:
        body = (
            "source_id\tnss_solution_type\tperiod\tperiod_error\n"
            "33711199137024\tOrbital\t773.09\t27.35\n"
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "nss.tsv", body)
            m = parse_gaia_nss(p)
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
            out = parse_simbad_wds_xids(p)
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
            out = parse_simbad_wds_xids(p)
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
            out = parse_simbad_wds_xids(p)
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
            out = parse_simbad_wds_spectra(sp, xd)
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
            out = parse_simbad_wds_spectra(sp, xd)
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
            out = parse_simbad_wds_spectra(sp, xd)
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
            out = parse_simbad_wds_spectra(sp, xd)
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
            out = parse_component_sptype_overrides(p)
        self.assertEqual(out, {
            ("03082+4057", "2"): "K0IV",
            ("08447-5443", "Ab"): "A4V",
        })

    def test_shipped_overrides_file_parses_and_covers_algol(self) -> None:
        out = parse_component_sptype_overrides(
            SRC_COMPONENT_SPTYPE_OVERRIDES,
        )
        self.assertEqual(out[("03082+4057", "2")], "K0IV")

    def test_resolve_spect_curated_tier_wins(self) -> None:
        from scripts.binaries import stage6_multiples as s6
        indices = build_indices(
            [], [], {}, {}, {},
            simbad_wds_spectra={("W", "B"): "G5V"},
            component_sptype_overrides={("W", "B"): "K0IV"},
        )
        spect, via = _resolve_spect("W", "B", None, indices)
        self.assertEqual((spect, via), ("K0IV", "curated"))
        spect, via = _resolve_spect("W", "A", None, indices)
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
            out = parse_astrometry_exclusions(p)
        self.assertEqual(set(out.keys()), {2947050466531873024})
        self.assertIn("Sirius B", out[2947050466531873024])

    def test_shipped_file_parses_and_covers_sirius_b(self) -> None:
        out = parse_astrometry_exclusions(SRC_ASTROMETRY_EXCLUSIONS)
        self.assertIn(2947050466531873024, out)


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
            m = parse_gaia_astrometry(p)
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
            m = parse_gaia_astrometry(p)
        self.assertEqual(set(m.keys()), {1})


class ParseOrb6PreciseCoordTests(unittest.TestCase):
    def test_coordinate_prefix_parsed(self) -> None:
        line = "073435.86+315317.8 07346+3153 STF1110AB       6175  60178  36850   1.93   2.97    459.1     y   2.3        6.722  a  0.021   115.107    0.060   41.304     0.085   1959.59    y   0.021    0.3382   0.0023   251.84     0.38   2000 2021 3 n CIA2022d wds07346+3153r.png"
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "orb6.txt", "banner\n" + line + "\n")
            rows = parse_orb6(p)
        e = rows[0]
        self.assertIsNotNone(e.precise_ra_deg)
        assert e.precise_ra_deg is not None and e.precise_dec_deg is not None
        self.assertAlmostEqual(e.precise_ra_deg, 113.649417, places=5)
        self.assertAlmostEqual(e.precise_dec_deg, 31.888278, places=5)


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
            rows = parse_msc_systems(p)
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
            rows = parse_msc_orbits(p)
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual((r.syst, r.per, r.per_unit), ("Aa,Ab", 6.0663, "d"))
        self.assertIsNone(r.a_arcsec)
        self.assertEqual(r.longp_deg, 31.4)

    def test_shipped_msc_files_parse_and_cover_showcases(self) -> None:
        systems = parse_msc_systems(SRC_MSC_SYSTEMS)
        orbits = parse_msc_orbits(SRC_MSC_ORBITS)
        self.assertGreater(len(systems), 13_000)
        self.assertGreater(len(orbits), 4_000)
        ar_cas = [
            o for o in orbits
            if o.wds_id == "23300+5833" and o.syst == "Aa,Ab"
        ]
        self.assertEqual(len(ar_cas), 1)
        self.assertEqual(ar_cas[0].per, 6.0663)


if __name__ == "__main__":
    unittest.main()
