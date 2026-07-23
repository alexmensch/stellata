#!/usr/bin/env python3
"""Stdlib-unittest pins for scripts/binaries/mass_estimate.py."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.binaries.mass_estimate import (  # noqa: E402
    WD_MASS_DEFAULT,
    mass_from_spectral_class,
    mass_ratio_from_components,
    parse_spectral_type,
)


class ParseSpectralTypeTests(unittest.TestCase):
    def test_plain_main_sequence(self) -> None:
        p = parse_spectral_type("G2V")
        assert p is not None
        self.assertEqual((p.classIdx, p.subclass, p.lumClass), (4, 2, 2))
        self.assertFalse(p.isWhiteDwarf)

    def test_subclass_fractional_truncates_to_integer(self) -> None:
        p = parse_spectral_type("M3.5V")
        assert p is not None
        self.assertEqual((p.classIdx, p.subclass, p.lumClass), (6, 3, 2))

    def test_white_dwarf_da_with_temperature_subclass(self) -> None:
        p = parse_spectral_type("DA1.9")
        assert p is not None
        self.assertTrue(p.isWhiteDwarf)
        self.assertEqual(p.lumClass, 0)

    def test_white_dwarf_composite_subtype(self) -> None:
        # Procyon B's SIMBAD sp_type is "DQZ" — multi-letter composite.
        p = parse_spectral_type("DQZ")
        assert p is not None
        self.assertTrue(p.isWhiteDwarf)

    def test_subgiant_iv(self) -> None:
        p = parse_spectral_type("F5IV-V")
        assert p is not None
        # IV beats V because the regex anchors at the start of the
        # post-subclass window. F5IV-V → IV.
        self.assertEqual((p.classIdx, p.subclass, p.lumClass), (3, 5, 3))

    def test_giant_iii(self) -> None:
        p = parse_spectral_type("K0III")
        assert p is not None
        self.assertEqual((p.classIdx, p.subclass, p.lumClass), (5, 0, 4))

    def test_supergiant_ia(self) -> None:
        p = parse_spectral_type("B8Ia")
        assert p is not None
        self.assertEqual((p.classIdx, p.subclass, p.lumClass), (1, 8, 8))

    def test_supergiant_iab(self) -> None:
        p = parse_spectral_type("M1Iab")
        assert p is not None
        self.assertEqual(p.lumClass, 7)

    def test_yerkes_dwarf_prefix_overrides_lum_class(self) -> None:
        p = parse_spectral_type("dM4.0")
        assert p is not None
        self.assertEqual((p.classIdx, p.subclass, p.lumClass), (6, 4, 2))

    def test_yerkes_giant_prefix(self) -> None:
        p = parse_spectral_type("gK0")
        assert p is not None
        self.assertEqual((p.classIdx, p.lumClass), (5, 4))

    def test_subdwarf(self) -> None:
        p = parse_spectral_type("sdB5")
        assert p is not None
        self.assertEqual((p.classIdx, p.subclass, p.lumClass), (1, 5, 1))

    def test_wolf_rayet_lands_in_carbon_bucket(self) -> None:
        p = parse_spectral_type("WN5")
        assert p is not None
        self.assertEqual(p.classIdx, 7)

    def test_empty_returns_none(self) -> None:
        self.assertIsNone(parse_spectral_type(""))
        self.assertIsNone(parse_spectral_type(None))
        self.assertIsNone(parse_spectral_type("   "))

    def test_unknown_first_letter_returns_none(self) -> None:
        self.assertIsNone(parse_spectral_type("XYZ"))


class MassFromSpectralClassTests(unittest.TestCase):
    def test_solar_analog_g2v_near_one_solar_mass(self) -> None:
        m = mass_from_spectral_class("G2V")
        assert m is not None
        self.assertAlmostEqual(m, 1.0, places=2)

    def test_a1v_near_two_point_six(self) -> None:
        # Sirius A: A1V. Per the MS table A1V → 2.6 M_sun (Pecaut/Mamajek
        # zero-age values; true Sirius A = 2.06 M_sun, but the table is
        # a generic A1V anchor not a Sirius-specific calibration).
        m = mass_from_spectral_class("A1V")
        assert m is not None
        self.assertAlmostEqual(m, 2.6, places=2)

    def test_white_dwarf_default_mass(self) -> None:
        m = mass_from_spectral_class("DA1.9")
        self.assertEqual(m, WD_MASS_DEFAULT)

    def test_white_dwarf_dqz_default_mass(self) -> None:
        # Procyon B is DQZ — composite-subtype WD; still gets the
        # default 0.6 M_sun.
        m = mass_from_spectral_class("DQZ")
        self.assertEqual(m, WD_MASS_DEFAULT)

    def test_k1v_companion_mass(self) -> None:
        m = mass_from_spectral_class("K1V")
        assert m is not None
        self.assertAlmostEqual(m, 0.76, places=2)

    def test_giant_k0iii(self) -> None:
        m = mass_from_spectral_class("K0III")
        assert m is not None
        # Cox 2000: K III ≈ 1.5 M_sun.
        self.assertAlmostEqual(m, 1.5, places=2)

    def test_supergiant_b0ia(self) -> None:
        m = mass_from_spectral_class("B0Ia")
        assert m is not None
        # Supergiant table B0Ia is at the high end; mass ~25 M_sun.
        self.assertAlmostEqual(m, 25.0, places=1)

    def test_unparseable_returns_none(self) -> None:
        self.assertIsNone(mass_from_spectral_class(""))
        self.assertIsNone(mass_from_spectral_class(None))
        self.assertIsNone(mass_from_spectral_class("???"))

    def test_subgiant_interpolates_between_ms_and_giant(self) -> None:
        # G2IV should land between G2V (~1.0) and G2III (~2.1).
        m_ms = mass_from_spectral_class("G2V")
        m_iv = mass_from_spectral_class("G2IV")
        m_iii = mass_from_spectral_class("G2III")
        assert m_ms is not None and m_iv is not None and m_iii is not None
        self.assertGreater(m_iv, m_ms)
        self.assertLess(m_iv, m_iii)

    def test_subgiant_f5iv_matches_procyon_a_published_mass(self) -> None:
        # External anchor for the IV interpolation weights: Procyon A
        # (F5IV) has a dynamically measured 1.478 ± 0.05 M_sun (Bond et
        # al. 2015, astrometric orbit). The generic F5IV table value
        # (0.55·1.8 + 0.45·1.4 = 1.62) must stay within 10% of it.
        m_iv = mass_from_spectral_class("F5IV")
        assert m_iv is not None
        self.assertAlmostEqual(m_iv, 1.62, places=4)
        self.assertAlmostEqual(m_iv, 1.478, delta=0.148)


class MassRatioFromComponentsTests(unittest.TestCase):
    def test_sirius_like_wd_primary_ms_a1v(self) -> None:
        # Sirius A (A1V) + Sirius B (DA1.9 WD). Model: M_A=2.6, M_B=0.6
        # → q = 0.6 / (2.6 + 0.6) = 0.1875. True external value is 0.33
        # (M_B=1.0, off-track from the WD default); model improves on
        # the q=None baseline but cannot recover Sirius B's anomalously
        # high mass from sp_type alone.
        q = mass_ratio_from_components("A1V", "DA1.9")
        assert q is not None
        self.assertAlmostEqual(q, 0.1875, places=3)

    def test_procyon_like_subgiant_primary_wd(self) -> None:
        # Procyon A (F5IV-V) + Procyon B (DQZ WD). Model: M_A is the
        # IV interpolation between F5V (1.4) and F5III (1.8) → 1.62,
        # M_B = 0.6 → q = 0.6 / 2.22.
        q = mass_ratio_from_components("F5IV-V", "DQZ")
        assert q is not None
        self.assertAlmostEqual(q, 0.2703, places=4)

    def test_alpha_cen_like_g2v_plus_k1v(self) -> None:
        # α Cen A (G2V) + α Cen B (K1V). Model: M_A=1.0, M_B=0.76 →
        # q ≈ 0.43. External truth (Pourbaix 2016): q=0.453. The MS+MS
        # case lands within ~5% of the external value because there is
        # no WD mass-recovery uncertainty.
        q = mass_ratio_from_components("G2V", "K1V")
        assert q is not None
        self.assertAlmostEqual(q, 0.4318, places=4)

    def test_returns_none_when_primary_spect_unparseable(self) -> None:
        self.assertIsNone(mass_ratio_from_components("", "K1V"))

    def test_returns_none_when_secondary_spect_unparseable(self) -> None:
        self.assertIsNone(mass_ratio_from_components("G2V", ""))


if __name__ == "__main__":
    unittest.main()
