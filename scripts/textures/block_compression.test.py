"""Stdlib unittest pins for the reference BC4/BC5 codec.
Run directly: `python3 block_compression.test.py`; not in CI.
"""

import unittest

import numpy as np

from measure_block_compression import BLOCK, encode_bc4_plane, encode_bc5


class TestEncodeBc4Plane(unittest.TestCase):
    def test_constant_block_is_exact(self) -> None:
        # Both modes put their endpoints on the block min and max, which for a
        # constant block are the same value; nothing may move.
        plane = np.full((BLOCK, BLOCK * 2), 137, dtype=np.uint8)
        np.testing.assert_array_equal(encode_bc4_plane(plane), plane)

    def test_endpoints_are_exact(self) -> None:
        # Both modes store the block min and max verbatim, so the extremes
        # of a ramp survive even when the interior quantises.
        plane = np.tile(np.arange(0, 256, 16, dtype=np.uint8), (BLOCK, 1))
        out = encode_bc4_plane(plane)
        for b in range(plane.shape[1] // BLOCK):
            sl = slice(b * BLOCK, (b + 1) * BLOCK)
            self.assertEqual(out[:, sl].min(), plane[:, sl].min())
            self.assertEqual(out[:, sl].max(), plane[:, sl].max())

    def test_error_is_bounded_by_the_palette_step(self) -> None:
        # Mode 8 spreads eight codes across the block range (step range/7);
        # mode 6 spends two on 0 and 255 and spreads six (step range/5). The
        # encoder picks by TOTAL block error, so a single texel is bounded by
        # the coarser of the two. Random data is the pathological case for a
        # block codec — a real normal map is far smoother.
        rng = np.random.default_rng(7)
        plane = rng.integers(0, 256, size=(64, 128), dtype=np.uint8)
        out = encode_bc4_plane(plane).astype(np.int32)
        src = plane.astype(np.int32)
        for by in range(plane.shape[0] // BLOCK):
            for bx in range(plane.shape[1] // BLOCK):
                ys = slice(by * BLOCK, (by + 1) * BLOCK)
                xs = slice(bx * BLOCK, (bx + 1) * BLOCK)
                block = src[ys, xs]
                span = block.max() - block.min()
                self.assertLessEqual(
                    np.abs(out[ys, xs] - block).max(), span / 10 + 1)

    def test_smooth_data_round_trips_near_exactly(self) -> None:
        # A gentle ramp is what a normal map mostly is; BC5 should be
        # within a code value or two of exact on it.
        y, x = np.mgrid[0:64, 0:128]
        plane = (128 + 0.3 * x + 0.2 * y).astype(np.uint8)
        err = np.abs(encode_bc4_plane(plane).astype(np.int32) - plane.astype(np.int32))
        self.assertLessEqual(err.max(), 2)

    def test_unsigned_wraparound_does_not_reach_the_distance_metric(self) -> None:
        # The trap this codec was first written into: uint8 subtraction wraps,
        # so |a - b| on raw uint8 picks the wrong palette entry for any block
        # spanning more than half the range, and the measured error inflates.
        #
        # It has to be an INTERIOR texel. A block's min and max are exact
        # palette entries under both the wrapping and the widened metric —
        # distance 0 either way — so a fixture asserting only the extremes
        # passes against the bug it is named for.
        plane = np.full((BLOCK, BLOCK), 100, dtype=np.uint8)
        plane[0, 0] = 250
        plane[0, 1] = 5
        out = encode_bc4_plane(plane)
        # Endpoints, exact under either metric — the part that proves nothing.
        self.assertEqual(out[0, 0], 250)
        self.assertEqual(out[0, 1], 5)
        # The interior. Widened: nearest code to 100 is 103. Wrapping:
        # |100 - 250| reads 106 and |100 - 55| reads 45, so it lands on 54.
        self.assertEqual(out[1, 1], 103)


class TestEncodeBc5(unittest.TestCase):
    def test_encodes_the_two_planes_independently(self) -> None:
        # BC5 is two BC4 blocks with their own endpoints, so a channel that
        # is constant must survive a channel that is not.
        rg = np.zeros((BLOCK, BLOCK, 2), dtype=np.uint8)
        rg[..., 0] = np.tile(np.array([0, 90, 170, 255], dtype=np.uint8), (BLOCK, 1))
        rg[..., 1] = 137
        out = encode_bc5(rg)
        self.assertEqual(out.shape, rg.shape)
        np.testing.assert_array_equal(out[..., 1], rg[..., 1])
        np.testing.assert_array_equal(
            out[..., 0], encode_bc4_plane(rg[..., 0]))


if __name__ == '__main__':
    unittest.main()
