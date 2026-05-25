#!/usr/bin/env python3
"""Stage 3 — attach the best astrometric measurement per component.
Routes between Gaia 5p, Gaia NSS-systemic, and HIP2 long-baseline.
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parsers import (  # noqa: E402
    AthygRow,
    GaiaAstrometryRow,
    Hip2Row,
    WdsPair,
)
from indices import (  # noqa: E402
    ATHYG_REFERENCE_EPOCH,
    IdentifierIndices,
    WDS_PRECISE_COORD_EPOCH,
    WDS_RHO_OVERFLOW_THRESHOLD_ARCSEC,
)
from stage2_resolve import (  # noqa: E402
    ATHYG_POSITION_MATCH_TOLERANCE_ARCSEC,
    ResolvedComponent,
    build_athyg_position_grid,
    build_pair_by_wds_disc,
    find_nearest_athyg_at_position,
    find_owning_pair,
    predict_secondary_position,
)


# ─── Stage 3: per-component astrometry attachment ────────────────────


# Routing tags Stage 3 may emit for any component, in priority order.
# `astrometry_counts` and the canonical build-time log line read from
# this tuple so renaming a route only edits one place. Stage 6 owns one
# additional tag (``ASTROMETRY_VIA_SYSTEM_INHERITED``) it promotes on
# multiples rows whose component inherited the system-anchor position;
# that one is counted directly off emitted rows in Stage 7.
ASTROMETRY_VIA_VALUES: tuple[str, ...] = (
    "gaia_nss_systemic",
    "hip2_long_baseline",
    "gaia_5p",
    "athyg_position",
    "unresolved",
)

# Gaia DR3 5p reliability thresholds. The NSS-systemic route engages
# only when the 5p solution shows orbit-corrupted fit indicators, so a
# clean 5p with an NSS row alongside still uses the 5p directly.
GAIA_RUWE_UNRELIABLE_THRESHOLD = 1.4
GAIA_IPD_FRAC_MULTI_PEAK_THRESHOLD = 0.02

# HIP2 long-baseline fallback thresholds. The separation gate is
# checked against the *minimum* WDS ρ across all pair rows the source
# participates in (a star in both a tight AB and a wide AC pair counts
# as close), not the current pair row's ρ in isolation. Stars Gaia
# could not observe (saturated bright primaries like Sirius / α Cen)
# bypass both gates entirely — they take the no-Gaia HIP2 branch
# below, where HIP2 is the only available astrometry by construction.
HIP2_COMPANION_SEPARATION_ARCSEC = 5.0
HIP2_PM_DELTA_THRESHOLD_MASYR = 50.0


@dataclass
class ComponentAstrometry:
    """Per-component astrometric payload, parallel to ``ResolvedComponent``.
    ``astrometry_via`` is always set; the remaining fields are ``None``
    when the route is ``"unresolved"`` (component had no gaia_source_id,
    or its source_id was not covered by ``gaia_dr3_astrometry.tsv``).

    ``ref_epoch`` is the native catalog epoch — Gaia DR3 J2016.0 for
    the Gaia routes, J1991.25 for hip2_long_baseline. Downstream
    propagation to J2000 happens at multiples.tsv emit time so we
    don't drop information here.
    """

    astrometry_via: str
    ra_deg: float | None
    dec_deg: float | None
    parallax_mas: float | None
    pmra_masyr: float | None
    pmdec_masyr: float | None
    ref_epoch: float | None


# Hipparcos-2 reference epoch (van Leeuwen 2007 reduction). Stored at
# module scope so the HIP2 branch and downstream J2000 propagation
# both pull from the same constant.
HIP2_REF_EPOCH = 1991.25


def _from_gaia(row: GaiaAstrometryRow, via: str) -> ComponentAstrometry:
    return ComponentAstrometry(
        astrometry_via=via,
        ra_deg=row.ra_deg,
        dec_deg=row.dec_deg,
        parallax_mas=row.parallax_mas,
        pmra_masyr=row.pmra_masyr,
        pmdec_masyr=row.pmdec_masyr,
        ref_epoch=row.ref_epoch,
    )


def _unresolved_astrometry() -> ComponentAstrometry:
    return ComponentAstrometry(
        astrometry_via="unresolved",
        ra_deg=None, dec_deg=None,
        parallax_mas=None,
        pmra_masyr=None, pmdec_masyr=None,
        ref_epoch=None,
    )


def gaia_5p_unreliable(row: GaiaAstrometryRow) -> bool:
    """The 5p fit shows orbit-corrupted indicators. Either gate alone
    is sufficient — ruwe captures residual normalised to per-transit
    error, ipd_frac_multi_peak captures contaminated-image detections
    on a different sample of the same Gaia transits.
    """
    if (
        row.ruwe is not None
        and row.ruwe > GAIA_RUWE_UNRELIABLE_THRESHOLD
    ):
        return True
    if (
        row.ipd_frac_multi_peak is not None
        and row.ipd_frac_multi_peak > GAIA_IPD_FRAC_MULTI_PEAK_THRESHOLD
    ):
        return True
    return False


def _hip2_pm_disagrees(
    gaia: GaiaAstrometryRow, hip2: Hip2Row,
) -> bool:
    """``|Δ pmRA| > 50 mas/yr`` OR ``|Δ pmDE| > 50 mas/yr``. Either
    axis alone trips the fallback — orbit contamination doesn't have
    to show on both axes simultaneously to flag the 5p PM as suspect.
    Returns ``False`` when either input is missing a PM value (no
    comparison possible).
    """
    if (
        gaia.pmra_masyr is None
        or gaia.pmdec_masyr is None
        or hip2.pm_ra_masyr is None
        or hip2.pm_de_masyr is None
    ):
        return False
    if abs(gaia.pmra_masyr - hip2.pm_ra_masyr) > HIP2_PM_DELTA_THRESHOLD_MASYR:
        return True
    if abs(gaia.pmdec_masyr - hip2.pm_de_masyr) > HIP2_PM_DELTA_THRESHOLD_MASYR:
        return True
    return False


def _from_hip2(hip2: Hip2Row) -> ComponentAstrometry:
    return ComponentAstrometry(
        astrometry_via="hip2_long_baseline",
        ra_deg=hip2.ra_deg,
        dec_deg=hip2.dec_deg,
        parallax_mas=hip2.plx_mas,
        pmra_masyr=hip2.pm_ra_masyr,
        pmdec_masyr=hip2.pm_de_masyr,
        ref_epoch=HIP2_REF_EPOCH,
    )


def _from_athyg_position(row: AthygRow) -> ComponentAstrometry | None:
    """Synthesize ``ComponentAstrometry`` from an AT-HYG row's stored
    position when neither Gaia 5p nor HIP2 reach the component. Returns
    ``None`` when ``dist_pc`` is missing or non-positive — the row
    carries no usable parallax.

    Used by the AT-HYG-position fallback for systems Stage 2 resolved
    only through SIMBAD xids whose Gaia source_ids aren't in the 5p
    table (typically G < 5 saturated bright stars) AND whose HIP is
    excluded from HIP2 (van Leeuwen drops entries corrupted by
    orbital motion — ξ UMa's HIP 55203 is the canonical case).

    AT-HYG's stored ``ra/dec/dist_pc`` is often a GJ-catalogue
    measurement for nearby bright systems — a legitimate astrometric
    anchor even when the row has neither HIP nor Gaia populated.
    ``ref_epoch`` is the AT-HYG reference (J1991.25 for HIP-sourced
    rows; the J2000-published rows match within sub-tolerance after
    the row's PM propagates 8.75 yr).
    """
    if row.dist_pc is None or row.dist_pc <= 0:
        return None
    parallax_mas = 1000.0 / row.dist_pc
    return ComponentAstrometry(
        astrometry_via="athyg_position",
        ra_deg=row.ra_deg,
        dec_deg=row.dec_deg,
        parallax_mas=parallax_mas,
        pmra_masyr=row.pm_ra_masyr,
        pmdec_masyr=row.pm_de_masyr,
        ref_epoch=ATHYG_REFERENCE_EPOCH,
    )


def _component_hip(
    component: ResolvedComponent, indices: IdentifierIndices,
) -> int | None:
    """The HIP for this component if known. Prefers ``component.hip``
    (set by Stage 2 from ORB6 / AT-HYG), falls back to inverting the
    Gaia HIP cross-walk via the component's resolved Gaia source_id.
    """
    if component.hip is not None:
        return component.hip
    if component.gaia_source_id is None:
        return None
    return indices.src_to_hip.get(component.gaia_source_id)


def attach_astrometry(
    component: ResolvedComponent,
    min_rho_arcsec: float | None,
    indices: IdentifierIndices,
) -> ComponentAstrometry:
    """Route to the most-trustworthy astrometric measurement for a
    single resolved component. Priority order:

    1. ``gaia_nss_systemic`` — Gaia astrometry exists, source has an
       NSS row, AND the 5p solution is flagged unreliable (``ruwe >
       1.4`` OR ``ipd_frac_multi_peak > 0.02``). Gaia DR3 refits
       ``gaia_source`` to the centre-of-mass for NSS-modeled sources,
       so the same row's values surface here with the NSS tag
       distinguishing provenance for Stage 4 (which prefers NSS
       orbital elements over ORB6 for these sources).
    2. ``hip2_long_baseline`` (Gaia-vs-HIP2 disagreement) — the system
       has a known companion within 5″ (``min_rho_arcsec ≤ 5.0``) AND
       ``|Δ pmRA| > 50 mas/yr`` OR ``|Δ pmDE| > 50 mas/yr`` between
       Gaia and HIP2. Hipparcos's J1991.25-anchored measurement
       averages a different window of the orbit than Gaia's 2014-2017
       window; for bright close binaries with both available, HIP2 is
       closer to the systemic motion of the centre of mass.
    3. ``gaia_5p`` — default.
    4. ``hip2_long_baseline`` (Gaia-saturated fallback) — no Gaia
       source resolved at all but a HIP is known and HIP2 covers it.
       Sirius / α Cen / Algol / Procyon-shaped bright primaries Gaia
       saturated out of its catalog get astrometry from HIP2 because
       it's the only measurement available.

    ``min_rho_arcsec`` is the minimum WDS ρ across every pair row this
    source_id participates in. A star in both a tight AB pair and a
    wide AC pair takes the tight ρ — the same physical star always
    gets the same routing across all its system rows.

    Returns ``ComponentAstrometry`` tagged ``"unresolved"`` (all
    values ``None``) when neither a Gaia astrometry row nor a HIP2
    row can be reached. ``attach_athyg_position_fallback`` runs as a
    post-pass over the cascade output and may upgrade the row to
    ``athyg_position`` if the WDS precise_coord position-matches an
    AT-HYG row.
    """
    gaia = (
        indices.src_to_astrometry.get(component.gaia_source_id)
        if component.gaia_source_id is not None
        else None
    )

    # No usable Gaia parallax — try HIP2. Two shapes route through here:
    # the saturated-bright case (Sirius / α Cen — no gaia_dr3_astrometry
    # row at all) and the position-only Gaia case (Gaia detected the
    # source but couldn't fit a 5p solution, so the row exists with
    # ra/dec populated but parallax=NULL).
    if gaia is None or gaia.parallax_mas is None:
        hip = _component_hip(component, indices)
        if hip is not None:
            hip2 = indices.hip_to_hip2.get(hip)
            if hip2 is not None:
                return _from_hip2(hip2)
        if gaia is None:
            return _unresolved_astrometry()
        # Gaia ra/dec only, HIP2 missed — fall through to gaia_5p so
        # downstream stages keep the positional anchor.

    has_nss = component.gaia_source_id in indices.src_to_nss
    if has_nss and gaia_5p_unreliable(gaia):
        return _from_gaia(gaia, "gaia_nss_systemic")

    if (
        min_rho_arcsec is not None
        and min_rho_arcsec <= HIP2_COMPANION_SEPARATION_ARCSEC
    ):
        hip = _component_hip(component, indices)
        if hip is not None:
            hip2 = indices.hip_to_hip2.get(hip)
            if hip2 is not None and _hip2_pm_disagrees(gaia, hip2):
                return _from_hip2(hip2)

    return _from_gaia(gaia, "gaia_5p")


def compute_min_rho_per_source(
    components: list[ResolvedComponent],
    pair_by_wds_disc: dict[tuple[str, str], list[WdsPair]],
) -> dict[int, float]:
    """Smallest WDS ρ across every pair row each gaia_source_id appears
    in. The HIP2 5″ gate runs against this per-source minimum so a
    physical star whose system has any close pair always routes
    consistently across the system's wider pair rows.
    """
    out: dict[int, float] = {}
    for c in components:
        if c.gaia_source_id is None:
            continue
        pair = find_owning_pair(c, pair_by_wds_disc)
        if pair is None or pair.rho_last is None:
            continue
        prev = out.get(c.gaia_source_id)
        if prev is None or pair.rho_last < prev:
            out[c.gaia_source_id] = pair.rho_last
    return out


def attach_astrometry_all(
    components: list[ResolvedComponent],
    pairs: list[WdsPair],
    indices: IdentifierIndices,
    athyg: list[AthygRow] | None = None,
    athyg_position_tolerance_arcsec: float = ATHYG_POSITION_MATCH_TOLERANCE_ARCSEC,
) -> list[ComponentAstrometry]:
    """Route astrometry for every component. The returned list is
    parallel to ``components`` (same order, same length) so Stage 4-7
    can zip the two together. The HIP2 5″ gate uses the per-source
    min ρ (see ``compute_min_rho_per_source``) rather than the current
    pair row's ρ in isolation.

    After the Gaia / HIP2 cascade, ``attach_athyg_position_fallback``
    runs a post-pass that synthesizes ``ComponentAstrometry`` for any
    component still tagged ``unresolved`` by position-matching the WDS
    precise_coord against AT-HYG. Skipped when ``athyg`` is empty /
    omitted (the in-process tests).
    """
    pair_by_wds_disc = build_pair_by_wds_disc(pairs)
    min_rho = compute_min_rho_per_source(components, pair_by_wds_disc)
    astrometry = [
        attach_astrometry(
            c,
            min_rho.get(c.gaia_source_id) if c.gaia_source_id is not None else None,
            indices,
        )
        for c in components
    ]
    if athyg:
        attach_athyg_position_fallback(
            components=components,
            astrometry=astrometry,
            pairs=pairs,
            athyg=athyg,
            tolerance_arcsec=athyg_position_tolerance_arcsec,
        )
    return astrometry


def attach_athyg_position_fallback(
    components: list[ResolvedComponent],
    astrometry: list[ComponentAstrometry],
    pairs: list[WdsPair],
    athyg: list[AthygRow],
    tolerance_arcsec: float = ATHYG_POSITION_MATCH_TOLERANCE_ARCSEC,
) -> None:
    """Post-pass after the Gaia / HIP2 cascade. For every component
    still tagged ``unresolved``, position-match the WDS precise_coord
    (PM-propagated to J2000) against AT-HYG and synthesize
    ``ComponentAstrometry`` from the matched row's ra/dec + parallax
    (=1000/``dist_pc``). Mutates ``astrometry`` in place at the matched
    indices; rows that can't be matched stay ``unresolved``.

    Closes the gap between Stage 2's ``resolve_via_position`` (which
    only binds the AT-HYG row's hip/gaia identifiers and leaves the
    component unresolved when both are empty) and Stage 3's
    Gaia-5p / HIP2 cascade (which can't see AT-HYG positions at all).
    The dominant affected population is AT-HYG-HD-only WDS systems
    with SIMBAD xids but no HIP+Gaia anchor — ξ UMa (HIP 55203 absent
    from HIP2 due to AB orbital corruption) is the canonical case.

    Two passes — primary against the pair's precise_coord, secondary
    against the (ρ, θ)-predicted secondary position. Secondary
    fallback inherits the primary's AT-HYG row when the secondary's
    own match misses (Hipparcos-unresolved blends where A and B share
    a single AT-HYG entry at sub-AU separation).
    """
    grid = build_athyg_position_grid(athyg)
    pair_by_wds_disc = build_pair_by_wds_disc(pairs)

    primary_idx_by_pair: dict[tuple[str, str, str], int] = {}

    for i, c in enumerate(components):
        if astrometry[i].astrometry_via != "unresolved":
            continue
        if not c.is_primary:
            continue
        pair = find_owning_pair(c, pair_by_wds_disc)
        if (
            pair is None
            or pair.precise_ra_deg is None
            or pair.precise_dec_deg is None
        ):
            continue
        match_idx = _athyg_match_either_epoch(
            ra_deg=pair.precise_ra_deg, dec_deg=pair.precise_dec_deg,
            grid=grid, athyg=athyg, tolerance_arcsec=tolerance_arcsec,
        )
        if match_idx is None:
            continue
        synth = _from_athyg_position(athyg[match_idx])
        if synth is None:
            continue
        primary_idx_by_pair[(c.wds_id, c.discoverer, pair.components)] = match_idx
        astrometry[i] = synth
        if c.athyg_row is None:
            c.athyg_row = athyg[match_idx]

    for i, c in enumerate(components):
        if astrometry[i].astrometry_via != "unresolved":
            continue
        if c.is_primary:
            continue
        pair = find_owning_pair(c, pair_by_wds_disc)
        if (
            pair is None
            or pair.precise_ra_deg is None
            or pair.precise_dec_deg is None
        ):
            continue
        primary_idx = primary_idx_by_pair.get(
            (c.wds_id, c.discoverer, pair.components),
        )
        secondary_match: int | None = None
        if (
            pair.rho_last is not None
            and pair.theta_last is not None
            and pair.rho_last < WDS_RHO_OVERFLOW_THRESHOLD_ARCSEC
        ):
            secondary_ra, secondary_dec = predict_secondary_position(
                pair.precise_ra_deg, pair.precise_dec_deg,
                pair.rho_last, pair.theta_last,
            )
            secondary_match = _athyg_match_either_epoch(
                ra_deg=secondary_ra, dec_deg=secondary_dec,
                grid=grid, athyg=athyg, tolerance_arcsec=tolerance_arcsec,
                exclude_idx=primary_idx,
            )
        if secondary_match is not None:
            synth = _from_athyg_position(athyg[secondary_match])
            if synth is not None:
                astrometry[i] = synth
                if c.athyg_row is None:
                    c.athyg_row = athyg[secondary_match]
                continue
        if primary_idx is not None:
            synth = _from_athyg_position(athyg[primary_idx])
            if synth is not None:
                astrometry[i] = synth
                if c.athyg_row is None:
                    c.athyg_row = athyg[primary_idx]


def _athyg_match_either_epoch(
    *,
    ra_deg: float, dec_deg: float,
    grid: dict[tuple[int, int], list[int]],
    athyg: list[AthygRow],
    tolerance_arcsec: float,
    exclude_idx: int | None = None,
) -> int | None:
    """Position-match an AT-HYG row against a J2000 sky position, trying
    both the PM-propagated and unpropagated row positions and picking
    whichever match falls inside ``tolerance_arcsec``.

    AT-HYG mixes epoch conventions per ``pos_src``: HIP-sourced rows are
    empirically at J1991.25, while GJ / Tycho / Gaia-sourced rows are
    closer to J2000. Stage 2's ``resolve_via_position`` always propagates
    by 8.75 yr from ATHYG_REFERENCE_EPOCH, which works for HIP-sourced
    rows (the dominant case) but pushes high-PM GJ-sourced rows
    (ξ UMa at -425/-581 mas/yr) 4-6″ off — beyond the 2″ tolerance.
    Trying both directions here catches the high-PM GJ tail without
    requiring an authoritative per-row epoch tag.

    Propagated match wins on tie (HIP-sourced rows are the larger
    population in the affected set).
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


def astrometry_counts(
    astrometry: list[ComponentAstrometry],
) -> dict[str, int]:
    """Per-route counters in canonical ``ASTROMETRY_VIA_VALUES`` order.
    Every key is present (zero-filled) so the log line shape stays
    stable across runs."""
    counts: dict[str, int] = {k: 0 for k in ASTROMETRY_VIA_VALUES}
    for a in astrometry:
        counts[a.astrometry_via] = counts.get(a.astrometry_via, 0) + 1
    return counts


