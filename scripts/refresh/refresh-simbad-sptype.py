#!/usr/bin/env python3
"""Refresh data/simbad/simbad_sptype.tsv — SIMBAD per-source sp_type,
sp_qual, sp_bibcode, otype, and HIP / Gaia DR3 / TYC / GJ cross-IDs."""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "util"))

import refresh_lib as rl  # noqa: E402
from paths import REPO_ROOT  # noqa: E402
from simbad import inputs, query, request, tsv  # noqa: E402
from simbad.specs import (  # noqa: E402
    OID, MAIN_ID, SP_TYPE, SP_QUAL, SP_BIBCODE, OTYPE, GAIA_DR3, GJ, HIP, TYC,
)

ROOT = REPO_ROOT
SPINE = ROOT / "data" / "athyg" / "inherited-spine.tsv"
WDS_XIDS_TSV = ROOT / "data" / "simbad" / "simbad_wds_xids.tsv"
OUT = ROOT / "data" / "simbad" / "simbad_sptype.tsv"


BASIC_COLUMNS = [OID, MAIN_ID, SP_TYPE, SP_QUAL, SP_BIBCODE, OTYPE]
IDENT_LOOKUPS = [HIP, GAIA_DR3, TYC, GJ]


# SIMBAD sp_type non-null rate — drops sharply in the faint Tycho tail.
# 50% is the rough lower bound observed; below this the pull is likely broken.
SP_TYPE_COVERAGE_MIN = 0.50


def collect_oid_requests(client: rl.TapClient) -> list[int]:
    """Compose every input source, resolve non-oid identifiers via the
    ident table, union into a deduplicated sorted oid list."""
    print("[1/2] spine identifier keys → SIMBAD oid (via ident)…")
    keys = inputs.spine_request_keys(SPINE)
    print(f"      spine rows: {keys.total} ({keys.keyless} carrying no key)")
    resolved = request.resolve_spine_keys(
        client, keys, tyc_by_source_id=inputs.spine_tyc_by_source_id(SPINE)
    )
    for line in resolved.report_lines():
        print(line)
    print(f"      oids from the spine: {len(resolved.oids)} "
          f"(+{resolved.gained_by_widening} the TYC widening reached alone)")

    print("[2/2] simbad_wds_xids.tsv simbad_oid → direct…")
    wds_oids = list(inputs.iter_wds_xids_oids(WDS_XIDS_TSV))
    new_from_wds = len(set(wds_oids) - resolved.oids)
    print(f"      WDS-xref oids: {len(wds_oids)}; "
          f"{new_from_wds} not already covered by the spine")
    resolved.oids.update(wds_oids)

    return sorted(resolved.oids)


def main() -> None:
    force = "--force" in sys.argv

    simbad_pkg = Path(__file__).resolve().parent / "simbad"
    sources = [SPINE, WDS_XIDS_TSV, Path(__file__)]
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
        columns=BASIC_COLUMNS,
        blocks=[tsv.ident_block(IDENT_LOOKUPS, ident_rows)],
    )
    print(
        f"\nwrote {OUT.relative_to(ROOT)} ({written} rows) "
        f"in {(time.time()-start)/60:.1f}m total"
    )


if __name__ == "__main__":
    main()
