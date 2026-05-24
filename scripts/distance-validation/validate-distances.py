#!/usr/bin/env python3
"""Distance validation harness — compares the catalogue's Bailer-Jones
override against Vaidman et al. 2025's independent Bayesian distances
for 132 Galactic BA-supergiants. See scripts/distance-validation/README.md."""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path
from typing import NamedTuple, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ADOPTED_BJ_OLD, ADOPTED_EDSD_NEW, read_tsv_rows  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
REF_TSV = ROOT / "data" / "distance-validation" / "vaidman-2025-supergiants.tsv"
BJ_TSV = ROOT / "data" / "bailer-jones" / "bailer-jones-dr3.tsv"

# Acceptance bars on the 119-star EDSD_new subset (see header for rationale).
MEDIAN_FRAC_DIFF_MAX = 0.15
LARGE_DIFF_THRESHOLD = 0.50
LARGE_DIFF_COUNT_MAX = 5

TOP_N_REPORTED = 5


class RefRow(NamedTuple):
    name: str
    gaia_source_id: int | None
    d_bj_paper_pc: float
    d_new_pc: float
    snr_tot: float
    adopted: str


class Disagreement(NamedTuple):
    name: str
    source_id: int
    catalog_pc: float
    paper_pc: float
    frac_diff: float
    snr_tot: float


def fractional_diff(catalog_pc: float, paper_pc: float) -> float:
    """Signed fractional difference (catalog - paper) / paper. Returns NaN
    when `paper_pc` is non-positive (the paper never adopts d<=0, but the
    guard protects against future ingest bugs)."""
    if paper_pc <= 0:
        return math.nan
    return (catalog_pc - paper_pc) / paper_pc


def aggregate_stats(diffs: Sequence[float]) -> dict[str, float]:
    """Median, 84th-percentile, and max of `|diffs|`. NaN inputs (returned
    by `fractional_diff` when paper_pc<=0) are dropped before sorting —
    leaving them in would corrupt the median via Python's undefined NaN
    sort order. Empty input returns NaN for each."""
    abs_diffs = sorted(abs(d) for d in diffs if not math.isnan(d))
    if not abs_diffs:
        return {"median": math.nan, "p84": math.nan, "max": math.nan, "count": 0}
    return {
        "median": _percentile(abs_diffs, 50.0),
        "p84": _percentile(abs_diffs, 84.0),
        "max": abs_diffs[-1],
        "count": len(abs_diffs),
    }


def _percentile(sorted_values: Sequence[float], p: float) -> float:
    """Linear-interpolation percentile on a pre-sorted sequence. p in [0, 100]."""
    if not sorted_values:
        return math.nan
    if len(sorted_values) == 1:
        return sorted_values[0]
    rank = (p / 100.0) * (len(sorted_values) - 1)
    lo = int(math.floor(rank))
    hi = int(math.ceil(rank))
    if lo == hi:
        return sorted_values[lo]
    frac = rank - lo
    return sorted_values[lo] * (1.0 - frac) + sorted_values[hi] * frac


def top_n_disagreements(
    items: Sequence[Disagreement], n: int = TOP_N_REPORTED
) -> list[Disagreement]:
    """Return the N items with the largest |frac_diff|, descending."""
    return sorted(items, key=lambda d: abs(d.frac_diff), reverse=True)[:n]


def read_reference_tsv(path: Path) -> list[RefRow]:
    """Parse vaidman-2025-supergiants.tsv into RefRow tuples. Rows with a
    blank `gaia_source_id` cell are still emitted (gaia_source_id=None)
    so the caller can report unresolved stars rather than silently dropping
    them — the build step is supposed to hard-fail on unresolved names,
    so seeing one here means someone hand-edited the TSV."""
    rows: list[RefRow] = []
    for row in read_tsv_rows(path):
        sid_cell = row["gaia_source_id"]
        rows.append(
            RefRow(
                name=row["name"],
                gaia_source_id=int(sid_cell) if sid_cell else None,
                d_bj_paper_pc=float(row["d_bj_paper_pc"]),
                d_new_pc=float(row["d_new_pc"]),
                snr_tot=float(row["snr_tot"]),
                adopted=row["adopted"],
            )
        )
    return rows


def read_bailer_jones_tsv(path: Path) -> dict[int, float]:
    """Parse data/bailer-jones/bailer-jones-dr3.tsv into a
    {source_id: r_med_photogeo} dict. Skips rows where r_med_photogeo is
    masked — Bailer-Jones leaves the photogeo posterior blank for stars
    that fail their photometric joint fit and the TSV carries those cells
    as the astropy "--" sentinel."""
    out: dict[int, float] = {}
    for row in read_tsv_rows(path):
        dist_cell = row["r_med_photogeo"]
        if not dist_cell or dist_cell == "--":
            continue
        out[int(row["source_id"])] = float(dist_cell)
    return out


class ValidationReport(NamedTuple):
    """Computed product of one validation run; pure construction so tests can
    snapshot it without going through `format_report` or stdout."""
    edsd_total: int
    edsd_compared: int
    edsd_unresolved: list[str]
    edsd_stats: dict[str, float]
    edsd_large: list[Disagreement]
    edsd_top: list[Disagreement]
    bj_total: int
    bj_compared: int
    bj_unresolved: list[str]
    bj_stats: dict[str, float]
    bj_top: list[Disagreement]


def build_report(
    refs: Sequence[RefRow], bj: dict[int, float]
) -> ValidationReport:
    """Pure: join refs against the B-J distance map and compute the per-
    subset statistics. No I/O, no exit codes — the caller renders the
    report and decides pass/fail."""
    edsd_total = sum(1 for r in refs if r.adopted == ADOPTED_EDSD_NEW)
    bj_total = sum(1 for r in refs if r.adopted == ADOPTED_BJ_OLD)

    edsd_diffs: list[Disagreement] = []
    edsd_unresolved: list[str] = []
    bj_diffs: list[Disagreement] = []
    bj_unresolved: list[str] = []

    for row in refs:
        is_edsd = row.adopted == ADOPTED_EDSD_NEW
        unresolved = edsd_unresolved if is_edsd else bj_unresolved
        diffs = edsd_diffs if is_edsd else bj_diffs
        if row.gaia_source_id is None:
            unresolved.append(row.name)
            continue
        catalog_pc = bj.get(row.gaia_source_id)
        if catalog_pc is None:
            unresolved.append(row.name)
            continue
        paper_pc = row.d_new_pc if is_edsd else row.d_bj_paper_pc
        diffs.append(Disagreement(
            name=row.name,
            source_id=row.gaia_source_id,
            catalog_pc=catalog_pc,
            paper_pc=paper_pc,
            frac_diff=fractional_diff(catalog_pc, paper_pc),
            snr_tot=row.snr_tot,
        ))

    edsd_stats = aggregate_stats([d.frac_diff for d in edsd_diffs])
    bj_stats = aggregate_stats([d.frac_diff for d in bj_diffs])
    edsd_large = [d for d in edsd_diffs if abs(d.frac_diff) > LARGE_DIFF_THRESHOLD]
    return ValidationReport(
        edsd_total=edsd_total,
        edsd_compared=len(edsd_diffs),
        edsd_unresolved=edsd_unresolved,
        edsd_stats=edsd_stats,
        edsd_large=edsd_large,
        edsd_top=top_n_disagreements(edsd_diffs),
        bj_total=bj_total,
        bj_compared=len(bj_diffs),
        bj_unresolved=bj_unresolved,
        bj_stats=bj_stats,
        bj_top=top_n_disagreements(bj_diffs),
    )


def passes_acceptance_bars(report: ValidationReport) -> bool:
    """Acceptance bars apply to the EDSD_new subset only; BJ_old is
    report-only per the bead."""
    median = report.edsd_stats["median"]
    if math.isnan(median) or median > MEDIAN_FRAC_DIFF_MAX:
        return False
    if len(report.edsd_large) > LARGE_DIFF_COUNT_MAX:
        return False
    return True


def format_report(report: ValidationReport) -> str:
    """Human-readable + grep-friendly report. The headline `validate-distances:`
    lines on stdout are stable identifiers for CI / shell-scripting downstream."""
    lines: list[str] = []
    lines.append(
        f"validate-distances: EDSD_new subset — compared "
        f"{report.edsd_compared}/{report.edsd_total} "
        f"(median |frac diff|={_pct(report.edsd_stats['median'])}, "
        f"p84={_pct(report.edsd_stats['p84'])}, "
        f"max={_pct(report.edsd_stats['max'])})"
    )
    if report.edsd_unresolved:
        lines.append(
            f"validate-distances: EDSD_new unresolved ({len(report.edsd_unresolved)}): "
            f"{', '.join(report.edsd_unresolved)}"
        )
    lines.append(
        f"validate-distances: EDSD_new |frac diff|>50%: {len(report.edsd_large)} "
        f"(bar ≤ {LARGE_DIFF_COUNT_MAX})"
    )
    lines.append(
        f"validate-distances: EDSD_new top-{TOP_N_REPORTED} disagreements:"
    )
    for d in report.edsd_top:
        lines.append(f"    {_format_disagreement(d)}")

    lines.append("")
    lines.append(
        f"validate-distances: BJ_old subset (report-only) — compared "
        f"{report.bj_compared}/{report.bj_total} "
        f"(median |frac diff|={_pct(report.bj_stats['median'])}, "
        f"max={_pct(report.bj_stats['max'])})"
    )
    if report.bj_unresolved:
        lines.append(
            f"validate-distances: BJ_old unresolved ({len(report.bj_unresolved)}): "
            f"{', '.join(report.bj_unresolved)}"
        )
    for d in report.bj_top:
        lines.append(f"    {_format_disagreement(d)}")
    return "\n".join(lines)


def _pct(x: float) -> str:
    if math.isnan(x):
        return "n/a"
    return f"{x*100:.2f}%"


def _format_disagreement(d: Disagreement) -> str:
    return (
        f"{d.name:<14} gaia={d.source_id}  "
        f"catalog={d.catalog_pc:>9.2f}pc  paper={d.paper_pc:>9.2f}pc  "
        f"frac diff={d.frac_diff*100:+6.1f}%  SNR={d.snr_tot:.2f}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument(
        "--ref",
        type=Path,
        default=REF_TSV,
        help="Path to vaidman-2025-supergiants.tsv.",
    )
    parser.add_argument(
        "--bj",
        type=Path,
        default=BJ_TSV,
        help="Path to data/bailer-jones/bailer-jones-dr3.tsv.",
    )
    args = parser.parse_args()

    if not args.ref.exists():
        print(f"validate-distances: reference TSV missing at {args.ref}", file=sys.stderr)
        return 1
    if not args.bj.exists():
        print(f"validate-distances: Bailer-Jones TSV missing at {args.bj}", file=sys.stderr)
        return 1

    refs = read_reference_tsv(args.ref)
    bj = read_bailer_jones_tsv(args.bj)
    report = build_report(refs, bj)
    print(format_report(report))
    if not passes_acceptance_bars(report):
        median = report.edsd_stats["median"]
        print(
            f"validate-distances: FAIL — median {_pct(median)} > {_pct(MEDIAN_FRAC_DIFF_MAX)} "
            f"OR large-diff count {len(report.edsd_large)} > {LARGE_DIFF_COUNT_MAX}",
            file=sys.stderr,
        )
        return 1
    print("validate-distances: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
