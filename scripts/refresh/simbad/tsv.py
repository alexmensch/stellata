"""TSV writer driven by ColumnSpec lists plus per-oid column blocks —
ident cross-IDs, pivoted flux bands — appended after the basic columns."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import refresh_lib as rl  # noqa: E402

from .specs import ColumnSpec, FluxBand, IdentLookup, OID


Block = tuple[Sequence[str], Mapping[int, Mapping[str, Any]]]


def ident_block(
    lookups: Sequence[IdentLookup],
    ident_rows: Mapping[int, Mapping[str, Any]],
) -> Block:
    return [l.tsv_name for l in lookups], ident_rows


def flux_block(
    bands: Sequence[FluxBand],
    flux_rows: Mapping[int, Mapping[str, Any]],
) -> Block:
    return [name for b in bands for name in b.tsv_names], flux_rows


def build_tsv_header(
    columns: Sequence[ColumnSpec], blocks: Sequence[Block]
) -> list[str]:
    """Header column list — basic columns first, each block after, in order."""
    return [c.tsv_name for c in columns] + [
        name for names, _ in blocks for name in names
    ]


def build_row_dict(
    oid: int,
    basic_row: Mapping[str, Any] | None,
    columns: Sequence[ColumnSpec],
    blocks: Sequence[Block],
) -> dict[str, Any]:
    """One output dict, one oid. OID's TSV cell is filled from the
    master ``oid`` parameter so a row with no basic-table match still
    has its primary key. Other cells come from basic_row / the blocks
    or default to None (→ empty TSV cell)."""
    out: dict[str, Any] = {}
    for c in columns:
        out[c.tsv_name] = oid if c is OID else (basic_row or {}).get(c.alias)
    for names, rows in blocks:
        cells = rows.get(oid) or {}
        for name in names:
            out[name] = cells.get(name)
    return out


def write_simbad_tsv(
    output: Path,
    oids: Iterable[int],
    basic_rows: Mapping[int, Mapping[str, Any]],
    columns: Sequence[ColumnSpec],
    blocks: Sequence[Block] = (),
) -> int:
    """Emit one TSV row per oid, sorted ascending so re-runs produce
    byte-identical output. Returns the number of rows written."""
    sorted_oids = sorted(set(oids))
    rows = (
        build_row_dict(oid, basic_rows.get(oid), columns, blocks)
        for oid in sorted_oids
    )
    return rl.write_tsv(
        rows, columns=build_tsv_header(columns, blocks), output=output
    )
