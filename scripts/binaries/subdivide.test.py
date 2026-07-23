#!/usr/bin/env python3
"""Stdlib-unittest pins for scripts/binaries/subdivide.py."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.binaries.msc_map import (  # noqa: E402
    MscLookup,
)
from scripts.binaries.parsers import (  # noqa: E402
    WdsPair,
    parse_orb6_component_overrides,
)
from scripts.binaries.stage2_resolve import (  # noqa: E402
    ResolvedComponent,
)
from scripts.binaries.stage3_astrometry import (  # noqa: E402
    ComponentAstrometry,
)
from scripts.binaries.subdivide import (  # noqa: E402
    SYNTH_MSC_DISCOVERER,
    SYNTH_NSS_DISCOVERER,
    apply_orb6_component_overrides,
    seed_synthesized_component_bindings,
    synthesize_msc_inner_pairs,
    synthesize_nss_inner_pairs,
    synthesize_orb6_orphan_pairs,
)
from scripts.binaries.pipeline_test_fixtures import (  # noqa: E402
    _athyg_row,
    _component_astrometry,
    _indices_with_astrometry,
    _msc_orbit,
    _nss_orbital_row,
    _orb6_visual,
    _orphan_orb6,
    _resolved,
    _wds_pair,
    _wds_pair_full,
    _write,
)


class Orb6ComponentOverridesTests(unittest.TestCase):
    def test_parse_and_apply(self) -> None:
        body = (
            "# preamble\n"
            "wds_id\tdiscoverer\tcomponents\tsource\n"
            "07346+3153\tYY Gem\tCa,Cb\tTorres & Ribas 2002\n"
        )
        with tempfile.TemporaryDirectory() as td:
            p = _write(Path(td), "overrides.tsv", body)
            overrides = parse_orb6_component_overrides(p)
        self.assertEqual(overrides[("07346+3153", "YY Gem")], "Ca,Cb")

        target = _orb6_visual(grade=7)
        target.wds_id = "07346+3153"
        target.discoverer = "YY Gem"
        target.components = ""
        untouched = _orb6_visual(grade=3)
        n = apply_orb6_component_overrides([target, untouched], overrides)
        self.assertEqual(n, 1)
        self.assertEqual(target.components, "Ca,Cb")
        self.assertEqual(untouched.components, "AB")


class SynthesizeOrb6OrphanPairsTests(unittest.TestCase):
    def test_synthesizes_missing_subpair(self) -> None:
        wds = [_wds_pair(wds_id="00490+1656", components="AB")]
        out = synthesize_orb6_orphan_pairs(wds, [_orphan_orb6()])
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
        self.assertEqual(synthesize_orb6_orphan_pairs(wds, entries), [])

    def test_dedups_multiple_fits_per_pair(self) -> None:
        entries = [
            _orphan_orb6(grade=9),
            _orphan_orb6(grade=8),
        ]
        out = synthesize_orb6_orphan_pairs([], entries)
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
        out = synthesize_orb6_orphan_pairs([donor], [entry])
        self.assertEqual(len(out), 1)
        p = out[0]
        self.assertEqual(p.rho_last, 0.3)
        self.assertEqual(p.mag_pri, 4.4)
        self.assertEqual(p.date_last, 2019)
        self.assertEqual(p.precise_ra_deg, 8.4)

    def test_wds_truncated_secondary_form_accepted(self) -> None:
        out = synthesize_orb6_orphan_pairs(
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
        n = seed_synthesized_component_bindings(components, [synth])
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
        seed_synthesized_component_bindings(
            [parent_a, child_a, child_b], [synth],
        )
        # Primary keeps its own ORB6-resolved source; the secondary
        # inherits the PAIR primary's binding (blended-photocentre
        # convention), not the parent token's.
        self.assertEqual(child_a.gaia_source_id, 555)
        self.assertEqual(child_b.gaia_source_id, 555)

    def test_non_synthesized_components_untouched(self) -> None:
        c = _resolved(gaia=None, wds_id="W1", component="B", is_primary=False)
        seed_synthesized_component_bindings(
            [_resolved(gaia=1, wds_id="W1", component="A"), c], [],
        )
        self.assertIsNone(c.gaia_source_id)


class SynthesizeNssInnerPairsTests(unittest.TestCase):
    def _run(
        self,
        pairs: "list[WdsPair]",
        components: "list[ResolvedComponent]",
        astrometry: "list[ComponentAstrometry]",
        src_to_nss: dict[int, dict[str, str]],
    ):
        idx = _indices_with_astrometry(src_to_nss=src_to_nss)
        return synthesize_nss_inner_pairs(
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
        self.assertEqual(p.discoverer, SYNTH_NSS_DISCOVERER)
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


class SynthesizeMscInnerPairsTests(unittest.TestCase):
    def _lookup(self, wds_id="10000+0000", tokens=("Aa", "Ab"), rows=None):
        lk = MscLookup()
        lk.orbits_by_pair[(wds_id, tokens)] = (
            rows if rows is not None else [_msc_orbit()]
        )
        return lk

    def test_synthesizes_anchored_missing_subpair(self) -> None:
        wds = [_wds_pair(wds_id="10000+0000", components="AB")]
        out, stats = synthesize_msc_inner_pairs(wds, self._lookup())
        self.assertEqual(len(out), 1)
        p = out[0]
        self.assertEqual((p.wds_id, p.components), ("10000+0000", "Aa,Ab"))
        self.assertEqual(p.discoverer, SYNTH_MSC_DISCOVERER)
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
            out, stats = synthesize_msc_inner_pairs(wds, lk)
            self.assertEqual(out, [], reason)
            self.assertEqual(stats[reason], 1, reason)

    def test_skips_when_child_token_already_exists(self) -> None:
        wds = [
            _wds_pair(wds_id="10000+0000", components="AB"),
            _wds_pair(wds_id="10000+0000", components="Aa,B"),
        ]
        out, stats = synthesize_msc_inner_pairs(wds, self._lookup())
        self.assertEqual(out, [])
        self.assertEqual(stats["skipped_children_exist"], 1)


if __name__ == "__main__":
    unittest.main()
