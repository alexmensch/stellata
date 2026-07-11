#!/usr/bin/env python3
"""Spot-check harness (npm run test:spotcheck) — asserts Stage 2
resolution against data/binaries/spot_check_ground_truth.tsv."""

from __future__ import annotations

import csv
import sys
from dataclasses import dataclass
from pathlib import Path

SCRIPT = Path(__file__).resolve()
sys.path.insert(0, str(SCRIPT.parent.parent))
from test_helpers import load_kebab_sibling  # noqa: E402

bb = load_kebab_sibling(str(SCRIPT), "build_binaries", "build-binaries.py")

GROUND_TRUTH = bb.DATA / "binaries" / "spot_check_ground_truth.tsv"

# Sentinel expected_resolve_via: Stage 2 emits NO component for the
# (wds_id, component) at all. Every other value must be a member of
# RESOLVE_VIA_VALUES.
EXPECTED_ABSENT = "absent"

KNOWN_BUG_PREFIX = "known_bug:"


@dataclass
class TruthRow:
    category: str
    name: str
    wds_id: str
    component: str
    expected_via: str
    expected_gaia: int | None
    note: str


def read_ground_truth(path: Path) -> list[TruthRow]:
    rows: list[TruthRow] = []
    with path.open(newline="") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            via = r["expected_resolve_via"].strip()
            if via != EXPECTED_ABSENT and via not in bb.RESOLVE_VIA_VALUES:
                raise ValueError(
                    f"{r['name']}: expected_resolve_via '{via}' is neither "
                    f"'{EXPECTED_ABSENT}' nor a RESOLVE_VIA_VALUES member"
                )
            gaia = r["expected_gaia_source_id"].strip()
            rows.append(TruthRow(
                category=r["category"].strip(),
                name=r["name"].strip(),
                wds_id=r["wds_id"].strip(),
                component=r["component"].strip(),
                expected_via=via,
                expected_gaia=int(gaia) if gaia else None,
                note=r["note"].strip(),
            ))
    return rows


def strongest_components(
    components: list,
) -> dict[tuple[str, str], object]:
    """The strongest-priority ResolvedComponent per (wds_id, component) —
    multiple pair rows resolve the same letter through different tiers;
    the canonical answer is the best one."""
    best: dict[tuple[str, str], object] = {}
    for c in components:
        key = (c.wds_id, c.component)
        prev = best.get(key)
        if prev is None or (
            bb.RESOLVE_VIA_PRIORITY[c.resolve_via]
            < bb.RESOLVE_VIA_PRIORITY[prev.resolve_via]
        ):
            best[key] = c
    return best


def check_row(row: TruthRow, best: dict) -> list[str]:
    """Mismatch descriptions for one ground-truth row (empty = pass).
    resolve_via and gaia_source_id mismatches report separately so a
    tier drift and an id drift are distinguishable at a glance."""
    got = best.get((row.wds_id, row.component))
    problems: list[str] = []
    if row.expected_via == EXPECTED_ABSENT:
        if got is not None:
            problems.append(
                f"expected NO component, got "
                f"({got.gaia_source_id}, {got.resolve_via})"
            )
        return problems
    if got is None:
        problems.append(
            f"expected ({row.expected_gaia}, {row.expected_via}), "
            f"got no component at all"
        )
        return problems
    if got.resolve_via != row.expected_via:
        problems.append(
            f"resolve_via: expected {row.expected_via}, "
            f"got {got.resolve_via}"
        )
    if got.gaia_source_id != row.expected_gaia:
        problems.append(
            f"gaia_source_id: expected {row.expected_gaia}, "
            f"got {got.gaia_source_id}"
        )
    return problems


def main() -> int:
    truth = read_ground_truth(GROUND_TRUTH)
    s2 = bb.resolve_through_stage2()
    best = strongest_components(s2.components)

    failures: list[tuple[TruthRow, list[str]]] = []
    for row in truth:
        problems = check_row(row, best)
        if problems:
            failures.append((row, problems))

    for row, problems in failures:
        for p in problems:
            print(f"[{row.category}] {row.name} ({row.wds_id} {row.component}) — {p}")
        if row.note.startswith(KNOWN_BUG_PREFIX):
            print(f"    note: {row.note}")

    n_pass = len(truth) - len(failures)
    print(f"{n_pass}/{len(truth)} assertions passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
