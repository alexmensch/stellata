#!/usr/bin/env python3
"""Unit tests for vizier_slice (no network; in-memory TAP backend). Run via
`python3 scripts/refresh/vizier_slice.test.py`."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import refresh_lib as rl  # noqa: E402
from vizier_slice import VizierSlice, pull_slices  # noqa: E402


class FakeColumn(list):
    """A column whose `.dtype` is the Python type of its first cell, which is
    all ``refresh_lib.validate_schema`` reads off a non-numpy table."""

    @property
    def dtype(self) -> type:
        return type(self[0]) if self else str


class FakeTable(list):
    """Minimal astropy-Table stand-in: a row list plus `colnames`."""

    def __init__(self, rows: list[dict], colnames: list[str]) -> None:
        super().__init__(rows)
        self.colnames = colnames

    def __getitem__(self, key):  # noqa: ANN001, ANN204
        if isinstance(key, str):
            return FakeColumn(r[key] for r in self)
        return super().__getitem__(key)


ROWS = [
    {"HIP": 32349, "Vmag": -1.44},
    {"HIP": 91262, "Vmag": 0.03},
]


def slice_for(out: Path, **kwargs) -> VizierSlice:
    defaults = dict(
        table="I/239/hip_main",
        output=out,
        columns={"HIP": "hip", "Vmag": "vmag"},
        schema={"HIP": int, "Vmag": float},
        row_count_min=2,
        row_count_max=2,
        order_by=("HIP",),
        spot_key="HIP",
        spot_rows=({"HIP": 32349, "Vmag": (-1.44, 0.005)},),
    )
    defaults.update(kwargs)
    return VizierSlice(**defaults)  # type: ignore[arg-type]


def client_for(rows: list[dict], colnames: list[str] | None = None) -> rl.TapClient:
    table = FakeTable(rows, colnames or ["HIP", "Vmag"])
    return rl.TapClient(backends=[rl.TapBackend(name="fake", run=lambda _q: table)])


class AdqlTests(unittest.TestCase):
    def test_selects_only_the_mapped_columns_in_order(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            sl = slice_for(Path(d) / "out.tsv")
            self.assertEqual(
                sl.adql,
                'SELECT "HIP", "Vmag" FROM "I/239/hip_main" ORDER BY "HIP"',
            )

    def test_name_is_the_output_stem(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(slice_for(Path(d) / "hip_main_vmag.tsv").name, "hip_main_vmag")


class PullTests(unittest.TestCase):
    def _pull(self, d: str, rows: list[dict] = ROWS, **kwargs) -> Path:
        out = Path(d) / "out.tsv"
        pull_slices(
            [slice_for(out, **kwargs)],
            script_name="test",
            sources=[Path(__file__)],
            argv=["--force"],
            log=lambda _m: None,
            client=client_for(rows),
        )
        return out

    def test_writes_canonical_header_and_rows(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            out = self._pull(d)
            self.assertEqual(
                out.read_text().splitlines(),
                ["hip\tvmag", "32349\t-1.44", "91262\t0.03"],
            )

    def test_round_floats_normalises_the_written_precision(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            out = self._pull(d, round_floats=3)
            self.assertEqual(out.read_text().splitlines()[1], "32349\t-1.440")

    def test_row_count_outside_the_band_fails(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(SystemExit):
                self._pull(d, row_count_min=5, row_count_max=9)

    def test_absent_spot_row_fails(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(SystemExit):
                self._pull(d, spot_rows=({"HIP": 1, "Vmag": (9.1, 0.005)},))

    def test_drifted_spot_row_fails(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(SystemExit):
                self._pull(d, spot_rows=({"HIP": 32349, "Vmag": (0.0, 0.005)},))

    def test_partial_write_leaves_no_output_on_gate_failure(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "out.tsv"
            with self.assertRaises(SystemExit):
                pull_slices(
                    [slice_for(out, row_count_min=5, row_count_max=9)],
                    script_name="test",
                    sources=[Path(__file__)],
                    argv=["--force"],
                    log=lambda _m: None,
                    client=client_for(ROWS),
                )
            self.assertFalse(out.exists())

    def test_skips_an_up_to_date_output_without_force(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "out.tsv"
            out.write_text("stale\n")
            pull_slices(
                [slice_for(out)],
                script_name="test",
                sources=[],
                argv=[],
                log=lambda _m: None,
                client=client_for(ROWS),
            )
            self.assertEqual(out.read_text(), "stale\n")


class OnlyArgTests(unittest.TestCase):
    def test_only_runs_the_named_slice(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            a = Path(d) / "a.tsv"
            b = Path(d) / "b.tsv"
            pull_slices(
                [slice_for(a), slice_for(b)],
                script_name="test",
                sources=[Path(__file__)],
                argv=["--force", "--only", "b"],
                log=lambda _m: None,
                client=client_for(ROWS),
            )
            self.assertFalse(a.exists())
            self.assertTrue(b.exists())

    def test_unknown_only_name_fails(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(SystemExit):
                pull_slices(
                    [slice_for(Path(d) / "a.tsv")],
                    script_name="test",
                    sources=[Path(__file__)],
                    argv=["--only", "nope"],
                    log=lambda _m: None,
                    client=client_for(ROWS),
                )

    def test_only_without_a_value_fails(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(SystemExit):
                pull_slices(
                    [slice_for(Path(d) / "a.tsv")],
                    script_name="test",
                    sources=[Path(__file__)],
                    argv=["--only"],
                    log=lambda _m: None,
                    client=client_for(ROWS),
                )


class SchemaTests(unittest.TestCase):
    def test_missing_column_raises(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "out.tsv"
            with self.assertRaises(rl.SchemaError):
                pull_slices(
                    [slice_for(out)],
                    script_name="test",
                    sources=[Path(__file__)],
                    argv=["--force"],
                    log=lambda _m: None,
                    client=client_for([{"HIP": 1}], colnames=["HIP"]),
                )


if __name__ == "__main__":
    unittest.main()
