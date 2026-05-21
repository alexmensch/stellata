#!/usr/bin/env python3
"""Refresh data/simbad/simbad_sptype.tsv — SIMBAD per-source sp_type +
sp_qual + sp_bibcode + otype + HIP / Gaia DR3 cross-IDs.

Orchestration shell over scripts/refresh/simbad/; adding a column /
cross-ID / input source is a one-line append to BASIC_COLUMNS /
IDENT_LOOKUPS / collect_oid_requests below.

Runtime: ~60-120 min.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import refresh_lib as rl  # noqa: E402
from simbad import inputs, query, tsv  # noqa: E402
from simbad.specs import (  # noqa: E402
    OID, MAIN_ID, SP_TYPE, SP_QUAL, SP_BIBCODE, OTYPE, HIP, GAIA_DR3,
)

ROOT = Path(__file__).resolve().parent.parent.parent
ATHYG_CSV = ROOT / "data" / "athyg" / "athyg_33_classic_ids.csv"
WDS_XIDS_TSV = ROOT / "data" / "simbad" / "simbad_wds_xids.tsv"
OUT = ROOT / "data" / "simbad" / "simbad_sptype.tsv"


BASIC_COLUMNS = [OID, MAIN_ID, SP_TYPE, SP_QUAL, SP_BIBCODE, OTYPE]
IDENT_LOOKUPS = [HIP, GAIA_DR3]


# SIMBAD sp_type non-null rate — drops sharply in the faint Tycho tail.
# 50% is the rough lower bound observed; below this the pull is likely broken.
SP_TYPE_COVERAGE_MIN = 0.50


def collect_oid_requests(client: rl.TapClient) -> list[int]:
    """Compose every input source, resolve non-oid identifiers via the
    ident table, union into a deduplicated sorted oid list."""
    oids: set[int] = set()

    print("[1/3] AT-HYG Gaia DR3 source_ids → SIMBAD oid (via ident)…")
    athyg_gaia = rl.read_athyg_source_ids(ATHYG_CSV)
    print(f"      AT-HYG rows with gaia: {len(athyg_gaia)}")
    gaia_to_oid = query.resolve_oids_by_prefix(
        client, athyg_gaia, prefix=GAIA_DR3.prefix,
    )
    print(f"      Resolved to {len(gaia_to_oid)} SIMBAD oids "
          f"({len(gaia_to_oid)/max(1,len(athyg_gaia)):.1%} coverage)")
    oids.update(gaia_to_oid.values())

    print("[2/3] AT-HYG HIP-only rows → SIMBAD oid (via ident)…")
    athyg_hip = list(inputs.iter_athyg_hip_for_no_gaia(ATHYG_CSV))
    print(f"      AT-HYG rows with HIP but no Gaia: {len(athyg_hip)}")
    hip_to_oid = query.resolve_oids_by_prefix(
        client, athyg_hip, prefix=HIP.prefix,
    )
    print(f"      Resolved to {len(hip_to_oid)} additional SIMBAD oids")
    oids.update(hip_to_oid.values())

    print("[3/3] simbad_wds_xids.tsv simbad_oid → direct…")
    wds_oids = list(inputs.iter_wds_xids_oids(WDS_XIDS_TSV))
    print(f"      WDS-xref oids: {len(wds_oids)}")
    new_from_wds = len(set(wds_oids) - oids)
    oids.update(wds_oids)
    print(f"      Added {new_from_wds} oids not already covered by AT-HYG paths")

    return sorted(oids)


def main() -> None:
    force = "--force" in sys.argv

    simbad_pkg = Path(__file__).resolve().parent / "simbad"
    sources = [ATHYG_CSV, WDS_XIDS_TSV, Path(__file__)]
    sources.extend(
        p for p in sorted(simbad_pkg.glob("*.py"))
        if not p.name.startswith("_") and "test" not in p.name
    )
    if not force and rl.is_up_to_date(OUT, sources):
        print(f"{OUT.relative_to(ROOT)} up to date — skipping (use --force to rebuild)")
        return

    start = time.time()
    client = rl.TapClient(backends=[rl.simbad_backend()])

    print("\n=== Phase A: collect SIMBAD oid request set ===")
    oids = collect_oid_requests(client)
    print(f"\nTotal unique oids to query: {len(oids)} "
          f"(elapsed {(time.time()-start)/60:.1f}m)")

    print("\n=== Phase B: pull basic-table columns ===")
    basic_rows = query.fetch_basic_columns(
        client, oids, BASIC_COLUMNS, progress_label="basic",
    )

    print("\n=== Phase C: pull cross-IDs from ident table ===")
    ident_rows = query.fetch_ident_lookups(
        client, oids, IDENT_LOOKUPS, progress_label="ident",
    )

    print("\n=== Phase D: coverage gate + write TSV ===")
    sp_type_filled = sum(
        1 for r in basic_rows.values()
        if r.get(SP_TYPE.alias) is not None and str(r[SP_TYPE.alias]).strip()
    )
    coverage = sp_type_filled / max(1, len(basic_rows))
    print(f"sp_type non-null: {sp_type_filled}/{len(basic_rows)} = {coverage:.1%}")
    if coverage < SP_TYPE_COVERAGE_MIN:
        raise SystemExit(
            f"refresh-simbad-sptype: sp_type coverage {coverage:.1%} below "
            f"floor {SP_TYPE_COVERAGE_MIN:.0%} — SIMBAD response shape or the "
            f"ColumnSpec list has drifted; investigate before pinning."
        )

    written = tsv.write_simbad_tsv(
        output=OUT,
        oids=oids,
        basic_rows=basic_rows,
        ident_rows=ident_rows,
        columns=BASIC_COLUMNS,
        ident_lookups=IDENT_LOOKUPS,
    )
    print(
        f"\nwrote {OUT.relative_to(ROOT)} ({written} rows) "
        f"in {(time.time()-start)/60:.1f}m total"
    )


if __name__ == "__main__":
    main()
