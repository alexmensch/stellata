#!/usr/bin/env python3
"""Stage 3 — attach the best astrometric measurement per component.
Routes between Gaia 5p, Gaia NSS-systemic, and HIP2 long-baseline.
"""

from __future__ import annotations

from dataclasses import dataclass

from .parsers import (
    AthygRow,
    GaiaAstrometryRow,
    Hip2Row,
    WdsPair,
)
from .indices import (
    ATHYG_REFERENCE_EPOCH,
    IdentifierIndices,
)
from .stage2_resolve import (
    ATHYG_POSITION_MATCH_TOLERANCE_ARCSEC,
    ResolvedComponent,
    build_pair_by_wds_disc,
    find_owning_pair,
    iter_pair_athyg_matches,
)


# (x_pc, y_pc, z_pc, dist_pc) — one component's heliocentric position,
# the per-system anchor tuple Stage 6 inherits for a component whose own
# astrometry resolved to ``unresolved``. Stage 6's ``_position_pc``
# builds it (PM-propagated to CATALOG_SCENE_EPOCH).
SystemAnchor = tuple[float, float, float, float]


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
# ipd_frac_multi_peak is a PERCENTAGE (0-100) in Gaia DR3; the gate
# fires above 2%, matching ANCHOR_IPD_MAX_PERCENT in
# scripts/catalog/system-coherence.ts.
GAIA_IPD_FRAC_MULTI_PEAK_THRESHOLD = 2.0

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
    the Gaia routes, J1991.25 for hip2_long_baseline. Stage 6's
    ``_position_pc`` PM-propagates the position to ``CATALOG_SCENE_EPOCH``
    (J2016.0) at multiples.tsv emit time; the native epoch is carried
    through here so no information is dropped before that propagation.
    """

    astrometry_via: str
    ra_deg: float | None
    dec_deg: float | None
    parallax_mas: float | None
    parallax_error_mas: float | None
    pmra_masyr: float | None
    pmdec_masyr: float | None
    ref_epoch: float | None


# Hipparcos-2 reference epoch (van Leeuwen 2007 reduction). Stored at
# module scope so the HIP2 branch and Stage 6's epoch propagation
# both pull from the same constant.
HIP2_REF_EPOCH = 1991.25


def _from_gaia(row: GaiaAstrometryRow, via: str) -> ComponentAstrometry:
    return ComponentAstrometry(
        astrometry_via=via,
        ra_deg=row.ra_deg,
        dec_deg=row.dec_deg,
        parallax_mas=row.parallax_mas,
        parallax_error_mas=row.parallax_error_mas,
        pmra_masyr=row.pmra_masyr,
        pmdec_masyr=row.pmdec_masyr,
        ref_epoch=row.ref_epoch,
    )


def _unresolved_astrometry() -> ComponentAstrometry:
    return ComponentAstrometry(
        astrometry_via="unresolved",
        ra_deg=None, dec_deg=None,
        parallax_mas=None,
        parallax_error_mas=None,
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
        parallax_error_mas=hip2.e_plx_mas,
        pmra_masyr=hip2.pm_ra_masyr,
        pmdec_masyr=hip2.pm_de_masyr,
        ref_epoch=HIP2_REF_EPOCH,
    )


def _from_athyg_position(row: AthygRow) -> ComponentAstrometry | None:
    """Synthesize ``ComponentAstrometry`` from an AT-HYG row's stored
    ra/dec + parallax (=1000/``dist_pc``). Returns ``None`` when
    ``dist_pc`` is absent or non-positive — the row carries no usable
    parallax. See ``scripts/binaries/README.md`` § Stage 3 for the
    population this route serves.
    """
    if row.dist_pc is None or row.dist_pc <= 0:
        return None
    parallax_mas = 1000.0 / row.dist_pc
    return ComponentAstrometry(
        astrometry_via="athyg_position",
        ra_deg=row.ra_deg,
        dec_deg=row.dec_deg,
        parallax_mas=parallax_mas,
        parallax_error_mas=None,
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
       1.4`` OR ``ipd_frac_multi_peak > 2%``). Gaia DR3 refits
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
    stats: dict[str, int] | None = None,
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
            stats=stats,
        )
    return astrometry


def attach_athyg_position_fallback(
    components: list[ResolvedComponent],
    astrometry: list[ComponentAstrometry],
    pairs: list[WdsPair],
    athyg: list[AthygRow],
    tolerance_arcsec: float = ATHYG_POSITION_MATCH_TOLERANCE_ARCSEC,
    stats: dict[str, int] | None = None,
) -> None:
    """Post-pass after the Gaia / HIP2 cascade. For every component
    still tagged ``unresolved``, position-match the WDS precise_coord
    against AT-HYG (via ``iter_pair_athyg_matches``) and synthesize
    ``ComponentAstrometry`` from the matched row. Mutates ``astrometry``
    in place; rows that can't be matched stay ``unresolved``.

    See ``scripts/binaries/README.md`` § Stage 3 for how this composes
    with Stage 2's identifier-binding pass over the same cascade.
    Opts into secondary blend-inheritance so Hipparcos-unresolved
    blends (A and B sharing a single AT-HYG entry at sub-AU
    separation) both get astrometry.
    """
    for event in iter_pair_athyg_matches(
        components, pairs, athyg,
        skip_predicate=lambda i, _c: astrometry[i].astrometry_via != "unresolved",
        allow_blend_inherit=True,
        tolerance_arcsec=tolerance_arcsec,
        stats=stats,
    ):
        c = components[event.component_idx]
        synth = _from_athyg_position(athyg[event.athyg_match_idx])
        if synth is None:
            continue
        astrometry[event.component_idx] = synth
        if c.athyg_row is None:
            c.athyg_row = athyg[event.athyg_match_idx]


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


