#!/usr/bin/env python3
"""Stdlib-unittest pins for horizon_map.py: the spherical elevation-angle
geometry, azimuth registration, the limb identity and the encoding round-trip.
Run directly: python3 horizon_map.test.py (needs NumPy)."""

from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dem_relief import DEM_BODIES  # noqa: E402
from horizon_map import (  # noqa: E402
    HORIZON_AZIMUTHS,
    HORIZON_SIN_RANGE,
    decode_horizon_sin,
    encode_horizon,
    horizon_angles,
    search_arc,
)

# Narrow enough to run in a second. The output width is the DEM width in every
# case below, so registration is read exactly rather than through box_reduce.
W = 512
H = W // 2
MOON = DEM_BODIES["moon"]
R_MOON = MOON["radius_km"] * 1000.0

# Azimuth 0 is east and they run toward north — the order the two shipped
# planes concatenate in, and the order the mesh shader indexes.
AZIMUTHS = ("E", "NE", "N", "NW", "W", "SW", "S", "SE")


def limb_sin(ground_m: float, summit_m: float) -> float:
    """`limbSin` in surface-relief-pure.ts: sine of the depression ground at
    `summit_m` can still see the sun at, over terrain at `ground_m`."""
    return math.sqrt(max(0.0, 1 - (ground_m / summit_m) ** 2))


def first_step(spec: dict, dem_width: int = W) -> float:
    """The march's first sample. Nothing closer than this is ever tested, so it
    alone sets what flat ground at the reference sphere reads."""
    psi_max = search_arc(spec)
    return psi_max / math.ceil(psi_max / (2 * math.pi / dem_width))


def flat_floor(spec: dict, dem_width: int = W) -> float:
    """Horizon angle of flat ground at the reference sphere: the sphere falling
    away over that first step, and NOT zero."""
    psi = first_step(spec, dem_width)
    return math.atan2(math.cos(psi) - 1, math.sin(psi))


class SearchArcTests(unittest.TestCase):
    def test_is_the_renderers_fallback_limb_bound(self) -> None:
        """One quantity: a body that changes its DEM span cannot leave the
        precompute searching the distance the old span implied."""
        for name, spec in DEM_BODIES.items():
            r = spec["radius_km"] * 1000.0
            expected = limb_sin(r + spec["span_m"][0], r + spec["span_m"][1])
            self.assertAlmostEqual(
                math.sin(search_arc(spec)), expected, places=12, msg=name
            )

    def test_covers_hundreds_of_kilometres(self) -> None:
        arcs_km = {
            name: search_arc(spec) * spec["radius_km"]
            for name, spec in DEM_BODIES.items()
        }
        self.assertEqual(
            {k: round(v) for k, v in arcs_km.items()},
            {"moon": 262, "mercury": 219, "mars": 446},
        )


class FlatGroundTests(unittest.TestCase):
    def test_reads_the_curvature_drop_over_the_first_step(self) -> None:
        """Flat ground reads the first step's own drop, not 0 — the sun stays up
        that far past the geometric terminator. Bounded, and it is why the
        composition's coarse-map slack runs toward lighting, never shadowing."""
        angles = horizon_angles(np.zeros((H, W), np.float32), MOON, 8, W)
        expected = flat_floor(MOON)
        self.assertAlmostEqual(math.degrees(expected), -0.332571, places=5)
        self.assertEqual(np.ptp(angles), 0.0)
        self.assertAlmostEqual(float(angles[0, 0, 0]), expected, places=6)

    def test_the_floor_follows_the_dem_step_not_the_output_grid(self) -> None:
        """Refining the DEM refines the floor with the output width held fixed,
        which is what stepping at the output texel would forfeit. The step count
        is a ceiling, so the two floors are not a clean factor of two apart."""
        coarse = horizon_angles(np.zeros((H, W), np.float32), MOON, 8, W)
        fine = horizon_angles(np.zeros((2 * H, 2 * W), np.float32), MOON, 8, W)
        self.assertAlmostEqual(float(fine[0, 0, 0]), flat_floor(MOON, 2 * W), places=6)
        self.assertLess(abs(float(fine[0, 0, 0])), abs(float(coarse[0, 0, 0])))


class AzimuthRegistrationTests(unittest.TestCase):
    """A skyline pinned to the wrong azimuth shades real terrain lit from the
    wrong side and looks entirely plausible doing it, so the handedness is
    pinned here rather than left to the browser."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.row, cls.col = H // 2, W // 2
        elev = np.zeros((H, W), np.float32)
        elev[cls.row, cls.col + 1] = 20000.0
        cls.angles = horizon_angles(elev, MOON, 8, W)
        cls.floor = flat_floor(MOON)

    def by_name(self, col: int) -> dict[str, float]:
        return dict(zip(AZIMUTHS, (float(v) for v in self.angles[self.row, col])))

    def test_a_wall_due_east_lands_on_azimuth_zero(self) -> None:
        seen = self.by_name(self.col)
        self.assertEqual(max(seen, key=lambda k: seen[k]), "E")
        self.assertGreater(seen["E"], math.radians(20))

    def test_the_azimuths_it_cannot_be_seen_from_stay_at_the_floor(self) -> None:
        seen = self.by_name(self.col)
        for name in ("N", "NW", "W", "SW", "S"):
            self.assertAlmostEqual(seen[name], self.floor, places=9, msg=name)

    def test_the_two_diagonals_bracketing_east_agree(self) -> None:
        seen = self.by_name(self.col)
        self.assertAlmostEqual(seen["NE"], seen["SE"], places=4)
        self.assertLess(seen["NE"], seen["E"])
        self.assertGreater(seen["NE"], self.floor)

    def test_the_far_side_sees_the_same_wall_due_west(self) -> None:
        """East and west are one axis read from both ends: the texel beyond the
        wall must see it at azimuth 4 exactly as strongly."""
        east_of_wall = self.by_name(self.col + 2)
        self.assertEqual(
            max(east_of_wall, key=lambda k: east_of_wall[k]), "W"
        )
        self.assertAlmostEqual(
            east_of_wall["W"], self.by_name(self.col)["E"], places=6
        )


class LimbBoundTests(unittest.TestCase):
    def test_a_summit_sees_the_sun_down_to_its_own_limb_bound(self) -> None:
        """The whole point of the height term: an isolated summit reads a
        NEGATIVE skyline, and it is the same bound the shader falls back to
        while the maps load (`reliefHorizonSines`'s `full`)."""
        summit_m = MOON["span_m"][1]
        elev = np.zeros((H, W), np.float32)
        elev[H // 2, W // 2] = summit_m
        angles = horizon_angles(elev, MOON, 8, W)
        bound = math.asin(limb_sin(R_MOON, R_MOON + summit_m))
        self.assertAlmostEqual(math.degrees(bound), 6.360, places=3)
        for a, name in enumerate(AZIMUTHS):
            got = float(angles[H // 2, W // 2, a])
            self.assertLessEqual(got, -bound, msg=name)
            self.assertGreater(got, -bound - math.radians(0.02), msg=name)


class EncodingTests(unittest.TestCase):
    @staticmethod
    def planes_of(angles: np.ndarray) -> np.ndarray:
        first, second = encode_horizon(angles)
        return np.concatenate([first, second], axis=2).astype(np.float32)

    def ramp(self) -> np.ndarray:
        """One distinct sine per azimuth, spread across the encoding range."""
        angles = np.zeros((2, 2, HORIZON_AZIMUTHS), np.float32)
        for k in range(HORIZON_AZIMUTHS):
            angles[..., k] = math.asin((k - 3.5) / 10.0)
        return angles

    def test_splits_the_azimuths_four_and_four(self) -> None:
        first, second = encode_horizon(self.ramp())
        self.assertEqual(first.shape, (2, 2, 4))
        self.assertEqual(second.shape, (2, 2, 4))
        self.assertEqual(first.dtype, np.uint8)

    def test_each_azimuth_decodes_off_its_own_bearing(self) -> None:
        """Round-trips within half a quantisation step, and the bearing → slot
        walk lands on the channel the wall tests put the signal in."""
        planes = self.planes_of(self.ramp())
        lsb = 2 * HORIZON_SIN_RANGE / 255
        bearings = ((1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1))
        for k, (east, north) in enumerate(bearings):
            got = decode_horizon_sin(
                planes, np.full((2, 2), float(east)), np.full((2, 2), float(north))
            )
            self.assertAlmostEqual(
                float(got[0, 0]), (k - 3.5) / 10.0, delta=lsb / 2, msg=AZIMUTHS[k]
            )

    def test_clamps_beyond_the_encoding_range(self) -> None:
        steep = np.full((1, 1, HORIZON_AZIMUTHS), math.radians(80), np.float32)
        planes = self.planes_of(steep)
        got = decode_horizon_sin(planes, np.ones((1, 1)), np.zeros((1, 1)))
        self.assertAlmostEqual(float(got[0, 0]), HORIZON_SIN_RANGE, places=6)


if __name__ == "__main__":
    unittest.main()
