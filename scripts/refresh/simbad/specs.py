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
    """One identifier namespace in the ``ident`` table, used in both
    directions: prefix + suffix composes a request id, and ``parse_suffix``
    recovers the suffix from a row the table returns.

    ``prefix`` includes the trailing space (``HIP ``, ``Gaia DR3 ``). The
    LIKE pattern is ``prefix || '%'``. ``numeric`` distinguishes the
    integer namespaces from ``TYC``/``GJ``, whose suffixes are strings.

    **Stored ids are space-padded**: SIMBAD writes ``TYC  144-1004-1`` with
    the first field right-aligned, and matches an unpadded request id
    against it. Anything joining on a returned id must go through
    ``parse_suffix``, which strips."""

    prefix: str
    tsv_name: str
    numeric: bool = True

    @property
    def like_pattern(self) -> str:
        return self.prefix + "%"

    def compose(self, suffix: int | str) -> str:
        return f"{self.prefix}{suffix}"

    def parse_suffix(self, id_str: str) -> int | str | None:
        """The suffix of ``id_str``, or None if it names another namespace
        or fails the numeric cast (``HIP 12345 A`` — the canonical-integer
        row appears separately for the same oid)."""
        if not id_str.startswith(self.prefix):
            return None
        suffix = id_str[len(self.prefix):].strip()
        if not self.numeric:
            return suffix or None
        try:
            return int(suffix)
        except ValueError:
            return None


@dataclass(frozen=True)
class FluxBand:
    """One band of the long-format ``flux`` table, pivoted into wide TSV
    columns ``flux_<F>`` / ``flux_<F>_err`` / ``flux_<F>_bibcode``."""

    filter: str

    def column_sources(self) -> tuple[tuple[str, str], ...]:
        """(tsv_name, flux-table column) pairs, in TSV order."""
        return (
            (f"flux_{self.filter}", "flux"),
            (f"flux_{self.filter}_err", "flux_err"),
            (f"flux_{self.filter}_bibcode", "bibcode"),
        )

    @property
    def tsv_names(self) -> tuple[str, ...]:
        return tuple(name for name, _ in self.column_sources())


# Canonical basic-table columns. The orchestration shell picks the
# subset it needs; sharing the catalogue keeps multiple pulls
# byte-compatible on shared columns.
OID = ColumnSpec(adql="b.oid", alias="oid", tsv_name="simbad_oid", dtype=int, required=True)
MAIN_ID = ColumnSpec(adql="b.main_id", alias="main_id", tsv_name="simbad_main_id", dtype=str)
SP_TYPE = ColumnSpec(adql="b.sp_type", alias="sp_type", tsv_name="sp_type", dtype=str)
SP_QUAL = ColumnSpec(adql="b.sp_qual", alias="sp_qual", tsv_name="sp_qual", dtype=str)
SP_BIBCODE = ColumnSpec(adql="b.sp_bibcode", alias="sp_bibcode", tsv_name="sp_bibcode", dtype=str)
OTYPE = ColumnSpec(adql="b.otype", alias="otype", tsv_name="otype", dtype=str)

# Value columns — each measured quantity travels with its own bibcode and
# quality flag, because the bibcode is the source and SIMBAD only the index
# that found it (docs/catalog-driver.md § 5).
RA = ColumnSpec(adql="b.ra", alias="ra", tsv_name="ra", dtype=float)
DEC = ColumnSpec(adql="b.dec", alias="dec", tsv_name="dec", dtype=float)
COO_QUAL = ColumnSpec(adql="b.coo_qual", alias="coo_qual", tsv_name="coo_qual", dtype=str)
COO_BIBCODE = ColumnSpec(
    adql="b.coo_bibcode", alias="coo_bibcode", tsv_name="coo_bibcode", dtype=str
)
PMRA = ColumnSpec(adql="b.pmra", alias="pmra", tsv_name="pmra", dtype=float)
PMDEC = ColumnSpec(adql="b.pmdec", alias="pmdec", tsv_name="pmdec", dtype=float)
PM_QUAL = ColumnSpec(adql="b.pm_qual", alias="pm_qual", tsv_name="pm_qual", dtype=str)
PM_BIBCODE = ColumnSpec(
    adql="b.pm_bibcode", alias="pm_bibcode", tsv_name="pm_bibcode", dtype=str
)
PLX_VALUE = ColumnSpec(adql="b.plx_value", alias="plx_value", tsv_name="plx_value", dtype=float)
PLX_ERR = ColumnSpec(adql="b.plx_err", alias="plx_err", tsv_name="plx_err", dtype=float)
PLX_QUAL = ColumnSpec(adql="b.plx_qual", alias="plx_qual", tsv_name="plx_qual", dtype=str)
PLX_BIBCODE = ColumnSpec(
    adql="b.plx_bibcode", alias="plx_bibcode", tsv_name="plx_bibcode", dtype=str
)
RVZ_RADVEL = ColumnSpec(
    adql="b.rvz_radvel", alias="rvz_radvel", tsv_name="rvz_radvel", dtype=float
)
RVZ_ERR = ColumnSpec(adql="b.rvz_err", alias="rvz_err", tsv_name="rvz_err", dtype=float)
RVZ_TYPE = ColumnSpec(adql="b.rvz_type", alias="rvz_type", tsv_name="rvz_type", dtype=str)
RVZ_QUAL = ColumnSpec(adql="b.rvz_qual", alias="rvz_qual", tsv_name="rvz_qual", dtype=str)
RVZ_BIBCODE = ColumnSpec(
    adql="b.rvz_bibcode", alias="rvz_bibcode", tsv_name="rvz_bibcode", dtype=str
)


# Canonical identifier namespaces — SIMBAD encodes ``HIP <int>``,
# ``Gaia DR3 <int>``, ``TYC <tyc>`` and ``GJ <gl>`` with single spaces.
# ``Gl`` is an accepted alias SIMBAD resolves onto the ``GJ`` spelling, so
# a spine ``gl`` cell normalises to this one prefix.
HIP = IdentLookup(prefix="HIP ", tsv_name="hip")
GAIA_DR3 = IdentLookup(prefix="Gaia DR3 ", tsv_name="source_id")
TYC = IdentLookup(prefix="TYC ", tsv_name="tyc", numeric=False)
GJ = IdentLookup(prefix="GJ ", tsv_name="gj", numeric=False)
