#!/usr/bin/env python3
"""Stage 6 anchor offsets: each component's WDS offset from its system's
anchor letter, composed over the system's pair geometry."""

from __future__ import annotations

import math
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeVar

from .component_tokens import (
    expand_wds_truncated_secondary,
    is_component_token,
    parent_component_token,
    token_letters,
)
from .msc_map import MscLookup
from .parsers import WdsPair
from .stage2_resolve import (
    ResolvedComponent,
    _add_edge,
    add_newest_edge,
    pair_epoch,
    pair_vector,
    iter_decomposing_pair_components,
)
from .stage5_optical import OpticalClassification
from .wds_pair_photometry import pair_magnitudes, wds_dmag


_GeomAdj = dict[str, dict[str, tuple[float, float, float | None]]]


def anchor_token_rank(tok: str) -> tuple[str, int, str]:
    """Python twin of companion-promotion.ts ``isMoreCanonicalAnchor``,
    same order: change both. Candidates differ: README.md#stage-6--multiplestsv-emit."""
    return (tok[:1], len(tok), tok)


def _proxy_endpoints(tok: str) -> list[str]:
    """A compound token's constituent letters (``"BC" → [B, C]``), or the
    token itself for single-component forms."""
    letters = token_letters(tok)
    return sorted(letters) if len(letters) >= 2 else [tok]


def _merged_adj(base: _GeomAdj, overlay: _GeomAdj) -> _GeomAdj:
    """Edge-union of two adjacency tiers; ``overlay`` wins on collisions."""
    out: _GeomAdj = {tok: dict(nbrs) for tok, nbrs in base.items()}
    for tok, nbrs in overlay.items():
        out.setdefault(tok, {}).update(nbrs)
    return out


def _bfs_all_offsets(
    adj: _GeomAdj, start: str,
) -> dict[str, tuple[float, float]]:
    """Composed tangent-plane offset (E, N) arcsec of every token
    reachable from ``start``, over shortest-hop chains."""
    out: dict[str, tuple[float, float]] = {start: (0.0, 0.0)}
    queue: deque[str] = deque([start])
    while queue:
        tok = queue.popleft()
        e, n = out[tok]
        for nbr, (de, dn, _epoch) in adj.get(tok, {}).items():
            if nbr in out:
                continue
            out[nbr] = (e + de, n + dn)
            queue.append(nbr)
    return out


@dataclass(frozen=True)
class SiblingEdge:
    east: float
    north: float
    dmag: float | None
    epoch: float | None


SiblingAdj = dict[str, dict[str, SiblingEdge]]


def add_sibling_edge(
    adj: SiblingAdj, a: str, b: str, edge: SiblingEdge,
) -> None:
    reverse = SiblingEdge(
        -edge.east, -edge.north,
        -edge.dmag if edge.dmag is not None else None, edge.epoch,
    )
    add_newest_edge(adj, a, b, edge, reverse, edge.epoch, lambda e: e.epoch)


def _sibling_edge(
    pair: WdsPair, p_tok: str, s_tok: str, msc: MscLookup | None,
) -> SiblingEdge | None:
    vector = pair_vector(pair)
    if vector is None:
        measured_wider = pair.rho_last is not None and pair.rho_last > 0.0
        overflowed = pair.rho_last is None and pair.theta_last is not None
        if measured_wider or overflowed:
            return None
        vector = (0.0, 0.0)
    mags = pair_magnitudes(pair, p_tok, s_tok, msc)
    return SiblingEdge(*vector, wds_dmag(mags.mag_pri, mags.mag_sec), pair_epoch(pair))


_V = TypeVar("_V")


def _walk(
    adj: SiblingAdj, start: str, origin: _V,
    step: Callable[[_V, SiblingEdge], _V],
) -> dict[str, _V]:
    out = {start: origin}
    queue: deque[str] = deque([start])
    while queue:
        tok = queue.popleft()
        for nbr, edge in sorted(adj.get(tok, {}).items()):
            if nbr not in out:
                out[nbr] = step(out[tok], edge)
                queue.append(nbr)
    return out


def photocentre_offsets(adj: SiblingAdj) -> dict[str, tuple[float, float]]:
    """Each sibling's (E, N) arcsec offset to the parent letter's
    photocentre: README.md#stage-6--multiplestsv-emit."""
    ref = min(adj, key=anchor_token_rank)
    pos = _walk(adj, ref, (0.0, 0.0), lambda p, e: (p[0] + e.east, p[1] + e.north))
    weights = _walk(
        {t: {n: e for n, e in nbrs.items() if e.dmag is not None} for t, nbrs in adj.items()},
        ref, 1.0, lambda f, e: f * 10.0 ** (-0.4 * e.dmag),
    )
    total = sum(weights.values())
    pc_e = sum(w * pos[t][0] for t, w in weights.items()) / total
    pc_n = sum(w * pos[t][1] for t, w in weights.items()) / total
    return {t: (pc_e - e, pc_n - n) for t, (e, n) in pos.items()}


@dataclass(frozen=True)
class AnchorOffsets:
    """The letter each system's offsets chain from, and every reached
    component's ``(sep_arcsec, pa_deg)`` from it."""

    anchor_by_system: dict[str, str]
    offsets: dict[tuple[str, str], tuple[float, float]]


def compute_anchor_offsets(
    pairs: list[WdsPair],
    components: list[ResolvedComponent],
    classifications: list[OpticalClassification],
    msc: MscLookup | None,
) -> AnchorOffsets:
    """Each reached component's offset from its system's anchor letter:
    README.md#stage-6--multiplestsv-emit."""
    kept: dict[str, _GeomAdj] = {}
    rejected: dict[str, _GeomAdj] = {}
    proxy: dict[str, _GeomAdj] = {}
    siblings: dict[tuple[str, str], SiblingAdj] = {}
    kept_primary_tokens: dict[str, set[str]] = {}
    for j, (pair, primary, secondary) in enumerate(
        iter_decomposing_pair_components(pairs, components),
    ):
        is_kept = classifications[j].is_physical
        p_tok = primary.component
        s_tok = expand_wds_truncated_secondary(p_tok, secondary.component)
        if is_kept:
            kept_primary_tokens.setdefault(pair.wds_id, set()).add(p_tok)
        parent = parent_component_token(p_tok)
        if (
            parent is not None
            and parent == parent_component_token(s_tok)
            and is_component_token(p_tok) and is_component_token(s_tok)
        ):
            sibling_edge = _sibling_edge(pair, p_tok, s_tok, msc)
            if sibling_edge is not None:
                add_sibling_edge(
                    siblings.setdefault((pair.wds_id, parent), {}),
                    p_tok, s_tok, sibling_edge,
                )
        vector = pair_vector(pair)
        if vector is None:
            continue
        e, n = vector
        epoch = pair_epoch(pair)
        tier = kept if is_kept else rejected
        _add_edge(tier.setdefault(pair.wds_id, {}), p_tok, s_tok, e, n, epoch)
        p_ends = _proxy_endpoints(p_tok)
        s_ends = _proxy_endpoints(s_tok)
        if len(p_ends) > 1 or len(s_ends) > 1:
            proxy_adj = proxy.setdefault(pair.wds_id, {})
            for a in p_ends:
                for b in s_ends:
                    _add_edge(proxy_adj, a, b, e, n, epoch)

    out: dict[tuple[str, str], tuple[float, float]] = {}
    anchor_by_system: dict[str, str] = {}
    for wds_id, primary_tokens in kept_primary_tokens.items():
        anchor = min(primary_tokens, key=anchor_token_rank)
        anchor_by_system[wds_id] = anchor
        links: _GeomAdj = {}
        tok = anchor
        parent = parent_component_token(anchor) if is_component_token(anchor) else None
        while parent is not None:
            adj = siblings.get((wds_id, parent))
            e, n = photocentre_offsets(adj).get(tok, (0.0, 0.0)) if adj else (0.0, 0.0)
            _add_edge(links, tok, parent, e, n, None)
            tok, parent = parent, parent_component_token(parent)
        g0 = _merged_adj(links, kept.get(wds_id, {}))
        g1 = _merged_adj(rejected.get(wds_id, {}), g0)
        g2 = _merged_adj(proxy.get(wds_id, {}), g1)
        offsets: dict[str, tuple[float, float]] = {}
        reached_at_zero: set[str] = set()

        def _accumulate(candidates: dict[str, tuple[float, float]]) -> None:
            for tok, (e, n) in candidates.items():
                if tok == anchor or tok in offsets:
                    continue
                if math.hypot(e, n) <= 0.0:
                    reached_at_zero.add(tok)
                    continue
                offsets[tok] = (e, n)

        for graph in (g0, g1):  # direct measured edges, kept first
            _accumulate({
                tok: (e, n) for tok, (e, n, _ep) in graph.get(anchor, {}).items()
            })
        for graph in (g0, g1, g2):  # composed chains fill the rest
            _accumulate(_bfs_all_offsets(graph, anchor))

        for tok in reached_at_zero - offsets.keys():
            offsets[tok] = (0.0, 0.0)
        for tok, (e, n) in offsets.items():
            pa = math.degrees(math.atan2(e, n)) % 360.0
            out[(wds_id, tok)] = (math.hypot(e, n), pa)
    return AnchorOffsets(anchor_by_system, out)
