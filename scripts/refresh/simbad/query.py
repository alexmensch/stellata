"""ADQL builders + batched executors for SIMBAD pulls. Every function
is parameterised on ColumnSpec / IdentLookup lists so the orchestration
shell never hand-builds ADQL strings."""

from __future__ import annotations

import re
import sys
import time
from pathlib import Path
from typing import Any, Callable, Sequence, TypeVar

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import refresh_lib as rl  # noqa: E402

from .specs import ColumnSpec, FluxBand, IdentLookup


# Per-batch IN-clause size. SIMBAD TAP accepts ~64 KB POST body in
# practice; 1000 integer ids ≈ 20 KB with headroom.
DEFAULT_BATCH_SIZE = 1_000

# What one namespace holds for one oid: a single suffix, or the set of them.
T = TypeVar("T")


def _run_batched(
    client: rl.TapClient,
    items: Sequence[Any],
    build_query: Callable[[Sequence[Any]], str],
    dispatch: Callable[[Any, dict], None],
    *,
    label: str,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> dict:
    """Run a batched IN-clause TAP pull over ``items``. ``build_query``
    maps a batch slice to ADQL; ``dispatch`` folds each returned table
    into the accumulator dict. Owns the batching loop, per-batch timing,
    and progress print; returns the accumulator."""
    out: dict = {}
    if not items:
        return out
    n_batches = (len(items) + batch_size - 1) // batch_size
    for batch_idx, offset in enumerate(range(0, len(items), batch_size), start=1):
        batch = items[offset : offset + batch_size]
        t0 = time.time()
        table = client.run(build_query(batch))
        dispatch(table, out)
        print(
            f"  {label} batch {batch_idx}/{n_batches}: "
            f"{len(table):4d} rows in {time.time()-t0:5.1f}s "
            f"(resolved {len(out)}/{offset+len(batch)})"
        )
    return out


def build_basic_select(columns: Sequence[ColumnSpec], oid_inlist: str) -> str:
    """ADQL: SELECT <columns> FROM basic AS b WHERE b.oid IN (...) ORDER BY oid."""
    select_fragments = [f"{c.adql} AS {c.alias}" for c in columns]
    select_clause = ", ".join(select_fragments)
    return (
        f"SELECT {select_clause} "
        f"FROM basic AS b "
        f"WHERE b.oid IN ({oid_inlist}) "
        f"ORDER BY oid"
    )


def build_basic_schema(columns: Sequence[ColumnSpec]) -> dict[str, type]:
    """Schema dict consumed by rl.validate_schema on the first batch."""
    return {c.alias: c.dtype for c in columns}


def fetch_basic_columns(
    client: rl.TapClient,
    oids: Sequence[int],
    columns: Sequence[ColumnSpec],
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
    progress_label: str = "basic",
) -> dict[int, dict[str, Any]]:
    """Pull SIMBAD basic-table rows for ``oids``. Returns {oid: row_dict}
    keyed by ColumnSpec aliases; cells flow through rl.coerce_masked so
    masked / NULL values become None."""
    schema = build_basic_schema(columns)
    aliases = [c.alias for c in columns]
    schema_validated = False

    def dispatch(table, out: dict[int, dict[str, Any]]) -> None:
        nonlocal schema_validated
        if not schema_validated:
            rl.validate_schema(table, schema, label=f"SIMBAD basic ({progress_label})")
            schema_validated = True
        for row in table:
            oid = int(row["oid"])
            out[oid] = {a: rl.coerce_masked(row[a]) for a in aliases}

    return _run_batched(
        client,
        oids,
        lambda batch: build_basic_select(columns, ",".join(str(o) for o in batch)),
        dispatch,
        label=progress_label,
        batch_size=batch_size,
    )


_QUOTABLE_SUFFIX = re.compile(r"^[A-Za-z0-9 .+\-]+$")


def resolve_oids_by_prefix(
    client: rl.TapClient,
    values: Sequence[int | str],
    lookup: IdentLookup,
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
    progress_label: str | None = None,
) -> dict[int | str, int]:
    """Translate ``values`` (suffixes, no prefix) → SIMBAD oids via
    ``ident``. Returns {suffix: oid} keyed on the suffix parsed back off the
    returned row, so a space-padded stored id joins its request. Values
    absent from SIMBAD ident are absent from the result map."""
    rejected = [v for v in values if not _QUOTABLE_SUFFIX.match(str(v))]
    if rejected:
        raise SystemExit(
            f"resolve_oids_by_prefix: {len(rejected)} {lookup.prefix.strip()} "
            f"suffixes carry characters the ADQL literal cannot hold "
            f"(first: {rejected[0]!r})."
        )

    def build_query(batch: Sequence[int | str]) -> str:
        id_list = ",".join(f"'{lookup.compose(v)}'" for v in batch)
        return f"SELECT oidref, id FROM ident WHERE id IN ({id_list}) ORDER BY oidref, id"

    def dispatch(table, out: dict[int | str, int]) -> None:
        for row in table:
            suffix = lookup.parse_suffix(str(rl.coerce_masked(row["id"]) or ""))
            if suffix is not None:
                out[suffix] = int(row["oidref"])

    return _run_batched(
        client,
        values,
        build_query,
        dispatch,
        label=f"resolve {progress_label or lookup.prefix.strip()}",
        batch_size=batch_size,
    )


def fetch_flux_bands(
    client: rl.TapClient,
    oids: Sequence[int],
    bands: Sequence[FluxBand],
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
    progress_label: str = "flux",
) -> dict[int, dict[str, Any]]:
    """Pull the long-format ``flux`` table for ``bands`` and pivot it wide.
    Returns {oid: {tsv_name: value}} over each band's value / error /
    bibcode columns. ``flux`` rather than ``allfluxes`` because only it
    carries the per-band bibcode a § 5 SIMBAD tier must ship."""
    if not bands:
        return {}
    by_filter = {b.filter: b for b in bands}
    filter_list = ",".join(f"'{b.filter}'" for b in bands)

    def build_query(batch: Sequence[int]) -> str:
        inlist = ",".join(str(o) for o in batch)
        return (
            f"SELECT oidref, filter, flux, flux_err, bibcode FROM flux "
            f"WHERE oidref IN ({inlist}) AND filter IN ({filter_list}) "
            f"ORDER BY oidref, filter"
        )

    def dispatch(table, out: dict[int, dict[str, Any]]) -> None:
        for row in table:
            band = by_filter.get(str(rl.coerce_masked(row["filter"]) or "").strip())
            if band is None:
                continue
            cells = out.setdefault(int(row["oidref"]), {})
            for tsv_name, source in band.column_sources():
                cells[tsv_name] = rl.coerce_masked(row[source])

    return _run_batched(
        client,
        oids,
        build_query,
        dispatch,
        label=progress_label,
        batch_size=batch_size,
    )


def _fetch_idents(
    client: rl.TapClient,
    oids: Sequence[int],
    lookups: Sequence[IdentLookup],
    insert: Callable[[dict[str, T], str, int | str], None],
    *,
    batch_size: int,
    progress_label: str,
) -> dict[int, dict[str, T]]:
    """{oid: {tsv_name: …}} over every ``ident`` row matching one of
    ``lookups``, ``insert`` deciding what a namespace holds when SIMBAD
    publishes more than one id under it. Rows fold straight into their final
    shape — at manifest scope this accumulator runs to ~100 MB, so an
    intermediate would double it. A single OR-ed LIKE clause covers every
    lookup per batch; first matching prefix wins on collisions (vanishingly
    rare)."""
    if not lookups:
        return {}
    or_clause = " OR ".join(f"id LIKE '{l.like_pattern}'" for l in lookups)

    def build_query(batch: Sequence[int]) -> str:
        inlist = ",".join(str(o) for o in batch)
        return (
            f"SELECT oidref, id FROM ident "
            f"WHERE oidref IN ({inlist}) AND ({or_clause}) "
            f"ORDER BY oidref, id"
        )

    def dispatch(table, out: dict[int, dict[str, T]]) -> None:
        for row in table:
            id_str = str(rl.coerce_masked(row["id"]) or "")
            for lookup in lookups:
                if not id_str.startswith(lookup.prefix):
                    continue
                suffix = lookup.parse_suffix(id_str)
                if suffix is not None:
                    insert(
                        out.setdefault(int(row["oidref"]), {}),
                        lookup.tsv_name,
                        suffix,
                    )
                break

    return _run_batched(
        client,
        oids,
        build_query,
        dispatch,
        label=progress_label,
        batch_size=batch_size,
    )


def _keep_last(
    per_namespace: dict[str, int | str], tsv_name: str, suffix: int | str
) -> None:
    per_namespace[tsv_name] = suffix


def _collect(
    per_namespace: dict[str, set[int | str]], tsv_name: str, suffix: int | str
) -> None:
    per_namespace.setdefault(tsv_name, set()).add(suffix)


def fetch_ident_lookups(
    client: rl.TapClient,
    oids: Sequence[int],
    lookups: Sequence[IdentLookup],
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
    progress_label: str = "ident",
) -> dict[int, dict[str, int | str]]:
    """One cross-identifier per namespace per oid — {oid: {tsv_name: suffix}}.
    Where SIMBAD holds several under one namespace the last in table order
    wins; the shipped TSV is single-valued per column, so a winner has to be
    picked somewhere."""
    return _fetch_idents(
        client, oids, lookups, _keep_last,
        batch_size=batch_size, progress_label=progress_label,
    )


def fetch_ident_sets(
    client: rl.TapClient,
    oids: Sequence[int],
    lookups: Sequence[IdentLookup],
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
    progress_label: str = "ident sets",
) -> dict[int, dict[str, set[int | str]]]:
    """Every cross-identifier per namespace per oid —
    {oid: {tsv_name: {suffix, …}}}. The widening's corroboration asks whether
    an id is present at all, so it may not drop the losers of a namespace
    the way ``fetch_ident_lookups`` does."""
    return _fetch_idents(
        client, oids, lookups, _collect,
        batch_size=batch_size, progress_label=progress_label,
    )
