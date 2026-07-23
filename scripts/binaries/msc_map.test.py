#!/usr/bin/env python3
"""Stdlib-unittest pins for scripts/binaries/msc_map.py."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.binaries.msc_map import (  # noqa: E402
    build_msc_lookup,
    map_msc_labels,
)
from scripts.binaries.parsers import (  # noqa: E402
    MscComponentRow,
)
from scripts.binaries.pipeline_test_fixtures import (  # noqa: E402
    _msc_orbit,
    _msc_system,
)


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
        mapping = map_msc_labels(rows)
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
        mapping = map_msc_labels(rows)
        self.assertEqual(mapping["Aab"], "Aa")
        self.assertEqual(mapping["Ac"], "Ab")
        self.assertEqual(mapping["Aa"], "Aa1")
        self.assertEqual(mapping["Ab"], "Aa2")

    def test_unmappable_union_at_root_drops_subtree(self) -> None:
        rows = [
            _msc_system(prim="Aab", sec="C", parent="X"),
            _msc_system(prim="Aa", sec="Ab", parent="Aab"),
        ]
        mapping = map_msc_labels(rows)
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
        lk = build_msc_lookup(systems, orbits, [])
        self.assertIn(("10000+0000", ("Aa1", "Aa2")), lk.orbits_by_pair)
        self.assertEqual(lk.n_orbits_unmapped, 1)
        self.assertEqual(
            lk.pair_mags[("10000+0000", ("Aa1", "Aa2"))], (4.37, 6.9),
        )
        self.assertEqual(lk.spect_by_comp[("10000+0000", "Aa1")], "B3V")
        self.assertNotIn(("10000+0000", "Aa2"), lk.spect_by_comp)

    def test_components_table_type_beats_pair_side(self) -> None:
        systems = [_msc_system(spt1="B3IV")]
        components = [MscComponentRow(
            wds_id="10000+0000", comp="A", spt="B3V", vmag=None,
        )]
        lk = build_msc_lookup(systems, [], components)
        self.assertEqual(lk.spect_by_comp[("10000+0000", "A")], "B3V")

    def test_compound_sides_never_enter_spect(self) -> None:
        systems = [_msc_system(prim="AB", sec="C", spt1="F7IV", spt2="A1V")]
        lk = build_msc_lookup(systems, [], [])
        self.assertNotIn(("10000+0000", "AB"), lk.spect_by_comp)
        self.assertEqual(lk.spect_by_comp[("10000+0000", "C")], "A1V")


if __name__ == "__main__":
    unittest.main()
