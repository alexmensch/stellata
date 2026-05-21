"""Declarative spec dataclasses for SIMBAD column selection (ColumnSpec)
and cross-identifier extraction (IdentLookup), plus the canonical
catalogue of basic-table columns and ident prefixes."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ColumnSpec:
    """One SIMBAD basic-table column.

    ``adql`` is the unaliased SELECT fragment (``b.sp_type``,
    ``b.main_id``, …); query.build_basic_select wraps it with
    ``AS <alias>`` so ORDER BY can reference the alias rather than
    the qualified name (SIMBAD rejects qualified names in ORDER BY).

    ``dtype`` is the Python base type consumed by
    refresh_lib.validate_schema; ``str`` matches both object-dtype and
    fixed-width unicode columns.
    """

    adql: str
    alias: str
    tsv_name: str
    dtype: type
    required: bool = False


@dataclass(frozen=True)
class IdentLookup:
    """One cross-identifier extraction from the ``ident`` table.

    ``prefix`` is the SIMBAD identifier prefix including the trailing
    space (``HIP ``, ``Gaia DR3 ``). The LIKE pattern is ``prefix || '%'``;
    the integer extractor strips ``len(prefix)`` characters and casts."""

    prefix: str
    tsv_name: str

    @property
    def like_pattern(self) -> str:
        return self.prefix + "%"

    @property
    def prefix_len(self) -> int:
        return len(self.prefix)


# Canonical basic-table columns. The orchestration shell picks the
# subset it needs; sharing the catalogue keeps multiple pulls
# byte-compatible on shared columns.
OID = ColumnSpec(adql="b.oid", alias="oid", tsv_name="simbad_oid", dtype=int, required=True)
MAIN_ID = ColumnSpec(adql="b.main_id", alias="main_id", tsv_name="simbad_main_id", dtype=str)
SP_TYPE = ColumnSpec(adql="b.sp_type", alias="sp_type", tsv_name="sp_type", dtype=str)
SP_QUAL = ColumnSpec(adql="b.sp_qual", alias="sp_qual", tsv_name="sp_qual", dtype=str)
SP_BIBCODE = ColumnSpec(adql="b.sp_bibcode", alias="sp_bibcode", tsv_name="sp_bibcode", dtype=str)
OTYPE = ColumnSpec(adql="b.otype", alias="otype", tsv_name="otype", dtype=str)


# Canonical cross-identifier prefixes — SIMBAD encodes ``HIP <int>`` and
# ``Gaia DR3 <int>`` with single spaces.
HIP = IdentLookup(prefix="HIP ", tsv_name="hip")
GAIA_DR3 = IdentLookup(prefix="Gaia DR3 ", tsv_name="source_id")
