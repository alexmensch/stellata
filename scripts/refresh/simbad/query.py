"""ADQL builders + batched executors for SIMBAD pulls.

Every function is parameterised on ``list[ColumnSpec]`` /
``list[IdentLookup]`` so the SELECT clause, schema validation, and
per-row dict shape derive from the spec. The orchestration shell never
hand-builds ADQL strings.

Three execution helpers:

  * ``resolve_oids_by_prefix`` — given a list of integer values and a
    prefix (``"Gaia DR3 "``, ``"HIP "``, …), return ``{value: oid}``
    from the ``ident`` table. Batched.

  * ``fetch_basic_columns`` — given a list of SIMBAD oids and a column
    spec list, return ``{oid: row_dict}``. Batched. Schema-validates
    on the first batch.

  * ``fetch_ident_lookups`` — given a list of SIMBAD oids and an
    IdentLookup list, return ``{oid: {tsv_name: int}}`` for each
    matching prefix. Batched.

Tuning constants are at module scope. SIMBAD's TAP accepts ~64 KB of
POST body in practice; the existing precedent in
``refresh-simbad-sample.py`` is 1000-oid batches.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import refresh_lib as rl  # noqa: E402

from .specs import ColumnSpec, IdentLookup


# Per-batch IN-clause size for SIMBAD TAP. Empirically tuned against
# refresh-simbad-sample.py's ident lookup; SIMBAD accepts up to ~64KB
# POST body, 1000 integer ids ≈ 20 KB with headroom.
DEFAULT_BATCH_SIZE = 1_000


def build_basic_select(columns: Sequence[ColumnSpec], oid_inlist: str) -> str:
    """ADQL: ``SELECT <columns> FROM basic AS b WHERE b.oid IN (<inlist>)
    ORDER BY oid``. The orchestration shell never touches this string —
    column additions land in the ColumnSpec list and flow through here.
    """
    select_fragments = [f"{c.adql} AS {c.alias}" for c in columns]
    select_clause = ", ".join(select_fragments)
    return (
        f"SELECT {select_clause} "
        f"FROM basic AS b "
        f"WHERE b.oid IN ({oid_inlist}) "
        f"ORDER BY oid"
    )


def build_basic_schema(columns: Sequence[ColumnSpec]) -> dict[str, type]:
    """Schema dict consumed by ``rl.validate_schema`` on the first batch
    return. Mirrors the SELECT alias list."""
    return {c.alias: c.dtype for c in columns}


def fetch_basic_columns(
    client: rl.TapClient,
    oids: Sequence[int],
    columns: Sequence[ColumnSpec],
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
    progress_label: str = "basic",
) -> dict[int, dict[str, Any]]:
    """Pull SIMBAD basic-table rows for ``oids``, return ``{oid: row_dict}``.

    Schema-validates on the first non-empty batch — subsequent batches
    share the SELECT and so the validation cost is paid once.

    ``row_dict`` keys are ColumnSpec aliases (e.g. ``sp_type``), values
    are coerced through ``rl.coerce_masked`` so masked / NULL cells
    become Python ``None``.
    """
    schema = build_basic_schema(columns)
    aliases = [c.alias for c in columns]
    out: dict[int, dict[str, Any]] = {}
    if not oids:
        return out
    n_batches = (len(oids) + batch_size - 1) // batch_size
    schema_validated = False
    for batch_idx, offset in enumerate(range(0, len(oids), batch_size), start=1):
        batch = oids[offset : offset + batch_size]
        inlist = ",".join(str(o) for o in batch)
        t0 = time.time()
        table = client.run(build_basic_select(columns, inlist))
        if not schema_validated:
            rl.validate_schema(table, schema, label=f"SIMBAD basic ({progress_label})")
            schema_validated = True
        for row in table:
            oid = int(row["oid"])
            out[oid] = {a: rl.coerce_masked(row[a]) for a in aliases}
        print(
            f"  {progress_label} batch {batch_idx}/{n_batches}: "
            f"{len(table):4d} rows in {time.time()-t0:5.1f}s "
            f"(resolved {len(out)}/{offset+len(batch)})"
        )
    return out


def resolve_oids_by_prefix(
    client: rl.TapClient,
    values: Sequence[int],
    prefix: str,
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
    progress_label: str | None = None,
) -> dict[int, int]:
    """Translate ``values`` (e.g. Gaia DR3 source_ids) → SIMBAD oids via
    the ``ident`` table.

    ADQL: ``WHERE id IN ('<prefix><v1>', '<prefix><v2>', …)``. Returns
    ``{value: oid}``; values absent from SIMBAD ident are absent from the
    result map.

    A handful of SIMBAD ident rows carry a suffix on the integer (``HIP
    12345 A`` for one component of a wide pair) — those rows fail the
    integer cast and are silently skipped here. The canonical-integer
    row appears separately in the same result table for the same oid.
    """
    out: dict[int, int] = {}
    if not values:
        return out
    label = progress_label or prefix.strip()
    n_batches = (len(values) + batch_size - 1) // batch_size
    for batch_idx, offset in enumerate(range(0, len(values), batch_size), start=1):
        batch = values[offset : offset + batch_size]
        # SIMBAD ADQL string literals — single-quoted, value embedded.
        # Gaia DR3 source_ids are 19-digit ints and HIPs are <=6 digits;
        # neither can contain a quote, so direct interpolation is safe.
        id_list = ",".join(f"'{prefix}{v}'" for v in batch)
        t0 = time.time()
        table = client.run(
            f"SELECT oidref, id FROM ident WHERE id IN ({id_list}) ORDER BY oidref, id"
        )
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
        print(
            f"  resolve {label} batch {batch_idx}/{n_batches}: "
            f"{len(table):4d} rows in {time.time()-t0:5.1f}s "
            f"(resolved {len(out)}/{offset+len(batch)})"
        )
    return out


def fetch_ident_lookups(
    client: rl.TapClient,
    oids: Sequence[int],
    lookups: Sequence[IdentLookup],
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
    progress_label: str = "ident",
) -> dict[int, dict[str, int]]:
    """For each oid, resolve every cross-identifier declared in
    ``lookups``. Returns ``{oid: {tsv_name: int}}`` — outer key is the
    SIMBAD oid, inner keys are the lookup's ``tsv_name`` (e.g. ``hip``,
    ``source_id``).

    Builds a single OR-ed LIKE clause from every lookup's pattern, so
    one round-trip per batch covers all cross-IDs. The per-row dispatch
    matches the first lookup whose prefix the ``id`` string starts with;
    if a row's ``id`` happens to match two lookups (vanishingly rare —
    prefixes are exclusive in practice), the first listed wins.
    """
    out: dict[int, dict[str, int]] = {}
    if not oids or not lookups:
        return out
    or_clause = " OR ".join(
        f"id LIKE '{l.like_pattern}'" for l in lookups
    )
    n_batches = (len(oids) + batch_size - 1) // batch_size
    for batch_idx, offset in enumerate(range(0, len(oids), batch_size), start=1):
        batch = oids[offset : offset + batch_size]
        inlist = ",".join(str(o) for o in batch)
        t0 = time.time()
        table = client.run(
            f"SELECT oidref, id FROM ident "
            f"WHERE oidref IN ({inlist}) AND ({or_clause}) "
            f"ORDER BY oidref, id"
        )
        for row in table:
            oid = int(row["oidref"])
            id_str = str(rl.coerce_masked(row["id"]) or "")
            for lookup in lookups:
                if not id_str.startswith(lookup.prefix):
                    continue
                try:
                    value = int(id_str[lookup.prefix_len:])
                except ValueError:
                    # See resolve_oids_by_prefix: e.g. "HIP 12345 A"
                    # for one component of a pair. Canonical integer
                    # row is separate in the same result set.
                    break
                out.setdefault(oid, {})[lookup.tsv_name] = value
                break
        print(
            f"  {progress_label} batch {batch_idx}/{n_batches}: "
            f"{len(table):4d} rows in {time.time()-t0:5.1f}s "
            f"(resolved {len(out)}/{offset+len(batch)})"
        )
    return out
