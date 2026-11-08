#!/usr/bin/env python3
"""Unit tests for scripts/refresh/simbad — pin spec → ADQL → row roundtrip."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

# Add scripts/refresh/ so package-relative imports inside simbad/ resolve,
# and scripts/ so test_helpers (kebab-sibling loader) imports.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import simbad  # noqa: E402
from simbad import query  # noqa: E402
from simbad.specs import (  # noqa: E402
    OID, MAIN_ID, SP_TYPE, OTYPE, GJ, HIP, GAIA_DR3, TYC,
    ColumnSpec, FluxBand,
)


class FakeBackend:
    """In-memory backend that returns a precomputed table per query.
    ``responses`` is a list of (substring, table) pairs — first match wins."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls: list[str] = []

    def run(self, q: str):
        self.calls.append(q)
        for needle, table in self.responses:
            if needle in q:
                return table
        raise AssertionError(f"unexpected query (no matching needle):\n{q}")


def ident_table(rows):
    return FakeTable(
        colnames=["oidref", "id"], dtypes={"oidref": int, "id": str}, rows=rows,
    )


class SpecsTests(unittest.TestCase):

    def test_column_spec_basic_shape(self):
        c = ColumnSpec(adql="b.test", alias="test", tsv_name="test_col", dtype=str)
        self.assertEqual(c.adql, "b.test")
        self.assertEqual(c.alias, "test")
        self.assertEqual(c.tsv_name, "test_col")
        self.assertIs(c.dtype, str)
        self.assertFalse(c.required)

    def test_ident_lookup_like_pattern_and_compose(self):
        self.assertEqual(HIP.like_pattern, "HIP %")
        self.assertEqual(GAIA_DR3.like_pattern, "Gaia DR3 %")
        self.assertEqual(HIP.compose(12345), "HIP 12345")
        self.assertEqual(TYC.compose("144-1004-1"), "TYC 144-1004-1")

    def test_parse_suffix_numeric(self):
        self.assertEqual(HIP.parse_suffix("HIP 12345"), 12345)
        # Component suffix — the canonical-integer row carries the same oid.
        self.assertIsNone(HIP.parse_suffix("HIP 12345 A"))
        self.assertIsNone(HIP.parse_suffix("Gaia DR3 12345"))

    def test_parse_suffix_string_strips_simbad_padding(self):
        # SIMBAD right-aligns the TYC's first field, so the stored id is
        # padded while the request that matched it was not.
        self.assertEqual(TYC.parse_suffix("TYC  144-1004-1"), "144-1004-1")
        self.assertEqual(TYC.parse_suffix("TYC 1026-2127-1"), "1026-2127-1")
        self.assertEqual(GJ.parse_suffix("GJ 3207"), "3207")
        self.assertIsNone(TYC.parse_suffix("TYC "))

    def test_flux_band_column_names(self):
        self.assertEqual(
            FluxBand("V").tsv_names, ("flux_V", "flux_V_err", "flux_V_bibcode"),
        )
        self.assertEqual(
            FluxBand("B").column_sources(),
            (("flux_B", "flux"), ("flux_B_err", "flux_err"),
             ("flux_B_bibcode", "bibcode")),
        )


class BuildBasicSelectTests(unittest.TestCase):

    def test_renders_select_aliases_and_in_clause(self):
        cols = [OID, MAIN_ID, SP_TYPE]
        q = query.build_basic_select(cols, "1,2,3")
        self.assertIn("b.oid AS oid", q)
        self.assertIn("b.main_id AS main_id", q)
        self.assertIn("b.sp_type AS sp_type", q)
        self.assertIn("FROM basic AS b", q)
        self.assertIn("WHERE b.oid IN (1,2,3)", q)
        self.assertIn("ORDER BY oid", q)

    def test_extra_column_extends_select(self):
        cols = [OID, SP_TYPE, OTYPE]
        q = query.build_basic_select(cols, "42")
        self.assertIn("b.otype AS otype", q)
        sp_pos = q.index("b.sp_type")
        otype_pos = q.index("b.otype")
        self.assertLess(sp_pos, otype_pos)

    def test_build_basic_schema_maps_alias_to_dtype(self):
        schema = query.build_basic_schema([OID, MAIN_ID, SP_TYPE])
        self.assertEqual(schema, {"oid": int, "main_id": str, "sp_type": str})


class FetchBasicColumnsTests(unittest.TestCase):

    def test_returns_oid_keyed_rows_with_aliases(self):
        cols = [OID, SP_TYPE]
        table = FakeTable(
            colnames=["oid", "sp_type"],
            dtypes={"oid": int, "sp_type": str},
            rows=[
                {"oid": 1, "sp_type": "G2V"},
                {"oid": 2, "sp_type": "DA2"},
            ],
        )
        backend = FakeBackend([("FROM basic", table)])
        result = query.fetch_basic_columns(
            FakeClient(backend), oids=[1, 2], columns=cols,
        )
        self.assertEqual(result, {1: {"oid": 1, "sp_type": "G2V"},
                                  2: {"oid": 2, "sp_type": "DA2"}})

    def test_empty_oids_skips_query(self):
        backend = FakeBackend([])
        result = query.fetch_basic_columns(
            FakeClient(backend), oids=[], columns=[OID],
        )
        self.assertEqual(result, {})
        self.assertEqual(backend.calls, [])


class ResolveOidsByPrefixTests(unittest.TestCase):

    def test_gaia_dr3_lookup_resolves_value_to_oid(self):
        backend = FakeBackend([("FROM ident", ident_table([
            {"oidref": 100, "id": "Gaia DR3 12345"},
            {"oidref": 200, "id": "Gaia DR3 67890"},
        ]))])
        result = query.resolve_oids_by_prefix(
            FakeClient(backend), values=[12345, 67890], lookup=GAIA_DR3,
        )
        self.assertEqual(result, {12345: 100, 67890: 200})

    def test_suffixed_ident_silently_skipped(self):
        backend = FakeBackend([("FROM ident", ident_table([
            {"oidref": 100, "id": "HIP 12345 A"},
            {"oidref": 100, "id": "HIP 12345"},
        ]))])
        result = query.resolve_oids_by_prefix(
            FakeClient(backend), values=[12345], lookup=HIP,
        )
        self.assertEqual(result, {12345: 100})

    def test_padded_tyc_row_joins_its_unpadded_request(self):
        backend = FakeBackend([("FROM ident", ident_table([
            {"oidref": 6384906, "id": "TYC  144-1004-1"},
        ]))])
        result = query.resolve_oids_by_prefix(
            FakeClient(backend), values=["144-1004-1"], lookup=TYC,
        )
        self.assertIn("'TYC 144-1004-1'", backend.calls[0])
        self.assertEqual(result, {"144-1004-1": 6384906})

    def test_suffix_that_cannot_be_quoted_is_refused(self):
        backend = FakeBackend([])
        with self.assertRaises(SystemExit):
            query.resolve_oids_by_prefix(
                FakeClient(backend), values=["144'--"], lookup=TYC,
            )
        self.assertEqual(backend.calls, [])


class FetchIdentLookupsTests(unittest.TestCase):

    def test_or_clause_covers_every_lookup(self):
        backend = FakeBackend([("FROM ident", ident_table([
            {"oidref": 100, "id": "HIP 1"},
            {"oidref": 100, "id": "Gaia DR3 9999"},
            {"oidref": 100, "id": "TYC  144-1004-1"},
            {"oidref": 200, "id": "Gaia DR3 8888"},
        ]))])
        result = query.fetch_ident_lookups(
            FakeClient(backend), oids=[100, 200], lookups=[HIP, GAIA_DR3, TYC],
        )
        self.assertEqual(
            result,
            {100: {"hip": 1, "source_id": 9999, "tyc": "144-1004-1"},
             200: {"source_id": 8888}},
        )
        self.assertIn("id LIKE 'HIP %'", backend.calls[0])
        self.assertIn("id LIKE 'Gaia DR3 %'", backend.calls[0])
        self.assertIn("id LIKE 'TYC %'", backend.calls[0])

    def test_several_ids_in_one_namespace_ship_the_last_in_table_order(self):
        # The shipped TSV is single-valued per column, so a widened binding is
        # only readable back if the winner here is the id that asked. Where
        # SIMBAD holds two, it need not be — the limitation the read side's
        # namespace walk cannot recover from, so it is pinned rather than
        # assumed away.
        backend = FakeBackend([("FROM ident", ident_table([
            {"oidref": 100, "id": "HIP 11"},
            {"oidref": 100, "id": "HIP 22"},
        ]))])
        result = query.fetch_ident_lookups(
            FakeClient(backend), oids=[100], lookups=[HIP],
        )
        self.assertEqual(result, {100: {"hip": 22}})

    def test_ident_sets_keep_every_id_a_namespace_holds(self):
        backend = FakeBackend([("FROM ident", ident_table([
            {"oidref": 100, "id": "HIP 11"},
            {"oidref": 100, "id": "HIP 22"},
        ]))])
        result = query.fetch_ident_sets(
            FakeClient(backend), oids=[100], lookups=[HIP],
        )
        self.assertEqual(result, {100: {"hip": {11, 22}}})


class FetchFluxBandsTests(unittest.TestCase):

    def _table(self, rows):
        return FakeTable(
            colnames=["oidref", "filter", "flux", "flux_err", "bibcode"],
            dtypes={"oidref": int, "filter": str, "flux": float,
                    "flux_err": float, "bibcode": str},
            rows=rows,
        )

    def test_pivots_long_rows_into_per_band_columns(self):
        backend = FakeBackend([("FROM flux", self._table([
            {"oidref": 6853, "filter": "B", "flux": 7.42,
             "flux_err": 0.01, "bibcode": "2000A&A...355L..27H"},
            {"oidref": 6853, "filter": "V", "flux": 7.34,
             "flux_err": 0.01, "bibcode": "2000A&A...355L..27H"},
        ]))])
        result = query.fetch_flux_bands(
            FakeClient(backend), oids=[6853], bands=[FluxBand("B"), FluxBand("V")],
        )
        self.assertEqual(result, {6853: {
            "flux_B": 7.42, "flux_B_err": 0.01,
            "flux_B_bibcode": "2000A&A...355L..27H",
            "flux_V": 7.34, "flux_V_err": 0.01,
            "flux_V_bibcode": "2000A&A...355L..27H",
        }})
        self.assertIn("filter IN ('B','V')", backend.calls[0])

    def test_band_absent_from_the_request_is_ignored(self):
        backend = FakeBackend([("FROM flux", self._table([
            {"oidref": 1, "filter": "K", "flux": 3.0,
             "flux_err": None, "bibcode": None},
        ]))])
        result = query.fetch_flux_bands(
            FakeClient(backend), oids=[1], bands=[FluxBand("V")],
        )
        self.assertEqual(result, {})

    def test_no_bands_skips_query(self):
        backend = FakeBackend([])
        self.assertEqual(
            query.fetch_flux_bands(FakeClient(backend), oids=[1], bands=[]), {},
        )
        self.assertEqual(backend.calls, [])


class FakeTable:
    """Mimics astropy Table: ``colnames`` list, dtype lookup per column,
    iteration yielding dict-like rows."""

    def __init__(self, colnames, dtypes, rows):
        self.colnames = list(colnames)
        self._dtypes = dict(dtypes)
        self._rows = list(rows)

    def __iter__(self):
        return iter(self._rows)

    def __len__(self):
        return len(self._rows)

    def __getitem__(self, key):
        return _FakeColumn(self._dtypes[key])


class _FakeColumn:
    def __init__(self, dtype):
        self.dtype = dtype


class FakeClient:
    def __init__(self, backend):
        self.backend = backend

    def run(self, q):
        return self.backend.run(q)


if __name__ == "__main__":
    unittest.main()
