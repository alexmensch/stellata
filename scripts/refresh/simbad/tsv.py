"""TSV writer driven by ColumnSpec + IdentLookup lists; header is
``[c.tsv_name for c in columns] + [l.tsv_name for l in ident_lookups]``."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import refresh_lib as rl  # noqa: E402

from .specs import ColumnSpec, IdentLookup, OID


def build_tsv_header(
    columns: Sequence[ColumnSpec],
    ident_lookups: Sequence[IdentLookup],
) -> list[str]:
    """Header column list — basic columns first, ident lookups after."""
    return [c.tsv_name for c in columns] + [l.tsv_name for l in ident_lookups]


def build_row_dict(
    oid: int,
    basic_row: Mapping[str, Any] | None,
    ident_values: Mapping[str, int] | None,
    columns: Sequence[ColumnSpec],
    ident_lookups: Sequence[IdentLookup],
) -> dict[str, Any]:
    """One output dict, one oid. OID's TSV cell is filled from the
    master ``oid`` parameter so a row with no basic-table match still
    has its primary key. Other cells come from basic_row / ident_values
    or default to None (→ empty TSV cell)."""
    out: dict[str, Any] = {}
    for c in columns:
        if c is OID:
            out[c.tsv_name] = oid
        else:
            out[c.tsv_name] = (basic_row or {}).get(c.alias)
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
    byte-identical output. Returns the number of rows written."""
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
