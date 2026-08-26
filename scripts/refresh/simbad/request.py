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
class WideningVerdicts:
    """How one widening rung's bindings were adjudicated. `corroborated` is
    the strong outcome — SIMBAD holds the asking id itself."""

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
    gained_by_widening: dict[str, int] = field(default_factory=dict)
    verdicts: dict[str, WideningVerdicts] = field(default_factory=dict)

    def add(
        self,
        label: str,
        requested: Sequence[int | str],
        resolved: Mapping[int | str, int],
    ) -> None:
        self.requested[label] = len(requested)
        self.resolved[label] = len(resolved)
        self.oids.update(resolved.values())

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
                    f"with no Gaia id to check against"
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
    kept, verdicts = _corroborate(client, widened, candidates, lookup)
    before = len(request.oids)
    request.add(label, list(candidates), kept)
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


def _corroborate(
    client: rl.TapClient,
    widened: Mapping[int | str, int],
    candidates: Mapping[int | str, int],
    lookup: IdentLookup,
) -> tuple[dict[int | str, int], WideningVerdicts]:
    """Adjudicate widened bindings against SIMBAD's own Gaia cross-IDs.

    A widened row is one the Gaia namespace could not reach, so a designation
    is the only thing tying record to object — and a TYC or HIP names the
    catalogue entry, which for a close pair is the system rather than the
    component the spine resolved. Three outcomes, read off every Gaia release
    SIMBAD keys rather than DR3 alone:

    - SIMBAD holds the asking id under **any** release: the strongest
      evidence there is, so the binding is kept. This is what reaches a spine
      cell carrying a DR2 id in the DR3 column — a disagreement about the
      release, not about which star this is.
    - SIMBAD holds a DR3 id and it is not the asking one: the two disagree
      about the star and the binding drops. Only DR3 can contradict — each
      release numbers the same star differently, so a differing DR2 id is no
      evidence at all.
    - No Gaia id for the object: the binding stands unverified, kept and
      counted.

    See README.md § The widening carries its own corroboration rule.
    """
    if not widened:
        return {}, WideningVerdicts()
    gaia_ids = query.fetch_ident_sets(
        client, sorted(set(widened.values())), GAIA_RELEASES,
        progress_label=f"{lookup.tsv_name} widening corroboration",
    )
    kept: dict[int | str, int] = {}
    verdicts = WideningVerdicts()
    for suffix, oid in widened.items():
        releases = gaia_ids.get(oid, {})
        asking = candidates[suffix]
        if any(asking in ids for ids in releases.values()):
            verdicts.corroborated += 1
        elif releases.get(GAIA_DR3.tsv_name):
            verdicts.vetoed += 1
            continue
        else:
            verdicts.uncorroborated += 1
        kept[suffix] = oid
    return kept, verdicts
