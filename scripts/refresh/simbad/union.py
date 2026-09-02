"""The value-keyed union pass: ask every namespace a row reaches wherever
no object it already bound carries the value.
See README.md § The union asks every namespace a record reaches."""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import refresh_lib as rl  # noqa: E402

from . import coverage, query
from .inputs import RowFilter, row_designations
from .specs import ColumnSpec, GAIA_DR3, IdentLookup, WIDENING_LADDER


#: Namespaces in the order `SIMBAD_NAMESPACE_VALUES` walks them
#: (`scripts/catalog/catalog-pure.ts`) — the ORDER IS NOT LOAD-BEARING here.
#: The pull unions and the record build orders: every namespace that answers
#: ships its row, and the read side's ladder decides which one a record takes,
#: so nothing about the request may pick a winner between them.
UNION_NAMESPACES: tuple[IdentLookup, ...] = (GAIA_DR3, *WIDENING_LADDER)


@dataclass
class UnionReport:
    """What the union asked and what it recovered. Every count is printed:
    the pass adds rows to a frozen table, so its reach has to be reviewable
    rather than inferred from the diff."""

    rows: int = 0
    answered: int = 0
    unanswered: int = 0
    with_unasked_namespace: int = 0
    requested: dict[str, int] = field(default_factory=dict)
    resolved: dict[str, int] = field(default_factory=dict)
    with_value: dict[str, int] = field(default_factory=dict)
    rows_recovered: int = 0
    oids_added: int = 0

    def report_lines(self) -> list[str]:
        lines = [
            f"      spine rows probed: {self.rows}; {self.answered} answered by "
            f"a bound object, {self.unanswered} not "
            f"({self.with_unasked_namespace} of those carrying a namespace the "
            f"request never asked)",
        ]
        for name in self.requested:
            lines.append(
                f"  {name:14s} asked {self.requested[name]:7d} → resolved "
                f"{self.resolved.get(name, 0):7d}, of which "
                f"{self.with_value.get(name, 0):7d} carry the value"
            )
        lines.append(
            f"      recovered {self.rows_recovered} spine rows on "
            f"{self.oids_added} added objects"
        )
        return lines


def _row_keys(row: Mapping[str, str]) -> dict[str, int | str]:
    """Every namespace this spine row can be asked under, Gaia included."""
    keys = dict(row_designations(row))
    if source_id := row[rl.SPINE_SOURCE_ID_COLUMN].strip():
        keys[GAIA_DR3.tsv_name] = int(source_id)
    return keys


def _unanswered(
    spine_path: Path,
    bindings: Mapping[str, Mapping[int | str, int]],
    answered_oids: frozenset[int],
    row_filter: RowFilter | None,
    report: UnionReport,
) -> list[dict[str, int | str]]:
    """Per-row key sets for every spine row no bound object answers, with
    the namespaces already bound dropped — those have been asked and their
    answer is the absence this pass exists to fill."""
    out: list[dict[str, int | str]] = []
    for row in rl.iter_spine_rows(spine_path):
        if row_filter is not None and not row_filter(row):
            continue
        report.rows += 1
        keys = _row_keys(row)
        bound = [
            oid for name, key in keys.items()
            if (oid := bindings.get(name, {}).get(key)) is not None
        ]
        if any(oid in answered_oids for oid in bound):
            report.answered += 1
            continue
        report.unanswered += 1
        unasked = {
            name: key for name, key in keys.items()
            if key not in bindings.get(name, {})
        }
        if unasked:
            report.with_unasked_namespace += 1
            out.append(unasked)
    return out


def union_unanswered(
    client: rl.TapClient,
    *,
    spine_path: Path,
    bindings: Mapping[str, Mapping[int | str, int]],
    rows: Mapping[int, Mapping[str, Any]],
    columns: Sequence[ColumnSpec],
    value_alias: str,
    row_filter: RowFilter | None = None,
) -> tuple[dict[int, dict[str, Any]], dict[str, dict[int | str, int]], UnionReport]:
    """Ask every namespace an unanswered spine row reaches, and return the
    basic-table rows of the objects that answer.

    ``bindings`` is Phase A's per-namespace {key: oid}; ``rows`` is Phase B's
    {oid: cells}. A namespace already bound is not re-asked — it has
    answered, with the absence of a value. Objects the pass finds but whose
    ``value_alias`` cell is empty are dropped: they would add a row to the
    table that says nothing and, keyed under the same identifiers, would
    collide with one that does.
    """
    report = UnionReport()
    answered = frozenset(
        oid for oid, cells in rows.items() if coverage.is_filled(cells, value_alias)
    )
    unanswered = _unanswered(spine_path, bindings, answered, row_filter, report)
    if not unanswered:
        return {}, {}, report

    found: dict[int, dict[str, Any]] = {}
    # The union's own bindings: a row is recovered through the key THIS pass
    # asked under, which Phase A by definition never bound.
    added: dict[str, dict[int | str, int]] = {}
    for lookup in UNION_NAMESPACES:
        asked = sorted({
            keys[lookup.tsv_name] for keys in unanswered
            if lookup.tsv_name in keys
        })
        report.requested[lookup.tsv_name] = len(asked)
        if not asked:
            report.resolved[lookup.tsv_name] = 0
            report.with_value[lookup.tsv_name] = 0
            continue
        resolved = query.resolve_oids_by_prefix(
            client, asked, lookup,
            progress_label=f"{lookup.tsv_name} union",
        )
        report.resolved[lookup.tsv_name] = len(resolved)
        fresh = sorted(set(resolved.values()) - rows.keys() - found.keys())
        pulled = query.fetch_basic_columns(
            client, fresh, columns,
            progress_label=f"{lookup.tsv_name} union basic",
        ) if fresh else {}
        kept = {
            oid: cells for oid, cells in pulled.items()
            if coverage.is_filled(cells, value_alias)
        }
        found.update(kept)
        report.with_value[lookup.tsv_name] = len(kept)
        # A later namespace need not re-ask a row this one just answered.
        bound_now = {
            key for key, oid in resolved.items() if oid in kept
        }
        added.setdefault(lookup.tsv_name, {}).update(
            {key: resolved[key] for key in bound_now}
        )
        unanswered = [
            keys for keys in unanswered
            if keys.get(lookup.tsv_name) not in bound_now
        ]

    report.oids_added = len(found)
    report.rows_recovered = _count_recovered(spine_path, added, found, row_filter)
    return found, added, report


def _count_recovered(
    spine_path: Path,
    added: Mapping[str, Mapping[int | str, int]],
    found: Mapping[int, Mapping[str, Any]],
    row_filter: RowFilter | None,
) -> int:
    """Spine rows an added object now answers. Counted by a second walk
    rather than accumulated in the loop above: several rows can share one
    added object, and one row can be reached by several, so the count that
    matters is over rows and not over bindings."""
    reachable: dict[str, set[int | str]] = {}
    for name, keyed in added.items():
        reachable[name] = {key for key, oid in keyed.items() if oid in found}
    recovered = 0
    for row in rl.iter_spine_rows(spine_path):
        if row_filter is not None and not row_filter(row):
            continue
        keys = _row_keys(row)
        if any(key in reachable.get(name, ()) for name, key in keys.items()):
            recovered += 1
    return recovered


def merge_rows(
    rows: dict[int, dict[str, Any]],
    added: Mapping[int, Mapping[str, Any]],
) -> list[int]:
    """Fold the union's rows into Phase B's and return the full sorted oid
    list. The two never overlap — the union pulls only oids Phase B missed —
    so this is a plain update rather than a precedence question."""
    for oid, cells in added.items():
        rows[oid] = dict(cells)
    return sorted(rows)


def iter_recovered_rows(
    spine_path: Path,
    added: Mapping[str, Mapping[int | str, int]],
    found: Mapping[int, Mapping[str, Any]],
    value_alias: str,
) -> Iterable[tuple[Mapping[str, str], str, str]]:
    """(spine row, namespace, value) for each row an added object answers —
    the enumeration a review reads instead of a count."""
    reachable: dict[str, dict[int | str, int]] = {
        name: {key: oid for key, oid in keyed.items() if oid in found}
        for name, keyed in added.items()
    }
    for row in rl.iter_spine_rows(spine_path):
        keys = _row_keys(row)
        for name, key in keys.items():
            oid = reachable.get(name, {}).get(key)
            if oid is not None:
                yield row, name, str(found[oid].get(value_alias) or "")
                break
