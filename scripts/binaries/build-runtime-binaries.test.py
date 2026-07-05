#!/usr/bin/env python3
"""Unit tests for build-runtime-binaries.py pure helpers + writer."""

from __future__ import annotations

import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_helpers import load_kebab_sibling  # noqa: E402

brb = load_kebab_sibling(
    __file__, "build_runtime_binaries", "build-runtime-binaries.py",
)


def _pair(
    system_id: str = "00000+0000-AB",
    *,
    components: str | None = None,
    primary_comp: str | None = None,
    secondary_comp: str | None = None,
    primary_gaia: str | None = "1",
    primary_hip: int | None = None,
    secondary_gaia: str | None = "2",
    secondary_hip: int | None = None,
    P_days: float | None = None,
    T_jd: float | None = None,
    e: float | None = None,
    a_AU: float | None = None,
    i_rad: float | None = None,
    omega_rad: float | None = None,
    Omega_rad: float | None = None,
    q: float | None = None,
    sep_arcsec: float | None = None,
    pa_deg: float | None = None,
    sep_pa_epoch_jd: float | None = None,
) -> brb.MultiplesPair:
    """Build a MultiplesPair with sensible defaults. Test cases override
    only the fields they care about."""
    if components is None:
        dash = system_id.rfind("-")
        components = system_id[dash + 1:] if dash >= 0 else "AB"
    wds_id = system_id[:system_id.rfind("-")] if "-" in system_id else system_id
    # Default per-side comp letters from the components string: "AB" →
    # ("A", "B"); "Aa,Ab" → ("Aa", "Ab"). Tests override when they're
    # exercising the WDS prefix-truncation case ("Aa1,2" with
    # secondary_comp="2").
    if "," in components:
        parts = components.split(",")
        default_primary, default_secondary = parts[0], parts[1] if len(parts) > 1 else ""
    elif len(components) == 2:
        default_primary, default_secondary = components[0], components[1]
    else:
        default_primary, default_secondary = components, ""
    return brb.MultiplesPair(
        system_id=system_id, wds_id=wds_id, components=components,
        primary_comp=primary_comp if primary_comp is not None else default_primary,
        secondary_comp=secondary_comp if secondary_comp is not None else default_secondary,
        primary_gaia=primary_gaia, primary_hip=primary_hip,
        secondary_gaia=secondary_gaia, secondary_hip=secondary_hip,
        P_days=P_days, T_jd=T_jd, e=e, a_AU=a_AU,
        i_rad=i_rad, omega_rad=omega_rad, Omega_rad=Omega_rad,
        q=q,
        sep_arcsec=sep_arcsec, pa_deg=pa_deg, sep_pa_epoch_jd=sep_pa_epoch_jd,
    )


class SplitComponentsTests(unittest.TestCase):
    """``_split_components`` parses WDS component strings into
    (primary_token, secondary_token) tuples — the bedrock for
    hierarchical-chain detection."""

    def test_two_letter_pair(self) -> None:
        self.assertEqual(brb._split_components("AB"), ("A", "B"))

    def test_two_letter_comma(self) -> None:
        self.assertEqual(brb._split_components("Aa,Ab"), ("Aa", "Ab"))

    def test_wds_prefix_truncation_inherits_primary_stem(self) -> None:
        # "Aa1,2" is WDS shorthand for "Aa1,Aa2"; secondary re-anchors
        # to primary's stem when it parses as a bare digit.
        self.assertEqual(brb._split_components("Aa1,2"), ("Aa1", "Aa2"))

    def test_three_part_comma_returns_none(self) -> None:
        self.assertIsNone(brb._split_components("A,B,C"))

    def test_non_alpha_two_char_returns_none(self) -> None:
        self.assertIsNone(brb._split_components("A1"))

    def test_three_letter_no_comma_returns_none(self) -> None:
        self.assertIsNone(brb._split_components("ABC"))


class ParentTokenTests(unittest.TestCase):
    """``_parent_token`` drops the rightmost designator: ``"Aa1" → "Aa"``,
    ``"Aa" → "A"``, ``"A" → None``."""

    def test_three_char_drops_to_two(self) -> None:
        self.assertEqual(brb._parent_token("Aa1"), "Aa")

    def test_two_char_drops_to_one(self) -> None:
        self.assertEqual(brb._parent_token("Aa"), "A")

    def test_one_char_returns_none(self) -> None:
        self.assertIsNone(brb._parent_token("A"))

    def test_empty_returns_none(self) -> None:
        self.assertIsNone(brb._parent_token(""))


class AssignParentRelationsTests(unittest.TestCase):
    """``assign_parent_relations`` links inner WDS pairs to their outer
    pair. Algol's Aa1,Aa2 inner-pair sits inside Aa,Ab outer-pair → the
    inner pair's parent token "Aa" matches the outer's primary letter."""

    def test_top_level_pair_has_no_parent(self) -> None:
        pairs = [_pair(system_id="00000+0000-AB")]
        self.assertEqual(brb.assign_parent_relations(pairs), [brb.NO_PARENT])

    def test_algol_shape_inner_pair_finds_outer(self) -> None:
        # Outer "Aa,Ab" at idx 0, inner "Aa1,Aa2" at idx 1 → inner's
        # parent token "Aa" matches the outer's primary letter "Aa".
        outer = _pair(system_id="03082+4057-Aa,Ab")
        inner = _pair(system_id="03082+4057-Aa1,Aa2")
        self.assertEqual(
            brb.assign_parent_relations([outer, inner]),
            [brb.NO_PARENT, 0],
        )

    def test_two_independent_systems_get_no_parents(self) -> None:
        # Different wds_id buckets — siblings in different systems are
        # not parents of each other, no matter the letter overlap.
        p1 = _pair(system_id="00000+0000-AB")
        p2 = _pair(system_id="11111+1111-AB")
        self.assertEqual(
            brb.assign_parent_relations([p1, p2]),
            [brb.NO_PARENT, brb.NO_PARENT],
        )

    def test_unrecognised_component_string_skips_assignment(self) -> None:
        pair = _pair(system_id="00000+0000-X", components="X")
        self.assertEqual(brb.assign_parent_relations([pair]), [brb.NO_PARENT])

    def test_self_referential_match_yields_no_parent(self) -> None:
        # Outer with a single-pair system where the parent_token lookup
        # would return its own index (rare but the guard exists).
        # "AB" → parent_token of "A" is None, so the guard isn't needed
        # here; this test confirms the no-op path stays at NO_PARENT.
        p = _pair(system_id="00000+0000-AB")
        self.assertEqual(brb.assign_parent_relations([p]), [brb.NO_PARENT])

    def test_prefers_bound_parent_over_element_less_wide_pair(self) -> None:
        # Castor shape: component A is a member of both the bound AB pair
        # (has orbit) and the element-less wide AC pair. The inner Aa,Ab
        # must nest under AB — the pair whose orbit its shared slot rides —
        # not the wide AC that never perturbs it. Input order deliberately
        # puts AC last so a last-write-wins bucket would pick it.
        ab = _pair(
            system_id="07346+3153-AB",
            P_days=167686.0, T_jd=2436785.0, e=0.34, a_AU=104.8,
            omega_rad=4.4, q=0.5, sep_arcsec=5.4,
        )
        aa_ab = _pair(
            system_id="07346+3153-Aa,Ab",
            P_days=9.21, T_jd=2455817.0, e=0.49, a_AU=0.125,
            omega_rad=0.61, q=0.17, sep_arcsec=0.0,
        )
        ac = _pair(system_id="07346+3153-AC", sep_arcsec=69.6)  # no orbit
        parents = brb.assign_parent_relations([ab, aa_ab, ac])
        self.assertEqual(parents, [brb.NO_PARENT, 0, brb.NO_PARENT])


class OverrideInnerPrimaryIndicesTests(unittest.TestCase):
    """``override_inner_primary_indices`` re-homes an inner pair's primary
    onto its parent component's catalog slot — the shared-slot invariant
    the runtime hierarchical walk depends on."""

    def test_gaia_blended_secondary_inner_primary_rehomed(self) -> None:
        # Castor Ba,Bb: A and B share one (blended) Gaia source, so Ba's
        # id-first resolve lands on A's row (98630) instead of B's synth
        # row (179304). AB already resolved B correctly (secondary-collapse
        # retry), so the inner primary re-homes onto AB's secondary slot.
        ab = _pair(system_id="07346+3153-AB")           # A, B
        ba_bb = _pair(system_id="07346+3153-Ba,Bb")     # Ba, Bb
        parents = [brb.NO_PARENT, 0]
        walk_order = [0, 1]
        resolved_primary = [98630, 98630]     # Ba mis-resolved to A's slot
        resolved_secondary = [179304, 321187]  # AB's B → synth; Bb → synth
        brb.override_inner_primary_indices(
            [ab, ba_bb], parents, walk_order,
            resolved_primary, resolved_secondary,
        )
        self.assertEqual(resolved_primary, [98630, 179304])

    def test_correctly_resolved_inner_primary_unchanged(self) -> None:
        # Aa,Ab: Aa already shares A's slot (parent's PRIMARY member), so
        # the override is a no-op — it reasserts the same slot.
        ab = _pair(system_id="07346+3153-AB")
        aa_ab = _pair(system_id="07346+3153-Aa,Ab")
        resolved_primary = [98630, 98630]
        resolved_secondary = [179304, 319645]
        brb.override_inner_primary_indices(
            [ab, aa_ab], [brb.NO_PARENT, 0], [0, 1],
            resolved_primary, resolved_secondary,
        )
        self.assertEqual(resolved_primary, [98630, 98630])

    def test_top_level_pairs_untouched(self) -> None:
        ab = _pair(system_id="07346+3153-AB")
        resolved_primary = [98630]
        brb.override_inner_primary_indices(
            [ab], [brb.NO_PARENT], [0], resolved_primary, [179304],
        )
        self.assertEqual(resolved_primary, [98630])

    def test_deep_nest_inherits_parents_corrected_slot(self) -> None:
        # 3-level: Ba1,Ba2 inside Ba,Bb inside AB. Topological order means
        # Ba,Bb's primary is corrected to B's slot FIRST, then Ba1,Ba2
        # inherits that corrected slot as its own primary.
        ab = _pair(system_id="07346+3153-AB")            # A, B
        ba_bb = _pair(system_id="07346+3153-Ba,Bb")      # Ba, Bb
        ba1_ba2 = _pair(system_id="07346+3153-Ba1,Ba2")  # Ba1, Ba2
        parents = [brb.NO_PARENT, 0, 1]
        walk_order = [0, 1, 2]
        resolved_primary = [98630, 98630, 98630]  # both inner mis-resolved to A
        resolved_secondary = [179304, 321187, 400000]
        brb.override_inner_primary_indices(
            [ab, ba_bb, ba1_ba2], parents, walk_order,
            resolved_primary, resolved_secondary,
        )
        # Ba,Bb → B's slot (179304); Ba1,Ba2 → Ba,Bb's now-primary (179304).
        self.assertEqual(resolved_primary, [98630, 179304, 179304])


class TopologicalWalkOrderTests(unittest.TestCase):
    """``topological_walk_order`` emits parents before children in a
    single forward pass."""

    def test_roots_only_preserves_input_order(self) -> None:
        self.assertEqual(
            brb.topological_walk_order([brb.NO_PARENT, brb.NO_PARENT, brb.NO_PARENT]),
            [0, 1, 2],
        )

    def test_simple_parent_child_chain(self) -> None:
        # idx 0 is root, idx 1's parent is 0 → walk emits 0, then 1.
        self.assertEqual(brb.topological_walk_order([brb.NO_PARENT, 0]), [0, 1])

    def test_parent_in_input_after_child_still_emits_parent_first(self) -> None:
        # idx 0's parent is idx 1 (parent comes AFTER child in input).
        # The walk visits the root (idx 1) first, then traverses to its
        # children (idx 0).
        self.assertEqual(brb.topological_walk_order([1, brb.NO_PARENT]), [1, 0])

    def test_broken_parent_link_falls_through_as_orphan(self) -> None:
        # idx 0's parent is idx 5 (out of range / dangling). The first
        # for-loop misses it; the orphan sweep picks it up at the end.
        # We model a 2-pair list where idx 1 references missing parent 5.
        self.assertEqual(
            brb.topological_walk_order([brb.NO_PARENT, 5]),
            [0, 1],
        )

    def test_multi_level_chain_outer_to_inner(self) -> None:
        # idx 0 root, idx 1 → 0, idx 2 → 1.
        self.assertEqual(brb.topological_walk_order([brb.NO_PARENT, 0, 1]), [0, 1, 2])


class CanonicalCompPairTests(unittest.TestCase):
    """``_canonical_comp_pair`` re-anchors WDS prefix-truncated
    secondary cells (bare digits) onto the primary's stem so the
    catalog and runtime synth keys agree on the canonical form."""

    def test_wds_truncation_re_anchored(self) -> None:
        # "Aa1,2" → ("Aa1", "Aa2") — the bare digit picks up the
        # primary's "Aa" stem.
        self.assertEqual(brb._canonical_comp_pair("Aa1", "2"), ("Aa1", "Aa2"))

    def test_non_digit_secondary_passes_through(self) -> None:
        self.assertEqual(brb._canonical_comp_pair("A", "B"), ("A", "B"))
        self.assertEqual(brb._canonical_comp_pair("Aa", "Ab"), ("Aa", "Ab"))

    def test_primary_without_trailing_digit_passes_through(self) -> None:
        # "AB,2" wouldn't happen in WDS, but defensively leave alone.
        self.assertEqual(brb._canonical_comp_pair("AB", "2"), ("AB", "2"))

    def test_one_char_primary_passes_through(self) -> None:
        # Bare "A,2" — primary is too short to extract a stem.
        self.assertEqual(brb._canonical_comp_pair("A", "2"), ("A", "2"))

    def test_whitespace_trimmed(self) -> None:
        self.assertEqual(brb._canonical_comp_pair(" Aa1 ", " 2 "), ("Aa1", "Aa2"))


class SyntheticIdTests(unittest.TestCase):
    """``synthetic_id`` composes the build-time fallback key for rows
    whose own gaia/hip don't address the catalog record."""

    def test_canonical_shape(self) -> None:
        self.assertEqual(
            brb.synthetic_id("03082+4057", "Ab"),
            "synth-03082+4057-Ab",
        )

    def test_negative_dec_preserved(self) -> None:
        self.assertEqual(
            brb.synthetic_id("16120-1928", "Aa2"),
            "synth-16120-1928-Aa2",
        )

    def test_empty_comp_returns_none(self) -> None:
        self.assertIsNone(brb.synthetic_id("03082+4057", ""))
        self.assertIsNone(brb.synthetic_id("03082+4057", "   "))

    def test_empty_wds_id_returns_none(self) -> None:
        self.assertIsNone(brb.synthetic_id("", "Ab"))


class ResolveIdxTests(unittest.TestCase):
    """``resolve_idx`` walks gaia → hip → synth in priority order."""

    def _row_map(self) -> brb.RowIndexMap:
        return brb.RowIndexMap(
            by_gaia={"1": 100, "2": 200},
            by_hip={14576: 300},
            by_synth={"synth-03082+4057-Ab": 400},
        )

    def test_gaia_beats_hip(self) -> None:
        m = self._row_map()
        # Gaia present and resolvable — HIP path not consulted.
        self.assertEqual(brb.resolve_idx("1", 999, None, m), 100)

    def test_hip_fallback_when_gaia_none(self) -> None:
        m = self._row_map()
        self.assertEqual(brb.resolve_idx(None, 14576, None, m), 300)

    def test_synth_fallback_when_gaia_and_hip_miss(self) -> None:
        m = self._row_map()
        self.assertEqual(
            brb.resolve_idx(None, None, "synth-03082+4057-Ab", m),
            400,
        )

    def test_synth_not_consulted_when_gaia_resolves(self) -> None:
        m = self._row_map()
        # Even with a valid synth key, a resolvable gaia wins.
        self.assertEqual(
            brb.resolve_idx("1", None, "synth-03082+4057-Ab", m),
            100,
        )

    def test_unknown_synth_key_returns_none(self) -> None:
        m = self._row_map()
        self.assertIsNone(
            brb.resolve_idx(None, None, "synth-99999+9999-Z", m),
        )

    def test_all_inputs_none_returns_none(self) -> None:
        m = self._row_map()
        self.assertIsNone(brb.resolve_idx(None, None, None, m))


class WriteBinaryTests(unittest.TestCase):
    """``write_binary`` resolves catalog indices, remaps parent_relation
    from input to output indices, and writes the wire format."""

    def _row_map(self) -> brb.RowIndexMap:
        return brb.RowIndexMap(
            by_gaia={"1": 100, "2": 200, "3": 300, "4": 400},
            by_hip={},
            by_synth={},
        )

    def test_header_magic_version_count(self) -> None:
        pairs = [_pair()]
        parents = [brb.NO_PARENT]
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "binaries.bin"
            brb.write_binary(pairs, parents, [0], self._row_map(), out)
            data = out.read_bytes()
        self.assertEqual(data[:4], brb.MAGIC)
        version, count = struct.unpack("<II", data[4:12])
        self.assertEqual(version, brb.VERSION)
        self.assertEqual(count, 1)
        self.assertEqual(len(data), brb.HEADER_SIZE + brb.RECORD_SIZE)

    def test_pair_with_unresolved_primary_is_dropped(self) -> None:
        pairs = [_pair(primary_gaia="999", secondary_gaia="2")]
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "binaries.bin"
            stats = brb.write_binary(
                pairs, [brb.NO_PARENT], [0], self._row_map(), out,
            )
        self.assertEqual(stats.pairs_emitted, 0)
        self.assertEqual(stats.pairs_dropped_primary_unresolved, 1)
        self.assertEqual(stats.pairs_dropped_secondary_unresolved, 0)

    def test_pair_with_unresolved_secondary_is_dropped(self) -> None:
        pairs = [_pair(primary_gaia="1", secondary_gaia="999")]
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "binaries.bin"
            stats = brb.write_binary(
                pairs, [brb.NO_PARENT], [0], self._row_map(), out,
            )
        self.assertEqual(stats.pairs_emitted, 0)
        self.assertEqual(stats.pairs_dropped_secondary_unresolved, 1)

    def test_pair_with_degenerate_indices_is_dropped(self) -> None:
        # Castor shape: both components carry the SAME gaia/hip cross-walk,
        # so `resolve_idx` returns the same catalog row for primary AND
        # secondary. The runtime can't address two pair ends through one
        # slot — drop the pair.
        pairs = [_pair(primary_gaia="1", secondary_gaia="1")]
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "binaries.bin"
            stats = brb.write_binary(
                pairs, [brb.NO_PARENT], [0], self._row_map(), out,
            )
        self.assertEqual(stats.pairs_emitted, 0)
        self.assertEqual(stats.pairs_dropped_degenerate_idx, 1)
        self.assertEqual(stats.pairs_dropped_primary_unresolved, 0)
        self.assertEqual(stats.pairs_dropped_secondary_unresolved, 0)

    def test_pair_with_degenerate_indices_via_shared_hip_is_dropped(self) -> None:
        # Variant of the Castor shape: secondary has no gaia but shares
        # the primary's HIP. `resolve_idx` falls through to HIP and
        # lands on the same catalog row.
        row_map = brb.RowIndexMap(by_gaia={}, by_hip={36850: 100}, by_synth={})
        pairs = [_pair(
            primary_gaia=None, primary_hip=36850,
            secondary_gaia=None, secondary_hip=36850,
        )]
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "binaries.bin"
            stats = brb.write_binary(
                pairs, [brb.NO_PARENT], [0], row_map, out,
            )
        self.assertEqual(stats.pairs_emitted, 0)
        self.assertEqual(stats.pairs_dropped_degenerate_idx, 1)

    def test_shared_gaia_secondary_retries_synth_before_degenerate(self) -> None:
        # Shared-photocentre shape: Gaia binds the blended source_id
        # to BOTH component rows; companion promotion strips the
        # inherited id and mints a synth record. The resolver must land
        # the secondary on that synth row instead of dropping the pair
        # as degenerate.
        row_map = brb.RowIndexMap(
            by_gaia={"1": 100},
            by_hip={},
            by_synth={"synth-00000+0000-B": 555},
        )
        pairs = [_pair(primary_gaia="1", secondary_gaia="1")]
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "binaries.bin"
            stats = brb.write_binary(
                pairs, [brb.NO_PARENT], [0], row_map, out,
            )
        self.assertEqual(stats.pairs_emitted, 1)
        self.assertEqual(stats.pairs_dropped_degenerate_idx, 0)

    def test_shared_hip_secondary_retries_synth_before_degenerate(self) -> None:
        row_map = brb.RowIndexMap(
            by_gaia={},
            by_hip={36850: 100},
            by_synth={"synth-00000+0000-B": 556},
        )
        pairs = [_pair(
            primary_gaia=None, primary_hip=36850,
            secondary_gaia=None, secondary_hip=36850,
        )]
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "binaries.bin"
            stats = brb.write_binary(
                pairs, [brb.NO_PARENT], [0], row_map, out,
            )
        self.assertEqual(stats.pairs_emitted, 1)
        self.assertEqual(stats.pairs_dropped_degenerate_idx, 0)

    def test_blended_wide_pair_primary_rehomed_to_own_synth(self) -> None:
        # Castor BC shape: the wide pair's PRIMARY (B) carries the system's
        # blended Gaia source, so its id-first resolve lands on the anchor A
        # (row 100). B has its own synth slot from promotion; the primary
        # retry re-homes it there (row 179) so the pair emits B→C, not a
        # second A→C.
        row_map = brb.RowIndexMap(
            by_gaia={"1": 100, "2": 320},
            by_hip={},
            by_synth={"synth-00000+0000-B": 179},
        )
        pairs = [_pair(
            system_id="00000+0000-BC", primary_comp="B", secondary_comp="C",
            primary_gaia="1", secondary_gaia="2",
        )]
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "binaries.bin"
            stats = brb.write_binary(
                pairs, [brb.NO_PARENT], [0], row_map, out,
            )
            data = out.read_bytes()
        self.assertEqual(stats.pairs_emitted, 1)
        pri, sec = struct.unpack(
            "<II", data[brb.HEADER_SIZE:brb.HEADER_SIZE + 8],
        )
        self.assertEqual(pri, 179)   # re-homed onto B's synth slot
        self.assertEqual(sec, 320)

    def test_no_rehome_when_synth_matches_id_first_resolve(self) -> None:
        # A correctly-resolved primary (its gaia lands on its OWN row, which
        # also happens to have a synth alias) must not be perturbed.
        row_map = brb.RowIndexMap(
            by_gaia={"1": 179, "2": 320},
            by_hip={},
            by_synth={"synth-00000+0000-B": 179},
        )
        pairs = [_pair(
            system_id="00000+0000-BC", primary_comp="B", secondary_comp="C",
            primary_gaia="1", secondary_gaia="2",
        )]
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "binaries.bin"
            brb.write_binary(pairs, [brb.NO_PARENT], [0], row_map, out)
            data = out.read_bytes()
        pri, _ = struct.unpack("<II", data[brb.HEADER_SIZE:brb.HEADER_SIZE + 8])
        self.assertEqual(pri, 179)

    def test_duplicate_relation_dropped(self) -> None:
        # Two pairs resolve to the same (primary, secondary) catalog rows —
        # a blended primary the synth re-home could not reach (no synth slot)
        # re-emits an existing anchor→C. The first wins; the exact duplicate
        # is dropped so C is not listed twice on the anchor's card.
        row_map = brb.RowIndexMap(
            by_gaia={"1": 100, "2": 320}, by_hip={}, by_synth={},
        )
        pairs = [
            _pair(system_id="00000+0000-AC", primary_comp="A",
                  secondary_comp="C", primary_gaia="1", secondary_gaia="2"),
            _pair(system_id="00000+0000-BC", primary_comp="B",
                  secondary_comp="C", primary_gaia="1", secondary_gaia="2"),
        ]
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "binaries.bin"
            stats = brb.write_binary(
                pairs, [brb.NO_PARENT, brb.NO_PARENT], [0, 1], row_map, out,
            )
        self.assertEqual(stats.pairs_emitted, 1)
        self.assertEqual(stats.pairs_dropped_duplicate_relation, 1)

    def test_duplicate_relation_keeps_orbit_bearing_member(self) -> None:
        # Two pairs collapse to the same (primary, secondary) rows: the wide
        # AC pair (walk-first, element-less) and the BC pair carrying the real
        # orbit (B blends onto anchor A). The dedup must keep the orbit-bearing
        # member so the relation still animates, not the element-less first.
        row_map = brb.RowIndexMap(
            by_gaia={"1": 100, "2": 320}, by_hip={}, by_synth={},
        )
        orbit = dict(
            P_days=4000.0, T_jd=2451545.0, e=0.1, a_AU=5.0,
            omega_rad=1.0, q=0.5,
        )
        pairs = [
            _pair(system_id="00000+0000-AC", primary_comp="A",
                  secondary_comp="C", primary_gaia="1", secondary_gaia="2"),
            _pair(system_id="00000+0000-BC", primary_comp="B",
                  secondary_comp="C", primary_gaia="1", secondary_gaia="2",
                  **orbit),
        ]
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "binaries.bin"
            stats = brb.write_binary(
                pairs, [brb.NO_PARENT, brb.NO_PARENT], [0, 1], row_map, out,
            )
            data = out.read_bytes()
        self.assertEqual(stats.pairs_emitted, 1)
        self.assertEqual(stats.pairs_dropped_duplicate_relation, 1)
        self.assertEqual(stats.pairs_with_orbit, 1)
        flags = struct.unpack_from(
            "<I", data, brb.HEADER_SIZE + brb.RECORD_LAYOUT["flags"],
        )[0]
        self.assertTrue(flags & brb.FLAG_HAS_ORBIT)

    def test_parent_relation_remaps_from_input_to_output_index(self) -> None:
        # Three input pairs: idx 0 root, idx 1 child of 0, idx 2 child
        # of 1. All three resolve. Walk order is [0, 1, 2], output
        # indices match the walk order, parent_relations get remapped
        # exactly.
        # Distinct (primary, secondary) per pair so the duplicate-relation
        # dedup leaves all three; this test exercises parent remapping only.
        pairs = [
            _pair(system_id="A-AB", primary_gaia="1", secondary_gaia="2"),
            _pair(system_id="A-CD", primary_gaia="3", secondary_gaia="4"),
            _pair(system_id="A-EF", primary_gaia="4", secondary_gaia="3"),
        ]
        parents = [brb.NO_PARENT, 0, 1]
        walk = [0, 1, 2]
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "binaries.bin"
            brb.write_binary(pairs, parents, walk, self._row_map(), out)
            data = out.read_bytes()
        # Pull parent_relation int32 from each of the three records.
        layout = brb.RECORD_LAYOUT
        parents_on_wire = []
        for i in range(3):
            off = brb.HEADER_SIZE + i * brb.RECORD_SIZE
            (pr,) = struct.unpack(
                "<i",
                data[off + layout["parent_relation"]: off + layout["parent_relation"] + 4],
            )
            parents_on_wire.append(pr)
        self.assertEqual(parents_on_wire, [brb.NO_PARENT, 0, 1])

    def test_parent_relation_when_parent_dropped_becomes_no_parent(self) -> None:
        # idx 0 has unresolvable secondary → dropped. idx 1 is its
        # child. After idx 0 is skipped, idx 1's parent_output should
        # resolve to NO_PARENT (parent not in input_to_output map).
        pairs = [
            _pair(primary_gaia="1", secondary_gaia="999"),  # dropped
            _pair(primary_gaia="2", secondary_gaia="3"),    # parent=0
        ]
        parents = [brb.NO_PARENT, 0]
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "binaries.bin"
            stats = brb.write_binary(pairs, parents, [0, 1], self._row_map(), out)
            data = out.read_bytes()
        self.assertEqual(stats.pairs_emitted, 1)
        layout = brb.RECORD_LAYOUT
        off = brb.HEADER_SIZE
        (pr,) = struct.unpack(
            "<i",
            data[off + layout["parent_relation"]: off + layout["parent_relation"] + 4],
        )
        self.assertEqual(pr, brb.NO_PARENT)
        # Also: is_inner_of_hierarchy flag must NOT be set when the
        # parent was dropped — otherwise the child claims to be inner
        # without a valid parent_relation pointer.
        (flags,) = struct.unpack(
            "<I",
            data[off + layout["flags"]: off + layout["flags"] + 4],
        )
        self.assertEqual(flags & brb.FLAG_IS_INNER_OF_HIERARCHY, 0)

    def test_has_orbit_flag_set_when_kepler_elements_present(self) -> None:
        pairs = [_pair(
            P_days=365.25, T_jd=2451545.0,
            e=0.5, a_AU=10.0, omega_rad=1.0, q=0.5,
        )]
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "binaries.bin"
            brb.write_binary(pairs, [brb.NO_PARENT], [0], self._row_map(), out)
            data = out.read_bytes()
        off = brb.HEADER_SIZE
        (flags,) = struct.unpack(
            "<I",
            data[off + brb.RECORD_LAYOUT["flags"]:
                 off + brb.RECORD_LAYOUT["flags"] + 4],
        )
        self.assertTrue(flags & brb.FLAG_HAS_ORBIT)
        self.assertFalse(flags & brb.FLAG_HAS_INCLINATION)

    def test_has_orbit_requires_all_kepler_elements(self) -> None:
        # P + T alone is not enough — q, a, e, omega all gate has_orbit
        # because the runtime BinaryOrbitField hits NaN for missing
        # elements and writes NaN into localPositions[primaryIdx],
        # poisoning every downstream consumer (chart-mode constellation
        # centroids, focus ring, distance vector).
        for missing in ("e", "a_AU", "omega_rad", "q"):
            kwargs = {
                "P_days": 365.25, "T_jd": 2451545.0,
                "e": 0.5, "a_AU": 10.0, "omega_rad": 1.0, "q": 0.5,
            }
            kwargs[missing] = None
            pairs = [_pair(**kwargs)]
            with tempfile.TemporaryDirectory() as td:
                out = Path(td) / "binaries.bin"
                brb.write_binary(pairs, [brb.NO_PARENT], [0], self._row_map(), out)
                data = out.read_bytes()
            off = brb.HEADER_SIZE
            (flags,) = struct.unpack(
                "<I",
                data[off + brb.RECORD_LAYOUT["flags"]:
                     off + brb.RECORD_LAYOUT["flags"] + 4],
            )
            self.assertFalse(
                flags & brb.FLAG_HAS_ORBIT,
                f"has_orbit must be unset when {missing} is missing",
            )

    def test_has_orbit_set_with_full_element_set_minus_inclination(self) -> None:
        # Tier 2 path: P + T + e + a + omega + q present, i_rad absent.
        # has_orbit=1, has_inclination=0.
        pairs = [_pair(
            P_days=365.25, T_jd=2451545.0,
            e=0.5, a_AU=10.0, omega_rad=1.0, q=0.5,
            i_rad=None,
        )]
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "binaries.bin"
            brb.write_binary(pairs, [brb.NO_PARENT], [0], self._row_map(), out)
            data = out.read_bytes()
        off = brb.HEADER_SIZE
        (flags,) = struct.unpack(
            "<I",
            data[off + brb.RECORD_LAYOUT["flags"]:
                 off + brb.RECORD_LAYOUT["flags"] + 4],
        )
        self.assertTrue(flags & brb.FLAG_HAS_ORBIT)
        self.assertFalse(flags & brb.FLAG_HAS_INCLINATION)

    def test_has_inclination_flag_requires_both_orbit_and_inclination(self) -> None:
        # i_rad without P/T should NOT set FLAG_HAS_INCLINATION — the
        # has_inclination predicate is a strict AND.
        pairs = [_pair(P_days=None, T_jd=None, i_rad=1.0)]
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "binaries.bin"
            brb.write_binary(pairs, [brb.NO_PARENT], [0], self._row_map(), out)
            data = out.read_bytes()
        off = brb.HEADER_SIZE
        (flags,) = struct.unpack(
            "<I",
            data[off + brb.RECORD_LAYOUT["flags"]:
                 off + brb.RECORD_LAYOUT["flags"] + 4],
        )
        self.assertFalse(flags & brb.FLAG_HAS_ORBIT)
        self.assertFalse(flags & brb.FLAG_HAS_INCLINATION)

    def test_wds_truncation_secondary_resolves_via_canonical_comp(self) -> None:
        # Algol Aa1,2 (WDS shorthand for Aa1,Aa2): multiples.tsv emits
        # the secondary row with comp="2"; load_pairs canonicalises it to
        # "Aa2" before constructing the MultiplesPair, and companion-
        # promotion mints synth-03082+4057-Aa2 from the same canonical
        # form. The resolver must look up the canonical key, not the
        # raw "2".
        m = brb.RowIndexMap(
            by_gaia={},
            by_hip={14576: 100},
            by_synth={"synth-03082+4057-Aa2": 200},
        )
        pairs = [_pair(
            system_id="03082+4057-Aa1,2",
            components="Aa1,2",
            primary_comp="Aa1",
            secondary_comp="Aa2",  # canonical form post-load_pairs
            primary_gaia=None, primary_hip=14576,
            secondary_gaia=None, secondary_hip=None,
        )]
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "binaries.bin"
            stats = brb.write_binary(pairs, [brb.NO_PARENT], [0], m, out)
        self.assertEqual(stats.pairs_emitted, 1)
        self.assertEqual(stats.pairs_dropped_secondary_unresolved, 0)

    def test_secondary_resolves_via_synthetic_id(self) -> None:
        # Algol Aa,Ab shape: pair has primary HIP 14576 (resolves via
        # by_hip) and secondary with no gaia/hip (resolves via
        # by_synth["synth-03082+4057-Ab"]). write_binary must compose
        # the secondary's synth key from wds_id + the secondary
        # component-letter and emit the pair.
        m = brb.RowIndexMap(
            by_gaia={},
            by_hip={14576: 100},
            by_synth={"synth-03082+4057-Ab": 200},
        )
        pairs = [_pair(
            system_id="03082+4057-Aa,Ab",
            components="Aa,Ab",
            primary_gaia=None, primary_hip=14576,
            secondary_gaia=None, secondary_hip=None,
        )]
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "binaries.bin"
            stats = brb.write_binary(pairs, [brb.NO_PARENT], [0], m, out)
            data = out.read_bytes()
        self.assertEqual(stats.pairs_emitted, 1)
        self.assertEqual(stats.pairs_dropped_secondary_unresolved, 0)
        off = brb.HEADER_SIZE
        (pri,) = struct.unpack(
            "<I",
            data[off + brb.RECORD_LAYOUT["primary_idx"]:
                 off + brb.RECORD_LAYOUT["primary_idx"] + 4],
        )
        (sec,) = struct.unpack(
            "<I",
            data[off + brb.RECORD_LAYOUT["secondary_idx"]:
                 off + brb.RECORD_LAYOUT["secondary_idx"] + 4],
        )
        self.assertEqual(pri, 100)
        self.assertEqual(sec, 200)

    def test_sep_pa_epoch_jd_stored_as_j2000_offset(self) -> None:
        # Wire format pins JD - J2000_JD as float32 to preserve sub-day
        # precision. JD 2459945.75 → offset 8400.75 days. Round-trip
        # through float32 is exact at that magnitude.
        pairs = [_pair(sep_pa_epoch_jd=2459945.75)]
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "binaries.bin"
            brb.write_binary(pairs, [brb.NO_PARENT], [0], self._row_map(), out)
            data = out.read_bytes()
        off = brb.HEADER_SIZE + brb.RECORD_LAYOUT["sep_pa_epoch_jd"]
        (wire,) = struct.unpack("<f", data[off: off + 4])
        # 8400.75 fits exactly in float32 (it's < 2^23 and a power-of-2
        # sub-bit of precision still available).
        self.assertAlmostEqual(wire, 8400.75, places=4)


if __name__ == "__main__":
    unittest.main()
