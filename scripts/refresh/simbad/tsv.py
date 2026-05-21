"""TSV writer driven by ColumnSpec + IdentLookup lists.

The orchestration shell hands us a list of per-oid row dicts (one from
``query.fetch_basic_columns``, one from ``query.fetch_ident_lookups``)
keyed by SIMBAD oid; ``write_simbad_tsv`` merges them into one TSV with
columns derived from the spec lists.

The TSV header is exactly:
    [c.tsv_name for c in columns] + [l.tsv_name for l in ident_lookups]

so a future-added ColumnSpec or IdentLookup lands as a new column at
the end of the row, never breaking existing readers (which look up
columns by name).
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import refresh_lib as rl  # noqa: E402

from .specs import ColumnSpec, IdentLookup


def build_tsv_header(
    columns: Sequence[ColumnSpec],
    ident_lookups: Sequence[IdentLookup],
) -> list[str]:
    """Header column list — basic columns first, ident lookups after.
    Mirrored by ``build_row_dict`` so positional reasoning is moot:
    consumers look up by ``tsv_name``."""
    return [c.tsv_name for c in columns] + [l.tsv_name for l in ident_lookups]


def build_row_dict(
    oid: int,
    basic_row: Mapping[str, Any] | None,
    ident_values: Mapping[str, int] | None,
    columns: Sequence[ColumnSpec],
    ident_lookups: Sequence[IdentLookup],
) -> dict[str, Any]:
    """One output dict, one oid. Each cell flows through ``coerce_masked``
    (already done by ``query.fetch_basic_columns`` for basic values) and
    ``str`` formatting at write_tsv time. None values become empty TSV
    cells.

    ``basic_row`` may be None if the oid was supplied by an input source
    but is missing from the basic table — in practice every SIMBAD oid
    in the ident table has a basic row, but the guard keeps the helper
    pure.
    """
    out: dict[str, Any] = {}
    for c in columns:
        out[c.tsv_name] = (basic_row or {}).get(c.alias)
    # OID is always written from the master oid (not the basic row's
    # value), so an oid with no basic row still has its column populated.
    out[next(c.tsv_name for c in columns if c.alias == "oid")] = oid
    for l in ident_lookups:
        out[l.tsv_name] = (ident_values or {}).get(l.tsv_name)
    return out


def write_simbad_tsv(
    output: Path,
    oids: Iterable[int],
    basic_rows: Mapping[int, Mapping[str, Any]],
    ident_rows: Mapping[int, Mapping[str, int]],
    columns: Sequence[ColumnSpec],
    ident_lookups: Sequence[IdentLookup],
) -> int:
    """Emit one TSV row per oid, sorted ascending so re-runs produce
    byte-identical output. Returns the number of rows written.

    Uses ``rl.write_tsv``'s atomic-rename plumbing — a mid-stream crash
    leaves the committed output untouched.
    """
    sorted_oids = sorted(set(oids))
    header = build_tsv_header(columns, ident_lookups)
    rows = (
        build_row_dict(
            oid,
            basic_rows.get(oid),
            ident_rows.get(oid),
            columns,
            ident_lookups,
        )
        for oid in sorted_oids
    )
    return rl.write_tsv(rows, columns=header, output=output)
