#!/usr/bin/env python3
"""Stdlib-unittest pins for scripts/binaries/component_tokens.py."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.binaries.component_tokens import (  # noqa: E402
    child_component_tokens,
    compound_contains,
    expand_wds_truncated_secondary,
    is_component_token,
    is_hier_ancestor,
    parent_component_token,
)
from scripts.binaries.stage2_resolve import (  # noqa: E402
    _are_pair_mates,
)


class ComponentTokensTests(unittest.TestCase):
    def test_is_component_token(self) -> None:
        for tok in ("A", "Aa", "Aa1", "B", "Cb"):
            self.assertTrue(is_component_token(tok), tok)
        for tok in ("", "AB", "Aab", "a", "95", "Aa12", "r"):
            self.assertFalse(is_component_token(tok), tok)

    def test_expand_wds_truncated_secondary(self) -> None:
        self.assertEqual(expand_wds_truncated_secondary("Aa1", "2"), "Aa2")
        self.assertEqual(expand_wds_truncated_secondary("Aa", "Ab"), "Ab")
        # Primary not digit-terminated → bare-digit secondary is left
        # alone (it isn't a truncation of the primary's stem).
        self.assertEqual(expand_wds_truncated_secondary("Aa", "2"), "2")

    def test_parent_component_token(self) -> None:
        self.assertEqual(parent_component_token("Aa1"), "Aa")
        self.assertEqual(parent_component_token("Aa"), "A")
        self.assertIsNone(parent_component_token("A"))

    def test_child_component_tokens(self) -> None:
        self.assertEqual(child_component_tokens("A"), ("Aa", "Ab"))
        self.assertEqual(child_component_tokens("Ca"), ("Ca1", "Ca2"))
        self.assertIsNone(child_component_tokens("Aa1"))
        self.assertIsNone(child_component_tokens("AB"))


class BindingRelationTests(unittest.TestCase):
    def test_ancestor_and_hierarchy(self) -> None:
        self.assertTrue(is_hier_ancestor("A", "Aa"))
        self.assertTrue(is_hier_ancestor("A", "Aa1"))
        self.assertTrue(is_hier_ancestor("Aa", "Aa1"))
        self.assertFalse(is_hier_ancestor("A", "B"))
        self.assertFalse(is_hier_ancestor("A", "AB"))  # compound, not child

    def test_compound_containment(self) -> None:
        self.assertTrue(compound_contains("AB", "A"))
        self.assertTrue(compound_contains("AB", "Aa"))
        self.assertFalse(compound_contains("AB", "C"))
        self.assertFalse(compound_contains("AB", "BC"))

    def test_blend_pair_mates_transitive(self) -> None:
        self.assertTrue(_are_pair_mates("A", "B", [("A", "B")]))
        # Transitive through ancestors: A roots Aa, B roots Bb.
        self.assertTrue(_are_pair_mates("A", "B", [("Aa", "Bb")]))
        self.assertFalse(_are_pair_mates("F", "G", [("C", "F"), ("C", "G")]))


if __name__ == "__main__":
    unittest.main()
