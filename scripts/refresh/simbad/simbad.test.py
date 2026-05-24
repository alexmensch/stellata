#!/usr/bin/env python3
"""Unit tests for scripts/refresh/simbad — pin spec → ADQL → row roundtrip."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

# Add scripts/refresh/ so package-relative imports inside simbad/ resolve.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from simbad import query, tsv  # noqa: E402
from simbad.specs import (  # noqa: E402
    OID, MAIN_ID, SP_TYPE, SP_QUAL, OTYPE, HIP, GAIA_DR3,
    ColumnSpec, IdentLookup,
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


class SpecsTests(unittest.TestCase):

    def test_column_spec_basic_shape(self):
        c = ColumnSpec(adql="b.test", alias="test", tsv_name="test_col", dtype=str)
        self.assertEqual(c.adql, "b.test")
        self.assertEqual(c.alias, "test")
        self.assertEqual(c.tsv_name, "test_col")
        self.assertIs(c.dtype, str)
        self.assertFalse(c.required)

    def test_ident_lookup_like_pattern(self):
        self.assertEqual(HIP.like_pattern, "HIP %")
        self.assertEqual(HIP.prefix_len, 4)
        self.assertEqual(GAIA_DR3.like_pattern, "Gaia DR3 %")
        self.assertEqual(GAIA_DR3.prefix_len, 9)


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
        table = FakeTable(
            colnames=["oidref", "id"],
            dtypes={"oidref": int, "id": str},
            rows=[
                {"oidref": 100, "id": "Gaia DR3 12345"},
                {"oidref": 200, "id": "Gaia DR3 67890"},
            ],
        )
        backend = FakeBackend([("FROM ident", table)])
        result = query.resolve_oids_by_prefix(
            FakeClient(backend), values=[12345, 67890], prefix="Gaia DR3 ",
        )
        self.assertEqual(result, {12345: 100, 67890: 200})

    def test_suffixed_ident_silently_skipped(self):
        # "HIP 12345 A" — component suffix — fails int cast, skipped.
        table = FakeTable(
            colnames=["oidref", "id"],
            dtypes={"oidref": int, "id": str},
            rows=[
                {"oidref": 100, "id": "HIP 12345 A"},
                {"oidref": 100, "id": "HIP 12345"},
            ],
        )
        backend = FakeBackend([("FROM ident", table)])
        result = query.resolve_oids_by_prefix(
            FakeClient(backend), values=[12345], prefix="HIP ",
        )
        self.assertEqual(result, {12345: 100})


class FetchIdentLookupsTests(unittest.TestCase):

    def test_or_clause_covers_every_lookup(self):
        table = FakeTable(
            colnames=["oidref", "id"],
            dtypes={"oidref": int, "id": str},
            rows=[
                {"oidref": 100, "id": "HIP 1"},
                {"oidref": 100, "id": "Gaia DR3 9999"},
                {"oidref": 200, "id": "Gaia DR3 8888"},
            ],
        )
        backend = FakeBackend([("FROM ident", table)])
        result = query.fetch_ident_lookups(
            FakeClient(backend), oids=[100, 200], lookups=[HIP, GAIA_DR3],
        )
        self.assertEqual(
            result,
            {100: {"hip": 1, "source_id": 9999},
             200: {"source_id": 8888}},
        )
        self.assertIn("id LIKE 'HIP %'", backend.calls[0])
        self.assertIn("id LIKE 'Gaia DR3 %'", backend.calls[0])


class TsvShapeTests(unittest.TestCase):

    def test_header_order_columns_then_idents(self):
        header = tsv.build_tsv_header(
            [OID, SP_TYPE], [HIP, GAIA_DR3],
        )
        self.assertEqual(header, ["simbad_oid", "sp_type", "hip", "source_id"])

    def test_row_dict_merges_basic_and_ident(self):
        row = tsv.build_row_dict(
            oid=42,
            basic_row={"oid": 42, "sp_type": "G2V"},
            ident_values={"hip": 7, "source_id": 99},
            columns=[OID, SP_TYPE],
            ident_lookups=[HIP, GAIA_DR3],
        )
        self.assertEqual(row, {
            "simbad_oid": 42, "sp_type": "G2V",
            "hip": 7, "source_id": 99,
        })

    def test_row_dict_missing_basic_still_sets_oid(self):
        row = tsv.build_row_dict(
            oid=42,
            basic_row=None,
            ident_values=None,
            columns=[OID, SP_TYPE],
            ident_lookups=[HIP],
        )
        self.assertEqual(row["simbad_oid"], 42)
        self.assertIsNone(row["sp_type"])
        self.assertIsNone(row["hip"])

    def test_row_dict_no_oid_column_does_not_crash(self):
        # OID-absent column lists must not StopIteration. The orchestration
        # shell always includes OID, but custom callers might not.
        row = tsv.build_row_dict(
            oid=42,
            basic_row={"sp_type": "G2V"},
            ident_values=None,
            columns=[SP_TYPE],
            ident_lookups=[],
        )
        self.assertEqual(row, {"sp_type": "G2V"})


class TsvRoundtripTests(unittest.TestCase):

    def test_minimal_pull_produces_expected_tsv(self):
        import tempfile
        cols = [OID, SP_TYPE]
        idents = [HIP]
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "sptype.tsv"
            n = tsv.write_simbad_tsv(
                output=out,
                oids=[2, 1],  # passed unsorted; writer sorts
                basic_rows={
                    1: {"oid": 1, "sp_type": "G2V"},
                    2: {"oid": 2, "sp_type": "DA2"},
                },
                ident_rows={1: {"hip": 100}, 2: {"hip": 200}},
                columns=cols,
                ident_lookups=idents,
            )
            self.assertEqual(n, 2)
            text = out.read_text().splitlines()
            self.assertEqual(text[0], "simbad_oid\tsp_type\thip")
            self.assertEqual(text[1], "1\tG2V\t100")
            self.assertEqual(text[2], "2\tDA2\t200")

    def test_appending_column_to_spec_adds_tsv_column(self):
        """Spec extensibility: appending OTYPE to the column list extends
        the TSV with no other code change."""
        import tempfile
        cols = [OID, SP_TYPE, OTYPE]
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "sptype.tsv"
            tsv.write_simbad_tsv(
                output=out,
                oids=[1],
                basic_rows={1: {"oid": 1, "sp_type": "G2V", "otype": "*"}},
                ident_rows={},
                columns=cols,
                ident_lookups=[],
            )
            text = out.read_text().splitlines()
            self.assertEqual(text[0], "simbad_oid\tsp_type\totype")
            self.assertEqual(text[1], "1\tG2V\t*")


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
