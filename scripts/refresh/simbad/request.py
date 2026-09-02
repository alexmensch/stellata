"""Phase A of every spine-keyed SIMBAD pull: turn a SpineRequestKeys
partition into the deduplicated oid request set, and report what each
identifier namespace reached."""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import refresh_lib as rl  # noqa: E402

from . import query
from .inputs import SpineRequestKeys
from .specs import (
    GAIA_DR3, GAIA_RELEASES, GJ, HIP, IdentLookup, TYC, WIDENING_LADDER,
)


def widening_label(lookup: IdentLookup) -> str:
    """Report label for a widening pass, kept apart from the same
    namespace's own no-Gaia keys so each rung's gain reads separately."""
    return f"{lookup.tsv_name}_widening"


@dataclass
class CorroborationVerdicts:
    """How one pass's designation-only bindings were adjudicated — a widening
    rung's, or the union's. `corroborated` is the strong outcome: SIMBAD holds
    the asking id itself. `uncorroborated` is "nothing published that could
    contradict it", which admits an object holding only a differing
    EARLIER-release id as well as one holding no Gaia id at all: under
    § The corroboration rule, only DR3 contradicts."""

    corroborated: int = 0
    vetoed: int = 0
    uncorroborated: int = 0


@dataclass
class OidRequest:
    """The resolved oid set plus per-namespace requested/resolved counts.
    The counts are the coverage report each shell prints and the guard a
    silently-shrinking request set fails against."""

    oids: set[int] = field(default_factory=set)
    requested: dict[str, int] = field(default_factory=dict)
    resolved: dict[str, int] = field(default_factory=dict)
    #: {IdentLookup.tsv_name: {key: oid}} — what each namespace actually
    #: bound, which is what a later pass needs to tell "asked and answered
    #: with an absence" from "never asked". Keyed on the namespace rather
    #: than the report label so a widening rung folds into its own
    #: namespace: read-back does not care which rung bound a row.
    bindings: dict[str, dict[int | str, int]] = field(default_factory=dict)
    gained_by_widening: dict[str, int] = field(default_factory=dict)
    verdicts: dict[str, CorroborationVerdicts] = field(default_factory=dict)

    def add(
        self,
        label: str,
        requested: Sequence[int | str],
        resolved: Mapping[int | str, int],
        namespace: str | None = None,
    ) -> None:
        self.requested[label] = len(requested)
        self.resolved[label] = len(resolved)
        self.oids.update(resolved.values())
        self.bindings.setdefault(namespace or label, {}).update(resolved)

    def coverage(self, label: str) -> float:
        return self.resolved[label] / max(1, self.requested[label])

    @property
    def total_gained_by_widening(self) -> int:
        return sum(self.gained_by_widening.values())

    def report_lines(self) -> list[str]:
        lines: list[str] = []
        for name in self.requested:
            lines.append(
                f"  {name:14s} requested {self.requested[name]:7d} → resolved "
                f"{self.resolved[name]:7d} "
                f"({self.resolved[name]/max(1, self.requested[name]):6.1%})"
            )
            verdict = self.verdicts.get(name)
            if verdict is not None:
                lines.append(
                    f"  {'':14s} of the widened: {verdict.corroborated} "
                    f"corroborated by a Gaia cross-ID, {verdict.vetoed} vetoed "
                    f"on a contradicting DR3 id, {verdict.uncorroborated} kept "
                    f"with no DR3 id to contradict them"
                )
        return lines


def resolve_spine_keys(
    client: rl.TapClient, keys: SpineRequestKeys
) -> OidRequest:
    """Resolve a spine key partition to SIMBAD oids.

    Gaia DR3 first, then the no-Gaia tier's HIP / TYC / GJ keys, then the
    widening ladder over every source_id the Gaia namespace did not reach —
    the record's own HIP, TYC and GJ in turn, each rung asking only for what
    the rungs above it left unbound.
    """
    request = OidRequest()

    gaia_resolved = query.resolve_oids_by_prefix(client, keys.source_ids, GAIA_DR3)
    request.add(GAIA_DR3.tsv_name, keys.source_ids, gaia_resolved)

    hip_resolved = query.resolve_oids_by_prefix(client, keys.hips, HIP)
    request.add(HIP.tsv_name, keys.hips, hip_resolved)

    tyc_resolved = query.resolve_oids_by_prefix(client, keys.tycs, TYC)
    request.add(TYC.tsv_name, keys.tycs, tyc_resolved)

    gj_resolved = query.resolve_oids_by_prefix(client, keys.gls, GJ)
    request.add(GJ.tsv_name, keys.gls, gj_resolved)

    unbound = [s for s in keys.source_ids if s not in gaia_resolved]
    for lookup in WIDENING_LADDER:
        if not unbound:
            break
        unbound = _widen(client, request, keys, lookup, unbound)

    return request


def _widen(
    client: rl.TapClient,
    request: OidRequest,
    keys: SpineRequestKeys,
    lookup: IdentLookup,
    unbound: Sequence[int],
) -> list[int]:
    """One rung of the widening ladder. Returns the source_ids still unbound
    after it, so the next rung asks only for what this one could not reach."""
    candidates = _widening_candidates(keys, lookup, unbound)
    if not candidates:
        return list(unbound)

    label = widening_label(lookup)
    widened = query.resolve_oids_by_prefix(
        client, list(candidates), lookup,
        progress_label=f"{lookup.tsv_name} widening",
    )
    kept, verdicts = corroborate(
        client, widened, candidates,
        progress_label=f"{lookup.tsv_name} widening corroboration",
    )
    before = len(request.oids)
    request.add(label, list(candidates), kept, namespace=lookup.tsv_name)
    request.gained_by_widening[label] = len(request.oids) - before
    request.verdicts[label] = verdicts

    bound = {candidates[suffix] for suffix in kept}
    return [s for s in unbound if s not in bound]


def _widening_candidates(
    keys: SpineRequestKeys,
    lookup: IdentLookup,
    unbound: Sequence[int],
) -> dict[int | str, int]:
    """{designation: source_id} for every still-unbound source_id carrying
    one in this namespace. A designation two source_ids both claim would bind
    neither of them, so it is dropped rather than widened."""
    claims: dict[int | str, list[int]] = {}
    for source_id in unbound:
        suffix = keys.designations_by_source_id.get(source_id, {}).get(
            lookup.tsv_name
        )
        if suffix is not None:
            claims.setdefault(suffix, []).append(source_id)
    return {suffix: ids[0] for suffix, ids in claims.items() if len(ids) == 1}


def corroborate(
    client: rl.TapClient,
    bound: Mapping[int | str, int],
    asking_ids: Mapping[int | str, int | None],
    *,
    progress_label: str,
) -> tuple[dict[int | str, int], CorroborationVerdicts]:
    """Adjudicate designation-only bindings against SIMBAD's own Gaia
    cross-IDs, read across every release SIMBAD keys rather than DR3 alone.

    Only a DR3 id can contradict the asking one, so the veto reads DR3 while
    corroboration reads all three releases — the asymmetry, and why a
    differing DR2 id is not evidence either way, is README.md § The
    corroboration rule. An asking id of None has nothing a
    cross-ID could contradict, so it lands uncorroborated rather than skipping
    the rule: a no-Gaia spine row binds on its designation alone too.
    """
    if not bound:
        return {}, CorroborationVerdicts()
    gaia_ids = query.fetch_ident_sets(
        client, sorted(set(bound.values())), GAIA_RELEASES,
        progress_label=progress_label,
    )
    kept: dict[int | str, int] = {}
    verdicts = CorroborationVerdicts()
    for suffix, oid in bound.items():
        releases = gaia_ids.get(oid, {})
        asking = asking_ids.get(suffix)
        if asking is not None and any(asking in ids for ids in releases.values()):
            verdicts.corroborated += 1
        elif asking is not None and releases.get(GAIA_DR3.tsv_name):
            verdicts.vetoed += 1
            continue
        else:
            verdicts.uncorroborated += 1
        kept[suffix] = oid
    return kept, verdicts
