#!/usr/bin/env python3
"""Unit tests for refresh-gaia-magnitude.py: the slice partition, the ADQL
shape, and the floor / overlap gates. Run directly — the kebab filename
trips ``python -m unittest``."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "util"))

import refresh_lib as rl  # noqa: E402
from test_helpers import FakeTable, fake_tap_client, load_kebab_sibling  # noqa: E402

mag = load_kebab_sibling(__file__, "refresh_gaia_magnitude", "refresh-gaia-magnitude.py")
gap = sys.modules["gaia_astrometry_pull"]


def _row(source_id: int, g_mag: float, **overrides):
    row = {col: 0.0 for col in gap.TSV_COLUMNS}
    row.update(
        source_id=source_id,
        ref_epoch=2016.0,
        ipd_frac_multi_peak=0,
        phot_g_mean_mag=g_mag,
    )
    row.update(overrides)
    return row


def _quiet(_message: str) -> None:
    pass


def _table(rows):
    return FakeTable(rows, gap.TSV_COLUMNS)


class MagnitudeSliceTests(unittest.TestCase):
    def test_emits_one_slice_per_configured_count(self) -> None:
        self.assertEqual(len(mag.magnitude_slices()), mag.SLICE_COUNT)

    def test_first_slice_is_open_at_the_bright_end(self) -> None:
        # A source brighter than any computed edge must still be pulled.
        self.assertIsNone(mag.magnitude_slices()[0][0])
        self.assertIsNotNone(mag.magnitude_slices()[1][0])

    def test_last_slice_closes_exactly_on_the_floor(self) -> None:
        self.assertEqual(
            mag.magnitude_slices()[-1][1], f"{mag.G_MAG_FLOOR:.{mag.EDGE_DECIMALS}f}"
        )

    def test_consecutive_slices_share_the_edge_string(self) -> None:
        slices = mag.magnitude_slices()
        for (_, hi), (lo, _) in zip(slices, slices[1:]):
            self.assertEqual(hi, lo)

    def test_edges_increase_monotonically(self) -> None:
        edges = [float(hi) for _, hi in mag.magnitude_slices()]
        self.assertEqual(edges, sorted(edges))

    def test_slices_are_near_equal_in_expected_population(self) -> None:
        # The geometric spacing is the whole reason the pull is not one
        # 27x-heavier final slice. Populations follow ratio**G.
        edges = [float(hi) for _, hi in mag.magnitude_slices()]
        shares = [mag.SOURCES_PER_MAGNITUDE**e for e in edges]
        populations = [b - a for a, b in zip([0.0, *shares], shares)]
        self.assertLess(max(populations) / min(populations), 1.05)


class SliceAdqlTests(unittest.TestCase):
    def test_open_slice_states_only_the_upper_bound(self) -> None:
        adql = mag.slice_adql((None, "6.737800"))
        self.assertIn("WHERE phot_g_mean_mag <= 6.737800", adql)
        self.assertNotIn(">", adql)

    def test_bounded_slice_is_half_open_upward(self) -> None:
        adql = mag.slice_adql(("6.737800", "7.500900"))
        self.assertIn(
            "WHERE phot_g_mean_mag > 6.737800 AND phot_g_mean_mag <= 7.500900", adql
        )

    def test_projection_is_the_shared_schema(self) -> None:
        self.assertTrue(mag.slice_adql((None, "1.0")).startswith(gap.SELECT_CLAUSE))


class FloorGateTests(unittest.TestCase):
    def test_accepts_a_row_on_the_floor(self) -> None:
        mag.assert_within_floor(1, mag.G_MAG_FLOOR)

    def test_rejects_a_row_above_the_floor(self) -> None:
        with self.assertRaises(SystemExit):
            mag.assert_within_floor(1, mag.G_MAG_FLOOR + 1e-6)

    def test_rejects_a_null_magnitude(self) -> None:
        with self.assertRaises(SystemExit):
            mag.assert_within_floor(1, None)


class PartitionGateTests(unittest.TestCase):
    def test_accepts_distinct_source_ids(self) -> None:
        mag.assert_partitioned([(1, "a"), (2, "b")])

    def test_rejects_a_source_id_returned_twice(self) -> None:
        with self.assertRaises(SystemExit):
            mag.assert_partitioned([(1, "a"), (1, "b")])


class PullTests(unittest.TestCase):
    def test_collects_every_slice_and_formats_lines(self) -> None:
        client = fake_tap_client(
            rl, lambda _q: _table([_row(7, 4.5), _row(3, 4.75)])
        )
        rows, _ = mag.pull(client, checkpoint=None, log=_quiet)
        self.assertEqual(len(rows), 2 * mag.SLICE_COUNT)
        source_id, line = rows[0]
        self.assertEqual(source_id, 7)
        self.assertEqual(len(line.split("\t")), len(gap.TSV_COLUMNS))

    def test_a_row_past_the_floor_fails_the_pull(self) -> None:
        client = fake_tap_client(rl, lambda _q: _table([_row(7, 12.0)]))
        with self.assertRaises(SystemExit):
            mag.pull(client, checkpoint=None, log=_quiet)

    def test_pinned_rows_are_kept_raw_for_the_spot_checks(self) -> None:
        pinned = mag.SPOT_CHECKS[1]["source_id"]
        client = fake_tap_client(
            rl, lambda _q: _table([_row(pinned, 8.193974), _row(11, 8.2)])
        )
        _, spot_rows = mag.pull(client, checkpoint=None, log=_quiet)
        self.assertEqual(list(spot_rows), [pinned])


class WriteTests(unittest.TestCase):
    def test_output_is_sorted_by_source_id(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "magnitude.tsv"
            rows = sorted([(9, "9\tb"), (2, "2\ta")], key=lambda r: r[0])
            rl.write_tsv_lines((line for _, line in rows), ["source_id", "x"], out)
            self.assertEqual(
                out.read_text().splitlines(), ["source_id\tx", "2\ta", "9\tb"]
            )

    def test_an_overlapping_slice_fails_before_the_tsv_is_written(self) -> None:
        # The gate has to precede the write: a partition fault that still
        # committed its TSV would ship a silently doubled pull under a count
        # the row-count band is wide enough to accept.
        import contextlib
        import io as _io
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "magnitude.tsv"
            saved = (mag.OUT, rl.gaia_sync_client, rl.BatchCheckpoint)
            mag.OUT = out
            rl.gaia_sync_client = lambda _maxrec: fake_tap_client(
                rl, lambda _q: _table([_row(7, 4.5)])
            )
            rl.BatchCheckpoint = lambda _path: None
            try:
                with self.assertRaises(SystemExit) as caught, (
                    contextlib.redirect_stdout(_io.StringIO())
                ):
                    mag.main()
            finally:
                mag.OUT, rl.gaia_sync_client, rl.BatchCheckpoint = saved
            # Named, because the row-count band rejects this fixture too and a
            # bare SystemExit would pass with the partition gate deleted.
            self.assertIn("more than one slice", str(caught.exception))
            self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
