#!/usr/bin/env python3
"""Unit tests for scripts/refresh/simbad — pin spec → ADQL → row roundtrip."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

# Add scripts/refresh/ so package-relative imports inside simbad/ resolve,
# and scripts/ so test_helpers (kebab-sibling loader) imports.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from test_helpers import load_kebab_sibling  # noqa: E402
import simbad  # noqa: E402
from simbad import coverage, inputs, query, request, tsv, union  # noqa: E402
from simbad.specs import (  # noqa: E402
    OID, MAIN_ID, SP_TYPE, SP_QUAL, OTYPE, GJ, HIP, GAIA_DR3, TYC,
    PLX_BIBCODE, PLX_ERR, PLX_QUAL, PLX_VALUE,
    RVZ_BIBCODE, RVZ_ERR, RVZ_QUAL, RVZ_RADVEL, RVZ_TYPE,
    ColumnSpec, FluxBand, IdentLookup, WIDENING_LADDER,
)


SPINE_HEADER = (
    "tyc\thip\thd\thr\tgl\tflam\tbayer\tproper\tgaia_source_id\tra\tdec\tdist\t"
    "mag\tci\tspect\trv\tpm_ra\tpm_dec\tpos_src\tdist_src\tmag_src\trv_src\t"
    "pm_src\tspect_src"
)
SPINE_COLUMNS = SPINE_HEADER.split("\t")


def write_spine(directory: Path, rows: list[dict[str, str]]) -> Path:
    """Materialise a spine fixture — named cells set, the rest blank."""
    path = directory / "inherited-spine.tsv"
    lines = [SPINE_HEADER]
    for row in rows:
        lines.append("\t".join(row.get(c, "") for c in SPINE_COLUMNS))
    path.write_text("\n".join(lines) + "\n")
    return path


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

    def test_one_band_present_leaves_the_other_null_not_shifted(self):
        # The long-format table publishes a row per band it has, so an oid
        # with B and no V must null V's three cells rather than slide B's
        # into them.
        backend = FakeBackend([("FROM flux", self._table([
            {"oidref": 5, "filter": "B", "flux": 9.1,
             "flux_err": 0.02, "bibcode": "2000A&A...355L..27H"},
        ]))])
        flux_rows = query.fetch_flux_bands(
            FakeClient(backend), oids=[5], bands=[FluxBand("B"), FluxBand("V")],
        )
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "values.tsv"
            tsv.write_simbad_tsv(
                output=out, oids=[5], basic_rows={5: {"oid": 5}}, columns=[OID],
                blocks=[tsv.flux_block([FluxBand("B"), FluxBand("V")], flux_rows)],
            )
            text = out.read_text().splitlines()
        self.assertEqual(
            text[0],
            "simbad_oid\tflux_B\tflux_B_err\tflux_B_bibcode"
            "\tflux_V\tflux_V_err\tflux_V_bibcode",
        )
        self.assertEqual(text[1], "5\t9.1\t0.02\t2000A&A...355L..27H\t\t\t")


class TsvShapeTests(unittest.TestCase):

    def test_header_order_columns_then_blocks(self):
        header = tsv.build_tsv_header(
            [OID, SP_TYPE],
            [tsv.ident_block([HIP, GAIA_DR3], {}),
             tsv.flux_block([FluxBand("V")], {})],
        )
        self.assertEqual(header, [
            "simbad_oid", "sp_type", "hip", "source_id",
            "flux_V", "flux_V_err", "flux_V_bibcode",
        ])

    def test_row_dict_merges_basic_and_blocks(self):
        row = tsv.build_row_dict(
            oid=42,
            basic_row={"oid": 42, "sp_type": "G2V"},
            columns=[OID, SP_TYPE],
            blocks=[tsv.ident_block([HIP, GAIA_DR3],
                                    {42: {"hip": 7, "source_id": 99}})],
        )
        self.assertEqual(row, {
            "simbad_oid": 42, "sp_type": "G2V",
            "hip": 7, "source_id": 99,
        })

    def test_row_dict_missing_basic_still_sets_oid(self):
        row = tsv.build_row_dict(
            oid=42,
            basic_row=None,
            columns=[OID, SP_TYPE],
            blocks=[tsv.ident_block([HIP], {})],
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
            columns=[SP_TYPE],
            blocks=[],
        )
        self.assertEqual(row, {"sp_type": "G2V"})


class BibcodedGroupTests(unittest.TestCase):

    def test_unbibcoded_flux_value_and_error_are_dropped(self):
        band = FluxBand("V")
        row = tsv.build_row_dict(
            oid=1, basic_row=None, columns=[OID],
            blocks=[tsv.flux_block([band], {1: {
                "flux_V": 7.34, "flux_V_err": 0.01, "flux_V_bibcode": None,
            }})],
            bibcoded_groups=[band.bibcoded_group()],
        )
        self.assertIsNone(row["flux_V"])
        self.assertIsNone(row["flux_V_err"])

    def test_bibcoded_flux_value_survives(self):
        band = FluxBand("V")
        row = tsv.build_row_dict(
            oid=1, basic_row=None, columns=[OID],
            blocks=[tsv.flux_block([band], {1: {
                "flux_V": 7.34, "flux_V_err": 0.01, "flux_V_bibcode": "2000A&A..1H",
            }})],
            bibcoded_groups=[band.bibcoded_group()],
        )
        self.assertEqual(row["flux_V"], 7.34)
        self.assertEqual(row["flux_V_err"], 0.01)

    def test_blank_bibcode_counts_as_absent(self):
        band = FluxBand("B")
        row = tsv.build_row_dict(
            oid=1, basic_row=None, columns=[OID],
            blocks=[tsv.flux_block([band], {1: {
                "flux_B": 9.1, "flux_B_bibcode": "   ",
            }})],
            bibcoded_groups=[band.bibcoded_group()],
        )
        self.assertIsNone(row["flux_B"])

    def test_basic_table_groups_take_their_whole_quantity_down(self):
        from simbad.specs import BASIC_BIBCODED_GROUPS
        row = tsv.build_row_dict(
            oid=1,
            basic_row={
                "oid": 1, "plx_value": 12.3, "plx_err": 0.4, "plx_qual": "A",
                "plx_bibcode": None,
                "rvz_radvel": -5.0, "rvz_err": 0.2, "rvz_type": "v",
                "rvz_qual": "B", "rvz_bibcode": "2006AstL...32..759G",
            },
            columns=[OID, PLX_VALUE, PLX_ERR, PLX_QUAL, PLX_BIBCODE,
                     RVZ_RADVEL, RVZ_ERR, RVZ_TYPE, RVZ_QUAL, RVZ_BIBCODE],
            blocks=[],
            bibcoded_groups=BASIC_BIBCODED_GROUPS,
        )
        # parallax has no bibcode: value, error and quality all go.
        self.assertIsNone(row["plx_value"])
        self.assertIsNone(row["plx_err"])
        self.assertIsNone(row["plx_qual"])
        # rv is bibcoded and is untouched.
        self.assertEqual(row["rvz_radvel"], -5.0)
        self.assertEqual(row["rvz_qual"], "B")

    def test_a_pull_declaring_no_groups_is_unaffected(self):
        row = tsv.build_row_dict(
            oid=1, basic_row={"oid": 1, "sp_type": "G2V"},
            columns=[OID, SP_TYPE], blocks=[],
        )
        self.assertEqual(row["sp_type"], "G2V")


class TsvRoundtripTests(unittest.TestCase):

    def test_minimal_pull_produces_expected_tsv(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "sptype.tsv"
            n = tsv.write_simbad_tsv(
                output=out,
                oids=[2, 1],  # passed unsorted; writer sorts
                basic_rows={
                    1: {"oid": 1, "sp_type": "G2V"},
                    2: {"oid": 2, "sp_type": "DA2"},
                },
                columns=[OID, SP_TYPE],
                blocks=[tsv.ident_block([HIP], {1: {"hip": 100}, 2: {"hip": 200}})],
            )
            self.assertEqual(n, 2)
            text = out.read_text().splitlines()
            self.assertEqual(text[0], "simbad_oid\tsp_type\thip")
            self.assertEqual(text[1], "1\tG2V\t100")
            self.assertEqual(text[2], "2\tDA2\t200")

    def test_flux_block_lands_after_the_ident_block(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "values.tsv"
            tsv.write_simbad_tsv(
                output=out,
                oids=[1],
                basic_rows={1: {"oid": 1}},
                columns=[OID],
                blocks=[
                    tsv.ident_block([HIP], {1: {"hip": 7}}),
                    tsv.flux_block([FluxBand("V")],
                                   {1: {"flux_V": 7.34, "flux_V_bibcode": "B"}}),
                ],
            )
            text = out.read_text().splitlines()
            self.assertEqual(
                text[0], "simbad_oid\thip\tflux_V\tflux_V_err\tflux_V_bibcode",
            )
            self.assertEqual(text[1], "1\t7\t7.34\t\tB")

    def test_appending_column_to_spec_adds_tsv_column(self):
        """Spec extensibility: appending OTYPE to the column list extends
        the TSV with no other code change."""
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "sptype.tsv"
            tsv.write_simbad_tsv(
                output=out,
                oids=[1],
                basic_rows={1: {"oid": 1, "sp_type": "G2V", "otype": "*"}},
                columns=[OID, SP_TYPE, OTYPE],
            )
            text = out.read_text().splitlines()
            self.assertEqual(text[0], "simbad_oid\tsp_type\totype")
            self.assertEqual(text[1], "1\tG2V\t*")


class MembershipRequestKeysTests(unittest.TestCase):

    def _spine(self, rows):
        d = self.enterContext(tempfile.TemporaryDirectory())
        return write_spine(Path(d), rows)

    def test_partitions_by_the_no_gaia_key_ladder(self):
        path = self._spine([
            {"gaia_source_id": "12345", "hip": "1", "tyc": "1-2-1"},
            {"hip": "777", "tyc": "3-4-1"},
            {"tyc": "5-6-1", "gl": "GJ 3207"},
            {"gl": "Gl 165A"},
            {"proper": "Sol"},
        ])
        keys = inputs.membership_request_keys(path)
        self.assertEqual(keys.source_ids, [12345])
        self.assertEqual(keys.hips, [777])
        self.assertEqual(keys.tycs, ["5-6-1"])
        self.assertEqual(keys.gls, ["165A"])
        self.assertEqual(keys.keyless, 1)
        self.assertEqual(keys.total, 5)

    def test_row_filter_narrows_the_partition(self):
        path = self._spine([
            {"gaia_source_id": "1", "rv_src": "G_R3"},
            {"gaia_source_id": "2", "rv_src": "HYG"},
        ])
        keys = inputs.membership_request_keys(path, inputs.is_simbad_value_cohort)
        self.assertEqual(keys.source_ids, [2])

    def test_designations_cover_only_source_id_keyed_rows(self):
        # Same pass as the partition, so the widening map can never cover a
        # different cohort than the request set it widens.
        path = self._spine([
            {"gaia_source_id": "1", "hip": "5", "tyc": "1-2-1", "gl": "GJ 9"},
            {"gaia_source_id": "2"},
            {"tyc": "9-9-1"},
        ])
        keys = inputs.membership_request_keys(path)
        self.assertEqual(
            keys.designations_by_source_id,
            {1: {"hip": 5, "tyc": "1-2-1", "gj": "9"}},
        )
        self.assertEqual(keys.tycs, ["9-9-1"])

    def test_row_filter_narrows_the_widening_map_too(self):
        path = self._spine([
            {"gaia_source_id": "1", "tyc": "1-2-1", "rv_src": "G_R3"},
            {"gaia_source_id": "2", "tyc": "3-4-1", "rv_src": "HYG"},
        ])
        keys = inputs.membership_request_keys(path, inputs.is_simbad_value_cohort)
        self.assertEqual(keys.designations_by_source_id, {2: {"tyc": "3-4-1"}})

    def test_row_designations_cover_the_whole_ladder(self):
        # A rung whose key this walk cannot read finds no candidates and fails
        # silently. The no-Gaia partition and the widening both drive off
        # WIDENING_LADDER, so the two agree on order by construction — this is
        # the other half: they agree on the SET of namespaces too.
        path = self._spine([
            {"gaia_source_id": "1", "hip": "5", "tyc": "1-2-1", "gl": "GJ 9"},
        ])
        keys = inputs.membership_request_keys(path)
        self.assertEqual(
            set(keys.designations_by_source_id[1]),
            {lookup.tsv_name for lookup in WIDENING_LADDER},
        )
        self.assertEqual(
            set(keys.by_namespace), {lookup.tsv_name for lookup in WIDENING_LADDER},
        )


class ValueCohortTests(unittest.TestCase):

    def _row(self, **cells):
        return {c: cells.get(c, "") for c in SPINE_COLUMNS}

    def test_first_order_marks_open_no_simbad_tier(self):
        row = self._row(
            gaia_source_id="1", pos_src="T", dist_src="G_R3",
            mag_src="HIP", rv_src="G_R3", pm_src="G_R3",
        )
        self.assertFalse(inputs.is_simbad_value_cohort(row))

    def test_absent_rv_is_not_a_non_first_order_mark(self):
        row = self._row(gaia_source_id="1", pos_src="T", rv_src="N")
        self.assertFalse(inputs.is_simbad_value_cohort(row))

    def test_any_retired_mark_admits_the_row(self):
        for mark in ("HYG", "OTHER", "G_R2", "GJ"):
            with self.subTest(mark=mark):
                row = self._row(gaia_source_id="1", pos_src="T", rv_src=mark)
                self.assertTrue(inputs.is_simbad_value_cohort(row))

    def test_no_gaia_row_is_always_in_the_cohort(self):
        row = self._row(hip="7", pos_src="T", dist_src="HIP", rv_src="N")
        self.assertTrue(inputs.is_simbad_value_cohort(row))


class GlSuffixTests(unittest.TestCase):

    def test_both_spellings_normalise_to_one_suffix(self):
        self.assertEqual(inputs.gl_suffix("GJ 3207"), "3207")
        self.assertEqual(inputs.gl_suffix("Gl 3207"), "3207")
        self.assertEqual(inputs.gl_suffix(" Gl 165A "), "165A")

    def test_blank_and_prefixless_cells(self):
        self.assertIsNone(inputs.gl_suffix(""))
        self.assertIsNone(inputs.gl_suffix("GJ "))
        self.assertEqual(inputs.gl_suffix("9140"), "9140")


class CoverageTests(unittest.TestCase):

    ROWS = {
        1: {"sp_type": "G2V", "bibcode": "2000A&A...355L..27H"},
        2: {"sp_type": "   ", "bibcode": None},
        3: {"sp_type": None},
    }

    def test_blank_and_absent_cells_both_count_as_unfilled(self):
        self.assertEqual(coverage.count_filled(self.ROWS, "sp_type"), 1)
        self.assertEqual(coverage.count_filled(self.ROWS, "bibcode"), 1)
        self.assertEqual(coverage.count_filled(self.ROWS, "absent"), 0)

    def test_report_fill_returns_the_count_and_logs_one_line(self):
        lines: list[str] = []
        n = coverage.report_fill(
            "sp_type", self.ROWS, "sp_type", 4, log=lines.append,
        )
        self.assertEqual(n, 1)
        self.assertEqual(len(lines), 1)
        self.assertIn("1/4", lines[0])
        self.assertIn("25.0%", lines[0])

    def test_floor_gate_exits_below_and_passes_at_the_floor(self):
        with self.assertRaises(SystemExit) as caught:
            coverage.assert_floor(
                "sp_type coverage", 0.49, 0.50,
                script="refresh-simbad-sptype", diagnosis="the shape drifted",
            )
        self.assertIn("49.0%", str(caught.exception))
        self.assertIn("the shape drifted", str(caught.exception))
        coverage.assert_floor(
            "sp_type coverage", 0.50, 0.50,
            script="refresh-simbad-sptype", diagnosis="the shape drifted",
        )


class SourceFilesTests(unittest.TestCase):

    def test_lists_every_module_and_no_test_file(self):
        names = {p.name for p in simbad.source_files()}
        self.assertLessEqual(
            {"__init__.py", "specs.py", "inputs.py", "request.py",
             "query.py", "coverage.py", "tsv.py"},
            names,
        )
        self.assertNotIn("simbad.test.py", names)


class IterWdsXidsOidsTests(unittest.TestCase):

    def test_skips_blank_and_non_integer_cells(self):
        d = self.enterContext(tempfile.TemporaryDirectory())
        p = Path(d) / "wds.tsv"
        p.write_text(
            "simbad_oid\tother\n"
            "100\tx\n"       # → 100
            "\ty\n"          # blank → skip
            "abc\tz\n"       # non-integer → skip
            " 200 \tw\n"     # whitespace-padded → 200
        )
        self.assertEqual(list(inputs.iter_wds_xids_oids(p)), [100, 200])


class ResolveSpineKeysTests(unittest.TestCase):

    TYC_WIDENING = request.widening_label(TYC)
    GJ_WIDENING = request.widening_label(GJ)
    HIP_WIDENING = request.widening_label(HIP)

    def test_widens_on_tyc_only_where_the_gaia_namespace_missed(self):
        keys = inputs.MembershipRequestKeys(
            source_ids=[1, 2],
            designations_by_source_id={1: {"tyc": "1-2-1"}, 2: {"tyc": "5-6-1"}},
        )
        backend = FakeBackend([
            ("'Gaia DR3 1','Gaia DR3 2'", ident_table([
                {"oidref": 100, "id": "Gaia DR3 1"},
            ])),
            ("'TYC 5-6-1'", ident_table([{"oidref": 300, "id": "TYC 5-6-1"}])),
            ("oidref IN (300)", ident_table([])),
        ])
        resolved = request.resolve_membership_keys(FakeClient(backend), keys)
        # source_id 1 resolved, so only 2's TYC is asked for.
        self.assertEqual(resolved.oids, {100, 300})
        self.assertEqual(resolved.total_gained_by_widening, 1)
        self.assertEqual(resolved.requested[self.TYC_WIDENING], 1)

    def test_widened_binding_is_vetoed_when_simbad_names_another_source(self):
        # oid 300 answers 'TYC 5-6-1' but SIMBAD calls it Gaia DR3 999 —
        # a different star from the source_id 2 that asked, so the TYC
        # bound the system rather than the component.
        keys = inputs.MembershipRequestKeys(
            source_ids=[1, 2],
            designations_by_source_id={1: {"tyc": "1-2-1"}, 2: {"tyc": "5-6-1"}},
        )
        backend = FakeBackend([
            ("'Gaia DR3 1','Gaia DR3 2'", ident_table([
                {"oidref": 100, "id": "Gaia DR3 1"},
            ])),
            ("'TYC 5-6-1'", ident_table([{"oidref": 300, "id": "TYC 5-6-1"}])),
            ("oidref IN (300)", ident_table([
                {"oidref": 300, "id": "Gaia DR3 999"},
            ])),
        ])
        resolved = request.resolve_membership_keys(FakeClient(backend), keys)
        self.assertEqual(resolved.oids, {100})
        self.assertEqual(resolved.verdicts[self.TYC_WIDENING].vetoed, 1)
        self.assertEqual(resolved.total_gained_by_widening, 0)
        self.assertEqual(resolved.resolved[self.TYC_WIDENING], 0)

    def test_asking_id_under_an_earlier_release_corroborates_the_binding(self):
        # The spine cell is a DR2 id sitting in the DR3 column, so the Gaia
        # namespace misses and SIMBAD's DR3 id for the object differs. That
        # is a disagreement about the RELEASE, not about which star this is,
        # and SIMBAD holding the asking id under DR2 settles it.
        keys = inputs.MembershipRequestKeys(
            source_ids=[2], designations_by_source_id={2: {"gj": "4192"}},
        )
        backend = FakeBackend([
            ("'Gaia DR3 2'", ident_table([])),
            ("'GJ 4192'", ident_table([{"oidref": 300, "id": "GJ 4192"}])),
            ("oidref IN (300)", ident_table([
                {"oidref": 300, "id": "Gaia DR2 2"},
                {"oidref": 300, "id": "Gaia DR3 999"},
            ])),
        ])
        resolved = request.resolve_membership_keys(FakeClient(backend), keys)
        self.assertEqual(resolved.oids, {300})
        self.assertEqual(resolved.verdicts[self.GJ_WIDENING].corroborated, 1)
        self.assertEqual(resolved.verdicts[self.GJ_WIDENING].vetoed, 0)

    def test_widened_binding_survives_when_simbad_names_no_gaia_id(self):
        keys = inputs.MembershipRequestKeys(
            source_ids=[2], designations_by_source_id={2: {"tyc": "5-6-1"}},
        )
        backend = FakeBackend([
            ("'Gaia DR3 2'", ident_table([])),
            ("'TYC 5-6-1'", ident_table([{"oidref": 300, "id": "TYC 5-6-1"}])),
            ("oidref IN (300)", ident_table([
                {"oidref": 300, "id": "HIP 4"},
            ])),
        ])
        resolved = request.resolve_membership_keys(FakeClient(backend), keys)
        self.assertEqual(resolved.oids, {300})
        self.assertEqual(resolved.verdicts[self.TYC_WIDENING].vetoed, 0)
        self.assertEqual(resolved.verdicts[self.TYC_WIDENING].uncorroborated, 1)

    def test_a_differing_earlier_release_id_is_not_evidence_and_is_kept(self):
        # SIMBAD holds a DR2 id for the object, it is not the asking one, and
        # there is no DR3 id at all. Only DR3 contradicts, so this is kept —
        # and it lands in `uncorroborated`, which therefore means "no DR3 id
        # to contradict it" rather than "no Gaia id whatsoever".
        keys = inputs.MembershipRequestKeys(
            source_ids=[2], designations_by_source_id={2: {"tyc": "5-6-1"}},
        )
        backend = FakeBackend([
            ("'Gaia DR3 2'", ident_table([])),
            ("'TYC 5-6-1'", ident_table([{"oidref": 300, "id": "TYC 5-6-1"}])),
            ("oidref IN (300)", ident_table([
                {"oidref": 300, "id": "Gaia DR2 777"},
            ])),
        ])
        resolved = request.resolve_membership_keys(FakeClient(backend), keys)
        self.assertEqual(resolved.oids, {300})
        self.assertEqual(resolved.verdicts[self.TYC_WIDENING].vetoed, 0)
        self.assertEqual(resolved.verdicts[self.TYC_WIDENING].corroborated, 0)
        self.assertEqual(resolved.verdicts[self.TYC_WIDENING].uncorroborated, 1)

    def test_the_ladder_stops_asking_once_a_rung_binds_the_row(self):
        # HIP binds source_id 2, so its TYC is never asked for — the
        # fall-through keys on resolution, not on which cells are populated.
        keys = inputs.MembershipRequestKeys(
            source_ids=[2],
            designations_by_source_id={2: {"hip": 7, "tyc": "5-6-1"}},
        )
        backend = FakeBackend([
            ("'Gaia DR3 2'", ident_table([])),
            ("'HIP 7'", ident_table([{"oidref": 300, "id": "HIP 7"}])),
            ("oidref IN (300)", ident_table([
                {"oidref": 300, "id": "Gaia DR2 2"},
            ])),
        ])
        resolved = request.resolve_membership_keys(FakeClient(backend), keys)
        self.assertEqual(resolved.oids, {300})
        self.assertEqual(resolved.requested[self.HIP_WIDENING], 1)
        self.assertNotIn(self.TYC_WIDENING, resolved.requested)

    def test_a_vetoed_rung_leaves_the_row_for_the_next_one(self):
        keys = inputs.MembershipRequestKeys(
            source_ids=[2],
            designations_by_source_id={2: {"hip": 7, "tyc": "5-6-1"}},
        )
        backend = FakeBackend([
            ("'Gaia DR3 2'", ident_table([])),
            ("'HIP 7'", ident_table([{"oidref": 300, "id": "HIP 7"}])),
            ("oidref IN (300)", ident_table([
                {"oidref": 300, "id": "Gaia DR3 999"},
            ])),
            ("'TYC 5-6-1'", ident_table([{"oidref": 400, "id": "TYC 5-6-1"}])),
            ("oidref IN (400)", ident_table([
                {"oidref": 400, "id": "Gaia DR2 2"},
            ])),
        ])
        resolved = request.resolve_membership_keys(FakeClient(backend), keys)
        self.assertEqual(resolved.oids, {400})
        self.assertEqual(resolved.verdicts[self.HIP_WIDENING].vetoed, 1)
        self.assertEqual(resolved.verdicts[self.TYC_WIDENING].corroborated, 1)

    def test_tyc_two_source_ids_claim_is_never_widened(self):
        keys = inputs.MembershipRequestKeys(
            source_ids=[1, 2],
            designations_by_source_id={1: {"tyc": "5-6-1"}, 2: {"tyc": "5-6-1"}},
        )
        backend = FakeBackend([("'Gaia DR3 1','Gaia DR3 2'", ident_table([]))])
        resolved = request.resolve_membership_keys(FakeClient(backend), keys)
        self.assertEqual(resolved.oids, set())
        self.assertNotIn(self.TYC_WIDENING, resolved.requested)

    def test_no_widening_map_leaves_the_request_at_its_namespaces(self):
        keys = inputs.MembershipRequestKeys(source_ids=[1], hips=[7], tycs=[], gls=[])
        backend = FakeBackend([
            ("Gaia DR3 1", ident_table([{"oidref": 100, "id": "Gaia DR3 1"}])),
            ("HIP 7", ident_table([{"oidref": 200, "id": "HIP 7"}])),
        ])
        resolved = request.resolve_membership_keys(FakeClient(backend), keys)
        self.assertEqual(resolved.oids, {100, 200})
        self.assertEqual(resolved.total_gained_by_widening, 0)
        self.assertNotIn(self.TYC_WIDENING, resolved.requested)
        self.assertAlmostEqual(resolved.coverage(GAIA_DR3.tsv_name), 1.0)


class CollectOidRequestsTests(unittest.TestCase):

    def test_unions_spine_keys_and_wds_oids(self):
        sptype = load_kebab_sibling(
            __file__, "refresh_simbad_sptype", "../refresh-simbad-sptype.py",
        )
        d = self.enterContext(tempfile.TemporaryDirectory())
        spine = write_spine(Path(d), [
            {"gaia_source_id": "12345", "tyc": "1-2-1"},
            {"hip": "777"},
        ])
        backend = FakeBackend([
            ("Gaia DR3 12345", ident_table([
                {"oidref": 100, "id": "Gaia DR3 12345"},
            ])),
            ("HIP 777", ident_table([{"oidref": 300, "id": "HIP 777"}])),
        ])
        with mock.patch.object(sptype, "MEMBERSHIP", spine), \
             mock.patch.object(sptype.inputs, "iter_wds_xids_oids",
                               return_value=iter([200, 100])):
            resolved = sptype.collect_oid_requests(FakeClient(backend))
        # gaia oid 100 ∪ hip oid 300 ∪ wds {200, 100} → deduped.
        self.assertEqual(sorted(resolved.oids), [100, 200, 300])
        # The bindings the union pass reads back are per NAMESPACE, so a
        # widening rung folds into the namespace it asked under.
        self.assertEqual(resolved.bindings["source_id"], {12345: 100})
        self.assertEqual(resolved.bindings["hip"], {777: 300})



def basic_table(rows):
    """A basic-table response carrying just the columns the union reads."""
    return FakeTable(
        colnames=["oid", "main_id", "sp_type", "sp_qual", "sp_bibcode", "otype"],
        dtypes={"oid": int, "main_id": str, "sp_type": str, "sp_qual": str,
                "sp_bibcode": str, "otype": str},
        rows=[{"main_id": "", "sp_qual": "", "sp_bibcode": "", "otype": "",
               **r} for r in rows],
    )


UNION_COLUMNS = [OID, MAIN_ID, SP_TYPE, SP_QUAL, OTYPE]


class UnionUnansweredTests(unittest.TestCase):
    """The value-keyed union: ask every namespace a row reaches only where
    no object it already bound carries the value."""

    def _run(self, spine_rows, bindings, rows, responses):
        with tempfile.TemporaryDirectory() as d:
            spine = write_spine(Path(d), spine_rows)
            backend = FakeBackend(responses)
            found, added, report = union.union_unanswered(
                FakeClient(backend),
                membership_path=spine,
                bindings=bindings,
                rows=rows,
                columns=UNION_COLUMNS,
                value_alias=SP_TYPE.alias,
            )
            return found, added, report, backend

    def test_recovers_a_row_whose_bound_object_carries_no_type(self):
        # The Gaia lookup RESOLVED — onto a component-lettered object with no
        # sp_type — so no resolution-keyed rung ever fires for this row.
        found, added, report, _ = self._run(
            [{"gaia_source_id": "12345", "hip": "777"}],
            {"source_id": {12345: 100}},
            {100: {"sp_type": None}},
            [("HIP 777", ident_table([{"oidref": 300, "id": "HIP 777"}])),
             ("oidref IN (300)", ident_table([])),
             ("b.oid IN (300)", basic_table([{"oid": 300, "sp_type": "K0III"}]))],
        )
        self.assertEqual(found, {300: {"oid": 300, "main_id": "",
                                       "sp_type": "K0III", "sp_qual": "",
                                       "otype": ""}})
        self.assertEqual(added, {"hip": {777: 300}})
        self.assertEqual(report.unanswered, 1)
        self.assertEqual(report.with_unasked_namespace, 1)
        self.assertEqual(report.rows_recovered, 1)
        self.assertEqual(report.verdicts["hip"].uncorroborated, 1)

    def test_leaves_an_answered_row_alone(self):
        # Nothing is asked at all: the row's bound object states a type, so
        # the pass has no question to put to any other namespace.
        found, added, report, backend = self._run(
            [{"gaia_source_id": "12345", "hip": "777"}],
            {"source_id": {12345: 100}},
            {100: {"sp_type": "G2V"}},
            [],
        )
        self.assertEqual((found, added), ({}, {}))
        self.assertEqual(report.answered, 1)
        self.assertEqual(backend.calls, [])

    def test_vetoes_a_binding_simbad_names_another_source_for(self):
        # oid 300 answers 'HIP 777', but SIMBAD calls it Gaia DR3 999 where
        # the asking row is 12345 — SIMBAD's own statement that these are
        # separate stars, so no type may cross between them. The union binds
        # on a designation alone, exactly as a widening rung does, and takes
        # the same veto.
        found, added, report, backend = self._run(
            [{"gaia_source_id": "12345", "hip": "777"}],
            {"source_id": {12345: 100}},
            {100: {"sp_type": None}},
            [("HIP 777", ident_table([{"oidref": 300, "id": "HIP 777"}])),
             ("oidref IN (300)", ident_table([
                 {"oidref": 300, "id": "Gaia DR3 999"}]))],
        )
        self.assertEqual((found, added), ({}, {"hip": {}}))
        self.assertEqual(report.verdicts["hip"].vetoed, 1)
        self.assertEqual(report.rows_recovered, 0)
        # Vetoed before the basic table is ever asked for.
        self.assertFalse(any("b.oid IN" in q for q in backend.calls))

    def test_the_asking_id_under_an_earlier_release_corroborates(self):
        # The spine cell is a DR2 id in the DR3 column, so SIMBAD's DR3 id for
        # the object differs — a disagreement about the release, not about
        # which star this is.
        _, added, report, _ = self._run(
            [{"gaia_source_id": "12345", "hip": "777"}],
            {"source_id": {12345: 100}},
            {100: {"sp_type": None}},
            [("HIP 777", ident_table([{"oidref": 300, "id": "HIP 777"}])),
             ("oidref IN (300)", ident_table([
                 {"oidref": 300, "id": "Gaia DR2 12345"},
                 {"oidref": 300, "id": "Gaia DR3 999"}])),
             ("b.oid IN (300)", basic_table([{"oid": 300, "sp_type": "K0III"}]))],
        )
        self.assertEqual(added, {"hip": {777: 300}})
        self.assertEqual(report.verdicts["hip"].corroborated, 1)
        self.assertEqual(report.verdicts["hip"].vetoed, 0)

    def test_a_designation_two_source_ids_claim_is_not_adjudicated(self):
        # Two rows ask under one HIP, so there is no single asking id for a
        # cross-ID to contradict. Adjudicating against an arbitrary one of
        # them would veto on a coin toss, so the binding stands unverified.
        _, added, report, _ = self._run(
            [{"gaia_source_id": "12345", "hip": "777"},
             {"gaia_source_id": "23456", "hip": "777"}],
            {"source_id": {12345: 100, 23456: 101}},
            {100: {"sp_type": None}, 101: {"sp_type": None}},
            [("HIP 777", ident_table([{"oidref": 300, "id": "HIP 777"}])),
             ("oidref IN (300)", ident_table([
                 {"oidref": 300, "id": "Gaia DR3 999"}])),
             ("b.oid IN (300)", basic_table([{"oid": 300, "sp_type": "K0III"}]))],
        )
        self.assertEqual(added, {"hip": {777: 300}})
        self.assertEqual(report.verdicts["hip"].uncorroborated, 1)
        self.assertEqual(report.verdicts["hip"].vetoed, 0)
        self.assertEqual(report.rows_recovered, 2)

    def test_drops_an_object_that_answers_with_nothing(self):
        # An added row carrying no type would say nothing AND would collide,
        # under the same identifiers, with a row that does.
        found, added, report, _ = self._run(
            [{"gaia_source_id": "12345", "hip": "777"}],
            {"source_id": {12345: 100}},
            {100: {"sp_type": None}},
            [("HIP 777", ident_table([{"oidref": 300, "id": "HIP 777"}])),
             ("oidref IN (300)", ident_table([])),
             ("b.oid IN (300)", basic_table([{"oid": 300, "sp_type": ""}]))],
        )
        self.assertEqual(found, {})
        self.assertEqual(added, {"hip": {}})
        self.assertEqual(report.rows_recovered, 0)

    def test_credits_a_row_reaching_an_object_phase_b_already_pulled(self):
        # oid 100 was pulled for its own source_id row and states a type; this
        # row reaches it under a HIP nothing indexed it by, so it IS recovered
        # even though there is no row to add. Counting only fresh pulls would
        # under-report the pass against the build's own tier counts.
        found, added, report, backend = self._run(
            [{"gaia_source_id": "12345", "hip": "777"},
             {"gaia_source_id": "999", "hip": "777"}],
            {"source_id": {999: 100}},
            {100: {"sp_type": "K0III"}},
            [("HIP 777", ident_table([{"oidref": 100, "id": "HIP 777"}])),
             ("oidref IN (100)", ident_table([]))],
        )
        self.assertEqual(found, {})
        self.assertEqual(added, {"hip": {777: 100}})
        self.assertFalse(any("b.oid IN" in q for q in backend.calls))
        # One row asked; the source_id 999 row shares the HIP but its own
        # binding already answered it, so it is not a recovery.
        self.assertEqual((report.unanswered, report.rows_recovered), (1, 1))

    def test_does_not_re_ask_a_namespace_that_already_bound(self):
        # A bound namespace has answered — with the absence of a value — so
        # re-asking it would spend a request to be told the same thing.
        _, _, report, _ = self._run(
            [{"gaia_source_id": "12345", "hip": "777", "tyc": "1-2-1"}],
            {"source_id": {12345: 100}, "hip": {777: 100}},
            {100: {"sp_type": None}},
            [("TYC 1-2-1", ident_table([])), ],
        )
        self.assertEqual(report.requested["hip"], 0)
        self.assertEqual(report.requested["tyc"], 1)

    def test_a_later_namespace_skips_a_row_the_first_recovered(self):
        found, _, report, _ = self._run(
            [{"gaia_source_id": "12345", "hip": "777", "tyc": "1-2-1"}],
            {"source_id": {12345: 100}},
            {100: {"sp_type": None}},
            [("HIP 777", ident_table([{"oidref": 300, "id": "HIP 777"}])),
             ("oidref IN (300)", ident_table([])),
             ("b.oid IN (300)", basic_table([{"oid": 300, "sp_type": "K0III"}]))],
        )
        self.assertEqual(list(found), [300])
        self.assertEqual(report.requested["tyc"], 0)

    def test_merge_rows_returns_the_whole_sorted_oid_list(self):
        rows = {100: {"sp_type": None}}
        self.assertEqual(union.merge_rows(rows, {300: {"sp_type": "K0III"}}),
                         [100, 300])
        self.assertEqual(rows[300], {"sp_type": "K0III"})

    def test_the_union_asks_the_widening_ladder_and_no_gaia_rung(self):
        # Every designation namespace a row can carry, and NOT Gaia: a
        # source_id reaches this pass only when Phase A already failed to
        # resolve it, so a Gaia rung here spends a request on an id SIMBAD's
        # ident table has been proved not to hold.
        self.assertEqual(
            {lookup.tsv_name for lookup in union.UNION_NAMESPACES},
            {lookup.tsv_name for lookup in WIDENING_LADDER},
        )
        self.assertNotIn(
            GAIA_DR3.tsv_name,
            {lookup.tsv_name for lookup in union.UNION_NAMESPACES},
        )

    def test_iter_recovered_rows_honours_the_row_filter(self):
        # The enumeration has to answer for the same cohort the pass probed,
        # or a filtered pull reports rows it never asked about.
        with tempfile.TemporaryDirectory() as d:
            spine = write_spine(Path(d), [
                {"gaia_source_id": "12345", "hip": "777"},
                {"gaia_source_id": "23456", "hip": "778"},
            ])
            added = {"hip": {777: 300, 778: 301}}
            everything = list(union.iter_recovered_rows(spine, added))
            filtered = list(union.iter_recovered_rows(
                spine, added,
                row_filter=lambda row: row["hip"] == "777",
            ))
        self.assertEqual([r[1:] for r in everything],
                         [("hip", 300), ("hip", 301)])
        self.assertEqual([r[1:] for r in filtered], [("hip", 300)])


class ValuesCollectOidRequestsTests(unittest.TestCase):

    def _shell(self):
        return load_kebab_sibling(
            __file__, "refresh_simbad_values", "../refresh-simbad-values.py",
        )

    def test_cohort_predicate_narrows_the_request_set(self):
        shell = self._shell()
        d = self.enterContext(tempfile.TemporaryDirectory())
        spine = write_spine(Path(d), [
            # first-order in every field → no SIMBAD tier reaches it
            {"gaia_source_id": "1", "pos_src": "T", "dist_src": "G_R3",
             "mag_src": "HIP", "rv_src": "G_R3", "pm_src": "G_R3"},
            {"gaia_source_id": "2", "rv_src": "HYG"},
            {"hip": "777"},
        ])
        backend = FakeBackend([
            ("'Gaia DR3 2'", ident_table([{"oidref": 100, "id": "Gaia DR3 2"}])),
            ("'HIP 777'", ident_table([{"oidref": 300, "id": "HIP 777"}])),
        ])
        with mock.patch.object(shell, "SPINE", spine):
            oids = shell.collect_oid_requests(FakeClient(backend))
        self.assertEqual(oids, [100, 300])

    def test_gaia_resolution_floor_fails_the_pull(self):
        shell = self._shell()
        d = self.enterContext(tempfile.TemporaryDirectory())
        spine = write_spine(Path(d), [
            {"gaia_source_id": "2", "rv_src": "HYG"},
            {"gaia_source_id": "3", "rv_src": "HYG"},
        ])
        backend = FakeBackend([("FROM ident", ident_table([]))])
        with mock.patch.object(shell, "SPINE", spine):
            with self.assertRaises(SystemExit) as caught:
                shell.collect_oid_requests(FakeClient(backend))
        self.assertIn("Gaia DR3 ident resolution", str(caught.exception))


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
