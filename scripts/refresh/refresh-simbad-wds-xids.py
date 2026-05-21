#!/usr/bin/env python3
"""Refresh data/simbad/simbad_wds_xids.tsv — per-component SIMBAD-curated WDS↔Gaia DR3 cross-IDs.

Stage 2 supplement (stellata-dch.60) for build-binaries.py's WDS-component →
Gaia source_id resolution cascade. The principled alternative to a hand-rolled
regex parser over WDS Notes prose: SIMBAD's ``ident`` table holds curated
``WDS J<id><comp>`` ↔ Gaia DR3 cross-IDs for the well-known multi-component
systems (η Cas A/B/C, ξ UMa A/B, ζ Cnc A/B/C, α Cen / Proxima, etc.).

Per-component resolution is reliable — spot-checked 2026-05-20 against 4
systems / 12 components: 9/9 main components resolved to a SIMBAD oid; 7/9
carried a Gaia DR3 source_id. The two α Cen A/B exceptions are Gaia bright-
star saturation (handled by Stage 3's HIP2 long-baseline fallback) — SIMBAD
itself resolves the component to an oid in both cases. Sub-component depth
(Ba/Bb) is NOT stored in SIMBAD's ``ident`` and is gracefully skipped.

TSV columns (6)
    wds_id          str — "HHMMm±DDMM" WDS positional anchor (matches WdsPair.wds_id)
    component       str — component letter(s) — 'A', 'B', 'Aa', 'Ab', etc.
    simbad_oid      int — SIMBAD basic.oid (stable primary key)
    simbad_main_id  str — SIMBAD basic.main_id (e.g. "* eta Cas A")
    gaia_source_id  int|"" — Gaia DR3 source_id from ident table (blank when SIMBAD
                             resolves the component but has no Gaia DR3 cross-ID — e.g.
                             α Cen A/B's Gaia saturation gap)
    hip             int|"" — Hipparcos number from ident table

Algorithm — two-phase pull. Phase A bulk-queries SIMBAD's ``ident`` table
for every ``WDS J<id><comp>`` identifier from parse_wds_summ + split_components.
Phase B fans out from the matched oids to pull main_id + HIP + Gaia DR3
cross-IDs. Composing the output is then a local join keyed on the WDS
identifier. Batch size 1000 keeps every POST body well under SIMBAD's
~64 KB ceiling; ~40-60 batches per phase at current WDS volumes.

Idempotent — exits early if the output is newer than this script AND
SRC_WDS_SUMM. Pass ``--force`` to rebuild unconditionally. Output is
sorted by (wds_id, component) so re-runs against an unchanged SIMBAD
produce byte-identical TSVs.

Backend: SIMBAD TAP only (refresh_lib.simbad_backend) — SIMBAD's ADQL
dialect diverges from ESA / CDS (LIKE forbidden on basic.otype, MOD()
but no ``%`` operator) so the default ESA→CDS fallback chain is
bypassed via ``backends=[simbad_backend()]``.

Venv setup (see scripts/requirements-refresh.txt):
    python3 -m venv .venv
    .venv/bin/pip install -r scripts/requirements-refresh.txt
    .venv/bin/python scripts/refresh/refresh-simbad-wds-xids.py
"""

from __future__ import annotations

import importlib.util
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import refresh_lib as rl  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPT_DIR = Path(__file__).resolve().parent
SRC_WDS_SUMM = ROOT / "data" / "wds" / "wds_summ.txt"
OUT = ROOT / "data" / "simbad" / "simbad_wds_xids.tsv"

# Reuse build-binaries.py's WDS parser + split_components so the input
# universe is byte-identical to what Stage 2 will look up. spec_from_file
# is required because the script filename contains a hyphen, which
# `import build_binaries` cannot resolve. Mirrors the test file's loader.
_SPEC = importlib.util.spec_from_file_location(
    "build_binaries", SCRIPT_DIR.parent / "binaries" / "build-binaries.py",
)
assert _SPEC and _SPEC.loader
_bb = importlib.util.module_from_spec(_SPEC)
sys.modules["build_binaries"] = _bb
_SPEC.loader.exec_module(_bb)

# Per-batch IN-clause size for SIMBAD's TAP. 1000 ``WDS J…`` idents ≈ 17
# chars each + quoting + commas → ~20 KB POST body, well under SIMBAD's
# ~64 KB ceiling. Matches refresh-simbad-sample.py's IDENT_BATCH so the
# two scripts share the same scaling constants.
IDENT_BATCH = 1_000

# Output column order — matches the docstring schema block.
TSV_COLUMNS = [
    "wds_id",
    "component",
    "simbad_oid",
    "simbad_main_id",
    "gaia_source_id",
    "hip",
]

# Identifier prefixes — paired LIKE pattern + integer-extraction offset
# so a SIMBAD rename only edits the canonical pair once each. Same shape
# as refresh-simbad-sample.py.
HIP_LIKE = "HIP %"
HIP_PREFIX_LEN = len("HIP ")
GAIA_LIKE = "Gaia DR3 %"
GAIA_PREFIX_LEN = len("Gaia DR3 ")

# Phase A: WDS-ident → oidref schema. Live probe 2026-05-20 returned
# id as an object column, oidref as int64.
IDENT_BY_WDS_SCHEMA: dict[str, type | tuple[type, ...]] = {
    "id": str,
    "oidref": int,
}

# Phase B: oid → (main_id, identifier) schema.
XREF_SCHEMA: dict[str, type | tuple[type, ...]] = {
    "oid": int,
    "main_id": str,
    "id": str,
}


def collect_unique_components() -> list[tuple[str, str]]:
    """Read SRC_WDS_SUMM via build-binaries' parser + split_components,
    return the deduped sorted list of (wds_id, component) tuples. System-
    level rows (empty components) and ambiguous-component rows are skipped
    so the input universe matches Stage 2's exactly."""
    pairs = _bb.parse_wds_summ(SRC_WDS_SUMM)
    seen: set[tuple[str, str]] = set()
    for p in pairs:
        split = _bb.split_components(p.components)
        if split is None:
            continue
        seen.add((p.wds_id, split[0]))
        seen.add((p.wds_id, split[1]))
    return sorted(seen)


def wds_ident(wds_id: str, component: str) -> str:
    """SIMBAD's canonical representation of a WDS component identifier.
    Empirical form is ``WDS J<id><comp>`` (no space between id and
    component letter) — confirmed 2026-05-20 against η Cas, ξ UMa, ζ Cnc,
    α Cen. The system-level form ``WDS J<id>`` (no letter) is NOT stored
    in SIMBAD's ident table."""
    return f"WDS J{wds_id}{component}"


def query_ident_batch(
    client: rl.TapClient,
    wds_idents: list[str],
) -> Any:
    """Phase A. Bulk-query SIMBAD ``ident`` for the given WDS identifiers.
    Returns the astropy Table directly so the caller can schema-validate
    once before iterating. WDS identifiers contain only digits, ``+``,
    ``-``, ``J``, ``space``, and a component letter — none need escaping
    inside the IN-clause's single-quoted strings."""
    inlist = ",".join(f"'{i}'" for i in wds_idents)
    return client.run(
        "SELECT id, oidref FROM ident "
        f"WHERE id IN ({inlist}) "
        "ORDER BY id"
    )


def query_xrefs_batch(
    client: rl.TapClient,
    oids: list[int],
) -> dict[int, dict[str, Any]]:
    """Phase B. For the given oids, pull main_id (from basic) and any HIP
    / Gaia DR3 identifiers (from ident). Returns
    ``{oid: {'main_id': str, 'hip': int|None, 'gaia': int|None}}``.

    Uses a single JOIN query for oids that have at least one matching
    HIP / Gaia row, then a small follow-up basic-only query for any oids
    the JOIN missed entirely. The JOIN-missed branch handles the case
    where SIMBAD knows the WDS pair (matched in Phase A) but has no Gaia
    DR3 / HIP cross-ID for it — we still want to record the oid + main_id
    so the build TSV's per-row coverage stats can distinguish "SIMBAD knew
    the system but couldn't link it to Gaia" from "SIMBAD didn't know it
    at all". α Cen A/B is the canonical case.
    """
    if not oids:
        return {}
    inlist = ",".join(str(o) for o in oids)
    # Alias every selected column so ORDER BY can reference unqualified
    # names — SIMBAD's ADQL parser rejects qualified `b.oid` / `i.id`
    # inside ORDER BY ("Encountered '.'"), same gotcha refresh-simbad-
    # sample.py documents.
    table = client.run(
        "SELECT b.oid AS oid, b.main_id AS main_id, i.id AS id "
        "FROM basic AS b "
        "JOIN ident AS i ON i.oidref = b.oid "
        f"WHERE b.oid IN ({inlist}) "
        f"AND (i.id LIKE '{HIP_LIKE}' OR i.id LIKE '{GAIA_LIKE}') "
        "ORDER BY oid, id"
    )
    out: dict[int, dict[str, Any]] = {}
    for row in table:
        oid = int(row["oid"])
        rec = out.setdefault(oid, {
            "main_id": str(rl.coerce_masked(row["main_id"]) or ""),
            "hip": None,
            "gaia": None,
        })
        id_str = str(rl.coerce_masked(row["id"]) or "")
        if id_str.startswith("HIP "):
            try:
                rec["hip"] = int(id_str[HIP_PREFIX_LEN:])
            except ValueError:
                # Rare HIP aliases like "HIP 12345 A" — skip; the canonical
                # integer-only entry appears in the same result set with no
                # suffix.
                pass
        elif id_str.startswith("Gaia DR3 "):
            try:
                rec["gaia"] = int(id_str[GAIA_PREFIX_LEN:])
            except ValueError:
                pass
    missing = sorted(o for o in oids if o not in out)
    if missing:
        miss_inlist = ",".join(str(o) for o in missing)
        for row in client.run(
            f"SELECT oid, main_id FROM basic WHERE oid IN ({miss_inlist})"
        ):
            oid = int(row["oid"])
            out[oid] = {
                "main_id": str(rl.coerce_masked(row["main_id"]) or ""),
                "hip": None,
                "gaia": None,
            }
    return out


def main() -> None:
    force = "--force" in sys.argv
    if not force and rl.is_up_to_date(OUT, [Path(__file__), SRC_WDS_SUMM]):
        print(
            f"{OUT.relative_to(ROOT)} up to date — skipping (use --force to rebuild)"
        )
        return

    components = collect_unique_components()
    print(f"collected {len(components):,} unique (wds_id, component) tuples")

    client = rl.TapClient(backends=[rl.simbad_backend()])

    # WDS-ident → component-tuple map: lets the final join be O(1) regardless
    # of SIMBAD's response order. ``all_idents`` is sorted so batch contents
    # are deterministic across re-runs.
    ident_to_component: dict[str, tuple[str, str]] = {
        wds_ident(w, c): (w, c) for (w, c) in components
    }
    all_idents = sorted(ident_to_component)

    # Phase A: ident lookup.
    n_batches = (len(all_idents) + IDENT_BATCH - 1) // IDENT_BATCH
    ident_to_oid: dict[str, int] = {}
    duplicate_idents = 0
    start = time.time()
    for batch_idx, offset in enumerate(range(0, len(all_idents), IDENT_BATCH), start=1):
        batch = all_idents[offset : offset + IDENT_BATCH]
        t0 = time.time()
        table = query_ident_batch(client, batch)
        if batch_idx == 1:
            rl.validate_schema(table, IDENT_BY_WDS_SCHEMA, label="SIMBAD ident-by-WDS")
        for row in table:
            ident = str(rl.coerce_masked(row["id"]) or "")
            oidref = int(row["oidref"])
            if ident in ident_to_oid and ident_to_oid[ident] != oidref:
                # SIMBAD shouldn't return the same WDS identifier under two
                # different oids — flag and skip rather than picking one
                # arbitrarily. Surfaces ident-table integrity changes.
                duplicate_idents += 1
                continue
            ident_to_oid[ident] = oidref
        elapsed = time.time() - t0
        print(
            f"  ident batch {batch_idx:3d}/{n_batches:3d}: "
            f"{len(table):5d} hits in {elapsed:5.1f}s "
            f"(cumulative {len(ident_to_oid):,} resolved, "
            f"{(time.time() - start) / 60:.1f}m)"
        )
    if duplicate_idents:
        print(
            f"WARNING: {duplicate_idents} duplicate ident → oid mappings — "
            f"SIMBAD ident-table integrity changed; investigate."
        )
    if len(all_idents):
        print(
            f"Phase A complete: {len(ident_to_oid):,}/{len(all_idents):,} "
            f"WDS components matched SIMBAD ident "
            f"({len(ident_to_oid) / len(all_idents):.1%})"
        )

    # Phase B: cross-IDs for the matched oids.
    unique_oids = sorted(set(ident_to_oid.values()))
    print(f"resolving cross-IDs for {len(unique_oids):,} unique SIMBAD oids…")
    n_oid_batches = (len(unique_oids) + IDENT_BATCH - 1) // IDENT_BATCH
    oid_xrefs: dict[int, dict[str, Any]] = {}
    for batch_idx, offset in enumerate(range(0, len(unique_oids), IDENT_BATCH), start=1):
        batch = unique_oids[offset : offset + IDENT_BATCH]
        t0 = time.time()
        batch_xrefs = query_xrefs_batch(client, batch)
        oid_xrefs.update(batch_xrefs)
        elapsed = time.time() - t0
        print(
            f"  xref batch {batch_idx:3d}/{n_oid_batches:3d}: "
            f"{len(batch_xrefs):5d} oids resolved in {elapsed:5.1f}s "
            f"(cumulative {len(oid_xrefs):,})"
        )

    # Compose output. (wds_id, component) sort key produces byte-identical
    # TSVs across re-runs against an unchanged SIMBAD.
    rows: list[dict[str, Any]] = []
    for wds_id, component in components:
        ident = wds_ident(wds_id, component)
        oid = ident_to_oid.get(ident)
        if oid is None:
            continue
        xrefs = oid_xrefs.get(oid, {})
        rows.append({
            "wds_id": wds_id,
            "component": component,
            "simbad_oid": oid,
            "simbad_main_id": xrefs.get("main_id", ""),
            "gaia_source_id": xrefs.get("gaia"),
            "hip": xrefs.get("hip"),
        })
    rows.sort(key=lambda r: (r["wds_id"], r["component"]))

    n_with_gaia = sum(1 for r in rows if r["gaia_source_id"] is not None)
    n_with_hip = sum(1 for r in rows if r["hip"] is not None)
    written = rl.write_tsv(rows, columns=TSV_COLUMNS, output=OUT)
    print(
        f"wrote {OUT.relative_to(ROOT)} with {written:,} rows "
        f"({n_with_gaia:,} Gaia DR3 / {n_with_hip:,} HIP) "
        f"in {(time.time() - start) / 60:.1f}m total"
    )


if __name__ == "__main__":
    main()
