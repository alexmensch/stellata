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
from .specs import GAIA_DR3, GJ, HIP, IdentLookup, TYC


# Report label for the TYC pass over source_ids the Gaia namespace missed,
# kept apart from the no-Gaia tier's own TYC keys so the widening's gain is
# separately readable.
TYC_WIDENING = "tyc_widening"


@dataclass
class OidRequest:
    """The resolved oid set plus per-namespace requested/resolved counts.
    The counts are the coverage report each shell prints and the guard a
    silently-shrinking request set fails against."""

    oids: set[int] = field(default_factory=set)
    requested: dict[str, int] = field(default_factory=dict)
    resolved: dict[str, int] = field(default_factory=dict)
    gained_by_widening: int = 0
    widening_vetoed: int = 0
    widening_uncorroborated: int = 0

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

    def report_lines(self) -> list[str]:
        lines = [
            f"  {name:14s} requested {self.requested[name]:7d} → resolved "
            f"{self.resolved[name]:7d} "
            f"({self.resolved[name]/max(1, self.requested[name]):6.1%})"
            for name in self.requested
        ]
        if TYC_WIDENING in self.requested:
            lines.append(
                f"  {'':14s} of the widened: {self.widening_vetoed} vetoed on a "
                f"contradicting Gaia id, {self.widening_uncorroborated} kept "
                f"with no Gaia id to check against"
            )
        return lines


def resolve_spine_keys(
    client: rl.TapClient, keys: SpineRequestKeys
) -> OidRequest:
    """Resolve a spine key partition to SIMBAD oids.

    Gaia DR3 first, then the record's own TYC for every source_id that
    namespace did not reach — the widening that carries a Gaia-keyed row
    SIMBAD holds under its Tycho id only. The no-Gaia tier's HIP / TYC / GJ
    keys follow.
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

    if keys.tyc_by_source_id:
        candidates = _widening_candidates(keys, gaia_resolved)
        widened = query.resolve_oids_by_prefix(
            client, list(candidates), TYC, progress_label="TYC widening"
        )
        kept, vetoed, uncorroborated = _veto_contradicted(
            client, widened, candidates
        )
        before = len(request.oids)
        request.add(TYC_WIDENING, list(candidates), kept)
        request.gained_by_widening = len(request.oids) - before
        request.widening_vetoed = vetoed
        request.widening_uncorroborated = uncorroborated

    return request


def _widening_candidates(
    keys: SpineRequestKeys, gaia_resolved: Mapping[int, int]
) -> dict[str, int]:
    """{TYC: source_id} for every source_id the Gaia namespace did not
    reach that carries one. A TYC two source_ids both claim would bind
    neither of them, so it is dropped rather than widened."""
    claims: dict[str, list[int]] = {}
    for source_id in keys.source_ids:
        tyc = keys.tyc_by_source_id.get(source_id)
        if tyc is not None and source_id not in gaia_resolved:
            claims.setdefault(tyc, []).append(source_id)
    return {tyc: ids[0] for tyc, ids in claims.items() if len(ids) == 1}


def _veto_contradicted(
    client: rl.TapClient,
    widened: Mapping[str, int],
    candidates: Mapping[str, int],
) -> tuple[dict[str, int], int, int]:
    """Drop widened bindings SIMBAD's own Gaia DR3 cross-ID contradicts.

    A widened row is one the Gaia namespace could not reach, so its TYC is
    the only thing tying record to object — and a TYC names the Tycho
    entry, which for a close pair is the system rather than the component
    the spine resolved. Where SIMBAD does hold a Gaia DR3 id for the oid
    and it is not the source_id that asked, the two disagree about which
    star this is. Returns (kept, vetoed, uncorroborated) — see
    README.md § The TYC widening carries its own veto.
    """
    if not widened:
        return {}, 0, 0
    gaia_ids = query.fetch_ident_lookups(
        client, sorted(set(widened.values())), [GAIA_DR3],
        progress_label="widening veto",
    )
    kept: dict[str, int] = {}
    vetoed = uncorroborated = 0
    for tyc, oid in widened.items():
        simbad_source_id = gaia_ids.get(oid, {}).get(GAIA_DR3.tsv_name)
        if simbad_source_id is None:
            uncorroborated += 1
        elif simbad_source_id != candidates[tyc]:
            vetoed += 1
            continue
        kept[tyc] = oid
    return kept, vetoed, uncorroborated
