#!/usr/bin/env python3
"""Unit tests for refresh_lib (no network; synthetic exceptions +
in-memory backends). Run via `python3 scripts/refresh/refresh_lib.test.py`."""

from __future__ import annotations

import json
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import refresh_lib as rl  # noqa: E402


# ─── retry ────────────────────────────────────────────────────────────

class RetryTests(unittest.TestCase):
    def test_returns_first_attempt(self) -> None:
        calls = []
        def fn() -> int:
            calls.append(1)
            return 42
        self.assertEqual(rl.retry(fn, sleep=lambda _: None), 42)
        self.assertEqual(len(calls), 1)

    def test_retries_transient_then_succeeds(self) -> None:
        attempts = {"n": 0}
        sleeps: list[float] = []
        def fn() -> str:
            attempts["n"] += 1
            if attempts["n"] < 3:
                raise rl.TransientError("503")
            return "ok"
        result = rl.retry(
            fn,
            max_attempts=4,
            base_delay_s=0.5,
            backoff=2.0,
            jitter=0.0,
            sleep=sleeps.append,
            rand=lambda: 0.5,
        )
        self.assertEqual(result, "ok")
        self.assertEqual(attempts["n"], 3)
        # 2 sleeps (between attempts 1→2 and 2→3); exponential with no jitter
        self.assertEqual(sleeps, [0.5, 1.0])

    def test_jitter_scales_delay(self) -> None:
        sleeps: list[float] = []
        attempts = {"n": 0}
        def fn() -> None:
            attempts["n"] += 1
            if attempts["n"] < 2:
                raise rl.TransientError()
        rl.retry(
            fn,
            max_attempts=2,
            base_delay_s=1.0,
            backoff=2.0,
            jitter=0.5,
            sleep=sleeps.append,
            rand=lambda: 1.0,  # max jitter
        )
        # 1.0 * (1 + (1.0*2 - 1)*0.5) = 1.0 * 1.5 = 1.5
        self.assertEqual(sleeps, [1.5])

    def test_non_transient_raises_immediately(self) -> None:
        calls = []
        def fn() -> None:
            calls.append(1)
            raise ValueError("syntax error")
        with self.assertRaises(ValueError):
            rl.retry(fn, sleep=lambda _: None)
        self.assertEqual(len(calls), 1)

    def test_classifies_responseless_500_message_as_transient(self) -> None:
        # A TAP layer can raise HTTPError with no `response`, leaving the
        # status only in the message. Parsing it out is what keeps a long
        # pull alive through a server-side 5xx.
        try:
            import requests
        except ImportError:
            self.skipTest("requests not installed")
        e500 = requests.HTTPError("Error 500:\nCannot find result for job X")
        e400 = requests.HTTPError("Error 400: bad ADQL syntax")
        self.assertIsNone(e500.response)
        self.assertTrue(rl.is_transient_http_error(e500))
        self.assertFalse(rl.is_transient_http_error(e400))

    def test_retries_dal_query_error(self) -> None:
        # A connection dropped mid-response surfaces as DALQueryError, not
        # DALServiceError — the retry loop must treat it as transient or a
        # multi-batch pull dies on batch 1.
        try:
            import pyvo
        except ImportError:
            self.skipTest("pyvo not installed")
        self.assertTrue(
            rl.is_transient_http_error(
                pyvo.dal.DALQueryError("This connection has been closed")
            )
        )
        attempts = {"n": 0}
        def fn() -> str:
            attempts["n"] += 1
            if attempts["n"] < 2:
                raise pyvo.dal.DALQueryError("This connection has been closed")
            return "ok"
        self.assertEqual(rl.retry(fn, sleep=lambda _: None), "ok")
        self.assertEqual(attempts["n"], 2)

    def test_votable_query_status_reads_error_info(self) -> None:
        # Sync TAP flags query errors / overflow in a QUERY_STATUS INFO
        # with HTTP 200, so the parser must inspect it, not just the code.
        class _Info:
            def __init__(self, name, value, content=""):
                self.name, self.value, self.content = name, value, content

        class _Res:
            def __init__(self, infos):
                self.infos = infos

        class _VOTable:
            def __init__(self, infos=(), resources=()):
                self.infos, self.resources = list(infos), list(resources)

        ok, _ = rl.votable_query_status(_VOTable(infos=[_Info("QUERY_STATUS", "OK")]))
        self.assertTrue(ok)
        bad, msg = rl.votable_query_status(
            _VOTable(resources=[_Res([_Info("QUERY_STATUS", "ERROR", "boom")])])
        )
        self.assertFalse(bad)
        self.assertIn("boom", msg)
        overflow, _ = rl.votable_query_status(
            _VOTable(infos=[_Info("QUERY_STATUS", "OVERFLOW")])
        )
        self.assertFalse(overflow)

    def test_exhausts_max_attempts(self) -> None:
        calls = []
        def fn() -> None:
            calls.append(1)
            raise rl.TransientError()
        with self.assertRaises(rl.TransientError):
            rl.retry(fn, max_attempts=3, sleep=lambda _: None)
        self.assertEqual(len(calls), 3)

    def test_max_attempts_validates(self) -> None:
        with self.assertRaises(ValueError):
            rl.retry(lambda: None, max_attempts=0)


# ─── run_in_batches ───────────────────────────────────────────────────

class RunInBatchesTests(unittest.TestCase):
    def test_batches_feed_collect_in_order(self) -> None:
        seen_batches: list[list[int]] = []
        collected: list[int] = []
        def q(batch):
            seen_batches.append(list(batch))
            return [x * 10 for x in batch]
        rl.run_in_batches(
            [1, 2, 3, 4, 5], 2, q, collected.extend, log=lambda _: None
        )
        self.assertEqual(seen_batches, [[1, 2], [3, 4], [5]])
        self.assertEqual(collected, [10, 20, 30, 40, 50])

    def test_empty_input_never_queries(self) -> None:
        calls: list = []
        rl.run_in_batches(
            [], 10, lambda b: calls.append(b) or [], lambda t: None,
            log=lambda _: None,
        )
        self.assertEqual(calls, [])

    def test_invalid_batch_size(self) -> None:
        with self.assertRaises(ValueError):
            rl.run_in_batches([1], 0, lambda b: [], lambda t: None)

    def test_schema_validated_first_batch_only(self) -> None:
        # Only batch 1 is validated; a schema-violating batch 2 must pass
        # unchecked (every batch shares one ADQL projection, so one check
        # suffices — and re-validating each batch would be wasted work).
        tables = iter([{"a": _FakeColumn(int)}, {"b": _FakeColumn(int)}])
        collected: list = []
        rl.run_in_batches(
            [1, 2], 1, lambda b: next(tables), collected.append,
            schema={"a": int}, schema_label="x", log=lambda _: None,
        )
        self.assertEqual(len(collected), 2)

    def test_first_batch_schema_violation_raises(self) -> None:
        with self.assertRaises(rl.SchemaError):
            rl.run_in_batches(
                [1], 1, lambda b: {"b": _FakeColumn(int)}, lambda t: None,
                schema={"a": int}, log=lambda _: None,
            )

    def test_logs_cumulative_progress(self) -> None:
        logs: list[str] = []
        rl.run_in_batches(
            [1, 2, 3, 4, 5], 2, lambda b: [0] * len(b), lambda t: None,
            log=logs.append,
        )
        self.assertEqual(len(logs), 3)
        self.assertIn("batch 1/3", logs[0])
        self.assertIn("total rows 2", logs[0])
        self.assertIn("batch 3/3", logs[2])
        self.assertIn("total rows 5", logs[2])


# ─── BatchCheckpoint ──────────────────────────────────────────────────

def _rows(batch) -> list[dict]:
    return [{"id": i} for i in batch]


class BatchCheckpointTests(unittest.TestCase):
    """A JSON codec over lists-of-dicts stands in for the default VOTable
    codec so these run without astropy; the default codec has its own
    round-trip test below."""

    def _ckpt(self, directory: Path, **kw) -> rl.BatchCheckpoint:
        return rl.BatchCheckpoint(
            directory,
            encode=lambda table, path: path.write_text(json.dumps(table)),
            decode=lambda path: json.loads(path.read_text()),
            suffix=".json",
            log=lambda _: None,
            **kw,
        )

    def test_cache_removed_once_every_batch_lands(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            ckpt_dir = Path(d) / "out.tsv.ckpt"
            collected: list = []
            rl.run_in_batches(
                [1, 2, 3, 4, 5], 2, _rows, collected.extend,
                checkpoint=self._ckpt(ckpt_dir), log=lambda _: None,
            )
            self.assertEqual([r["id"] for r in collected], [1, 2, 3, 4, 5])
            self.assertFalse(ckpt_dir.exists())

    def test_resumes_from_the_batch_that_failed(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            ckpt_dir = Path(d) / "out.tsv.ckpt"
            items = [1, 2, 3, 4, 5, 6]

            def drops_on_batch_3(batch):
                if batch[0] == 5:
                    raise rl.TransientError("network drop")
                return _rows(batch)

            with self.assertRaises(rl.TransientError):
                rl.run_in_batches(
                    items, 2, drops_on_batch_3, lambda t: None,
                    checkpoint=self._ckpt(ckpt_dir), log=lambda _: None,
                )
            self.assertEqual(
                sorted(p.name for p in ckpt_dir.glob("batch-*")),
                ["batch-0001.json", "batch-0002.json"],
            )

            queried: list[list[int]] = []
            collected: list = []

            def second_run(batch):
                queried.append(list(batch))
                return _rows(batch)

            rl.run_in_batches(
                items, 2, second_run, collected.extend,
                checkpoint=self._ckpt(ckpt_dir), log=lambda _: None,
            )
            # Only the un-cached tail is re-queried, and collect still sees
            # every row in item order — cached batches replay in position.
            self.assertEqual(queried, [[5, 6]])
            self.assertEqual([r["id"] for r in collected], [1, 2, 3, 4, 5, 6])
            self.assertFalse(ckpt_dir.exists())

    def test_changed_items_discard_cached_batches(self) -> None:
        # Batch 1 of a different request set covers different ids; replaying
        # it would attribute one source_id's row to another.
        with tempfile.TemporaryDirectory() as d:
            ckpt_dir = Path(d) / "out.tsv.ckpt"
            ckpt = self._ckpt(ckpt_dir)
            ckpt.begin([1, 2, 3, 4], 2)
            ckpt.save(1, _rows([1, 2]))
            self.assertIsNotNone(ckpt.load(1))
            self._ckpt(ckpt_dir).begin([9, 1, 2, 3], 2)
            self.assertIsNone(self._ckpt(ckpt_dir).load(1))

    def test_changed_batch_size_discards_cached_batches(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            ckpt_dir = Path(d) / "out.tsv.ckpt"
            ckpt = self._ckpt(ckpt_dir)
            ckpt.begin([1, 2, 3, 4], 2)
            ckpt.save(1, _rows([1, 2]))
            self._ckpt(ckpt_dir).begin([1, 2, 3, 4], 4)
            self.assertIsNone(self._ckpt(ckpt_dir).load(1))

    def test_unchanged_request_set_keeps_cached_batches(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            ckpt_dir = Path(d) / "out.tsv.ckpt"
            ckpt = self._ckpt(ckpt_dir)
            ckpt.begin([1, 2, 3, 4], 2)
            ckpt.save(1, _rows([1, 2]))
            self._ckpt(ckpt_dir).begin([1, 2, 3, 4], 2)
            self.assertEqual(self._ckpt(ckpt_dir).load(1), [{"id": 1}, {"id": 2}])

    def test_cached_first_batch_still_faces_the_schema_gate(self) -> None:
        # A cache written by an older ADQL projection must fail the schema
        # check rather than flow into collect.
        with tempfile.TemporaryDirectory() as d:
            ckpt_dir = Path(d) / "out.tsv.ckpt"
            ckpt = self._ckpt(ckpt_dir)
            ckpt.begin([1, 2], 1)
            ckpt.save(1, {"b": "stale-projection"})
            with self.assertRaises(rl.SchemaError):
                rl.run_in_batches(
                    [1, 2], 1, lambda b: {"a": _FakeColumn(int)}, lambda t: None,
                    schema={"a": int}, checkpoint=self._ckpt(ckpt_dir),
                    log=lambda _: None,
                )

    def test_log_marks_resumed_batches(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            ckpt_dir = Path(d) / "out.tsv.ckpt"
            ckpt = self._ckpt(ckpt_dir)
            ckpt.begin([1, 2], 1)
            ckpt.save(1, _rows([1]))
            logs: list[str] = []
            rl.run_in_batches(
                [1, 2], 1, _rows, lambda t: None,
                checkpoint=self._ckpt(ckpt_dir), log=logs.append,
            )
            self.assertIn("batch 1/2", logs[0])
            self.assertIn("from checkpoint", logs[0])
            self.assertNotIn("from checkpoint", logs[1])

    def test_encode_failure_leaves_no_partial_batch(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            ckpt_dir = Path(d) / "out.tsv.ckpt"
            def boom(_table, path: Path) -> None:
                path.write_text("half")
                raise OSError("disk full")
            ckpt = rl.BatchCheckpoint(
                ckpt_dir, encode=boom, decode=lambda p: None,
                suffix=".json", log=lambda _: None,
            )
            ckpt.begin([1], 1)
            with self.assertRaises(OSError):
                ckpt.save(1, _rows([1]))
            self.assertEqual(list(ckpt_dir.glob("batch-*")), [])

    def test_empty_input_creates_no_cache(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            ckpt_dir = Path(d) / "out.tsv.ckpt"
            rl.run_in_batches(
                [], 10, _rows, lambda t: None,
                checkpoint=self._ckpt(ckpt_dir), log=lambda _: None,
            )
            self.assertFalse(ckpt_dir.exists())

    def _round_trip_default_codec(self, table):
        with tempfile.TemporaryDirectory() as d:
            ckpt = rl.BatchCheckpoint(Path(d) / "out.tsv.ckpt", log=lambda _: None)
            ckpt.begin([1, 2], 2)
            ckpt.save(1, table)
            return ckpt.load(1)

    def _gaia_shaped_table(self):
        try:
            import numpy as np
            from astropy.table import Table
        except ImportError:
            self.skipTest("astropy/numpy not installed")
        return Table(
            {
                "source_id": np.ma.array([1, 2], mask=[False, False]),
                "teff": np.ma.array([5772.0, 0.0], mask=[False, True]),
                "sptype": np.ma.array(
                    np.array(["G2V", ""], dtype=object), mask=[False, True]
                ),
            },
            masked=True,
        )

    def test_default_codec_preserves_values_and_numeric_masks(self) -> None:
        # The production codec. A masked numeric cell must survive, or a
        # resumed batch rewrites a null as 0.0.
        back = self._round_trip_default_codec(self._gaia_shaped_table())
        self.assertEqual(len(back), 2)
        self.assertEqual(int(rl.coerce_masked(back["source_id"][0])), 1)
        self.assertEqual(float(rl.coerce_masked(back["teff"][0])), 5772.0)
        self.assertEqual(str(rl.coerce_masked(back["sptype"][0])), "G2V")
        self.assertIsNone(rl.coerce_masked(back["teff"][1]))

    def test_default_codec_decodes_masked_strings_as_empty(self) -> None:
        # VOTable char fields carry no null marker, so a masked string cell
        # comes back as "". Costs nothing downstream: write_tsv emits an
        # empty cell for both, and the Gaia archive reports a null string
        # column as "" rather than masking it in the first place.
        back = self._round_trip_default_codec(self._gaia_shaped_table())
        self.assertEqual(str(rl.coerce_masked(back["sptype"][1])), "")


# ─── assert_row_count ─────────────────────────────────────────────────

class AssertRowCountTests(unittest.TestCase):
    def test_passes_inside_band(self) -> None:
        rl.assert_row_count(100, 90, 110, "test")

    def test_passes_at_both_boundaries(self) -> None:
        # Inclusive both ends — the guard the inline `not (LOW <= n <= MAX)`
        # copies expressed; a `<` typo would have failed these.
        rl.assert_row_count(90, 90, 110, "test")
        rl.assert_row_count(110, 90, 110, "test")

    def test_raises_below_floor(self) -> None:
        with self.assertRaises(SystemExit) as cm:
            rl.assert_row_count(89, 90, 110, "my-script")
        msg = str(cm.exception)
        self.assertIn("my-script", msg)
        self.assertIn("row count 89", msg)
        self.assertIn("[90, 110]", msg)
        self.assertIn(rl._ROW_COUNT_DEFAULT_HINT, msg)

    def test_raises_above_ceiling(self) -> None:
        with self.assertRaises(SystemExit):
            rl.assert_row_count(111, 90, 110, "test")

    def test_custom_hint_tails_message(self) -> None:
        with self.assertRaises(SystemExit) as cm:
            rl.assert_row_count(
                5, 90, 110, "refresh-msc: J/ApJS/235/6/table",
                hint="upstream drift; investigate before re-pinning.",
            )
        msg = str(cm.exception)
        self.assertIn("refresh-msc: J/ApJS/235/6/table", msg)
        self.assertIn("upstream drift", msg)


# ─── validate_schema ──────────────────────────────────────────────────

class _FakeColumn:
    def __init__(self, dtype: type) -> None:
        self.dtype = dtype


class _FakeTable:
    """astropy-Table-shaped: has `colnames` and `__getitem__` returning a
    column with a `dtype` attribute."""
    def __init__(self, cols: dict[str, type]) -> None:
        self._cols = {k: _FakeColumn(v) for k, v in cols.items()}

    @property
    def colnames(self) -> list[str]:
        return list(self._cols)

    def __getitem__(self, name: str) -> _FakeColumn:
        return self._cols[name]


class SchemaTests(unittest.TestCase):
    def test_passes_when_columns_and_dtypes_match(self) -> None:
        table = _FakeTable({"hip": int, "source_id": int, "ra": float})
        rl.validate_schema(table, {"hip": int, "source_id": int, "ra": float})

    def test_allows_extra_columns(self) -> None:
        table = _FakeTable({"hip": int, "extra": str})
        rl.validate_schema(table, {"hip": int})

    def test_fails_on_missing_column(self) -> None:
        table = _FakeTable({"hip": int})
        with self.assertRaises(rl.SchemaError) as cm:
            rl.validate_schema(table, {"hip": int, "source_id": int})
        self.assertIn("missing columns", str(cm.exception))
        self.assertIn("source_id", str(cm.exception))

    def test_fails_on_wrong_dtype(self) -> None:
        table = _FakeTable({"hip": str})
        with self.assertRaises(rl.SchemaError) as cm:
            rl.validate_schema(table, {"hip": int})
        self.assertIn("hip", str(cm.exception))

    def test_accepts_tuple_of_types(self) -> None:
        table = _FakeTable({"v": float})
        rl.validate_schema(table, {"v": (int, float)})

    def test_accepts_dict_of_columns(self) -> None:
        # Validates the dict-of-columns fallback in _column_names.
        table = {"hip": _FakeColumn(int), "source_id": _FakeColumn(int)}
        rl.validate_schema(table, {"hip": int, "source_id": int})

    def test_matches_numpy_widths_against_python_builtins(self) -> None:
        # NumPy 2.x: np.issubdtype(int32, int) is False; the supertype map in
        # _dtype_matches restores the "int matches any integer width" contract
        # so refresh scripts don't need to spell out np.int32 / np.float32.
        import numpy as np
        table = {
            "hip": _FakeColumn(np.dtype("int32")),
            "gaia_source_id": _FakeColumn(np.dtype("int64")),
            "angular_distance": _FakeColumn(np.dtype("float32")),
            "ra": _FakeColumn(np.dtype("float64")),
            "flag": _FakeColumn(np.dtype("bool")),
        }
        rl.validate_schema(table, {
            "hip": int,
            "gaia_source_id": int,
            "angular_distance": float,
            "ra": float,
            "flag": bool,
        })

    def test_rejects_mismatched_numpy_dtype(self) -> None:
        import numpy as np
        table = {"hip": _FakeColumn(np.dtype("float32"))}
        with self.assertRaises(rl.SchemaError):
            rl.validate_schema(table, {"hip": int})

    def test_matches_string_columns(self) -> None:
        # Gaia TAP returns variable-length string columns (e.g. the Tycho-2
        # `original_ext_source_id`) as object-dtype arrays, not fixed-width
        # unicode. The `str` supertype must accept both shapes so refresh
        # scripts can declare a column as `str` without worrying which
        # representation upstream chose.
        import numpy as np
        table = {
            "tyc_object": _FakeColumn(np.dtype("O")),
            "tyc_unicode": _FakeColumn(np.dtype("<U11")),
        }
        rl.validate_schema(table, {"tyc_object": str, "tyc_unicode": str})


# ─── is_up_to_date ────────────────────────────────────────────────────

class IdempotencyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name)
        self.addCleanup(self.dir.cleanup)

    def _touch(self, name: str, mtime: float | None = None) -> Path:
        p = self.path / name
        p.write_text("x")
        if mtime is not None:
            import os
            os.utime(p, (mtime, mtime))
        return p

    def test_false_when_output_missing(self) -> None:
        src = self._touch("src.py", mtime=1000.0)
        self.assertFalse(rl.is_up_to_date(self.path / "missing.tsv", [src]))

    def test_true_when_output_newer(self) -> None:
        # Output mtime must clear refresh_lib's own mtime since it's auto-
        # included in the comparison — use future-from-now anchors so the
        # test is invariant to when refresh_lib was last edited.
        lib_mtime = rl._LIB_PATH.stat().st_mtime
        src = self._touch("src.py", mtime=lib_mtime - 100.0)
        out = self._touch("out.tsv", mtime=lib_mtime + 100.0)
        self.assertTrue(rl.is_up_to_date(out, [src]))

    def test_false_when_source_newer(self) -> None:
        lib_mtime = rl._LIB_PATH.stat().st_mtime
        out = self._touch("out.tsv", mtime=lib_mtime + 100.0)
        src = self._touch("src.py", mtime=lib_mtime + 200.0)
        self.assertFalse(rl.is_up_to_date(out, [src]))

    def test_false_when_source_missing(self) -> None:
        lib_mtime = rl._LIB_PATH.stat().st_mtime
        out = self._touch("out.tsv", mtime=lib_mtime + 100.0)
        self.assertFalse(rl.is_up_to_date(out, [self.path / "missing.py"]))

    def test_false_when_refresh_lib_newer_than_output(self) -> None:
        # is_up_to_date folds refresh_lib's own mtime into the comparison so
        # a bug fix in write_tsv / coerce_masked / _dtype_matches invalidates
        # every cached TSV without requiring each caller to pass
        # Path(refresh_lib.__file__) explicitly.
        import os
        out = self._touch("out.tsv", mtime=1000.0)
        src = self._touch("src.py", mtime=500.0)
        # Backdate the output below refresh_lib's mtime — the auto-inclusion
        # should make is_up_to_date return False even though the caller's
        # explicit `sources` list is older than the output.
        lib_mtime = rl._LIB_PATH.stat().st_mtime
        os.utime(out, (lib_mtime - 1.0, lib_mtime - 1.0))
        self.assertFalse(rl.is_up_to_date(out, [src]))


# ─── TapClient ────────────────────────────────────────────────────────

class TapClientTests(unittest.TestCase):
    def _silent_retry(self) -> dict:
        return {"sleep": lambda _: None, "jitter": 0.0, "rand": lambda: 0.5}

    def test_uses_first_backend(self) -> None:
        calls: list[str] = []
        def esa(_q: str) -> str:
            calls.append("esa")
            return "esa-result"
        def cds(_q: str) -> str:
            calls.append("cds")
            return "cds-result"
        client = rl.TapClient(
            [rl.TapBackend("esa", esa), rl.TapBackend("cds", cds)],
            retry_kwargs=self._silent_retry(),
        )
        self.assertEqual(client.run("SELECT 1"), "esa-result")
        self.assertEqual(calls, ["esa"])

    def test_falls_back_on_transient(self) -> None:
        calls: list[str] = []
        def esa(_q: str) -> None:
            calls.append("esa")
            raise rl.TransientError("503")
        def cds(_q: str) -> str:
            calls.append("cds")
            return "cds-result"
        client = rl.TapClient(
            [rl.TapBackend("esa", esa), rl.TapBackend("cds", cds)],
            retry_kwargs={**self._silent_retry(), "max_attempts": 2},
        )
        self.assertEqual(client.run("SELECT 1"), "cds-result")
        # esa is retried max_attempts (2) times before fallback
        self.assertEqual(calls, ["esa", "esa", "cds"])

    def test_raises_when_all_backends_transient(self) -> None:
        def esa(_q: str) -> None:
            raise rl.TransientError("esa down")
        def cds(_q: str) -> None:
            raise rl.TransientError("cds down")
        client = rl.TapClient(
            [rl.TapBackend("esa", esa), rl.TapBackend("cds", cds)],
            retry_kwargs={**self._silent_retry(), "max_attempts": 1},
        )
        with self.assertRaises(rl.TransientError):
            client.run("SELECT 1")

    def test_non_transient_raises_without_fallback(self) -> None:
        calls: list[str] = []
        def esa(_q: str) -> None:
            calls.append("esa")
            raise ValueError("ADQL syntax error")
        def cds(_q: str) -> None:
            calls.append("cds")
        client = rl.TapClient(
            [rl.TapBackend("esa", esa), rl.TapBackend("cds", cds)],
            retry_kwargs=self._silent_retry(),
        )
        with self.assertRaises(ValueError):
            client.run("SELECT bogus")
        self.assertEqual(calls, ["esa"])

    def test_empty_backends_rejected(self) -> None:
        with self.assertRaises(ValueError):
            rl.TapClient([])

    def test_public_backend_factories(self) -> None:
        # Single-backend scripts (e.g. refresh-bailer-jones.py for VizieR-only
        # tables, refresh-simbad-sample.py for SIMBAD's divergent dialect)
        # pass `backends=[rl.<x>_backend()]` to TapClient. The factories must
        # return valid TapBackend instances without importing pyvo at module
        # load time.
        cds = rl.cds_backend()
        simbad = rl.simbad_backend()
        self.assertIsInstance(cds, rl.TapBackend)
        self.assertIsInstance(simbad, rl.TapBackend)
        self.assertEqual(cds.name, "CDS")
        self.assertEqual(simbad.name, "SIMBAD")

    def test_backends_is_required(self) -> None:
        # No default list: which service can serve a query is a property of
        # the table. A bare TapClient() used to hand back the ESA async path
        # that every pull has now migrated off.
        with self.assertRaises(TypeError):
            rl.TapClient()
        self.assertFalse(hasattr(rl, "esa_backend"))
        self.assertFalse(hasattr(rl, "_default_backends"))


# ─── Gaia sync client ─────────────────────────────────────────────────

class GaiaSyncClientTests(unittest.TestCase):
    def test_composes_esa_primary_then_ari_fallback(self) -> None:
        client = rl.gaia_sync_client(12_345)
        self.assertEqual(
            [b.name for b in client.backends], ["ESA-sync", "ARI-sync"]
        )
        self.assertEqual(client.retry_kwargs, dict(rl.GAIA_SYNC_RETRY_KWARGS))

    def test_one_maxrec_reaches_both_endpoints(self) -> None:
        seen: list[tuple[str, int]] = []
        original = rl._sync_tap_run
        rl._sync_tap_run = lambda url, _q, maxrec: seen.append((url, maxrec))
        try:
            for backend in rl.gaia_sync_client(7_000).backends:
                backend.run("SELECT 1")
        finally:
            rl._sync_tap_run = original
        self.assertEqual(
            seen,
            [
                (rl.GAIA_ESA_SYNC_TAP_URL, 7_000),
                (rl.GAIA_ARI_SYNC_TAP_URL, 7_000),
            ],
        )


class SyncOverflowTests(unittest.TestCase):
    def test_overflow_is_not_classified_transient(self) -> None:
        self.assertFalse(
            rl.is_transient_http_error(rl.SyncOverflowError("truncated"))
        )

    def test_no_retry_and_no_mirror_fallback_on_overflow(self) -> None:
        # A mirror at the same MAXREC truncates identically, so falling back
        # would trade a loud truncation for a silent one.
        calls: list[str] = []
        def esa(_q: str) -> None:
            calls.append("esa")
            raise rl.SyncOverflowError("MAXREC=10")
        def ari(_q: str) -> str:
            calls.append("ari")
            return "ari-result"
        client = rl.TapClient(
            [rl.TapBackend("ESA-sync", esa), rl.TapBackend("ARI-sync", ari)],
            retry_kwargs={"sleep": lambda _: None},
        )
        with self.assertRaises(rl.SyncOverflowError):
            client.run("SELECT 1")
        self.assertEqual(calls, ["esa"])


class WholeTableSyncMaxrecTests(unittest.TestCase):
    def test_doubles_the_pinned_ceiling(self) -> None:
        self.assertEqual(rl.whole_table_sync_maxrec(99_600), 199_200)

    def test_clamps_to_the_output_cap(self) -> None:
        self.assertEqual(
            rl.whole_table_sync_maxrec(2_530_000), rl.GAIA_SYNC_MAX_ROWS
        )

    def test_always_leaves_headroom_over_the_live_ceilings(self) -> None:
        # hip-xmatch, nss, tyc-xmatch pinned ceilings. MAXREC at or below a
        # ceiling would overflow exactly when the row-count guard should be
        # the one reporting.
        for ceiling in (99_600, 446_000, 2_530_000):
            self.assertGreater(rl.whole_table_sync_maxrec(ceiling), ceiling)

    def test_ceiling_past_the_cap_demands_batching(self) -> None:
        with self.assertRaises(SystemExit) as cm:
            rl.whole_table_sync_maxrec(rl.GAIA_SYNC_MAX_ROWS + 1)
        self.assertIn("batch it", str(cm.exception))


# ─── coerce_masked ────────────────────────────────────────────────────

class CoerceMaskedTests(unittest.TestCase):
    def test_passthrough_for_plain_values(self) -> None:
        self.assertEqual(rl.coerce_masked(1.5), 1.5)
        self.assertEqual(rl.coerce_masked(0), 0)
        self.assertEqual(rl.coerce_masked("Orbital"), "Orbital")
        self.assertIsNone(rl.coerce_masked(None))

    def test_converts_masked_scalar_to_none(self) -> None:
        import numpy as np
        self.assertIsNone(rl.coerce_masked(np.ma.masked))

    def test_converts_masked_array_element_to_none(self) -> None:
        # Astropy MaskedColumn cells return np.ma.masked (a MaskedConstant)
        # for missing entries; the second isinstance branch catches any
        # other MaskedConstant subclass instance the upstream may emit.
        import numpy as np
        arr = np.ma.array([1.0, 2.0, 3.0], mask=[False, True, False])
        self.assertEqual(rl.coerce_masked(arr[0]), 1.0)
        self.assertIsNone(rl.coerce_masked(arr[1]))
        self.assertEqual(rl.coerce_masked(arr[2]), 3.0)

    def test_converts_zero_d_masked_array_to_none(self) -> None:
        # A 0-d masked array is NOT the np.ma.masked singleton and NOT a
        # MaskedConstant, so the two identity/isinstance checks miss it;
        # the .mask fallback catches it. Without it this coerces to the
        # literal "--" string in the TSV.
        import numpy as np
        self.assertIsNone(rl.coerce_masked(np.ma.array(5.0, mask=True)))
        self.assertEqual(rl.coerce_masked(np.ma.array(5.0, mask=False)), 5.0)

    def test_non_scalar_mask_is_left_alone(self) -> None:
        # A whole masked column passed by mistake has an array-valued .mask;
        # bool() on it raises, so coerce_masked must pass it through rather
        # than crash on the ambiguous truth value.
        import numpy as np
        col = np.ma.array([1.0, 2.0], mask=[True, False])
        self.assertIs(rl.coerce_masked(col), col)

    def test_round_trips_through_write_tsv(self) -> None:
        # Integration with write_tsv — the masked-to-None round trip is the
        # whole point of coerce_masked, so pin it as a single assertion.
        import numpy as np
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "out.tsv"
            rl.write_tsv(
                [{"a": rl.coerce_masked(np.ma.masked), "b": rl.coerce_masked(2.5)}],
                columns=["a", "b"],
                output=out,
            )
            self.assertEqual(out.read_text(), "a\tb\n\t2.5\n")


# ─── write_tsv ────────────────────────────────────────────────────────

class WriteTsvTests(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "out.tsv"
        self.addCleanup(self.dir.cleanup)

    def test_writes_header_and_rows(self) -> None:
        n = rl.write_tsv(
            [{"a": 1, "b": "x"}, {"a": 2, "b": "y"}],
            columns=["a", "b"],
            output=self.path,
        )
        self.assertEqual(n, 2)
        self.assertEqual(
            self.path.read_text(), "a\tb\n1\tx\n2\ty\n"
        )

    def test_none_becomes_empty(self) -> None:
        rl.write_tsv([{"a": None, "b": 7}], columns=["a", "b"], output=self.path)
        self.assertEqual(self.path.read_text(), "a\tb\n\t7\n")

    def test_rounds_floats(self) -> None:
        rl.write_tsv(
            [{"ra": 1.234567}], columns=["ra"], output=self.path, round_floats=3
        )
        self.assertEqual(self.path.read_text(), "ra\n1.235\n")

    def test_rounds_numpy_float32(self) -> None:
        # The archives return float32 columns; numpy 2.x stopped treating them
        # as Python-float subclasses so the round_floats path used to skip
        # them and emit full-precision repr() output instead.
        import numpy as np
        rl.write_tsv(
            [{"angular_distance": np.float32(0.0016044503)}],
            columns=["angular_distance"],
            output=self.path,
            round_floats=6,
        )
        self.assertEqual(self.path.read_text(), "angular_distance\n0.001604\n")

    def test_creates_parent_dir(self) -> None:
        target = self.path.parent / "nested" / "deep.tsv"
        rl.write_tsv([{"a": 1}], columns=["a"], output=target)
        self.assertTrue(target.exists())

    def test_mid_write_failure_leaves_existing_output_intact(self) -> None:
        # A coerce raising / KeyboardInterrupt / OOM mid-row used to leave a
        # partially-written TSV whose mtime was newer than the source, so
        # the next is_up_to_date returned True against silently broken data.
        # The atomic write contract: the committed output is either the
        # last good version or absent, never half-written.
        self.path.write_text("OLD\nrow1\trow2\n")
        original = self.path.read_text()

        def explode():
            yield {"a": 1, "b": 2}
            yield {"a": 2, "b": 3}
            raise RuntimeError("simulated mid-stream failure")
            yield {"a": 3, "b": 4}  # unreachable

        with self.assertRaises(RuntimeError):
            rl.write_tsv(explode(), columns=["a", "b"], output=self.path)
        self.assertEqual(self.path.read_text(), original)
        # The .tmp sibling must be cleaned up; otherwise a future
        # is_up_to_date probe (or an `ls data/` audit) sees stale partial.
        self.assertFalse(
            self.path.with_suffix(self.path.suffix + ".tmp").exists()
        )

    def test_mid_write_failure_leaves_no_output_when_none_existed(self) -> None:
        # Symmetric to the previous case for the "first run that crashed"
        # path — there's nothing to preserve, so the committed output must
        # remain absent (and the .tmp sibling cleaned up).
        target = self.path.parent / "fresh.tsv"
        self.assertFalse(target.exists())

        def explode():
            yield {"a": 1}
            raise RuntimeError("crash before first commit")

        with self.assertRaises(RuntimeError):
            rl.write_tsv(explode(), columns=["a"], output=target)
        self.assertFalse(target.exists())
        self.assertFalse(target.with_suffix(target.suffix + ".tmp").exists())


# ─── AT-HYG helpers ───────────────────────────────────────────────────


class AthygMissingSentinelTests(unittest.TestCase):
    def test_int_helper_collapses_empty_and_zero(self) -> None:
        self.assertIsNone(rl.athyg_int_or_none(""))
        self.assertIsNone(rl.athyg_int_or_none("  "))
        self.assertIsNone(rl.athyg_int_or_none("0"))
        self.assertIsNone(rl.athyg_int_or_none(None))
        self.assertEqual(rl.athyg_int_or_none("42"), 42)
        # malformed cell falls through to None rather than raising — the
        # caller cannot distinguish "junk" from "missing" by design.
        self.assertIsNone(rl.athyg_int_or_none("not-a-number"))

    def test_str_helper_collapses_empty_and_zero(self) -> None:
        self.assertIsNone(rl.athyg_str_or_none(""))
        self.assertIsNone(rl.athyg_str_or_none("0"))
        self.assertIsNone(rl.athyg_str_or_none(None))
        self.assertEqual(rl.athyg_str_or_none("4669-731-1"), "4669-731-1")


class SpineReaderTests(unittest.TestCase):
    HEADER = "tyc\thip\tgaia_source_id\trv_src\n"

    def _spine(self, body: str) -> Path:
        d = self.enterContext(tempfile.TemporaryDirectory())
        p = Path(d) / "inherited-spine.tsv"
        p.write_text(self.HEADER + body)
        return p

    def test_source_ids_skip_the_no_gaia_tier_and_keep_file_order(self) -> None:
        ids = rl.read_spine_source_ids(self._spine(
            "1-2-1\t2\t2341871673090078592\tG_R3\n"
            "3-4-1\t5\t\tHYG\n"                      # no-Gaia tier
            "5-6-1\t7\t4472832130942575872\tN\n"
        ))
        self.assertEqual(ids, [2341871673090078592, 4472832130942575872])

    def test_iter_spine_rows_yields_named_cells(self) -> None:
        rows = list(rl.iter_spine_rows(self._spine("1-2-1\t2\t99\tHYG\n")))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["tyc"], "1-2-1")
        self.assertEqual(rows[0]["rv_src"], "HYG")


# ─── check_spot_row ──────────────────────────────────────────────────

class CheckSpotRowTests(unittest.TestCase):
    """Pinned-row drift detector lifted from refresh-gaia-nss /
    refresh-gaia-apsis. Covers the exact-match /
    numeric-tolerance / NULL branches and the present-vs-missing
    return contract."""

    def test_returns_true_when_row_matches_all_fields(self) -> None:
        rows = {1: {"a": "x", "b": 10.5, "c": None}}
        ok = rl.check_spot_row(
            rows,
            {"id": 1, "a": "x", "b": (10.5, 0.001), "c": None},
            script_name="test", key_field="id",
        )
        self.assertTrue(ok)

    def test_returns_false_when_row_is_absent(self) -> None:
        ok = rl.check_spot_row(
            {1: {"a": 1}}, {"id": 999, "a": 1},
            script_name="test", key_field="id",
        )
        self.assertFalse(ok)

    def test_raises_with_all_deltas_when_row_drifts(self) -> None:
        rows = {1: {"a": "y", "b": 12.0, "c": "not-null"}}
        with self.assertRaises(SystemExit) as cm:
            rl.check_spot_row(
                rows,
                {"id": 1, "a": "x", "b": (10.5, 0.001), "c": None},
                script_name="my-script", key_field="id",
            )
        msg = str(cm.exception)
        # All three deltas surface in one failure, not just the first.
        self.assertIn("my-script", msg)
        self.assertIn("id=1", msg)
        self.assertIn("3 field(s)", msg)
        self.assertIn("  a:", msg)
        self.assertIn("expected 'x'", msg)
        self.assertIn("  b:", msg)
        self.assertIn("  c:", msg)
        self.assertIn("expected NULL", msg)

    def test_numeric_tolerance_passes_at_boundary(self) -> None:
        # Tolerance is abs-diff <= tol (inclusive at boundary).
        rows = {1: {"v": 10.001}}
        ok = rl.check_spot_row(
            rows, {"id": 1, "v": (10.0, 0.001)},
            script_name="test", key_field="id",
        )
        self.assertTrue(ok)

    def test_numeric_tolerance_fails_just_over(self) -> None:
        rows = {1: {"v": 10.0011}}
        with self.assertRaises(SystemExit) as cm:
            rl.check_spot_row(
                rows, {"id": 1, "v": (10.0, 0.001)},
                script_name="test", key_field="id",
            )
        self.assertIn("  v:", str(cm.exception))

    def test_default_key_field_is_source_id(self) -> None:
        # The xmatch scripts override key_field; nss / apsis rely on
        # the default. Pin the default so a future rename doesn't
        # silently break those callers.
        ok = rl.check_spot_row(
            {42: {"a": 1}},
            {"source_id": 42, "a": 1},
            script_name="test",
        )
        self.assertTrue(ok)

    def test_int_expected_matches_int_actual(self) -> None:
        # Bare-integer expected values (xm_flag, number_of_neighbours)
        # take the str-coerce branch. Verify ints compare cleanly.
        rows = {1: {"flag": 8}}
        ok = rl.check_spot_row(
            rows, {"id": 1, "flag": 8},
            script_name="test", key_field="id",
        )
        self.assertTrue(ok)


class ValidateSpotRowsTests(unittest.TestCase):
    """Plural hard-fail loop over check_spot_row — all pinned rows present
    passes; an absent row raises with the missing_hint; a drifted row
    raises the per-field delta from check_spot_row."""

    def test_passes_when_all_present_and_matching(self) -> None:
        rows = {1: {"a": 1}, 2: {"a": 2}}
        rl.validate_spot_rows(
            rows, [{"id": 1, "a": 1}, {"id": 2, "a": 2}],
            script_name="test", key_field="id",
        )

    def test_raises_on_absent_row_with_hint(self) -> None:
        with self.assertRaises(SystemExit) as cm:
            rl.validate_spot_rows(
                {1: {"a": 1}}, [{"id": 999, "a": 1}],
                script_name="my-script", key_field="id",
                missing_hint="missing from xmatch — dropped.",
            )
        msg = str(cm.exception)
        self.assertIn("my-script", msg)
        self.assertIn("pinned id=999", msg)
        self.assertIn("missing from xmatch — dropped.", msg)

    def test_propagates_drift_from_check_spot_row(self) -> None:
        with self.assertRaises(SystemExit) as cm:
            rl.validate_spot_rows(
                {1: {"a": 99}}, [{"id": 1, "a": 1}],
                script_name="test", key_field="id",
            )
        # The drift path is check_spot_row's, not the missing branch.
        self.assertIn("field(s) outside tolerance", str(cm.exception))

    def test_default_key_field_and_hint(self) -> None:
        with self.assertRaises(SystemExit) as cm:
            rl.validate_spot_rows(
                {}, [{"source_id": 42}], script_name="test",
            )
        msg = str(cm.exception)
        self.assertIn("pinned source_id=42", msg)
        self.assertIn("upstream selection has changed", msg)


class CheckSpotRowsTolerantTests(unittest.TestCase):
    """Soft-tolerance retirement tier (Bailer-Jones): 0 missing silent,
    ≤max_missing warns without failing, >max_missing hard-fails."""

    _KW = dict(
        script_name="refresh-bailer-jones",
        max_missing=1,
        warn_template="  WARNING: pinned source_id {key} not in result",
        fail_hint="VizieR I/352 has dropped more rows than expected.",
    )

    def test_zero_missing_no_warn_no_exit(self) -> None:
        logs: list[str] = []
        out = rl.check_spot_rows_tolerant(
            {1: {"a": 1}, 2: {"a": 2}},
            [{"source_id": 1, "a": 1}, {"source_id": 2, "a": 2}],
            log=logs.append, **self._KW,
        )
        self.assertEqual(out, [])
        self.assertEqual(logs, [])

    def test_one_missing_warns_but_does_not_exit(self) -> None:
        logs: list[str] = []
        out = rl.check_spot_rows_tolerant(
            {1: {"a": 1}},
            [{"source_id": 1, "a": 1}, {"source_id": 999, "a": 1}],
            log=logs.append, **self._KW,
        )
        self.assertEqual(out, [999])
        self.assertEqual(len(logs), 1)
        self.assertIn("pinned source_id 999 not in result", logs[0])

    def test_two_missing_over_tolerance_exits(self) -> None:
        with self.assertRaises(SystemExit) as cm:
            rl.check_spot_rows_tolerant(
                {},
                [{"source_id": 111, "a": 1}, {"source_id": 222, "a": 1}],
                log=lambda _: None, **self._KW,
            )
        msg = str(cm.exception)
        self.assertIn("2 pinned source_ids missing", msg)
        self.assertIn("tolerance 1", msg)
        self.assertIn("111", msg)
        self.assertIn("222", msg)

    def test_present_but_drifted_still_hard_fails(self) -> None:
        # A drift (present row, wrong value) is NOT a retirement — it must
        # hard-fail via check_spot_row regardless of the missing tolerance.
        with self.assertRaises(SystemExit) as cm:
            rl.check_spot_rows_tolerant(
                {1: {"a": 99}}, [{"source_id": 1, "a": 1}],
                log=lambda _: None, **self._KW,
            )
        self.assertIn("field(s) outside tolerance", str(cm.exception))


class ReportCoverageTests(unittest.TestCase):
    def test_union_fraction_and_lines(self) -> None:
        rows = [
            {"a": 1, "b": None},     # group A only
            {"a": None, "b": 2},     # group B only
            {"a": 1, "b": 2},        # both
            {"a": None, "b": None},  # neither
        ]
        logs: list[str] = []
        frac = rl.report_coverage(
            rows, 4,
            [("A", lambda r: r["a"] is not None),
             ("B", lambda r: r["b"] is not None)],
            log=logs.append,
        )
        self.assertAlmostEqual(frac, 3 / 4)  # union = A or B = 3 of 4
        text = logs[0]
        self.assertIn("coverage of 4 source_ids", text)
        self.assertIn("row present", text)
        self.assertIn("union", text)
        self.assertIn("(75.0%)", text)  # union line
        self.assertIn("(50.0%)", text)  # each group is 2/4

    def test_empty_groups_union_zero(self) -> None:
        frac = rl.report_coverage([{"a": 1}], 1, [], log=lambda _: None)
        self.assertEqual(frac, 0.0)


if __name__ == "__main__":
    unittest.main()
