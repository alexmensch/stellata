#!/usr/bin/env python3
"""Unit tests for refresh-simbad-wds-xids.py's Phase B cross-ID parse. Run
directly — the kebab filename trips ``python -m unittest``."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import refresh_lib as rl  # noqa: E402
from test_helpers import FakeTable, fake_tap_client, load_kebab_sibling  # noqa: E402

mod = load_kebab_sibling(__file__, "refresh_simbad_wds_xids", "refresh-simbad-wds-xids.py")


class QueryXrefsBatch(unittest.TestCase):
    def setUp(self) -> None:
        join = FakeTable(
            [
                {"oid": 232913, "main_id": "BD+47  2846", "id": "Gaia DR3 2129256395211984000"},
                {"oid": 1001, "main_id": "* xi UMa B", "id": "HIP 55203B"},
                {"oid": 1001, "main_id": "* xi UMa B", "id": "Gaia DR3 777"},
            ],
            ["oid", "main_id", "id"],
        )
        basic = FakeTable([{"oid": 2002, "main_id": "* alf Cen A"}], ["oid", "main_id"])
        self.client = fake_tap_client(
            rl, lambda q: join if "JOIN ident" in q else basic,
        )

    def test_reads_gaia_hip_and_main_id_and_the_join_misses(self) -> None:
        out = mod.query_xrefs_batch(self.client, [232913, 1001, 2002], {1001: {"B"}})
        self.assertEqual(
            out,
            {
                232913: {"main_id": "BD+47  2846", "hip": None, "gaia": 2129256395211984000},
                1001: {"main_id": "* xi UMa B", "hip": 55203, "gaia": 777},
                2002: {"main_id": "* alf Cen A", "hip": None, "gaia": None},
            },
        )


if __name__ == "__main__":
    unittest.main()
