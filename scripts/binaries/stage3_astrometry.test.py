#!/usr/bin/env python3
"""Stdlib-unittest pins for scripts/binaries/stage3_astrometry.py."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.binaries.parsers import (  # noqa: E402
    WdsPair,
)
from scripts.binaries.stage2_resolve import (  # noqa: E402
    ResolvedComponent,
    build_pair_by_wds_disc,
)
from scripts.binaries.stage3_astrometry import (  # noqa: E402
    ASTROMETRY_VIA_VALUES,
    ComponentAstrometry,
    astrometry_counts,
    attach_astrometry,
    attach_astrometry_all,
    compute_min_rho_per_source,
    gaia_5p_unreliable,
)
from scripts.binaries.pipeline_test_fixtures import (  # noqa: E402
    _athyg_row_at,
    _gaia_astrometry_row,
    _hip2_row,
    _indices_with_astrometry,
    _resolved,
    _wds_pair_with_pos,
)


class Gaia5pUnreliableTests(unittest.TestCase):
    def test_clean_row_passes(self) -> None:
        row = _gaia_astrometry_row(ruwe=1.0, ipd_frac_multi_peak=0.0)
        self.assertFalse(gaia_5p_unreliable(row))

    def test_high_ruwe_trips(self) -> None:
        row = _gaia_astrometry_row(ruwe=1.5, ipd_frac_multi_peak=0.0)
        self.assertTrue(gaia_5p_unreliable(row))

    def test_at_threshold_does_not_trip(self) -> None:
        # Threshold is strict-greater-than 1.4. Equal is fine.
        row = _gaia_astrometry_row(ruwe=1.4, ipd_frac_multi_peak=0.0)
        self.assertFalse(gaia_5p_unreliable(row))

    def test_high_ipd_trips(self) -> None:
        # ipd_frac_multi_peak is percent-valued (0-100); 5 = 5% > the 2% gate.
        row = _gaia_astrometry_row(ruwe=1.0, ipd_frac_multi_peak=5.0)
        self.assertTrue(gaia_5p_unreliable(row))

    def test_missing_values_do_not_trip(self) -> None:
        # Either flag missing must not force the source onto NSS-systemic.
        row = _gaia_astrometry_row(ruwe=None, ipd_frac_multi_peak=None)
        self.assertFalse(gaia_5p_unreliable(row))


class AttachAstrometryTests(unittest.TestCase):
    def test_unresolved_when_no_gaia_source_id_and_no_hip(self) -> None:
        idx = _indices_with_astrometry()
        a = attach_astrometry(_resolved(gaia=None), None, idx)
        self.assertEqual(a.astrometry_via, "unresolved")
        self.assertIsNone(a.ra_deg)
        self.assertIsNone(a.pmra_masyr)

    def test_unresolved_when_no_astrometry_and_no_hip(self) -> None:
        # source_id resolved but astrometry table doesn't cover it,
        # and the component carries no fallback HIP.
        idx = _indices_with_astrometry(src_to_astrometry={})
        a = attach_astrometry(_resolved(gaia=42), 1.0, idx)
        self.assertEqual(a.astrometry_via, "unresolved")

    def test_hip2_fallback_when_no_gaia_source(self) -> None:
        # Sirius-shape: Gaia saturates, no source_id, but ORB6 surfaced
        # the HIP. HIP2 covers it → route via hip2_long_baseline
        # without any PM-disagreement comparison (no Gaia to compare).
        hip2 = _hip2_row(hip=32349, pm_ra_masyr=-546.0, pm_de_masyr=-1223.0)
        idx = _indices_with_astrometry(hip2=[hip2])
        a = attach_astrometry(
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
        a = attach_astrometry(
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
        a = attach_astrometry(
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
        a = attach_astrometry(_resolved(gaia=1000, hip=99), None, idx)
        self.assertEqual(a.astrometry_via, "gaia_5p")
        self.assertIsNone(a.parallax_mas)

    def test_no_gaia_no_hip2_still_unresolved(self) -> None:
        # HIP known but HIP2 doesn't cover it — unresolved.
        idx = _indices_with_astrometry(hip2=[])
        a = attach_astrometry(_resolved(gaia=None, hip=99), None, idx)
        self.assertEqual(a.astrometry_via, "unresolved")

    def test_gaia_5p_default_route(self) -> None:
        gaia = _gaia_astrometry_row(source_id=42, ruwe=1.0, ipd_frac_multi_peak=0.0)
        idx = _indices_with_astrometry(src_to_astrometry={42: gaia})
        a = attach_astrometry(_resolved(gaia=42), None, idx)
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
        a = attach_astrometry(_resolved(gaia=7), None, idx)
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
        a = attach_astrometry(_resolved(gaia=7), None, idx)
        self.assertEqual(a.astrometry_via, "gaia_nss_systemic")

    def test_nss_present_but_5p_clean_routes_to_gaia_5p(self) -> None:
        # NSS row alone is not sufficient — the 5p must also be flagged.
        gaia = _gaia_astrometry_row(source_id=7, ruwe=1.0, ipd_frac_multi_peak=0.0)
        idx = _indices_with_astrometry(
            src_to_astrometry={7: gaia},
            src_to_nss={7: {"period": "100"}},
        )
        a = attach_astrometry(_resolved(gaia=7), 1.0, idx)
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
        a = attach_astrometry(_resolved(gaia=1000), 3.0, idx)
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
        a = attach_astrometry(_resolved(gaia=1000), 2.0, idx)
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
        a = attach_astrometry(_resolved(gaia=1000), 50.0, idx)
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
        a = attach_astrometry(_resolved(gaia=1000), 1.0, idx)
        self.assertEqual(a.astrometry_via, "gaia_5p")

    def test_hip2_route_skipped_when_source_has_no_hip(self) -> None:
        # Tycho-only star — no HIP2 lookup possible.
        gaia = _gaia_astrometry_row(source_id=1000)
        idx = _indices_with_astrometry(
            src_to_astrometry={1000: gaia},
            hip_to_gaia={},
            hip2=[],
        )
        a = attach_astrometry(_resolved(gaia=1000), 1.0, idx)
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
        a = attach_astrometry(_resolved(gaia=1000), 1.0, idx)
        self.assertEqual(a.astrometry_via, "gaia_nss_systemic")


class ComputeMinRhoPerSourceTests(unittest.TestCase):
    def test_takes_minimum_across_pairs(self) -> None:
        # Same source_id in a tight AB pair and a wide AC pair — the
        # 2″ ρ wins so this star will trip the HIP2 5″ gate.
        ab = WdsPair(
            wds_id="X", discoverer="D", components="AB",
            date_last=None, rho_last=2.0, theta_last=0.0,
            mag_pri=None, mag_sec=None, spectral="", notes="    ",
            precise_ra_deg=None, precise_dec_deg=None,
        )
        ac = WdsPair(
            wds_id="X", discoverer="D", components="AC",
            date_last=None, rho_last=50.0, theta_last=0.0,
            mag_pri=None, mag_sec=None, spectral="", notes="    ",
            precise_ra_deg=None, precise_dec_deg=None,
        )
        comp_ab = _resolved(gaia=42, wds_id="X", discoverer="D", component="A", is_primary=True)
        comp_ac = _resolved(gaia=42, wds_id="X", discoverer="D", component="A", is_primary=True)
        idx = build_pair_by_wds_disc([ab, ac])
        min_rho = compute_min_rho_per_source([comp_ab, comp_ac], idx)
        self.assertEqual(min_rho[42], 2.0)

    def test_skips_components_with_no_pair_or_no_rho(self) -> None:
        bare = WdsPair(
            wds_id="Y", discoverer="D", components="AB",
            date_last=None, rho_last=None, theta_last=None,
            mag_pri=None, mag_sec=None, spectral="", notes="    ",
            precise_ra_deg=None, precise_dec_deg=None,
        )
        comp = _resolved(gaia=7, wds_id="Y", discoverer="D")
        idx = build_pair_by_wds_disc([bare])
        min_rho = compute_min_rho_per_source([comp], idx)
        self.assertNotIn(7, min_rho)


class AttachAstrometryAllTests(unittest.TestCase):
    def test_parallel_list_contract(self) -> None:
        gaia = _gaia_astrometry_row(source_id=42)
        idx = _indices_with_astrometry(src_to_astrometry={42: gaia})
        c1 = _resolved(gaia=42, wds_id="X", discoverer="D", component="A", is_primary=True)
        c2 = _resolved(gaia=None, wds_id="X", discoverer="D", component="B", is_primary=False)
        pair = WdsPair(
            wds_id="X", discoverer="D", components="AB",
            date_last=None, rho_last=10.0, theta_last=0.0,
            mag_pri=None, mag_sec=None, spectral="", notes="    ",
            precise_ra_deg=None, precise_dec_deg=None,
        )
        out = attach_astrometry_all([c1, c2], pairs=[pair], indices=idx)
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
        pair = WdsPair(
            wds_id="X", discoverer="D", components="AB",
            date_last=None, rho_last=2.0, theta_last=0.0,
            mag_pri=None, mag_sec=None, spectral="", notes="    ",
            precise_ra_deg=None, precise_dec_deg=None,
        )
        out = attach_astrometry_all([c], pairs=[pair], indices=idx)
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
        ab = WdsPair(
            wds_id="X", discoverer="D", components="AB",
            date_last=None, rho_last=2.0, theta_last=0.0,
            mag_pri=None, mag_sec=None, spectral="", notes="    ",
            precise_ra_deg=None, precise_dec_deg=None,
        )
        ac = WdsPair(
            wds_id="X", discoverer="D", components="AC",
            date_last=None, rho_last=50.0, theta_last=0.0,
            mag_pri=None, mag_sec=None, spectral="", notes="    ",
            precise_ra_deg=None, precise_dec_deg=None,
        )
        out = attach_astrometry_all([ab_a, ac_a], pairs=[ab, ac], indices=idx)
        # Both A-rows in the same system route together because the
        # per-source min-ρ (2″) gates the HIP2 fallback.
        self.assertEqual(out[0].astrometry_via, "hip2_long_baseline")
        self.assertEqual(out[1].astrometry_via, "hip2_long_baseline")


class AstrometryCountsTests(unittest.TestCase):
    def test_every_canonical_key_present(self) -> None:
        items = [
            ComponentAstrometry(
                astrometry_via="gaia_5p",
                ra_deg=1.0, dec_deg=1.0, parallax_mas=1.0,
                parallax_error_mas=0.05,
                pmra_masyr=1.0, pmdec_masyr=1.0, ref_epoch=2016.0,
            ),
            ComponentAstrometry(
                astrometry_via="unresolved",
                ra_deg=None, dec_deg=None, parallax_mas=None,
                parallax_error_mas=None,
                pmra_masyr=None, pmdec_masyr=None, ref_epoch=None,
            ),
        ]
        counts = astrometry_counts(items)
        self.assertEqual(set(counts.keys()), set(ASTROMETRY_VIA_VALUES))
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
            ResolvedComponent(
                wds_id=pair.wds_id, discoverer=pair.discoverer,
                component="A", is_primary=True,
                gaia_source_id=756853643638639104, resolve_via="simbad_xid",
                hip=55203,  # ORB6 hip, but HIP2 doesn't cover it.
            ),
            ResolvedComponent(
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
        out = attach_astrometry_all(
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
        out = attach_astrometry_all(
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
        out = attach_astrometry_all(
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
            ResolvedComponent(
                wds_id=pair.wds_id, discoverer=pair.discoverer,
                component="A", is_primary=True,
                gaia_source_id=1, resolve_via="simbad_xid",
            ),
            ResolvedComponent(
                wds_id=pair.wds_id, discoverer=pair.discoverer,
                component="B", is_primary=False,
                gaia_source_id=2, resolve_via="simbad_xid",
            ),
        ]
        idx = _indices_with_astrometry(
            src_to_astrometry={}, athyg=athyg, hip2=[],
        )
        out = attach_astrometry_all(
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
        out = attach_astrometry_all(
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
        out = attach_astrometry_all([c], pairs=[pair], indices=idx)
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
        out = attach_astrometry_all(
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
            ResolvedComponent(
                wds_id=pair.wds_id, discoverer=pair.discoverer,
                component="A", is_primary=True,
                gaia_source_id=1, resolve_via="simbad_xid",
            ),
            ResolvedComponent(
                wds_id=pair.wds_id, discoverer=pair.discoverer,
                component="B", is_primary=False,
                gaia_source_id=2, resolve_via="simbad_xid",
            ),
        ]
        idx = _indices_with_astrometry(
            src_to_astrometry={}, athyg=athyg, hip2=[],
        )
        out = attach_astrometry_all(
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
        out = attach_astrometry_all(
            [c], pairs=[pair], indices=idx, athyg=athyg,
        )
        self.assertEqual(out[0].astrometry_via, "unresolved")


if __name__ == "__main__":
    unittest.main()
