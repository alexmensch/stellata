#!/usr/bin/env python3
"""Stage 5 — classify each WDS pair as physical or optical.
Six-tier cascade; each verdict carries the deciding tier as provenance.
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parsers import (  # noqa: E402
    GaiaAstrometryRow,
    WdsPair,
)
from indices import IdentifierIndices  # noqa: E402
from stage2_resolve import (  # noqa: E402
    ResolvedComponent,
    iter_decomposing_pair_components,
    split_components,
)
from stage4_orbits import OrbitElements  # noqa: E402


# ─── Stage 5: optical-pair filter cascade ────────────────────────────


# Per-pair classification tags Stage 5 may emit. Both the headline log
# line and ``optical_counts`` walk this tuple so adding a new tier (or
# splitting an existing tier) only edits the canonical ordering here.
OPTICAL_VIA_VALUES: tuple[str, ...] = (
    "wds_notes_kept",
    "wds_notes_rejected",
    "orbit_kept",
    "sep_limit_rejected",
    "gaia_kept",
    "gaia_rejected",
    "asymm_kept",
    "asymm_rejected",
    "mag_heuristic_kept",
    "mag_heuristic_rejected",
)

# Orbit-via values that count as "orbit on file" for the orbit-override
# tier. Fires for pairs Stage 4 selected real orbital elements for — an
# empirical orbit fit is strong evidence of physical association and
# wins over every gate below, including the separation limit. A close
# visual pair's Gaia parallaxes are routinely corrupted by blending, so
# a few-pc parallax split does NOT beat a tracked relative orbit; and
# NSS orbits that could leak onto a genuinely wide (unbound) companion
# are already blocked upstream by Stage 4's separation-sanity gate. So
# the only pairs the separation limit needs to catch — wide line-of-
# sight optical doubles like Pollux F — carry no orbit and fall through
# to it. (Sirius A-B: grade-2 ORB6 orbit past a 9.9-mag WD gap; η Cas AB
# / 61 Cyg AB: orbits whose orbital proper-motion split would otherwise
# trip the velocity gate.)
ORBIT_VIA_ON_FILE: frozenset[str] = frozenset({
    "gaia_nss", "orb6", "orb6_spectroscopic",
})

# WDS Notes flag-char semantics (cols 107-110 of WDS_SUMM). The "kept"
# chars confirm physical association (common proper motion, parallax,
# orbital arc); the "rejected" chars confirm optical contamination
# (catalog-flagged not-physical, unconfirmed, or spurious). Other chars
# carry orthogonal meta (orbit grades, identifier collisions, …) and
# leave the tier silent so the Gaia / mag-gap tiers can decide.
WDS_NOTES_PHYSICAL_CHARS: frozenset[str] = frozenset({"T", "V", "Z"})
WDS_NOTES_OPTICAL_CHARS: frozenset[str] = frozenset({"S", "U", "X", "Y"})

# Separation-limit gate. Bound stellar pairs can't exceed the Galactic
# tidal-disruption limit for field binaries — ~1 pc (~2×10⁵ AU) — so two
# components more than this apart in 3D are a line-of-sight optical
# double, not a bound system. The gate compares the pair's OWN two
# components against each other (each at its own parallax, or the system
# anchor when a component has none), so a real inner binary of an
# optically-projected member — both components at the SAME true distance
# — is kept, not split against the unrelated system anchor. Controls sit
# far inside: Mizar+Alcor ~0.2 pc, ε Lyr ~0.3 pc, α Cen ~0.06 pc.
SEPARATION_LIMIT_PC = 1.0
AU_PER_PC = 206_264.806

# Radial (line-of-sight) separation is far noisier than the on-sky
# projection — a parallax difference of a few % dwarfs the arcsec-scale
# projected separation. Count it toward the 3D separation only when the
# parallax difference is significant at this many σ of the combined
# error; below it the apparent depth gap is treated as measurement /
# cross-catalogue systematic noise (this is what keeps a HIP2-vs-Gaia
# parallax-zero-point offset from splitting a genuinely bound pair —
# e.g. AU Mic B/C's 0.89 pc apparent gap).
RADIAL_SEPARATION_SIGMA = 3.0

# The own parallax must be this well measured (parallax_over_error)
# before its distance is trusted to reject a pair on the separation
# gate — the audit's UNCERTAIN bucket (poe < 5) is left alone rather
# than dropped on a noisy distance.
SEPARATION_POE_MIN = 5.0

# Both-Gaia gate (tier 4). A 3σ parallax disagreement on the combined
# error rejects — but, mirroring the tier-5 asymmetric gate, only when
# the implied 3D separation also exceeds the physical bound-pair limit;
# a close visual pair's blended Gaia parallaxes (routine, per the
# orbit-tier note) must not split a within-limit pair on a parallax
# nuance. A within-limit disagreement, and an agreement, both fall to
# the escape-velocity sub-gate, which replaces the historic 5 mas/yr
# per-axis PM cut that mistook a nearby bound pair's real orbital
# proper-motion split for optical contamination.
BOTH_GAIA_PLX_GATE_SIGMA = 3.0

# Asymmetric-Gaia gate (tier 5). When only one component has a Gaia 5p
# row and the other is Gaia-saturated, the saturated star's HIP2
# parallax becomes the anchor distance. The 3σ test runs against the
# combined Gaia + HIP2 parallax error; a 3σ disagreement rejects only
# when the implied 3D separation also exceeds the physical bound-pair
# limit, so a HIP2-vs-Gaia zero-point offset can't split a bound pair.
# This is a backstop for the Gaia side whose parallax is too noisy to
# clear tier 3's poe floor: the well-measured Sirius A-C/D/E/F-shaped
# splits (A ~378 mas via HIP2; C/D/E/F <1 mas via Gaia → a ~kpc split)
# are already rejected upstream at tier 3, so this tier rejects nothing
# in the current corpus — it fires only for a poe < 5 Gaia parallax.
ASYMM_PLX_GATE_SIGMA = 3.0

# Escape-velocity gate (inside the both-Gaia tier). A bound pair needs
# v_rel < sqrt(2·G·M_total/r). Only the TRANSVERSE component of v_rel is
# measurable (Δpm × distance; radial velocity is usually unknown), so
# v_rel is a lower bound and the gate can only REJECT, never confirm
# bound. Reject only when v_transverse exceeds this multiple of the
# escape velocity, so real orbital motion (v_transverse < v_escape) and
# the ~1.4× slop from ~2×-uncertain spectral masses (v_escape ∝ √M)
# never trip it. η Cas AB: v_transverse ≈ 2.9 km/s vs v_escape ≈ 8 km/s
# — kept; an optical double at the same distance carries unrelated
# space motion (tens of km/s ≫ v_escape) — rejected.
ESCAPE_VELOCITY_SAFETY_FACTOR = 2.5

# Generous per-component / total stellar mass assumed when no spectral
# type resolves. Biases v_escape high (leniently) so the gate never
# rejects a bound pair for want of a spectral estimate; still small
# enough that a genuine same-distance optical double's tens-of-km/s
# space motion clears the safety-factor threshold.
ESCAPE_GATE_DEFAULT_COMPONENT_MASS_MSUN = 3.0
ESCAPE_GATE_DEFAULT_TOTAL_MASS_MSUN = (
    2.0 * ESCAPE_GATE_DEFAULT_COMPONENT_MASS_MSUN
)

# 1 AU/yr expressed in km/s. Converts a tangential angular speed
# (Δμ[arcsec/yr] × d[pc], in AU/yr) to km/s.
KM_S_PER_AU_YR = 4.740470446
# Circular-orbit speed at 1 AU for 1 M_sun: 2π AU/yr in km/s (≈29.78).
# v_escape = √2 × v_circular ⇒ v_escape(M, r) = this × √(2·M / r_AU).
_CIRCULAR_KM_S_1AU_1MSUN = 2.0 * math.pi * KM_S_PER_AU_YR

# Mag-gap backstop (tier 6). Used only when every stronger tier is
# silent (faint Tycho-only systems where neither component has a Gaia 5p
# row, plus the rare AT-HYG-only / position-tier residual). Physical
# WDS pairs are usually within ~5 mag — wider gaps shade into chance
# projection. Coarse gate; the strong filtering is in the Gaia tiers.
MAG_GAP_HEURISTIC_THRESHOLD = 5.0


@dataclass
class OpticalClassification:
    """Per-pair Stage 5 verdict. ``is_physical`` is the join the
    multiples.tsv emit step keys on; ``optical_via`` carries the tier
    that decided so Stage 7's stats line can attribute each
    keep/reject correctly."""

    is_physical: bool
    optical_via: str


def _gaia_for_component(
    component: ResolvedComponent, indices: IdentifierIndices,
) -> GaiaAstrometryRow | None:
    """The component's Gaia 5p astrometry row if both (a) the component
    resolved to a source_id and (b) that source_id is covered by
    ``gaia_dr3_astrometry.tsv``. Returns ``None`` for Gaia-saturated
    bright primaries — those route through HIP2 in the asymmetric
    branch."""
    if component.gaia_source_id is None:
        return None
    return indices.src_to_astrometry.get(component.gaia_source_id)


def _hip2_anchor(
    component: ResolvedComponent, indices: IdentifierIndices,
) -> tuple[float, float | None] | None:
    """The HIP2 ``(parallax, e_parallax)`` anchor for a Gaia-saturated
    component. Returns ``None`` when no HIP is known, the HIP2 catalog
    doesn't cover the HIP, or the HIP2 row lacks a parallax value. The
    error term may be ``None`` — the consistency tests treat a missing
    σ_HIP2 as zero (it drops out of the quadrature)."""
    hip = component.hip
    if hip is None:
        return None
    row = indices.hip_to_hip2.get(hip)
    if row is None or row.plx_mas is None:
        return None
    return row.plx_mas, row.e_plx_mas


def _component_parallax_with_error(
    component: ResolvedComponent, indices: IdentifierIndices,
) -> tuple[float, float | None] | None:
    """The component's own ``(parallax_mas, e_parallax_mas)`` — its Gaia
    5p row when covered, else its HIP2 anchor. ``None`` when neither
    carries a positive parallax."""
    gaia = _gaia_for_component(component, indices)
    if gaia is not None and gaia.parallax_mas is not None and gaia.parallax_mas > 0.0:
        return gaia.parallax_mas, gaia.parallax_error_mas
    hip2 = _hip2_anchor(component, indices)
    if hip2 is not None and hip2[0] > 0.0:
        return hip2[0], hip2[1]
    return None


def _separation_au(
    plx_ref_mas: float,
    e_ref_mas: float | None,
    plx_other_mas: float,
    e_other_mas: float | None,
    rho_arcsec: float | None,
) -> float:
    """3D separation (AU) between two components from their parallaxes
    (mas, both assumed positive) and the pair's on-sky separation ρ. The
    projected term is ρ at the reference distance; the radial term is the
    parallax-derived depth gap, counted only when the parallax difference
    clears ``RADIAL_SEPARATION_SIGMA`` × the combined error (a missing σ
    is treated as zero). See ``RADIAL_SEPARATION_SIGMA``."""
    d_ref_pc = 1000.0 / plx_ref_mas
    projected_au = (rho_arcsec or 0.0) * d_ref_pc
    sigma_combined = math.hypot(e_ref_mas or 0.0, e_other_mas or 0.0)
    radial_au = 0.0
    if abs(plx_ref_mas - plx_other_mas) > RADIAL_SEPARATION_SIGMA * sigma_combined:
        d_other_pc = 1000.0 / plx_other_mas
        radial_au = abs(d_other_pc - d_ref_pc) * AU_PER_PC
    return math.hypot(projected_au, radial_au)


def _escape_velocity_km_s(m_total_msun: float, r_au: float) -> float | None:
    """Escape speed sqrt(2·G·M/r) in km/s. ``None`` for a non-positive
    separation (a collocated / sub-resolution pair — treated as bound)."""
    if r_au <= 0.0:
        return None
    return _CIRCULAR_KM_S_1AU_1MSUN * math.sqrt(2.0 * m_total_msun / r_au)


def _transverse_velocity_km_s(dpm_masyr: float, d_pc: float) -> float:
    """Relative transverse speed (km/s) from a proper-motion difference
    (mas/yr) at distance ``d_pc``."""
    return KM_S_PER_AU_YR * (dpm_masyr / 1000.0) * d_pc


def _separation_exceeds_limit(
    plx_ref_mas: float,
    e_ref_mas: float | None,
    plx_other_mas: float,
    e_other_mas: float | None,
    rho_arcsec: float | None,
) -> bool:
    """``True`` when the 3D separation exceeds the physical bound-pair
    limit (``SEPARATION_LIMIT_PC``). Shared by the tier-3 separation gate,
    the tier-4 both-Gaia parallax reject, and the tier-5 asymmetric-Gaia
    physical-pc tolerance."""
    sep_au = _separation_au(
        plx_ref_mas, e_ref_mas, plx_other_mas, e_other_mas, rho_arcsec,
    )
    return sep_au > SEPARATION_LIMIT_PC * AU_PER_PC


def _pair_beyond_separation_limit(
    primary: ResolvedComponent,
    secondary: ResolvedComponent,
    system_parallax_anchor: tuple[float, float | None] | None,
    rho_arcsec: float | None,
    indices: IdentifierIndices,
) -> bool:
    """Separation-gate test. ``True`` when the pair's two components sit
    more than the physical bound-pair limit apart in 3D. Each component's
    distance is its OWN parallax when it has one, else the system parallax
    anchor (the position a component with no astrometry would inherit).
    The gate fires only off a well-measured OWN parallax (poe ≥
    ``SEPARATION_POE_MIN``) on at least one side, so an UNCERTAIN distance
    (poe < 5) never rejects. Pollux F: F's own ~297 pc vs its partner's
    inherited ~10.4 pc anchor → beyond limit. A real inner binary of an
    optically-projected member (both components the same source, or both
    at the same own distance) stays within the limit → kept."""
    for comp, other in ((primary, secondary), (secondary, primary)):
        own = _component_parallax_with_error(comp, indices)
        if own is None:
            continue
        plx_own, e_own = own
        if e_own is None or e_own <= 0.0:
            continue
        if plx_own / e_own < SEPARATION_POE_MIN:
            continue
        other_par = (
            _component_parallax_with_error(other, indices)
            or system_parallax_anchor
        )
        if other_par is None:
            continue
        plx_other, e_other = other_par
        if plx_other <= 0.0:
            continue
        if _separation_exceeds_limit(
            plx_own, e_own, plx_other, e_other, rho_arcsec,
        ):
            return True
    return False


def _both_gaia_consistent(
    p: GaiaAstrometryRow,
    s: GaiaAstrometryRow,
    rho_arcsec: float | None,
    total_mass_msun: float,
) -> bool | None:
    """Tier-4 verdict. Returns ``True`` (physical), ``False`` (optical),
    or ``None`` (tier silent — fall through) when there is not enough
    Gaia data to evaluate the test.

    Parallax first, but a 3σ disagreement rejects only when the implied
    3D separation also exceeds the physical bound-pair limit — the same
    guard tier 5 applies, so blend-corrupted Gaia parallaxes on a close
    visual pair can't split a within-limit pair on a parallax nuance. A
    within-limit disagreement (and an agreement) falls through to the
    escape-velocity sub-gate: reject when the transverse velocity from
    the PM difference exceeds ``ESCAPE_VELOCITY_SAFETY_FACTOR`` × the
    escape velocity for the pair's mass and separation. Missing PM on
    either component leaves the pair physical."""
    if (
        p.parallax_mas is None or s.parallax_mas is None
        or p.parallax_error_mas is None or s.parallax_error_mas is None
    ):
        return None
    sigma_combined = math.hypot(p.parallax_error_mas, s.parallax_error_mas)
    if abs(p.parallax_mas - s.parallax_mas) >= BOTH_GAIA_PLX_GATE_SIGMA * sigma_combined:
        if p.parallax_mas <= 0.0 or s.parallax_mas <= 0.0:
            return False
        if _separation_exceeds_limit(
            p.parallax_mas, p.parallax_error_mas,
            s.parallax_mas, s.parallax_error_mas,
            rho_arcsec,
        ):
            return False

    if p.parallax_mas <= 0.0 or s.parallax_mas <= 0.0:
        return True
    if (
        p.pmra_masyr is None or s.pmra_masyr is None
        or p.pmdec_masyr is None or s.pmdec_masyr is None
    ):
        return True
    dpm = math.hypot(p.pmra_masyr - s.pmra_masyr, p.pmdec_masyr - s.pmdec_masyr)
    d_pc = 2000.0 / (p.parallax_mas + s.parallax_mas)
    r_au = _separation_au(
        p.parallax_mas, p.parallax_error_mas,
        s.parallax_mas, s.parallax_error_mas,
        rho_arcsec,
    )
    v_escape = _escape_velocity_km_s(total_mass_msun, r_au)
    if v_escape is None:
        return True
    v_transverse = _transverse_velocity_km_s(dpm, d_pc)
    if v_transverse > ESCAPE_VELOCITY_SAFETY_FACTOR * v_escape:
        return False
    return True


def _asymm_gaia_consistent(
    gaia: GaiaAstrometryRow,
    anchor_plx_mas: float,
    anchor_e_plx_mas: float | None,
    rho_arcsec: float | None,
) -> bool | None:
    """Tier-5 verdict. Returns ``True`` / ``False`` / ``None`` — same
    convention as the tier-4 helper. Within 3σ (combined error, a
    missing anchor σ treated as zero) keeps; a 3σ disagreement rejects
    only when the implied 3D separation also exceeds the physical
    bound-pair limit, so a HIP2-vs-Gaia zero-point offset can't split a
    bound pair. ``None`` when the Gaia side lacks parallax or its
    error."""
    if gaia.parallax_mas is None or gaia.parallax_error_mas is None:
        return None
    e_anchor = anchor_e_plx_mas if anchor_e_plx_mas is not None else 0.0
    sigma_combined = math.hypot(gaia.parallax_error_mas, e_anchor)
    if abs(gaia.parallax_mas - anchor_plx_mas) < ASYMM_PLX_GATE_SIGMA * sigma_combined:
        return True
    if gaia.parallax_mas <= 0.0 or anchor_plx_mas <= 0.0:
        return False
    return not _separation_exceeds_limit(
        anchor_plx_mas, anchor_e_plx_mas,
        gaia.parallax_mas, gaia.parallax_error_mas,
        rho_arcsec,
    )


def classify_pair_optical(
    pair: WdsPair,
    primary: ResolvedComponent,
    secondary: ResolvedComponent,
    orbit_via: str,
    indices: IdentifierIndices,
    system_parallax_anchor: tuple[float, float | None] | None = None,
    total_mass_msun: float | None = None,
) -> OpticalClassification:
    """6-tier cascade per WDS pair:

    1. WDS Notes flag chars — T/V/Z keep (physical), S/U/X/Y reject
       (optical), other chars silent.
    2. Orbit on file — Stage 4 selected real orbital elements (Gaia NSS
       or any ORB6 grade). An empirical orbit fit is the strongest
       evidence of physical association and wins over every gate below,
       including the separation limit (a close pair's blended Gaia
       parallaxes don't beat a tracked relative orbit; NSS leaks onto
       wide companions are already blocked upstream by Stage 4).
    3. Separation limit — reject when the pair's two components sit beyond
       the physical bound-pair limit (``SEPARATION_LIMIT_PC``) apart in 3D
       (each at its own parallax, or the system anchor when it has none).
       Catches wide line-of-sight optical doubles fabricated onto the
       system (Pollux F: own 297 pc vs partner's inherited 10.4 pc).
    4. Both-components-Gaia — both carry a Gaia 5p row. A 3σ parallax
       disagreement rejects only when the implied separation also exceeds
       the physical limit (same guard as tier 5); otherwise the
       escape-velocity sub-gate rejects a transverse velocity too large
       to be bound. Passes physical.
    5. Asymmetric Gaia + HIP2 anchor — exactly one component has a Gaia 5p
       row, the other a HIP2 parallax anchor. Gaia parallax vs anchor at
       3σ, rejecting only when the implied separation also exceeds the
       physical limit. Backstop for a poe < 5 Gaia parallax; the
       well-measured Sirius A-C/D/E/F-shaped splits reject upstream at
       tier 3.
    6. Mag-gap backstop — |Δmag| ≤ 5 keep, otherwise reject. Used when no
       other tier fired. A pair with no usable mags is kept — absence of
       evidence is not evidence of optical contamination.
    """
    mass = (
        total_mass_msun if total_mass_msun is not None
        else ESCAPE_GATE_DEFAULT_TOTAL_MASS_MSUN
    )

    # Tier 1 — WDS Notes flag chars.
    notes_chars = set(pair.notes.upper())
    if notes_chars & WDS_NOTES_OPTICAL_CHARS:
        return OpticalClassification(False, "wds_notes_rejected")
    if notes_chars & WDS_NOTES_PHYSICAL_CHARS:
        return OpticalClassification(True, "wds_notes_kept")

    # Tier 2 — orbit on file. An empirical orbit is the strongest
    # physical evidence and wins over the separation / σ / velocity gates.
    if orbit_via in ORBIT_VIA_ON_FILE:
        return OpticalClassification(True, "orbit_kept")

    # Tier 3 — separation limit. The pair's two components more than the
    # physical bound-pair limit apart in 3D are a line-of-sight optical
    # double (Pollux F). Silent without any usable parallax on both sides.
    if _pair_beyond_separation_limit(
        primary, secondary, system_parallax_anchor, pair.rho_last, indices,
    ):
        return OpticalClassification(False, "sep_limit_rejected")

    # Tier 4 — both-Gaia (parallax 3σ + escape velocity).
    p_gaia = _gaia_for_component(primary, indices)
    s_gaia = _gaia_for_component(secondary, indices)
    if p_gaia is not None and s_gaia is not None:
        verdict = _both_gaia_consistent(p_gaia, s_gaia, pair.rho_last, mass)
        if verdict is True:
            return OpticalClassification(True, "gaia_kept")
        if verdict is False:
            return OpticalClassification(False, "gaia_rejected")

    # Tier 5 — asymmetric Gaia + HIP2 anchor.
    if p_gaia is None and s_gaia is not None:
        anchor = _hip2_anchor(primary, indices)
        if anchor is not None:
            verdict = _asymm_gaia_consistent(
                s_gaia, anchor[0], anchor[1], pair.rho_last,
            )
            if verdict is True:
                return OpticalClassification(True, "asymm_kept")
            if verdict is False:
                return OpticalClassification(False, "asymm_rejected")
    if s_gaia is None and p_gaia is not None:
        anchor = _hip2_anchor(secondary, indices)
        if anchor is not None:
            verdict = _asymm_gaia_consistent(
                p_gaia, anchor[0], anchor[1], pair.rho_last,
            )
            if verdict is True:
                return OpticalClassification(True, "asymm_kept")
            if verdict is False:
                return OpticalClassification(False, "asymm_rejected")

    # Tier 6 — mag-gap backstop. Default policy when no other tier
    # fired is to keep the pair (so e.g. naked-WDS rows without any
    # photometric data ride through).
    if pair.mag_pri is not None and pair.mag_sec is not None:
        if abs(pair.mag_pri - pair.mag_sec) > MAG_GAP_HEURISTIC_THRESHOLD:
            return OpticalClassification(False, "mag_heuristic_rejected")
    return OpticalClassification(True, "mag_heuristic_kept")


def classify_all_pairs(
    pairs: list[WdsPair],
    components: list[ResolvedComponent],
    orbits: list[tuple[OrbitElements | None, str]],
    indices: IdentifierIndices,
    system_parallax_anchors: dict[str, tuple[float, float | None]] | None = None,
    pair_masses: list[float] | None = None,
) -> list[OpticalClassification]:
    """One ``OpticalClassification`` per decomposing WDS pair, in
    ``resolve_all_pairs`` iteration order. Stage 6 zips this list back
    against the per-pair iteration to drop optical pairs from
    multiples.tsv emit (and surface ``optical_via`` for keepers). The
    Stage 4 ``orbits`` list runs parallel to decomposing pairs (one
    entry per pair) and feeds the orbit-on-file tier.

    ``system_parallax_anchors`` (per-``wds_id`` parallax + error) feeds the
    tier-3 separation-limit gate; omitted → that tier is silent (the
    in-process tests that don't exercise it). ``pair_masses`` (parallel
    to the decomposing pairs) feeds the escape-velocity sub-gate; omitted
    → the gate uses ``ESCAPE_GATE_DEFAULT_TOTAL_MASS_MSUN``."""
    n_pairs = sum(
        1 for p in pairs if split_components(p.components) is not None
    )
    if len(orbits) != n_pairs:
        raise ValueError(
            "Stage 5 input cardinality disagreement — orbits must run "
            "parallel to decomposing pairs"
        )
    if pair_masses is not None and len(pair_masses) != n_pairs:
        raise ValueError(
            "Stage 5 input cardinality disagreement — pair_masses must "
            "run parallel to decomposing pairs"
        )
    anchors = system_parallax_anchors or {}
    out: list[OpticalClassification] = []
    for j, (pair, p, s) in enumerate(
        iter_decomposing_pair_components(pairs, components)
    ):
        _, orbit_via = orbits[j]
        out.append(classify_pair_optical(
            pair, p, s, orbit_via, indices,
            anchors.get(pair.wds_id),
            pair_masses[j] if pair_masses is not None else None,
        ))
    return out


def optical_counts(
    classifications: list[OpticalClassification],
) -> dict[str, int]:
    """Per-tag counters in canonical ``OPTICAL_VIA_VALUES`` order.
    Every key is present (zero-filled) so the log line shape stays
    stable across runs."""
    counts: dict[str, int] = {k: 0 for k in OPTICAL_VIA_VALUES}
    for c in classifications:
        counts[c.optical_via] = counts.get(c.optical_via, 0) + 1
    return counts
