#!/usr/bin/env python3
"""Stdlib-unittest pins for scripts/binaries/stage4_orbits.py."""

from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.binaries.parsers import (  # noqa: E402
    Orb6Entry,
)
from scripts.binaries.stage3_astrometry import (  # noqa: E402
    ComponentAstrometry,
)
from scripts.binaries.stage4_orbits import (  # noqa: E402
    GAIA_DR3_REF_EPOCH_JD,
    J2000_REF_EPOCH_JD,
    MJD_TO_JD_OFFSET,
    ORBIT_VIA_VALUES,
    OrbitElements,
    TRUNCATED_JD_TO_JD_OFFSET,
    _msc_period_days,
    _nss_separation_consistent,
    _pick_best_msc,
    _pick_best_orb6,
    _system_parallax_mas,
    _thiele_innes_to_campbell,
    compute_system_parallax_anchors,
    compute_system_parallaxes,
    iter_decomposing_pairs,
    kepler_semimajor_axis_au,
    msc_T0_jd,
    msc_renderable,
    msc_to_canonical_elements,
    nss_to_canonical_elements,
    orb6_to_canonical_elements,
    orbit_counts,
    select_orbit,
    select_orbits_all,
)
from scripts.binaries.pipeline_test_fixtures import (  # noqa: E402
    _ast,
    _component_astrometry,
    _indices_for_orbit,
    _indices_with_astrometry,
    _msc_orbit,
    _nss_orbital_row,
    _orb6_visual,
    _orphan_orb6,
    _resolved,
    _ti_from_campbell,
    _wds_pair,
)


class ThieleInnesAlgebraTests(unittest.TestCase):
    def test_roundtrip_recovers_campbell(self) -> None:
        # Pick a non-trivial orbit well away from any boundary case
        # (i!=0, Ω in upper half, ω in lower half).
        a_in, i_in = 12.5, math.radians(57.3)
        Omega_in, omega_in = math.radians(110.0), math.radians(45.0)
        A, B, F, G = _ti_from_campbell(a_in, i_in, Omega_in, omega_in)
        got = _thiele_innes_to_campbell(A, B, F, G)
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
        got = _thiele_innes_to_campbell(A, B, F, G)
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
        self.assertIsNone(_thiele_innes_to_campbell(0.0, 0.0, 0.0, 0.0))


class NssToCanonicalElementsTests(unittest.TestCase):
    def test_orbital_type_recovers_angles_withholds_a0(self) -> None:
        plx = 10.0
        row = _nss_orbital_row(
            a_mas=20.0, i_deg=60.0,
            Omega_deg=30.0, omega_deg=120.0,
            period_days=730.5, t_periastron_rel_days=200.0,
            eccentricity=0.3,
        )
        o = nss_to_canonical_elements(row, plx)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.P_days or 0.0, 730.5)
        self.assertAlmostEqual(
            o.T_jd or 0.0, 200.0 + GAIA_DR3_REF_EPOCH_JD,
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
        o = nss_to_canonical_elements(row, None)
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
        camp = _thiele_innes_to_campbell(A, B, F, G)
        assert camp is not None
        self.assertAlmostEqual(camp[0], a0_mas, places=9)
        self.assertNotAlmostEqual(camp[0], a_rel_AU * plx, places=1)
        o = nss_to_canonical_elements(row, plx)
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
        o = nss_to_canonical_elements(row, 5.0)
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
        o = nss_to_canonical_elements(row, 5.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.q or 0.0, 0.6 / 1.6)

    def test_sb1_only_carries_omega(self) -> None:
        row = {
            "nss_solution_type": "SB1",
            "period": "100.0", "t_periastron": "10.0", "eccentricity": "0.2",
            "arg_periastron": "75.0",
        }
        o = nss_to_canonical_elements(row, 8.0)
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
        o = nss_to_canonical_elements(row, 8.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.q or 0.0, 2.0 / 3.0)

    def test_sb1c_compact_has_no_geometry_beyond_pte(self) -> None:
        # "Compact" SB1C variant — only P/T/e stored. No omega.
        row = {
            "nss_solution_type": "SB1C",
            "period": "12.0", "t_periastron": "3.0", "eccentricity": "0.05",
        }
        o = nss_to_canonical_elements(row, 5.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.P_days or 0.0, 12.0)
        self.assertIsNone(o.omega_rad)
        self.assertIsNone(o.i_rad)
        self.assertIsNone(o.Omega_rad)
        self.assertIsNone(o.a_AU)

    def test_unsupported_solution_type_returns_none(self) -> None:
        row = {"nss_solution_type": "FutureNewType", "period": "1.0"}
        self.assertIsNone(nss_to_canonical_elements(row, 5.0))


class Orb6ToCanonicalElementsTests(unittest.TestCase):
    def test_years_arcsec_julian_year(self) -> None:
        # α Cen-shaped row: P=79.762 y, a=17.493 arcsec.
        entry = _orb6_visual(
            P_val=79.762, P_unit="y",
            a_val=17.493, a_unit="a",
            i_deg=79.0, Omega_deg=204.0, omega_deg=232.0,
            e=0.5179, T0_val=1875.66, T0_unit="y",
        )
        o = orb6_to_canonical_elements(entry, plx_mas=755.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.P_days or 0.0, 79.762 * 365.25)
        # a_AU = 17.493 arcsec / 0.755" = 23.17 AU (α Cen sanity-check).
        self.assertAlmostEqual(o.a_AU or 0.0, 17.493 * 1000.0 / 755.0)
        self.assertAlmostEqual(o.i_rad or 0.0, math.radians(79.0))
        self.assertAlmostEqual(o.T_jd or 0.0,
                               J2000_REF_EPOCH_JD + (1875.66 - 2000.0) * 365.25)
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
        o = orb6_to_canonical_elements(entry, plx_mas=100.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.P_days or 0.0, 10.0)
        self.assertAlmostEqual(o.a_AU or 0.0, 500.0 / 100.0)
        self.assertAlmostEqual(o.T_jd or 0.0, 51545.0 + TRUNCATED_JD_TO_JD_OFFSET)

    def test_mjd_t0_offset(self) -> None:
        entry = _orb6_visual(T0_val=51544.5, T0_unit="m")
        o = orb6_to_canonical_elements(entry, plx_mas=10.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.T_jd or 0.0, 51544.5 + MJD_TO_JD_OFFSET)

    def test_year_flag_mislabelled_truncated_jd_is_recovered(self) -> None:
        # ORB6 mislabels ~50 truncated-JD epochs with the 'y' flag (WDS
        # 04227+1503 Aa,Ab: 59501.496 for a 4-day pair). The year formula
        # would throw this past JD 2e7; the guard reinterprets it as a
        # truncated JD.
        entry = _orb6_visual(P_val=4.0, P_unit="d", T0_val=59501.496, T0_unit="y")
        o = orb6_to_canonical_elements(entry, plx_mas=10.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.T_jd or 0.0, 59501.496 + TRUNCATED_JD_TO_JD_OFFSET)

    def test_year_flag_genuine_year_unchanged(self) -> None:
        # A real Besselian-year epoch stays on the year formula.
        entry = _orb6_visual(T0_val=1990.0, T0_unit="y")
        o = orb6_to_canonical_elements(entry, plx_mas=10.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(
            o.T_jd or 0.0, J2000_REF_EPOCH_JD + (1990.0 - 2000.0) * 365.25)

    def test_unrecognised_t0_flag_returns_none(self) -> None:
        # Stray '1'/'5'/'7'/'c'/blank flags from fixed-column
        # misalignment carry no usable epoch → T_jd None (renderer falls
        # back to WDS-epoch placement); the rest of the orbit survives.
        entry = _orb6_visual(T0_val=111111111111.0, T0_unit="1")
        o = orb6_to_canonical_elements(entry, plx_mas=10.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertIsNone(o.T_jd)
        self.assertIsNotNone(o.P_days)

    def test_year_flag_out_of_range_both_readings_returns_none(self) -> None:
        # A 'y' value implausible as both a year and a truncated JD drops
        # to None rather than a synthesised epoch.
        entry = _orb6_visual(T0_val=300000.0, T0_unit="y")
        o = orb6_to_canonical_elements(entry, plx_mas=10.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertIsNone(o.T_jd)

    def test_centuries_period(self) -> None:
        entry = _orb6_visual(P_val=15.0, P_unit="c")
        o = orb6_to_canonical_elements(entry, plx_mas=10.0)
        self.assertIsNotNone(o)
        assert o is not None
        self.assertAlmostEqual(o.P_days or 0.0, 15.0 * 100.0 * 365.25)

    def test_unknown_period_unit_returns_none(self) -> None:
        # ORB6 has a handful of stray '0'/'9'/'3'/'1' codes from
        # fixed-column misalignment — skip rather than guess.
        entry = _orb6_visual(P_unit="0")
        self.assertIsNone(orb6_to_canonical_elements(entry, plx_mas=10.0))

    def test_zero_period_returns_none(self) -> None:
        # A P_val of 0.0 must never mint elements: FLAG_HAS_ORBIT with
        # P=0 makes the runtime's M = 2π(t−T)/P NaN every frame.
        entry = _orb6_visual(P_val=0.0, P_unit="d")
        self.assertIsNone(orb6_to_canonical_elements(entry, plx_mas=10.0))

    def test_missing_parallax_drops_a_au_but_keeps_angles(self) -> None:
        entry = _orb6_visual()
        o = orb6_to_canonical_elements(entry, plx_mas=None)
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
        self.assertIs(_pick_best_orb6([a, b, c]), b)

    def test_grade_tie_breaks_to_most_recent_ref(self) -> None:
        a = _orb6_visual(grade=2, ref="Ake2021")
        b = _orb6_visual(grade=2, ref="Hei1995")
        c = _orb6_visual(grade=2, ref="Kpt2025")
        self.assertIs(_pick_best_orb6([a, b, c]), c)

    def test_ref_without_year_sorts_to_bottom_on_tie(self) -> None:
        a = _orb6_visual(grade=2, ref="Hei1995")
        b = _orb6_visual(grade=2, ref="OldRef")     # no parseable year
        self.assertIs(_pick_best_orb6([a, b]), a)


class SystemParallaxMasTests(unittest.TestCase):
    def test_primary_preferred(self) -> None:
        p = ComponentAstrometry(
            astrometry_via="gaia_5p", ra_deg=0.0, dec_deg=0.0,
            parallax_mas=5.0, parallax_error_mas=0.05, pmra_masyr=0.0, pmdec_masyr=0.0,
            ref_epoch=2016.0,
        )
        s = ComponentAstrometry(
            astrometry_via="gaia_5p", ra_deg=0.0, dec_deg=0.0,
            parallax_mas=4.5, parallax_error_mas=0.05, pmra_masyr=0.0, pmdec_masyr=0.0,
            ref_epoch=2016.0,
        )
        self.assertEqual(_system_parallax_mas([p, s]), 5.0)

    def test_secondary_fallback_when_primary_missing(self) -> None:
        p = ComponentAstrometry(
            astrometry_via="unresolved", ra_deg=None, dec_deg=None,
            parallax_mas=None, parallax_error_mas=None, pmra_masyr=None, pmdec_masyr=None,
            ref_epoch=None,
        )
        s = ComponentAstrometry(
            astrometry_via="gaia_5p", ra_deg=0.0, dec_deg=0.0,
            parallax_mas=3.2, parallax_error_mas=0.05, pmra_masyr=0.0, pmdec_masyr=0.0,
            ref_epoch=2016.0,
        )
        self.assertEqual(_system_parallax_mas([p, s]), 3.2)

    def test_no_parallax_returns_none(self) -> None:
        a = ComponentAstrometry(
            astrometry_via="unresolved", ra_deg=None, dec_deg=None,
            parallax_mas=None, parallax_error_mas=None, pmra_masyr=None, pmdec_masyr=None,
            ref_epoch=None,
        )
        self.assertIsNone(_system_parallax_mas([a, a]))

    def test_non_positive_parallax_skipped(self) -> None:
        # Negative-parallax DR3 rows (within the noise of distant
        # sources) are skipped at the system level — they would map
        # to a negative distance otherwise.
        bad = ComponentAstrometry(
            astrometry_via="gaia_5p", ra_deg=0.0, dec_deg=0.0,
            parallax_mas=-1.0, parallax_error_mas=0.05, pmra_masyr=0.0, pmdec_masyr=0.0,
            ref_epoch=2016.0,
        )
        good = ComponentAstrometry(
            astrometry_via="gaia_5p", ra_deg=0.0, dec_deg=0.0,
            parallax_mas=2.5, parallax_error_mas=0.05, pmra_masyr=0.0, pmdec_masyr=0.0,
            ref_epoch=2016.0,
        )
        self.assertEqual(_system_parallax_mas([bad, good]), 2.5)


class SelectOrbitTests(unittest.TestCase):
    def test_orb6_visual_beats_nss_inside_regime(self) -> None:
        nss_row = _nss_orbital_row(period_days=200.0)
        idx = _indices_for_orbit(src_to_nss={42: nss_row})
        prim = _resolved(gaia=42, component="A", is_primary=True)
        sec = _resolved(gaia=None, component="B", is_primary=False)
        orb = [_orb6_visual(grade=1, ref="Hei2020")]
        orbit, via = select_orbit(
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
        orbit, via = select_orbit(
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
        orbit, via = select_orbit(
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
        orbit, via = select_orbit(
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
        orbit, via = select_orbit(
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
        orbit, via = select_orbit(
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
        _, via = select_orbit(
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
        orbit, via = select_orbit(
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
        _, via = select_orbit(
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
        _, via = select_orbit(
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
        _, via_no_anchor = select_orbit(**kwargs)
        self.assertEqual(via_no_anchor, "gaia_nss")
        _, via_with_anchor = select_orbit(**kwargs, system_parallax_mas=18.5)
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
        orbit, via = select_orbit(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(), secondary_astrometry=_ast(),
            orb6_for_pair=orb, indices=idx,
        )
        self.assertEqual(via, "orb6")
        self.assertIsNotNone(orbit)
        assert orbit is not None
        self.assertAlmostEqual(
            orbit.T_jd or 0.0,
            J2000_REF_EPOCH_JD + (1985.0 - 2000.0) * 365.25,
        )

    def test_orb6_spectroscopic_grade_9_when_no_visual(self) -> None:
        idx = _indices_for_orbit()
        prim = _resolved(gaia=42, component="A", is_primary=True)
        sec = _resolved(gaia=None, component="B", is_primary=False)
        orb = [_orb6_visual(grade=9, ref="Spc2020")]
        orbit, via = select_orbit(
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
        _, via = select_orbit(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(), secondary_astrometry=_ast(),
            orb6_for_pair=orb, indices=idx,
        )
        self.assertEqual(via, "orb6")

    def test_visual_only_pair_with_no_orbits_routes_to_none(self) -> None:
        idx = _indices_for_orbit()
        prim = _resolved(gaia=42, component="A", is_primary=True)
        sec = _resolved(gaia=None, component="B", is_primary=False)
        orbit, via = select_orbit(
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
        _, via = select_orbit(
            primary=prim, secondary=sec,
            primary_astrometry=_ast(), secondary_astrometry=_ast(),
            orb6_for_pair=orb, indices=idx,
        )
        self.assertEqual(via, "orb6_spectroscopic")


class NssSeparationConsistentTests(unittest.TestCase):
    def test_wide_separation_for_short_period_is_inconsistent(self) -> None:
        row = _nss_orbital_row(period_days=0.9702)
        self.assertFalse(
            _nss_separation_consistent(row, wds_rho_arcsec=5.5, plx_mas=18.5)
        )

    def test_missing_or_zero_rho_is_consistent(self) -> None:
        row = _nss_orbital_row(period_days=0.9702)
        self.assertTrue(
            _nss_separation_consistent(row, wds_rho_arcsec=None, plx_mas=18.5)
        )
        self.assertTrue(
            _nss_separation_consistent(row, wds_rho_arcsec=0.0, plx_mas=18.5)
        )

    def test_missing_parallax_is_consistent(self) -> None:
        row = _nss_orbital_row(period_days=0.9702)
        self.assertTrue(
            _nss_separation_consistent(row, wds_rho_arcsec=5.5, plx_mas=None)
        )

    def test_missing_period_is_consistent(self) -> None:
        row = _nss_orbital_row(period_days=0.9702)
        row["period"] = ""
        self.assertTrue(
            _nss_separation_consistent(row, wds_rho_arcsec=5.5, plx_mas=18.5)
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
        yielded = list(iter_decomposing_pairs([p1, p2, p3], comps, ast))
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
            list(iter_decomposing_pairs([p], comps, ast))

    def test_length_mismatch_raises(self) -> None:
        p = _wds_pair(wds_id="W1", components="AB")
        with self.assertRaises(ValueError):
            list(iter_decomposing_pairs(
                [p],
                [_resolved(gaia=1)],
                [_ast(), _ast()],
            ))


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
        orb6[0] = Orb6Entry(  # rebind to W2's id+components
            wds_id="W2", discoverer="TST   1", components="AB",
            hd=None, hip=None,
            P_val=50.0, P_unit="y", a_val=1.0, a_unit="a",
            i_deg=90.0, Omega_deg=45.0, omega_deg=30.0, e=0.5,
            T0_val=1990.0, T0_unit="y",
            grade=2, ref="Ref2020",
        )
        out = select_orbits_all(
            pairs=[p1, p2], components=comps, astrometry=ast,
            orb6=orb6, indices=idx,
        )
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0][1], "gaia_nss")
        self.assertEqual(out[1][1], "orb6")


class OrbitCountsTests(unittest.TestCase):
    def test_every_canonical_key_present(self) -> None:
        rows: list[tuple[OrbitElements | None, str]] = [
            (None, "gaia_nss"),
            (None, "orb6"),
            (None, "none"),
        ]
        counts = orbit_counts(rows)
        self.assertEqual(set(counts.keys()), set(ORBIT_VIA_VALUES))
        self.assertEqual(counts["gaia_nss"], 1)
        self.assertEqual(counts["orb6"], 1)
        self.assertEqual(counts["orb6_spectroscopic"], 0)
        self.assertEqual(counts["none"], 1)


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
        plx = compute_system_parallaxes([pair], components, astrometry)
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
        plx = compute_system_parallaxes([pair], components, astrometry)
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
        plx = compute_system_parallaxes(pairs, components, astrometry)
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
        plx = compute_system_parallaxes([pair], components, astrometry)
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
        anchors = compute_system_parallax_anchors(
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
        anchors = compute_system_parallax_anchors(
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
        anchors = compute_system_parallax_anchors(
            [pair], components, astrometry,
        )
        self.assertNotIn("PA-3", anchors)


class KeplerSemimajorAxisTests(unittest.TestCase):
    def test_earth_pin(self) -> None:
        # P = 1 Julian year around 1 M_sun → exactly 1 AU.
        self.assertAlmostEqual(
            kepler_semimajor_axis_au(365.25, 1.0) or 0.0, 1.0, places=12,
        )

    def test_yy_gem_scale(self) -> None:
        # P = 0.814282 d, M_total = 1.0 M_sun (two M0.5Ve tables at
        # 0.5 each) → 0.017066 AU; published YY Gem a ≈ 0.018 AU.
        self.assertAlmostEqual(
            kepler_semimajor_axis_au(0.814282, 1.0) or 0.0,
            0.017066, places=6,
        )

    def test_non_positive_inputs(self) -> None:
        self.assertIsNone(kepler_semimajor_axis_au(0.0, 1.0))
        self.assertIsNone(kepler_semimajor_axis_au(10.0, 0.0))


class MscOrbitElementTests(unittest.TestCase):
    def test_period_units(self) -> None:
        self.assertEqual(_msc_period_days(_msc_orbit(per=6.0, per_unit="d")), 6.0)
        self.assertEqual(
            _msc_period_days(_msc_orbit(per=2.0, per_unit="y")), 730.5,
        )
        self.assertIsNone(_msc_period_days(_msc_orbit(per=2.0, per_unit="")))
        self.assertIsNone(_msc_period_days(_msc_orbit(per=0.0, per_unit="d")))

    def test_t0_disambiguation(self) -> None:
        # Besselian-year reading (AR Cas A,B-style visual epochs).
        self.assertAlmostEqual(
            msc_T0_jd(1948.33),
            J2000_REF_EPOCH_JD + (1948.33 - 2000.0) * 365.25,
        )
        # Truncated-JD reading (SB subsystems: JD − 2,400,000).
        self.assertAlmostEqual(msc_T0_jd(40087.1914), 2440087.1914)
        self.assertIsNone(msc_T0_jd(None))
        # Implausible under both readings.
        self.assertIsNone(msc_T0_jd(9.9e7))

    def test_sb_row_converts_without_geometry(self) -> None:
        orbit = msc_to_canonical_elements(_msc_orbit(), None)
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
        orbit = msc_to_canonical_elements(row, 10.0)
        self.assertAlmostEqual(orbit.a_AU, 112.6)
        self.assertAlmostEqual(orbit.i_rad, math.radians(91.2))
        self.assertAlmostEqual(orbit.Omega_rad, math.radians(0.9))
        # No parallax → a stays None, orbit still returned.
        self.assertIsNone(msc_to_canonical_elements(row, None).a_AU)

    def test_renderable_gates(self) -> None:
        self.assertTrue(msc_renderable(_msc_orbit()))
        self.assertFalse(msc_renderable(_msc_orbit(t0=None)))
        self.assertFalse(msc_renderable(_msc_orbit(e=None)))
        # Eccentric with no ω can't render; circular with no ω can
        # (Stage 6 backfills the degenerate angle).
        self.assertFalse(msc_renderable(_msc_orbit(longp_deg=None)))
        self.assertTrue(msc_renderable(_msc_orbit(e=0.0, longp_deg=None)))

    def test_pick_best_msc_completeness_then_last(self) -> None:
        sparse = _msc_orbit(a_arcsec=None, incl_deg=None)
        full_old = _msc_orbit(a_arcsec=0.07, node_deg=346.4, incl_deg=89.7)
        full_new = _msc_orbit(a_arcsec=0.10, node_deg=344.9, incl_deg=90.1)
        self.assertIs(_pick_best_msc([sparse, full_old]), full_old)
        # Equal completeness → later edition wins (author updates append).
        self.assertIs(_pick_best_msc([full_old, full_new]), full_new)
        self.assertIs(_pick_best_msc([full_new, sparse]), full_new)


class SelectOrbitMscTests(unittest.TestCase):
    def _select(self, *, rho, msc_rows, orb6_rows=()):
        primary = _resolved(gaia=None, component="Aa", is_primary=True)
        secondary = _resolved(gaia=None, component="Ab", is_primary=False)
        ast = _component_astrometry(parallax_mas=10.0)
        indices = _indices_with_astrometry()
        return select_orbit(
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


if __name__ == "__main__":
    unittest.main()
