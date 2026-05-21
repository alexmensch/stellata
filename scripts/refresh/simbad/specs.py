"""Declarative spec dataclasses for SIMBAD column selection and
cross-identifier extraction.

A SIMBAD pull is fully described by two lists:

  * ``columns: list[ColumnSpec]`` — what to SELECT from ``basic``
    (or ``basic`` + a join), and what to call those values in the
    output TSV.

  * ``ident_lookups: list[IdentLookup]`` — which cross-identifier
    prefixes to resolve via the ``ident`` table (HIP, Gaia DR3, HD,
    Tycho, …), and what to call the resulting integer in the output
    TSV.

Adding a new SIMBAD column or a new cross-ID is a one-line append to the
caller's list literal — the ADQL SELECT clause, the schema validator,
the TSV header, and the per-row dict all derive from these specs.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ColumnSpec:
    """One SIMBAD basic-table (or basic-joined) column.

    ``adql`` is the unaliased SELECT fragment — ``b.sp_type``,
    ``b.main_id``, ``b.ra``, etc. The orchestration shell wraps it
    with ``AS <alias>`` so ORDER BY and downstream consumers reference
    the alias rather than the qualified name (SIMBAD's ADQL parser
    rejects qualified names in ORDER BY; the alias side-steps that).

    ``dtype`` is the Python base type used by ``refresh_lib.validate_schema``
    on the returned astropy Table. ``str`` matches both object-dtype
    and fixed-width unicode columns.

    ``required`` marks a column whose absence (NULL after coerce_masked)
    is logged but never failing — every SIMBAD column except ``oid``
    can be NULL for some rows.
    """

    adql: str
    alias: str
    tsv_name: str
    dtype: type
    required: bool = False


@dataclass(frozen=True)
class IdentLookup:
    """One cross-identifier extraction from the ``ident`` table.

    ``prefix`` is the literal SIMBAD identifier prefix, including the
    trailing space (``HIP ``, ``Gaia DR3 ``, ``HD ``). The ADQL
    ``LIKE`` pattern is ``prefix || '%'``; the integer extractor strips
    ``len(prefix)`` characters and casts.

    A row whose ``id`` matches multiple lookups (rare; usually only
    one prefix matches per row) writes the first match to its TSV
    column. Idempotent across re-runs because SIMBAD's ident table
    is itself stable.
    """

    prefix: str
    tsv_name: str

    @property
    def like_pattern(self) -> str:
        return self.prefix + "%"

    @property
    def prefix_len(self) -> int:
        return len(self.prefix)


# ─── Catalogue of well-known SIMBAD basic-table columns ──────────────

# Add to this catalogue when a new pull needs a column not listed here.
# Each entry is a ColumnSpec; the orchestration shell picks the subset
# it needs. Keeping the canonical aliases / TSV names in one place keeps
# multiple pulls byte-compatible on shared columns.

OID = ColumnSpec(adql="b.oid", alias="oid", tsv_name="simbad_oid", dtype=int, required=True)
MAIN_ID = ColumnSpec(adql="b.main_id", alias="main_id", tsv_name="simbad_main_id", dtype=str)
SP_TYPE = ColumnSpec(adql="b.sp_type", alias="sp_type", tsv_name="sp_type", dtype=str)
SP_QUAL = ColumnSpec(adql="b.sp_qual", alias="sp_qual", tsv_name="sp_qual", dtype=str)
SP_BIBCODE = ColumnSpec(adql="b.sp_bibcode", alias="sp_bibcode", tsv_name="sp_bibcode", dtype=str)
OTYPE = ColumnSpec(adql="b.otype", alias="otype", tsv_name="otype", dtype=str)


# ─── Canonical cross-identifier prefixes ────────────────────────────

# SIMBAD encodes ``HIP <int>`` and ``Gaia DR3 <int>`` with single spaces.
# HD is bare ``HD <int>``. These are the prefixes a new caller adds by
# reference rather than rebuilding from string literals.

HIP = IdentLookup(prefix="HIP ", tsv_name="hip")
GAIA_DR3 = IdentLookup(prefix="Gaia DR3 ", tsv_name="source_id")
