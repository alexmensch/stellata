#!/usr/bin/env python3
"""Stage 5 — classify each WDS pair as physical or optical.
Five-tier cascade; each verdict carries the deciding tier as provenance.
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parsers import (  # noqa: E402
    GaiaAstrometryRow,
    Hip2Row,
    WdsPair,
)
from indices import IdentifierIndices  # noqa: E402
from stage2_resolve import (  # noqa: E402
    ResolvedComponent,
    iter_decomposing_pair_components,
    split_components,
)
from stage3_astrometry import ComponentAstrometry  # noqa: E402
from stage4_orbits import OrbitElements  # noqa: E402


# ─── Stage 5: optical-pair filter cascade ────────────────────────────


# Per-pair classification tags Stage 5 may emit. Both the headline log
# line and ``optical_counts`` walk this tuple so adding a new tier (or
# splitting an existing tier) only edits the canonical ordering here.
OPTICAL_VIA_VALUES: tuple[str, ...] = (
    "wds_notes_kept",
    "wds_notes_rejected",
    "gaia_kept",
    "gaia_rejected",
    "asymm_kept",
    "asymm_rejected",
    "orbit_kept",
    "mag_heuristic_kept",
    "mag_heuristic_rejected",
)

# Orbit-via values that count as "orbit on file" for tier 4. Tier 4
# fires for pairs Stage 4 selected real orbital elements for — these
# are direct evidence of physical association that beats the mag-gap
# heuristic (e.g. Sirius A-B has a grade-2 ORB6 visual orbit but a
# 9.9-mag gap to its white-dwarf companion, which mag-gap alone would
# misclassify as optical).
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

# Both-Gaia gate (tier 2). Parallax must agree within 3σ of the
# combined-axis error; per-axis PM differences must each be within
# 5 mas/yr. Parallax is the dominant signal — a 3σ disagreement on
# parallax alone is enough to reject. PM is a refinement: if parallax
# agrees and PM data is missing, accept; if parallax agrees but PM
# disagrees on any populated axis, reject.
BOTH_GAIA_PLX_GATE_SIGMA = 3.0
BOTH_GAIA_PM_GATE_DELTA_MASYR = 5.0

# Asymmetric-Gaia gate (tier 3). When only one component has a Gaia
# 5p row and the other is Gaia-saturated, the saturated star's HIP2
# parallax becomes the anchor distance. The 3σ test runs against the
# combined Gaia + HIP2 parallax error. Sirius A-C/D/E/F is the
# motivating case: A (Sirius) has ~378 mas via HIP2; C/D/E/F have
# <1 mas via Gaia — an enormous excess versus the σ_combined floor.
ASYMM_PLX_GATE_SIGMA = 3.0

# Mag-gap backstop (tier 4). Used only when both Gaia tiers are silent
# (faint Tycho-only systems where neither component has a Gaia 5p
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
    """Tier 2 / tier 3 helper: the component's Gaia 5p astrometry row
    if both (a) the component resolved to a source_id and (b) that
    source_id is covered by ``gaia_dr3_astrometry.tsv``. Returns
    ``None`` for Gaia-saturated bright primaries — those route through
    HIP2 in the tier-3 asymmetric branch."""
    if component.gaia_source_id is None:
        return None
    return indices.src_to_astrometry.get(component.gaia_source_id)


def _hip2_anchor(
    component: ResolvedComponent, indices: IdentifierIndices,
) -> tuple[float, float | None] | None:
    """Tier 3 helper: the HIP2 (parallax, e_parallax) anchor for a
    Gaia-saturated component. Returns ``None`` when no HIP is known
    (component never resolved through any tier with a HIP) or the
    HIP2 catalog doesn't cover the HIP, or the HIP2 row lacks a
    parallax value. The error term may be ``None`` — the tier's
    consistency test treats a missing σ_HIP2 as the Gaia σ alone
    (the HIP2 contribution drops out of the quadrature)."""
    hip = component.hip
    if hip is None:
        return None
    row = indices.hip_to_hip2.get(hip)
    if row is None or row.plx_mas is None:
        return None
    return row.plx_mas, row.e_plx_mas


def _both_gaia_consistent(
    p: GaiaAstrometryRow, s: GaiaAstrometryRow,
) -> bool | None:
    """Tier 2 verdict. Returns ``True`` (physical), ``False`` (optical),
    or ``None`` (tier silent — fall through to mag-gap heuristic)
    when there is not enough Gaia data to evaluate the parallax test
    on at least one axis.

    Parallax-only sufficient: a 3σ-passing parallax with missing PM on
    one or both components is still classified as physical. The PM
    refinement can only flip a parallax-pass to optical when PM
    positively disagrees on a populated axis.
    """
    if (
        p.parallax_mas is None or s.parallax_mas is None
        or p.parallax_error_mas is None or s.parallax_error_mas is None
    ):
        return None
    sigma_combined = math.hypot(p.parallax_error_mas, s.parallax_error_mas)
    if abs(p.parallax_mas - s.parallax_mas) >= BOTH_GAIA_PLX_GATE_SIGMA * sigma_combined:
        return False

    if (
        p.pmra_masyr is not None and s.pmra_masyr is not None
        and abs(p.pmra_masyr - s.pmra_masyr) >= BOTH_GAIA_PM_GATE_DELTA_MASYR
    ):
        return False
    if (
        p.pmdec_masyr is not None and s.pmdec_masyr is not None
        and abs(p.pmdec_masyr - s.pmdec_masyr) >= BOTH_GAIA_PM_GATE_DELTA_MASYR
    ):
        return False
    return True


def _asymm_gaia_consistent(
    gaia: GaiaAstrometryRow, anchor_plx_mas: float, anchor_e_plx_mas: float | None,
) -> bool | None:
    """Tier 3 verdict. Returns ``True`` / ``False`` / ``None`` — same
    convention as the tier-2 helper. ``None`` only when the Gaia side
    is missing parallax or its error (the anchor σ is treated as 0
    when missing, since the HIP2 catalog often does carry σ even
    when downstream parsers don't surface it)."""
    if gaia.parallax_mas is None or gaia.parallax_error_mas is None:
        return None
    e_anchor = anchor_e_plx_mas if anchor_e_plx_mas is not None else 0.0
    sigma_combined = math.hypot(gaia.parallax_error_mas, e_anchor)
    if abs(gaia.parallax_mas - anchor_plx_mas) >= ASYMM_PLX_GATE_SIGMA * sigma_combined:
        return False
    return True


def classify_pair_optical(
    pair: WdsPair,
    primary: ResolvedComponent,
    secondary: ResolvedComponent,
    orbit_via: str,
    indices: IdentifierIndices,
) -> OpticalClassification:
    """5-tier cascade per WDS pair:

    1. WDS Notes flag chars — T/V/Z keep (physical), S/U/X/Y reject
       (optical), other chars silent.
    2. Both-components-Gaia gate — both components carry a Gaia 5p row.
       Compare parallax (3σ on combined error) AND per-axis PM
       (≤5 mas/yr). Passes physical, fails optical.
    3. Asymmetric-Gaia gate — exactly one component has a Gaia 5p row,
       the other has a HIP2 parallax anchor (Gaia-saturated bright
       primary). Compare the Gaia parallax against the HIP2 anchor at
       3σ. Catches Sirius A-C/D/E/F directly: anchor 378 mas vs Gaia
       <1 mas → enormous excess, reject.
    4. Orbit-on-file override — Stage 4 selected real orbital elements
       (Gaia NSS or any ORB6 grade). An empirical orbit fit is direct
       evidence of physical association; it overrides the mag-gap
       heuristic for cases like Sirius A-B where the WD companion
       creates a wide photometric gap on a known-physical pair.
    5. Mag-gap backstop — |Δmag| ≤ 5 magnitudes keep, otherwise reject.
       Used when no other tier fired (rare under the source-ID
       resolution chain but possible for Tycho-only systems without
       orbits). If the pair has no usable mags either, the backstop
       keeps it — the absence of evidence is not evidence of optical
       contamination.
    """
    # Tier 1 — WDS Notes flag chars.
    notes_chars = set(pair.notes.upper())
    if notes_chars & WDS_NOTES_OPTICAL_CHARS:
        return OpticalClassification(False, "wds_notes_rejected")
    if notes_chars & WDS_NOTES_PHYSICAL_CHARS:
        return OpticalClassification(True, "wds_notes_kept")

    # Tier 2 — both-Gaia.
    p_gaia = _gaia_for_component(primary, indices)
    s_gaia = _gaia_for_component(secondary, indices)
    if p_gaia is not None and s_gaia is not None:
        verdict = _both_gaia_consistent(p_gaia, s_gaia)
        if verdict is True:
            return OpticalClassification(True, "gaia_kept")
        if verdict is False:
            return OpticalClassification(False, "gaia_rejected")
        # verdict is None — Gaia rows lacked the data to gate; fall
        # through to the mag-gap heuristic.

    # Tier 3 — asymmetric Gaia + HIP2 anchor.
    if p_gaia is None and s_gaia is not None:
        anchor = _hip2_anchor(primary, indices)
        if anchor is not None:
            verdict = _asymm_gaia_consistent(s_gaia, anchor[0], anchor[1])
            if verdict is True:
                return OpticalClassification(True, "asymm_kept")
            if verdict is False:
                return OpticalClassification(False, "asymm_rejected")
    if s_gaia is None and p_gaia is not None:
        anchor = _hip2_anchor(secondary, indices)
        if anchor is not None:
            verdict = _asymm_gaia_consistent(p_gaia, anchor[0], anchor[1])
            if verdict is True:
                return OpticalClassification(True, "asymm_kept")
            if verdict is False:
                return OpticalClassification(False, "asymm_rejected")

    # Tier 4 — orbit on file. Stage 4 selected real orbital elements
    # for this pair; that's empirical evidence beating the mag-gap
    # backstop. Famous WD-companion physical pairs (Sirius A-B, Procyon
    # A-B) need this override.
    if orbit_via in ORBIT_VIA_ON_FILE:
        return OpticalClassification(True, "orbit_kept")

    # Tier 5 — mag-gap backstop. Default policy when no other tier
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
) -> list[OpticalClassification]:
    """One ``OpticalClassification`` per decomposing WDS pair, in
    ``resolve_all_pairs`` iteration order. Stage 6 zips this list back
    against the per-pair iteration to drop optical pairs from
    multiples.tsv emit (and surface ``optical_via`` for keepers). The
    Stage 4 ``orbits`` list runs parallel to decomposing pairs (one
    entry per pair) and feeds the orbit-on-file tier of the cascade.
    """
    if len(orbits) != sum(
        1 for p in pairs if split_components(p.components) is not None
    ):
        raise ValueError(
            "Stage 5 input cardinality disagreement — orbits must run "
            "parallel to decomposing pairs"
        )
    out: list[OpticalClassification] = []
    for j, (pair, p, s) in enumerate(
        iter_decomposing_pair_components(pairs, components)
    ):
        _, orbit_via = orbits[j]
        out.append(classify_pair_optical(pair, p, s, orbit_via, indices))
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


