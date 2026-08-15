#!/usr/bin/env python3
"""Refresh data/simbad/simbad_values.tsv — bibcoded SIMBAD rv, parallax,
proper motion, coordinates and B/V fluxes for the spine rows a
docs/catalog-driver.md § 5 SIMBAD value tier can reach."""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "util"))

import refresh_lib as rl  # noqa: E402
from paths import REPO_ROOT  # noqa: E402
import simbad  # noqa: E402
from simbad import coverage, inputs, query, request, tsv  # noqa: E402
from simbad.specs import (  # noqa: E402
    BASIC_BIBCODED_GROUPS, COO_BIBCODE, COO_QUAL, DEC, FluxBand, GAIA_DR3, GJ,
    HIP, MAIN_ID, OID, PLX_BIBCODE, PLX_ERR, PLX_QUAL, PLX_VALUE, PMDEC, PMRA,
    PM_BIBCODE, PM_QUAL, RA, RVZ_BIBCODE, RVZ_ERR, RVZ_QUAL, RVZ_RADVEL,
    RVZ_TYPE, TYC,
)

ROOT = REPO_ROOT
SPINE = ROOT / "data" / "athyg" / "inherited-spine.tsv"
OUT = ROOT / "data" / "simbad" / "simbad_values.tsv"


BASIC_COLUMNS = [
    OID, MAIN_ID,
    RA, DEC, COO_QUAL, COO_BIBCODE,
    PMRA, PMDEC, PM_QUAL, PM_BIBCODE,
    PLX_VALUE, PLX_ERR, PLX_QUAL, PLX_BIBCODE,
    RVZ_RADVEL, RVZ_ERR, RVZ_TYPE, RVZ_QUAL, RVZ_BIBCODE,
]
IDENT_LOOKUPS = [HIP, GAIA_DR3, TYC, GJ]
FLUX_BANDS = [FluxBand("B"), FluxBand("V")]


# Every SIMBAD object carries coordinates, so a coordinate fill below this
# means the response shape or the ColumnSpec list has drifted rather than
# that the cohort is sparse. The rv / parallax / PM fills are genuinely
# partial and are reported rather than gated.
COORD_COVERAGE_MIN = 0.99

# Gaia DR3 ident resolution over the cohort's source_ids. Measured 99.6%
# (2026-08-15); a request set that stops resolving is the failure this
# catches, not a SIMBAD ingest of new sources.
GAIA_RESOLUTION_MIN = 0.95


def collect_oid_requests(client: rl.TapClient) -> list[int]:
    """Resolve the § 5 value cohort's spine keys to a sorted oid list."""
    keys = inputs.spine_request_keys(SPINE, inputs.is_simbad_value_cohort)
    print(f"value cohort: {keys.total} spine rows "
          f"({keys.keyless} carrying no key)")
    resolved = request.resolve_spine_keys(client, keys)
    for line in resolved.report_lines():
        print(line)
    coverage.assert_floor(
        "Gaia DR3 ident resolution",
        resolved.coverage(GAIA_DR3.tsv_name),
        GAIA_RESOLUTION_MIN,
        script="refresh-simbad-values",
        diagnosis="the request set or SIMBAD's ident table has drifted",
    )
    print(f"oids: {len(resolved.oids)} "
          f"(+{resolved.gained_by_widening} the TYC widening reached alone)")
    return sorted(resolved.oids)


def main() -> None:
    force = "--force" in sys.argv

    sources = [SPINE, Path(__file__), *simbad.source_files()]
    if not force and rl.is_up_to_date(OUT, sources):
        print(f"{OUT.relative_to(ROOT)} up to date — skipping (use --force to rebuild)")
        return

    start = time.time()
    client = rl.TapClient(backends=[rl.simbad_backend()])

    print("\n=== Phase A: collect SIMBAD oid request set ===")
    oids = collect_oid_requests(client)

    print("\n=== Phase B: pull basic-table value columns ===")
    basic_rows = query.fetch_basic_columns(
        client, oids, BASIC_COLUMNS, progress_label="basic",
    )

    print("\n=== Phase C: pull cross-IDs from ident table ===")
    ident_rows = query.fetch_ident_lookups(
        client, oids, IDENT_LOOKUPS, progress_label="ident",
    )

    print("\n=== Phase D: pull bibcoded B/V fluxes ===")
    flux_rows = query.fetch_flux_bands(
        client, oids, FLUX_BANDS, progress_label="flux",
    )

    print("\n=== Phase E: coverage gate + write TSV ===")
    total = len(basic_rows)
    coords = coverage.report_fill("coordinates", basic_rows, RA.alias, total)
    for label, column in (
        ("radial velocity", RVZ_RADVEL), ("rv bibcode", RVZ_BIBCODE),
        ("parallax", PLX_VALUE), ("parallax bibcode", PLX_BIBCODE),
        ("proper motion", PMRA), ("pm bibcode", PM_BIBCODE),
    ):
        coverage.report_fill(label, basic_rows, column.alias, total)
    for band in FLUX_BANDS:
        value_name, _, bibcode_name = band.tsv_names
        reached = coverage.report_fill(
            f"flux {band.filter}", flux_rows, value_name, total,
        )
        bibcoded = coverage.count_filled(flux_rows, bibcode_name)
        print(f"  {'':16s} {'':6s}  {bibcoded} ship, {reached - bibcoded} "
              f"dropped as unattributable")

    coverage.assert_floor(
        "coordinate fill", coords / max(1, total), COORD_COVERAGE_MIN,
        script="refresh-simbad-values",
        diagnosis="SIMBAD response shape or the ColumnSpec list has drifted",
    )

    written = tsv.write_simbad_tsv(
        output=OUT,
        oids=oids,
        basic_rows=basic_rows,
        columns=BASIC_COLUMNS,
        blocks=[
            tsv.ident_block(IDENT_LOOKUPS, ident_rows),
            tsv.flux_block(FLUX_BANDS, flux_rows),
        ],
        bibcoded_groups=[
            *BASIC_BIBCODED_GROUPS,
            *(band.bibcoded_group() for band in FLUX_BANDS),
        ],
    )
    print(
        f"\nwrote {OUT.relative_to(ROOT)} ({written} rows) "
        f"in {(time.time()-start)/60:.1f}m total"
    )


if __name__ == "__main__":
    main()
