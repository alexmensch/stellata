#!/usr/bin/env python3
"""Stage 6 anchor offsets: each component's WDS offset from its system's
anchor letter, composed over the system's pair geometry."""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass

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
    iter_decomposing_pair_components,
)
from .stage5_optical import OpticalClassification
from .wds_pair_photometry import pair_magnitudes, wds_dmag


_GeomAdj = dict[str, dict[str, tuple[float, float, float | None]]]


def anchor_token_rank(tok: str) -> tuple[str, int, str]:
    """Python twin of companion-promotion.ts ``isMoreCanonicalAnchor``:
    top-level letter first, then token length, then alphabetical. Change
    both. Same order, different candidates: promotion ranks only primaries
    it resolves to a catalogue record, so where the top one has no
    identifier the offsets chain from a letter promotion does not anchor
    on, and promotion re-bases them through ``anchor_comp``."""
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
    rho, theta = pair.rho_last, pair.theta_last
    if rho is not None and rho > 0.0 and theta is None:
        return None
    if rho is None or rho <= 0.0:
        east = north = 0.0
    else:
        theta_rad = math.radians(theta)
        east, north = rho * math.sin(theta_rad), rho * math.cos(theta_rad)
    mag_pri, mag_sec = pair_magnitudes(pair, p_tok, s_tok, msc)
    return SiblingEdge(
        east, north, wds_dmag(mag_pri, mag_sec),
        float(pair.date_last) if pair.date_last is not None else None,
    )


def photocentre_offsets(adj: SiblingAdj) -> dict[str, tuple[float, float]]:
    """Each sibling's (E, N) arcsec offset to the parent letter's
    photocentre — the flux-weighted mean position of the siblings the
    ``adj`` geometry reaches from the most canonical one. Flux ratios
    compose along the same chain from each row's own Δm; a sibling whose
    chain carries no Δm weighs nothing (its light was never measured)."""
    ref = min(adj, key=anchor_token_rank)
    pos: dict[str, tuple[float, float]] = {ref: (0.0, 0.0)}
    flux: dict[str, float | None] = {ref: 1.0}
    queue: deque[str] = deque([ref])
    while queue:
        tok = queue.popleft()
        for nbr, edge in sorted(adj.get(tok, {}).items()):
            if nbr in pos:
                continue
            pos[nbr] = (pos[tok][0] + edge.east, pos[tok][1] + edge.north)
            f = flux[tok]
            flux[nbr] = (
                f * 10.0 ** (-0.4 * edge.dmag)
                if f is not None and edge.dmag is not None else None
            )
            queue.append(nbr)
    weights = {t: f for t, f in flux.items() if f is not None}
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
    """Per-component ``(sep_arcsec, pa_deg)`` offset from the system
    anchor letter, keyed ``(wds_id, canonical token)``, with that letter
    per ``wds_id``.

    Offsets compose WDS (ρ, θ) tangent-plane vectors from three edge
    tiers: kept (Stage-5-physical) pair rows; Stage-5-REJECTED pair
    rows (a sep+PA measurement is real astrometry regardless of
    boundness classification — the pair stays dropped, only its
    geometry is consulted: Acrux AB, whose WDS ``U`` flag rejects the
    pair while B remains a V≈1.6 star with no other measured
    position); and compound photocentre proxies (a row with a
    multi-letter side lends its vector to each constituent letter —
    ``A,BC`` places B and C at the BC photocentre).

    Every tier also links a sub-letter anchor to each ancestor letter
    (Aa1 → Aa → A) at the siblings' photocentre (``photocentre_offsets``),
    the point a WDS row naming the parent measured from; kept and
    rejected sibling rows both count, since a blend's light is optical
    whatever its boundness. An unmeasured sibling separation is zero, and
    a ρ > 0 row with no θ places nothing. Only the anchor's own chain is
    linked: any other sub-letter (Ca under C) stays unreached, because
    where its parent is a record carrying the blend, placing the
    sub-letter beside it would draw that light twice.

    Preference per component: a DIRECT measured anchor→component edge
    (kept, then rejected) beats any composed chain — a blended member
    sits within measurement error of the anchor, so a chain through a
    distant third star cancels to ~zero and buries the direct
    measurement (Acrux: AC ∘ CB ≡ 0 vs the honest AB 3.5″). Chains
    then fill in tier order (kept → +rejected → +proxy); zero-length
    results fall through to the next tier.

    The anchor letter is the most canonical kept-pair primary token.
    The anchor itself is absent from the map, as is any unreachable
    component (blank columns downstream)."""
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
        if (
            pair.rho_last is None or pair.rho_last <= 0.0
            or pair.theta_last is None
        ):
            continue
        theta_rad = math.radians(pair.theta_last)
        e = pair.rho_last * math.sin(theta_rad)
        n = pair.rho_last * math.cos(theta_rad)
        epoch = float(pair.date_last) if pair.date_last is not None else None
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

        def _accumulate(candidates: dict[str, tuple[float, float]]) -> None:
            for tok, (e, n) in candidates.items():
                if tok == anchor or tok in offsets:
                    continue
                if math.hypot(e, n) <= 0.0:
                    continue
                offsets[tok] = (e, n)

        for graph in (g0, g1):  # direct measured edges, kept first
            _accumulate({
                tok: (e, n) for tok, (e, n, _ep) in graph.get(anchor, {}).items()
            })
        for graph in (g0, g1, g2):  # composed chains fill the rest
            _accumulate(_bfs_all_offsets(graph, anchor))

        for tok, (e, n) in offsets.items():
            pa = math.degrees(math.atan2(e, n)) % 360.0
            out[(wds_id, tok)] = (math.hypot(e, n), pa)
    return AnchorOffsets(anchor_by_system, out)
