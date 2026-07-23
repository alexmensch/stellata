#!/usr/bin/env python3
"""Stdlib-unittest pins for scripts/binaries/stage6_multiples.py."""

from __future__ import annotations

import math
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.binaries.indices import (  # noqa: E402
    IdentifierIndices,
    build_indices,
)
from scripts.binaries.mass_estimate import (  # noqa: E402
    UNKNOWN_COMPANION_MASS_RATIO_Q,
    mass_ratio_from_components,
)
from scripts.binaries.msc_map import (  # noqa: E402
    MscLookup,
)
from scripts.binaries.parsers import (  # noqa: E402
    AthygRow,
    SimbadWdsXid,
    WdsPair,
)
from scripts.binaries.stage2_resolve import (  # noqa: E402
    ResolvedComponent,
    _spherical_to_unit_vec,
    split_components,
)
from scripts.binaries.stage4_orbits import (  # noqa: E402
    OrbitElements,
)
from scripts.binaries.stage5_optical import (  # noqa: E402
    ESCAPE_GATE_DEFAULT_COMPONENT_MASS_MSUN,
    OpticalClassification,
)
from scripts.binaries.stage6_multiples import (  # noqa: E402
    ASTROMETRY_VIA_SYSTEM_INHERITED,
    A_VIA_CATALOG,
    A_VIA_KEPLER_MASS_ESTIMATE,
    A_VIA_NONE,
    CATALOG_SCENE_EPOCH,
    CIRCULAR_ORBIT_OMEGA_RAD,
    MULTIPLES_TSV_COLUMNS,
    MultiplesRow,
    PHOTOMETRY_VIA_GAIA,
    PHOTOMETRY_VIA_NONE,
    PHOTOMETRY_VIA_OWN,
    PHOTOMETRY_VIA_SYSTEM_INHERITED,
    _position_pc,
    _resolve_spect,
    ballesteros_bv_from_teff,
    build_multiples_rows,
    build_standalone_rows,
    compute_anchor_offsets,
    compute_pair_masses,
    compute_system_anchors,
    finalize_renderable_elements,
    gaia_photometry_absmag_ci,
    wds_dmag,
    wds_year_to_jd,
    write_multiples_tsv,
)
from scripts.binaries.pipeline_test_fixtures import (  # noqa: E402
    _athyg_row,
    _component_astrometry,
    _gaia_astrometry_row,
    _indices_with_astrometry,
    _resolved,
    _wds_pair,
)


class BuildMultiplesRowsTests(unittest.TestCase):
    def test_drops_optical_classified_pairs(self) -> None:
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True, via="orb6_hip"),
            _resolved(gaia=2, component="B", is_primary=False, via="orb6_hip"),
        ]
        astrometry = [_component_astrometry(), _component_astrometry()]
        orbits = [(None, "none")]
        classifications = [OpticalClassification(False, "gaia_rejected")]
        indices = _indices_with_astrometry()

        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertEqual(rows, [])

    def test_emits_two_rows_per_physical_pair(self) -> None:
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True, via="orb6_hip"),
            _resolved(gaia=2, component="B", is_primary=False, via="athyg_gaia_native"),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        orbits = [(None, "none")]
        classifications = [OpticalClassification(True, "wds_notes_kept")]
        indices = _indices_with_astrometry()

        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0].orbit_role, "primary")
        self.assertEqual(rows[1].orbit_role, "secondary")
        self.assertEqual(rows[0].system_id, "WDS-1-AB")
        self.assertEqual(rows[0].resolve_via, "orb6_hip")
        self.assertEqual(rows[1].resolve_via, "athyg_gaia_native")
        self.assertEqual(rows[0].comp, "A")
        self.assertEqual(rows[1].comp, "B")

    def test_drops_pair_when_both_components_lack_position_and_no_anchor(self) -> None:
        # No other pair in the system has astrometry → the wds_id has no
        # anchor → inheritance can't recover, and the pair drops.
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=None, ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
            _component_astrometry(parallax_mas=None, ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
        ]
        orbits = [(None, "none")]
        classifications = [OpticalClassification(True, "wds_notes_kept")]
        indices = _indices_with_astrometry()

        dropped_no_position: list[str] = []
        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
            dropped_no_position=dropped_no_position,
        )
        self.assertEqual(rows, [])
        self.assertEqual(dropped_no_position, ["WDS-1AB"])

    def test_hd_surfaces_from_component_athyg_row(self) -> None:
        # ξ UMa shape: the AT-HYG row carries HD; the emitted row must
        # surface it so the catalog-side identifier backfill can join
        # HD-only catalog records by HD instead of position.
        pair = _wds_pair(components="AB")
        athyg = [
            _athyg_row(gaia=1, hd=98231),
            _athyg_row(gaia=2),
        ]
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [_component_astrometry(), _component_astrometry()]
        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(athyg=athyg),
        )
        self.assertEqual(rows[0].hd, 98231)
        self.assertIsNone(rows[1].hd)

    def test_hd_falls_back_to_orb6_component_hd(self) -> None:
        # ξ UMa's actual shape: the AT-HYG row binds to a different
        # component, so the pair primary's HD comes from the
        # coord-validated ORB6 entry Stage 2 stashed on the component.
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True,
                      hip=55203, hd=98231),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [_component_astrometry(), _component_astrometry()]
        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(),
        )
        self.assertEqual(rows[0].hd, 98231)

    def test_inherits_system_anchor_when_pair_lacks_position(self) -> None:
        # 40 Eri BC shape — the AB pair anchors the system with A's
        # Gaia 5p; the BC pair's components both have unresolved
        # astrometry (tight inner binary blended out of DR3). System
        # inheritance lets BC emit with A's position and the
        # ``astrometry_via=system_inherited`` tag.
        ab_pair = _wds_pair(wds_id="04153-0739", components="AB")
        bc_pair = _wds_pair(wds_id="04153-0739", components="BC")
        components = [
            _resolved(gaia=1, wds_id="04153-0739", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="04153-0739", component="B", is_primary=False),
            _resolved(gaia=3, wds_id="04153-0739", component="B", is_primary=True),
            _resolved(gaia=4, wds_id="04153-0739", component="C", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0, ra_deg=0.0, dec_deg=0.0),
            _component_astrometry(parallax_mas=None, ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
            _component_astrometry(parallax_mas=None, ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
            _component_astrometry(parallax_mas=None, ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
        ]
        orbits = [(None, "none"), (None, "none")]
        classifications = [
            OpticalClassification(True, "wds_notes_kept"),
            OpticalClassification(True, "wds_notes_kept"),
        ]
        indices = _indices_with_astrometry(simbad_wds_spectra={
            ("04153-0739", "B"): "DA2.9",
        })

        rows = build_multiples_rows(
            pairs=[ab_pair, bc_pair], components=components,
            astrometry=astrometry, orbits=orbits,
            classifications=classifications, indices=indices,
        )
        # AB → 2 rows (A direct, B unresolved-but-inherits anchor).
        # BC → 2 rows (B and C both inherit anchor).
        self.assertEqual(len(rows), 4)
        bc_b = next(r for r in rows if r.system_id == "04153-0739-BC" and r.comp == "B")
        self.assertEqual(bc_b.spect, "DA2.9")
        self.assertEqual(bc_b.spect_via, "simbad")
        self.assertEqual(bc_b.astrometry_via, ASTROMETRY_VIA_SYSTEM_INHERITED)
        self.assertAlmostEqual(bc_b.dist_pc or 0.0, 100.0, places=6)
        # AB-B's astrometry was unresolved but it still inherits the
        # anchor; the via flips to system_inherited.
        ab_b = next(r for r in rows if r.system_id == "04153-0739-AB" and r.comp == "B")
        self.assertEqual(ab_b.astrometry_via, ASTROMETRY_VIA_SYSTEM_INHERITED)
        # AB-A keeps its native gaia_5p tag.
        ab_a = next(r for r in rows if r.system_id == "04153-0739-AB" and r.comp == "A")
        self.assertEqual(ab_a.astrometry_via, "gaia_5p")

    def test_standalone_sweep_emits_simbad_components_outside_pair_walk(self) -> None:
        # A SIMBAD-known (wds_id, component) that doesn't appear as any
        # decomposing-pair side gets a standalone row via the standalone
        # sweep. Position inherits the system anchor; orbit_role is
        # ``standalone``.
        ab_pair = _wds_pair(wds_id="11111+1111", components="AB")
        components = [
            _resolved(gaia=1, wds_id="11111+1111", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="11111+1111", component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0, ra_deg=0.0, dec_deg=0.0),
            _component_astrometry(parallax_mas=10.0, ra_deg=0.0, dec_deg=0.0),
        ]
        orbits = [(None, "none")]
        classifications = [OpticalClassification(True, "wds_notes_kept")]
        simbad_xids = {
            ("11111+1111", "A"): SimbadWdsXid(
                simbad_oid=10, simbad_main_id="* A", gaia_source_id=1, hip=None,
            ),
            ("11111+1111", "B"): SimbadWdsXid(
                simbad_oid=20, simbad_main_id="* B", gaia_source_id=2, hip=None,
            ),
            # C is SIMBAD-known but appears in no pair row.
            ("11111+1111", "C"): SimbadWdsXid(
                simbad_oid=30, simbad_main_id="* C", gaia_source_id=3, hip=42,
            ),
        }
        indices = _indices_with_astrometry(simbad_wds_spectra={
            ("11111+1111", "C"): "M5V",
        })

        rows = build_multiples_rows(
            pairs=[ab_pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices, simbad_xids=simbad_xids,
        )
        # AB → 2 rows; C → 1 standalone row.
        self.assertEqual(len(rows), 3)
        c_row = next(r for r in rows if r.comp == "C")
        self.assertEqual(c_row.system_id, "11111+1111-_C")
        self.assertEqual(c_row.orbit_role, "standalone")
        self.assertEqual(c_row.source, "simbad")
        self.assertEqual(c_row.spect, "M5V")
        self.assertEqual(c_row.spect_via, "simbad")
        self.assertEqual(c_row.regime, 0)
        self.assertEqual(c_row.hip, 42)
        self.assertEqual(c_row.gaia_source_id, 3)
        self.assertEqual(c_row.astrometry_via, ASTROMETRY_VIA_SYSTEM_INHERITED)
        self.assertAlmostEqual(c_row.dist_pc or 0.0, 100.0, places=6)

    def test_standalone_sweep_skips_already_emitted_components(self) -> None:
        # A and B were emitted by the pair walk; the sweep must NOT
        # double-emit them even though they are in simbad_xids.
        ab_pair = _wds_pair(wds_id="22222+2222", components="AB")
        components = [
            _resolved(gaia=1, wds_id="22222+2222", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="22222+2222", component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0, ra_deg=0.0, dec_deg=0.0),
            _component_astrometry(parallax_mas=10.0, ra_deg=0.0, dec_deg=0.0),
        ]
        orbits = [(None, "none")]
        classifications = [OpticalClassification(True, "wds_notes_kept")]
        simbad_xids = {
            ("22222+2222", "A"): SimbadWdsXid(
                simbad_oid=10, simbad_main_id="* A", gaia_source_id=1, hip=None,
            ),
            ("22222+2222", "B"): SimbadWdsXid(
                simbad_oid=20, simbad_main_id="* B", gaia_source_id=2, hip=None,
            ),
        }
        indices = _indices_with_astrometry()

        rows = build_multiples_rows(
            pairs=[ab_pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices, simbad_xids=simbad_xids,
        )
        self.assertEqual(len(rows), 2)
        self.assertEqual(
            {r.orbit_role for r in rows}, {"primary", "secondary"},
        )


class ComputePairMassesTests(unittest.TestCase):
    def test_sums_spectral_masses_per_pair(self) -> None:
        pair = _wds_pair(wds_id="PM-1", components="AB")
        components = [
            _resolved(gaia=1, wds_id="PM-1", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="PM-1", component="B", is_primary=False),
        ]
        indices = _indices_with_astrometry(
            simbad_wds_spectra={
                ("PM-1", "A"): "G0V",   # ~1.05 M_sun
                ("PM-1", "B"): "K7V",   # ~0.54 M_sun
            },
        )
        masses = compute_pair_masses([pair], components, indices)
        self.assertEqual(len(masses), 1)
        self.assertAlmostEqual(masses[0], 1.05 + 0.54, places=2)

    def test_generous_default_when_type_unknown(self) -> None:
        pair = _wds_pair(wds_id="PM-2", components="AB")
        components = [
            _resolved(gaia=1, wds_id="PM-2", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="PM-2", component="B", is_primary=False),
        ]
        indices = _indices_with_astrometry()
        masses = compute_pair_masses([pair], components, indices)
        self.assertAlmostEqual(
            masses[0], 2.0 * ESCAPE_GATE_DEFAULT_COMPONENT_MASS_MSUN,
            places=6,
        )


class ComputeSystemAnchorsTests(unittest.TestCase):
    def test_picks_first_resolved_component_in_system(self) -> None:
        # Primary has unresolved astrometry, secondary resolves — the
        # secondary's position becomes the anchor.
        pair = _wds_pair(wds_id="ZZ-1", components="AB")
        components = [
            _resolved(gaia=1, wds_id="ZZ-1", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="ZZ-1", component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=None, ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
            _component_astrometry(parallax_mas=10.0, ra_deg=0.0, dec_deg=0.0),
        ]
        anchors = compute_system_anchors([pair], components, astrometry)
        self.assertIn("ZZ-1", anchors)
        x, y, z, dist = anchors["ZZ-1"]
        self.assertAlmostEqual(dist, 100.0, places=6)
        self.assertAlmostEqual(x, 100.0, places=6)

    def test_prefers_primary_when_both_resolved(self) -> None:
        # First (primary) component wins the anchor slot when both have
        # astrometry — set distinctly so the slot is observably the
        # primary's value.
        pair = _wds_pair(wds_id="ZZ-2", components="AB")
        components = [
            _resolved(gaia=1, wds_id="ZZ-2", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="ZZ-2", component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0, ra_deg=0.0, dec_deg=0.0),
            _component_astrometry(parallax_mas=20.0, ra_deg=0.0, dec_deg=0.0),
        ]
        anchors = compute_system_anchors([pair], components, astrometry)
        _, _, _, dist = anchors["ZZ-2"]
        self.assertAlmostEqual(dist, 100.0, places=6)

    def test_emits_no_anchor_when_no_component_in_system_resolves(self) -> None:
        pair = _wds_pair(wds_id="ZZ-3", components="AB")
        components = [
            _resolved(gaia=1, wds_id="ZZ-3", component="A", is_primary=True),
            _resolved(gaia=2, wds_id="ZZ-3", component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=None, ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
            _component_astrometry(parallax_mas=None, ra_deg=None, dec_deg=None,
                                  astrometry_via="unresolved"),
        ]
        anchors = compute_system_anchors([pair], components, astrometry)
        self.assertNotIn("ZZ-3", anchors)

    def test_position_pc_from_parallax_and_radec(self) -> None:
        # 10 mas parallax → 100 pc; (RA, Dec) = (0, 0) → x-axis.
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0, ra_deg=0.0, dec_deg=0.0),
            _component_astrometry(parallax_mas=10.0, ra_deg=0.0, dec_deg=0.0),
        ]
        orbits = [(None, "none")]
        classifications = [OpticalClassification(True, "wds_notes_kept")]
        indices = _indices_with_astrometry()

        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertAlmostEqual(rows[0].dist_pc or 0.0, 100.0, places=6)
        self.assertAlmostEqual(rows[0].x_pc or 0.0, 100.0, places=6)
        self.assertAlmostEqual(rows[0].y_pc or 0.0, 0.0, places=6)
        self.assertAlmostEqual(rows[0].z_pc or 0.0, 0.0, places=6)

    def test_position_pc_normalises_mixed_epoch_pair(self) -> None:
        # A bound pair measured at DIFFERENT native epochs — HIP2 primary
        # at J1991.25, Gaia secondary at J2016 — must bake xyz at ONE
        # scene epoch, so the static relative separation is the pair's
        # true J2016 configuration, not corrupted by (epoch gap × systemic
        # PM) — the mixed-epoch static-position bug.
        dist_pc = 100.0
        plx = 1000.0 / dist_pc
        pmra, pmdec = 3600.0, 0.0  # mas/yr systemic; 24.75 yr ≈ 89″ drift
        ra_p, dec_p = 150.0, 10.0  # primary true J2016 direction
        sep_true_arcsec = 5.0
        cosd = math.cos(math.radians(dec_p))
        # Secondary sits 5″ east of the primary at J2016.
        ra_s = ra_p + sep_true_arcsec / (3600.0 * cosd)
        # Primary is MEASURED at J1991.25 — its stored ra/dec is the J2016
        # direction rolled back 24.75 yr along the systemic PM.
        dt = CATALOG_SCENE_EPOCH - 1991.25
        ra_p_1991 = ra_p - pmra * dt / (3600.0 * 1000.0 * cosd)
        dec_p_1991 = dec_p - pmdec * dt / (3600.0 * 1000.0)

        primary = _component_astrometry(
            ra_deg=ra_p_1991, dec_deg=dec_p_1991, parallax_mas=plx,
            pmra_masyr=pmra, pmdec_masyr=pmdec,
            astrometry_via="hip2_long_baseline", ref_epoch=1991.25,
        )
        secondary = _component_astrometry(
            ra_deg=ra_s, dec_deg=dec_p, parallax_mas=plx,
            pmra_masyr=pmra, pmdec_masyr=pmdec, ref_epoch=2016.0,
        )
        px, py, pz, _ = _position_pc(primary)
        sx, sy, sz, _ = _position_pc(secondary)
        au = 206264.806
        sep_au = math.sqrt((sx - px) ** 2 + (sy - py) ** 2 + (sz - pz) ** 2) * au
        # 5″ at 100 pc = 500 AU: the normalised pair reproduces it.
        self.assertAlmostEqual(sep_au, sep_true_arcsec * dist_pc, delta=1.0)

        # Without normalisation the primary sits at its J1991.25 direction,
        # 24.75 yr × 3.6″/yr ≈ 89″ (~8900 AU) off — the mis-separation the
        # fix removes.
        ux, uy, uz = _spherical_to_unit_vec(ra_p_1991, dec_p_1991)
        sep_au_stale = math.sqrt(
            (sx - ux * dist_pc) ** 2 + (sy - uy * dist_pc) ** 2
            + (sz - uz * dist_pc) ** 2
        ) * au
        self.assertGreater(sep_au_stale, 8000.0)

    def test_simbad_spectra_override_athyg_spect(self) -> None:
        # 40 Eri-shape: AT-HYG carries the primary's K0V across all
        # components (per-system inheritance). SIMBAD provides per-
        # component sp_type — DA2.9 for B. Stage 6 must prefer SIMBAD
        # and tag the row's ``spect_via`` accordingly.
        pair = _wds_pair(wds_id="04153-0739", components="AB")
        # AT-HYG rows: primary K0V, secondary inherits the same string
        # (the bug the SIMBAD migration fixes).
        athyg_rows = [
            AthygRow(
                hip=19849, tyc=None, gaia=1, hd=None,
                ra_deg=0.0, dec_deg=0.0,
                x_pc=0.0, y_pc=0.0, z_pc=0.0,
                dist_pc=1.0, v_mag=None, absmag=4.4,
                ci=None, spect="K0V", proper="40 Eri A",
                pm_ra_masyr=None, pm_de_masyr=None,
            ),
            AthygRow(
                hip=None, tyc=None, gaia=2, hd=None,
                ra_deg=0.0, dec_deg=0.0,
                x_pc=0.0, y_pc=0.0, z_pc=0.0,
                dist_pc=1.0, v_mag=None, absmag=11.2,
                ci=None, spect="K0V", proper="",
                pm_ra_masyr=None, pm_de_masyr=None,
            ),
        ]
        components = [
            _resolved(gaia=1, wds_id="04153-0739",
                      component="A", is_primary=True),
            _resolved(gaia=2, wds_id="04153-0739",
                      component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        orbits = [(None, "none")]
        classifications = [OpticalClassification(True, "wds_notes_kept")]
        indices = _indices_with_astrometry(
            athyg=athyg_rows,
            simbad_wds_spectra={
                ("04153-0739", "A"): "K0V",
                ("04153-0739", "B"): "DA2.9",
            },
        )

        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0].spect, "K0V")
        self.assertEqual(rows[0].spect_via, "simbad")
        self.assertEqual(rows[1].spect, "DA2.9")
        self.assertEqual(rows[1].spect_via, "simbad")

    def test_athyg_fallback_when_simbad_missing(self) -> None:
        # SIMBAD has no entry for this (wds_id, component) — fall back
        # to AT-HYG and tag ``spect_via="athyg"``.
        pair = _wds_pair(wds_id="XX-1", components="AB")
        athyg_rows = [
            AthygRow(
                hip=None, tyc=None, gaia=10, hd=None,
                ra_deg=0.0, dec_deg=0.0,
                x_pc=0.0, y_pc=0.0, z_pc=0.0,
                dist_pc=1.0, v_mag=None, absmag=5.0,
                ci=None, spect="G2V", proper="",
                pm_ra_masyr=None, pm_de_masyr=None,
            ),
            AthygRow(
                hip=None, tyc=None, gaia=20, hd=None,
                ra_deg=0.0, dec_deg=0.0,
                x_pc=0.0, y_pc=0.0, z_pc=0.0,
                dist_pc=1.0, v_mag=None, absmag=6.0,
                ci=None, spect="G2V", proper="",
                pm_ra_masyr=None, pm_de_masyr=None,
            ),
        ]
        components = [
            _resolved(gaia=10, wds_id="XX-1",
                      component="A", is_primary=True),
            _resolved(gaia=20, wds_id="XX-1",
                      component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        orbits = [(None, "none")]
        classifications = [OpticalClassification(True, "wds_notes_kept")]
        indices = _indices_with_astrometry(athyg=athyg_rows)

        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertEqual(rows[0].spect, "G2V")
        self.assertEqual(rows[0].spect_via, "athyg")
        self.assertEqual(rows[1].spect, "G2V")
        self.assertEqual(rows[1].spect_via, "athyg")

    def test_spect_via_none_when_neither_source_has_spect(self) -> None:
        # AT-HYG row missing (component resolved via WDS-only path) and
        # no SIMBAD entry — spect is empty and ``spect_via="none"``.
        pair = _wds_pair(wds_id="YY-1", components="AB")
        components = [
            _resolved(gaia=1, wds_id="YY-1",
                      component="A", is_primary=True),
            _resolved(gaia=2, wds_id="YY-1",
                      component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        orbits = [(None, "none")]
        classifications = [OpticalClassification(True, "wds_notes_kept")]
        indices = _indices_with_astrometry()

        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertEqual(rows[0].spect, "")
        self.assertEqual(rows[0].spect_via, "none")

    def test_orbit_via_to_regime_mapping(self) -> None:
        # Sanity-check: every ORBIT_VIA_VALUES key maps cleanly, and
        # the legacy regime numbering (0 = none, 2 = full, 3 = spec)
        # is preserved.
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [_component_astrometry(), _component_astrometry()]
        classifications = [OpticalClassification(True, "wds_notes_kept")]
        indices = _indices_with_astrometry()

        for via, expected_regime in (
            ("gaia_nss", 2), ("orb6", 2),
            ("orb6_spectroscopic", 3), ("none", 0),
        ):
            rows = build_multiples_rows(
                pairs=[pair], components=components, astrometry=astrometry,
                orbits=[(None, via)], classifications=classifications,
                indices=indices,
            )
            self.assertEqual(rows[0].regime, expected_regime, msg=via)
            self.assertEqual(rows[1].regime, expected_regime, msg=via)


class SepPaEpochPropagationTests(unittest.TestCase):
    """Stage 6 must thread WDS ``rho_last`` / ``theta_last`` /
    ``date_last`` / Δmag through to the per-pair geometry columns so
    the runtime layer can project Tier-3 (no-orbit) companions at
    their published sky offset and the companion-promotion step in
    build-catalog can impute absmag from Δmag."""

    def test_pair_rows_carry_published_rho_theta_year(self) -> None:
        pair = _wds_pair(
            components="AB", rho_last=8.502, theta_last=174.5, date_last=2015,
            mag_pri=1.46, mag_sec=8.49,
        )
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(),
        )
        self.assertEqual(len(rows), 2)
        for row in rows:
            self.assertEqual(row.sep_arcsec, 8.502)
            self.assertEqual(row.pa_deg, 174.5)
            # 2015.0 → JD 2451545 + 15 * 365.25 = 2457023.75.
            self.assertAlmostEqual(row.sep_pa_epoch_jd, 2457023.75, places=4)
            # Sirius A/B: V_pri = 1.46, V_sec = 8.49 → Δmag = 7.03.
            self.assertAlmostEqual(row.dmag, 7.03, places=4)

    def test_missing_pair_geometry_propagates_as_none(self) -> None:
        pair = _wds_pair(
            components="AB",
            rho_last=None, theta_last=None, date_last=None,
            mag_pri=None, mag_sec=None,
        )
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(),
        )
        for row in rows:
            self.assertIsNone(row.sep_arcsec)
            self.assertIsNone(row.pa_deg)
            self.assertIsNone(row.sep_pa_epoch_jd)
            self.assertIsNone(row.dmag)

    def test_standalone_rows_have_no_pair_geometry(self) -> None:
        # SIMBAD-augmented standalone rows aren't sides of a WDS pair, so
        # the three columns stay None even when the corresponding WDS
        # ``date_last`` exists on the unrelated pair row.
        simbad_xids = {
            ("99999+9999", "X"): SimbadWdsXid(
                simbad_oid=42, simbad_main_id="SIMBAD-X",
                gaia_source_id=None, hip=None,
            ),
        }
        rows = build_standalone_rows(
            simbad_xids=simbad_xids,
            emitted_keys=set(),
            system_anchors={},
            indices=_indices_with_astrometry(),
        )
        # No anchor + no Gaia astrometry → position-less row, but the row
        # still emits (orbit_role=standalone, position cells empty). All
        # three pair-geometry columns are None.
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0].sep_arcsec)
        self.assertIsNone(rows[0].pa_deg)
        self.assertIsNone(rows[0].sep_pa_epoch_jd)
        self.assertIsNone(rows[0].dmag)


class PhotometryViaTests(unittest.TestCase):
    """Stage 6 emits a per-row ``photometry_via`` tag that captures
    whether the absmag/ci on the row is the COMPONENT's own AT-HYG
    photometry (``athyg_own``), the SYSTEM primary's AT-HYG photometry
    inherited via a shared HIP entry (``athyg_system_inherited``), or
    absent (``none``). Companion promotion uses this tag instead of
    a float-equality heuristic on absmag."""

    def test_primary_with_own_athyg_tags_athyg_own(self) -> None:
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        # Two distinct AT-HYG entries — one per component (the normal
        # case for well-separated visual binaries).
        athyg_a = _athyg_row(gaia=1)
        athyg_b = _athyg_row(gaia=2)
        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(athyg=[athyg_a, athyg_b]),
        )
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0].photometry_via, PHOTOMETRY_VIA_OWN)
        self.assertEqual(rows[1].photometry_via, PHOTOMETRY_VIA_OWN)

    def test_secondary_sharing_primary_athyg_tags_inherited(self) -> None:
        # Sirius A/B shape: both components resolve to the SAME AT-HYG
        # row via HIP fall-through (only one HIP in AT-HYG covers the
        # system). photometry_via on the secondary captures that the
        # absmag/ci it surfaced is the primary's, not its own.
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=None, hip=32349, component="A", is_primary=True),
            _resolved(gaia=None, hip=32349, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        # Single AT-HYG row keyed on HIP 32349 — both components hit it.
        shared_athyg = _athyg_row(hip=32349)
        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(athyg=[shared_athyg]),
        )
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0].photometry_via, PHOTOMETRY_VIA_OWN)
        self.assertEqual(rows[1].photometry_via, PHOTOMETRY_VIA_SYSTEM_INHERITED)

    def test_row_with_no_athyg_tags_none(self) -> None:
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(),  # no AT-HYG entries
        )
        for row in rows:
            self.assertEqual(row.photometry_via, PHOTOMETRY_VIA_NONE)

    def test_standalone_rows_tag_none(self) -> None:
        simbad_xids = {
            ("99999+9999", "X"): SimbadWdsXid(
                simbad_oid=42, simbad_main_id="SIMBAD-X",
                gaia_source_id=None, hip=None,
            ),
        }
        rows = build_standalone_rows(
            simbad_xids=simbad_xids,
            emitted_keys=set(),
            system_anchors={},
            indices=_indices_with_astrometry(),
        )
        self.assertEqual(rows[0].photometry_via, PHOTOMETRY_VIA_NONE)


class GaiaPhotometryAbsmagTests(unittest.TestCase):
    """Stage 6 recovers absmag (and ci) for a WDS component that has its
    own Gaia DR3 5p fit but no AT-HYG row, from the component's own
    G/BP/RP + parallax (``photometry_via=gaia_photometry``). Without it
    the row lands with a blank absmag and companion promotion drops it
    for lacking a brightness."""

    def test_ballesteros_bv_from_teff_mirrors_ts(self) -> None:
        # Python port pinned against the TS canonical
        # (scripts/colour/blackbody-lut-pure.ts) across the range — one
        # point drifts silently at the ends, where a mirror is likeliest
        # to diverge. Hot blue → ~0, solar → 0.652, cool red → ~1.71.
        self.assertAlmostEqual(ballesteros_bv_from_teff(10000.0), 0.010, places=3)
        self.assertAlmostEqual(ballesteros_bv_from_teff(5772.0), 0.652, places=3)
        self.assertAlmostEqual(ballesteros_bv_from_teff(3500.0), 1.712, places=3)

    def test_derive_absmag_ci_solar(self) -> None:
        # G = 4.67 at 10 pc (ϖ = 100 mas) → M_G ≈ 4.67; BP−RP = 0.82
        # (solar) → M_V ≈ 4.82 (Sun 4.83), ci ≈ 0.67 (Sun ~0.65).
        absmag, ci = gaia_photometry_absmag_ci(_gaia_astrometry_row(
            parallax_mas=100.0, g_mag=4.67, bp_mag=5.05, rp_mag=4.23,
        ))
        self.assertAlmostEqual(absmag, 4.82, places=1)
        self.assertAlmostEqual(ci, 0.67, places=1)

    def test_derive_no_bp_rp_raw_m_g_null_ci(self) -> None:
        # ϖ = 10 mas → 100 pc → M_G = G + 5·log10(10) − 10 = G − 5 = 5.0;
        # no BP/RP → raw M_G (no G→V), ci None.
        absmag, ci = gaia_photometry_absmag_ci(
            _gaia_astrometry_row(parallax_mas=10.0, g_mag=10.0),
        )
        self.assertAlmostEqual(absmag, 5.0, places=6)
        self.assertIsNone(ci)

    def test_derive_none_without_g_or_parallax(self) -> None:
        self.assertIsNone(gaia_photometry_absmag_ci(
            _gaia_astrometry_row(parallax_mas=None, g_mag=10.0)))
        self.assertIsNone(gaia_photometry_absmag_ci(
            _gaia_astrometry_row(parallax_mas=10.0, g_mag=None)))
        self.assertIsNone(gaia_photometry_absmag_ci(
            _gaia_astrometry_row(parallax_mas=-1.0, g_mag=10.0)))

    def test_bprp_outside_teff_range_null_ci_but_keeps_absmag(self) -> None:
        # Hot blue star (BP−RP = 0.2, below the Teff polynomial's 0.5
        # floor): absmag still derived via the wider-range G→V transform,
        # ci left None → promotion's spectral/solar ci fallback.
        absmag, ci = gaia_photometry_absmag_ci(_gaia_astrometry_row(
            parallax_mas=10.0, g_mag=6.0, bp_mag=6.1, rp_mag=5.9,
        ))
        self.assertIsNotNone(absmag)
        self.assertIsNone(ci)

    def test_secondary_own_gaia_no_athyg_tags_gaia_photometry(self) -> None:
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        # B has no AT-HYG row; its own Gaia 5p row carries the photometry.
        gaia_b = _gaia_astrometry_row(
            source_id=2, parallax_mas=10.0, g_mag=8.0, bp_mag=8.6, rp_mag=7.4,
        )
        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(
                athyg=[_athyg_row(gaia=1)],  # only the primary
                src_to_astrometry={2: gaia_b},
            ),
        )
        self.assertEqual(rows[1].photometry_via, PHOTOMETRY_VIA_GAIA)
        self.assertIsNotNone(rows[1].absmag)
        self.assertIsNotNone(rows[1].ci)

    def test_excluded_source_absent_from_map_stays_none(self) -> None:
        # astrometry_exclusions removes blended sources from
        # src_to_astrometry at Stage 1 (build-binaries.py), so a component
        # keyed on an excluded source finds no Gaia row here and gets no
        # gaia-photometry absmag — its blended G is not turned into one.
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(
                athyg=[_athyg_row(gaia=1)],
                src_to_astrometry={},  # source 2 excluded → absent
            ),
        )
        self.assertEqual(rows[1].photometry_via, PHOTOMETRY_VIA_NONE)
        self.assertIsNone(rows[1].absmag)

    def test_athyg_photometry_wins_over_gaia(self) -> None:
        # A component WITH its own AT-HYG row keeps athyg_own even when a
        # Gaia photometry row is also present — the gaia path only backs
        # rows AT-HYG doesn't cover.
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(
                athyg=[_athyg_row(gaia=1), _athyg_row(gaia=2)],
                src_to_astrometry={2: _gaia_astrometry_row(
                    source_id=2, g_mag=8.0, bp_mag=8.6, rp_mag=7.4)},
            ),
        )
        self.assertEqual(rows[1].photometry_via, PHOTOMETRY_VIA_OWN)

    def test_non_gaia5p_astrometry_does_not_derive(self) -> None:
        # The gate is astrometry_via=gaia_5p: a component positioned by
        # HIP2 (not its own clean Gaia 5p fit) does not borrow the Gaia
        # row's photometry, since that parallax may be orbit-corrupted.
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, component="A", is_primary=True),
            _resolved(gaia=2, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(
                astrometry_via="hip2_long_baseline", parallax_mas=10.0),
        ]
        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(
                athyg=[_athyg_row(gaia=1)],
                src_to_astrometry={2: _gaia_astrometry_row(
                    source_id=2, g_mag=8.0, bp_mag=8.6, rp_mag=7.4)},
            ),
        )
        self.assertEqual(rows[1].photometry_via, PHOTOMETRY_VIA_NONE)
        self.assertIsNone(rows[1].absmag)

    def test_blend_into_athyg_partner_does_not_derive(self) -> None:
        # Stage 2's blend-identity propagation copies an AT-HYG-backed
        # primary's Gaia source onto a secondary that resolved nothing of
        # its own, so BOTH rows carry one source and the secondary tags
        # gaia_5p — but that source's G is the blended pair's, and the
        # primary already carries the system light through AT-HYG. Deriving
        # here would mint a twin of the primary; the partner-share gate
        # suppresses it. (A's AT-HYG row is keyed by HIP, not the shared
        # Gaia source, so _athyg_row_for_component doesn't catch B for it.)
        pair = _wds_pair(components="AB")
        components = [
            _resolved(gaia=1, hip=100, component="A", is_primary=True),
            _resolved(gaia=1, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[OpticalClassification(True, "wds_notes_kept")],
            indices=_indices_with_astrometry(
                athyg=[_athyg_row(hip=100)],  # A via HIP only, no gaia key
                src_to_astrometry={1: _gaia_astrometry_row(
                    source_id=1, g_mag=8.0, bp_mag=8.6, rp_mag=7.4)},
            ),
        )
        self.assertEqual(rows[1].photometry_via, PHOTOMETRY_VIA_NONE)
        self.assertIsNone(rows[1].absmag)


class WdsDmagTests(unittest.TestCase):
    """``wds_dmag`` returns ``mag_sec − mag_pri`` or ``None`` when
    either magnitude is missing — apparent Δmag = absolute Δmag for two
    components at the same distance, so the runtime can use it
    directly to impute companion absmag."""

    def test_signed_difference(self) -> None:
        # Sirius A V=1.46, Sirius B V=8.49 → Δmag = +7.03 (secondary
        # is dimmer).
        self.assertAlmostEqual(wds_dmag(1.46, 8.49), 7.03, places=4)

    def test_missing_primary_returns_none(self) -> None:
        self.assertIsNone(wds_dmag(None, 8.49))

    def test_missing_secondary_returns_none(self) -> None:
        self.assertIsNone(wds_dmag(1.46, None))


class WdsYearToJdTests(unittest.TestCase):
    """``wds_year_to_jd`` converts a 4-digit observation year to a Julian
    Date anchored at J2000. Sub-day precision is irrelevant — the runtime
    consumer uses the epoch for static-placement projection only."""

    def test_j2000_year_returns_j2000_jd(self) -> None:
        self.assertEqual(wds_year_to_jd(2000), 2451545.0)

    def test_year_offset_uses_julian_year_length(self) -> None:
        # 2020 - 2000 = 20 Julian years × 365.25 d = +7305 d → JD 2458850.
        self.assertEqual(wds_year_to_jd(2020), 2458850.0)

    def test_pre_2000_year_returns_pre_j2000_jd(self) -> None:
        # 1980 - 2000 = -20 Julian years × 365.25 d = -7305 d → JD 2444240.
        self.assertEqual(wds_year_to_jd(1980), 2444240.0)

    def test_none_year_passes_through(self) -> None:
        self.assertIsNone(wds_year_to_jd(None))


class WriteMultiplesTsvTests(unittest.TestCase):
    def test_header_and_row_round_trip(self) -> None:
        row = MultiplesRow(
            system_id="WDS-1-AB", comp="A",
            hip=12345, gaia_source_id=99999,
            x_pc=1.5, y_pc=2.5, z_pc=-3.5,
            absmag=4.5, ci=0.6, spect="G2V", name="Sirius",
            source="athyg", regime=2,
            resolve_via="orb6_hip", astrometry_via="gaia_5p", orbit_via="orb6",
            spect_via="athyg",
            photometry_via="athyg_own",
            a_via="catalog",
            orbit_role="primary",
            P_days=365.25, T_jd=2451545.0, e=0.1, a_AU=1.0,
            i_rad=0.5, omega_rad=0.6, Omega_rad=0.7,
            q=0.5, dist_pc=10.0,
            sep_arcsec=7.123, pa_deg=265.45,
            sep_pa_epoch_jd=2458850.0,
            dmag=7.0234,
        )
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "multiples.tsv"
            n = write_multiples_tsv([row], p)
            self.assertEqual(n, 1)
            lines = p.read_text().splitlines()
        self.assertEqual(len(lines), 2)
        header = lines[0].split("\t")
        self.assertEqual(tuple(header), MULTIPLES_TSV_COLUMNS)
        cells = lines[1].split("\t")
        self.assertEqual(cells[header.index("system_id")], "WDS-1-AB")
        self.assertEqual(cells[header.index("hip")], "12345")
        self.assertEqual(cells[header.index("gaia_source_id")], "99999")
        self.assertEqual(cells[header.index("name")], "Sirius")
        self.assertEqual(cells[header.index("regime")], "2")
        self.assertEqual(cells[header.index("spect_via")], "athyg")
        self.assertEqual(cells[header.index("a_via")], "catalog")
        self.assertEqual(cells[header.index("sep_arcsec")], "7.123")
        self.assertEqual(cells[header.index("pa_deg")], "265.45")
        self.assertEqual(cells[header.index("sep_pa_epoch_jd")], "2458850.0000")
        self.assertEqual(cells[header.index("dmag")], "7.0234")

    def test_empty_optional_fields_emit_empty_cells(self) -> None:
        row = MultiplesRow(
            system_id="WDS-2-AB", comp="A",
            hip=None, gaia_source_id=None,
            x_pc=None, y_pc=None, z_pc=None,
            absmag=None, ci=None, spect="", name="",
            source="wds", regime=0,
            resolve_via="unresolved", astrometry_via="unresolved", orbit_via="none",
            spect_via="none",
            photometry_via="none",
            a_via="none",
            orbit_role="primary",
            P_days=None, T_jd=None, e=None, a_AU=None,
            i_rad=None, omega_rad=None, Omega_rad=None,
            q=None, dist_pc=None,
            sep_arcsec=None, pa_deg=None, sep_pa_epoch_jd=None,
            dmag=None,
        )
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "multiples.tsv"
            write_multiples_tsv([row], p)
            lines = p.read_text().splitlines()
        cells = lines[1].split("\t")
        header = lines[0].split("\t")
        for col in ("hip", "gaia_source_id", "x_pc", "y_pc", "z_pc",
                    "absmag", "ci", "P_days", "T_jd", "e", "a_AU",
                    "i_rad", "omega_rad", "Omega_rad", "q", "dist_pc",
                    "sep_arcsec", "pa_deg", "sep_pa_epoch_jd", "dmag"):
            self.assertEqual(cells[header.index(col)], "",
                             msg=f"empty optional {col} should be empty cell")


class Stage6QFallbackTests(unittest.TestCase):
    """Stage 6 fills q from spectral-class masses when an ORB6 visual
    orbit was emitted but Gaia NSS didn't supply a mass_ratio."""

    def _orbit_orb6(self) -> "OrbitElements":
        return OrbitElements(
            P_days=29133.07, T_jd=2451545.0, e=0.5,
            a_AU=23.0, i_rad=1.0,
            omega_rad=0.2, Omega_rad=0.3,
            q=None,                       # ORB6 visual route — no q
            distance_pc=1.3,
        )

    def _make_pair_fixture(
        self,
        *,
        primary_spect: str,
        secondary_spect: str | None,
        primary_absmag: float = 4.0,
        secondary_absmag: float = 5.0,
        wds_id: str = "00000+0000",
        orbit: "tuple[OrbitElements | None, str]" = (None, "none"),
        has_secondary_athyg: bool = True,
        optical_via: str = "orbit_kept",
    ) -> "tuple[WdsPair, list, list, list, list, IdentifierIndices]":
        athyg_rows = [
            AthygRow(
                hip=None, tyc=None, gaia=1, hd=None,
                ra_deg=0.0, dec_deg=0.0,
                x_pc=0.0, y_pc=0.0, z_pc=0.0,
                dist_pc=10.0, v_mag=None, absmag=primary_absmag,
                ci=None, spect=primary_spect, proper="",
                pm_ra_masyr=None, pm_de_masyr=None,
            ),
        ]
        if has_secondary_athyg:
            athyg_rows.append(
                AthygRow(
                    hip=None, tyc=None, gaia=2, hd=None,
                    ra_deg=0.0, dec_deg=0.0,
                    x_pc=0.0, y_pc=0.0, z_pc=0.0,
                    dist_pc=10.0, v_mag=None, absmag=secondary_absmag,
                    ci=None, spect=secondary_spect, proper="",
                    pm_ra_masyr=None, pm_de_masyr=None,
                ),
            )
        pair = _wds_pair(wds_id=wds_id, components="AB")
        components = [
            _resolved(gaia=1, wds_id=wds_id, component="A", is_primary=True),
            _resolved(gaia=2, wds_id=wds_id, component="B", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=100.0),
            _component_astrometry(parallax_mas=100.0),
        ]
        orbits = [orbit]
        classifications = [OpticalClassification(True, optical_via)]
        indices = _indices_with_astrometry(athyg=athyg_rows)
        return pair, components, astrometry, orbits, classifications, indices

    def test_orb6_visual_fills_q_from_spectral_classes(self) -> None:
        # α Cen-shaped: ORB6 visual orbit, G2V primary + K1V secondary,
        # both with AT-HYG absmag. q is filled on both rows.
        pair, components, astrometry, orbits, classifications, indices = (
            self._make_pair_fixture(
                primary_spect="G2V", secondary_spect="K1V",
                primary_absmag=4.379, secondary_absmag=5.71,
                wds_id="14396-6050", orbit=(self._orbit_orb6(), "orb6"),
            )
        )
        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertEqual(len(rows), 2)
        # Both rows carry the same q (one orbit, both sides of the pair).
        self.assertIsNotNone(rows[0].q)
        self.assertIsNotNone(rows[1].q)
        assert rows[0].q is not None and rows[1].q is not None
        self.assertAlmostEqual(rows[0].q, rows[1].q, places=6)
        # G2V primary (1.0 M_sun) + K1V secondary (0.76) → q ≈ 0.43.
        self.assertAlmostEqual(rows[0].q, 0.432, places=2)

    def test_nss_supplied_q_is_preserved(self) -> None:
        # Gaia NSS already supplied q=0.85. The spectral-class fallback
        # must NOT overwrite it even when both components have spect.
        nss_orbit = OrbitElements(
            P_days=1.0, T_jd=2451545.0, e=0.1,
            a_AU=0.1, i_rad=1.0,
            omega_rad=0.2, Omega_rad=0.3,
            q=0.85,
            distance_pc=26.2,
        )
        pair, components, astrometry, orbits, classifications, indices = (
            self._make_pair_fixture(
                primary_spect="F0V", secondary_spect="A5V",
                primary_absmag=2.088, secondary_absmag=1.048,
                wds_id="22150+5703", orbit=(nss_orbit, "gaia_nss"),
            )
        )
        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0].q, 0.85)
        self.assertEqual(rows[1].q, 0.85)

    def test_orbit_q_present_short_circuits_fallback(self) -> None:
        # The spectral fallback fires only when orbit.q is None: a set
        # orbit.q wins on both rows even though these spectral classes
        # would estimate a DIFFERENT q if the fallback ran.
        nss_orbit = OrbitElements(
            P_days=1.0, T_jd=2451545.0, e=0.1,
            a_AU=0.1, i_rad=1.0,
            omega_rad=0.2, Omega_rad=0.3,
            q=0.85,
            distance_pc=26.2,
        )
        estimated = mass_ratio_from_components("F0V", "A5V")
        self.assertIsNotNone(estimated)
        assert estimated is not None
        self.assertNotAlmostEqual(estimated, 0.85, places=2)
        pair, components, astrometry, orbits, classifications, indices = (
            self._make_pair_fixture(
                primary_spect="F0V", secondary_spect="A5V",
                primary_absmag=2.088, secondary_absmag=1.048,
                wds_id="22150+5703", orbit=(nss_orbit, "gaia_nss"),
            )
        )
        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertEqual(rows[0].q, 0.85)
        self.assertEqual(rows[1].q, 0.85)

    def test_no_q_default_for_orb6_visual_when_spect_missing(self) -> None:
        # ORB6 VISUAL orbit with an unclassifiable secondary: the
        # spectral backfill yields None and the estimated-q backstop
        # deliberately does not fire (visual pairs carry real baked
        # placements — see ESTIMATED_ELEMENT_ORBIT_VIAS).
        pair, components, astrometry, orbits, classifications, indices = (
            self._make_pair_fixture(
                primary_spect="G2V", secondary_spect=None,
                wds_id="00000+0001", orbit=(self._orbit_orb6(), "orb6"),
                has_secondary_athyg=False,
            )
        )
        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertEqual(len(rows), 2)
        self.assertIsNone(rows[0].q)
        self.assertIsNone(rows[1].q)

    def test_q_defaults_on_nss_route_when_spect_missing(self) -> None:
        # Same missing-secondary-spect shape on the gaia_nss route:
        # the unknown-companion default fires — a q-less pair would
        # never clear the runtime's has_orbit gate.
        nss_orbit = OrbitElements(
            P_days=12.5, T_jd=2451545.0, e=0.1,
            a_AU=None, i_rad=None,
            omega_rad=0.2, Omega_rad=None,
            q=None, distance_pc=10.0,
        )
        pair, components, astrometry, orbits, classifications, indices = (
            self._make_pair_fixture(
                primary_spect="G2V", secondary_spect=None,
                wds_id="00000+0003", orbit=(nss_orbit, "gaia_nss"),
                has_secondary_athyg=False,
            )
        )
        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertEqual(rows[0].q, UNKNOWN_COMPANION_MASS_RATIO_Q)
        self.assertEqual(rows[1].q, UNKNOWN_COMPANION_MASS_RATIO_Q)
        self.assertEqual(rows[0].a_via, A_VIA_KEPLER_MASS_ESTIMATE)

    def test_no_q_fill_when_no_orbit(self) -> None:
        # No orbit emitted at all → q is None on both rows even when
        # both have spect. Fallback only kicks in when orbital geometry
        # was resolved but q wasn't.
        pair, components, astrometry, orbits, classifications, indices = (
            self._make_pair_fixture(
                primary_spect="G2V", secondary_spect="K0V",
                wds_id="00000+0002", orbit=(None, "none"),
                optical_via="wds_notes_kept",
            )
        )
        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=orbits, classifications=classifications,
            indices=indices,
        )
        self.assertEqual(len(rows), 2)
        self.assertIsNone(rows[0].q)
        self.assertIsNone(rows[1].q)


class FinalizeRenderableElementsTests(unittest.TestCase):
    def _rows(
        self, orbit: "OrbitElements",
        *, spect: str = "G2V", q: float | None = None,
    ) -> "tuple[MultiplesRow, MultiplesRow]":
        def row(role: str) -> "MultiplesRow":
            return MultiplesRow(
                system_id="W1-AB", comp="A" if role == "primary" else "B",
                hip=None, gaia_source_id=None,
                x_pc=0.0, y_pc=0.0, z_pc=0.0,
                absmag=4.5, ci=None, spect=spect, name="",
                source="athyg", regime=2,
                resolve_via="simbad_xid", astrometry_via="gaia_5p",
                orbit_via="gaia_nss", spect_via="simbad",
                photometry_via="athyg_own",
                a_via=(
                    A_VIA_CATALOG if orbit.a_AU is not None
                    else A_VIA_NONE
                ),
                orbit_role=role,
                P_days=orbit.P_days, T_jd=orbit.T_jd, e=orbit.e,
                a_AU=orbit.a_AU, i_rad=orbit.i_rad,
                omega_rad=orbit.omega_rad, Omega_rad=orbit.Omega_rad,
                q=q, dist_pc=10.0,
                sep_arcsec=0.0, pa_deg=0.0, sep_pa_epoch_jd=None,
                dmag=None,
            )
        return row("primary"), row("secondary")

    def _orbit(
        self, *, P_days: float = 365.25, e: float = 0.1,
        a_AU: float | None = None, omega_rad: float | None = 0.5,
    ) -> "OrbitElements":
        return OrbitElements(
            P_days=P_days, T_jd=2451545.0, e=e, a_AU=a_AU,
            i_rad=None, omega_rad=omega_rad, Omega_rad=None,
            q=None, distance_pc=10.0,
        )

    def test_kepler_a_derived_with_default_q(self) -> None:
        orbit = self._orbit()
        pri, sec = self._rows(orbit)
        finalize_renderable_elements(pri, sec, orbit)
        # G2V → 1.0 M_sun; q defaults to 1/3 → M_total = 1.5;
        # a = 1.5^(1/3) = 1.144714.
        self.assertEqual(pri.q, UNKNOWN_COMPANION_MASS_RATIO_Q)
        self.assertAlmostEqual(pri.a_AU or 0.0, 1.5 ** (1.0 / 3.0), places=9)
        self.assertEqual(pri.a_via, A_VIA_KEPLER_MASS_ESTIMATE)
        self.assertEqual(sec.a_AU, pri.a_AU)
        self.assertEqual(sec.a_via, A_VIA_KEPLER_MASS_ESTIMATE)

    def test_catalog_a_left_alone(self) -> None:
        orbit = self._orbit(a_AU=23.0)
        pri, sec = self._rows(orbit, q=0.4)
        finalize_renderable_elements(pri, sec, orbit)
        self.assertEqual(pri.a_AU, 23.0)
        self.assertEqual(pri.a_via, A_VIA_CATALOG)
        self.assertEqual(pri.q, 0.4)

    def test_circular_orbit_omega_backfilled(self) -> None:
        orbit = self._orbit(e=0.0, omega_rad=None)
        pri, sec = self._rows(orbit)
        finalize_renderable_elements(pri, sec, orbit)
        self.assertEqual(pri.omega_rad, CIRCULAR_ORBIT_OMEGA_RAD)
        self.assertEqual(sec.omega_rad, CIRCULAR_ORBIT_OMEGA_RAD)

    def test_eccentric_orbit_missing_omega_stays_none(self) -> None:
        orbit = self._orbit(e=0.3, omega_rad=None)
        pri, sec = self._rows(orbit)
        finalize_renderable_elements(pri, sec, orbit)
        self.assertIsNone(pri.omega_rad)

    def test_unparseable_primary_spect_uses_default_mass(self) -> None:
        orbit = self._orbit()
        pri, sec = self._rows(orbit, spect="")
        finalize_renderable_elements(pri, sec, orbit)
        # M₁ = 1.0 default, q = 1/3 → identical to the G2V pin.
        self.assertAlmostEqual(pri.a_AU or 0.0, 1.5 ** (1.0 / 3.0), places=9)

    def test_no_orbit_is_noop(self) -> None:
        pri, sec = self._rows(self._orbit())
        finalize_renderable_elements(pri, sec, None)
        self.assertIsNone(pri.q)
        self.assertIsNone(pri.a_AU)

    def test_orb6_visual_route_is_noop(self) -> None:
        orbit = self._orbit(e=0.0, omega_rad=None)
        pri, sec = self._rows(orbit)
        pri.orbit_via = sec.orbit_via = "orb6"
        finalize_renderable_elements(pri, sec, orbit)
        self.assertIsNone(pri.q)
        self.assertIsNone(pri.a_AU)
        self.assertIsNone(pri.omega_rad)


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
    ) -> tuple["WdsPair", list["ResolvedComponent"]]:
        pair = _wds_pair(
            wds_id=wds_id, components=components,
            rho_last=rho, theta_last=theta,
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
    ) -> dict[tuple[str, str], tuple[float, float]]:
        pairs, comps, classifications = [], [], []
        for components, rho, theta, kept in specs:
            p, c = self._pair_with_comps(components, rho, theta)
            pairs.append(p)
            comps.extend(c)
            classifications.append(OpticalClassification(
                kept, "wds_notes_kept" if kept else "wds_notes_rejected",
            ))
        return compute_anchor_offsets(pairs, comps, classifications)

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

    def test_sub_resolution_rows_contribute_no_edge(self) -> None:
        out = self._offsets([
            ("AB", 5.0, 90.0, True),
            ("Ba,Bb", 0.0, None, True),
        ])
        self.assertNotIn(("WDS-1", "Ba"), out)
        self.assertNotIn(("WDS-1", "Bb"), out)

    def test_system_with_no_kept_pairs_emits_nothing(self) -> None:
        out = self._offsets([("AB", 5.0, 90.0, False)])
        self.assertEqual(out, {})


class MscStage6Tests(unittest.TestCase):
    def _indices_with_msc(self, lk):
        return build_indices([], [], {}, {}, {}, msc=lk)

    def test_resolve_spect_msc_between_simbad_and_athyg(self) -> None:
        from scripts.binaries import stage6_multiples as s6
        lk = MscLookup()
        lk.spect_by_comp[("W", "Ab")] = "A6"
        lk.spect_by_comp[("W", "B")] = "K1V"
        indices = build_indices(
            [], [], {}, {}, {},
            simbad_wds_spectra={("W", "B"): "G5V"},
            msc=lk,
        )
        athyg = _athyg_row(gaia=1)
        athyg.spect = "B3V"
        self.assertEqual(
            _resolve_spect("W", "Ab", athyg, indices), ("A6", "msc"),
        )
        self.assertEqual(
            _resolve_spect("W", "B", athyg, indices), ("G5V", "simbad"),
        )
        self.assertEqual(
            _resolve_spect("W", "C", athyg, indices), ("B3V", "athyg"),
        )

    def test_pair_mags_fill_from_msc_when_wds_has_none(self) -> None:
        pair = _wds_pair(components="Aa,Ab", mag_pri=None, mag_sec=None)
        lk = MscLookup()
        lk.pair_mags[("WDS-1", ("Aa", "Ab"))] = (5.02, 7.42)
        components = [
            _resolved(gaia=1, component="Aa", is_primary=True),
            _resolved(gaia=1, component="Ab", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        msc_mag_fills: list[str] = []
        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[OpticalClassification(True, "orbit_kept")],
            indices=self._indices_with_msc(lk),
            msc_mag_fills=msc_mag_fills,
        )
        self.assertEqual(len(rows), 2)
        for row in rows:
            self.assertEqual((row.mag_pri, row.mag_sec), (5.02, 7.42))
            self.assertAlmostEqual(row.dmag, 2.4)
        self.assertEqual(msc_mag_fills, ["WDS-1Aa,Ab"])

    def test_wds_mags_never_overwritten(self) -> None:
        pair = _wds_pair(components="Aa,Ab", mag_pri=4.0, mag_sec=6.0)
        lk = MscLookup()
        lk.pair_mags[("WDS-1", ("Aa", "Ab"))] = (5.02, 7.42)
        components = [
            _resolved(gaia=1, component="Aa", is_primary=True),
            _resolved(gaia=1, component="Ab", is_primary=False),
        ]
        astrometry = [
            _component_astrometry(parallax_mas=10.0),
            _component_astrometry(parallax_mas=10.0),
        ]
        rows = build_multiples_rows(
            pairs=[pair], components=components, astrometry=astrometry,
            orbits=[(None, "none")],
            classifications=[OpticalClassification(True, "orbit_kept")],
            indices=self._indices_with_msc(lk),
        )
        self.assertEqual((rows[0].mag_pri, rows[0].mag_sec), (4.0, 6.0))


if __name__ == "__main__":
    unittest.main()


if __name__ == "__main__":
    unittest.main()
