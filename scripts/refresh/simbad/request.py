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
        return [
            f"  {name:10s} requested {self.requested[name]:7d} → resolved "
            f"{self.resolved[name]:7d} "
            f"({self.resolved[name]/max(1, self.requested[name]):6.1%})"
            for name in self.requested
        ]


def resolve_spine_keys(
    client: rl.TapClient,
    keys: SpineRequestKeys,
    *,
    tyc_by_source_id: Mapping[int, str] | None = None,
) -> OidRequest:
    """Resolve a spine key partition to SIMBAD oids.

    Gaia DR3 first, then — where ``tyc_by_source_id`` is given — the
    record's own TYC for every source_id that namespace did not reach,
    which is the widening that carries a Gaia-keyed row SIMBAD holds under
    its Tycho id only. The no-Gaia tier's HIP / TYC / GJ keys follow.
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

    if tyc_by_source_id:
        widening = [
            tyc_by_source_id[s]
            for s in keys.source_ids
            if s not in gaia_resolved and s in tyc_by_source_id
        ]
        widened = query.resolve_oids_by_prefix(
            client, widening, TYC, progress_label="TYC widening"
        )
        before = len(request.oids)
        request.add(TYC_WIDENING, widening, widened)
        request.gained_by_widening = len(request.oids) - before

    return request
