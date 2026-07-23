"""ADQL builders + batched executors for SIMBAD pulls. Every function
is parameterised on ColumnSpec / IdentLookup lists so the orchestration
shell never hand-builds ADQL strings."""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any, Callable, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import refresh_lib as rl  # noqa: E402

from .specs import ColumnSpec, IdentLookup


# Per-batch IN-clause size. SIMBAD TAP accepts ~64 KB POST body in
# practice; 1000 integer ids ≈ 20 KB with headroom.
DEFAULT_BATCH_SIZE = 1_000


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


def resolve_oids_by_prefix(
    client: rl.TapClient,
    values: Sequence[int],
    prefix: str,
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
    progress_label: str | None = None,
) -> dict[int, int]:
    """Translate ``values`` → SIMBAD oids via ``ident``. Returns {value: oid}.
    Values absent from SIMBAD ident are absent from the result map; ident
    rows with a suffix (``HIP 12345 A``) fail the integer cast and are
    silently skipped — the canonical-integer row appears separately for
    the same oid."""

    def build_query(batch: Sequence[int]) -> str:
        # Gaia DR3 source_ids are 19-digit ints, HIPs are <=6 digits;
        # neither can contain a quote, so direct interpolation is safe.
        id_list = ",".join(f"'{prefix}{v}'" for v in batch)
        return f"SELECT oidref, id FROM ident WHERE id IN ({id_list}) ORDER BY oidref, id"

    def dispatch(table, out: dict[int, int]) -> None:
        for row in table:
            oid = int(row["oidref"])
            id_str = str(rl.coerce_masked(row["id"]) or "")
            if not id_str.startswith(prefix):
                continue
            try:
                value = int(id_str[len(prefix):])
            except ValueError:
                continue
            out[value] = oid

    return _run_batched(
        client,
        values,
        build_query,
        dispatch,
        label=f"resolve {progress_label or prefix.strip()}",
        batch_size=batch_size,
    )


def fetch_ident_lookups(
    client: rl.TapClient,
    oids: Sequence[int],
    lookups: Sequence[IdentLookup],
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
    progress_label: str = "ident",
) -> dict[int, dict[str, int]]:
    """For each oid resolve every cross-identifier in ``lookups``.
    Returns {oid: {tsv_name: int}}. A single OR-ed LIKE clause covers
    every lookup per batch; first matching prefix wins on collisions
    (vanishingly rare)."""
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

    def dispatch(table, out: dict[int, dict[str, int]]) -> None:
        for row in table:
            oid = int(row["oidref"])
            id_str = str(rl.coerce_masked(row["id"]) or "")
            for lookup in lookups:
                if not id_str.startswith(lookup.prefix):
                    continue
                try:
                    value = int(id_str[lookup.prefix_len:])
                except ValueError:
                    break
                out.setdefault(oid, {})[lookup.tsv_name] = value
                break

    return _run_batched(
        client,
        oids,
        build_query,
        dispatch,
        label=progress_label,
        batch_size=batch_size,
    )
