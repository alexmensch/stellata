#!/usr/bin/env python3
"""Refresh data/simbad/simbad_spectral.tsv — SIMBAD per-source spectral types.

Phase 3 of the source-ID-anchored catalogue-pipeline rewrite (stellata-dch.64.1).
Single SIMBAD pull that serves both the build-catalog single-star path
(consumed in stellata-dch.64.2 to retire the parseSpectral regex chain)
and the build-binaries per-component path (consumed in stellata-dch.63
to anchor WDS-pair spectral types on SIMBAD's per-component sp_type).

ADQL (per batch, against SIMBAD TAP)
    SELECT b.oid, b.main_id, b.sp_type, b.sp_qual, b.sp_bibcode, b.otype
    FROM basic AS b
    WHERE b.oid IN (<oid batch>)

    SELECT oidref, id FROM ident
    WHERE oidref IN (<oid batch>)
    AND (id LIKE 'HIP %' OR id LIKE 'Gaia DR3 %')

TSV columns (8)
    simbad_oid       int   — SIMBAD basic.oid (stable primary key)
    simbad_main_id   str   — SIMBAD basic.main_id (e.g. "* alf CMa")
    sp_type          str|"" — basic.sp_type (canonical MK string)
    sp_qual          str|"" — basic.sp_qual (A/B/C/D/E quality grade)
    sp_bibcode       str|"" — basic.sp_bibcode (reference)
    otype            str|"" — basic.otype (SIMBAD hierarchical short code)
    hip              int|"" — ident-resolved Hipparcos number
    source_id        int|"" — ident-resolved Gaia DR3 source_id

Input sources (composed into the deduped oid request set):
    1. AT-HYG `gaia` column → resolve via ident WHERE id IN ('Gaia DR3 N')
    2. AT-HYG `hip` column for no-Gaia rows → resolve via ident WHERE id IN ('HIP N')
    3. data/simbad/simbad_wds_xids.tsv `simbad_oid` column → direct

Extensibility — see ``scripts/refresh/simbad/__init__.py`` for the
sibling-module decomposition. Adding a new SIMBAD column is one
``ColumnSpec`` append to ``BASIC_COLUMNS`` below; adding a new cross-ID
is one ``IdentLookup`` append to ``IDENT_LOOKUPS``; adding a new input
source is one iter-helper in ``simbad/inputs.py`` plus one composition
line in ``collect_oid_requests`` below.

Backend: SIMBAD TAP only — same dialect quirks as refresh-simbad-sample.py.

Idempotent — exits early if the output is newer than this script AND
than the AT-HYG / WDS-xids inputs. Pass `--force` to rebuild.

Venv setup (see scripts/refresh/requirements-refresh.txt):
    python3 -m venv .venv
    .venv/bin/pip install -r scripts/refresh/requirements-refresh.txt
    .venv/bin/python scripts/refresh/refresh-simbad-spectral.py
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
OUT = ROOT / "data" / "simbad" / "simbad_spectral.tsv"


# ─── Spec lists — extend here to extend the pull ─────────────────────

BASIC_COLUMNS = [OID, MAIN_ID, SP_TYPE, SP_QUAL, SP_BIBCODE, OTYPE]
IDENT_LOOKUPS = [HIP, GAIA_DR3]


# Coverage floor for the union sp_type non-null rate. SIMBAD has
# sp_type for most bright stars (HIP regime) but coverage drops
# sharply in the faint Tycho-only tail. 50% is the rough lower
# bound observed on probe runs; below this the pull is likely broken.
SP_TYPE_COVERAGE_MIN = 0.50


def collect_oid_requests(
    client: rl.TapClient,
) -> list[int]:
    """Compose every input source, resolve non-oid identifiers via the
    ident table, union into a deduplicated sorted oid list. Each source
    is added as a separate, named step so progress logging tracks where
    coverage gaps land.

    Returns the sorted list of unique SIMBAD oids to fetch.
    """
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

    # Idempotency: re-run if any input file has moved AHEAD of the
    # output, OR if this script / refresh_lib / a sibling simbad/*
    # module has been edited (mtime check folds in refresh_lib.py and
    # this file via is_up_to_date's automatic plumbing; sibling
    # simbad/ modules need to be listed explicitly).
    simbad_pkg = Path(__file__).resolve().parent / "simbad"
    sources = [
        ATHYG_CSV, WDS_XIDS_TSV,
        Path(__file__),
        simbad_pkg / "specs.py",
        simbad_pkg / "inputs.py",
        simbad_pkg / "query.py",
        simbad_pkg / "tsv.py",
    ]
    if not force and rl.is_up_to_date(OUT, sources):
        print(f"{OUT.relative_to(ROOT)} up to date — skipping (use --force to rebuild)")
        return

    start = time.time()
    client = rl.TapClient(backends=[rl.simbad_backend()])

    print("\n=== Phase A: collect SIMBAD oid request set ===")
    oids = collect_oid_requests(client)
    print(f"\nTotal unique oids to query: {len(oids)} "
          f"(elapsed {(time.time()-start)/60:.1f}m)")

    print("\n=== Phase B: pull basic-table spectral columns ===")
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
            f"refresh-simbad-spectral: sp_type coverage {coverage:.1%} below "
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
