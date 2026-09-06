#!/usr/bin/env python3
"""Refresh data/simbad/simbad_sptype.tsv — SIMBAD per-source sp_type,
sp_qual, sp_bibcode, otype, and HIP / Gaia DR3 / TYC / GJ cross-IDs."""

from __future__ import annotations

import itertools
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "util"))

import refresh_lib as rl  # noqa: E402
from paths import REPO_ROOT  # noqa: E402
import simbad  # noqa: E402
from simbad import coverage, inputs, query, request, tsv, union  # noqa: E402
from simbad.specs import (  # noqa: E402
    OID, MAIN_ID, SP_TYPE, SP_QUAL, SP_BIBCODE, OTYPE, GAIA_DR3, GJ, HIP, TYC,
)

ROOT = REPO_ROOT
MEMBERSHIP = ROOT / "data" / "membership" / "membership-manifest.tsv"
WDS_XIDS_TSV = ROOT / "data" / "simbad" / "simbad_wds_xids.tsv"
OUT = ROOT / "data" / "simbad" / "simbad_sptype.tsv"


BASIC_COLUMNS = [OID, MAIN_ID, SP_TYPE, SP_QUAL, SP_BIBCODE, OTYPE]
IDENT_LOOKUPS = [HIP, GAIA_DR3, TYC, GJ]


# SIMBAD sp_type non-null rate — drops sharply in the faint Tycho tail.
# 50% is the rough lower bound observed; below this the pull is likely broken.
SP_TYPE_COVERAGE_MIN = 0.50

# Recovered rows printed per run. The union adds rows to a frozen table, so
# a sample of what it recovered belongs in the run log beside the counts;
# the whole set is the build's own `spectralSimbadBy*` partition.
RECOVERED_SAMPLE = 25


def collect_oid_requests(client: rl.TapClient) -> request.OidRequest:
    """Compose every input source, resolve non-oid identifiers via the
    ident table, union into a deduplicated oid set."""
    print("[1/2] manifest identifier keys → SIMBAD oid (via ident)…")
    keys = inputs.membership_request_keys(MEMBERSHIP)
    print(f"      manifest rows: {keys.total} ({keys.keyless} carrying no key)")
    resolved = request.resolve_membership_keys(client, keys)
    for line in resolved.report_lines():
        print(line)
    print(f"      oids from the manifest: {len(resolved.oids)} "
          f"(+{resolved.total_gained_by_widening} the widening reached alone)")

    print("[2/2] simbad_wds_xids.tsv simbad_oid → direct…")
    wds_oids = list(inputs.iter_wds_xids_oids(WDS_XIDS_TSV))
    new_from_wds = len(set(wds_oids) - resolved.oids)
    print(f"      WDS-xref oids: {len(wds_oids)}; "
          f"{new_from_wds} not already covered by the manifest")
    resolved.oids.update(wds_oids)

    return resolved


def main() -> None:
    force = "--force" in sys.argv

    sources = [MEMBERSHIP, WDS_XIDS_TSV, Path(__file__), *simbad.source_files()]
    if not force and rl.is_up_to_date(OUT, sources):
        print(f"{OUT.relative_to(ROOT)} up to date — skipping (use --force to rebuild)")
        return

    start = time.time()
    client = rl.TapClient(backends=[rl.simbad_backend()])

    print("\n=== Phase A: collect SIMBAD oid request set ===")
    resolved = collect_oid_requests(client)
    oids = sorted(resolved.oids)
    print(f"\nTotal unique oids to query: {len(oids)} "
          f"(elapsed {(time.time()-start)/60:.1f}m)")

    print("\n=== Phase B: pull basic-table columns ===")
    basic_rows = query.fetch_basic_columns(
        client, oids, BASIC_COLUMNS, progress_label="basic",
    )

    print("\n=== Phase B2: union the namespaces of every unanswered row ===")
    added, added_bindings, union_report = union.union_unanswered(
        client,
        membership_path=MEMBERSHIP,
        bindings=resolved.bindings,
        rows=basic_rows,
        columns=BASIC_COLUMNS,
        value_alias=SP_TYPE.alias,
    )
    for line in union_report.report_lines():
        print(line)
    for row, namespace, oid in itertools.islice(
        union.iter_recovered_rows(MEMBERSHIP, added_bindings),
        RECOVERED_SAMPLE,
    ):
        cells = added.get(oid) or basic_rows[oid]
        print(f"      recovered via {namespace:9s} "
              f"hip={row['hip'] or '-':>7s} hd={row['hd'] or '-':>7s} "
              f"→ {cells.get(SP_TYPE.alias)}")
    oids = union.merge_rows(basic_rows, added)

    print("\n=== Phase C: pull cross-IDs from ident table ===")
    ident_rows = query.fetch_ident_lookups(
        client, oids, IDENT_LOOKUPS, progress_label="ident",
    )

    print("\n=== Phase D: coverage gate + write TSV ===")
    total = len(basic_rows)
    sp_type_filled = coverage.report_fill("sp_type", basic_rows, SP_TYPE.alias, total)
    coverage.assert_floor(
        "sp_type coverage", sp_type_filled / max(1, total), SP_TYPE_COVERAGE_MIN,
        script="refresh-simbad-sptype",
        diagnosis="SIMBAD response shape or the ColumnSpec list has drifted",
    )

    written = tsv.write_simbad_tsv(
        output=OUT,
        oids=oids,
        basic_rows=basic_rows,
        columns=BASIC_COLUMNS,
        blocks=[tsv.ident_block(IDENT_LOOKUPS, ident_rows)],
    )
    print(
        f"\nwrote {OUT.relative_to(ROOT)} ({written} rows) "
        f"in {(time.time()-start)/60:.1f}m total"
    )


if __name__ == "__main__":
    main()
