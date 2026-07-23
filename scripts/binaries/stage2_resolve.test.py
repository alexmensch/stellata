#!/usr/bin/env python3
"""Stdlib-unittest pins for scripts/binaries/stage2_resolve.py."""

from __future__ import annotations

import math
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.binaries.indices import (  # noqa: E402
    IdentifierIndices,
    WDS_PRECISE_COORD_EPOCH,
    build_indices,
)
from scripts.binaries.parsers import (  # noqa: E402
    AthygRow,
    CcdmRow,
    SimbadWdsXid,
)
from scripts.binaries.stage2_resolve import (  # noqa: E402
    BINDING_SHAPE_LETTER_SOURCES,
    BINDING_SHAPE_SOURCE_LETTERS,
    BINDING_VERDICT_GEOMETRIC,
    BINDING_VERDICT_IDENTITY_REFUTED,
    BINDING_VERDICT_SKIPPED_NO_REFERENCE,
    BINDING_VERDICT_SKIPPED_PHOTOCENTRE_BLEND,
    BINDING_VERDICT_TSV_COLUMNS,
    BINDING_VERDICT_UNBOUND_AMBIGUOUS,
    BindingVerdict,
    RESOLVE_VIA_PRIORITY,
    RESOLVE_VIA_VALUES,
    ResolvedComponent,
    _athyg_position_at_epoch,
    _bfs_offset,
    _cluster_tokens,
    _propagate_position,
    audit_binding_integrity,
    binding_integrity_counts,
    build_athyg_position_grid,
    build_system_letter_positions,
    find_nearest_athyg_at_position,
    group_orb6_by_pair,
    inherit_downward_parent_bindings,
    iter_decomposing_pair_components,
    predict_secondary_position,
    propagate_blend_identity,
    propagate_within_system,
    rescue_blank_components_pairs,
    resolution_counts,
    resolve_all_pairs,
    resolve_component,
    resolve_via_ccdm,
    resolve_via_position,
    resolve_via_simbad,
    split_components,
    write_astrometry_request,
    write_binding_verdicts_tsv,
)
from scripts.binaries.pipeline_test_fixtures import (  # noqa: E402
    _athyg_row,
    _athyg_row_at,
    _bi_astro,
    _bi_comp,
    _bi_indices,
    _bi_pair,
    _bi_system,
    _blank_pair,
    _indices,
    _orb6,
    _resolved,
    _wds_pair,
    _wds_pair_with_pos,
)


class SplitComponentsTests(unittest.TestCase):
    def test_two_letter_pair(self) -> None:
        self.assertEqual(split_components("AB"), ("A", "B"))

    def test_comma_separated_pair(self) -> None:
        self.assertEqual(split_components("Aa,Ab"), ("Aa", "Ab"))
        self.assertEqual(split_components("BC,D"), ("BC", "D"))

    def test_skips_blank_field(self) -> None:
        self.assertIsNone(split_components(""))
        self.assertIsNone(split_components("   "))

    def test_skips_ambiguous_three_letter(self) -> None:
        # "ABC" could be A+BC or AB+C — refuse rather than guess.
        self.assertIsNone(split_components("ABC"))

    def test_skips_single_letter(self) -> None:
        self.assertIsNone(split_components("A"))


class RescueBlankComponentsTests(unittest.TestCase):
    def _rescue(self, **kw: object) -> tuple[int, int]:
        kw.setdefault("orb6", [])
        kw.setdefault("simbad_xids", {})
        kw.setdefault("synthesized_orb6_pairs", [])
        return rescue_blank_components_pairs(**kw)  # type: ignore[arg-type]

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
            ("20414+4517", "A"): SimbadWdsXid(
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


class ResolveComponentTests(unittest.TestCase):
    def test_tier1_orb6_hip_for_primary(self) -> None:
        # ORB6 publishes HIP for the pair; Gaia HIP xwalk covers it.
        pair = _wds_pair(wds_id="06451-1643", components="AB")
        orb6 = [_orb6(wds_id="06451-1643", components="AB", hip=32349)]
        idx = _indices(hip_to_gaia={32349: 2947050466531873024})
        r = resolve_component(
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
        r = resolve_component(
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
        r = resolve_component(
            pair, "A", is_primary=True,
            orb6_for_pair=orb6, indices=idx,
        )
        self.assertEqual(r.resolve_via, "athyg_gaia_native")
        self.assertEqual(r.gaia_source_id, 12345)

    def test_unresolved_when_no_hip_signal(self) -> None:
        pair = _wds_pair(components="AB")
        idx = _indices(hip_to_gaia={1: 1})
        r = resolve_component(
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
        r = resolve_component(
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
        r = resolve_component(
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
        r = resolve_component(
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
        r = resolve_component(
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
        r = resolve_component(
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
        grouped = group_orb6_by_pair([ab, ac, sys])
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
        results = resolve_all_pairs(
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
        results = resolve_all_pairs(
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
            ("00491+5749", "B"): SimbadWdsXid(
                simbad_oid=106493, simbad_main_id="* eta Cas B",
                gaia_source_id=425040000962497792, hip=None,
            ),
        }
        results = resolve_all_pairs(
            pairs=[pair], orb6=[], indices=idx, athyg=[],
            simbad_xids=xids,
        )
        self.assertEqual(len(results), 2)
        primary, secondary = results
        self.assertEqual(primary.resolve_via, "unresolved")
        self.assertEqual(secondary.resolve_via, "simbad_xid")
        self.assertEqual(secondary.gaia_source_id, 425040000962497792)


class PositionGeometryTests(unittest.TestCase):
    def test_predict_secondary_due_north(self) -> None:
        # ρ = 3600″ = 1°, θ = 0° → secondary is 1° north of primary.
        ra, dec = predict_secondary_position(
            primary_ra_deg=100.0, primary_dec_deg=0.0,
            rho_arcsec=3600.0, theta_deg=0.0,
        )
        self.assertAlmostEqual(ra, 100.0, places=6)
        self.assertAlmostEqual(dec, 1.0, places=6)

    def test_predict_secondary_due_east(self) -> None:
        # θ = 90° (east), at dec=60° → ra offset is 1°/cos(60°) = 2°.
        ra, dec = predict_secondary_position(
            primary_ra_deg=100.0, primary_dec_deg=60.0,
            rho_arcsec=3600.0, theta_deg=90.0,
        )
        self.assertAlmostEqual(ra, 102.0, places=3)
        self.assertAlmostEqual(dec, 60.0, places=6)


class PositionMatchTests(unittest.TestCase):
    def test_within_tolerance_matches(self) -> None:
        athyg = [_athyg_row_at(ra=100.0, dec=20.0, gaia=42)]
        grid = build_athyg_position_grid(athyg)
        # Query 1″ east of target (≈ 0.000297° at dec=20°). Inside 2″ tol.
        idx = find_nearest_athyg_at_position(
            ra_deg=100.0 + 1.0 / 3600.0 / math.cos(math.radians(20.0)),
            dec_deg=20.0,
            grid=grid, athyg=athyg, tol_arcsec=2.0,
        )
        self.assertEqual(idx, 0)

    def test_outside_tolerance_misses(self) -> None:
        athyg = [_athyg_row_at(ra=100.0, dec=20.0, gaia=42)]
        grid = build_athyg_position_grid(athyg)
        # 5″ east of target — outside 2″ tolerance.
        idx = find_nearest_athyg_at_position(
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
        grid = build_athyg_position_grid(athyg)
        idx = find_nearest_athyg_at_position(
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
            ResolvedComponent(
                wds_id=pair.wds_id, discoverer=pair.discoverer,
                component="Ca", is_primary=True,
                gaia_source_id=None, resolve_via="unresolved",
            ),
        ]
        resolve_via_position(
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
            ResolvedComponent(
                wds_id=pair.wds_id, discoverer=pair.discoverer,
                component="A", is_primary=True,
                gaia_source_id=None, resolve_via="unresolved",
            ),
            ResolvedComponent(
                wds_id=pair.wds_id, discoverer=pair.discoverer,
                component="B", is_primary=False,
                gaia_source_id=None, resolve_via="unresolved",
            ),
        ]
        resolve_via_position(
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
        c = ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True,
            gaia_source_id=100, resolve_via="orb6_hip",
        )
        resolve_via_position([c], pairs=[pair], athyg=athyg)
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
        c = ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        resolve_via_position([c], pairs=[pair], athyg=athyg)
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
        a_comp = ResolvedComponent(
            wds_id="05145-0812", discoverer=pair_bc.discoverer,
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved", hip=24436,
        )
        b_comp = ResolvedComponent(
            wds_id="05145-0812", discoverer=pair_bc.discoverer,
            component="B", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        stats: dict[str, int] = {}
        resolve_via_position(
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
        a_comp = ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved", hip=42,
        )
        stats: dict[str, int] = {}
        resolve_via_position(
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
        c = ResolvedComponent(
            wds_id="00491+5749", discoverer="STF   60",
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        xids = {
            ("00491+5749", "A"): SimbadWdsXid(
                simbad_oid=106647, simbad_main_id="* eta Cas",
                gaia_source_id=425040000962559616, hip=3821,
            ),
        }
        resolve_via_simbad([c], xids)
        self.assertEqual(c.resolve_via, "simbad_xid")
        self.assertEqual(c.gaia_source_id, 425040000962559616)
        self.assertEqual(c.hip, 3821)

    def test_binds_hip_only_when_gaia_missing(self) -> None:
        # α Cen A-shaped: SIMBAD has the oid + HIP but no Gaia DR3
        # source_id (bright-star saturation gap). HIP must bind so
        # Stage 3's HIP2 fallback engages; resolve_via stays
        # ``unresolved`` so the cascade can keep going.
        c = ResolvedComponent(
            wds_id="14396-6050", discoverer="RHD   1",
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        xids = {
            ("14396-6050", "A"): SimbadWdsXid(
                simbad_oid=3396054, simbad_main_id="* alf Cen A",
                gaia_source_id=None, hip=71683,
            ),
        }
        resolve_via_simbad([c], xids)
        self.assertEqual(c.resolve_via, "unresolved")
        self.assertIsNone(c.gaia_source_id)
        self.assertEqual(c.hip, 71683)

    def test_skips_already_resolved_components(self) -> None:
        # ``orb6_hip`` already bound — SIMBAD pass must not overwrite,
        # even if SIMBAD would have published a different source_id.
        c = ResolvedComponent(
            wds_id="X", discoverer="D", component="A", is_primary=True,
            gaia_source_id=42, resolve_via="orb6_hip", hip=99,
        )
        xids = {
            ("X", "A"): SimbadWdsXid(
                simbad_oid=1, simbad_main_id="other",
                gaia_source_id=999, hip=999,
            ),
        }
        resolve_via_simbad([c], xids)
        self.assertEqual(c.resolve_via, "orb6_hip")
        self.assertEqual(c.gaia_source_id, 42)
        self.assertEqual(c.hip, 99)

    def test_does_not_override_existing_hip(self) -> None:
        # Component carried a HIP forward from ``resolve_component`` —
        # SIMBAD's HIP must NOT clobber it. The two could disagree
        # (e.g. ORB6's HIP for the system vs SIMBAD's per-component
        # suffix); preferring resolve_component's keeps Stage 3's
        # HIP2 routing aligned with the rest of the cascade.
        c = ResolvedComponent(
            wds_id="X", discoverer="D", component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved", hip=32349,
        )
        xids = {
            ("X", "A"): SimbadWdsXid(
                simbad_oid=1, simbad_main_id="other",
                gaia_source_id=None, hip=99,
            ),
        }
        resolve_via_simbad([c], xids)
        self.assertEqual(c.hip, 32349)
        self.assertEqual(c.resolve_via, "unresolved")

    def test_skips_components_not_in_simbad(self) -> None:
        c = ResolvedComponent(
            wds_id="X", discoverer="D", component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        resolve_via_simbad([c], {})
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
        ccdm_rows: list["CcdmRow"],
        athyg: list["AthygRow"] | None = None,
        hip_to_gaia: dict[int, int] | None = None,
    ) -> "IdentifierIndices":
        return build_indices(
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
            CcdmRow(hip=71683, ccdm="14396-6050", mult_flag=""),
            CcdmRow(hip=71681, ccdm="14396-6050", mult_flag=""),
        ]
        indices = self._indices_with_ccdm(
            ccdm_rows=ccdm_rows, athyg=athyg,
        )
        primary = ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved", hip=71683,
        )
        secondary = ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="B", is_primary=False,
            gaia_source_id=None, resolve_via="unresolved",
        )
        resolve_via_ccdm(
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
        ccdm_rows = [CcdmRow(hip=42, ccdm="00000+0000", mult_flag="")]
        indices = self._indices_with_ccdm(
            ccdm_rows=ccdm_rows, athyg=athyg,
            hip_to_gaia={42: 5000},
        )
        primary = ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        resolve_via_ccdm([primary], pairs=[pair], indices=indices)
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
            CcdmRow(hip=71683, ccdm="14396-6050", mult_flag=""),
            CcdmRow(hip=71681, ccdm="14396-6050", mult_flag=""),
        ]
        indices = self._indices_with_ccdm(
            ccdm_rows=ccdm_rows, athyg=athyg,
        )
        secondary = ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="C", is_primary=False,
            gaia_source_id=None, resolve_via="unresolved",
        )
        resolve_via_ccdm([secondary], pairs=[pair], indices=indices)
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
        ccdm_rows = [CcdmRow(hip=24436, ccdm="05145-0812", mult_flag="")]
        indices = self._indices_with_ccdm(
            ccdm_rows=ccdm_rows, athyg=athyg,
            hip_to_gaia={24436: 7777},
        )
        b_primary = ResolvedComponent(
            wds_id=pair_bc.wds_id, discoverer=pair_bc.discoverer,
            component="B", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        c_secondary = ResolvedComponent(
            wds_id=pair_bc.wds_id, discoverer=pair_bc.discoverer,
            component="C", is_primary=False,
            gaia_source_id=None, resolve_via="unresolved",
        )
        stats: dict[str, int] = {}
        resolve_via_ccdm(
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
        ccdm_rows = [CcdmRow(hip=99, ccdm="00000+0000", mult_flag="")]
        indices = self._indices_with_ccdm(ccdm_rows=ccdm_rows, athyg=athyg)
        secondary = ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="B", is_primary=False,
            gaia_source_id=None, resolve_via="unresolved",
        )
        stats: dict[str, int] = {}
        resolve_via_ccdm(
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
        ccdm_rows = [CcdmRow(hip=99, ccdm="00000+0000", mult_flag="")]
        indices = self._indices_with_ccdm(ccdm_rows=ccdm_rows, athyg=athyg)
        secondary = ResolvedComponent(
            wds_id=pair_ac.wds_id, discoverer=pair_ac.discoverer,
            component="C", is_primary=False,
            gaia_source_id=None, resolve_via="unresolved",
        )
        stats: dict[str, int] = {}
        resolve_via_ccdm(
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
        ccdm_rows = [CcdmRow(hip=24436, ccdm="05145-0812", mult_flag="")]
        indices = self._indices_with_ccdm(
            ccdm_rows=ccdm_rows, athyg=athyg,
            hip_to_gaia={24436: 7777},
        )
        a_primary = ResolvedComponent(
            wds_id=pair_a_bc.wds_id, discoverer=pair_a_bc.discoverer,
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved", hip=24436,
        )
        b_primary = ResolvedComponent(
            wds_id=pair_bc.wds_id, discoverer=pair_bc.discoverer,
            component="B", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        stats: dict[str, int] = {}
        resolve_via_ccdm(
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
        positions = build_system_letter_positions([pair_ab, pair_bc])
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
        c = ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        resolve_via_ccdm([c], pairs=[pair], indices=indices)
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
        ccdm_rows = [CcdmRow(hip=42, ccdm="00000+0000", mult_flag="")]
        indices = self._indices_with_ccdm(
            ccdm_rows=ccdm_rows, athyg=athyg,
            hip_to_gaia={42: 5000},
        )
        c = ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        resolve_via_ccdm([c], pairs=[pair], indices=indices)
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
            CcdmRow(hip=8, ccdm="00000+0000", mult_flag=""),
            CcdmRow(hip=9, ccdm="00000+0000", mult_flag=""),
        ]
        indices = self._indices_with_ccdm(
            ccdm_rows=ccdm_rows, athyg=athyg,
        )
        primary = ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved", hip=9,
        )
        resolve_via_ccdm([primary], pairs=[pair], indices=indices)
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
        ra_j2000, dec_j2000 = _athyg_position_at_epoch(
            row, target_epoch=WDS_PRECISE_COORD_EPOCH,
        )
        # WDS precise_coord for α Cen RHD 1 AB is 219.9021, -60.8340.
        self.assertAlmostEqual(ra_j2000, 219.9021, places=3)
        self.assertAlmostEqual(dec_j2000, -60.8340, places=3)

    def test_zero_pm_row_is_unchanged(self) -> None:
        row = _athyg_row_at(
            ra=100.0, dec=20.0, gaia=None,
            pm_ra_masyr=None, pm_de_masyr=None,
        )
        ra, dec = _athyg_position_at_epoch(row, target_epoch=2000.0)
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
        ra, dec = _athyg_position_at_epoch(row, target_epoch=2000.0)
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
        ra, dec = _propagate_position(
            100.0, 0.0, 3600.0, 0.0,
            ref_epoch=2016.0, target_epoch=WDS_PRECISE_COORD_EPOCH,
        )
        self.assertAlmostEqual(ra, 99.984, places=6)
        self.assertAlmostEqual(dec, 0.0, places=9)

    def test_missing_pm_returns_position_unchanged(self) -> None:
        ra, dec = _propagate_position(
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
        c = ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        resolve_via_position(
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
        c = ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="C", is_primary=False,
            gaia_source_id=None, resolve_via="unresolved",
        )
        resolve_via_position(
            components=[c], pairs=[pair], athyg=athyg,
            tolerance_arcsec=2.0,
        )
        self.assertEqual(c.resolve_via, "unresolved")
        self.assertIsNone(c.gaia_source_id)


class PropagateWithinSystemTests(unittest.TestCase):
    def test_inherits_letter_binding_across_pairs(self) -> None:
        # Component "A" of system X resolved in pair "AB". The same
        # letter as primary of pair "AC" must inherit the binding.
        ab_a = ResolvedComponent(
            wds_id="X", discoverer="DA", component="A", is_primary=True,
            gaia_source_id=42, resolve_via="orb6_hip",
        )
        ac_a = ResolvedComponent(
            wds_id="X", discoverer="DA", component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        ac_c = ResolvedComponent(
            wds_id="X", discoverer="DA", component="C", is_primary=False,
            gaia_source_id=None, resolve_via="unresolved",
        )
        components = [ab_a, ac_a, ac_c]
        propagate_within_system(components)
        self.assertEqual(ac_a.gaia_source_id, 42)
        self.assertEqual(ac_a.resolve_via, "orb6_hip")
        # Unrelated letter "C" must stay unresolved.
        self.assertIsNone(ac_c.gaia_source_id)

    def test_does_not_cross_systems(self) -> None:
        # Same letter "A" but different wds_id → no propagation.
        x_a = ResolvedComponent(
            wds_id="X", discoverer="D", component="A", is_primary=True,
            gaia_source_id=100, resolve_via="orb6_hip",
        )
        y_a = ResolvedComponent(
            wds_id="Y", discoverer="D", component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        propagate_within_system([x_a, y_a])
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
        simbad_first = ResolvedComponent(
            wds_id="X", discoverer="DA", component="A", is_primary=True,
            gaia_source_id=42, resolve_via="simbad_xid",
        )
        orb6_later = ResolvedComponent(
            wds_id="X", discoverer="DB", component="A", is_primary=True,
            gaia_source_id=42, resolve_via="orb6_hip",
        )
        unresolved_a = ResolvedComponent(
            wds_id="X", discoverer="DC", component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        propagate_within_system([simbad_first, orb6_later, unresolved_a])
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
        aa = ResolvedComponent(
            wds_id="07346+3153", discoverer="CIA  29",
            component="Aa", is_primary=True,
            gaia_source_id=1234, resolve_via="simbad_xid",
            hip=36850,
        )
        a = ResolvedComponent(
            wds_id="07346+3153", discoverer="STF1110",
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        propagate_within_system([aa, a])
        self.assertEqual(a.gaia_source_id, 1234)
        self.assertEqual(a.resolve_via, "simbad_xid")
        self.assertEqual(a.hip, 36850)

    def test_subcomponent_does_not_inherit_from_parent(self) -> None:
        # Reverse direction is intentionally NOT propagated — ``A`` is
        # a coarser slot and may not match the brighter ``Aa``'s source
        # if a future pipeline resolved ``Aa`` and ``Ab`` separately.
        a = ResolvedComponent(
            wds_id="X", discoverer="DA", component="A", is_primary=True,
            gaia_source_id=42, resolve_via="orb6_hip",
        )
        aa = ResolvedComponent(
            wds_id="X", discoverer="DB", component="Aa", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        propagate_within_system([a, aa])
        self.assertIsNone(aa.gaia_source_id)

    def test_subcomponent_inheritance_respects_priority(self) -> None:
        # Two subcomponents resolve A — Aa via ``simbad_xid`` and Ab
        # via ``orb6_hip``. The bare ``A`` inherits the higher-priority
        # tag (``orb6_hip``) per RESOLVE_VIA_PRIORITY.
        aa = ResolvedComponent(
            wds_id="X", discoverer="D1", component="Aa", is_primary=True,
            gaia_source_id=42, resolve_via="simbad_xid",
        )
        ab = ResolvedComponent(
            wds_id="X", discoverer="D2", component="Ab", is_primary=False,
            gaia_source_id=42, resolve_via="orb6_hip",
        )
        bare_a = ResolvedComponent(
            wds_id="X", discoverer="D3", component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        propagate_within_system([aa, ab, bare_a])
        self.assertEqual(bare_a.gaia_source_id, 42)
        self.assertEqual(bare_a.resolve_via, "orb6_hip")


class ResolutionCountsTests(unittest.TestCase):
    def test_every_canonical_key_present(self) -> None:
        comps = [
            ResolvedComponent(
                wds_id="X", discoverer="D", component="A", is_primary=True,
                gaia_source_id=1, resolve_via="orb6_hip",
            ),
            ResolvedComponent(
                wds_id="X", discoverer="D", component="B", is_primary=False,
                gaia_source_id=None, resolve_via="unresolved",
            ),
        ]
        counts = resolution_counts(comps)
        # All keys present (zeros for absent strategies), totals match.
        self.assertEqual(set(counts.keys()), set(RESOLVE_VIA_VALUES))
        self.assertEqual(counts["orb6_hip"], 1)
        self.assertEqual(counts["unresolved"], 1)
        self.assertEqual(counts["position_pm"], 0)


class AstrometryRequestTests(unittest.TestCase):
    def test_dedupes_and_skips_unresolved(self) -> None:
        comps = [
            ResolvedComponent(
                wds_id="X", discoverer="D", component="A", is_primary=True,
                gaia_source_id=222, resolve_via="orb6_hip",
            ),
            ResolvedComponent(
                wds_id="X", discoverer="D", component="B", is_primary=False,
                gaia_source_id=111, resolve_via="athyg_gaia_native",
            ),
            ResolvedComponent(
                wds_id="Y", discoverer="D", component="A", is_primary=True,
                gaia_source_id=222, resolve_via="athyg_gaia_native",
            ),
            ResolvedComponent(
                wds_id="Z", discoverer="D", component="A", is_primary=True,
                gaia_source_id=None, resolve_via="unresolved",
            ),
        ]
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "request.tsv"
            n = write_astrometry_request(comps, p)
            body = p.read_text().splitlines()
        self.assertEqual(n, 2)
        # Header + sorted unique ids; unresolved row contributes nothing.
        self.assertEqual(body, ["gaia_source_id", "111", "222"])

        # Magnitude-gate-rejected candidates stay in the request: the
        # gate can only keep rejecting a binding whose G is in the pull.
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "request.tsv"
            n = write_astrometry_request(
                comps, p, rejected_source_ids=[333, 111],
            )
            body = p.read_text().splitlines()
        self.assertEqual(n, 3)
        self.assertEqual(body, ["gaia_source_id", "111", "222", "333"])


class ResolveViaCanonicalKeysTests(unittest.TestCase):
    """``RESOLVE_VIA_VALUES`` is the canonical priority list every tier
    label is keyed off. ``ccdm_hip`` sits between ``simbad_xid`` and
    ``position_pm``.
    """

    def test_ccdm_hip_present_and_above_position_tiers(self) -> None:
        values = RESOLVE_VIA_VALUES
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
            RESOLVE_VIA_PRIORITY,
            {tag: i for i, tag in enumerate(RESOLVE_VIA_VALUES)},
        )


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
        r = resolve_component(
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
        r = resolve_component(
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
        athyg = [AthygRow(
            hip=99, tyc=None, gaia=42, hd=None,
            ra_deg=100.0, dec_deg=0.0,
            x_pc=0.0, y_pc=0.0, z_pc=0.0,
            dist_pc=1.0, v_mag=None, absmag=5.0,
            ci=None, spect="", proper="",
            pm_ra_masyr=None, pm_de_masyr=None,
        )]
        c = ResolvedComponent(
            wds_id=pair.wds_id, discoverer=pair.discoverer,
            component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved",
        )
        resolve_via_position(
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
        ab_a = ResolvedComponent(
            wds_id="X", discoverer="D", component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved", hip=32349,
        )
        ac_a = ResolvedComponent(
            wds_id="X", discoverer="D", component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved", hip=None,
        )
        ad_a = ResolvedComponent(
            wds_id="X", discoverer="D", component="A", is_primary=True,
            gaia_source_id=None, resolve_via="unresolved", hip=None,
        )
        propagate_within_system([ab_a, ac_a, ad_a])
        self.assertEqual(ac_a.hip, 32349)
        self.assertEqual(ad_a.hip, 32349)


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
        yielded = list(iter_decomposing_pair_components([p1, p2], comps))
        self.assertEqual([(y[1].component, y[2].component) for y in yielded],
                         [("A", "B")])

    def test_cursor_desync_raises(self) -> None:
        p = _wds_pair(wds_id="W1", components="AB")
        comps = [
            _resolved(gaia=1, wds_id="W2", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="W2", component="B", is_primary=False),
        ]
        with self.assertRaises(RuntimeError):
            list(iter_decomposing_pair_components([p], comps))


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
        n = propagate_blend_identity([primary, secondary], [pair])
        self.assertEqual(n, 1)
        self.assertEqual(secondary.gaia_source_id, 42)
        self.assertEqual(secondary.hip, 7)
        self.assertIs(secondary.athyg_row, primary.athyg_row)
        self.assertEqual(secondary.resolve_via, "orb6_hip")

    def test_resolved_pair_untouched(self) -> None:
        pair, primary, secondary = self._fixture(rho=1.5)
        n = propagate_blend_identity([primary, secondary], [pair])
        self.assertEqual(n, 0)
        self.assertIsNone(secondary.gaia_source_id)

    def test_secondary_with_own_binding_untouched(self) -> None:
        # A SIMBAD-bound per-component HIP is real evidence — the blend
        # convention must not overwrite or extend it.
        pair, primary, secondary = self._fixture(rho=0.0, secondary_hip=99)
        n = propagate_blend_identity([primary, secondary], [pair])
        self.assertEqual(n, 0)
        self.assertIsNone(secondary.gaia_source_id)
        self.assertEqual(secondary.hip, 99)


class BindingIntegrityDetectorTests(unittest.TestCase):
    def _audit(self, rows, src_to_astrometry, hip_to_gaia=None):
        pairs, comps = _bi_system(rows)
        idx = _bi_indices(src_to_astrometry, hip_to_gaia)
        verdicts = audit_binding_integrity(pairs, comps, idx, apply=False)
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
        v = [x for x in verdicts if x.shape == BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].verdict, BINDING_VERDICT_GEOMETRIC)
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
        v = [x for x in verdicts if x.shape == BINDING_SHAPE_LETTER_SOURCES]
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].verdict, BINDING_VERDICT_GEOMETRIC)
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
        clusters = _cluster_tokens({"A", "Aa", "Aa1"}, [])
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
        v = [x for x in verdicts if x.shape == BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)

    def test_compound_containment_exemption(self) -> None:
        # SX bound to AB (compound) and A — A is contained in AB.
        clusters = _cluster_tokens({"AB", "A"}, [])
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
        v = [x for x in verdicts if x.shape == BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].verdict, BINDING_VERDICT_UNBOUND_AMBIGUOUS)
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
        v = [x for x in verdicts if x.shape == BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(
            v[0].verdict, BINDING_VERDICT_SKIPPED_PHOTOCENTRE_BLEND,
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
        v = [x for x in verdicts if x.shape == BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].verdict, BINDING_VERDICT_GEOMETRIC)
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
        v = [x for x in verdicts if x.shape == BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(
            v[0].verdict, BINDING_VERDICT_SKIPPED_PHOTOCENTRE_BLEND,
        )
        self.assertEqual(v[0].unbind, [])

    @staticmethod
    def _xid(gaia: int | None, hip: int | None = None) -> "SimbadWdsXid":
        return SimbadWdsXid(
            simbad_oid=1, simbad_main_id="* tst", gaia_source_id=gaia, hip=hip,
        )

    def _audit_with_xids(self, rows, src_to_astrometry, simbad_xids):
        pairs, comps = _bi_system(rows)
        idx = _bi_indices(src_to_astrometry)
        return audit_binding_integrity(
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
        v = [x for x in verdicts if x.shape == BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].verdict, BINDING_VERDICT_IDENTITY_REFUTED)
        self.assertEqual(v[0].winner.label, "B")
        self.assertEqual(v[0].rebind_letter, "A")
        self.assertEqual(v[0].rebind_source, SA)
        self.assertEqual(
            [x for x in verdicts
             if x.shape == BINDING_SHAPE_LETTER_SOURCES], [],
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
        v = [x for x in verdicts if x.shape == BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].verdict, BINDING_VERDICT_IDENTITY_REFUTED)
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
        v = [x for x in verdicts if x.shape == BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(
            v[0].verdict, BINDING_VERDICT_SKIPPED_PHOTOCENTRE_BLEND,
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
        v = [x for x in verdicts if x.shape == BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(
            v[0].verdict, BINDING_VERDICT_SKIPPED_PHOTOCENTRE_BLEND,
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
        verdicts = audit_binding_integrity(
            pairs, comps, idx, apply=False, simbad_xids=xids,
        )
        v = [x for x in verdicts if x.shape == BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].verdict, BINDING_VERDICT_IDENTITY_REFUTED)
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
        v = [x for x in verdicts if x.shape == BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].verdict, BINDING_VERDICT_UNBOUND_AMBIGUOUS)

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
        v = [x for x in verdicts if x.shape == BINDING_SHAPE_SOURCE_LETTERS]
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].verdict, BINDING_VERDICT_GEOMETRIC)
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
            x.verdict == BINDING_VERDICT_SKIPPED_NO_REFERENCE
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
        audit_binding_integrity(pairs, comps, idx, apply=True)
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
        audit_binding_integrity(pairs, comps, idx, apply=True)
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
        n = inherit_downward_parent_bindings(pairs, comps)
        self.assertEqual(n, 2)  # Aa and Ab both inherit A's binding
        aa = next(c for c in comps if c.component == "Aa")
        ab = next(c for c in comps if c.component == "Ab")
        self.assertEqual(aa.gaia_source_id, SA)
        self.assertEqual(ab.gaia_source_id, SA)

    def test_counts_aggregate(self) -> None:
        v_geo = BindingVerdict(
            "w", BINDING_SHAPE_SOURCE_LETTERS,
            BINDING_VERDICT_GEOMETRIC, "c", None, None, None, [],
        )
        v_amb = BindingVerdict(
            "w", BINDING_SHAPE_SOURCE_LETTERS,
            BINDING_VERDICT_UNBOUND_AMBIGUOUS, "c", None, None, None, [],
        )
        v_skip = BindingVerdict(
            "w", BINDING_SHAPE_LETTER_SOURCES,
            BINDING_VERDICT_SKIPPED_NO_REFERENCE, "c", None, None, None, [],
        )
        v_blend = BindingVerdict(
            "w", BINDING_SHAPE_SOURCE_LETTERS,
            BINDING_VERDICT_SKIPPED_PHOTOCENTRE_BLEND,
            "c", None, None, None, [],
        )
        counts = binding_integrity_counts([v_geo, v_amb, v_skip, v_blend])
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
        audit_binding_integrity(pairs, comps, idx, apply=False)
        after = [(c.gaia_source_id, c.hip, c.resolve_via) for c in comps]
        self.assertEqual(before, after)

    def test_bfs_composes_multi_hop(self) -> None:
        adj = {
            "A": {"B": (5.0, 0.0, 2016.0)},
            "B": {"A": (-5.0, 0.0, 2016.0), "C": (5.0, 0.0, 2015.0)},
            "C": {"B": (-5.0, 0.0, 2015.0)},
        }
        e, n, epoch = _bfs_offset(adj, "A", "C")
        self.assertAlmostEqual(e, 10.0)
        self.assertAlmostEqual(n, 0.0)
        self.assertEqual(epoch, 2015.0)
        self.assertIsNone(_bfs_offset({"A": {}}, "A", "Z"))

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
            n = write_binding_verdicts_tsv(verdicts, out)
            lines = out.read_text().splitlines()
        self.assertEqual(n, len(verdicts))
        self.assertEqual(
            lines[0].split("\t"), list(BINDING_VERDICT_TSV_COLUMNS),
        )
        self.assertEqual(len(lines), len(verdicts) + 1)


if __name__ == "__main__":
    unittest.main()
