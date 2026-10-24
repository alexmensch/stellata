#!/usr/bin/env python3
"""Stdlib-unittest pins for scripts/binaries/anchor_offsets.py."""

from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.binaries.anchor_offsets import (  # noqa: E402
    SiblingEdge,
    add_sibling_edge,
    compute_anchor_offsets,
    photocentre_offsets,
)
from scripts.binaries.msc_map import MscLookup  # noqa: E402
from scripts.binaries.parsers import WdsPair  # noqa: E402
from scripts.binaries.stage2_resolve import (  # noqa: E402
    ResolvedComponent,
    split_components,
)
from scripts.binaries.stage5_optical import OpticalClassification  # noqa: E402
from scripts.binaries.pipeline_test_fixtures import (  # noqa: E402
    _resolved,
    _wds_pair,
)


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
        mags: tuple[float | None, float | None] = (4.0, 6.0),
    ) -> tuple["WdsPair", list["ResolvedComponent"]]:
        pair = _wds_pair(
            wds_id=wds_id, components=components,
            rho_last=rho, theta_last=theta,
            mag_pri=mags[0], mag_sec=mags[1],
        )
        toks = split_components(components)
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
        mags: dict[str, tuple[float | None, float | None]] | None = None,
        msc: MscLookup | None = None,
    ) -> dict[tuple[str, str], tuple[float, float]]:
        pairs, comps, classifications = [], [], []
        for components, rho, theta, kept in specs:
            p, c = self._pair_with_comps(
                components, rho, theta,
                mags=(mags or {}).get(components, (4.0, 6.0)),
            )
            pairs.append(p)
            comps.extend(c)
            classifications.append(OpticalClassification(
                kept, "wds_notes_kept" if kept else "wds_notes_rejected",
            ))
        return compute_anchor_offsets(pairs, comps, classifications, msc).offsets

    def _assert_offset_en(
        self, out: dict[tuple[str, str], tuple[float, float]], tok: str,
        east: float, north: float,
    ) -> None:
        sep, pa = out[("WDS-1", tok)]
        self.assertAlmostEqual(sep * math.sin(math.radians(pa)), east, places=6)
        self.assertAlmostEqual(sep * math.cos(math.radians(pa)), north, places=6)

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

    def test_anchor_picks_aa_over_b_as_promotion_does(self) -> None:
        out = self._offsets([
            ("Aa,Ab", 1.0, 0.0, True),
            ("BC", 5.0, 90.0, True),
            ("Aa,B", 20.0, 90.0, True),
        ])
        self.assertNotIn(("WDS-1", "Aa"), out)
        self.assertAlmostEqual(out[("WDS-1", "B")][0], 20.0)
        self.assertAlmostEqual(out[("WDS-1", "C")][0], 25.0)

    def test_sub_resolution_rows_contribute_no_edge(self) -> None:
        out = self._offsets([
            ("AB", 5.0, 90.0, True),
            ("Ba,Bb", 0.0, None, True),
        ])
        self.assertNotIn(("WDS-1", "Ba"), out)
        self.assertNotIn(("WDS-1", "Bb"), out)

    def test_parent_row_reaches_outer_star_from_sub_letter_anchor(self) -> None:
        # 15 Mon shape: the anchor is Aa and A's own rows are rejected, so
        # E is reached through the Aa → A photocentre link.
        out = self._offsets([
            ("Aa,Ab", 1.0, 0.0, True),
            ("AE", 100.0, 90.0, False),
        ])
        beta = 1.0 / (1.0 + 10.0 ** (0.4 * 2.0))
        self._assert_offset_en(out, "E", 100.0, beta)

    def test_missing_sibling_magnitude_places_parent_on_anchor(self) -> None:
        out = self._offsets(
            [("Aa,Ab", 1.0, 0.0, True), ("AE", 100.0, 90.0, False)],
            mags={"Aa,Ab": (4.0, None)},
        )
        self._assert_offset_en(out, "E", 100.0, 0.0)

    def test_sub_letters_below_a_parent_anchor_stay_unreached(self) -> None:
        out = self._offsets([
            ("AB", 10.0, 90.0, True),
            ("Aa,Ab", 1.0, 0.0, True),
            ("Ba,Bb", 1.0, 0.0, True),
        ])
        for tok in ("Aa", "Ab", "Ba", "Bb"):
            self.assertNotIn(("WDS-1", tok), out)

    def test_anchor_without_a_sibling_row_links_at_zero_length(self) -> None:
        out = self._offsets([
            ("Aa,B", 20.0, 90.0, True),
            ("AE", 100.0, 0.0, False),
        ])
        self._assert_offset_en(out, "E", 0.0, 100.0)

    def test_link_chains_through_every_ancestor(self) -> None:
        out = self._offsets(
            [
                ("Aa1,Aa2", 0.5, 0.0, True),
                ("Aa,Ab", 2.0, 0.0, False),
                ("AE", 100.0, 90.0, False),
            ],
            mags={"Aa1,Aa2": (4.0, 4.0), "Aa,Ab": (4.0, 4.0)},
        )
        self._assert_offset_en(out, "E", 100.0, 0.25 + 1.0)

    def test_sibling_row_with_rho_but_no_theta_places_nothing(self) -> None:
        out = self._offsets([
            ("Aa,Ab", 1.0, None, True),
            ("AE", 100.0, 90.0, False),
        ])
        self._assert_offset_en(out, "E", 100.0, 0.0)
        self.assertNotIn(("WDS-1", "Ab"), out)

    def test_sibling_row_wider_than_the_wds_field_places_nothing(self) -> None:
        out = self._offsets(
            [
                ("Aa,Ab", None, 0.0, True),
                ("Aa,Ac", 1.0, 0.0, False),
                ("AE", 100.0, 90.0, False),
            ],
            mags={"Aa,Ab": (4.0, 4.0), "Aa,Ac": (4.0, 4.0)},
        )
        self._assert_offset_en(out, "E", 100.0, 0.5)

    def test_msc_magnitudes_weight_the_photocentre_when_wds_prints_none(self) -> None:
        msc = MscLookup()
        msc.pair_mags[("WDS-1", ("Aa", "Ab"))] = (4.0, 4.0)
        out = self._offsets(
            [("Aa,Ab", 1.0, 0.0, True), ("AE", 100.0, 90.0, False)],
            mags={"Aa,Ab": (None, None)},
            msc=msc,
        )
        self._assert_offset_en(out, "E", 100.0, 0.5)

    def test_system_with_no_kept_pairs_emits_nothing(self) -> None:
        out = self._offsets([("AB", 5.0, 90.0, False)])
        self.assertEqual(out, {})

    def test_records_the_letter_each_system_chains_from(self) -> None:
        pairs, comps, classifications = [], [], []
        for wds_id, components, kept in (
            ("WDS-1", "Aa,Ab", True), ("WDS-1", "BC", True),
            ("WDS-2", "AB", False),
        ):
            p, c = self._pair_with_comps(components, 1.0, 0.0, wds_id=wds_id)
            pairs.append(p)
            comps.extend(c)
            classifications.append(OpticalClassification(kept, "wds_notes_kept"))
        result = compute_anchor_offsets(pairs, comps, classifications, None)
        self.assertEqual(result.anchor_by_system, {"WDS-1": "Aa"})


class PhotocentreOffsetsTests(unittest.TestCase):
    """The flux-weighted sibling photocentre a parent-letter link uses."""

    @staticmethod
    def _adj(
        edges: list[tuple[str, str, float, float, float | None]],
    ) -> dict:
        adj: dict = {}
        for a, b, east, north, dmag in edges:
            add_sibling_edge(adj, a, b, SiblingEdge(east, north, dmag, 2020.0))
        return adj

    def test_two_siblings_weight_by_their_magnitude_difference(self) -> None:
        out = photocentre_offsets(self._adj([("Aa", "Ab", 0.0, 1.0, 2.5)]))
        beta = 1.0 / (1.0 + 10.0)
        self.assertAlmostEqual(out["Aa"][1], beta)
        self.assertAlmostEqual(out["Ab"][1], beta - 1.0)
        self.assertAlmostEqual(out["Aa"][0], 0.0)

    def test_three_siblings_share_one_photocentre(self) -> None:
        out = photocentre_offsets(self._adj([
            ("Aa", "Ab", 1.0, 0.0, 0.0),
            ("Aa", "Ac", 0.0, 1.0, 0.0),
        ]))
        third = 1.0 / 3.0
        self.assertEqual(
            {t: (round(e, 9), round(n, 9)) for t, (e, n) in out.items()},
            {
                "Aa": (round(third, 9), round(third, 9)),
                "Ab": (round(third - 1.0, 9), round(third, 9)),
                "Ac": (round(third, 9), round(third - 1.0, 9)),
            },
        )

    def test_unmeasured_light_weighs_nothing(self) -> None:
        out = photocentre_offsets(self._adj([
            ("Aa", "Ab", 1.0, 0.0, None),
            ("Aa", "Ac", 0.0, 1.0, 0.0),
        ]))
        self.assertAlmostEqual(out["Aa"][0], 0.0)
        self.assertAlmostEqual(out["Aa"][1], 0.5)
        self.assertAlmostEqual(out["Ab"][0], -1.0)

    def test_measured_ratios_set_weights_whatever_the_walk_order(self) -> None:
        out = photocentre_offsets(self._adj([
            ("Aa", "Ab", 1.0, 0.0, None),
            ("Aa", "Ac", 0.0, 1.0, 0.0),
            ("Ab", "Ac", -1.0, 1.0, 0.0),
        ]))
        third = 1.0 / 3.0
        self.assertAlmostEqual(out["Aa"][0], third)
        self.assertAlmostEqual(out["Aa"][1], third)

    def test_flux_ratio_composes_along_a_chain(self) -> None:
        out = photocentre_offsets(self._adj([
            ("Ba", "Bb", 1.0, 0.0, 0.0),
            ("Bb", "Bc", 1.0, 0.0, 0.0),
        ]))
        self.assertAlmostEqual(out["Ba"][0], 1.0)
        self.assertAlmostEqual(out["Bc"][0], -1.0)

if __name__ == "__main__":
    unittest.main()
