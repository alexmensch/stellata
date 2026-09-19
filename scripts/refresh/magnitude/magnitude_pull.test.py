#!/usr/bin/env python3
"""Unit tests for magnitude_pull (no network; in-memory TAP backend). Run
via `python3 scripts/refresh/magnitude/magnitude_pull.test.py`."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import refresh_lib as rl  # noqa: E402
import magnitude_pull as mp  # noqa: E402
from test_helpers import FakeTable, fake_tap_client  # noqa: E402


class MagnitudeSliceTests(unittest.TestCase):
    def test_emits_one_slice_per_configured_count(self) -> None:
        self.assertEqual(len(mp.magnitude_slices()), mp.SLICE_COUNT)

    def test_first_slice_is_open_at_the_bright_end(self) -> None:
        # A source brighter than any computed edge must still be pulled.
        self.assertIsNone(mp.magnitude_slices()[0][0])
        self.assertIsNotNone(mp.magnitude_slices()[1][0])

    def test_last_slice_closes_exactly_on_the_floor(self) -> None:
        self.assertEqual(
            mp.magnitude_slices()[-1][1], f"{mp.G_MAG_FLOOR:.{mp.EDGE_DECIMALS}f}"
        )

    def test_consecutive_slices_share_the_edge_string(self) -> None:
        slices = mp.magnitude_slices()
        for (_, hi), (lo, _) in zip(slices, slices[1:]):
            self.assertEqual(hi, lo)

    def test_edges_increase_monotonically(self) -> None:
        edges = [float(hi) for _, hi in mp.magnitude_slices()]
        self.assertEqual(edges, sorted(edges))

    def test_slices_are_near_equal_in_expected_population(self) -> None:
        # The geometric spacing is the whole reason the pull is not one
        # 27x-heavier final slice. Populations follow ratio**G.
        edges = [float(hi) for _, hi in mp.magnitude_slices()]
        shares = [mp.SOURCES_PER_MAGNITUDE**e for e in edges]
        populations = [b - a for a, b in zip([0.0, *shares], shares)]
        self.assertLess(max(populations) / min(populations), 1.05)


class SliceSyncMaxrecTests(unittest.TestCase):
    def test_sizes_off_the_nominal_slice_population(self) -> None:
        self.assertEqual(mp.slice_sync_maxrec(4_800, count=48), 400)

    def test_clears_the_largest_slice_the_partition_produces(self) -> None:
        # The cap has to hold the fattest slice, not the mean one.
        ceiling = 1_260_000
        edges = [float(hi) for _, hi in mp.magnitude_slices()]
        shares = [mp.SOURCES_PER_MAGNITUDE**e for e in edges]
        fractions = [b - a for a, b in zip([0.0, *shares], shares)]
        largest = ceiling * max(fractions) / shares[-1]
        self.assertGreater(mp.slice_sync_maxrec(ceiling), largest)


class MagnitudePredicateTests(unittest.TestCase):
    def test_open_slice_states_only_the_upper_bound(self) -> None:
        self.assertEqual(mp.magnitude_predicate((None, "6.7"), "g"), "g <= 6.7")

    def test_bounded_slice_is_half_open_upward(self) -> None:
        self.assertEqual(
            mp.magnitude_predicate(("6.7", "7.5"), "g"), "g > 6.7 AND g <= 7.5"
        )


class AssertPartitionedTests(unittest.TestCase):
    def test_accepts_distinct_source_ids(self) -> None:
        mp.assert_partitioned(2, 2, "s")

    def test_rejects_a_source_id_returned_twice(self) -> None:
        with self.assertRaises(SystemExit) as caught:
            mp.assert_partitioned(3, 2, "s")
        self.assertIn("more than one slice", str(caught.exception))


class DeepPopulationAdqlTests(unittest.TestCase):
    def test_magnitude_leg_qualifies_the_bound_with_the_joined_alias(self) -> None:
        adql = mp.magnitude_leg_adql(["source_id", "x"], "cat.t", ("1.0", "2.0"))
        self.assertIn(f"JOIN {mp.GAIA_SOURCE_TABLE} AS g ON g.source_id = t.source_id",
                      adql)
        self.assertIn(f"WHERE g.{mp.G_MAG_COLUMN} > 1.0", adql)

    def test_magnitude_leg_projects_unrenamed_columns(self) -> None:
        # Both legs feed one collector, so their column names must agree.
        adql = mp.magnitude_leg_adql(["source_id", "x"], "cat.t", (None, "2.0"))
        self.assertIn("SELECT t.source_id, t.x FROM cat.t AS t", adql)
        self.assertNotIn(" AS source_id", adql)

    def test_request_leg_is_an_unjoined_in_clause(self) -> None:
        adql = mp.request_leg_adql(["source_id", "x"], "cat.t", [7, 9])
        self.assertEqual(
            adql, "SELECT source_id, x FROM cat.t WHERE source_id IN (7,9)"
        )


class PullDeepPopulationTests(unittest.TestCase):
    """The two legs, and the contract that each source reaches `on_row` once."""

    COLUMNS = ["source_id", "v"]

    def _run(self, answer, request_ids, **kwargs):
        seen_rows: list[dict] = []
        checkpoints: list[Path] = []
        saved = rl.BatchCheckpoint
        # FakeTable has no VOTable form, so the cache is stubbed — but the
        # path it would have used is recorded, since the two legs sharing one
        # would replay the magnitude leg's batches as the request leg's.
        rl.BatchCheckpoint = lambda path: checkpoints.append(path)
        try:
            with tempfile.TemporaryDirectory() as tmp:
                request = Path(tmp) / "request.tsv"
                request.write_text(
                    rl.SOURCE_ID_REQUEST_HEADER + "\n"
                    + "".join(f"{sid}\n" for sid in request_ids)
                )
                pulled = mp.pull_deep_population(
                    fake_tap_client(rl, answer),
                    table="cat.t",
                    columns=self.COLUMNS,
                    request_path=request,
                    on_row=seen_rows.append,
                    script_name="s",
                    maxrec=1000,
                    checkpoint_base=Path(tmp) / "out.tsv",
                    log=lambda _m: None,
                    **kwargs,
                )
        finally:
            rl.BatchCheckpoint = saved
        return pulled, seen_rows, checkpoints

    def test_request_leg_asks_only_for_what_the_magnitude_leg_missed(self) -> None:
        asked: list[set[int]] = []

        def run(query: str):
            if "JOIN" in query:
                rows = [{"source_id": 1, "v": 1}] if " > " not in query else []
                return FakeTable(rows, self.COLUMNS)
            asked.append({int(p) for p in query.split("(")[1].rstrip(")").split(",")})
            return FakeTable([{"source_id": 2, "v": 2}], self.COLUMNS)

        pulled, rows, checkpoints = self._run(run, [1, 2], batch_size=10)
        self.assertEqual(asked, [{2}])          # 1 came from the magnitude leg
        self.assertEqual(pulled.from_magnitude, 1)
        self.assertEqual(pulled.seen, {1, 2})
        self.assertEqual([r["source_id"] for r in rows], [1, 2])
        self.assertEqual((pulled.requested, pulled.matched_request), (2, 2))
        self.assertEqual(len(set(checkpoints)), 2)

    def test_no_request_leg_when_the_bound_covers_the_request_set(self) -> None:
        asked: list[str] = []

        def run(query: str):
            if "JOIN" not in query:
                asked.append(query)
                return FakeTable([], self.COLUMNS)
            rows = [{"source_id": 1, "v": 1}] if " > " not in query else []
            return FakeTable(rows, self.COLUMNS)

        self._run(run, [1], batch_size=10)
        self.assertEqual(asked, [])

    def test_an_overlapping_slice_fails_before_the_request_leg_runs(self) -> None:
        def run(query: str):
            if "JOIN" in query:
                return FakeTable([{"source_id": 1, "v": 1}], self.COLUMNS)
            raise AssertionError("request leg ran after a partition fault")

        with self.assertRaises(SystemExit) as caught:
            self._run(run, [9], batch_size=10)
        self.assertIn("more than one slice", str(caught.exception))

    def test_each_leg_caches_under_its_own_directory(self) -> None:
        base = Path("/tmp/out.tsv")
        legs = {mp._leg_checkpoint(base, "magnitude"), mp._leg_checkpoint(base, "request")}
        self.assertEqual(len(legs), 2)
        # .gitignore matches these as data/**/*.tsv.ckpt*/
        for leg in legs:
            self.assertTrue(leg.name.startswith("out.tsv.ckpt-"))

    def test_an_empty_request_file_is_refused(self) -> None:
        with self.assertRaises(SystemExit) as caught:
            self._run(lambda _q: FakeTable([], self.COLUMNS), [], batch_size=10)
        self.assertIn("no source_ids", str(caught.exception))


class AssertRequestCoverageTests(unittest.TestCase):
    def _result(self, matched: int, requested: int) -> mp.DeepPopulation:
        return mp.DeepPopulation(set(), 0, requested, matched)

    def test_accepts_coverage_at_the_floor(self) -> None:
        self.assertEqual(mp.assert_request_coverage(self._result(9, 10), 0.9, "s"), 0.9)

    def test_rejects_a_request_leg_that_returned_nothing(self) -> None:
        # The magnitude leg's row-count band says nothing about this.
        with self.assertRaises(SystemExit) as caught:
            mp.assert_request_coverage(self._result(0, 10), 0.9, "s")
        self.assertIn("below floor", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
