"""Iterators and cohort predicates that read project data files and yield
identifier streams ready to feed into query.resolve_oids_by_prefix or the
orchestration shell's oid request set."""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterator, Mapping

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import refresh_lib as rl  # noqa: E402

from .specs import GJ, HIP, TYC, WIDENING_LADDER


TableRow = Mapping[str, str]
RowFilter = Callable[[TableRow], bool]


@dataclass
class MembershipRequestKeys:
    """Membership rows partitioned by the SIMBAD ident prefix each is looked up
    under. A row contributes exactly one key, so the four lists sum to the
    cohort's row count minus the rows carrying no usable key at all.

    ``designations_by_source_id`` rides along from the same pass: for each
    source_id-keyed row it carries every OTHER namespace that row can be
    asked under, keyed by ``IdentLookup.tsv_name``. Those are the widening
    keys for rows SIMBAD's ident table does not hold the Gaia id of, and
    reading them here rather than from a second walk is what stops the two
    from covering different cohorts."""

    source_ids: list[int] = field(default_factory=list)
    hips: list[int] = field(default_factory=list)
    tycs: list[str] = field(default_factory=list)
    gls: list[str] = field(default_factory=list)
    designations_by_source_id: dict[int, dict[str, int | str]] = field(
        default_factory=dict
    )
    keyless: int = 0

    @property
    def total(self) -> int:
        return (
            len(self.source_ids) + len(self.hips) + len(self.tycs)
            + len(self.gls) + self.keyless
        )

    @property
    def by_namespace(self) -> dict[str, list]:
        """Which no-Gaia key list each widening namespace fills, keyed by
        ``IdentLookup.tsv_name``. Says nothing about the fall-through order —
        that is ``WIDENING_LADDER``'s alone."""
        return {
            HIP.tsv_name: self.hips,
            TYC.tsv_name: self.tycs,
            GJ.tsv_name: self.gls,
        }


def membership_request_keys(
    membership_path: Path, row_filter: RowFilter | None = None
) -> MembershipRequestKeys:
    """Partition the manifest into per-prefix SIMBAD lookup keys.

    A row with a resolved `gaia_source_id` is keyed on it, and its other
    designations ride along as that row's widening keys. The no-Gaia tier
    falls through `WIDENING_LADDER` itself rather than restating its order, so
    the tier and the widening that retries under it cannot come to disagree —
    the property `docs/catalog-driver.md` § 5 relies on. Sol carries none of
    the namespaces and lands in `keyless`.
    """
    keys = MembershipRequestKeys()
    by_namespace = keys.by_namespace
    for row in rl.iter_membership_rows(membership_path):
        if row_filter is not None and not row_filter(row):
            continue
        designations = row_designations(row)
        if source_id := row[rl.MEMBERSHIP_SOURCE_ID_COLUMN].strip():
            keys.source_ids.append(int(source_id))
            if designations:
                keys.designations_by_source_id[int(source_id)] = designations
            continue
        for lookup in WIDENING_LADDER:
            if (key := designations.get(lookup.tsv_name)) is not None:
                by_namespace[lookup.tsv_name].append(key)
                break
        else:
            keys.keyless += 1
    return keys


def row_designations(row: TableRow) -> dict[str, int | str]:
    """Every widening namespace this row carries a key for, keyed by
    ``IdentLookup.tsv_name`` so the request side never spells the namespace
    out a second time. Must cover every namespace in ``WIDENING_LADDER`` — a
    rung this cannot read finds no candidates and fails silently rather than
    loudly; pinned by ``test_row_designations_cover_the_whole_ladder``."""
    out: dict[str, int | str] = {}
    if hip := row["hip"].strip():
        out[HIP.tsv_name] = int(hip)
    if tyc := row["tyc"].strip():
        out[TYC.tsv_name] = tyc
    if gl := gl_suffix(row["gl"]):
        out[GJ.tsv_name] = gl
    return out


_GL_CATALOGUE_WORDS = frozenset({"GJ", "Gl"})


def gl_suffix(cell: str) -> str | None:
    """The designation part of a manifest ``gl`` cell — both ``Gl 165A`` and
    ``GJ 165A`` yield ``165A``. The manifest carries both spellings and SIMBAD
    resolves them onto its one ``GJ`` identifier, so the request composes
    that prefix onto this suffix."""
    text = cell.strip()
    word, _, rest = text.partition(" ")
    if word in _GL_CATALOGUE_WORDS:
        return rest.strip() or None
    return text or None


# Spine `*_src` marks that do NOT open a SIMBAD tier. Tycho-2 (`T`),
# Hipparcos printed and cross-walk (`HIP`, `HIP_X`) and Gaia DR3 (`G_R3`)
# each name a catalogue we hold first-hand, so their own cascade tier sits
# above SIMBAD; `N` and an empty cell mark an absent value rather than a
# source. Everything else — `HYG`, `OTHER`, `G_R2`, `GJ` — is what
# `docs/catalog-driver.md` § 5 retires, and is reachable by a SIMBAD tier.
NO_SIMBAD_TIER_SRC: frozenset[str] = frozenset({"T", "HIP", "HIP_X", "G_R3", "N", ""})

VALUE_SRC_COLUMNS = ("pos_src", "dist_src", "mag_src", "rv_src", "pm_src")


def is_simbad_value_cohort(row: TableRow) -> bool:
    """Whether a § 5 SIMBAD value tier can reach this row: some field's
    printed cell carries a non-first-order provenance mark, or it is a
    no-Gaia row (every cascade bottoms out at a designation-keyed tier
    there)."""
    if not row[rl.MEMBERSHIP_SOURCE_ID_COLUMN].strip():
        return True
    return any(
        row[column].strip() not in NO_SIMBAD_TIER_SRC
        for column in VALUE_SRC_COLUMNS
    )


def iter_wds_xids_oids(tsv_path: Path) -> Iterator[int]:
    """Yield SIMBAD oids from simbad_wds_xids.tsv. Blank cells are
    skipped — the cross-walk doesn't resolve every WDS component."""
    with tsv_path.open(newline="") as fh:
        reader = csv.reader(fh, delimiter="\t")
        header = next(reader)
        oi = header.index("simbad_oid")
        for row in reader:
            cell = row[oi].strip()
            if not cell:
                continue
            try:
                yield int(cell)
            except ValueError:
                continue
