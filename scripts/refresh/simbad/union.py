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
from .request import CorroborationVerdicts, corroborate
from .specs import ColumnSpec, GAIA_DR3, IdentLookup, WIDENING_LADDER


#: The namespaces a union rung may ask. The ORDER IS NOT LOAD-BEARING: the
#: pull unions and the record build orders, so every namespace that answers
#: ships its row and the read side's ladder decides which one a record takes.
#: Gaia is absent — a source_id reaches this pass only when Phase A already
#: failed to resolve it (README.md § Why the union asks no Gaia rung).
UNION_NAMESPACES: tuple[IdentLookup, ...] = WIDENING_LADDER


@dataclass(frozen=True)
class UnansweredRow:
    """One spine row no bound object answers: the namespaces its request
    never asked, and the row's own Gaia id — the only thing SIMBAD's
    cross-IDs can be adjudicated against."""

    unasked: Mapping[str, int | str]
    source_id: int | None


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
    verdicts: dict[str, CorroborationVerdicts] = field(default_factory=dict)
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
                f"  {name:14s} asked {self.requested[name]:7d} → bound "
                f"{self.resolved.get(name, 0):7d}, of which "
                f"{self.with_value.get(name, 0):7d} added a row carrying the value"
            )
            verdict = self.verdicts.get(name)
            if verdict is not None:
                lines.append(
                    f"  {'':14s} of those bindings: {verdict.corroborated} "
                    f"corroborated by a Gaia cross-ID, {verdict.vetoed} vetoed "
                    f"on a contradicting DR3 id, {verdict.uncorroborated} kept "
                    f"with no DR3 id to contradict them"
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
) -> list[UnansweredRow]:
    """Every spine row no bound object answers, with the namespaces already
    bound dropped — those have been asked and their answer is the absence
    this pass exists to fill."""
    askable = {lookup.tsv_name for lookup in UNION_NAMESPACES}
    out: list[UnansweredRow] = []
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
            if name in askable and key not in bindings.get(name, {})
        }
        if unasked:
            report.with_unasked_namespace += 1
            source_id = keys.get(GAIA_DR3.tsv_name)
            out.append(UnansweredRow(
                unasked=unasked,
                source_id=int(source_id) if source_id is not None else None,
            ))
    return out


def _asking_ids(
    unanswered: Sequence[UnansweredRow], lookup: IdentLookup
) -> dict[int | str, int | None]:
    """{designation: the one Gaia id asking under it}. A designation two
    source_ids both claim has no single asking id, so nothing can contradict
    it and it stands uncorroborated rather than being adjudicated against an
    arbitrary one of them."""
    claims: dict[int | str, set[int]] = {}
    for row in unanswered:
        key = row.unasked.get(lookup.tsv_name)
        if key is None:
            continue
        claimed = claims.setdefault(key, set())
        if row.source_id is not None:
            claimed.add(row.source_id)
    return {
        key: next(iter(ids)) if len(ids) == 1 else None
        for key, ids in claims.items()
    }


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
    basic-table rows of the objects that answer plus the bindings that
    reached them.

    ``bindings`` is Phase A's per-namespace {key: oid}; ``rows`` is Phase B's
    {oid: cells}. A namespace already bound is not re-asked — it has
    answered, with the absence of a value. Every binding this pass makes rests
    on a designation alone, so it goes through the same corroboration rule the
    widening ladder applies before it may carry a value. An object that
    survives that but whose ``value_alias`` cell is empty is dropped: it would
    add a row saying nothing and, keyed under the same identifiers, would
    collide with one that does.
    """
    report = UnionReport()
    answered = frozenset(
        oid for oid, cells in rows.items() if coverage.is_filled(cells, value_alias)
    )
    probed = _unanswered(spine_path, bindings, answered, row_filter, report)
    if not probed:
        return {}, {}, report
    unanswered = probed

    found: dict[int, dict[str, Any]] = {}
    # The union's own bindings: a row is recovered through the key THIS pass
    # asked under, which Phase A by definition never bound.
    added: dict[str, dict[int | str, int]] = {}
    # Every oid this pass established as carrying the value, whether it had to
    # be pulled or Phase B already held it. `found` is the pull; this is the
    # answer, and it is what a binding has to reach to count as a recovery.
    answering: set[int] = set()
    for lookup in UNION_NAMESPACES:
        asked = sorted({
            row.unasked[lookup.tsv_name] for row in unanswered
            if lookup.tsv_name in row.unasked
        })
        report.requested[lookup.tsv_name] = len(asked)
        report.resolved[lookup.tsv_name] = 0
        report.with_value[lookup.tsv_name] = 0
        if not asked:
            continue
        resolved, verdicts = corroborate(
            client,
            query.resolve_oids_by_prefix(
                client, asked, lookup,
                progress_label=f"{lookup.tsv_name} union",
            ),
            _asking_ids(unanswered, lookup),
            progress_label=f"{lookup.tsv_name} union corroboration",
        )
        report.resolved[lookup.tsv_name] = len(resolved)
        report.verdicts[lookup.tsv_name] = verdicts
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
        answering |= set(kept) | (set(resolved.values()) & answered)
        # A later namespace need not re-ask a row this one just answered.
        bound_now = {key for key, oid in resolved.items() if oid in answering}
        added.setdefault(lookup.tsv_name, {}).update(
            {key: resolved[key] for key in bound_now}
        )
        unanswered = [
            row for row in unanswered
            if row.unasked.get(lookup.tsv_name) not in bound_now
        ]

    report.oids_added = len(found)
    # Counted over the rows this pass PROBED, not over the spine: a row a
    # bound object already answered can share a designation with one of these
    # bindings without ever having needed it.
    report.rows_recovered = sum(
        1 for row in probed
        if any(added.get(name, {}).get(key) is not None
               for name, key in row.unasked.items())
    )
    return found, added, report


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
    *,
    row_filter: RowFilter | None = None,
) -> Iterable[tuple[Mapping[str, str], str, int]]:
    """(spine row, namespace, oid) for each spine row a union binding answers
    — the sample a review reads instead of a count. Walks the spine because
    the whole row is what a reader recognises a star by; `rows_recovered` is
    the exact figure and is counted over the probed rows alone.
    """
    for row in rl.iter_spine_rows(spine_path):
        if row_filter is not None and not row_filter(row):
            continue
        for name, key in _row_keys(row).items():
            oid = added.get(name, {}).get(key)
            if oid is not None:
                yield row, name, oid
                break
