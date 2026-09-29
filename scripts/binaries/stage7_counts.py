#!/usr/bin/env python3
"""Stage 7 — write the build-counts and per-strategy-rates snapshot JSONs.
Refresh with ``UPDATE_BUILD_COUNTS=1``.
"""

from __future__ import annotations

import json
from pathlib import Path

from .parsers import WdsPair
from .stage2_resolve import (
    BINDING_INTEGRITY_COUNT_KEYS,
    RESOLVE_VIA_VALUES,
    ResolvedComponent,
    resolution_counts,
)
from .stage3_astrometry import (
    ASTROMETRY_VIA_VALUES,
    ComponentAstrometry,
    astrometry_counts,
)
from .stage4_orbits import (
    ORBIT_VIA_VALUES,
    OrbitElements,
    orbit_counts,
)
from .stage5_optical import (
    OPTICAL_VIA_VALUES,
    OpticalClassification,
    optical_counts,
)
from .stage6_multiples import (
    ASTROMETRY_VIA_SYSTEM_INHERITED, A_VIA_VALUES, ORBIT_ROLE_STANDALONE,
    SPECT_VIA_VALUES, MultiplesRow,
)
from scripts.util.snapshot_assert import (
    SnapshotDiff,
    assert_or_update_snapshot,
    compare_snapshot,
    format_diff,
)

LABEL = "build-binaries"

# ─── Stage 7: build-time stats ───────────────────────────────────────


def build_binaries_counts(
    *,
    pairs: list[WdsPair],
    components: list[ResolvedComponent],
    astrometry: list[ComponentAstrometry],
    orbits: list[tuple[OrbitElements | None, str]],
    classifications: list[OpticalClassification],
    multiples_rows: list[MultiplesRow],
    synthesized_orb6_pairs: int = 0,
    synthesized_nss_pairs: int = 0,
    synthesized_msc_pairs: int = 0,
    msc_pair_mags_filled: int = 0,
    msc_orbits_unmapped: int = 0,
    binding_integrity: dict[str, int] | None = None,
    xwalk_mag_rejected: int = 0,
    athyg_gaia_mag_rejected: int = 0,
    wds_duplicate_pair_rows_dropped: int = 0,
    multiples_pairs_dropped_no_position: int = 0,
    blank_components_rescued: int = 0,
    blank_components_deferred: int = 0,
    ccdm_sibling_owned_rejected: int = 0,
    athyg_match_sibling_claimed_rejected: int = 0,
) -> dict[str, int]:
    """Collect every headline number the run emits into a flat
    ``{key: int}`` dict, suitable for JSON serialisation and per-key
    comparison. Keys flatten the per-strategy + per-tier counters via
    ``<section>_<tag>`` so the JSON stays grep-friendly and the
    snapshot diff is a flat dict-diff.

    Decomposing-pair count is the number of WDS pairs whose components
    string split into two; aligns with ``len(orbits) ==
    len(classifications)``.
    """
    res = resolution_counts(components)
    ast = astrometry_counts(astrometry)
    orb = orbit_counts(orbits)
    opt = optical_counts(classifications)

    # Per-component spect provenance via the row's ``spect_via`` tag
    # (mirrors the per-section ``_via`` counters below).
    spect_counts: dict[str, int] = {tag: 0 for tag in SPECT_VIA_VALUES}
    for r in multiples_rows:
        spect_counts[r.spect_via] = spect_counts.get(r.spect_via, 0) + 1

    # Count system-anchor-inherited positions and standalone
    # (per-component augmentation) rows directly off the emitted
    # multiples list so the snapshot diff catches drift in either
    # tier independently of Stage 3's per-component counts.
    multiples_inherited = sum(
        1 for r in multiples_rows
        if r.astrometry_via == ASTROMETRY_VIA_SYSTEM_INHERITED
    )
    standalone_emitted = sum(
        1 for r in multiples_rows
        if r.orbit_role == ORBIT_ROLE_STANDALONE
    )

    # Per-pair sep + PA + epoch fill rates. The runtime layer reads
    # sep+PA to project the secondary on the static-placement path,
    # so a silent drop in fill rate breaks Tier-3 without showing up
    # in any other counter.
    sep_arcsec_populated = sum(
        1 for r in multiples_rows if r.sep_arcsec is not None
    )
    pa_deg_populated = sum(
        1 for r in multiples_rows if r.pa_deg is not None
    )
    sep_pa_epoch_populated = sum(
        1 for r in multiples_rows if r.sep_pa_epoch_jd is not None
    )
    dmag_populated = sum(1 for r in multiples_rows if r.dmag is not None)
    hd_populated = sum(1 for r in multiples_rows if r.hd is not None)

    # Per-pair a provenance + q fill — both gate the runtime's
    # has_orbit bit, so a silent drop here stops pairs animating
    # without moving any orbit_via count.
    a_via_counts: dict[str, int] = {tag: 0 for tag in A_VIA_VALUES}
    for r in multiples_rows:
        a_via_counts[r.a_via] = a_via_counts.get(r.a_via, 0) + 1
    orbit_q_populated = sum(
        1 for r in multiples_rows
        if r.orbit_via != "none" and r.q is not None
    )

    out: dict[str, int] = {
        "wds_pairs_total": len(pairs),
        "wds_duplicate_pair_rows_dropped": wds_duplicate_pair_rows_dropped,
        "blank_components_rescued": blank_components_rescued,
        "blank_components_deferred": blank_components_deferred,
        "ccdm_sibling_owned_rejected": ccdm_sibling_owned_rejected,
        "athyg_match_sibling_claimed_rejected": athyg_match_sibling_claimed_rejected,
        "decomposing_pairs": len(orbits),
        "components_total": len(components),
        "synthesized_orb6_orphan_pairs": synthesized_orb6_pairs,
        "synthesized_nss_inner_pairs": synthesized_nss_pairs,
        "synthesized_msc_inner_pairs": synthesized_msc_pairs,
        "msc_pair_mags_filled": msc_pair_mags_filled,
        "msc_orbits_unmapped": msc_orbits_unmapped,
        "xwalk_hip_mag_rejected": xwalk_mag_rejected,
        "athyg_gaia_mag_rejected": athyg_gaia_mag_rejected,
        "multiples_rows_emitted": len(multiples_rows),
        "multiples_pairs_dropped_no_position": multiples_pairs_dropped_no_position,
        "multiples_astrometry_system_inherited": multiples_inherited,
        "multiples_standalone_emitted": standalone_emitted,
        "multiples_hd_populated": hd_populated,
        "multiples_sep_arcsec_populated": sep_arcsec_populated,
        "multiples_pa_deg_populated": pa_deg_populated,
        "multiples_sep_pa_epoch_populated": sep_pa_epoch_populated,
        "multiples_dmag_populated": dmag_populated,
        "multiples_orbit_q_populated": orbit_q_populated,
    }
    for tag in A_VIA_VALUES:
        out[f"a_via_{tag}"] = a_via_counts[tag]
    for tag in SPECT_VIA_VALUES:
        out[f"spect_{tag}"] = spect_counts[tag]
    for tag in RESOLVE_VIA_VALUES:
        out[f"resolution_{tag}"] = res[tag]
    for tag in ASTROMETRY_VIA_VALUES:
        out[f"astrometry_{tag}"] = ast[tag]
    for tag in ORBIT_VIA_VALUES:
        out[f"orbit_{tag}"] = orb[tag]
    for tag in OPTICAL_VIA_VALUES:
        out[f"optical_{tag}"] = opt[tag]
    for key in BINDING_INTEGRITY_COUNT_KEYS:
        out[key] = (binding_integrity or {}).get(key, 0)
    return out


# ─── Stage 7B — derived rate snapshot ────────────────────────────────


# Default ±tolerance (relative to expected value) applied when a rate
# is first written into the snapshot. Hand-edited per-key tolerances
# survive refreshes via mergeReasonsFromSnapshot-style preservation in
# ``assert_or_update_rates``.
DEFAULT_RATE_TOLERANCE = 0.20

# Stage-2 resolution tiers that carry a source-ID anchor. ``ccdm_hip``
# uses HIP cross-reference and is intentionally excluded — the rate is
# specifically the source-ID-anchored fraction, not 'all-resolved'.
GAIA_RESOLVE_TAGS: tuple[str, ...] = (
    "orb6_hip", "athyg_gaia_native", "simbad_xid",
)

# ``orbit_kept`` survives in any case (orbital evidence overrides the
# cascade), so the rate runs over the union of cascade decisions with
# ``decomposing_pairs`` as the denominator.
OPTICAL_REJECT_TAGS: tuple[str, ...] = tuple(
    tag for tag in OPTICAL_VIA_VALUES if tag.endswith("_rejected")
)

# Orbital-source tiers other than ``none`` — the population the
# NSS-vs-ORB6 routing applies to.
ORBIT_RESOLVED_TAGS: tuple[str, ...] = (
    "gaia_nss", "orb6", "orb6_spectroscopic", "msc",
)


def build_binaries_rates(counts: dict[str, int]) -> dict[str, float]:
    """Derive headline rates from the int counters. Each rate is
    dimensionless and bounded [0, 1]; denominators that would divide
    by zero return 0.0 so a half-populated build doesn't NaN the
    snapshot diff. Pure — no I/O."""
    components_total = counts.get("components_total", 0)
    decomposing_pairs = counts.get("decomposing_pairs", 0)

    source_id_anchored = sum(
        counts.get(f"resolution_{tag}", 0) for tag in GAIA_RESOLVE_TAGS
    )
    gaia_resolve_rate = (
        source_id_anchored / components_total if components_total > 0 else 0.0
    )

    optical_rejected = sum(
        counts.get(f"optical_{tag}", 0) for tag in OPTICAL_REJECT_TAGS
    )
    optical_rejected_rate = (
        optical_rejected / decomposing_pairs if decomposing_pairs > 0 else 0.0
    )

    orbits_resolved = sum(
        counts.get(f"orbit_{tag}", 0) for tag in ORBIT_RESOLVED_TAGS
    )
    nss_orbit = counts.get("orbit_gaia_nss", 0)
    nss_orbit_rate = nss_orbit / orbits_resolved if orbits_resolved > 0 else 0.0

    hip2_fallback_rate = (
        counts.get("astrometry_hip2_long_baseline", 0) / components_total
        if components_total > 0 else 0.0
    )

    return {
        "gaia_resolve_rate": gaia_resolve_rate,
        "optical_rejected_rate": optical_rejected_rate,
        "nss_orbit_rate": nss_orbit_rate,
        "hip2_fallback_rate": hip2_fallback_rate,
    }


def compare_build_rates(
    expected: dict[str, dict[str, float]], actual: dict[str, float],
) -> list[SnapshotDiff]:
    """Per-rate tolerance-based diff. Expected entries carry a ``value``
    + ``tolerance``; pass window is ``|actual - value| / max(|value|,
    1e-9) <= tolerance``. Pure — no I/O."""
    return compare_snapshot(
        expected, actual,
        expected_value=lambda e: float(e["value"]),
        tolerance_of=lambda e: float(e["tolerance"]),
        matches=lambda ev, av, tol: abs(av - ev) / max(abs(ev), 1e-9) <= tol,
        mismatch_status="drift",
    )


def format_rate_diff(diff: list[SnapshotDiff]) -> str:
    """Rate-snapshot formatter — drifted rows carry the ± tolerance."""
    def drift(d: SnapshotDiff) -> str:
        ev = d.expected if d.expected is not None else 0.0
        av = d.actual if d.actual is not None else 0.0
        tol = d.tolerance if d.tolerance is not None else 0.0
        return f"  {d.key:<28} expected {ev:.4f} ± {tol:.0%}, got {av:.4f}"

    def missing_actual(d: SnapshotDiff) -> str:
        ev = d.expected if d.expected is not None else 0.0
        return f"  {d.key:<28} expected {ev:.4f}, missing in actual"

    def missing_expected(d: SnapshotDiff) -> str:
        av = d.actual if d.actual is not None else 0.0
        return f"  {d.key:<28} new rate, got {av:.4f} (no snapshot)"

    return format_diff(
        diff,
        label=LABEL,
        noun="rates", ok_suffix="rates within tolerance", diff_verb="rates drifted",
        mismatch_status="drift",
        render_mismatch=drift,
        render_missing_actual=missing_actual,
        render_missing_expected=missing_expected,
    )


def _rates_snapshot_payload(
    actual: dict[str, float], expected_path: Path,
) -> dict[str, dict[str, float]]:
    """Rate snapshot serialisation — values rounded to 6 decimals for
    stable diffs across float round-trips; per-key ``tolerance`` overrides
    preserved from the existing snapshot so a refresh never silently
    resets a hand-edited tolerance."""
    existing: dict[str, dict[str, float]] = {}
    if expected_path.exists():
        existing = json.loads(expected_path.read_text())
    return {
        k: {
            "value": round(v, 6),
            "tolerance": float(
                existing.get(k, {}).get("tolerance", DEFAULT_RATE_TOLERANCE),
            ),
        }
        for k, v in actual.items()
    }


def assert_or_update_rates(
    actual: dict[str, float], expected_path: Path,
) -> bool:
    """Tolerance-aware sibling of ``assert_or_update_counts``."""
    return assert_or_update_snapshot(
        actual, expected_path,
        label=LABEL,
        build_payload=_rates_snapshot_payload,
        compare=compare_build_rates,
        format_diff=format_rate_diff,
    )


# ─── Driver ──────────────────────────────────────────────────────────

