#!/usr/bin/env python3
"""Unit tests for refresh_lib (no network; synthetic exceptions +
in-memory backends). Run via `python3 scripts/refresh/refresh_lib.test.py`."""

from __future__ import annotations

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
        # astroquery raises HTTPError with no `response`; the status lives
        # only in the message. Parsing it out is what keeps a long pull
        # alive through the ESA result-storage race.
        try:
            import requests
        except ImportError:
            self.skipTest("requests not installed")
        e500 = requests.HTTPError("Error 500:\nCannot find result for job X")
        e400 = requests.HTTPError("Error 400: bad ADQL syntax")
        self.assertIsNone(e500.response)
        self.assertTrue(rl.is_transient_http_error(e500))
        self.assertFalse(rl.is_transient_http_error(e400))

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


# ─── run_batched ──────────────────────────────────────────────────────

class BatchedTests(unittest.TestCase):
    def test_chunks_input(self) -> None:
        batches: list[list[int]] = []
        def q(batch):
            batches.append(list(batch))
            return [x * 10 for x in batch]
        out = rl.run_batched([1, 2, 3, 4, 5], batch_size=2, query_fn=q)
        self.assertEqual(batches, [[1, 2], [3, 4], [5]])
        self.assertEqual(out, [10, 20, 30, 40, 50])

    def test_empty_input(self) -> None:
        calls = []
        def q(batch):
            calls.append(batch)
            return []
        self.assertEqual(rl.run_batched([], batch_size=10, query_fn=q), [])
        self.assertEqual(calls, [])

    def test_invalid_batch_size(self) -> None:
        with self.assertRaises(ValueError):
            rl.run_batched([1], batch_size=0, query_fn=lambda b: [])


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
        # return valid TapBackend instances without importing astroquery/pyvo
        # at module load time.
        esa = rl.esa_backend()
        cds = rl.cds_backend()
        simbad = rl.simbad_backend()
        self.assertIsInstance(esa, rl.TapBackend)
        self.assertIsInstance(cds, rl.TapBackend)
        self.assertIsInstance(simbad, rl.TapBackend)
        self.assertEqual(esa.name, "ESA")
        self.assertEqual(cds.name, "CDS")
        self.assertEqual(simbad.name, "SIMBAD")
        # Default list composes ESA + CDS in fallback order. SIMBAD is NOT
        # in the default list — it's an explicit override per its caller.
        defaults = rl._default_backends()
        self.assertEqual([b.name for b in defaults], ["ESA", "CDS"])


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
        # astroquery returns float32 columns; numpy 2.x stopped treating them
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


class ReadAthygSourceIdsTests(unittest.TestCase):
    def test_round_trip_three_row_fixture(self) -> None:
        # Three-row fixture: one valid Gaia source_id, one empty
        # gaia, one '0' gaia. The walker returns only the valid one.
        body = (
            "id,gaia,hip\n"
            "1,2341871673090078592,2\n"      # valid Gaia source_id
            "2,,5\n"                          # empty sentinel
            "3,0,7\n"                         # '0' sentinel
        )
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "athyg.csv"
            p.write_text(body)
            ids = rl.read_athyg_source_ids(p)
        self.assertEqual(ids, [2341871673090078592])


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


if __name__ == "__main__":
    unittest.main()
