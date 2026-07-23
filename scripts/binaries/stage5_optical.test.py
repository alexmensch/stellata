#!/usr/bin/env python3
"""Stdlib-unittest pins for scripts/binaries/stage5_optical.py."""

from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.binaries.parsers import (  # noqa: E402
    GaiaAstrometryRow,
    Hip2Row,
    WdsPair,
)
from scripts.binaries.stage3_astrometry import (  # noqa: E402
    ComponentAstrometry,
)
from scripts.binaries.stage4_orbits import (  # noqa: E402
    OrbitElements,
)
from scripts.binaries.stage5_optical import (  # noqa: E402
    AU_PER_PC,
    KM_S_PER_AU_YR,
    OPTICAL_VIA_VALUES,
    OpticalClassification,
    _both_gaia_consistent,
    _escape_velocity_km_s,
    _orbital_pm_budget_km_s,
    _pair_beyond_separation_limit,
    _separation_au,
    _separation_exceeds_limit,
    _transverse_velocity_km_s,
    classify_all_pairs,
    classify_pair_optical,
    cpm_baseline_verdict,
    optical_counts,
)
from scripts.binaries.pipeline_test_fixtures import (  # noqa: E402
    _component_astrometry,
    _cpm_pair,
    _gaia_astrometry_row,
    _hip2_row,
    _indices_with_astrometry,
    _resolved,
    _wds_pair,
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
        src_to_astrometry: dict[int, "GaiaAstrometryRow"] | None = None,
        hip2: list["Hip2Row"] | None = None,
        mag_pri: float | None = None,
        mag_sec: float | None = None,
        orbit_via: str = "none",
        rho_last: float | None = 5.0,
        system_parallax_anchor: "tuple[float, float | None] | None" = None,
        total_mass_msun: float | None = None,
    ) -> "OpticalClassification":
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
        return classify_pair_optical(
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
            _both_gaia_consistent(p, s, None, 6.0), False,
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
        rejected = classify_pair_optical(
            pair, primary, secondary, "none", indices,
        )
        self.assertEqual(rejected.optical_via, "gaia_rejected")
        kept = classify_pair_optical(
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
        result = classify_pair_optical(
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
            (OrbitElements(
                P_days=6.066, T_jd=None, e=None, a_AU=0.08,
                i_rad=None, omega_rad=None, Omega_rad=None,
                q=None, distance_pc=None,
            ), "msc"),
        ]
        masses = [1.2, 1.6, 1.5]
        anchor_plx = 21.2  # d ≈ 47.17 pc
        budget = _orbital_pm_budget_km_s(
            0, ("A", "C"), ac.rho_last, [0, 1, 2], pairs, orbits, masses,
            anchor_plx,
        )
        r_ab_au = 3.4 * (1000.0 / anchor_plx)
        expected = 2.0 * math.pi * KM_S_PER_AU_YR * math.sqrt(1.6 / r_ab_au)
        self.assertAlmostEqual(budget, expected, places=6)
        # The pair's own row contributes nothing to itself; a pair under
        # test with no measured ρ gets no budget at all.
        self.assertEqual(
            _orbital_pm_budget_km_s(
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
        budget = _orbital_pm_budget_km_s(
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
        out = classify_all_pairs(
            [ac, ab], components, [(None, "none"), (None, "none")],
            indices, system_parallax_anchors=anchors,
            pair_masses=[1.2, 1.6],
        )
        self.assertEqual(out[0].optical_via, "gaia_kept")
        # Without the sibling pair the same Δpm rejects.
        alone = classify_all_pairs(
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
        sep = _separation_au(10.0, 0.05, 10.0, 0.05, rho_arcsec=5.0)
        self.assertAlmostEqual(sep, 5.0 * 100.0, places=3)  # ρ × 100 pc

    def test_radial_counted_when_significant(self) -> None:
        # Pollux F: 96.5 vs 3.36 mas → ~287 pc radial gap dominates.
        sep_pc = _separation_au(96.5, 0.3, 3.36, 0.31, 57.3) / AU_PER_PC
        self.assertGreater(sep_pc, 280.0)

    def test_radial_suppressed_within_combined_error(self) -> None:
        # A depth gap smaller than 3σ of the combined error is treated as
        # noise — radial term drops, only ρ-projection remains.
        sep = _separation_au(10.0, 5.0, 9.0, 5.0, rho_arcsec=1.0)
        d_ref = 1000.0 / 10.0
        self.assertAlmostEqual(sep, 1.0 * d_ref, places=3)

    def test_exceeds_limit_true_for_optical_double(self) -> None:
        self.assertTrue(
            _separation_exceeds_limit(96.5, 0.3, 3.36, 0.31, 57.3),
        )

    def test_exceeds_limit_false_within_one_pc(self) -> None:
        # 10.6 vs 9.7 pc ≈ 0.9 pc gap, under the 1 pc limit.
        self.assertFalse(
            _separation_exceeds_limit(94.3, None, 103.1, 0.02, 5.0),
        )


class CpmBaselineVerdictTests(unittest.TestCase):
    """cpm_baseline_verdict — the 61 Cyg shape: PM 5.2″/yr over a
    century predicts ~520″ of slip for a background star."""

    PM_HIGH = (4100.0, -3200.0)   # |PM| = 5.2 arcsec/yr

    def test_static_geometry_keeps(self) -> None:
        # Relative sep/PA unchanged across the baseline → co-moving.
        self.assertIs(
            cpm_baseline_verdict(_cpm_pair(), *self.PM_HIGH), False,
        )

    def test_drift_tracking_slip_rejects(self) -> None:
        # 295″ of drift ≥ 0.5 × 520″ predicted slip → background star.
        pair = _cpm_pair(rho_last=300.0)
        self.assertIs(cpm_baseline_verdict(pair, *self.PM_HIGH), True)

    def test_pa_only_drift_rejects(self) -> None:
        # Same ρ, PA swings 90° → tangent-plane drift ρ·√2 ≈ 283″.
        pair = _cpm_pair(rho_first=200.0, rho_last=200.0, theta_last=180.0)
        self.assertIs(cpm_baseline_verdict(pair, *self.PM_HIGH), True)

    def test_intermediate_drift_inconclusive(self) -> None:
        # 100″ drift: above the keep floor, below half the slip → None.
        pair = _cpm_pair(rho_last=105.0)
        self.assertIsNone(cpm_baseline_verdict(pair, *self.PM_HIGH))

    def test_low_pm_primary_silent(self) -> None:
        # 50 mas/yr × 100 yr = 5″ predicted slip < CPM_SLIP_MIN_ARCSEC —
        # no discriminating power even for drifting geometry.
        pair = _cpm_pair(rho_last=300.0)
        self.assertIsNone(cpm_baseline_verdict(pair, 50.0, 0.0))

    def test_missing_first_epoch_silent(self) -> None:
        pair = _cpm_pair(rho_first=None)
        self.assertIsNone(cpm_baseline_verdict(pair, *self.PM_HIGH))

    def test_missing_pm_silent(self) -> None:
        self.assertIsNone(cpm_baseline_verdict(_cpm_pair(), None, -3200.0))

    def test_zero_baseline_silent(self) -> None:
        pair = _cpm_pair(date_first=2000, date_last=2000, rho_last=300.0)
        self.assertIsNone(cpm_baseline_verdict(pair, *self.PM_HIGH))


class CpmTierIntegrationTests(unittest.TestCase):
    """Tier 6a routing inside classify_pair_optical: engages only for an
    inherited/synthesized secondary distance with primary PM on file;
    silent otherwise so tier 6 keeps deciding."""

    def _classify(
        self,
        pair: "WdsPair",
        *,
        secondary_via: str = "unresolved",
        primary_astro: "ComponentAstrometry | None" = None,
        secondary_astro: "ComponentAstrometry | None" = None,
    ) -> "OpticalClassification":
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
        return classify_pair_optical(
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
        result = classify_pair_optical(
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
        result = classify_pair_optical(
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
            classify_all_pairs(
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
            _pair_beyond_separation_limit(p, sec, self.ANCHOR, 57.3, indices),
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
            _pair_beyond_separation_limit(p, sec, (7.32, 0.02), 0.0, indices),
        )

    def test_concordant_within_limit(self) -> None:
        s = _gaia_astrometry_row(
            source_id=2, ra_deg=100.0, dec_deg=0.0,
            parallax_mas=100.5, parallax_error_mas=0.05,
        )
        p, sec, indices = self._pair(secondary_gaia=2, src_to_astrometry={2: s})
        self.assertFalse(
            _pair_beyond_separation_limit(p, sec, (100.0, 0.05), 5.0, indices),
        )

    def test_low_poe_not_rejected(self) -> None:
        s = _gaia_astrometry_row(
            source_id=2, ra_deg=100.0, dec_deg=0.0,
            parallax_mas=3.36, parallax_error_mas=1.0,  # poe ~3.4 < 5
        )
        p, sec, indices = self._pair(secondary_gaia=2, src_to_astrometry={2: s})
        self.assertFalse(
            _pair_beyond_separation_limit(p, sec, self.ANCHOR, 57.3, indices),
        )

    def test_no_parallax_either_side_not_rejected(self) -> None:
        p, sec, indices = self._pair()
        self.assertFalse(
            _pair_beyond_separation_limit(p, sec, self.ANCHOR, 57.3, indices),
        )


class EscapeVelocityTests(unittest.TestCase):
    """Escape / transverse velocity helpers underpinning the both-Gaia
    velocity sub-gate."""

    def test_escape_velocity_matches_known_value(self) -> None:
        # 1 M_sun at 1 AU: v_escape = √2 × 29.78 ≈ 42.1 km/s.
        v = _escape_velocity_km_s(1.0, 1.0)
        self.assertAlmostEqual(v, 42.12, places=1)

    def test_escape_velocity_none_for_zero_separation(self) -> None:
        self.assertIsNone(_escape_velocity_km_s(1.0, 0.0))

    def test_transverse_velocity(self) -> None:
        # 100 mas/yr at 5.95 pc ≈ 2.82 km/s (η Cas orbital split).
        v = _transverse_velocity_km_s(100.0, 5.95)
        self.assertAlmostEqual(v, 2.82, places=2)


class OpticalCountsTests(unittest.TestCase):
    def test_every_canonical_key_present(self) -> None:
        rows = [
            OpticalClassification(True, "gaia_kept"),
            OpticalClassification(False, "asymm_rejected"),
            OpticalClassification(True, "wds_notes_kept"),
            OpticalClassification(True, "orbit_kept"),
        ]
        counts = optical_counts(rows)
        self.assertEqual(set(counts.keys()), set(OPTICAL_VIA_VALUES))
        self.assertEqual(counts["gaia_kept"], 1)
        self.assertEqual(counts["asymm_rejected"], 1)
        self.assertEqual(counts["wds_notes_kept"], 1)
        self.assertEqual(counts["orbit_kept"], 1)
        self.assertEqual(counts["mag_heuristic_rejected"], 0)


if __name__ == "__main__":
    unittest.main()
