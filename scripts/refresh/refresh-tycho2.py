#!/usr/bin/env python3
"""Refresh data/tycho2/ — Tycho-2 (VizieR I/259) main catalogue and
supplement 1, filtered to the TYCs our designation sources mention.
Two TSVs, one per upstream table."""

from __future__ import annotations

import csv
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator, Mapping, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "util"))

import refresh_lib as rl  # noqa: E402
from paths import REPO_ROOT  # noqa: E402

ROOT = REPO_ROOT
MEMBERSHIP = ROOT / "data" / "membership" / "membership-manifest.tsv"
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


def _display_path(path: Path) -> Path:
    try:
        return path.relative_to(ROOT)
    except ValueError:
        return path


def read_membership_tycs(manifest: Path) -> set[Tyc]:
    tycs: set[Tyc] = set()
    with manifest.open(encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            if tyc := parse_tyc(row.get("tyc") or ""):
                tycs.add(tyc)
    return tycs


def read_mentioned_tycs(manifest: Path, tyc2_hd: Path) -> set[Tyc]:
    """The request set — see data/tycho2/README.md § The request set."""
    tycs = read_membership_tycs(manifest)
    with tyc2_hd.open(encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            tycs.add((int(row["tyc1"]), int(row["tyc2"]), int(row["tyc3"])))
    return tycs


@dataclass(frozen=True)
class TableSpec:
    """One I/259 table, its column slice, and the gates its pull must pass.

    ``kept_fraction_bounds`` bands kept rows as a fraction of the request
    set, so a manifest that gains or loses rows moves the gate with it.
    ``spot_rows`` are keyed on the canonical (post-rename) column names,
    so they pin what actually reaches the TSV.
    """

    vizier_table: str
    output: Path
    column_map: Mapping[str, str]
    expected_schema: Mapping[str, type | tuple[type, ...]]
    kept_fraction_bounds: tuple[float, float]
    spot_rows: Sequence[Mapping[str, Any]] = field(default_factory=tuple)

    def adql(self, tyc1_lo: int, tyc1_hi: int) -> str:
        return (
            f"{rl.select_columns(self.column_map, self.vizier_table)} "
            f"WHERE TYC1 BETWEEN {tyc1_lo} AND {tyc1_hi}"
        )


# RAmdeg/DEmdeg vs RA(ICRS), and why pflag='X' rows need both:
# data/tycho2/README.md § Which position to propagate from.
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
    spot_rows=(
        {
            "tyc": "3694-2544-1",
            "ra_mdeg": (34.60250679, 1e-6),
            "de_mdeg": (56.55991447, 1e-6),
            "ep_ra": (1991.07, 0.01),
            "ep_de": (1991.00, 0.01),
            "pm_ra": (341.5, 0.05),
            "pm_de": (-223.6, 0.05),
            "vt_mag": (8.354, 0.001),
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
    """Contiguous TYC1 scan bands — data/tycho2/README.md § Why the pull
    is range-batched."""
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


def assert_request_scannable(wanted: set[Tyc]) -> None:
    """A TYC1 outside the scanned span is never queried, so without this it
    would join the residual indistinguishable from one Tycho-2 lacks."""
    outside = sorted(t for t in wanted if not TYC1_MIN <= t[0] <= TYC1_MAX)
    if outside:
        shown = ", ".join(format_tyc(t) for t in outside[:10])
        raise SystemExit(
            f"refresh-tycho2: {len(outside)} mentioned TYC(s) fall outside the "
            f"scanned TYC1 span [{TYC1_MIN}, {TYC1_MAX}] ({shown}"
            f"{' …' if len(outside) > 10 else ''}) — widen the span or fix the "
            "request set; they would otherwise be silently unqueried."
        )


def pull_table(
    spec: TableSpec,
    client: rl.TapClient,
    wanted: set[Tyc],
    *,
    log: Callable[[str], None] = print,
) -> dict[Tyc, dict[str, Any]]:
    """Pull one table, run its own gates, and return the canonical rows it
    kept. Writing is the caller's job — every gate, this table's and the
    cross-table manifest cover, must pass before anything lands under data/.
    """
    kept: dict[Tyc, dict[str, Any]] = {}
    ranges = tyc1_ranges()

    def collect(table) -> None:
        for tyc, row in select_mentioned(table, wanted):
            kept[tyc] = {
                canonical: rl.coerce_masked(row[vizier])
                for vizier, canonical in spec.column_map.items()
            }

    log(f'querying CDS TAP — "{spec.vizier_table}" in {len(ranges)} TYC1 ranges …')
    t0 = time.time()
    rl.run_in_batches(
        ranges,
        1,
        lambda batch: client.run(spec.adql(*batch[0])),
        collect,
        schema=spec.expected_schema,
        schema_label=spec.vizier_table,
        log=log,
    )
    fraction = len(kept) / len(wanted)
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
    return kept


def write_table(
    spec: TableSpec,
    kept: Mapping[Tyc, Mapping[str, Any]],
    *,
    log: Callable[[str], None] = print,
) -> int:
    written = rl.write_tsv(
        (row for _, row in sorted(kept.items())),
        columns=list(spec.column_map.values()),
        output=spec.output,
    )
    log(f"wrote {_display_path(spec.output)} ({written} rows)")
    return written


def assert_membership_covered(
    membership_tycs: set[Tyc], reached: set[Tyc], *, log: Callable[[str], None] = print
) -> None:
    """Every TYC-bearing manifest row must reach a Tycho-2 solution — the
    cascade has no tier below this one, so an unreached manifest TYC is a § 6
    membership adjudication rather than a refresh landing short.
    """
    missing = sorted(membership_tycs - reached)
    log(f"manifest TYCs reached: {len(membership_tycs) - len(missing)}/{len(membership_tycs)}")
    if missing:
        shown = ", ".join(format_tyc(t) for t in missing[:10])
        raise SystemExit(
            f"refresh-tycho2: {len(missing)} manifest TYC(s) reach neither "
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

    membership_tycs = read_membership_tycs(SPINE)
    wanted = read_mentioned_tycs(SPINE, TYC2_HD)
    if not wanted:
        raise SystemExit(
            f"refresh-tycho2: {SPINE.relative_to(ROOT)} and "
            f"{TYC2_HD.relative_to(ROOT)} name no TYC between them — the "
            "request set is empty, so there is nothing to pull."
        )
    assert_request_scannable(wanted)
    print(
        f"mentioned TYCs: {len(wanted)} "
        f"(manifest {len(membership_tycs)} ∪ IV/25 {len(wanted) - len(membership_tycs)} new)"
    )

    client = rl.TapClient(backends=[rl.cds_backend()])
    kept = [pull_table(spec, client, wanted) for spec in TABLES]
    assert_membership_covered(membership_tycs, set().union(*kept))
    for spec, rows in zip(TABLES, kept):
        write_table(spec, rows)


if __name__ == "__main__":
    main()
