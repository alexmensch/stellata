#!/usr/bin/env python3
"""Stdlib-unittest pins for scripts/binaries/indices.py."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.binaries.indices import (  # noqa: E402
    build_indices,
)
from scripts.binaries.parsers import (  # noqa: E402
    AthygRow,
    CcdmRow,
)
from scripts.binaries.pipeline_test_fixtures import (  # noqa: E402
    _athyg_row,
    _gaia_astrometry_row,
    _indices_with_astrometry,
)


class BuildIndicesTests(unittest.TestCase):
    def _row(
        self, *, hip: int | None = None,
        tyc: str | None = None, gaia: int | None = None,
    ) -> "AthygRow":
        return AthygRow(
            hip=hip, tyc=tyc, gaia=gaia, hd=None,
            ra_deg=0.0, dec_deg=0.0,
            x_pc=0.0, y_pc=0.0, z_pc=0.0,
            dist_pc=1.0, v_mag=None, absmag=5.0,
            ci=None, spect="", proper="",
            pm_ra_masyr=None, pm_de_masyr=None,
        )

    def test_three_athyg_views(self) -> None:
        athyg = [
            self._row(hip=1, tyc="100-1-1", gaia=111),
            self._row(hip=2, tyc=None, gaia=222),
            self._row(hip=None, tyc="200-2-1", gaia=None),
        ]
        idx = build_indices(
            athyg=athyg, hip2=[],
            hip_to_gaia={1: 999}, tyc_to_gaia={"100-1-1": 998},
            src_to_nss={111: {"period": "10.0"}},
        )
        self.assertEqual(set(idx.hip_to_athyg.keys()), {1, 2})
        self.assertEqual(set(idx.tyc_to_athyg.keys()), {"100-1-1", "200-2-1"})
        self.assertEqual(set(idx.src_to_athyg.keys()), {111, 222})
        self.assertEqual(idx.hip_to_gaia, {1: 999})
        self.assertEqual(idx.tyc_to_gaia, {"100-1-1": 998})
        self.assertEqual(idx.src_to_nss[111]["period"], "10.0")
        # Empty astrometry index when no Gaia astrometry passed.
        self.assertEqual(idx.src_to_astrometry, {})

    def test_src_to_hip_inverts_hip_to_gaia(self) -> None:
        idx = build_indices(
            athyg=[], hip2=[],
            hip_to_gaia={1: 100, 2: 200, 3: 300},
            tyc_to_gaia={}, src_to_nss={},
        )
        self.assertEqual(idx.src_to_hip, {100: 1, 200: 2, 300: 3})

    def test_src_to_hip_collision_keeps_first(self) -> None:
        # Tight systems can map two HIPs to one Gaia source. Either HIP
        # is fine for HIP2 lookup; pick the first deterministically.
        idx = build_indices(
            athyg=[], hip2=[],
            hip_to_gaia={1: 100, 2: 100},
            tyc_to_gaia={}, src_to_nss={},
        )
        # dict iteration order is insertion order in CPython 3.7+.
        self.assertIn(idx.src_to_hip[100], {1, 2})

    def test_src_to_astrometry_surfaced(self) -> None:
        row = _gaia_astrometry_row(source_id=42, ruwe=0.9)
        idx = build_indices(
            athyg=[], hip2=[],
            hip_to_gaia={}, tyc_to_gaia={}, src_to_nss={},
            src_to_astrometry={42: row},
        )
        self.assertEqual(idx.src_to_astrometry[42].ruwe, 0.9)

    def test_ccdm_maps_aggregate_siblings(self) -> None:
        # α Cen-shaped: three HIPs (71683 A, 71681 B, 70890 C) all map
        # to CCDM 14396-6050. The forward map keys per-HIP; the reverse
        # map gives the full sibling list keyed by CCDM identifier.
        ccdm_rows = [
            CcdmRow(hip=71683, ccdm="14396-6050", mult_flag=""),
            CcdmRow(hip=71681, ccdm="14396-6050", mult_flag=""),
            CcdmRow(hip=70890, ccdm="14396-6050", mult_flag=""),
            # Empty CCDM identifier is dropped from both maps.
            CcdmRow(hip=99999, ccdm="", mult_flag="O"),
        ]
        idx = build_indices(
            athyg=[], hip2=[],
            hip_to_gaia={}, tyc_to_gaia={}, src_to_nss={},
            ccdm=ccdm_rows,
        )
        self.assertEqual(idx.hip_to_ccdm[71683], "14396-6050")
        self.assertEqual(
            sorted(idx.ccdm_to_hips["14396-6050"]),
            [70890, 71681, 71683],
        )
        self.assertNotIn(99999, idx.hip_to_ccdm)
        self.assertNotIn("", idx.ccdm_to_hips)


class GaiaBindingMagnitudeGateTests(unittest.TestCase):
    """build_indices' one-sided G-vs-V consistency gate on HIP-anchored
    Gaia bindings (xwalk rows and AT-HYG gaia cells)."""

    def test_xwalk_binding_fainter_than_v_is_rejected(self) -> None:
        # Castor A shape: the V=1.58 star bound to the companion's
        # G=2.92 source — past any physical G−V.
        athyg = [_athyg_row(hip=36850, v_mag=1.58)]
        astro = {892: _gaia_astrometry_row(source_id=892, g_mag=2.92)}
        idx = _indices_with_astrometry(
            athyg=athyg, hip_to_gaia={36850: 892}, src_to_astrometry=astro,
        )
        self.assertNotIn(36850, idx.hip_to_gaia)
        self.assertNotIn(892, idx.src_to_hip)
        self.assertEqual(idx.xwalk_mag_rejected, [(36850, 892)])

    def test_xwalk_binding_within_blend_ceiling_is_kept(self) -> None:
        # ζ Sgr shape: +0.65 — inside the equal-pair blend ceiling.
        athyg = [_athyg_row(hip=93506, v_mag=2.60)]
        astro = {77: _gaia_astrometry_row(source_id=77, g_mag=3.25)}
        idx = _indices_with_astrometry(
            athyg=athyg, hip_to_gaia={93506: 77}, src_to_astrometry=astro,
        )
        self.assertEqual(idx.hip_to_gaia.get(93506), 77)
        self.assertEqual(idx.xwalk_mag_rejected, [])

    def test_red_star_brighter_g_is_kept(self) -> None:
        # G brighter than V is the normal red-star regime — the gate is
        # one-sided and must never fire on it.
        athyg = [_athyg_row(hip=1, v_mag=8.0)]
        astro = {5: _gaia_astrometry_row(source_id=5, g_mag=6.0)}
        idx = _indices_with_astrometry(
            athyg=athyg, hip_to_gaia={1: 5}, src_to_astrometry=astro,
        )
        self.assertEqual(idx.hip_to_gaia.get(1), 5)

    def test_unverifiable_bindings_are_trusted(self) -> None:
        # Missing V, source absent from the astrometry pull, or missing
        # G — nothing to compare, binding kept.
        athyg = [
            _athyg_row(hip=1, v_mag=None),
            _athyg_row(hip=2, v_mag=5.0),
            _athyg_row(hip=3, v_mag=5.0),
        ]
        astro = {30: _gaia_astrometry_row(source_id=30, g_mag=None)}
        idx = _indices_with_astrometry(
            athyg=athyg,
            hip_to_gaia={1: 10, 2: 20, 3: 30},
            src_to_astrometry=astro,
        )
        self.assertEqual(idx.hip_to_gaia, {1: 10, 2: 20, 3: 30})
        self.assertEqual(idx.xwalk_mag_rejected, [])

    def test_athyg_gaia_cell_is_scrubbed(self) -> None:
        # α Cen B shape: the row's own gaia cell (ingested from the same
        # cross-walk) points at a G=20.95 background source. The cell is
        # cleared at the ingest boundary; the HIP survives for Stage 3's
        # HIP2 fallback.
        row = _athyg_row(hip=71681, gaia=587, v_mag=1.35)
        astro = {587: _gaia_astrometry_row(source_id=587, g_mag=20.95)}
        idx = _indices_with_astrometry(
            athyg=[row], src_to_astrometry=astro,
        )
        self.assertIsNone(row.gaia)
        self.assertNotIn(587, idx.src_to_athyg)
        self.assertEqual(idx.athyg_gaia_mag_rejected, [(71681, 587)])
        self.assertIn(71681, idx.hip_to_athyg)


if __name__ == "__main__":
    unittest.main()
