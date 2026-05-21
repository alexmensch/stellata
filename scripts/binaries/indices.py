#!/usr/bin/env python3
"""Stage 1 — identifier-index construction.

``IdentifierIndices`` carries every map Stage 2's resolution cascade
consults: HIP/Tyc → Gaia, src → HIP / NSS / astrometry / AT-HYG, HIP
→ HIP2 / CCDM, CCDM → HIP-list. Built once in ``build_indices`` so
every Stage 2-7 lookup is O(1).

Also hosts the three sentinel constants Stage 2's position-match path
reads — they describe input-catalogue conventions that don't belong on
any one stage's function.

Lifted out of ``build-binaries.py`` in stellata-9mm.204.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parsers import (  # noqa: E402
    AthygRow,
    CcdmRow,
    GaiaAstrometryRow,
    Hip2Row,
)


# ─── Identifier indices ──────────────────────────────────────────────


# WDS catalog's overflow sentinel for ρ (and θ): when the published
# value exceeds the 5-char field width, WDS writes ``999.9`` rather
# than truncating. For very wide pairs (e.g. α Cen A vs Proxima, LDS
# 494 AC: ρ ≈ 9000″) the (ρ, θ) offset cannot be used to predict the
# secondary's position — Stage 2 short-circuits the predicted-secondary
# match when ρ ≥ this threshold and relies on per-component identifier
# bindings (SIMBAD, CCDM) for ultra-wide companions.
WDS_RHO_OVERFLOW_THRESHOLD_ARCSEC = 999.0

# AT-HYG's documented reference epoch is J2000.0, but for HIP-sourced
# rows the stored ``ra``/``dec`` are empirically at HIP1's native
# epoch J1991.25 (e.g. α Cen A is at 219.92041, which is HIP1's
# published J1991.25 RA, not the J2000-propagated 219.9020°). Stage 2
# propagates each AT-HYG row forward by ``WDS_PRECISE_COORD_EPOCH -
# ATHYG_REFERENCE_EPOCH`` years using the row's own PM before
# comparing to WDS precise_coord, which is J2000-frame. For low-PM
# stars the 8.75-yr propagation moves the row by < tolerance, so the
# match still fires when the row was already at J2000.
ATHYG_REFERENCE_EPOCH = 1991.25

# WDS precise_coord (cols 113-130) is at J2000 — the same precise coord
# string is shared across every pair row in a WDS system regardless of
# the per-row ``date_last``, confirming a system-level static coord
# rather than a date_last-anchored one.
WDS_PRECISE_COORD_EPOCH = 2000.0


@dataclass
class IdentifierIndices:
    """Output of Stage 1. Every Stage 2-7 lookup goes through these maps
    so the resolution chain stays cone-match-free for stars carrying a
    classical identifier."""

    hip_to_gaia: dict[int, int]
    tyc_to_gaia: dict[str, int]
    src_to_hip: dict[int, int]    # inverse of hip_to_gaia
    src_to_nss: dict[int, dict[str, str]]
    src_to_astrometry: dict[int, GaiaAstrometryRow]
    hip_to_athyg: dict[int, AthygRow]
    tyc_to_athyg: dict[str, AthygRow]
    src_to_athyg: dict[int, AthygRow]
    hip_to_hip2: dict[int, Hip2Row]
    # Hipparcos CCDM annex maps. The CCDM identifier is the multiple-
    # system anchor — every HIP that belongs to the same physical
    # multiple system shares the same CCDM string. WDS system ids
    # are positional ("HHMMm±DDMM") and match CCDM ids for the vast
    # majority of systems, so Stage 2 keys the ``ccdm_hip`` tier on
    # ``wds_id``-as-CCDM lookups against ``ccdm_to_hips``.
    hip_to_ccdm: dict[int, str]
    ccdm_to_hips: dict[str, list[int]]


def build_indices(
    athyg: list[AthygRow],
    hip2: list[Hip2Row],
    hip_to_gaia: dict[int, int],
    tyc_to_gaia: dict[str, int],
    src_to_nss: dict[int, dict[str, str]],
    src_to_astrometry: dict[int, GaiaAstrometryRow] | None = None,
    ccdm: list[CcdmRow] | None = None,
) -> IdentifierIndices:
    hip_to_athyg: dict[int, AthygRow] = {}
    tyc_to_athyg: dict[str, AthygRow] = {}
    src_to_athyg: dict[int, AthygRow] = {}
    for row in athyg:
        if row.hip is not None:
            hip_to_athyg[row.hip] = row
        if row.tyc is not None:
            tyc_to_athyg[row.tyc] = row
        if row.gaia is not None:
            src_to_athyg[row.gaia] = row
    hip_to_hip2: dict[int, Hip2Row] = {row.hip: row for row in hip2}
    # Inverse of hip_to_gaia. The Gaia HIP cross-walk is many-to-one
    # (multiple HIPs can resolve to the same Gaia source for tight
    # systems), so collisions here pick whichever HIP appears first.
    # Stage 3's HIP2 fallback only needs *some* HIP to look up the
    # van Leeuwen row, not the canonical one — any HIP wholly inside
    # the Gaia source's footprint suffices.
    src_to_hip: dict[int, int] = {}
    for hip, src in hip_to_gaia.items():
        src_to_hip.setdefault(src, hip)
    hip_to_ccdm: dict[int, str] = {}
    ccdm_to_hips: dict[str, list[int]] = {}
    for row in ccdm or []:
        if not row.ccdm:
            continue
        hip_to_ccdm[row.hip] = row.ccdm
        ccdm_to_hips.setdefault(row.ccdm, []).append(row.hip)
    return IdentifierIndices(
        hip_to_gaia=hip_to_gaia,
        tyc_to_gaia=tyc_to_gaia,
        src_to_hip=src_to_hip,
        src_to_nss=src_to_nss,
        src_to_astrometry=src_to_astrometry or {},
        hip_to_athyg=hip_to_athyg,
        tyc_to_athyg=tyc_to_athyg,
        src_to_athyg=src_to_athyg,
        hip_to_hip2=hip_to_hip2,
        hip_to_ccdm=hip_to_ccdm,
        ccdm_to_hips=ccdm_to_hips,
    )


