#!/usr/bin/env python3
"""Stage 1 — cross-catalog identifier index.
Builds the ``IdentifierIndices`` lookup tables every later stage reads.
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

# One-sided magnitude-consistency gate on HIP-anchored Gaia bindings.
# Gaia's hipparcos2_best_neighbour cross-walk has no magnitude check, so
# a HIP too saturated for a DR3 source best-matches whatever source IS
# nearby — the resolvable companion (Castor A → B's source) or a faint
# background star (α Cen B → a G=20.9 source). AT-HYG's own ``gaia``
# column ingests the same cross-walk and carries the same mis-matches.
# Physically G − V tops out near +0.1 (bluest stars; red stars run
# G brighter, i.e. negative), plus ~+0.75 when the catalogued V is an
# equal pair's blend and Gaia resolved one member — so a source more
# than 1 mag fainter than the star's V cannot carry the light the HIP
# names. One-sided by construction: a brighter-than-V source is the
# normal red-star regime and is never rejected. Empirical sweep of the
# xwalk: every binding past +1.0 with both mags on file is an
# early-type star whose gap is unphysical (wrong source), topping out
# at α Cen B's +19.6.
GAIA_BINDING_G_MINUS_V_REJECT_MAG = 1.0


def _binding_mag_inconsistent(
    v_mag: float | None,
    source_id: int,
    src_to_astrometry: dict[int, GaiaAstrometryRow],
) -> bool:
    """True when the bound source's G is implausibly faint for the
    star's catalogued V. Missing V, unknown source, or missing G →
    unverifiable → trust the binding."""
    if v_mag is None:
        return False
    astro = src_to_astrometry.get(source_id)
    if astro is None or astro.g_mag is None:
        return False
    return astro.g_mag - v_mag > GAIA_BINDING_G_MINUS_V_REJECT_MAG


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
    # SIMBAD per-component spectral types, keyed on (wds_id, component).
    # Produced by joining ``data/simbad/simbad_sptype.tsv`` (unified
    # per-oid spectral pull) against ``simbad_wds_xids.tsv`` on
    # ``simbad_oid``. Stage 6 prefers this over AT-HYG's per-system
    # ``spect`` column so each WDS component carries its own MK / WD
    # classification — Sirius A as A0mA1Va vs an inherited string, 40 Eri
    # B as DA2.9 vs the K0V the AT-HYG row would propagate.
    simbad_wds_spectra: dict[tuple[str, str], str]
    # Hand-curated per-component MK types from
    # ``data/binaries/component_sptype_overrides.tsv``, keyed on the raw
    # multiples.tsv comp form (Algol's Aa1,2 secondary keys as "2").
    # Top tier of Stage 6's spectral cascade — covers components
    # SIMBAD's WDS cross-IDs never enumerate.
    component_sptype_overrides: dict[tuple[str, str], str]
    # (hip, source_id) bindings rejected by the magnitude-consistency
    # gate — from the HIP xwalk and from AT-HYG ``gaia`` cells
    # respectively. Audit surface for the build log + Stage 7 counters.
    xwalk_mag_rejected: list[tuple[int, int]]
    athyg_gaia_mag_rejected: list[tuple[int | None, int]]


def build_indices(
    athyg: list[AthygRow],
    hip2: list[Hip2Row],
    hip_to_gaia: dict[int, int],
    tyc_to_gaia: dict[str, int],
    src_to_nss: dict[int, dict[str, str]],
    src_to_astrometry: dict[int, GaiaAstrometryRow] | None = None,
    ccdm: list[CcdmRow] | None = None,
    simbad_wds_spectra: dict[tuple[str, str], str] | None = None,
    component_sptype_overrides: dict[tuple[str, str], str] | None = None,
) -> IdentifierIndices:
    astro_map = src_to_astrometry or {}
    # Magnitude-consistency scrub of AT-HYG's ``gaia`` cells, at the
    # ingest boundary so every downstream read of ``row.gaia`` (the
    # ``athyg_gaia_native`` tier, ``src_to_athyg``, blend propagation)
    # sees the scrubbed value. The bare HIP survives for Stage 3's
    # HIP2 fallback.
    athyg_gaia_mag_rejected: list[tuple[int | None, int]] = []
    for row in athyg:
        if row.gaia is not None and _binding_mag_inconsistent(
            row.v_mag, row.gaia, astro_map,
        ):
            athyg_gaia_mag_rejected.append((row.hip, row.gaia))
            row.gaia = None

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

    # Same gate over the HIP → DR3 xwalk, keyed on the HIP's AT-HYG V.
    # Runs before ``src_to_hip`` so the inverse map never attributes a
    # rejected source to the HIP either.
    xwalk_mag_rejected: list[tuple[int, int]] = []
    kept_hip_to_gaia: dict[int, int] = {}
    for hip, src in hip_to_gaia.items():
        athyg_row = hip_to_athyg.get(hip)
        if athyg_row is not None and _binding_mag_inconsistent(
            athyg_row.v_mag, src, astro_map,
        ):
            xwalk_mag_rejected.append((hip, src))
            continue
        kept_hip_to_gaia[hip] = src
    hip_to_gaia = kept_hip_to_gaia
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
        simbad_wds_spectra=simbad_wds_spectra or {},
        component_sptype_overrides=component_sptype_overrides or {},
        xwalk_mag_rejected=xwalk_mag_rejected,
        athyg_gaia_mag_rejected=athyg_gaia_mag_rejected,
    )


