#!/usr/bin/env python3
"""Unit tests for scripts/refresh/wds_xids_cascade.py — pure helpers for
the HD/CCDM/HIP cascade fallback in refresh-simbad-wds-xids.py.

Run: python3 scripts/refresh/wds_xids_cascade.test.py
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from wds_xids_cascade import (  # noqa: E402
    build_cascade_candidates,
    filter_cascade_hits,
    parse_hd_or_hip_from_ident,
)


class ParseHdOrHipTests(unittest.TestCase):

    def test_hd_basic(self):
        self.assertEqual(parse_hd_or_hip_from_ident("HD  48915"), ("HD", 48915))

    def test_hd_with_component_letter(self):
        # Per-component HD form: parser must drop the trailing letter.
        self.assertEqual(parse_hd_or_hip_from_ident("HD  48915B"), ("HD", 48915))

    def test_hd_short_number(self):
        # 3-digit HD pads to width 7 ("HD    113").
        self.assertEqual(parse_hd_or_hip_from_ident("HD    113"), ("HD", 113))

    def test_hd_six_digit(self):
        self.assertEqual(parse_hd_or_hip_from_ident("HD 225220"), ("HD", 225220))

    def test_hip_basic(self):
        self.assertEqual(parse_hd_or_hip_from_ident("HIP 32349"), ("HIP", 32349))

    def test_hip_with_component(self):
        self.assertEqual(parse_hd_or_hip_from_ident("HIP 32349B"), ("HIP", 32349))

    def test_hip_with_space_before_component(self):
        self.assertEqual(parse_hd_or_hip_from_ident("HIP 32349 B"), ("HIP", 32349))

    def test_unrelated_prefix(self):
        self.assertIsNone(parse_hd_or_hip_from_ident("Gaia DR3 12345"))
        self.assertIsNone(parse_hd_or_hip_from_ident("* alf CMa"))

    def test_hd_without_digits(self):
        # Defensive — "HD" with no following number can't parse.
        self.assertIsNone(parse_hd_or_hip_from_ident("HD foo"))


class BuildCascadeCandidatesTests(unittest.TestCase):

    def test_sirius_b_recoverable_form(self):
        # Sirius A's primary oid -> HD 48915 alias exists; Sirius B is
        # unresolved under WDS J06451-1643B. We should produce the
        # candidate `HD  48915B` (Sirius B's actual SIMBAD ident, oid
        # 930049) plus a CCDM J06451-1643B candidate.
        unresolved = [("06451-1643", "B")]
        siblings = {"06451-1643": [("A", 8399845)]}
        hd_by_oid = {8399845: 48915}
        hip_by_oid = {8399845: 32349}
        cands, keys = build_cascade_candidates(unresolved, siblings, hd_by_oid, hip_by_oid)
        # Expected forms — order doesn't matter; check membership.
        self.assertIn("HD  48915B", cands)
        self.assertIn("CCDM J06451-1643B", cands)
        self.assertIn("HIP 32349B", cands)
        self.assertIn("HIP 32349 B", cands)
        # cand_to_key attribution is set per candidate.
        self.assertEqual(keys["HD  48915B"], ("06451-1643", "B", "HD"))
        self.assertEqual(keys["CCDM J06451-1643B"], ("06451-1643", "B", "CCDM"))
        self.assertEqual(keys["HIP 32349B"], ("06451-1643", "B", "HIP"))

    def test_returns_sorted_deduped(self):
        # Two unresolved components in the same system; each pulls a CCDM
        # candidate. HD candidates dedupe (same primary, same HD).
        unresolved = [("06451-1643", "B"), ("06451-1643", "C")]
        siblings = {"06451-1643": [("A", 8399845)]}
        hd_by_oid = {8399845: 48915}
        cands, _ = build_cascade_candidates(unresolved, siblings, hd_by_oid, {})
        # Sorted.
        self.assertEqual(cands, sorted(cands))
        # No duplicates.
        self.assertEqual(len(cands), len(set(cands)))

    def test_omits_strategy_with_no_data(self):
        # Primary has no HD or HIP alias — only CCDM candidates emit.
        unresolved = [("06451-1643", "B")]
        siblings = {"06451-1643": [("A", 8399845)]}
        cands, _ = build_cascade_candidates(unresolved, siblings, {}, {})
        self.assertEqual(cands, ["CCDM J06451-1643B"])

    def test_no_resolved_siblings_yields_only_ccdm(self):
        # System has no resolved primaries — but the caller filters
        # unresolved_with_siblings such that this shouldn't happen.
        # Defensive: if it does, only CCDM (positional-anchor-derived)
        # candidate emits — HD/HIP need a primary.
        cands, _ = build_cascade_candidates([("06451-1643", "B")], {}, {}, {})
        self.assertEqual(cands, ["CCDM J06451-1643B"])

    def test_hd_padding_widths(self):
        # 3-digit, 4-digit, 5-digit, 6-digit HD numbers all pad to width 9
        # in the `HD<pad><num>` block.
        cases = [
            (113, "HD    113A"),
            (1202, "HD   1202A"),
            (48915, "HD  48915A"),
            (225220, "HD 225220A"),
        ]
        for hd, expected_ident in cases:
            cands, _ = build_cascade_candidates(
                [("00000+0000", "A")], {"00000+0000": [("B", 999)]},
                {999: hd}, {},
            )
            self.assertIn(expected_ident, cands, f"HD {hd} did not produce {expected_ident}")


class FilterCascadeHitsTests(unittest.TestCase):

    def test_basic_recovery(self):
        cand_to_key = {"HD  48915B": ("06451-1643", "B", "HD")}
        rows = [{"id": "HD  48915B", "oidref": 930049}]
        resolved_oids = {8399845}  # Sirius A's oid, NOT Sirius B's
        recoveries, counts = filter_cascade_hits(rows, cand_to_key, resolved_oids)
        self.assertEqual(recoveries, {("06451-1643", "B"): 930049})
        self.assertEqual(counts, {"HD": 1, "CCDM": 0, "HIP": 0})

    def test_drops_alias_pointing_at_already_resolved_oid(self):
        # If an alias resolves to an oid already in our Phase A set, the
        # alias is just another name for the SAME star — not a new
        # component. Drop it.
        cand_to_key = {"HD  12345A": ("00000+0000", "A", "HD")}
        rows = [{"id": "HD  12345A", "oidref": 555}]
        recoveries, _ = filter_cascade_hits(rows, cand_to_key, {555})
        self.assertEqual(recoveries, {})

    def test_unknown_ident_skipped(self):
        # Defensive: SIMBAD shouldn't return an ident the caller didn't
        # ask for, but if it did, skip it without raising.
        rows = [{"id": "Unexpected ident", "oidref": 999}]
        recoveries, counts = filter_cascade_hits(rows, {}, set())
        self.assertEqual(recoveries, {})
        self.assertEqual(counts, {"HD": 0, "CCDM": 0, "HIP": 0})

    def test_first_wins_on_alias_conflict(self):
        # Two aliases for the same (wds_id, comp) point to DIFFERENT
        # SIMBAD oids — first-wins, second is dropped silently. Rare
        # case (would indicate SIMBAD curation inconsistency).
        cand_to_key = {
            "HD  12345B": ("00000+0000", "B", "HD"),
            "CCDM J00000+0000B": ("00000+0000", "B", "CCDM"),
        }
        rows = [
            {"id": "HD  12345B", "oidref": 111},
            {"id": "CCDM J00000+0000B", "oidref": 222},
        ]
        recoveries, counts = filter_cascade_hits(rows, cand_to_key, set())
        self.assertEqual(recoveries, {("00000+0000", "B"): 111})
        # CCDM hit was dropped due to conflict, not counted.
        self.assertEqual(counts["HD"], 1)
        self.assertEqual(counts["CCDM"], 0)

    def test_multiple_aliases_same_oid_raw_count_per_strategy(self):
        # Two aliases agree on the same oid — recovery is recorded once,
        # but the per-strategy counter increments for each alias hit. This
        # is the documented "raw alias-row hits" semantic: if HD aliases
        # disappear from SIMBAD, the HD counter drops to 0 even if CCDM
        # still recovers the same components. That sensitivity is what
        # the diagnostic log uses.
        cand_to_key = {
            "HD  12345B": ("00000+0000", "B", "HD"),
            "CCDM J00000+0000B": ("00000+0000", "B", "CCDM"),
        }
        rows = [
            {"id": "HD  12345B", "oidref": 111},
            {"id": "CCDM J00000+0000B", "oidref": 111},
        ]
        recoveries, counts = filter_cascade_hits(rows, cand_to_key, set())
        self.assertEqual(recoveries, {("00000+0000", "B"): 111})
        self.assertEqual(counts["HD"], 1)
        self.assertEqual(counts["CCDM"], 1)


if __name__ == "__main__":
    unittest.main()
