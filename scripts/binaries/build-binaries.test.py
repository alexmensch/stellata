#!/usr/bin/env python3
"""Unit tests for build-binaries.py Stage 1 parsers.

Pins each loader against tiny fixture inputs written to a temporary
directory. No network, no large catalog files — the suite runs in well
under a second.

Run:
    python3 scripts/binaries/build-binaries.test.py

(The `.test.py` filename matches the project's `.test.ts` convention but
trips Python's `-m unittest` module-path parser on the dot; invoking the
file directly executes `unittest.main()` in the `__main__` block below.)
"""

from __future__ import annotations

import importlib.util
import math
import sys
import tempfile
import unittest
from pathlib import Path

# build-binaries.py contains a hyphen and a `from __future__` style import
# that prevents a normal `import build_binaries`. Load it via spec_from_file
# so the test module can address its parsers directly.
_HERE = Path(__file__).resolve().parent
_SPEC = importlib.util.spec_from_file_location(
    "build_binaries", _HERE / "build-binaries.py",
)
assert _SPEC and _SPEC.loader
bb = importlib.util.module_from_spec(_SPEC)
sys.modules["build_binaries"] = bb
_SPEC.loader.exec_module(bb)

# build-binaries.py re-exports the parser entry points but not the
# private sanity-net helper or its floor constants. Import them
# directly for the helper-level tests below.
import parsers as _parsers_mod  # noqa: E402


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
        # Future dch.64.1 column additions (rv, photometry, …) must not
        # break this consumer. Verify reordered columns parse cleanly
        # by name, not by position.
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


class SplitComponentsTests(unittest.TestCase):
    def test_two_letter_pair(self) -> None:
        self.assertEqual(bb.split_components("AB"), ("A", "B"))

    def test_comma_separated_pair(self) -> None:
        self.assertEqual(bb.split_components("Aa,Ab"), ("Aa", "Ab"))
        self.assertEqual(bb.split_components("BC,D"), ("BC", "D"))

    def test_skips_system_level_row(self) -> None:
        self.assertIsNone(bb.split_components(""))
        self.assertIsNone(bb.split_components("   "))

    def test_skips_ambiguous_three_letter(self) -> None:
        # "ABC" could be A+BC or AB+C — refuse rather than guess.
        self.assertIsNone(bb.split_components("ABC"))

    def test_skips_single_letter(self) -> None:
        self.assertIsNone(bb.split_components("A"))


def _wds_pair(*, wds_id: str = "00000+0000", components: str = "AB") -> "bb.WdsPair":
    return bb.WdsPair(
        wds_id=wds_id, discoverer="TST   1", components=components,
        date_last=None, rho_last=None, theta_last=None,
        mag_pri=None, mag_sec=None, spectral="", notes="    ",
        precise_ra_deg=None, precise_dec_deg=None,
    )


def _athyg_row(*, hip: int | None = None, gaia: int | None = None) -> "bb.AthygRow":
    return bb.AthygRow(
        hip=hip, tyc=None, gaia=gaia, hd=None,
        ra_deg=0.0, dec_deg=0.0,
        x_pc=0.0, y_pc=0.0, z_pc=0.0,
        dist_pc=1.0, v_mag=None, absmag=5.0,
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
            athyg=[_athyg_row(hip=42, gaia=12345)],
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

    def test_priority_xwalk_beats_athyg(self) -> None:
        # Both tier 1 and the HIP branch of tier 2 would succeed for
        # the same HIP — tier 1 wins because the Gaia HIP xwalk is
        # canonical.
        pair = _wds_pair(components="AB")
        orb6 = [_orb6(wds_id=pair.wds_id, components="AB", hip=10)]
        idx = _indices(
            hip_to_gaia={10: 100},
            athyg=[_athyg_row(hip=10, gaia=999)],   # disagreeing AT-HYG
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
        g_mag=None, bp_mag=None, rp_mag=None,
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
) -> "bb.ResolvedComponent":
    return bb.ResolvedComponent(
        wds_id=wds_id, discoverer=discoverer,
        component=component, is_primary=is_primary,
        gaia_source_id=gaia, resolve_via=via,
        hip=hip,
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
        row = _gaia_astrometry_row(ruwe=1.0, ipd_frac_multi_peak=0.05)
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
            source_id=7, ruwe=1.0, ipd_frac_multi_peak=0.05,
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
                pmra_masyr=1.0, pmdec_masyr=1.0, ref_epoch=2016.0,
            ),
            bb.ComponentAstrometry(
                astrometry_via="unresolved",
                ra_deg=None, dec_deg=None, parallax_mas=None,
                pmra_masyr=None, pmdec_masyr=None, ref_epoch=None,
            ),
        ]
        counts = bb.astrometry_counts(items)
        self.assertEqual(set(counts.keys()), set(bb.ASTROMETRY_VIA_VALUES))
        self.assertEqual(counts["gaia_5p"], 1)
        self.assertEqual(counts["unresolved"], 1)
        self.assertEqual(counts["gaia_nss_systemic"], 0)
        self.assertEqual(counts["hip2_long_baseline"], 0)


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
    def test_orbital_type_recovers_full_geometry(self) -> None:
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
        self.assertAlmostEqual(o.a_AU or 0.0, 20.0 / plx)
        self.assertAlmostEqual(o.i_rad or 0.0, math.radians(60.0))
        self.assertAlmostEqual(o.Omega_rad or 0.0, math.radians(30.0))
        self.assertAlmostEqual(o.omega_rad or 0.0, math.radians(120.0))
        self.assertIsNone(o.q)
        self.assertAlmostEqual(o.distance_pc or 0.0, 100.0)

    def test_orbital_without_parallax_keeps_angles_drops_a_au(self) -> None:
        row = _nss_orbital_row(a_mas=20.0)
        o = bb.nss_to_canonical_elements(row, None)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertIsNone(o.a_AU)
        self.assertIsNone(o.distance_pc)
        self.assertIsNotNone(o.i_rad)
        self.assertIsNotNone(o.Omega_rad)
        self.assertIsNotNone(o.omega_rad)

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
        row = {
            "nss_solution_type": "EclipsingSpectro",
            "period": "2.0", "t_periastron": "1.0", "eccentricity": "0.0",
            "inclination": "88.0", "arg_periastron": "10.0",
            "mass_ratio": "0.6",
        }
        o = bb.nss_to_canonical_elements(row, 5.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.q or 0.0, 0.6)

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

    def test_sb2_carries_mass_ratio(self) -> None:
        row = {
            "nss_solution_type": "SB2",
            "period": "50.0", "t_periastron": "5.0", "eccentricity": "0.1",
            "arg_periastron": "30.0", "mass_ratio": "0.85",
        }
        o = bb.nss_to_canonical_elements(row, 8.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.q or 0.0, 0.85)

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

    def test_days_mas_jd(self) -> None:
        # Short-period close binary stored in days + mas + JD.
        entry = _orb6_visual(
            P_val=10.0, P_unit="d",
            a_val=500.0, a_unit="m",
            T0_val=2451545.0, T0_unit="d",
        )
        o = bb.orb6_to_canonical_elements(entry, plx_mas=100.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.P_days or 0.0, 10.0)
        self.assertAlmostEqual(o.a_AU or 0.0, 500.0 / 100.0)
        self.assertAlmostEqual(o.T_jd or 0.0, 2451545.0)

    def test_mjd_t0_offset(self) -> None:
        entry = _orb6_visual(T0_val=51544.5, T0_unit="m")
        o = bb.orb6_to_canonical_elements(entry, plx_mas=10.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.T_jd or 0.0, 51544.5 + bb.MJD_TO_JD_OFFSET)

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
            parallax_mas=5.0, pmra_masyr=0.0, pmdec_masyr=0.0,
            ref_epoch=2016.0,
        )
        s = bb.ComponentAstrometry(
            astrometry_via="gaia_5p", ra_deg=0.0, dec_deg=0.0,
            parallax_mas=4.5, pmra_masyr=0.0, pmdec_masyr=0.0,
            ref_epoch=2016.0,
        )
        self.assertEqual(bb._system_parallax_mas([p, s]), 5.0)

    def test_secondary_fallback_when_primary_missing(self) -> None:
        p = bb.ComponentAstrometry(
            astrometry_via="unresolved", ra_deg=None, dec_deg=None,
            parallax_mas=None, pmra_masyr=None, pmdec_masyr=None,
            ref_epoch=None,
        )
        s = bb.ComponentAstrometry(
            astrometry_via="gaia_5p", ra_deg=0.0, dec_deg=0.0,
            parallax_mas=3.2, pmra_masyr=0.0, pmdec_masyr=0.0,
            ref_epoch=2016.0,
        )
        self.assertEqual(bb._system_parallax_mas([p, s]), 3.2)

    def test_no_parallax_returns_none(self) -> None:
        a = bb.ComponentAstrometry(
            astrometry_via="unresolved", ra_deg=None, dec_deg=None,
            parallax_mas=None, pmra_masyr=None, pmdec_masyr=None,
            ref_epoch=None,
        )
        self.assertIsNone(bb._system_parallax_mas([a, a]))

    def test_non_positive_parallax_skipped(self) -> None:
        # Negative-parallax DR3 rows (within the noise of distant
        # sources) are skipped at the system level — they would map
        # to a negative distance otherwise.
        bad = bb.ComponentAstrometry(
            astrometry_via="gaia_5p", ra_deg=0.0, dec_deg=0.0,
            parallax_mas=-1.0, pmra_masyr=0.0, pmdec_masyr=0.0,
            ref_epoch=2016.0,
        )
        good = bb.ComponentAstrometry(
            astrometry_via="gaia_5p", ra_deg=0.0, dec_deg=0.0,
            parallax_mas=2.5, pmra_masyr=0.0, pmdec_masyr=0.0,
            ref_epoch=2016.0,
        )
        self.assertEqual(bb._system_parallax_mas([bad, good]), 2.5)


def _ast(parallax_mas: float | None = 10.0) -> "bb.ComponentAstrometry":
    return bb.ComponentAstrometry(
        astrometry_via="gaia_5p",
        ra_deg=0.0, dec_deg=0.0,
        parallax_mas=parallax_mas,
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
    def test_nss_wins_inside_regime(self) -> None:
        nss_row = _nss_orbital_row(period_days=200.0)
        idx = _indices_for_orbit(src_to_nss={42: nss_row})
        prim = _resolved(gaia=42, component="A", is_primary=True)
        sec = _resolved(gaia=None, component="B", is_primary=False)
        # ORB6 visual entry also exists, but NSS takes precedence.
        orb = [_orb6_visual(grade=1, ref="Hei2020")]
        orbit, via = bb.select_orbit(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(), secondary_astrometry=_ast(),
            orb6_for_pair=orb, indices=idx,
        )
        self.assertEqual(via, "gaia_nss")
        self.assertIsNotNone(orbit)

    def test_orb6_visual_when_nss_period_out_of_regime(self) -> None:
        # P = 10 yr, a not derivable below 1″ from TI (a_mas synthesised
        # at 5_000 mas = 5″ — outside both gates).
        nss_row = _nss_orbital_row(period_days=10 * 365.25, a_mas=5000.0)
        idx = _indices_for_orbit(src_to_nss={42: nss_row})
        prim = _resolved(gaia=42, component="A", is_primary=True)
        sec = _resolved(gaia=None, component="B", is_primary=False)
        orb = [_orb6_visual(grade=2, ref="Hei2020")]
        orbit, via = bb.select_orbit(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(), secondary_astrometry=_ast(),
            orb6_for_pair=orb, indices=idx,
        )
        self.assertEqual(via, "orb6")
        self.assertIsNotNone(orbit)

    def test_nss_long_period_but_sub_arcsec_still_wins(self) -> None:
        # 10 yr but a = 500 mas → < 1″ gate trips, NSS still wins.
        nss_row = _nss_orbital_row(period_days=10 * 365.25, a_mas=500.0)
        idx = _indices_for_orbit(src_to_nss={42: nss_row})
        prim = _resolved(gaia=42, component="A", is_primary=True)
        sec = _resolved(gaia=None, component="B", is_primary=False)
        orb = [_orb6_visual(grade=2, ref="Hei2020")]
        orbit, via = bb.select_orbit(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(), secondary_astrometry=_ast(),
            orb6_for_pair=orb, indices=idx,
        )
        self.assertEqual(via, "gaia_nss")
        self.assertIsNotNone(orbit)

    def test_secondary_nss_row_used_when_primary_has_none(self) -> None:
        nss_row = _nss_orbital_row(period_days=100.0)
        idx = _indices_for_orbit(src_to_nss={99: nss_row})
        prim = _resolved(gaia=42, component="A", is_primary=True)
        sec = _resolved(gaia=99, component="B", is_primary=False)
        orbit, via = bb.select_orbit(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(), secondary_astrometry=_ast(),
            orb6_for_pair=[], indices=idx,
        )
        self.assertEqual(via, "gaia_nss")
        self.assertIsNotNone(orbit)

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

    def test_grade_7_orb6_falls_through_both_gates(self) -> None:
        # Grade 7 isn't in the visual set OR the spectroscopic set —
        # rare/preliminary fits get no orbit_via (none) rather than a
        # default that misleads downstream.
        idx = _indices_for_orbit()
        prim = _resolved(gaia=42, component="A", is_primary=True)
        sec = _resolved(gaia=None, component="B", is_primary=False)
        orb = [_orb6_visual(grade=7, ref="Prelim2020")]
        _, via = bb.select_orbit(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(), secondary_astrometry=_ast(),
            orb6_for_pair=orb, indices=idx,
        )
        self.assertEqual(via, "none")


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


class SelectOrbitsAllTests(unittest.TestCase):
    def test_per_pair_emission_order_matches_pairs(self) -> None:
        nss_row = _nss_orbital_row(period_days=200.0)
        p1 = _wds_pair(wds_id="W1", components="AB")
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
) -> "bb.WdsPair":
    return bb.WdsPair(
        wds_id=wds_id, discoverer=discoverer, components=components,
        date_last=date_last, rho_last=rho_last, theta_last=theta_last,
        mag_pri=mag_pri, mag_sec=mag_sec, spectral=spectral,
        notes=notes,
        precise_ra_deg=precise_ra_deg, precise_dec_deg=precise_dec_deg,
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
    ) -> "bb.OpticalClassification":
        pair = _wds_pair(notes=notes, mag_pri=mag_pri, mag_sec=mag_sec)
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
        )

    def test_wds_notes_physical_keeps(self) -> None:
        # 'V' = visual physical pair (common proper motion confirmed).
        result = self._classify(notes="V   ")
        self.assertTrue(result.is_physical)
        self.assertEqual(result.optical_via, "wds_notes_kept")

    def test_wds_notes_optical_rejects(self) -> None:
        # 'U' = catalog-flagged uncertain (treated as optical).
        result = self._classify(notes="U   ")
        self.assertFalse(result.is_physical)
        self.assertEqual(result.optical_via, "wds_notes_rejected")

    def test_wds_notes_optical_wins_over_physical_when_both_present(self) -> None:
        # Conservative bias: any S/U/X/Y in the 4-char block rejects.
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

    def test_both_gaia_disagreeing_plx_rejects(self) -> None:
        # 10 mas vs 1 mas with σ=0.05 each: well past 3σ.
        p = _gaia_astrometry_row(
            source_id=1, parallax_mas=10.0, parallax_error_mas=0.05,
        )
        s = _gaia_astrometry_row(
            source_id=2, parallax_mas=1.0, parallax_error_mas=0.05,
        )
        result = self._classify(
            primary_gaia=1, secondary_gaia=2,
            src_to_astrometry={1: p, 2: s},
        )
        self.assertFalse(result.is_physical)
        self.assertEqual(result.optical_via, "gaia_rejected")

    def test_both_gaia_disagreeing_pm_rejects(self) -> None:
        # Parallax agrees, PM disagrees by >5 mas/yr on RA axis.
        p = _gaia_astrometry_row(
            source_id=1, parallax_mas=10.0, parallax_error_mas=0.05,
            pmra_masyr=20.0, pmdec_masyr=0.0,
        )
        s = _gaia_astrometry_row(
            source_id=2, parallax_mas=10.0, parallax_error_mas=0.05,
            pmra_masyr=0.0, pmdec_masyr=0.0,
        )
        result = self._classify(
            primary_gaia=1, secondary_gaia=2,
            src_to_astrometry={1: p, 2: s},
        )
        self.assertFalse(result.is_physical)
        self.assertEqual(result.optical_via, "gaia_rejected")

    def test_asymm_gaia_sirius_shaped_rejects(self) -> None:
        # Sirius A-C archetype: A at 378 mas (HIP2, ~2.64 pc), C at
        # ~0.5 mas (Gaia, ~2 kpc). σ_combined dominated by HIP2's
        # ~0.4 mas — the difference is ~1000σ.
        s = _gaia_astrometry_row(
            source_id=2, parallax_mas=0.5, parallax_error_mas=0.1,
        )
        hip2 = _hip2_row(hip=32349, plx_mas=378.0)
        # The HIP2 helper defaults to e_plx_mas=None — that's OK; the
        # gate falls back to using Gaia σ alone, and 1000× excess
        # still rejects.
        result = self._classify(
            primary_gaia=None, secondary_gaia=2,
            primary_hip=32349,
            src_to_astrometry={2: s},
            hip2=[hip2],
        )
        self.assertFalse(result.is_physical)
        self.assertEqual(result.optical_via, "asymm_rejected")

    def test_asymm_gaia_consistent_keeps(self) -> None:
        # Asymm: B has Gaia 10.0 mas, A has HIP2 anchor 10.01 mas —
        # within tolerance, physical.
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
        # Inverse asymmetry: A has Gaia, B has HIP2. Should match.
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

    def test_mag_heuristic_keeps_close_pair(self) -> None:
        # No Gaia, no HIP2, |Δmag|=2 — under 5-mag threshold.
        result = self._classify(mag_pri=4.0, mag_sec=6.0)
        self.assertTrue(result.is_physical)
        self.assertEqual(result.optical_via, "mag_heuristic_kept")

    def test_mag_heuristic_rejects_wide_gap(self) -> None:
        result = self._classify(mag_pri=2.0, mag_sec=10.0)
        self.assertFalse(result.is_physical)
        self.assertEqual(result.optical_via, "mag_heuristic_rejected")

    def test_mag_heuristic_keeps_when_no_data(self) -> None:
        # Truly empty: defaults to mag_heuristic_kept rather than
        # silently dropping the pair.
        result = self._classify()
        self.assertTrue(result.is_physical)
        self.assertEqual(result.optical_via, "mag_heuristic_kept")

    def test_orbit_on_file_overrides_mag_gap_sirius_ab(self) -> None:
        # Sirius A-B archetype: 9.9-mag gap (would normally reject as
        # mag_heuristic_rejected) but a grade-2 ORB6 visual orbit is
        # on file → orbit_kept wins.
        result = self._classify(
            mag_pri=-1.47, mag_sec=8.44, orbit_via="orb6",
        )
        self.assertTrue(result.is_physical)
        self.assertEqual(result.optical_via, "orbit_kept")

    def test_orbit_on_file_overrides_no_data_case(self) -> None:
        # NSS orbit available, no mags at all → orbit_kept (not the
        # default mag_heuristic_kept fallback).
        result = self._classify(orbit_via="gaia_nss")
        self.assertTrue(result.is_physical)
        self.assertEqual(result.optical_via, "orbit_kept")

    def test_orbit_on_file_does_not_override_gaia_disagreement(self) -> None:
        # An ORB6 orbit on file does NOT rescue a pair Gaia already
        # rejected — Gaia is empirical for the modern epoch and beats
        # potentially-stale ORB6 fits.
        p = _gaia_astrometry_row(
            source_id=1, parallax_mas=10.0, parallax_error_mas=0.05,
        )
        s = _gaia_astrometry_row(
            source_id=2, parallax_mas=1.0, parallax_error_mas=0.05,
        )
        result = self._classify(
            primary_gaia=1, secondary_gaia=2,
            src_to_astrometry={1: p, 2: s},
            orbit_via="orb6",
        )
        self.assertFalse(result.is_physical)
        self.assertEqual(result.optical_via, "gaia_rejected")


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
    pmra_masyr: float | None = 1.0,
    pmdec_masyr: float | None = -1.0,
    ref_epoch: float | None = 2016.0,
) -> "bb.ComponentAstrometry":
    return bb.ComponentAstrometry(
        astrometry_via=astrometry_via,
        ra_deg=ra_deg, dec_deg=dec_deg,
        parallax_mas=parallax_mas,
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
        # anchor → dch.66 inheritance can't recover, and the pair drops.
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

        rows = bb.build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertEqual(rows, [])

    def test_inherits_system_anchor_when_pair_lacks_position(self) -> None:
        # 40 Eri BC shape — the AB pair anchors the system with A's
        # Gaia 5p; the BC pair's components both have unresolved
        # astrometry (tight inner binary blended out of DR3). dch.66
        # inheritance lets BC emit with A's position and the new
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
        self.assertEqual(bc_b.astrometry_via, "system_inherited")
        self.assertAlmostEqual(bc_b.dist_pc or 0.0, 100.0, places=6)
        # AB-B's astrometry was unresolved but it still inherits the
        # anchor; the via flips to system_inherited.
        ab_b = next(r for r in rows if r.system_id == "04153-0739-AB" and r.comp == "B")
        self.assertEqual(ab_b.astrometry_via, "system_inherited")
        # AB-A keeps its native gaia_5p tag.
        ab_a = next(r for r in rows if r.system_id == "04153-0739-AB" and r.comp == "A")
        self.assertEqual(ab_a.astrometry_via, "gaia_5p")

    def test_standalone_sweep_emits_simbad_components_outside_pair_walk(self) -> None:
        # A SIMBAD-known (wds_id, component) that doesn't appear as any
        # decomposing-pair side gets a standalone row via the dch.66
        # sweep. Position inherits the system anchor; orbit_role is the
        # new ``standalone`` value.
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
        self.assertEqual(c_row.astrometry_via, "system_inherited")
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
            orbit_role="primary",
            P_days=365.25, T_jd=2451545.0, e=0.1, a_AU=1.0,
            i_rad=0.5, omega_rad=0.6, Omega_rad=0.7,
            q=0.5, dist_pc=10.0,
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

    def test_empty_optional_fields_emit_empty_cells(self) -> None:
        row = bb.MultiplesRow(
            system_id="WDS-2-AB", comp="A",
            hip=None, gaia_source_id=None,
            x_pc=None, y_pc=None, z_pc=None,
            absmag=None, ci=None, spect="", name="",
            source="wds", regime=0,
            resolve_via="unresolved", astrometry_via="unresolved", orbit_via="none",
            spect_via="none",
            orbit_role="primary",
            P_days=None, T_jd=None, e=None, a_AU=None,
            i_rad=None, omega_rad=None, Omega_rad=None,
            q=None, dist_pc=None,
        )
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "multiples.tsv"
            bb.write_multiples_tsv([row], p)
            lines = p.read_text().splitlines()
        cells = lines[1].split("\t")
        header = lines[0].split("\t")
        for col in ("hip", "gaia_source_id", "x_pc", "y_pc", "z_pc",
                    "absmag", "ci", "P_days", "T_jd", "e", "a_AU",
                    "i_rad", "omega_rad", "Omega_rad", "q", "dist_pc"):
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


if __name__ == "__main__":
    unittest.main()
