"""Fill counting and floor gates over the {oid: {alias: value}} rows a
basic-table or flux pull returns — Phase E of every SIMBAD shell."""

from __future__ import annotations

from typing import Any, Callable, Mapping


Rows = Mapping[int, Mapping[str, Any]]


def is_filled(cells: Mapping[str, Any], key: str) -> bool:
    """A cell counts as filled when it is neither None nor blank. SIMBAD
    returns both for an absent value depending on the column's type, so
    every fill count has to test both."""
    value = cells.get(key)
    return value is not None and str(value).strip() != ""


def count_filled(rows: Rows, key: str) -> int:
    return sum(1 for cells in rows.values() if is_filled(cells, key))


def report_fill(
    label: str,
    rows: Rows,
    key: str,
    total: int,
    *,
    log: Callable[[str], None] = print,
) -> int:
    filled = count_filled(rows, key)
    log(f"  {label:16s} {filled:6d}/{total} = {filled/max(1, total):6.1%}")
    return filled


def assert_floor(
    name: str, fraction: float, floor: float, *, script: str, diagnosis: str
) -> None:
    """Fail the pull when a fill lands below its floor. Every SIMBAD gate
    reads the same way: the floor catches a drifted response shape, not a
    sparse cohort, so it exits rather than pinning a shrunken pull."""
    if fraction < floor:
        raise SystemExit(
            f"{script}: {name} {fraction:.1%} below floor {floor:.0%} — "
            f"{diagnosis}; investigate before pinning."
        )
