#!/usr/bin/env python3
"""Stage 2 — WDS-component → Gaia DR3 ``source_id`` resolution cascade.
See ``scripts/binaries/README.md`` § Stage 2 for the cascade priority.
"""

from __future__ import annotations

import math
import re
import sys
from collections import deque
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parsers import (  # noqa: E402
    AthygRow,
    GaiaAstrometryRow,
    Orb6Entry,
    SimbadWdsXid,
    WdsPair,
)
from indices import (  # noqa: E402
    ATHYG_REFERENCE_EPOCH,
    IdentifierIndices,
    WDS_PRECISE_COORD_EPOCH,
)
from component_tokens import (  # noqa: E402
    expand_wds_truncated_secondary,
    is_component_token,
    parent_component_token,
)


# Strict priority order Stage 2 attempts for every WDS component. The
# log line and unit tests both read from this tuple so adding a tier or
# renaming one only edits the canonical list. Order is significant —
# earlier strategies win when more than one would succeed.
RESOLVE_VIA_VALUES: tuple[str, ...] = (
    "orb6_hip",
    "athyg_gaia_native",
    "simbad_xid",
    "ccdm_hip",
    "position_pm",
    "position_nopm",
    "unresolved",
)

# Strict priority lookup keyed off ``RESOLVE_VIA_VALUES``. Lower index =
# stronger evidence. Consumed by ``propagate_within_system`` to pick the
# canonical tag when multiple pair rows resolve the same component
# letter through different tiers.
RESOLVE_VIA_PRIORITY: dict[str, int] = {
    tag: i for i, tag in enumerate(RESOLVE_VIA_VALUES)
}


# ─── Stage 2: WDS-component → gaia_source_id resolution ─────────────


@dataclass
class ResolvedComponent:
    """One row of Stage 2's output. ``gaia_source_id`` is ``None`` only
    when ``resolve_via == 'unresolved'``. ``hip`` is populated whenever
    a classical Hipparcos identifier is known for the component —
    either from an ORB6 entry (primary) or from a position-matched
    AT-HYG row — regardless of whether Gaia could be reached from it.
    Stage 3 reads ``hip`` for its HIP2 fallback so saturated bright
    stars (Sirius, α Cen) that have no Gaia source still attach
    astrometry.

    ``athyg_row`` carries the position-matched AT-HYG row reference for
    components whose identifier-indexed lookups (``src_to_athyg``,
    ``hip_to_athyg``) would miss because the AT-HYG row carries neither
    ``hip`` nor ``gaia``. Stage 6 consults this before the indexed
    paths so AT-HYG-only rows still surface their absmag / spect /
    proper name. Set by ``resolve_via_position`` (Stage 2) and
    ``attach_athyg_position_fallback`` (Stage 3).
    """

    wds_id: str
    discoverer: str
    component: str            # e.g. 'A', 'B', 'Aa', 'Ab'
    is_primary: bool
    gaia_source_id: int | None
    resolve_via: str
    hip: int | None = None
    athyg_row: AthygRow | None = None


def split_components(comp_str: str) -> tuple[str, str] | None:
    """Decompose a WDS ``components`` field into (primary, secondary).

    Returns ``None`` for system-level rows (empty field) and for rows we
    cannot confidently split. Stage 2 treats ``None`` as "skip this pair"
    rather than guessing.

    The WDS convention is:

    * ``"AB"``  → ("A", "B")
    * ``"Aa,Ab"`` → ("Aa", "Ab")  — comma separates multi-character labels
    * ``"BC,D"`` → ("BC", "D")    — first part can be multi-letter

    Three-letter unbraced forms like ``"ABC"`` are ambiguous (could mean
    A vs BC, or AB vs C) and are skipped rather than partitioned wrong.
    """
    s = comp_str.strip()
    if not s:
        return None
    if "," in s:
        parts = [p.strip() for p in s.split(",") if p.strip()]
        if len(parts) == 2:
            return parts[0], parts[1]
        return None
    if len(s) == 2:
        return s[0], s[1]
    return None


def iter_decomposing_pair_cursor(
    pairs: list[WdsPair],
    components: list[ResolvedComponent],
) -> Iterator[tuple[WdsPair, int]]:
    """Pair-walk primitive: yield ``(pair, i)`` for every pair that
    decomposes into two components, where ``components[i]`` and
    ``components[i + 1]`` are its primary and secondary. Non-decomposing
    pairs (empty / ambiguous ``components`` field) are skipped, keeping
    the two-per-pair cursor aligned; the wds_id sync a Stage 2/3 skew
    would break is validated here so it raises rather than silently
    mis-pairing components downstream. ``components`` must be the
    untouched output of ``resolve_all_pairs``."""
    i = 0
    for pair in pairs:
        if split_components(pair.components) is None:
            continue
        if i + 1 >= len(components):
            raise RuntimeError(
                "component cursor exhausted before pairs did — Stage 2 "
                "output truncated"
            )
        if (
            components[i].wds_id != pair.wds_id
            or components[i + 1].wds_id != pair.wds_id
        ):
            raise RuntimeError(
                f"component cursor desync at pair {pair.wds_id}/"
                f"{pair.components}: got components {components[i].wds_id} "
                f"+ {components[i + 1].wds_id}"
            )
        yield pair, i
        i += 2


def iter_decomposing_pair_components(
    pairs: list[WdsPair],
    components: list[ResolvedComponent],
) -> Iterator[tuple[WdsPair, ResolvedComponent, ResolvedComponent]]:
    """``(pair, primary, secondary)`` per decomposing pair — the
    astrometry-free walk for Stage 2 passes that run before astrometry
    exists. Stage 4's ``iter_decomposing_pairs`` is the same walk
    carrying the parallel astrometry list."""
    for pair, i in iter_decomposing_pair_cursor(pairs, components):
        yield pair, components[i], components[i + 1]


def group_orb6_by_pair(
    orb6: list[Orb6Entry],
) -> dict[tuple[str, str], list[Orb6Entry]]:
    """Index ORB6 entries by ``(wds_id, components)`` so Stage 2 can fetch
    every fit for a given WDS pair in O(1).

    Components-string match is strict: ``"AB"`` and ``""`` (system-level)
    are different keys. Stage 2 only consults the entry whose components
    string exactly matches the pair it is resolving — using a system-level
    ORB6 HIP for an ``"AC"`` pair would attribute the primary's gaia
    source to the wrong component when multiple orbit fits coexist.
    """
    out: dict[tuple[str, str], list[Orb6Entry]] = {}
    for e in orb6:
        out.setdefault((e.wds_id, e.components), []).append(e)
    return out


def _gaia_from_athyg_via_hip(
    hip: int, indices: IdentifierIndices,
) -> int | None:
    """HIP-mediated AT-HYG lookup. AT-HYG's gaia field (~98% coverage) is
    broader than Gaia's HIP cross-walk because AT-HYG ingests source_ids
    through its own pipeline. When a HIP exists but Gaia's published
    xwalk misses it, AT-HYG often still carries a gaia value. Tagged
    ``athyg_gaia_native`` in ``RESOLVE_VIA_VALUES``."""
    row = indices.hip_to_athyg.get(hip)
    if row is None or row.gaia is None:
        return None
    return row.gaia


# ORB6-HIP coordinate sanity tolerance. The primary sits at (essentially)
# the pair's WDS precise coord, so its ORB6-published HIP must position
# within a few arcmin of it. 5′ is a wide safety margin against PM/epoch
# residuals yet an order of magnitude tighter than the smallest observed
# mis-anchor (ε Equ STF2737's typo'd HIP lands ~40° away).
ORB6_HIP_COORD_SANITY_TOLERANCE_ARCSEC = 300.0


def _hip_sky_position(
    hip: int, indices: IdentifierIndices,
) -> tuple[float, float] | None:
    """Best-available ``(ra_deg, dec_deg)`` for a HIP, for the ORB6-HIP
    coordinate sanity gate. Prefers the AT-HYG row PM-propagated to the
    WDS precise-coord epoch (the machinery the CCDM / position tiers
    use); falls back to the resolved Gaia source's astrometry, likewise
    PM-propagated from its Gaia DR3 epoch to the same J2000 frame so both
    branches are compared to the WDS coord at one epoch. Returns ``None``
    when neither carries a position — the gate then can't validate and
    trusts the ORB6 attribution."""
    row = indices.hip_to_athyg.get(hip)
    if row is not None:
        return _athyg_position_at_epoch(row, WDS_PRECISE_COORD_EPOCH)
    gaia = indices.hip_to_gaia.get(hip)
    if gaia is not None:
        astro = indices.src_to_astrometry.get(gaia)
        if astro is not None:
            return _propagate_position(
                astro.ra_deg, astro.dec_deg,
                astro.pmra_masyr, astro.pmdec_masyr,
                astro.ref_epoch, WDS_PRECISE_COORD_EPOCH,
            )
    return None


def _orb6_hip_matches_pair_coord(
    hip: int, pair: WdsPair, indices: IdentifierIndices,
) -> bool:
    """Guard an ORB6-published HIP against the pair's WDS precise coord.
    ORB6 occasionally carries a typo'd HIP (STF2737 lists HIP 103579 —
    an unrelated Cygnus star ~40° away — for ε Equ's true HIP 103569);
    without this the primary anchors onto the wrong star and mints a
    phantom orbiting companion there. Returns ``True`` (trust) when the
    pair has no precise coord or the HIP has no position to check; only a
    positive position mismatch rejects."""
    if pair.precise_ra_deg is None or pair.precise_dec_deg is None:
        return True
    pos = _hip_sky_position(hip, indices)
    if pos is None:
        return True
    return _positions_within(
        pos[0], pos[1], pair.precise_ra_deg, pair.precise_dec_deg,
        ORB6_HIP_COORD_SANITY_TOLERANCE_ARCSEC,
    )


def resolve_component(
    pair: WdsPair,
    component: str,
    is_primary: bool,
    orb6_for_pair: list[Orb6Entry],
    indices: IdentifierIndices,
) -> ResolvedComponent:
    """Resolve a single WDS component to a Gaia DR3 source_id via the
    HIP-anchored cascade prefix (``orb6_hip`` → ``athyg_gaia_native``
    HIP-mediated). Returns an ``unresolved`` record when neither fires;
    ``resolve_via_simbad`` and ``resolve_via_position`` then take
    successive swings before the cascade falls through.

    Secondary components have no direct ORB6 signal (ORB6 publishes one
    HIP per orbit row, which by convention is the primary's), so
    ``orb6_hip`` only applies to primaries.

    An ORB6 HIP whose position fails ``_orb6_hip_matches_pair_coord`` is
    dropped entirely — not appended to ``candidate_hips`` — so a typo'd
    HIP neither resolves Gaia here nor rides the HIP-mediated /
    ``unresolved`` fallbacks; the component falls through to the
    coordinate-validated SIMBAD / CCDM / position tiers instead.
    """
    def emit(gaia: int | None, via: str, hip: int | None) -> ResolvedComponent:
        return ResolvedComponent(
            wds_id=pair.wds_id,
            discoverer=pair.discoverer,
            component=component,
            is_primary=is_primary,
            gaia_source_id=gaia,
            resolve_via=via,
            hip=hip,
        )

    candidate_hips: list[int] = []

    if is_primary:
        for e in orb6_for_pair:
            if e.hip is None:
                continue
            if not _orb6_hip_matches_pair_coord(e.hip, pair, indices):
                continue
            candidate_hips.append(e.hip)
            # ``orb6_hip``: Gaia-published HIP xwalk is the canonical source.
            gaia = indices.hip_to_gaia.get(e.hip)
            if gaia is not None:
                return emit(gaia, "orb6_hip", e.hip)

    for hip in candidate_hips:
        gaia = _gaia_from_athyg_via_hip(hip, indices)
        if gaia is not None:
            return emit(gaia, "athyg_gaia_native", hip)

    # HIP-anchored prefix missed. Keep the first ORB6-published HIP (if
    # any) so Stage 3's HIP2 fallback can still attach astrometry for
    # stars Gaia couldn't observe — Sirius / α Cen-shaped saturated
    # primaries.
    return emit(None, "unresolved", candidate_hips[0] if candidate_hips else None)


# ─── SIMBAD-backed cross-ID path ─────────────────────────────────────


def resolve_via_simbad(
    components: list[ResolvedComponent],
    simbad_xids: dict[tuple[str, str], SimbadWdsXid],
) -> None:
    """Cascade pass following ``resolve_component`` and preceding
    ``resolve_via_position``. For every component still unresolved by
    the HIP-anchored prefix, look up ``(wds_id, component)`` in the
    SIMBAD WDS↔Gaia side-file and bind whichever cross-IDs SIMBAD
    carries. Mutates ``components`` in place.

    Binding rules:

    * SIMBAD has a Gaia DR3 source_id → set ``gaia_source_id``,
      rewrite ``resolve_via`` to ``simbad_xid``, and fill ``hip`` if
      SIMBAD has one and the component doesn't yet.
    * SIMBAD has a HIP but no Gaia (α Cen A/B-shaped saturation gap) →
      fill ``hip`` only; leave ``gaia_source_id`` ``None`` and
      ``resolve_via`` ``unresolved`` so Stage 3's HIP2 long-baseline
      fallback can route on the freshly-bound HIP.
    * SIMBAD doesn't have the component → leave it alone.

    Suffixed-HIP forms in SIMBAD (``HIP 55203A``) are filtered out by
    the refresh script (see ``refresh-simbad-wds-xids.py``); only
    plain-integer HIPs reach this map, so no ambiguity-handling is
    needed here.
    """
    for c in components:
        if c.gaia_source_id is not None:
            continue
        xid = simbad_xids.get((c.wds_id, c.component))
        if xid is None:
            continue
        if xid.gaia_source_id is not None:
            c.gaia_source_id = xid.gaia_source_id
            c.resolve_via = "simbad_xid"
            if c.hip is None and xid.hip is not None:
                c.hip = xid.hip
        elif xid.hip is not None and c.hip is None:
            c.hip = xid.hip


# ─── CCDM-anchored sibling-HIP path ──────────────────────────────────


# CCDM-anchored search tolerance. CCDM's candidate set is restricted to
# co-system HIPs (typically 1-3 stars per system), so a wider window
# stays unambiguous and absorbs the residual PM uncertainty that the
# stored AT-HYG position carries beyond what the J1991.25→J2000
# propagation corrects. Stays well below typical WDS inter-component
# separations for ``AB``/``AC``/``BC`` pairs.
CCDM_POSITION_MATCH_TOLERANCE_ARCSEC = 10.0


def _ccdm_candidate_hip_for_position(
    *, ra_deg: float, dec_deg: float,
    candidate_hips: list[int],
    indices: IdentifierIndices,
    tolerance_arcsec: float,
    target_epoch: float = WDS_PRECISE_COORD_EPOCH,
) -> int | None:
    """Pick the CCDM-sibling HIP whose AT-HYG row sits nearest to the
    given target position (within ``tolerance_arcsec``).

    Each candidate's AT-HYG position is PM-propagated to ``target_epoch``
    before comparison so HIP-sourced rows (effectively at J1991.25) are
    measured against the same epoch as the WDS precise_coord query.
    Returns ``None`` when no candidate has an AT-HYG row or none are
    within tolerance — Stage 2 then falls through to position-match.
    """
    threshold_chord_sq = _chord_sq_for_tolerance(tolerance_arcsec)
    qx, qy, qz = _spherical_to_unit_vec(ra_deg, dec_deg)
    best_hip: int | None = None
    best_chord_sq = float("inf")
    for hip in candidate_hips:
        row = indices.hip_to_athyg.get(hip)
        if row is None:
            continue
        ra_cand, dec_cand = _athyg_position_at_epoch(row, target_epoch)
        rx, ry, rz = _spherical_to_unit_vec(ra_cand, dec_cand)
        dx = rx - qx
        dy = ry - qy
        dz = rz - qz
        d_sq = dx * dx + dy * dy + dz * dz
        if d_sq < best_chord_sq:
            best_chord_sq = d_sq
            best_hip = hip
    if best_hip is None or best_chord_sq > threshold_chord_sq:
        return None
    return best_hip


def resolve_via_ccdm(
    components: list[ResolvedComponent],
    pairs: list[WdsPair],
    indices: IdentifierIndices,
    tolerance_arcsec: float = CCDM_POSITION_MATCH_TOLERANCE_ARCSEC,
) -> None:
    """Cascade pass following ``resolve_via_simbad`` and preceding
    ``resolve_via_position``. Resolves WDS components by anchoring on
    HIPs that share a CCDM identifier with the system. Mutates
    ``components`` in place — sets ``hip`` (always when a sibling
    matches) and, when possible, ``gaia_source_id`` + tags
    ``resolve_via`` as ``ccdm_hip``.

    Mechanism (per pair, primary then secondary):

    1. Look up ``indices.ccdm_to_hips[pair.wds_id]`` — the WDS system id
       and CCDM identifier follow the same positional convention, so
       this hits for the vast majority of multi-HIP CCDM systems.
    2. Exclude HIPs already claimed by the pair's primary (so the
       secondary slot can't reuse the primary's HIP).
    3. Primary: pick the candidate HIP whose PM-propagated AT-HYG
       position sits nearest the WDS precise_coord.
    4. Secondary: same, but against the (ρ, θ)-predicted secondary
       position. Skipped when ρ exceeds the WDS overflow sentinel — the
       prediction is meaningless at that separation and the CCDM
       sibling set is small enough that mis-attributing the wide
       companion would be silently wrong.
    5. Once a HIP is bound, surface ``gaia_source_id`` via the Gaia
       HIP xwalk → AT-HYG-native fall-through. Bare-HIP-only hits
       (Sirius-B-shaped: HIP exists, no Gaia source) still bind ``hip``
       so Stage 3's HIP2 fallback engages — but ``resolve_via`` stays
       ``unresolved`` because the Gaia source_id is the cascade's
       primary output.
    """
    if not indices.ccdm_to_hips:
        return

    pair_by_wds_disc = build_pair_by_wds_disc(pairs)

    # Pass 1 — primaries. Cache the HIP each primary claims so the
    # secondary pass can exclude it (CCDM systems with two HIPs would
    # otherwise both bind to whichever sibling sits nearest the
    # primary's coord).
    primary_hip_by_pair: dict[tuple[str, str, str], int] = {}
    for c in components:
        if c.gaia_source_id is not None or not c.is_primary:
            continue
        pair = find_owning_pair(c, pair_by_wds_disc)
        if pair is None or pair.precise_ra_deg is None or pair.precise_dec_deg is None:
            continue
        candidates = indices.ccdm_to_hips.get(pair.wds_id)
        if not candidates:
            continue
        # Prefer the HIP the component already carries forward (from
        # ORB6 or SIMBAD) — those bindings are stronger evidence than
        # any position-match could provide. The position-match path
        # only fires when the component has no HIP yet.
        if c.hip is not None and c.hip in candidates:
            primary_hip_by_pair[(c.wds_id, c.discoverer, pair.components)] = c.hip
            _bind_ccdm_hip(c, c.hip, indices)
            continue
        match_hip = _ccdm_candidate_hip_for_position(
            ra_deg=pair.precise_ra_deg, dec_deg=pair.precise_dec_deg,
            candidate_hips=candidates,
            indices=indices, tolerance_arcsec=tolerance_arcsec,
        )
        if match_hip is None:
            continue
        primary_hip_by_pair[(c.wds_id, c.discoverer, pair.components)] = match_hip
        _bind_ccdm_hip(c, match_hip, indices)

    # Pass 2 — secondaries. Use the WDS (ρ, θ) prediction to pick the
    # right CCDM sibling, excluding whichever HIP the primary claimed.
    # ρ = 0 sub-resolution pairs are skipped outright: the prediction
    # lands on the primary's own coordinate, so a nearest-sibling pick
    # is a coin flip that can bind another branch's HIP (1 Equ Ab
    # taking B's 103569). ``propagate_blend_identity`` gives those
    # secondaries the primary's identifiers instead.
    for c in components:
        if c.gaia_source_id is not None or c.is_primary:
            continue
        pair = find_owning_pair(c, pair_by_wds_disc)
        if (
            pair is None
            or pair.precise_ra_deg is None
            or pair.precise_dec_deg is None
            or pair.rho_last is None
            or pair.theta_last is None
            or pair.rho_last <= 0.0
        ):
            continue
        candidates = indices.ccdm_to_hips.get(pair.wds_id)
        if not candidates:
            continue
        primary_hip = primary_hip_by_pair.get(
            (c.wds_id, c.discoverer, pair.components),
        )
        narrowed = [h for h in candidates if h != primary_hip]
        if not narrowed:
            continue
        # Prefer the HIP the component already carries forward (SIMBAD
        # may have bound a per-component HIP without a Gaia source).
        if c.hip is not None and c.hip in narrowed:
            _bind_ccdm_hip(c, c.hip, indices)
            continue
        secondary_ra, secondary_dec = predict_secondary_position(
            pair.precise_ra_deg, pair.precise_dec_deg,
            pair.rho_last, pair.theta_last,
        )
        match_hip = _ccdm_candidate_hip_for_position(
            ra_deg=secondary_ra, dec_deg=secondary_dec,
            candidate_hips=narrowed,
            indices=indices, tolerance_arcsec=tolerance_arcsec,
        )
        if match_hip is None:
            continue
        _bind_ccdm_hip(c, match_hip, indices)


def _bind_ccdm_hip(
    c: ResolvedComponent, hip: int, indices: IdentifierIndices,
) -> None:
    """Helper: stamp ``hip`` onto ``c`` (if it has none yet) and try the
    HIP-anchored Gaia lookups. Tags ``resolve_via`` ``ccdm_hip`` when a
    Gaia source surfaces; leaves the tag as-is when only the HIP binds
    (Stage 3's HIP2 fallback still picks it up).
    """
    if c.hip is None:
        c.hip = hip
    gaia = indices.hip_to_gaia.get(hip)
    if gaia is None:
        gaia = _gaia_from_athyg_via_hip(hip, indices)
    if gaia is not None:
        c.gaia_source_id = gaia
        c.resolve_via = "ccdm_hip"


# ─── Position-match path ─────────────────────────────────────────────


# Position-match tolerance for the AT-HYG position branch. 2″ matches
# the bead's stated bar and is well below the typical AT-HYG inter-
# source separation away from the densest clusters. The match runs
# with ``target_epoch=WDS_PRECISE_COORD_EPOCH`` so high-PM rows whose
# J1991.25 stored ra/dec drift past 2″ at J2000 (α Cen, Sirius) still
# resolve through this tier.
ATHYG_POSITION_MATCH_TOLERANCE_ARCSEC = 2.0


def _propagate_position(
    ra_deg: float, dec_deg: float,
    pm_ra_masyr: float | None, pm_de_masyr: float | None,
    ref_epoch: float, target_epoch: float,
) -> tuple[float, float]:
    """Linear PM propagation of an ICRS position from ``ref_epoch`` to
    ``target_epoch`` (cos δ-applied μ_α*). Returns the position unchanged
    when either PM component is missing — no signal to propagate with, so
    the raw position is the best estimate."""
    if pm_ra_masyr is None or pm_de_masyr is None:
        return ra_deg, dec_deg
    dt = target_epoch - ref_epoch
    cos_dec = max(math.cos(math.radians(dec_deg)), 1e-3)
    delta_ra_deg = (pm_ra_masyr * dt) / (3600.0 * 1000.0 * cos_dec)
    delta_dec_deg = (pm_de_masyr * dt) / (3600.0 * 1000.0)
    return (ra_deg + delta_ra_deg) % 360.0, dec_deg + delta_dec_deg


def _athyg_position_at_epoch(
    row: AthygRow, target_epoch: float,
) -> tuple[float, float]:
    """Propagate ``row``'s ``(ra_deg, dec_deg)`` from ``ATHYG_REFERENCE_EPOCH``
    to ``target_epoch`` using the row's own PM.

    AT-HYG's documented epoch is J2000 but HIP-sourced rows are
    empirically at J1991.25 (the HIP1 catalog's native epoch); the
    propagation kicks low-PM rows by a fraction of an arcsec — well
    inside the 2″ tolerance — so the same call works correctly for the
    rows that are genuinely at J2000 too.
    """
    return _propagate_position(
        row.ra_deg, row.dec_deg, row.pm_ra_masyr, row.pm_de_masyr,
        ATHYG_REFERENCE_EPOCH, target_epoch,
    )


def _spherical_to_unit_vec(ra_deg: float, dec_deg: float) -> tuple[float, float, float]:
    """ICRS spherical (degrees) → unit vector on the celestial sphere.
    Chord distance squared between two such vectors is monotone with
    angular separation, so the squared dot/chord forms can be compared
    directly without trig in the hot loop.
    """
    ra_rad = math.radians(ra_deg)
    dec_rad = math.radians(dec_deg)
    c = math.cos(dec_rad)
    return c * math.cos(ra_rad), c * math.sin(ra_rad), math.sin(dec_rad)


def _chord_sq_for_tolerance(tolerance_arcsec: float) -> float:
    """Squared chord length on the unit sphere subtending ``tolerance_arcsec``.
    Monotone with angular separation, so a squared-chord comparison decides
    "within tolerance" without trig in the match hot loops."""
    return (2.0 * math.sin(math.radians(tolerance_arcsec / 3600.0) / 2.0)) ** 2


def _positions_within(
    ra1_deg: float, dec1_deg: float,
    ra2_deg: float, dec2_deg: float,
    tolerance_arcsec: float,
) -> bool:
    """True when two ICRS positions lie within ``tolerance_arcsec``."""
    ax, ay, az = _spherical_to_unit_vec(ra1_deg, dec1_deg)
    bx, by, bz = _spherical_to_unit_vec(ra2_deg, dec2_deg)
    dx, dy, dz = ax - bx, ay - by, az - bz
    return dx * dx + dy * dy + dz * dz <= _chord_sq_for_tolerance(tolerance_arcsec)


def build_athyg_position_grid(
    athyg: list[AthygRow],
) -> dict[tuple[int, int], list[int]]:
    """Bucket AT-HYG rows by ``(int(ra_deg) % 360, int(dec_deg) + 90)`` —
    1°×1° cells with the dec axis shifted into ``[0, 180)`` so the key is
    always non-negative. Cell occupancy averages ~5 rows; the query walks
    a 3-cell-tall dec strip whose ra width is widened by ``1/cos(dec)``
    so the search radius stays consistent at high declinations.
    """
    grid: dict[tuple[int, int], list[int]] = {}
    for i, row in enumerate(athyg):
        key = (int(row.ra_deg) % 360, int(row.dec_deg) + 90)
        grid.setdefault(key, []).append(i)
    return grid


def find_nearest_athyg_at_position(
    ra_deg: float,
    dec_deg: float,
    grid: dict[tuple[int, int], list[int]],
    athyg: list[AthygRow],
    tol_arcsec: float,
    exclude_idx: int | None = None,
    target_epoch: float | None = None,
) -> int | None:
    """Return the AT-HYG list index nearest to ``(ra_deg, dec_deg)`` within
    ``tol_arcsec`` (or ``None`` if no row is within tolerance).

    ``exclude_idx`` skips a known row — used when matching a secondary
    component so the primary's own AT-HYG row cannot win.

    ``target_epoch`` (when set) PM-propagates each candidate's stored
    ``ra``/``dec`` from ``ATHYG_REFERENCE_EPOCH`` to ``target_epoch``
    before measuring distance. Required for high-PM HIP-sourced rows
    (α Cen ≈ -3614 mas/yr) whose stored position is at J1991.25 — the
    raw J1991.25 ra/dec sits ~tens-to-hundreds of arcsec from the WDS
    J2000 precise_coord, and the 2″ tolerance silently misses without
    propagation. Rows without PM stay at their raw position (the
    propagation step is a no-op).

    The grid search widens vertically by ``epoch_search_pad`` rows to
    pull in high-PM stars whose J1991.25 position has since drifted
    out of the 1° dec cell anchored at the query.
    """
    cos_dec = max(math.cos(math.radians(dec_deg)), 1e-3)
    # Widen the RA window proportionally to 1/cos(dec) — and a touch
    # further when PM-propagating, so a high-PM star whose J1991.25
    # position sits in a neighbouring cell still surfaces as a
    # candidate before its PM correction is applied.
    base_ra_window = max(1, int(math.ceil(1.0 / cos_dec)))
    epoch_pad = 1 if target_epoch is not None else 0
    ra_window = base_ra_window + epoch_pad
    dec_pad = 1 + epoch_pad
    base_ra = int(ra_deg) % 360
    base_dec = int(dec_deg) + 90
    qx, qy, qz = _spherical_to_unit_vec(ra_deg, dec_deg)
    threshold_chord_sq = _chord_sq_for_tolerance(tol_arcsec)

    best_idx: int | None = None
    best_chord_sq = float("inf")
    for ddec in range(-dec_pad, dec_pad + 1):
        dec_key = base_dec + ddec
        for dra in range(-ra_window, ra_window + 1):
            ra_key = (base_ra + dra) % 360
            for i in grid.get((ra_key, dec_key), ()):
                if i == exclude_idx:
                    continue
                if target_epoch is not None:
                    ra_cand, dec_cand = _athyg_position_at_epoch(athyg[i], target_epoch)
                else:
                    ra_cand, dec_cand = athyg[i].ra_deg, athyg[i].dec_deg
                rx, ry, rz = _spherical_to_unit_vec(ra_cand, dec_cand)
                dx = rx - qx
                dy = ry - qy
                dz = rz - qz
                d_sq = dx * dx + dy * dy + dz * dz
                if d_sq < best_chord_sq:
                    best_chord_sq = d_sq
                    best_idx = i
    if best_idx is None or best_chord_sq > threshold_chord_sq:
        return None
    return best_idx


def predict_secondary_position(
    primary_ra_deg: float,
    primary_dec_deg: float,
    rho_arcsec: float,
    theta_deg: float,
) -> tuple[float, float]:
    """Offset a primary's ICRS position by the WDS (ρ, θ) pair last-seen
    relative motion — θ measured east of north, ρ in arcseconds. The
    small-offset approximation is fine at WDS separations (<1000″ for
    the vast majority of pairs); larger separations are rare and the
    secondary is usually individually catalogued in AT-HYG.
    """
    theta_rad = math.radians(theta_deg)
    rho_deg = rho_arcsec / 3600.0
    new_dec = primary_dec_deg + rho_deg * math.cos(theta_rad)
    cos_dec = max(math.cos(math.radians(primary_dec_deg)), 1e-3)
    new_ra = (primary_ra_deg + (rho_deg * math.sin(theta_rad)) / cos_dec) % 360.0
    return new_ra, new_dec


def build_pair_by_wds_disc(
    pairs: list[WdsPair],
) -> dict[tuple[str, str], list[WdsPair]]:
    """Bucket WDS pairs by ``(wds_id, discoverer)`` — the canonical
    component-letter-to-pair lookup key. For typical WDS_SUMM data each
    bucket holds one pair, so per-component lookup via
    ``find_owning_pair`` is O(1) in practice.
    """
    out: dict[tuple[str, str], list[WdsPair]] = {}
    for p in pairs:
        out.setdefault((p.wds_id, p.discoverer), []).append(p)
    return out


def find_owning_pair(
    c: ResolvedComponent,
    pair_by_wds_disc: dict[tuple[str, str], list[WdsPair]],
) -> WdsPair | None:
    """Resolve a component back to the WDS pair whose components-string
    decomposition assigns this letter to the matching primary/secondary
    slot. Returns ``None`` if no such pair exists in the index.
    """
    slot = 0 if c.is_primary else 1
    for p in pair_by_wds_disc.get((c.wds_id, c.discoverer), ()):
        split = split_components(p.components)
        if split is not None and split[slot] == c.component:
            return p
    return None


@dataclass(frozen=True)
class PairAthygMatchEvent:
    """One AT-HYG position-match hit emitted by ``iter_pair_athyg_matches``.

    ``is_blend_inherit`` is ``True`` only for the secondary blend-fallback
    branch (secondary's own predicted-position match missed AND the
    caller opted into blend inheritance via ``allow_blend_inherit``).
    """

    component_idx: int
    athyg_match_idx: int
    is_blend_inherit: bool


def match_athyg_position_either_epoch(
    *,
    ra_deg: float,
    dec_deg: float,
    grid: dict[tuple[int, int], list[int]],
    athyg: list[AthygRow],
    tolerance_arcsec: float,
    exclude_idx: int | None = None,
) -> int | None:
    """Position-match AT-HYG trying PM-propagated J1991.25→J2000 first,
    then unpropagated. Propagated wins on tie. See
    ``scripts/binaries/README.md`` § Stage 2 / Stage 3 for the
    GJ-vs-HIP epoch convention rationale that makes the dual pass
    necessary.
    """
    propagated = find_nearest_athyg_at_position(
        ra_deg, dec_deg, grid, athyg, tolerance_arcsec,
        exclude_idx=exclude_idx,
        target_epoch=WDS_PRECISE_COORD_EPOCH,
    )
    if propagated is not None:
        return propagated
    return find_nearest_athyg_at_position(
        ra_deg, dec_deg, grid, athyg, tolerance_arcsec,
        exclude_idx=exclude_idx,
        target_epoch=None,
    )


def iter_pair_athyg_matches(
    components: list[ResolvedComponent],
    pairs: list[WdsPair],
    athyg: list[AthygRow],
    *,
    skip_predicate: Callable[[int, ResolvedComponent], bool],
    match_fn: Callable[..., int | None] = match_athyg_position_either_epoch,
    allow_blend_inherit: bool,
    tolerance_arcsec: float = ATHYG_POSITION_MATCH_TOLERANCE_ARCSEC,
) -> Iterator[PairAthygMatchEvent]:
    """Walk the WDS-pair → AT-HYG position-match cascade and yield one
    event per component whose match succeeds, in primary-then-secondary
    order. The secondary pass excludes the primary's matched row so a
    close-binary primary cannot claim its own secondary slot, and skips
    the predicted-secondary path when ρ is None — the WDS overflow
    sentinel (999.9) is collapsed to None at parse, so ultra-wide pairs
    whose (ρ, θ) is degenerate fall through to identifier binding.

    Shared between Stage 2's ``resolve_via_position`` (identifier
    binding) and Stage 3's ``attach_athyg_position_fallback`` (astrometry
    synthesis). Per-stage knobs:

    - ``skip_predicate(i, c)``: components that should NOT participate.
      Stage 2 skips already-resolved (gaia_source_id bound) components;
      Stage 3 skips components whose astrometry is already non-unresolved.
    - ``match_fn``: how to position-match against AT-HYG. Defaults to
      ``match_athyg_position_either_epoch`` (propagated then unpropagated).
    - ``allow_blend_inherit``: when ``True``, yield a blend-inherit event
      for secondaries whose own predicted-position match missed but
      whose primary did match. Stage 3 opts in (Hipparcos-unresolved
      blends share one AT-HYG row); Stage 2 opts out (the secondary
      would otherwise inherit the primary's Gaia source).
    """
    grid = build_athyg_position_grid(athyg)
    pair_by_wds_disc = build_pair_by_wds_disc(pairs)
    primary_idx_by_pair: dict[tuple[str, str, str], int] = {}

    # Pass 1 — primaries. Cache the matched AT-HYG row per pair so the
    # secondary pass can exclude it.
    for i, c in enumerate(components):
        if skip_predicate(i, c) or not c.is_primary:
            continue
        pair = find_owning_pair(c, pair_by_wds_disc)
        if pair is None or pair.precise_ra_deg is None or pair.precise_dec_deg is None:
            continue
        match_idx = match_fn(
            ra_deg=pair.precise_ra_deg, dec_deg=pair.precise_dec_deg,
            grid=grid, athyg=athyg, tolerance_arcsec=tolerance_arcsec,
            exclude_idx=None,
        )
        if match_idx is None:
            continue
        primary_idx_by_pair[(c.wds_id, c.discoverer, pair.components)] = match_idx
        yield PairAthygMatchEvent(
            component_idx=i, athyg_match_idx=match_idx, is_blend_inherit=False,
        )

    # Pass 2 — secondaries. Predict position from primary + (ρ, θ),
    # exclude the primary's AT-HYG row. Optionally fall back to the
    # primary's row when the secondary's own match misses. Skipped for
    # ρ = 0 sub-resolution pairs: the prediction lands on the primary's
    # own coordinate, and with the primary's row excluded the nearest
    # match can only be a DIFFERENT component's row (1 Equ Ab taking
    # B's AT-HYG entry — wrong HIP, wrong photometry); the blend-inherit
    # branch below is the correct outcome for those pairs.
    for i, c in enumerate(components):
        if skip_predicate(i, c) or c.is_primary:
            continue
        pair = find_owning_pair(c, pair_by_wds_disc)
        if pair is None or pair.precise_ra_deg is None or pair.precise_dec_deg is None:
            continue
        primary_idx = primary_idx_by_pair.get(
            (c.wds_id, c.discoverer, pair.components),
        )
        secondary_match: int | None = None
        if (
            pair.rho_last is not None
            and pair.theta_last is not None
            and pair.rho_last > 0.0
        ):
            secondary_ra, secondary_dec = predict_secondary_position(
                pair.precise_ra_deg, pair.precise_dec_deg,
                pair.rho_last, pair.theta_last,
            )
            secondary_match = match_fn(
                ra_deg=secondary_ra, dec_deg=secondary_dec,
                grid=grid, athyg=athyg, tolerance_arcsec=tolerance_arcsec,
                exclude_idx=primary_idx,
            )
        if secondary_match is not None:
            yield PairAthygMatchEvent(
                component_idx=i, athyg_match_idx=secondary_match,
                is_blend_inherit=False,
            )
            continue
        if allow_blend_inherit and primary_idx is not None:
            yield PairAthygMatchEvent(
                component_idx=i, athyg_match_idx=primary_idx,
                is_blend_inherit=True,
            )


def resolve_via_position(
    components: list[ResolvedComponent],
    pairs: list[WdsPair],
    athyg: list[AthygRow],
    tolerance_arcsec: float = ATHYG_POSITION_MATCH_TOLERANCE_ARCSEC,
) -> None:
    """Cascade pass following ``resolve_via_simbad``. For components
    still unresolved after the HIP-anchored prefix and the SIMBAD-backed
    cross-ID pass, position-matches WDS precise coordinates into AT-HYG
    and reads the resulting row's natively-stored gaia field. Mutates
    ``components`` in place — sets ``gaia_source_id`` and rewrites
    ``resolve_via`` from ``unresolved`` to ``athyg_gaia_native`` on hit.

    The pair-iteration cascade (primary match, predicted-secondary
    match with primary-exclusion) is shared with Stage 3's
    ``attach_athyg_position_fallback`` via ``iter_pair_athyg_matches``.
    Stage 2 opts out of secondary blend-inheritance because binding the
    secondary to the primary's AT-HYG row would also propagate the
    primary's Gaia source onto the secondary slot.
    """
    for event in iter_pair_athyg_matches(
        components, pairs, athyg,
        skip_predicate=lambda _i, c: c.gaia_source_id is not None,
        allow_blend_inherit=False,
        tolerance_arcsec=tolerance_arcsec,
    ):
        c = components[event.component_idx]
        row = athyg[event.athyg_match_idx]
        if c.athyg_row is None:
            c.athyg_row = row
        if c.hip is None and row.hip is not None:
            c.hip = row.hip
        if row.gaia is not None:
            c.gaia_source_id = row.gaia
            c.resolve_via = "athyg_gaia_native"


def resolve_all_pairs(
    pairs: list[WdsPair],
    orb6: list[Orb6Entry],
    indices: IdentifierIndices,
    athyg: list[AthygRow],
    simbad_xids: dict[tuple[str, str], SimbadWdsXid] | None = None,
    position_tolerance_arcsec: float = ATHYG_POSITION_MATCH_TOLERANCE_ARCSEC,
) -> list[ResolvedComponent]:
    """Run Stage 2's full resolution chain over every WDS pair that
    decomposes into two components. System-level rows (empty
    ``components``) and rows we cannot split are skipped. Cascade
    strategies and order are canonicalised in ``RESOLVE_VIA_VALUES``.

    1. ``resolve_component`` runs the HIP-anchored prefix:
       ``orb6_hip`` (primary's ORB6 HIP → Gaia xwalk) then
       ``athyg_gaia_native`` (HIP-mediated AT-HYG lookup).
    2. ``resolve_via_simbad`` runs the SIMBAD-backed cross-ID pass
       against the committed ``data/simbad/simbad_wds_xids.tsv`` side-file —
       tagged ``simbad_xid``. Skipped when ``simbad_xids`` is empty /
       absent (the in-process tests pass ``None``).
    3. ``resolve_via_ccdm`` consults the Hipparcos CCDM annex for
       sibling HIPs co-resident in the WDS system, position-matches
       against the candidate-restricted set, then routes the matched
       HIP through the same Gaia xwalk / AT-HYG-native paths —
       tagged ``ccdm_hip``. Skipped when ``indices.ccdm_to_hips`` is
       empty (tests can pass ``ccdm=None`` to ``build_indices``).
    4. ``resolve_via_position`` runs the AT-HYG position-match pass
       (PM-propagated, null-ρ short-circuited) — tagged
       ``athyg_gaia_native`` (the same tag as branch 1's HIP-mediated
       AT-HYG read because both routes land on AT-HYG's natively-stored
       gaia field; the ``position_pm`` / ``position_nopm`` tags are
       reserved for a future PM-propagated match against
       ``data/gaia/gaia_dr3_astrometry.tsv``).
    5. ``propagate_within_system`` copies a resolved letter binding
       (and any HIP it carries) across every pair row that shares the
       same ``(wds_id, letter)``, plus an ``Aa → A`` hierarchy step
       for WDS subcomponents that share a Gaia source with the parent.
    6. ``propagate_blend_identity`` gives the still-unbound secondary
       of every ρ = 0 sub-resolution pair its primary's identifiers
       (the WDS blend convention), then ``propagate_within_system``
       re-runs so the blend binding reaches the letter's other pair
       rows.
    """
    orb6_by_pair = group_orb6_by_pair(orb6)
    out: list[ResolvedComponent] = []
    for pair in pairs:
        split = split_components(pair.components)
        if split is None:
            continue
        primary, secondary = split
        orb6_for_pair = orb6_by_pair.get((pair.wds_id, pair.components), [])
        out.append(resolve_component(
            pair, primary, is_primary=True,
            orb6_for_pair=orb6_for_pair, indices=indices,
        ))
        out.append(resolve_component(
            pair, secondary, is_primary=False,
            orb6_for_pair=orb6_for_pair, indices=indices,
        ))
    if simbad_xids:
        resolve_via_simbad(components=out, simbad_xids=simbad_xids)
    resolve_via_ccdm(components=out, pairs=pairs, indices=indices)
    resolve_via_position(
        components=out, pairs=pairs, athyg=athyg,
        tolerance_arcsec=position_tolerance_arcsec,
    )
    propagate_within_system(out)
    if propagate_blend_identity(out, pairs) > 0:
        propagate_within_system(out)
    return out


def propagate_blend_identity(
    components: list[ResolvedComponent],
    pairs: list[WdsPair],
) -> int:
    """ρ = 0 sub-resolution pairs are a single photocentre: WDS
    publishes the pair but no astrometric instrument separates the
    components, so the secondary's identifiers ARE the primary's
    (Castor CIA 29 Aa,Ab lists HIP 36850 on both sides). The
    position-match passes all skip these pairs — the (ρ, θ) prediction
    is degenerate at ρ = 0 — so a secondary that bound nothing of its
    own would otherwise surface no identity and no photometry at all
    (Capella Ab). Copies gaia / hip / AT-HYG row (and the primary's
    ``resolve_via`` when the Gaia source transfers) onto every such
    secondary; returns the number seeded. Secondaries carrying ANY
    binding of their own are left untouched — real per-component
    evidence beats the blend convention.
    """
    n = 0
    for pair, primary, secondary in iter_decomposing_pair_components(
        pairs, components,
    ):
        if pair.rho_last is None or pair.rho_last > 0.0:
            continue
        if (
            secondary.gaia_source_id is not None
            or secondary.hip is not None
            or secondary.athyg_row is not None
        ):
            continue
        if primary.gaia_source_id is None and primary.hip is None and primary.athyg_row is None:
            continue
        secondary.gaia_source_id = primary.gaia_source_id
        secondary.hip = primary.hip
        secondary.athyg_row = primary.athyg_row
        if primary.gaia_source_id is not None:
            secondary.resolve_via = primary.resolve_via
        n += 1
    return n


_SUBCOMPONENT_LETTER_RE = re.compile(r"^([A-Z])[a-z]+$")


def _parent_letter(component: str) -> str | None:
    """For a WDS sub-component letter like ``"Aa"`` or ``"Bbc"``, return
    the parent letter (``"A"`` / ``"B"``). Returns ``None`` for bare
    single-letter components and for forms the regex does not match.

    The propagation pass uses this so an ``A`` component without its
    own binding can inherit ``Aa``'s — Gaia rarely resolves the
    subcomponents separately (Aa+Ab share one Gaia source whose light
    centroid sits at the brighter Aa), so propagating the binding from
    Aa to A is correct in practice for the spectroscopic-companion
    cases (e.g. Castor STF1110 A inheriting from CIA 29 Aa).
    """
    match = _SUBCOMPONENT_LETTER_RE.match(component)
    if match is None:
        return None
    return match.group(1)


def propagate_within_system(components: list[ResolvedComponent]) -> None:
    """Within each WDS system, the same component letter always refers
    to the same physical star (e.g. component A of WDS 00491+5749 is η
    Cas A whether it appears in the AB, AC, AD, …, AH pair rows). When
    one pair's A primary resolves but the other A primaries can't
    (their pair has no ORB6 entry and the WDS precise coord drift
    exceeds the 2″ position tolerance), this pass copies the resolved
    binding forward. The inherited ``resolve_via`` classification is
    preserved so the per-tier counts log the strategy that actually
    fetched the source_id, not a synthetic propagation tag.

    When more than one pair row in the same system resolves the
    same letter through different strategies (e.g. one A hits
    ``orb6_hip`` while another A hits ``simbad_xid``), the canonical
    binding is the highest-priority tag per ``RESOLVE_VIA_PRIORITY``,
    not whichever happened to iterate first. The underlying
    ``gaia_source_id`` is identical either way — same letter / same
    physical star — only the tag the cascade counter sees differs.

    HIP propagation runs alongside source_id propagation but is
    independent: a saturated bright primary (Sirius / α Cen) has no
    Gaia source_id to propagate but still surfaces its HIP across
    every pair row in the system so Stage 3's HIP2 fallback engages
    consistently across the wide companions too. No priority ordering
    exists across HIP sources, so first-write-wins is correct.

    A second pass handles the WDS sub-component letter hierarchy:
    when a bare letter ``A`` is unresolved but ``Aa`` (its brighter
    spectroscopic sub-component) is, ``A`` inherits ``Aa``'s binding.
    Gaia cannot resolve sub-arcsec sub-components, so ``A``/``Aa``/
    ``Ab`` typically share the single Gaia source whose centroid sits
    at the brighter ``Aa``. Castor STF1110 A inheriting from CIA 29
    Aa is the canonical case.
    """
    by_system_letter: dict[tuple[str, str], tuple[int, str]] = {}
    hip_by_system_letter: dict[tuple[str, str], int] = {}
    for c in components:
        key = (c.wds_id, c.component)
        if c.gaia_source_id is not None:
            cur = by_system_letter.get(key)
            if cur is None or RESOLVE_VIA_PRIORITY[c.resolve_via] < RESOLVE_VIA_PRIORITY[cur[1]]:
                by_system_letter[key] = (c.gaia_source_id, c.resolve_via)
        if c.hip is not None:
            hip_by_system_letter.setdefault(key, c.hip)
    for c in components:
        key = (c.wds_id, c.component)
        if c.gaia_source_id is None:
            binding = by_system_letter.get(key)
            if binding is not None:
                c.gaia_source_id, c.resolve_via = binding
        if c.hip is None:
            hip = hip_by_system_letter.get(key)
            if hip is not None:
                c.hip = hip

    # Letter-hierarchy pass: bare ``A`` inherits from sub-component
    # ``Aa`` (likewise ``B``/``Ba``, ``C``/``Ca``). The reverse
    # direction (``Aa`` ← ``A``) is intentionally NOT propagated —
    # ``A`` is a coarser slot that may not match the brighter Aa's
    # source if a future pipeline resolved Aa and Ab separately.
    sub_by_system_parent: dict[tuple[str, str], tuple[int, str]] = {}
    sub_hip_by_system_parent: dict[tuple[str, str], int] = {}
    for c in components:
        parent = _parent_letter(c.component)
        if parent is None:
            continue
        key = (c.wds_id, parent)
        if c.gaia_source_id is not None:
            cur = sub_by_system_parent.get(key)
            if cur is None or RESOLVE_VIA_PRIORITY[c.resolve_via] < RESOLVE_VIA_PRIORITY[cur[1]]:
                sub_by_system_parent[key] = (c.gaia_source_id, c.resolve_via)
        if c.hip is not None:
            sub_hip_by_system_parent.setdefault(key, c.hip)
    for c in components:
        if c.component != c.component.upper() or len(c.component) != 1:
            # Only the bare single-letter parents inherit; sub-components
            # (Aa, Ab, …) skip this pass.
            continue
        key = (c.wds_id, c.component)
        if c.gaia_source_id is None:
            binding = sub_by_system_parent.get(key)
            if binding is not None:
                c.gaia_source_id, c.resolve_via = binding
        if c.hip is None:
            hip = sub_hip_by_system_parent.get(key)
            if hip is not None:
                c.hip = hip


def resolution_counts(
    components: list[ResolvedComponent],
) -> dict[str, int]:
    """Per-strategy counters in canonical ``RESOLVE_VIA_VALUES`` order.
    Every key present so the log line shape stays stable across runs."""
    counts: dict[str, int] = {k: 0 for k in RESOLVE_VIA_VALUES}
    for c in components:
        counts[c.resolve_via] = counts.get(c.resolve_via, 0) + 1
    return counts


def write_astrometry_request(
    components: list[ResolvedComponent], path: Path,
) -> int:
    """Emit the deduped union of every Gaia source_id Stage 2 resolved,
    across every tier in ``RESOLVE_VIA_VALUES``.

    ``scripts/refresh/refresh-gaia-astrometry.py`` reads this file to
    drive its ADQL ``WHERE source_id IN (...)`` query — so Stage 3
    onward has 5-parameter Gaia astrometry for exactly the sources we
    resolved here.
    """
    ids = sorted({c.gaia_source_id for c in components if c.gaia_source_id is not None})
    with path.open("w") as fh:
        fh.write("gaia_source_id\n")
        for sid in ids:
            fh.write(f"{sid}\n")
    return len(ids)


# ─── Stage-2 binding-integrity audit + geometric arbitration ─────────
# Detects the contradictions the cascade + propagation can leave (one
# source on disjoint letters; one letter on disjoint sources) and
# arbitrates them against WDS (ρ, θ) geometry. See
# ``scripts/binaries/README.md`` § Binding-integrity audit.

BINDING_SHAPE_SOURCE_LETTERS = "source_letters"
BINDING_SHAPE_LETTER_SOURCES = "letter_sources"

BINDING_VERDICT_GEOMETRIC = "geometric"
BINDING_VERDICT_UNBOUND_AMBIGUOUS = "unbound_ambiguous"
BINDING_VERDICT_SKIPPED_NO_REFERENCE = "skipped_no_reference"

# Canonical outcome tags, in the order the Stage-7 counters report them.
BINDING_VERDICT_VALUES: tuple[str, ...] = (
    BINDING_VERDICT_GEOMETRIC,
    BINDING_VERDICT_UNBOUND_AMBIGUOUS,
    BINDING_VERDICT_SKIPPED_NO_REFERENCE,
)

# The five report-only headline counters, in snapshot order — two
# conflict-shape totals then the three arbitration outcomes.
# ``binding_integrity_counts`` fills these keys; Stage 7 pins them.
BINDING_INTEGRITY_COUNT_KEYS: tuple[str, ...] = (
    "binding_conflicts_source_letters",
    "binding_conflicts_letter_sources",
    "arbitrated_geometric",
    "arbitrated_unbound_ambiguous",
    "arbitration_skipped_no_reference",
)

# Decisiveness thresholds. A winning candidate's positional error must be
# small in absolute terms (``max(2.0", 0.15·predicted_sep)`` — a floor
# for tight pairs, a fraction for wide ones) AND clearly beat the
# runner-up (``≤ 0.5·err_runnerup``). Failing either → ambiguous, and the
# conservative response is to unbind every contested binding rather than
# guess.
ARBITRATION_ABS_TOLERANCE_ARCSEC = 2.0
ARBITRATION_SEP_FRACTION = 0.15
ARBITRATION_RUNNERUP_FACTOR = 0.5

_UPPERCASE_LETTER_RE = re.compile(r"[A-Z]")


def _token_letters(tok: str) -> frozenset[str]:
    """Uppercase component letters in a token: ``"AB" → {A, B}``,
    ``"Aa1" → {A}``. Used for the compound-containment relation."""
    return frozenset(_UPPERCASE_LETTER_RE.findall(tok))


def _is_hier_ancestor(a: str, b: str) -> bool:
    """True when ``a`` is a strict ancestor of ``b`` in the WDS component
    hierarchy (``A`` ← ``Aa`` ← ``Aa1``). Defined only for canonical
    single-component tokens; compound tokens (``AB``) never enter the
    chain — their overlap is expressed by compound-containment instead."""
    if not is_component_token(a) or not is_component_token(b):
        return False
    cur = parent_component_token(b)
    while cur is not None:
        if cur == a:
            return True
        cur = parent_component_token(cur)
    return False


def _related_hier(a: str, b: str) -> bool:
    """Equal, or one is an ancestor of the other."""
    return a == b or _is_hier_ancestor(a, b) or _is_hier_ancestor(b, a)


def _compound_contains(a: str, b: str) -> bool:
    """One token is a multi-letter compound whose letters include the
    other's (``"AB"`` contains ``"A"`` and ``"Aa"``)."""
    la, lb = _token_letters(a), _token_letters(b)
    if len(la) >= 2 and lb and lb <= la:
        return True
    if len(lb) >= 2 and la and la <= lb:
        return True
    return False


def _are_pair_mates(
    x: str, y: str, blend_pairs: list[tuple[str, str]],
) -> bool:
    """True when ``x`` and ``y`` are the two sides of a sub-resolution
    blend pair — the legitimate WDS convention where one Gaia photocentre
    is shared because the components are unresolved (ρ = 0). A pair with a
    *measured* separation is NOT a blend: two letters at a measured ρ > 0
    cannot be one source, so those rows are excluded here and left to
    geometric arbitration. Matched transitively through ancestors —
    ``A``/``B`` are blend-mates when a (Aa, Bx) sub-pair blends, since
    ``A`` roots ``Aa`` and ``B`` roots ``Bx``."""
    for p, s in blend_pairs:
        if (_related_hier(x, p) and _related_hier(y, s)) or (
            _related_hier(x, s) and _related_hier(y, p)
        ):
            return True
    return False


def _tokens_related(
    x: str, y: str, blend_pairs: list[tuple[str, str]],
) -> bool:
    """Two tokens are NOT a contradiction when they are hierarchy-related,
    compound-contained, or sub-resolution blend-mates. Everything else is
    a disjoint pair that one source cannot occupy."""
    return (
        _related_hier(x, y)
        or _compound_contains(x, y)
        or _are_pair_mates(x, y, blend_pairs)
    )


@dataclass
class _SystemContext:
    """Per-WDS-system view assembled for the binding-integrity audit."""

    wds_id: str
    token_sources: dict[str, set[int]] = field(default_factory=dict)
    token_mag: dict[str, float] = field(default_factory=dict)
    # Two sides of every sub-resolution (ρ = 0) pair — the blend-mate
    # exemption set. Measured-separation pairs are deliberately absent.
    blend_pairs: list[tuple[str, str]] = field(default_factory=list)
    # adj[a][b] = (E, N, epoch): tangent-plane offset arcsec of b from a.
    adj: dict[str, dict[str, tuple[float, float, float | None]]] = field(
        default_factory=dict,
    )
    instances: dict[str, list[ResolvedComponent]] = field(default_factory=dict)


def _canonical_token(primary_tok: str, comp: ResolvedComponent) -> str:
    """Canonical token for one component instance — expands a WDS
    prefix-truncated secondary (``"2" → "Aa2"``) against its primary."""
    if comp.is_primary:
        return comp.component
    return expand_wds_truncated_secondary(primary_tok, comp.component)


def _add_edge(
    ctx: _SystemContext, a: str, b: str,
    e_arcsec: float, n_arcsec: float, epoch: float | None,
) -> None:
    """Register a bidirectional geometry edge, keeping the most-recent
    measurement when the same token pair recurs across discoverers."""
    for src, dst, ee, nn in ((a, b, e_arcsec, n_arcsec), (b, a, -e_arcsec, -n_arcsec)):
        nbrs = ctx.adj.setdefault(src, {})
        existing = nbrs.get(dst)
        if existing is not None:
            old_epoch = existing[2]
            if not (epoch is not None and (old_epoch is None or epoch >= old_epoch)):
                continue
        nbrs[dst] = (ee, nn, epoch)


def build_system_contexts(
    pairs: list[WdsPair], components: list[ResolvedComponent],
) -> dict[str, _SystemContext]:
    """Group every decomposing pair's two resolved components by WDS
    system, recording per-token source bindings, WDS (ρ, θ) geometry
    edges (E = ρ·sin θ, N = ρ·cos θ), and the pair-mate token list the
    contradiction relations consult."""
    systems: dict[str, _SystemContext] = {}
    for pair, primary, secondary in iter_decomposing_pair_components(
        pairs, components,
    ):
        ctx = systems.setdefault(pair.wds_id, _SystemContext(pair.wds_id))
        p_tok = primary.component
        s_tok = _canonical_token(p_tok, secondary)
        if pair.rho_last is None or pair.rho_last == 0.0:
            ctx.blend_pairs.append((p_tok, s_tok))
        for tok, comp, mag in (
            (p_tok, primary, pair.mag_pri),
            (s_tok, secondary, pair.mag_sec),
        ):
            ctx.instances.setdefault(tok, []).append(comp)
            if comp.gaia_source_id is not None:
                ctx.token_sources.setdefault(tok, set()).add(comp.gaia_source_id)
            if mag is not None and mag < ctx.token_mag.get(tok, math.inf):
                ctx.token_mag[tok] = mag
        if (
            pair.rho_last is not None
            and pair.theta_last is not None
            and pair.rho_last > 0.0
        ):
            theta_rad = math.radians(pair.theta_last)
            e = pair.rho_last * math.sin(theta_rad)
            n = pair.rho_last * math.cos(theta_rad)
            epoch = float(pair.date_last) if pair.date_last is not None else None
            _add_edge(ctx, p_tok, s_tok, e, n, epoch)
    return systems


def _bfs_offset(
    adj: dict[str, dict[str, tuple[float, float, float | None]]],
    start: str, goal: str,
) -> tuple[float, float, float | None] | None:
    """Compose tangent-plane offset vectors along the shortest-hop WDS
    geometry chain from ``start`` to ``goal``. Returns ``(E, N, epoch)``
    where ``epoch`` is the WDS measurement year of the final edge (the
    one touching ``goal``), or ``None`` when no chain connects them."""
    if start == goal:
        return 0.0, 0.0, None
    visited = {start}
    queue: deque[tuple[str, float, float]] = deque([(start, 0.0, 0.0)])
    while queue:
        tok, e, n = queue.popleft()
        for nbr, (de, dn, ep) in adj.get(tok, {}).items():
            if nbr in visited:
                continue
            ne, nn = e + de, n + dn
            if nbr == goal:
                return ne, nn, ep
            visited.add(nbr)
            queue.append((nbr, ne, nn))
    return None


def _tangent_offset(
    ra_deg: float, dec_deg: float, ra0_deg: float, dec0_deg: float,
) -> tuple[float, float]:
    """Small-angle tangent-plane offset (E, N) arcsec of ``(ra, dec)``
    from the reference ``(ra0, dec0)``."""
    dra = ((ra_deg - ra0_deg + 180.0) % 360.0) - 180.0
    cos_d = math.cos(math.radians(dec0_deg))
    return dra * cos_d * 3600.0, (dec_deg - dec0_deg) * 3600.0


def _source_offset_at_epoch(
    src: GaiaAstrometryRow, ref: GaiaAstrometryRow, target_epoch: float | None,
) -> tuple[float, float]:
    """Gaia offset (E, N) arcsec of ``src`` from ``ref``. When
    ``target_epoch`` is set both positions are PM-propagated there first;
    otherwise the native Gaia positions (both J2016.0) are used."""
    if target_epoch is None:
        return _tangent_offset(src.ra_deg, src.dec_deg, ref.ra_deg, ref.dec_deg)
    s_ra, s_dec = _propagate_position(
        src.ra_deg, src.dec_deg, src.pmra_masyr, src.pmdec_masyr,
        src.ref_epoch, target_epoch,
    )
    r_ra, r_dec = _propagate_position(
        ref.ra_deg, ref.dec_deg, ref.pmra_masyr, ref.pmdec_masyr,
        ref.ref_epoch, target_epoch,
    )
    return _tangent_offset(s_ra, s_dec, r_ra, r_dec)


def _arbitration_error(
    src: GaiaAstrometryRow, ref: GaiaAstrometryRow,
    predicted: tuple[float, float], edge_epoch: float | None,
) -> float:
    """Min positional error between the WDS-predicted offset and the
    source's actual Gaia offset from the reference, evaluated at J2016.0
    and (when the chain carries an epoch) PM-propagated to the WDS edge
    epoch — whichever agrees better."""
    pe, pn = predicted
    ae, an = _source_offset_at_epoch(src, ref, None)
    err = math.hypot(ae - pe, an - pn)
    if edge_epoch is not None:
        ae2, an2 = _source_offset_at_epoch(src, ref, edge_epoch)
        err = min(err, math.hypot(ae2 - pe, an2 - pn))
    return err


@dataclass
class BindingCandidate:
    """One arbitration candidate. For a source→letters conflict it is a
    blend cluster (``tokens``) tested against one contested ``source_id``;
    for a letter→sources conflict it is one candidate ``source_id`` tested
    against the single contested letter (``tokens`` holds just that
    letter). ``err_arcsec`` is the best positional error over the cluster's
    reachable tokens — ``inf`` when no token has a geometry chain to the
    reference or the source has no Gaia astrometry."""

    label: str
    tokens: list[str]
    source_id: int
    err_arcsec: float
    predicted_sep_arcsec: float


@dataclass
class BindingVerdict:
    """Audit + arbitration outcome for one contradiction. In report-only
    mode nothing is mutated; ``unbind`` / ``rebind_*`` record what
    enforcement WOULD do so ``apply`` and the audit TSV agree."""

    wds_id: str
    shape: str
    verdict: str
    contested: str
    reference_token: str | None
    reference_source: int | None
    winner: BindingCandidate | None
    candidates: list[BindingCandidate]
    # (canonical token, source) bindings enforcement removes.
    unbind: list[tuple[str, int]] = field(default_factory=list)
    # letter→sources decisive only: every row of ``rebind_letter`` rebinds
    # to ``rebind_source``.
    rebind_letter: str | None = None
    rebind_source: int | None = None


def _select_reference(
    ctx: _SystemContext, exclude_tokens: set[str], exclude_sources: set[int],
    indices: IdentifierIndices,
) -> tuple[str, int, GaiaAstrometryRow] | None:
    """A letter in the system whose single Gaia source has 5p astrometry —
    the anchor every predicted offset chains from. Prefers the WDS primary
    letter (``A``), then the brightest available. ``exclude_sources`` is
    non-empty only for source→letters conflicts (the reference must be a
    genuinely different source); for letter→sources conflicts the anchor
    may itself be one of the competing sources (testing "is the letter
    colocated with it?"). ``None`` when no such letter exists."""
    best: tuple[tuple[int, float, str], str, int, GaiaAstrometryRow] | None = None
    for tok, sources in ctx.token_sources.items():
        if tok in exclude_tokens or len(sources) != 1:
            continue
        src = next(iter(sources))
        if src in exclude_sources:
            continue
        astro = indices.src_to_astrometry.get(src)
        if astro is None:
            continue
        rank = (0 if tok == "A" else 1, ctx.token_mag.get(tok, math.inf), tok)
        if best is None or rank < best[0]:
            best = (rank, tok, src, astro)
    if best is None:
        return None
    return best[1], best[2], best[3]


def _cluster_tokens(
    tokens: set[str], blend_pairs: list[tuple[str, str]],
) -> list[list[str]]:
    """Partition tokens bound to one source into blend clusters —
    mutually related tokens (hierarchy / compound / blend-mate) are one
    physical star. Two or more clusters is a source→letters
    contradiction."""
    toks = sorted(tokens)
    parent = {t: t for t in toks}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i in range(len(toks)):
        for j in range(i + 1, len(toks)):
            if _tokens_related(toks[i], toks[j], blend_pairs):
                parent[find(toks[i])] = find(toks[j])
    clusters: dict[str, list[str]] = {}
    for t in toks:
        clusters.setdefault(find(t), []).append(t)
    return list(clusters.values())


def _cluster_representative(cluster: list[str]) -> str:
    """The ancestor / shortest token names a cluster (``{A, Aa} → A``)."""
    return min(cluster, key=lambda t: (len(t), t))


def _cluster_error(
    ctx: _SystemContext, reference_token: str, reference_astro: GaiaAstrometryRow,
    tokens: list[str], source: int, indices: IdentifierIndices,
) -> tuple[float, float]:
    """Best ``(err, predicted_sep)`` over a cluster's tokens — a cluster
    is placed by whichever of its letters has a geometry chain to the
    reference (a compound like ``BC`` often reaches the anchor when its
    bare siblings don't). ``(inf, 0)`` when none is reachable or the
    source lacks Gaia astrometry."""
    src_astro = indices.src_to_astrometry.get(source)
    if src_astro is None:
        return math.inf, 0.0
    best_err, best_sep = math.inf, 0.0
    for tok in tokens:
        pred = _bfs_offset(ctx.adj, reference_token, tok)
        if pred is None:
            continue
        pe, pn, edge_epoch = pred
        err = _arbitration_error(src_astro, reference_astro, (pe, pn), edge_epoch)
        if err < best_err:
            best_err, best_sep = err, math.hypot(pe, pn)
    return best_err, best_sep


def _refuted(candidate: BindingCandidate) -> bool:
    """A reachable candidate whose measured position the source's Gaia
    astrometry contradicts (error beyond the absolute tolerance)."""
    if math.isinf(candidate.err_arcsec):
        return False
    tol = max(
        ARBITRATION_ABS_TOLERANCE_ARCSEC,
        ARBITRATION_SEP_FRACTION * candidate.predicted_sep_arcsec,
    )
    return candidate.err_arcsec > tol


def _decide(candidates: list[BindingCandidate]) -> BindingCandidate | None:
    """Elect a winner, or ``None`` when the field is ambiguous. Two paths:

    1. Margin: the min-error candidate clears its absolute tolerance AND
       beats the runner-up by ≥2× (the clean case — one letter sits where
       the source is, the rest are far).
    2. Refutation: when the geometry connects the reference only to the
       *wrong* candidates (a disconnected system graph), every reachable
       candidate is refuted and exactly one is unreachable — the source is
       proven to be at none of the measured positions, so it belongs to
       the one letter geometry couldn't reach. Winner = that candidate."""
    if not candidates:
        return None
    ranked = sorted(candidates, key=lambda c: c.err_arcsec)
    win = ranked[0]
    if not math.isinf(win.err_arcsec):
        runnerup = ranked[1].err_arcsec if len(ranked) > 1 else math.inf
        abs_tol = max(
            ARBITRATION_ABS_TOLERANCE_ARCSEC,
            ARBITRATION_SEP_FRACTION * win.predicted_sep_arcsec,
        )
        if (
            win.err_arcsec <= abs_tol
            and win.err_arcsec <= ARBITRATION_RUNNERUP_FACTOR * runnerup
        ):
            return win
    reachable = [c for c in candidates if not math.isinf(c.err_arcsec)]
    unreachable = [c for c in candidates if math.isinf(c.err_arcsec)]
    if reachable and len(unreachable) == 1 and all(_refuted(c) for c in reachable):
        return unreachable[0]
    return None


def _audit_system(
    ctx: _SystemContext, indices: IdentifierIndices,
) -> list[BindingVerdict]:
    """Detect and arbitrate every contradiction in one WDS system."""
    verdicts: list[BindingVerdict] = []

    # Shape (a) — one source bound to disjoint letters.
    source_tokens: dict[int, set[str]] = {}
    for tok, sources in ctx.token_sources.items():
        for src in sources:
            source_tokens.setdefault(src, set()).add(tok)
    for src, tokens in sorted(source_tokens.items()):
        clusters = _cluster_tokens(tokens, ctx.blend_pairs)
        if len(clusters) < 2:
            continue
        reps = [_cluster_representative(c) for c in clusters]
        contested = f"{src}:{'/'.join(sorted(reps))}"
        ref = _select_reference(ctx, set(tokens), {src}, indices)
        if ref is None:
            verdicts.append(BindingVerdict(
                ctx.wds_id, BINDING_SHAPE_SOURCE_LETTERS,
                BINDING_VERDICT_SKIPPED_NO_REFERENCE, contested,
                None, None, None, [],
            ))
            continue
        ref_tok, ref_src, ref_astro = ref
        cands: list[BindingCandidate] = []
        for cluster in clusters:
            err, sep = _cluster_error(
                ctx, ref_tok, ref_astro, cluster, src, indices,
            )
            cands.append(BindingCandidate(
                _cluster_representative(cluster), cluster, src, err, sep,
            ))
        winner = _decide(cands)
        if winner is not None:
            unbind = [
                (t, src) for c in cands if c is not winner for t in c.tokens
            ]
            verdicts.append(BindingVerdict(
                ctx.wds_id, BINDING_SHAPE_SOURCE_LETTERS,
                BINDING_VERDICT_GEOMETRIC, contested,
                ref_tok, ref_src, winner, cands, unbind,
            ))
        else:
            unbind = [(t, src) for c in cands for t in c.tokens]
            verdicts.append(BindingVerdict(
                ctx.wds_id, BINDING_SHAPE_SOURCE_LETTERS,
                BINDING_VERDICT_UNBOUND_AMBIGUOUS, contested,
                ref_tok, ref_src, None, cands, unbind,
            ))

    # Shape (b) — one letter bound to different sources across rows.
    for tok, sources in sorted(ctx.token_sources.items()):
        if len(sources) < 2:
            continue
        contested = f"{tok}:{'/'.join(str(s) for s in sorted(sources))}"
        ref = _select_reference(ctx, {tok}, set(), indices)
        if ref is None:
            verdicts.append(BindingVerdict(
                ctx.wds_id, BINDING_SHAPE_LETTER_SOURCES,
                BINDING_VERDICT_SKIPPED_NO_REFERENCE, contested,
                None, None, None, [],
            ))
            continue
        ref_tok, ref_src, ref_astro = ref
        cands = []
        for s in sorted(sources):
            err, sep = _cluster_error(ctx, ref_tok, ref_astro, [tok], s, indices)
            cands.append(BindingCandidate(str(s), [tok], s, err, sep))
        winner = _decide(cands)
        if winner is not None:
            unbind = [(tok, s) for s in sources if s != winner.source_id]
            verdicts.append(BindingVerdict(
                ctx.wds_id, BINDING_SHAPE_LETTER_SOURCES,
                BINDING_VERDICT_GEOMETRIC, contested,
                ref_tok, ref_src, winner, cands, unbind,
                rebind_letter=tok, rebind_source=winner.source_id,
            ))
        else:
            unbind = [(tok, s) for s in sources]
            verdicts.append(BindingVerdict(
                ctx.wds_id, BINDING_SHAPE_LETTER_SOURCES,
                BINDING_VERDICT_UNBOUND_AMBIGUOUS, contested,
                ref_tok, ref_src, None, cands, unbind,
            ))

    return verdicts


def _unbind_component(
    comp: ResolvedComponent, winner_hip: int | None, indices: IdentifierIndices,
) -> None:
    """Strip a losing binding. ``gaia`` always clears; ``hip`` clears only
    when it cross-walks to the contested source or duplicates the winner's
    HIP — an independently distinct HIP survives for Stage 3's HIP2
    fallback. ``resolve_via`` reverts to ``unresolved``."""
    contested = comp.gaia_source_id
    if comp.hip is not None and (
        indices.hip_to_gaia.get(comp.hip) == contested or comp.hip == winner_hip
    ):
        comp.hip = None
    comp.gaia_source_id = None
    comp.resolve_via = "unresolved"


def _apply_system_verdicts(
    verdicts: list[BindingVerdict], ctx: _SystemContext,
    indices: IdentifierIndices,
) -> None:
    """Enforce one system's verdicts on its component instances. Shape (b)
    decisive verdicts rebind every row of the letter to the winning
    source; every other unbind strips the losing binding."""
    for v in verdicts:
        winner_hip = (
            indices.src_to_hip.get(v.winner.source_id)
            if v.winner is not None else None
        )
        if v.rebind_letter is not None and v.rebind_source is not None:
            for comp in ctx.instances.get(v.rebind_letter, []):
                comp.gaia_source_id = v.rebind_source
            continue
        for tok, src in v.unbind:
            for comp in ctx.instances.get(tok, []):
                if comp.gaia_source_id == src:
                    _unbind_component(comp, winner_hip, indices)


def inherit_downward_parent_bindings(
    pairs: list[WdsPair], components: list[ResolvedComponent],
) -> int:
    """A sub-letter left unbound by enforcement inherits its parent
    token's binding when the parent is bound — the WDS blend convention
    read downward (20312's Aa/Ab must follow A, not sibling BC). Returns
    the number of components seeded."""
    bound: dict[tuple[str, str], tuple[int, str, int | None]] = {}
    canon: list[tuple[str, ResolvedComponent]] = []
    for pair, primary, secondary in iter_decomposing_pair_components(
        pairs, components,
    ):
        for tok, comp in (
            (primary.component, primary),
            (_canonical_token(primary.component, secondary), secondary),
        ):
            canon.append((tok, comp))
            if comp.gaia_source_id is not None:
                bound.setdefault(
                    (pair.wds_id, tok),
                    (comp.gaia_source_id, comp.resolve_via, comp.hip),
                )
    n = 0
    for tok, comp in canon:
        if comp.gaia_source_id is not None:
            continue
        parent = parent_component_token(tok)
        if parent is None:
            continue
        binding = bound.get((comp.wds_id, parent))
        if binding is None:
            continue
        comp.gaia_source_id, comp.resolve_via, hip = binding
        if comp.hip is None and hip is not None:
            comp.hip = hip
        n += 1
    return n


def audit_binding_integrity(
    pairs: list[WdsPair], components: list[ResolvedComponent],
    indices: IdentifierIndices, *, apply: bool = False,
) -> list[BindingVerdict]:
    """Group Stage-2 bindings per WDS system, detect the two
    contradiction shapes, arbitrate geometrically, and — when
    ``apply`` — unbind the losers, then re-run the propagation passes so
    surviving bindings re-smear and orphaned sub-letters inherit their
    parents. ``apply=False`` is report-only: verdicts computed and
    returned, ``components`` untouched."""
    systems = build_system_contexts(pairs, components)
    verdicts: list[BindingVerdict] = []
    for wds_id in sorted(systems):
        ctx = systems[wds_id]
        sys_verdicts = _audit_system(ctx, indices)
        verdicts.extend(sys_verdicts)
        if apply:
            _apply_system_verdicts(sys_verdicts, ctx, indices)
    if apply and verdicts:
        propagate_within_system(components)
        if propagate_blend_identity(components, pairs) > 0:
            propagate_within_system(components)
        if inherit_downward_parent_bindings(pairs, components) > 0:
            propagate_within_system(components)
    return verdicts


def binding_integrity_counts(verdicts: list[BindingVerdict]) -> dict[str, int]:
    """The five report-only headline counters — two conflict-shape totals
    plus the three arbitration-outcome totals. Every key present so the
    snapshot shape stays stable across runs."""
    counts = {k: 0 for k in BINDING_INTEGRITY_COUNT_KEYS}
    for v in verdicts:
        if v.shape == BINDING_SHAPE_SOURCE_LETTERS:
            counts["binding_conflicts_source_letters"] += 1
        else:
            counts["binding_conflicts_letter_sources"] += 1
        if v.verdict == BINDING_VERDICT_GEOMETRIC:
            counts["arbitrated_geometric"] += 1
        elif v.verdict == BINDING_VERDICT_UNBOUND_AMBIGUOUS:
            counts["arbitrated_unbound_ambiguous"] += 1
        else:
            counts["arbitration_skipped_no_reference"] += 1
    return counts


BINDING_VERDICT_TSV_COLUMNS: tuple[str, ...] = (
    "wds_id", "shape", "verdict", "contested",
    "reference_token", "reference_source", "winner", "candidates",
)


def _format_candidates(candidates: list[BindingCandidate]) -> str:
    """``label=err″@sep″`` per candidate, error-ascending, ``;``-joined."""
    parts = []
    for c in sorted(candidates, key=lambda c: c.err_arcsec):
        err = "inf" if math.isinf(c.err_arcsec) else f"{c.err_arcsec:.3f}"
        parts.append(f"{c.label}={err}@{c.predicted_sep_arcsec:.1f}")
    return ";".join(parts)


def write_binding_verdicts_tsv(
    verdicts: list[BindingVerdict], path: Path,
) -> int:
    """Emit the per-verdict audit artifact — the no-spot-check review
    surface for the report-only detector. Returns the row count."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as fh:
        fh.write("\t".join(BINDING_VERDICT_TSV_COLUMNS) + "\n")
        for v in verdicts:
            fh.write("\t".join((
                v.wds_id, v.shape, v.verdict, v.contested,
                v.reference_token or "",
                str(v.reference_source) if v.reference_source is not None else "",
                v.winner.label if v.winner is not None else "",
                _format_candidates(v.candidates),
            )) + "\n")
    return len(verdicts)


