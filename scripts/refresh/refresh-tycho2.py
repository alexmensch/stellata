#!/usr/bin/env python3
"""Refresh data/tycho2/ — Tycho-2 (VizieR I/259) main catalogue and
supplement 1, filtered to the TYCs our designation sources mention.
Two TSVs, one per upstream table."""

from __future__ import annotations

import csv
import sys
import time
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator, Mapping, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "util"))

import refresh_lib as rl  # noqa: E402
from paths import REPO_ROOT  # noqa: E402

ROOT = REPO_ROOT
SPINE = ROOT / "data" / "athyg" / "inherited-spine.tsv"
TYC2_HD = ROOT / "data" / "classic-ids" / "tyc2_hd.tsv"
OUT_DIR = ROOT / "data" / "tycho2"
OUT_MAIN = OUT_DIR / "tycho2_main.tsv"
OUT_SUPPL1 = OUT_DIR / "tycho2_suppl1.tsv"

TYC1_MIN = 1
TYC1_MAX = 9537
TYC1_PER_QUERY = 400

Tyc = tuple[int, int, int]


def parse_tyc(text: str) -> Tyc | None:
    """``"3694-2544-1"`` → ``(3694, 2544, 1)``; None for anything else."""
    parts = text.strip().split("-")
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        return None
    return int(parts[0]), int(parts[1]), int(parts[2])


def format_tyc(tyc: Tyc) -> str:
    return "-".join(str(part) for part in tyc)


def read_spine_tycs(spine: Path) -> set[Tyc]:
    tycs: set[Tyc] = set()
    with spine.open(encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            if tyc := parse_tyc(row.get("tyc") or ""):
                tycs.add(tyc)
    return tycs


def read_mentioned_tycs(spine: Path, tyc2_hd: Path) -> set[Tyc]:
    """The request set: every TYC a designation source names.

    The spine's ``tyc`` column is the membership term; IV/25's own TYCs
    carry the HD-bearing rows the spine could not key, which the
    membership rework needs when it redefines the record set from the
    primaries. Pulling their union once means neither consumer re-pulls.
    """
    tycs = read_spine_tycs(spine)
    with tyc2_hd.open(encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            tycs.add((int(row["tyc1"]), int(row["tyc2"]), int(row["tyc3"])))
    return tycs


class TableSpec:
    """One I/259 table, its column slice, and the gates its pull must pass.

    ``kept_fraction_bounds`` is a band on kept rows as a fraction of the
    mentioned-TYC request set rather than an absolute count, so a spine
    that gains or loses rows moves the gate with it instead of tripping it.
    """

    def __init__(
        self,
        vizier_table: str,
        output: Path,
        column_map: dict[str, str],
        expected_schema: dict[str, type | tuple[type, ...]],
        kept_fraction_bounds: tuple[float, float],
        spot_rows: Sequence[Mapping[str, Any]] = (),
    ) -> None:
        self.vizier_table = vizier_table
        self.output = output
        self.column_map = column_map
        self.expected_schema = expected_schema
        self.kept_fraction_bounds = kept_fraction_bounds
        self.spot_rows = spot_rows

    def adql(self, tyc1_lo: int, tyc1_hi: int) -> str:
        cols = ", ".join(f'"{c}"' for c in self.column_map)
        return (
            f'SELECT {cols} FROM "{self.vizier_table}" '
            f"WHERE TYC1 BETWEEN {tyc1_lo} AND {tyc1_hi}"
        )


# Positions: RAmdeg/DEmdeg are the OBSERVED mean position at the per-star mean
# epochs EpRAm/EpDEm, which is where a propagation to the scene epoch must
# start — RA(ICRS)/DE(ICRS) is Tycho-2's own propagation to J2000 and
# propagating that again compounds its error. RA(ICRS) is carried anyway
# because pflag='X' rows have no mean solution and nothing else to stand on.
MAIN = TableSpec(
    vizier_table="I/259/tyc2",
    output=OUT_MAIN,
    column_map={
        "TYC1": "tyc1",
        "TYC2": "tyc2",
        "TYC3": "tyc3",
        "pflag": "pflag",
        "RAmdeg": "ra_mdeg",
        "DEmdeg": "de_mdeg",
        "EpRAm": "ep_ra",
        "EpDEm": "ep_de",
        "pmRA": "pm_ra",
        "pmDE": "pm_de",
        "e_pmRA": "e_pm_ra",
        "e_pmDE": "e_pm_de",
        "RA(ICRS)": "ra_icrs",
        "DE(ICRS)": "de_icrs",
        "BTmag": "bt_mag",
        "e_BTmag": "e_bt_mag",
        "VTmag": "vt_mag",
        "e_VTmag": "e_vt_mag",
        "prox": "prox",
        "HIP": "hip",
    },
    expected_schema={
        "TYC1": int, "TYC2": int, "TYC3": int, "pflag": str,
        "RAmdeg": float, "DEmdeg": float, "EpRAm": float, "EpDEm": float,
        "pmRA": float, "pmDE": float, "e_pmRA": float, "e_pmDE": float,
        "RA(ICRS)": float, "DE(ICRS)": float,
        "BTmag": float, "e_BTmag": float, "VTmag": float, "e_VTmag": float,
        "prox": int, "HIP": int,
    },
    kept_fraction_bounds=(0.98, 1.0),
    # HD 14039 (Gl 92.1) — the highest-PM row of the 43 TYC-bearing
    # directionAthygPrinted stars, so the tier this ingest replaces and the
    # mean epoch that replaces it are pinned on one row.
    spot_rows=(
        {
            "tyc": "3694-2544-1",
            "RAmdeg": (34.60250679, 1e-6),
            "DEmdeg": (56.55991447, 1e-6),
            "EpRAm": (1991.07, 0.01),
            "EpDEm": (1991.00, 0.01),
            "pmRA": (341.5, 0.05),
            "pmDE": (-223.6, 0.05),
            "VTmag": (8.354, 0.001),
        },
    ),
)

SUPPL1 = TableSpec(
    vizier_table="I/259/suppl_1",
    output=OUT_SUPPL1,
    column_map={
        "TYC1": "tyc1",
        "TYC2": "tyc2",
        "TYC3": "tyc3",
        "flag": "flag",
        "RA(ICRS)": "ra_icrs",
        "DE(ICRS)": "de_icrs",
        "pmRA": "pm_ra",
        "pmDE": "pm_de",
        "e_pmRA": "e_pm_ra",
        "e_pmDE": "e_pm_de",
        "BTmag": "bt_mag",
        "e_BTmag": "e_bt_mag",
        "VTmag": "vt_mag",
        "e_VTmag": "e_vt_mag",
        "prox": "prox",
        "HIP": "hip",
    },
    expected_schema={
        "TYC1": int, "TYC2": int, "TYC3": int, "flag": str,
        "RA(ICRS)": float, "DE(ICRS)": float,
        "pmRA": float, "pmDE": float, "e_pmRA": float, "e_pmDE": float,
        "BTmag": float, "e_BTmag": float, "VTmag": float, "e_VTmag": float,
        "prox": int, "HIP": int,
    },
    kept_fraction_bounds=(0.004, 0.012),
)

TABLES: tuple[TableSpec, ...] = (MAIN, SUPPL1)


def tyc1_ranges(per_query: int = TYC1_PER_QUERY) -> list[tuple[int, int]]:
    """The pull is range-batched over TYC1 and filtered locally because
    VizieR can express no server-side filter on the full identifier: its
    ADQL parser rejects CAST, and without one its Postgres backend
    overflows int32 composing TYC1/TYC2/TYC3 into a single key."""
    return [
        (lo, min(lo + per_query - 1, TYC1_MAX))
        for lo in range(TYC1_MIN, TYC1_MAX + 1, per_query)
    ]


def row_tyc(row: Mapping[str, Any]) -> Tyc:
    return (
        int(rl.coerce_masked(row["TYC1"])),
        int(rl.coerce_masked(row["TYC2"])),
        int(rl.coerce_masked(row["TYC3"])),
    )


def select_mentioned(
    table: Iterable[Mapping[str, Any]], wanted: set[Tyc]
) -> Iterator[tuple[Tyc, Mapping[str, Any]]]:
    for row in table:
        tyc = row_tyc(row)
        if tyc in wanted:
            yield tyc, row


def pull_table(
    spec: TableSpec,
    client: rl.TapClient,
    wanted: set[Tyc],
    *,
    log: Callable[[str], None] = print,
) -> set[Tyc]:
    """Pull, gate and write one table; return the TYCs it reached."""
    kept: dict[Tyc, Mapping[str, Any]] = {}
    ranges = tyc1_ranges()

    def query(batch: Sequence[tuple[int, int]]):
        return client.run(spec.adql(batch[0][0], batch[-1][1]))

    def collect(table) -> None:
        for tyc, row in select_mentioned(table, wanted):
            kept[tyc] = row

    log(f'querying CDS TAP — "{spec.vizier_table}" in {len(ranges)} TYC1 ranges …')
    t0 = time.time()
    rl.run_in_batches(
        ranges,
        1,
        query,
        collect,
        schema=spec.expected_schema,
        schema_label=spec.vizier_table,
        log=log,
    )
    fraction = len(kept) / len(wanted) if wanted else 0.0
    log(
        f"  kept {len(kept)} of {len(wanted)} mentioned TYCs "
        f"({fraction:.2%}) in {time.time() - t0:.1f}s"
    )

    lo, hi = spec.kept_fraction_bounds
    rl.assert_row_count(
        len(kept),
        int(lo * len(wanted)),
        int(hi * len(wanted)),
        f"refresh-tycho2: {spec.vizier_table}",
        hint=(
            f"kept {fraction:.2%} of the mentioned-TYC request set, outside "
            f"[{lo:.1%}, {hi:.1%}] — the request set or the upstream table "
            "has moved; re-measure before re-pinning."
        ),
    )
    if spec.spot_rows:
        rl.validate_spot_rows(
            {format_tyc(tyc): row for tyc, row in kept.items()},
            spec.spot_rows,
            script_name=f"refresh-tycho2/{spec.output.stem}",
            key_field="tyc",
            missing_hint=(
                "missing from the filtered result — a TYC cannot retire, so "
                "this is a request-set or ADQL regression."
            ),
        )

    rows = (
        {
            canonical: rl.coerce_masked(row[vizier])
            for vizier, canonical in spec.column_map.items()
        }
        for _, row in sorted(kept.items())
    )
    written = rl.write_tsv(
        rows, columns=list(spec.column_map.values()), output=spec.output
    )
    log(f"wrote {spec.output.relative_to(ROOT)} ({written} rows)")
    return set(kept)


def assert_spine_covered(
    spine_tycs: set[Tyc], reached: set[Tyc], *, log: Callable[[str], None] = print
) -> None:
    """Every TYC-bearing spine row must reach a Tycho-2 solution.

    The no-Gaia astrometry cascade has no tier below this one for a
    TYC-keyed row, so an unreached spine TYC is a record with no owned
    direction — a § 6 membership adjudication, not a refresh that quietly
    lands short.
    """
    missing = sorted(spine_tycs - reached)
    log(f"spine TYCs reached: {len(spine_tycs) - len(missing)}/{len(spine_tycs)}")
    if missing:
        shown = ", ".join(format_tyc(t) for t in missing[:10])
        raise SystemExit(
            f"refresh-tycho2: {len(missing)} spine TYC(s) reach neither "
            f"I/259 table ({shown}{' …' if len(missing) > 10 else ''}) — "
            "adjudicate as a membership event before committing this pull."
        )


def main() -> None:
    force = "--force" in sys.argv
    sources = [Path(__file__), SPINE, TYC2_HD]
    outputs = [t.output for t in TABLES]
    if not force and all(rl.is_up_to_date(out, sources) for out in outputs):
        print(
            f"{OUT_DIR.relative_to(ROOT)}/*.tsv up to date — skipping "
            "(use --force to rebuild)"
        )
        return

    spine_tycs = read_spine_tycs(SPINE)
    wanted = read_mentioned_tycs(SPINE, TYC2_HD)
    print(
        f"mentioned TYCs: {len(wanted)} "
        f"(spine {len(spine_tycs)} ∪ IV/25 {len(wanted) - len(spine_tycs)} new)"
    )

    client = rl.TapClient(backends=[rl.cds_backend()])
    reached: set[Tyc] = set()
    for spec in TABLES:
        reached |= pull_table(spec, client, wanted)
    assert_spine_covered(spine_tycs, reached)


if __name__ == "__main__":
    main()
