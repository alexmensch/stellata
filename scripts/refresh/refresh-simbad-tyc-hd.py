#!/usr/bin/env python3
"""Refresh data/simbad/simbad_tyc_hd.tsv — SIMBAD's own HD identification per
Tycho-2 entry, keyed on TYC, as a witness independent of IV/25."""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "util"))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import refresh_lib as rl  # noqa: E402
from paths import REPO_ROOT  # noqa: E402
from simbad import query, source_files  # noqa: E402
from simbad.specs import HD, MAIN_ID, OID, TYC  # noqa: E402

ROOT = REPO_ROOT
OUT = ROOT / "data" / "simbad" / "simbad_tyc_hd.tsv"

TSV_COLUMNS = ["tyc", "simbad_oid", "simbad_main_id", "hd"]

BASIC_COLUMNS = (OID, MAIN_ID)

# Written rows are the requested TYCs SIMBAD resolves AND holds an HD for, so
# the band tracks that intersection rather than either input's size. Measured
# 2026-09-09 (see data/simbad/README.md § The TYC to HD pull); the width
# absorbs SIMBAD curation drift without admitting a collapsed request set.
ROW_COUNT_LOW = 300_000
ROW_COUNT_HIGH = 380_000

# Pinned rows, all verified against live SIMBAD 2026-09-09. Every one is a
# close pair whose two Tycho entries carry adjacent HD numbers — the shape the
# whole table exists to adjudicate — so a drift here is the pull losing the
# only rows its consumers read.
SPOT_ROWS = (
    {"tyc": "7570-1585-1", "hd": "24072", "simbad_main_id": "* f Eri A"},
    {"tyc": "7570-1586-1", "hd": "24071", "simbad_main_id": "* f Eri B"},
    {"tyc": "5675-662-1", "hd": "164765", "simbad_main_id": "* tau Oph A"},
    {"tyc": "5675-662-2", "hd": "164764", "simbad_main_id": "* tau Oph B"},
    {"tyc": "40-1338-1", "hd": "12447", "simbad_main_id": "* alf Psc A"},
    {"tyc": "2019-1250-1", "hd": "129988", "simbad_main_id": "* eps Boo B"},
    {"tyc": "7902-891-1", "hd": "170867", "simbad_main_id": "* kap02 CrA"},
    {"tyc": "7902-1905-1", "hd": "170868", "simbad_main_id": "* kap01 CrA"},
)


def read_tyc_request(
    manifest: Path = rl.MEMBERSHIP_MANIFEST, iv25: Path = rl.TYC2_HD_CROSS_INDEX
) -> list[str]:
    """Every Tycho entry the manifest or IV/25 names, as `1-381-1` keys.

    IV/25 alone is what the bead scoped, and it is not enough: 19,288 manifest
    TYCs are absent from it, and a record whose own TYC the table cannot
    answer for is exactly the row a consumer needs adjudicated. Shared with
    `refresh-tycho2.py` rather than restated, so the two pulls cover the same
    entries by construction.
    """
    return sorted(rl.format_tyc(t) for t in rl.read_mentioned_tycs(manifest, iv25))


def hd_sort_key(ident: str) -> tuple[int, str]:
    """Order an HD ident by its number, then by the whole suffix so a bare
    number precedes its component-lettered forms. A suffix with no leading
    integer sorts first and keeps its relative order."""
    lead = ""
    for ch in ident:
        if not ch.isdigit():
            break
        lead += ch
    return (int(lead) if lead else -1, ident)


def compose_rows(
    tycs: list[str],
    oid_by_tyc: dict[str | int, int],
    hd_by_oid: dict[int, dict[str, set[str | int]]],
    basic_by_oid: dict[int, dict[str, object]],
) -> list[dict[str, object]]:
    """One row per requested TYC that resolved AND holds an HD.

    A TYC SIMBAD does not hold, and one whose object carries no HD ident, both
    ship nothing: the table answers "which HD does SIMBAD give this Tycho
    entry", and a row asserting no HD would read as an answer. The per-TYC
    coverage a consumer needs is `absent from this table`, which is cheaper to
    state than to store.

    `hd` is `|`-separated, because an object holding two HD idents is the
    signal rather than the exception here — an unresolved pair's entry carries
    both components' numbers, and picking one would destroy the very ambiguity
    a consumer is asking about. Ordered by HD NUMBER, then by the ident's own
    suffix, so a pair's two numbers read adjacently whatever their digit
    widths: a lexical sort puts `287782` before `35068`, which reads as a
    ranking the file does not mean.
    """
    rows: list[dict[str, object]] = []
    for tyc in tycs:
        oid = oid_by_tyc.get(tyc)
        if oid is None:
            continue
        suffixes = hd_by_oid.get(oid, {}).get(HD.tsv_name) or set()
        if not suffixes:
            continue
        rows.append({
            "tyc": tyc,
            "simbad_oid": oid,
            "simbad_main_id": basic_by_oid.get(oid, {}).get(MAIN_ID.alias) or "",
            "hd": "|".join(sorted((str(s) for s in suffixes), key=hd_sort_key)),
        })
    return rows


def main() -> None:
    force = "--force" in sys.argv
    sources = [
        Path(__file__),
        Path(rl.__file__),
        rl.TYC2_HD_CROSS_INDEX,
        rl.MEMBERSHIP_MANIFEST,
        *source_files(),
    ]
    if not force and rl.is_up_to_date(OUT, sources):
        print(
            f"{OUT.relative_to(ROOT)} up to date — skipping (use --force to rebuild)"
        )
        return

    start = time.time()
    tycs = read_tyc_request()
    print(f"request set: {len(tycs):,} Tycho ids (IV/25 union the manifest)")

    client = rl.TapClient(backends=[rl.simbad_backend()])

    oid_by_tyc = query.resolve_oids_by_prefix(client, tycs, TYC)
    print(
        f"resolved {len(oid_by_tyc):,}/{len(tycs):,} "
        f"({len(oid_by_tyc) / len(tycs):.1%}) to a SIMBAD oid"
    )

    oids = sorted(set(oid_by_tyc.values()))
    hd_by_oid = query.fetch_ident_sets(client, oids, [HD], progress_label="HD idents")
    basic_by_oid = query.fetch_basic_columns(client, oids, BASIC_COLUMNS)

    rows = compose_rows(tycs, oid_by_tyc, hd_by_oid, basic_by_oid)
    rl.assert_row_count(
        len(rows), ROW_COUNT_LOW, ROW_COUNT_HIGH, "simbad_tyc_hd",
        hint=(
            "SIMBAD's TYC or HD ident coverage moved, or the request set "
            "collapsed — check the resolve percentage above before re-pinning."
        ),
    )
    rl.validate_spot_rows(
        {r["tyc"]: r for r in rows}, SPOT_ROWS,
        script_name="refresh-simbad-tyc-hd", key_field="tyc",
        missing_hint=(
            "missing from the composed rows — a Tycho identifier cannot "
            "retire, so this is the pull losing coverage."
        ),
    )

    multi = sum(1 for r in rows if "|" in str(r["hd"]))
    written = rl.write_tsv(rows, columns=TSV_COLUMNS, output=OUT)
    print(
        f"wrote {OUT.relative_to(ROOT)} with {written:,} rows "
        f"({multi:,} carrying more than one HD) "
        f"in {(time.time() - start) / 60:.1f}m total"
    )


if __name__ == "__main__":
    main()
