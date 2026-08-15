#!/usr/bin/env python3
"""Shared TAP / Astroquery / atomic-rename plumbing for the refresh
scripts. See scripts/refresh/README.md."""

from __future__ import annotations

import csv
import hashlib
import os
import random
import re
import time
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence, TypeVar

T = TypeVar("T")
R = TypeVar("R")


# ─── Idempotency ──────────────────────────────────────────────────────

_LIB_PATH = Path(__file__).resolve()


def is_up_to_date(output: Path, sources: Iterable[Path]) -> bool:
    """True iff `output` exists and is newer than every path in `sources`
    AND newer than refresh_lib.py itself.

    Callers pass the refresh script's `Path(__file__)` plus any data
    inputs; refresh_lib's own mtime is folded in automatically so a fix
    to `coerce_masked`, `write_tsv`, `_dtype_matches`, or the atomic-
    rename plumbing invalidates every cached output without each caller
    having to list `Path(refresh_lib.__file__)` explicitly. A missing
    source is treated as stale rather than ignored — refusing to skip
    is safer than silently keeping a possibly-out-of-date output.
    """
    if not output.exists():
        return False
    out_mtime = output.stat().st_mtime
    if _LIB_PATH.stat().st_mtime > out_mtime:
        return False
    for src in sources:
        if not src.exists() or src.stat().st_mtime > out_mtime:
            return False
    return True


# ─── AT-HYG ingest conventions ────────────────────────────────────────

# AT-HYG v3.3 uses an empty string OR the literal "0" as the missing-
# sentinel for its classical identifier columns: hip, tyc, gaia, hd.
# Sol (row id=1) carries "" for hip/tyc/gaia; a handful of historical
# rows store the same intent as "0". Both must collapse to None so a
# stray downstream lookup never returns a sentinel-0 star instead of
# the absent row it meant to ask about.

_ATHYG_MISSING_SENTINELS: frozenset[str] = frozenset({"", "0"})


def athyg_int_or_none(cell: str | None) -> int | None:
    """Parse an AT-HYG int identifier (hip / gaia / hd), treating
    empty and '0' as missing. Whitespace is stripped before the
    sentinel check; malformed values also return None.
    """
    if cell is None:
        return None
    s = cell.strip()
    if s in _ATHYG_MISSING_SENTINELS:
        return None
    try:
        return int(s)
    except ValueError:
        return None


def athyg_str_or_none(cell: str | None) -> str | None:
    """Parse an AT-HYG string identifier (tyc), treating empty and '0'
    as missing. Same sentinel convention as ``athyg_int_or_none``."""
    if cell is None:
        return None
    s = cell.strip()
    if s in _ATHYG_MISSING_SENTINELS:
        return None
    return s


def read_athyg_source_ids(csv_path: Path) -> list[int]:
    """Return the AT-HYG Gaia DR3 source_id list. Empty- and '0'-
    sentinel rows are dropped per the AT-HYG missing convention; the
    Bailer-Jones and Apsis refresh scripts share this contract because
    both queries are keyed on AT-HYG.gaia.
    """
    ids: list[int] = []
    with csv_path.open(newline="") as fh:
        reader = csv.reader(fh)
        header = next(reader)
        gi = header.index("gaia")
        for row in reader:
            sid = athyg_int_or_none(row[gi])
            if sid is not None:
                ids.append(sid)
    return ids


# ─── source_id request files ──────────────────────────────────────────

SOURCE_ID_REQUEST_HEADER = "gaia_source_id"


def read_source_id_request(path: Path) -> list[int]:
    """Read a one-column source_id request TSV; skip the header row.
    Contract: one ``gaia_source_id`` column, sorted, unique, non-null —
    produced by build-binaries Stage 2 or export-astrometry-request.ts,
    and consumed by every pull scoped to a request list rather than to a
    whole table.
    """
    ids: list[int] = []
    with path.open() as f:
        header = f.readline().strip()
        if header != SOURCE_ID_REQUEST_HEADER:
            raise SystemExit(
                f"read_source_id_request: unexpected header {header!r} in "
                f"{path} — expected {SOURCE_ID_REQUEST_HEADER!r}."
            )
        for line in f:
            line = line.strip()
            if line:
                ids.append(int(line))
    return ids


# ─── Retry ────────────────────────────────────────────────────────────

class TransientError(Exception):
    """Synthetic transient error used by callers (and tests) that want to
    signal 'please retry' without having to construct a real `requests`
    exception. The default classifier treats this as transient."""


_HTTP_STATUS_IN_MESSAGE = re.compile(r"\b([45]\d\d)\b")


def is_transient_http_error(exc: BaseException) -> bool:
    """Default classifier: True for 5xx HTTP responses, network-level
    errors, and `TransientError`. Imports `requests` and `pyvo` lazily so
    this lib remains importable in environments that don't have them
    (the test file uses synthetic exceptions only)."""
    if isinstance(exc, TransientError):
        return True
    try:
        import requests
        if isinstance(exc, (requests.ConnectionError, requests.Timeout)):
            return True
        if isinstance(exc, requests.HTTPError):
            # `raise_for_status` attaches `response`, but a TAP layer can
            # raise HTTPError without one, leaving the status only in the
            # message ("Error 500: ..."). Fall back to parsing the code out
            # of the message so such an error still classifies as transient
            # rather than escaping the retry as a permanent fault.
            if exc.response is not None:
                return 500 <= exc.response.status_code < 600
            m = _HTTP_STATUS_IN_MESSAGE.search(str(exc))
            return m is not None and 500 <= int(m.group(1)) < 600
    except ImportError:
        pass
    try:
        import pyvo
        # DALAccessError covers DALServiceError (service unreachable) AND
        # DALQueryError — which pyvo also raises for a connection dropped
        # mid-response (CDS TAP under peak load), not just bad ADQL. Our
        # ADQL is fixed, so a genuine query fault exhausts the retries
        # rather than being silently accepted.
        if isinstance(exc, pyvo.dal.DALAccessError):
            return True
    except ImportError:
        pass
    return False


def retry(
    fn: Callable[[], T],
    *,
    max_attempts: int = 4,
    base_delay_s: float = 1.0,
    backoff: float = 2.0,
    jitter: float = 0.25,
    is_transient: Callable[[BaseException], bool] = is_transient_http_error,
    sleep: Callable[[float], None] = time.sleep,
    rand: Callable[[], float] = random.random,
) -> T:
    """Call `fn` with exponential-backoff retry on transient errors.

    Attempt N (1..max_attempts): if `fn` returns, return its value. If it
    raises, ask `is_transient` — non-transient errors and the final
    attempt re-raise immediately. Sleep before attempt N+1 is
    `base_delay_s * backoff**(N-1)`, scaled by a random factor in
    `[1 - jitter, 1 + jitter]`. `sleep` and `rand` are injectable so
    tests can run synchronously and deterministically.
    """
    if max_attempts < 1:
        raise ValueError(f"max_attempts must be >= 1, got {max_attempts}")
    for attempt in range(1, max_attempts + 1):
        try:
            return fn()
        except Exception as exc:
            if attempt >= max_attempts or not is_transient(exc):
                raise
            delay = base_delay_s * (backoff ** (attempt - 1))
            delay *= 1.0 + (rand() * 2.0 - 1.0) * jitter
            sleep(max(0.0, delay))
    raise RuntimeError("retry: unreachable — loop must return or raise")


# ─── Batch checkpoint ─────────────────────────────────────────────────

_CHECKPOINT_FINGERPRINT = "fingerprint"


def _votable_encode(table: Any, path: Path) -> None:
    import warnings
    from astropy.io.votable import from_table, writeto
    from astropy.io.votable.exceptions import VOWarning
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", VOWarning)
        writeto(from_table(table), str(path))


def _votable_decode(path: Path) -> Any:
    from astropy.io.votable import parse
    return parse(str(path)).get_first_table().to_table(use_names_over_ids=True)


def _batch_fingerprint(items: Sequence[Any], batch_size: int) -> str:
    h = hashlib.sha256()
    h.update(f"{batch_size}\n{len(items)}\n".encode())
    for item in items:
        h.update(f"{item}\n".encode())
    return h.hexdigest()


class BatchCheckpoint:
    """Per-batch resume cache for ``run_in_batches``.

    A completed batch's result table is serialised under ``directory`` as
    ``batch-NNNN`` + ``suffix``; a re-run replays the cached batches and
    queries only the ones still missing, so a network drop on batch 65 of
    70 costs one batch rather than the whole pull. ``run_in_batches``
    deletes the directory once every batch has landed — a surviving
    directory means the previous run did not finish.

    The cache key is the fingerprint of ``(items, batch_size)``, recorded
    on ``begin``. A mismatch discards every cached batch: batch N covers a
    different slice of a changed request set, so replaying it would attribute
    one source_id's row to another.

    The default codec round-trips astropy tables through VOTable. Numeric
    dtypes and their masks survive exactly. A masked STRING cell decodes as
    an empty string instead — VOTable char fields carry no null marker —
    which costs nothing here: ``write_tsv`` emits an empty cell either way,
    and the Gaia archive already reports a null string column as "" rather
    than masking it. ``encode`` / ``decode`` are injectable for callers (and
    tests) whose result tables are not astropy tables.
    """

    def __init__(
        self,
        directory: Path,
        *,
        encode: Callable[[Any, Path], None] | None = None,
        decode: Callable[[Path], Any] | None = None,
        suffix: str = ".vot",
        log: Callable[[str], None] = print,
    ) -> None:
        self.directory = directory
        self.encode = encode or _votable_encode
        self.decode = decode or _votable_decode
        self.suffix = suffix
        self.log = log

    def _path(self, batch_idx: int) -> Path:
        return self.directory / f"batch-{batch_idx:04d}{self.suffix}"

    def begin(self, items: Sequence[Any], batch_size: int) -> None:
        """Establish (or re-validate) the fingerprint for this request set,
        discarding a cache left by a run over different items."""
        want = _batch_fingerprint(items, batch_size)
        marker = self.directory / _CHECKPOINT_FINGERPRINT
        if marker.exists() and marker.read_text() != want:
            self.log(
                f"  checkpoint: request set changed since the cached run — "
                f"discarding {self.directory.name}"
            )
            self.clear()
        self.directory.mkdir(parents=True, exist_ok=True)
        marker.write_text(want)

    def load(self, batch_idx: int) -> Any | None:
        path = self._path(batch_idx)
        return self.decode(path) if path.exists() else None

    def save(self, batch_idx: int, table: Any) -> None:
        path = self._path(batch_idx)
        tmp = path.with_suffix(path.suffix + ".tmp")
        try:
            self.encode(table, tmp)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
        os.replace(tmp, path)

    def clear(self) -> None:
        if not self.directory.exists():
            return
        for child in sorted(self.directory.iterdir()):
            child.unlink()
        self.directory.rmdir()


# ─── Batched query ────────────────────────────────────────────────────

def run_in_batches(
    items: Sequence[Any],
    batch_size: int,
    query_fn: Callable[[Sequence[Any]], Any],
    collect: Callable[[Any], None],
    *,
    schema: Mapping[str, type | tuple[type, ...]] | None = None,
    schema_label: str = "batch",
    checkpoint: BatchCheckpoint | None = None,
    log: Callable[[str], None] = print,
) -> None:
    """Split `items` into `batch_size` chunks, query each, feed the result
    table to `collect`, logging per-batch timing + cumulative progress.

    `collect` owns accumulation — a dict keyed by source_id, a transformed
    list, whatever the caller needs — so the shape of the result never
    leaks into this helper. The first batch is schema-validated against
    `schema` (labelled `schema_label`) when given; the batched pulls all
    validate exactly once, on batch 1, since every batch shares one ADQL
    projection. `collect=rows.extend` recovers a plain concatenating pull.

    Pass `checkpoint` to make the pull resumable — see `BatchCheckpoint`.
    Cached batches feed `collect` in their original position, so ordering
    is identical whether a batch was queried or replayed, and batch 1's
    schema check runs against the cached table too: a cache written by an
    incompatible projection fails there rather than downstream.
    """
    if batch_size <= 0:
        raise ValueError(f"batch_size must be positive, got {batch_size}")
    total = len(items)
    n_batches = (total + batch_size - 1) // batch_size
    if checkpoint is not None and total:
        checkpoint.begin(items, batch_size)
    start = time.time()
    seen = 0
    for batch_idx, offset in enumerate(range(0, total, batch_size), start=1):
        batch = items[offset : offset + batch_size]
        t0 = time.time()
        table = checkpoint.load(batch_idx) if checkpoint is not None else None
        resumed = table is not None
        if not resumed:
            table = query_fn(batch)
            if checkpoint is not None:
                checkpoint.save(batch_idx, table)
        if batch_idx == 1 and schema is not None:
            validate_schema(table, schema, label=schema_label)
        collect(table)
        seen += len(table)
        origin = "from checkpoint" if resumed else f"in {time.time() - t0:5.1f}s"
        cum = time.time() - start
        log(
            f"  batch {batch_idx}/{n_batches}: {len(table):4d} rows "
            f"{origin} (cum {cum/60:.1f}m, total rows {seen})"
        )
    if checkpoint is not None:
        checkpoint.clear()


# ─── Row-count guard ──────────────────────────────────────────────────

_ROW_COUNT_DEFAULT_HINT = (
    "upstream schema or selection has changed; investigate before re-pinning."
)


def assert_row_count(
    n: int,
    low: int,
    high: int,
    label: str,
    *,
    hint: str = _ROW_COUNT_DEFAULT_HINT,
) -> None:
    """Raise SystemExit unless ``low <= n <= high`` (inclusive both ends).

    The frozen external catalogues each pin an expected row-count band; a
    pull outside it means upstream re-indexed, the request set changed, or
    the ADQL drifted — all of which want a human before the output is
    re-committed. ``hint`` tails the failure message with the script-
    specific cause; ``label`` prefixes it (a per-table label carries the
    VizieR table name for multi-table pulls).
    """
    if not (low <= n <= high):
        raise SystemExit(
            f"{label}: row count {n} outside expected "
            f"[{low}, {high}] — {hint}"
        )


# ─── Schema validation ────────────────────────────────────────────────

class SchemaError(Exception):
    """Raised by validate_schema when actual columns / dtypes don't match
    the expected mapping."""


def validate_schema(
    table: Any,
    expected: Mapping[str, type | tuple[type, ...]],
    *,
    label: str = "table",
) -> None:
    """Validate column names + dtypes of an astropy Table, a dict-of-columns,
    or any table-like exposing `.columns` (names) with `table[col].dtype`.
    Each `expected` entry is a column name → expected Python base type or
    tuple of types; dtypes resolve for numpy dtypes and Python builtin
    types. Extra columns in `table` are allowed; missing columns or
    mismatched dtypes raise SchemaError.
    """
    colnames = _column_names(table)
    missing = [c for c in expected if c not in colnames]
    if missing:
        raise SchemaError(f"{label}: missing columns {missing}")
    for col, want in expected.items():
        dtype = _column_dtype(table, col)
        if not _dtype_matches(dtype, want):
            raise SchemaError(
                f"{label}: column {col!r} has dtype {dtype!r}, expected {want!r}"
            )


def _column_names(table: Any) -> list[str]:
    if hasattr(table, "colnames"):
        return list(table.colnames)
    if hasattr(table, "columns") and not isinstance(table, dict):
        return list(table.columns)
    return list(table.keys())


def _column_dtype(table: Any, col: str) -> Any:
    column = table[col]
    return getattr(column, "dtype", type(column))


def _dtype_matches(dtype: Any, want: type | tuple[type, ...]) -> bool:
    wants = want if isinstance(want, tuple) else (want,)
    try:
        import numpy as np
        if isinstance(dtype, np.dtype):
            # NumPy 2.x: np.issubdtype(int32, int) is False — only int64 is
            # a subdtype of Python int (similarly float32 vs float). Map
            # Python builtins to numpy abstract supertypes so int / float
            # match every width. `str` accepts both fixed-width unicode
            # arrays (<UN) and object-dtype arrays (Gaia TAP returns the
            # latter for variable-length string columns).
            np_supertypes: dict[type, tuple[type, ...]] = {
                int: (np.integer,),
                float: (np.floating,),
                bool: (np.bool_,),
                complex: (np.complexfloating,),
                str: (np.character, np.object_),
            }
            return any(
                any(np.issubdtype(dtype, t) for t in np_supertypes.get(w, (w,)))
                for w in wants
            )
    except ImportError:
        pass
    if isinstance(dtype, type):
        return any(issubclass(dtype, w) for w in wants)
    return dtype in wants


# ─── TAP client ───────────────────────────────────────────────────────

class TapBackend:
    """One TAP service endpoint. `run(adql)` executes the query and returns
    the result table (astropy Table or equivalent). Test backends can return
    any iterable of row mappings."""

    def __init__(self, name: str, run: Callable[[str], Any]) -> None:
        self.name = name
        self.run = run


class TapClient:
    """Backend-agnostic TAP client with auto-fallback.

    Tries each backend in order on every query; falls back to the next on a
    transient (network-level or 5xx) error. Non-transient errors (e.g.
    ADQL syntax) raise from the first backend that returns them — both
    backends share the same ADQL grammar so a syntax error fails the
    same way on either.

    `backends` is required — there is no default list. Which service can
    serve a query is a property of the table, not of TAP, so picking for
    the caller only ever picks wrong: Gaia-keyed pulls want
    `gaia_sync_client()`, VizieR-only tables want `[cds_backend()]`, and
    SIMBAD's divergent dialect wants `[simbad_backend()]`.
    """

    def __init__(
        self,
        backends: Sequence[TapBackend],
        *,
        retry_kwargs: Mapping[str, Any] | None = None,
    ) -> None:
        self.backends = list(backends)
        if not self.backends:
            raise ValueError("TapClient requires at least one backend")
        self.retry_kwargs = dict(retry_kwargs or {})

    def run(self, query: str) -> Any:
        last_transient: BaseException | None = None
        for backend in self.backends:
            try:
                return retry(lambda b=backend: b.run(query), **self.retry_kwargs)
            except Exception as exc:
                if not is_transient_http_error(exc):
                    raise
                last_transient = exc
        assert last_transient is not None  # at least one backend, all transient
        raise last_transient


CDS_TAP_URL = "https://tapvizier.u-strasbg.fr/TAPVizieR/tap"
SIMBAD_TAP_URL = "https://simbad.cds.unistra.fr/simbad/sim-tap"

# Synchronous Gaia DR3 TAP endpoints — the only way this lib reaches Gaia.
# The ESA archive's ASYNC path intermittently 500s on result retrieval
# while its SYNC endpoint stays healthy; ARI Heidelberg hosts the
# identical `gaiadr3.*` schema as a same-query fallback.
GAIA_ESA_SYNC_TAP_URL = "https://gea.esac.esa.int/tap-server/tap"
GAIA_ARI_SYNC_TAP_URL = "https://gaia.ari.uni-heidelberg.de/tap"

# ESA caps TAP output at 3,000,000 rows (hard == default, per its
# /capabilities); ARI's hard cap is 10,000,000. A whole-table sync pull
# has to fit the smaller of the two, since either mirror may serve it.
GAIA_SYNC_MAX_ROWS = 3_000_000

GAIA_SYNC_RETRY_KWARGS: Mapping[str, Any] = {"max_attempts": 5, "base_delay_s": 2.0}


def _cds_run(query: str) -> Any:
    import pyvo
    service = pyvo.dal.TAPService(CDS_TAP_URL)
    return service.search(query).to_table()


def _simbad_run(query: str) -> Any:
    import pyvo
    service = pyvo.dal.TAPService(SIMBAD_TAP_URL)
    return service.search(query).to_table()


def cds_backend() -> TapBackend:
    """CDS / VizieR TAP backend. Required for VizieR-only tables (e.g.
    Bailer-Jones I/352/gedr3dis, Hipparcos-2 I/311/hip2) that ESA does
    not host."""
    return TapBackend(name="CDS", run=_cds_run)


def simbad_backend() -> TapBackend:
    """SIMBAD TAP backend (basic, ident, allfluxes, otypedef, mes*
    tables). Used by refresh-simbad-sample.py as a single-backend override
    — SIMBAD speaks its own dialect (LIKE forbidden on basic.otype; MOD()
    available but `%` operator is not) and is not interchangeable with
    ESA or CDS for these tables, so callers pass `backends=[simbad_backend()]`
    explicitly rather than relying on the default fallback list."""
    return TapBackend(name="SIMBAD", run=_simbad_run)


def _iter_votable_infos(votable: Any) -> Iterable[Any]:
    yield from getattr(votable, "infos", [])
    for res in getattr(votable, "resources", []):
        yield from getattr(res, "infos", [])


def votable_query_status(votable: Any) -> tuple[bool, str]:
    """Inspect a parsed VOTable's QUERY_STATUS INFO. Returns `(ok,
    message)`. Sync TAP answers HTTP 200 even for a query-level error or
    a row OVERFLOW, flagging it in an INFO element rather than the status
    line — so a caller that only checks the HTTP code would silently
    accept a truncated or failed result."""
    for info in _iter_votable_infos(votable):
        if getattr(info, "name", None) == "QUERY_STATUS":
            val = getattr(info, "value", "") or ""
            if val in ("OK", ""):
                continue
            detail = getattr(info, "content", "") or getattr(info, "value", "")
            return False, f"{val}: {detail}"
    return True, ""


class SyncOverflowError(Exception):
    """MAXREC truncated a sync TAP result. Permanent for a fixed MAXREC —
    retrying, or falling back to another mirror, truncates identically — so
    this must NOT be classified transient: the retry would burn the backoff
    schedule and then report a truncation as a network fault."""


_SYNC_OVERFLOW = re.compile(r"overflow", re.I)
_SYNC_PERMANENT_FAULT = re.compile(r"unknown column|not found|syntax|invalid", re.I)


def _sync_tap_run(base_url: str, query: str, maxrec: int) -> Any:
    """Run one synchronous ADQL query over HTTP POST and parse the VOTable
    result into an astropy Table. Sync avoids the archive's async
    result-storage path; POST keeps a long IN-list out of the URL. MAXREC
    is raised above the pull's row count so a full result never trips the
    overflow truncation. A query-level error in the VOTable is re-raised
    as transient unless it is an overflow or looks like a permanent ADQL
    fault."""
    import io
    import requests
    from astropy.io.votable import parse as parse_votable

    resp = requests.post(
        base_url.rstrip("/") + "/sync",
        data={
            "REQUEST": "doQuery",
            "LANG": "ADQL",
            "FORMAT": "votable",
            "MAXREC": str(maxrec),
            "QUERY": query,
        },
        timeout=300,
    )
    resp.raise_for_status()
    votable = parse_votable(io.BytesIO(resp.content))
    ok, msg = votable_query_status(votable)
    if not ok:
        if _SYNC_OVERFLOW.search(msg):
            raise SyncOverflowError(
                f"sync TAP truncated the result at MAXREC={maxrec} ({msg}) — "
                f"raise the caller's maxrec above the pull's row count."
            )
        if _SYNC_PERMANENT_FAULT.search(msg):
            raise RuntimeError(f"sync TAP query error: {msg}")
        raise TransientError(f"sync TAP transient error: {msg}")
    return votable.get_first_table().to_table(use_names_over_ids=True)


def gaia_sync_backend(
    name: str = "ESA-sync",
    *,
    base_url: str = GAIA_ESA_SYNC_TAP_URL,
    maxrec: int = 20_000,
) -> TapBackend:
    """Synchronous Gaia DR3 TAP backend (POST `/sync`, VOTable). Serves
    the same `gaiadr3.gaia_source` schema as the async ESA archive.
    `base_url` selects the archive — the ESA default or the ARI Heidelberg
    mirror (`GAIA_ARI_SYNC_TAP_URL`), a same-schema fallback for when ESA
    is degraded. `maxrec` must exceed the per-query row count."""
    return TapBackend(name=name, run=lambda q: _sync_tap_run(base_url, q, maxrec))


def gaia_sync_client(
    maxrec: int,
    *,
    retry_kwargs: Mapping[str, Any] | None = None,
) -> TapClient:
    """TapClient over the Gaia sync endpoints: ESA primary → ARI Heidelberg
    fallback, both at `maxrec`. Every Gaia-keyed pull shares this pair. The
    default ESA→CDS fallback list is wrong for `gaiadr3.*`: CDS VizieR does
    not host those tables and would fail a fallback attempt with a
    misleading "table not found"."""
    return TapClient(
        backends=[
            gaia_sync_backend(
                "ESA-sync", base_url=GAIA_ESA_SYNC_TAP_URL, maxrec=maxrec
            ),
            gaia_sync_backend(
                "ARI-sync", base_url=GAIA_ARI_SYNC_TAP_URL, maxrec=maxrec
            ),
        ],
        retry_kwargs=GAIA_SYNC_RETRY_KWARGS if retry_kwargs is None else retry_kwargs,
    )


def whole_table_sync_maxrec(
    expected_row_count_max: int, *, cap: int = GAIA_SYNC_MAX_ROWS
) -> int:
    """MAXREC for a pull that fetches a whole table in ONE sync query:
    double the pinned row-count ceiling, clamped to the mirrors' output
    cap. Doubling keeps an upstream re-index from silently overflowing
    before the row-count guard can report it.

    Raises SystemExit when the ceiling itself exceeds the cap — that pull
    no longer fits one sync query and needs batching, which is a code
    change rather than a re-pin. Batched pulls size MAXREC off their batch
    size instead and don't use this.
    """
    if expected_row_count_max > cap:
        raise SystemExit(
            f"whole_table_sync_maxrec: pinned ceiling {expected_row_count_max} "
            f"exceeds the sync output cap {cap} — this pull can no longer be "
            f"served in one sync query; batch it (see run_in_batches)."
        )
    return min(expected_row_count_max * 2, cap)


# ─── Spot-check pin helper ────────────────────────────────────────────

def check_spot_row(
    rows_by_id: Mapping[Any, Any],
    spec: Mapping[str, Any],
    *,
    script_name: str,
    key_field: str = "source_id",
) -> bool:
    """Assert one pinned row in a query result matches the expected
    values. Returns True when the row is present AND all fields match.
    Returns False when the keyed row is absent from ``rows_by_id`` —
    callers decide whether absence is a hard fail (xmatch: a HIP /
    Tycho identifier can't retire, missing row is a real signal) or a
    soft warning (Bailer-Jones: a DR4 maintenance reload may quietly
    retire a handful of source_ids).

    Raises SystemExit when the row IS present but any field drifts.
    All field deltas are reported in a single failure message — so a
    future column rename, unit shift, or value drift surfaces every
    mismatched field at once instead of failing on the first one.

    Expected-value forms in ``spec``:
      - ``str`` / ``int``       : exact match (string-compared, so
                                  numeric types coerce cleanly).
      - ``(float, float)``      : ``(expected, abs-tolerance)``.
      - ``None``                : the cell must be masked / null.
    """
    key = spec[key_field]
    row = rows_by_id.get(key)
    if row is None:
        return False
    deltas: list[str] = []
    for field, expected in spec.items():
        if field == key_field:
            continue
        actual = coerce_masked(row[field])
        if expected is None:
            if actual is not None:
                deltas.append(f"  {field}: expected NULL, got {actual!r}")
        elif isinstance(expected, tuple):
            want, tol = expected
            if actual is None:
                deltas.append(f"  {field}: expected ~{want} (±{tol}), got NULL")
            elif abs(float(actual) - float(want)) > tol:
                deltas.append(
                    f"  {field}: expected ~{want} (±{tol}), got {float(actual)}"
                )
        else:
            if actual is None or str(actual) != str(expected):
                deltas.append(f"  {field}: expected {expected!r}, got {actual!r}")
    if deltas:
        joined = "\n".join(deltas)
        raise SystemExit(
            f"{script_name}: spot-check {key_field}={key} drift — "
            f"{len(deltas)} field(s) outside tolerance:\n{joined}"
        )
    return True


def validate_spot_rows(
    rows_by_key: Mapping[Any, Any],
    specs: Iterable[Mapping[str, Any]],
    *,
    script_name: str,
    key_field: str = "source_id",
    missing_hint: str = "missing from query result — upstream selection has changed.",
) -> None:
    """Run ``check_spot_row`` over every pinned ``spec``, hard-failing on an
    absent row. A present-but-drifted row raises inside ``check_spot_row``
    with its per-field delta list; an absent keyed row raises SystemExit
    here with ``missing_hint`` (which names the retirement cause — a HIP /
    Tycho identifier can't retire, a Gaia selection can). This is the
    hard-fail contract shared by the xmatch / nss / apsis pulls; the
    soft-tolerance retirement pattern (Bailer-Jones) stays inline —
    absence there is expected within a bound.
    """
    for spec in specs:
        if not check_spot_row(
            rows_by_key, spec, script_name=script_name, key_field=key_field
        ):
            raise SystemExit(
                f"{script_name}: pinned {key_field}={spec[key_field]} {missing_hint}"
            )


def check_spot_rows_tolerant(
    rows_by_key: Mapping[Any, Any],
    specs: Iterable[Mapping[str, Any]],
    *,
    script_name: str,
    key_field: str = "source_id",
    max_missing: int,
    warn_template: str,
    fail_hint: str,
    log: Callable[[str], None] = print,
) -> list[Any]:
    """Soft-tolerance sibling of ``validate_spot_rows``. A present-but-drifted
    row still hard-fails inside ``check_spot_row``; an ABSENT pinned row is
    a warning (``warn_template.format(key=...)``) tolerated up to
    ``max_missing`` — a Gaia DR4 maintenance reload can quietly retire a
    source_id or two from a small pinned sample. More than ``max_missing``
    absent raises SystemExit. Returns the list of missing keys.
    """
    missing: list[Any] = []
    for spec in specs:
        if not check_spot_row(
            rows_by_key, spec, script_name=script_name, key_field=key_field
        ):
            key = spec[key_field]
            missing.append(key)
            log(warn_template.format(key=key))
    if len(missing) > max_missing:
        raise SystemExit(
            f"{script_name}: {len(missing)} pinned {key_field}s missing "
            f"(tolerance {max_missing}): {missing} — {fail_hint}"
        )
    return missing


# ─── Coverage report ──────────────────────────────────────────────────

def report_coverage(
    rows: Iterable[Mapping[str, Any]],
    total_input: int,
    groups: Sequence[tuple[str, Callable[[Mapping[str, Any]], bool]]],
    *,
    label: str = "source_ids",
    log: Callable[[str], None] = print,
) -> float:
    """Log row-present, per-group, and union coverage of `rows` over
    `total_input`; return the union fraction. Each `groups` entry is a
    ``(name, predicate)``; a row counts toward the union when it satisfies
    ANY predicate. The union is the headline number a pull gates on; the
    per-group lines show which pipeline contributed it. Shared by the
    Apsis (gspphot ∪ gspspec) and Bailer-Jones (geo ∪ photogeo) pulls so
    their observability reads the same way.
    """
    rows = list(rows)
    n = len(rows)
    width = max([len("row present"), len("union"), *(len(name) for name, _ in groups)])

    def line(name: str, count: int) -> str:
        return f"  {name.ljust(width)}  {count:>6} ({100 * count / total_input:.1f}%)"

    out = [f"coverage of {total_input} {label}:", line("row present", n)]
    for name, pred in groups:
        out.append(line(name, sum(1 for r in rows if pred(r))))
    union = sum(1 for r in rows if any(pred(r) for _, pred in groups))
    out.append(line("union", union))
    log("\n".join(out))
    return union / total_input


# ─── Masked-value normaliser ──────────────────────────────────────────

def coerce_masked(value: Any) -> Any:
    """Convert astropy/numpy masked values to None for clean TSV nulls.

    Astropy MaskedColumn elements return `numpy.ma.masked` (a
    MaskedConstant) for missing cells; `str(np.ma.masked)` is "--" which
    would corrupt the TSV via write_tsv's `str(v)` fallback. Coerce to
    None so write_tsv emits an empty cell. Object-dtype string columns
    return masked as `--` strings too — the MaskedConstant isinstance
    check catches those.

    The `.mask` fallback covers masked scalars that aren't the shared
    MaskedConstant singleton — a 0-d masked array, or whatever a future
    astropy/numpy version returns from a masked-cell access path — so a
    masked value can't slip through as the literal "--" string. A
    non-scalar `.mask` (a whole column passed by mistake) is left alone
    rather than guessed at.
    """
    try:
        import numpy as np
        if value is np.ma.masked:
            return None
        if isinstance(value, np.ma.core.MaskedConstant):
            return None
        mask = getattr(value, "mask", None)
        if mask is not None:
            try:
                if bool(mask):
                    return None
            except (ValueError, TypeError):
                pass
    except ImportError:
        pass
    return value


# ─── TSV writer ───────────────────────────────────────────────────────

def write_tsv(
    rows: Iterable[Mapping[str, Any]],
    columns: Sequence[str],
    output: Path,
    *,
    round_floats: int | None = None,
) -> int:
    """Write `rows` to `output` as tab-separated values with a header line.
    Returns the row count written. None values become empty cells; floats
    (Python float OR numpy floating width) round to `round_floats` decimal
    places when set.

    Atomic: writes to ``output.with_suffix(output.suffix + ".tmp")`` and
    swaps in via ``os.replace`` once the row stream completes. Any
    mid-stream failure (disk full, KeyboardInterrupt, masked-cell coerce
    raising, OOM on a large batch) leaves the committed output untouched
    — never half-written — and the ``.tmp`` sibling is cleaned up so a
    future ``is_up_to_date`` check can't be fooled by a stale partial.
    POSIX ``rename(2)`` guarantees the swap is atomic on the same
    filesystem, which the sibling-path layout ensures.
    """
    output.parent.mkdir(parents=True, exist_ok=True)
    tmp = output.with_suffix(output.suffix + ".tmp")
    n = 0
    try:
        with tmp.open("w", encoding="utf-8") as f:
            f.write("\t".join(columns) + "\n")
            for row in rows:
                cells: list[str] = []
                for col in columns:
                    v = row.get(col)
                    if v is None:
                        cells.append("")
                    elif round_floats is not None and _is_float(v):
                        cells.append(f"{float(v):.{round_floats}f}")
                    else:
                        cells.append(str(v))
                f.write("\t".join(cells) + "\n")
                n += 1
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    os.replace(tmp, output)
    return n


def _is_float(v: Any) -> bool:
    """True for Python float or any numpy floating width. NumPy 2.x stopped
    treating np.float32 as a Python-float subclass, so a plain isinstance
    check would miss the archives' float32 columns (Gaia serves the Apsis
    parameters at float32)."""
    if isinstance(v, float):
        return True
    try:
        import numpy as np
        return isinstance(v, np.floating)
    except ImportError:
        return False
