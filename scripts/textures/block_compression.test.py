"""Stdlib unittest pins for the reference BC4/BC5 codec.
Run directly: `python3 block_compression.test.py`; not in CI.
"""

import unittest

import numpy as np

from measure_block_compression import BLOCK, encode_bc5


class TestEncodeBc5(unittest.TestCase):
    def test_constant_block_is_exact(self) -> None:
        # Mode 6 puts both endpoints on the same value; nothing may move.
        plane = np.full((BLOCK, BLOCK * 2), 137, dtype=np.uint8)
        np.testing.assert_array_equal(encode_bc5(plane), plane)

    def test_endpoints_are_exact(self) -> None:
        # Both modes store the block min and max verbatim, so the extremes
        # of a ramp survive even when the interior quantises.
        plane = np.tile(np.arange(0, 256, 16, dtype=np.uint8), (BLOCK, 1))
        out = encode_bc5(plane)
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
        out = encode_bc5(plane).astype(np.int32)
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
        err = np.abs(encode_bc5(plane).astype(np.int32) - plane.astype(np.int32))
        self.assertLessEqual(err.max(), 2)

    def test_unsigned_wraparound_does_not_reach_the_distance_metric(self) -> None:
        # The trap this codec was first written into: uint8 subtraction wraps,
        # so |a - b| on raw uint8 picks the wrong palette entry for any block
        # spanning more than half the range, and the measured error inflates.
        plane = np.zeros((BLOCK, BLOCK), dtype=np.uint8)
        plane[0, :] = 250
        plane[1:, :] = 5
        out = encode_bc5(plane)
        self.assertEqual(out[0, 0], 250)
        self.assertEqual(out[1, 0], 5)


if __name__ == '__main__':
    unittest.main()
