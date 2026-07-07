#!/usr/bin/env python3
"""Stage 6 — emit ``data/binaries/multiples.tsv``.
Column order is ``MULTIPLES_TSV_COLUMNS``.
"""

from __future__ import annotations

import math
import sys
from collections import deque
from dataclasses import dataclass, fields
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "util"))
from parsers import (  # noqa: E402
    AthygRow, GaiaAstrometryRow, SimbadWdsXid, WdsPair,
)
from indices import IdentifierIndices  # noqa: E402
from component_tokens import expand_wds_truncated_secondary  # noqa: E402
from stage2_resolve import (  # noqa: E402
    ResolvedComponent,
    _add_edge,
    _propagate_position,
    _spherical_to_unit_vec,
    _token_letters,
    iter_decomposing_pair_components,
    split_components,
)
from stage3_astrometry import (  # noqa: E402
    ComponentAstrometry,
    SystemAnchor,
)
from stage4_orbits import (  # noqa: E402
    OrbitElements, first_astrometry_field_per_system,
    iter_decomposing_pairs, kepler_semimajor_axis_au,
)
from stage5_optical import (  # noqa: E402
    ESCAPE_GATE_DEFAULT_COMPONENT_MASS_MSUN,
    OpticalClassification,
)
from mass_estimate import (  # noqa: E402
    DEFAULT_PRIMARY_MASS_MSUN,
    UNKNOWN_COMPANION_MASS_RATIO_Q,
    mass_from_spectral_class,
    mass_ratio_from_components,
)
from astronomy_constants import J2000_JD, DAYS_PER_JULIAN_YEAR  # noqa: E402


# ─── Stage 6: multiples.tsv emit ─────────────────────────────────────


# The one epoch every emitted position is normalised onto, so a
# promoted secondary's baked xyz shares its primary's epoch and the
# static relative geometry is correct. Mirror of
# scripts/catalog/direction-cascade.ts CATALOG_SCENE_EPOCH — keep the
# two in sync (see data/README.md § Reference epoch and proper motion).
CATALOG_SCENE_EPOCH = 2016.0


# multiples.tsv column order. Read by Phase 3 (binary format v6) and
# Phase 4 (statistical gates against curated SIMBAD). The order is
# canonical — changes break downstream readers and must propagate
# through ``build-binaries-expected.json`` + Phase 3 binary writer.
MULTIPLES_TSV_COLUMNS: tuple[str, ...] = (
    "system_id",
    "comp",
    "hip",
    "gaia_source_id",
    "x_pc", "y_pc", "z_pc",
    "absmag", "ci", "spect", "name",
    "source", "regime",
    "resolve_via", "astrometry_via", "orbit_via", "spect_via",
    "photometry_via", "a_via",
    "orbit_role",
    "P_days", "T_jd", "e", "a_AU",
    "i_rad", "omega_rad", "Omega_rad",
    "q", "dist_pc",
    "sep_arcsec", "pa_deg", "sep_pa_epoch_jd", "dmag",
    "anchor_sep_arcsec", "anchor_pa_deg",
)


def wds_dmag(mag_pri: float | None, mag_sec: float | None) -> float | None:
    """``mag_sec − mag_pri`` from a WDS pair row, or ``None`` when
    either magnitude is missing. Survives intact through the V/absolute-
    mag transform — both components sit at the same distance, so an
    apparent Δmag equals the absolute Δmag. Companion promotion uses
    this to impute the secondary's absmag when the row inherits the
    primary's AT-HYG absmag."""
    if mag_pri is None or mag_sec is None:
        return None
    return mag_sec - mag_pri


# WDS publishes ``date_last`` as a 4-digit year of the last reported
# observation. Convert to Julian Date treating the year as a Julian-year
# epoch (start of that calendar year) — sub-day precision is irrelevant
# because the sep/PA columns drive a static placement, not a time-
# resolved propagation.


def wds_year_to_jd(year: int | None) -> float | None:
    """Convert a WDS ``date_last`` 4-digit year integer to JD. ``None``
    passes through so a row without an observation date keeps an empty
    epoch cell."""
    if year is None:
        return None
    return J2000_JD + (float(year) - 2000.0) * DAYS_PER_JULIAN_YEAR


# ``spect_via`` provenance tags for the per-component spectral column.
# Mirrors the per-section ``_VIA_VALUES`` pattern from the other stages
# (resolve / astrometry / orbit / optical) so stage 7's count-snapshot
# diff surfaces each tier independently.
SPECT_VIA_CURATED = "curated"
SPECT_VIA_SIMBAD = "simbad"
SPECT_VIA_ATHYG = "athyg"
SPECT_VIA_NONE = "none"
SPECT_VIA_VALUES: tuple[str, ...] = (
    SPECT_VIA_CURATED, SPECT_VIA_SIMBAD, SPECT_VIA_ATHYG, SPECT_VIA_NONE,
)


# ``photometry_via`` provenance for the per-component absmag + ci
# columns. ``athyg_own`` means the component's OWN AT-HYG row supplied
# the photometry; ``athyg_system_inherited`` means the AT-HYG row that
# answered is shared with the system primary (Hipparcos resolved the
# system as one star; both component rows return the same AT-HYG row
# from _athyg_row_for_component). ``gaia_photometry`` means no AT-HYG
# row backed the component but its own Gaia DR3 5p row supplied G + BP/RP
# + parallax, from which absmag (G→V) and ci (BP−RP→Teff→B−V) were
# derived (see gaia_photometry_absmag_ci). ``none`` means no photometry
# source at all — absmag and ci are empty. Companion promotion keys off
# this tag: any non-``athyg_system_inherited`` value routes through the
# "own photometry" path (observed absmag/ci, de-extincted downstream).
PHOTOMETRY_VIA_OWN = "athyg_own"
PHOTOMETRY_VIA_SYSTEM_INHERITED = "athyg_system_inherited"
PHOTOMETRY_VIA_GAIA = "gaia_photometry"
PHOTOMETRY_VIA_NONE = "none"
PHOTOMETRY_VIA_VALUES: tuple[str, ...] = (
    PHOTOMETRY_VIA_OWN, PHOTOMETRY_VIA_SYSTEM_INHERITED,
    PHOTOMETRY_VIA_GAIA, PHOTOMETRY_VIA_NONE,
)


# ``a_via`` provenance for the per-pair semi-major axis. ``catalog`` =
# the orbit source published it (ORB6 a″/mas × parallax);
# ``kepler_mass_estimate`` = derived at emit time from a³ = M_total·P²
# with spectral-table masses (no NSS solution type publishes a relative
# a, and ORB6 rows can lack the parallax the conversion needs);
# ``none`` = no a on the row.
A_VIA_CATALOG = "catalog"
A_VIA_KEPLER_MASS_ESTIMATE = "kepler_mass_estimate"
A_VIA_NONE = "none"
A_VIA_VALUES: tuple[str, ...] = (
    A_VIA_CATALOG, A_VIA_KEPLER_MASS_ESTIMATE, A_VIA_NONE,
)


# ``orbit_role`` values. ``primary`` / ``secondary`` are the two sides of
# a WDS pair row; ``standalone`` is for a SIMBAD-known WDS component the
# pair-walk didn't already emit (the 40 Eri B case: B is in BC, BD, BE
# pair rows but every one is dropped at Stage 6's position gate because
# neither B nor C has Gaia 5p astrometry).
ORBIT_ROLE_PRIMARY = "primary"
ORBIT_ROLE_SECONDARY = "secondary"
ORBIT_ROLE_STANDALONE = "standalone"


# ``source`` values. ``athyg`` when an AT-HYG row backed the photometry /
# proper-name fields; ``wds`` for components resolved with no AT-HYG row;
# ``simbad`` for standalone-augment rows (no AT-HYG hit, but SIMBAD has
# at least an sp_type and a cross-ID).
SOURCE_ATHYG = "athyg"
SOURCE_WDS = "wds"
SOURCE_SIMBAD = "simbad"


# Stage-6-owned ``astrometry_via`` value — promoted from Stage 3's tag
# tuple when a component inherits the system anchor's position. Listed
# here (not in stage3_astrometry.ASTROMETRY_VIA_VALUES) because Stage 3
# itself never emits it; Stage 7 counts it directly off emitted rows.
ASTROMETRY_VIA_SYSTEM_INHERITED = "system_inherited"

# Mirrors stage3_astrometry.ASTROMETRY_VIA_VALUES's default route. The
# Gaia-photometry absmag path fires only for rows tagged this — a genuine
# own per-component 5p fit, so the G/BP/RP that back the derived absmag
# belong to this component (not a blended or system-inherited source).
ASTROMETRY_VIA_GAIA_5P = "gaia_5p"


# orbit_via → numeric ``regime`` tag for parity with the legacy v5
# column. 0 = no orbital information; 2 = full orbital elements (Gaia
# NSS or ORB6 visual); 3 = spectroscopic-only. Phase 3's v6 binary
# writer keys orbit-element population off this tag; finer provenance
# lives in ``orbit_via`` alongside.
ORBIT_VIA_TO_REGIME: dict[str, int] = {
    "gaia_nss": 2,
    "orb6": 2,
    "orb6_spectroscopic": 3,
    "none": 0,
}


@dataclass
class MultiplesRow:
    """One per-component row of multiples.tsv. All numeric fields are
    optional — Phase 3's binary writer treats missing values as "skip
    this column for this record" rather than imputing a sentinel."""

    system_id: str
    comp: str
    hip: int | None
    gaia_source_id: int | None
    x_pc: float | None
    y_pc: float | None
    z_pc: float | None
    absmag: float | None
    ci: float | None
    spect: str
    name: str
    source: str            # AT-HYG row provenance: "athyg" / "wds"
    regime: int
    resolve_via: str
    astrometry_via: str
    orbit_via: str
    spect_via: str         # "simbad" / "athyg" / "none"
    photometry_via: str    # "athyg_own" / "athyg_system_inherited" / "none"
    a_via: str             # "catalog" / "kepler_mass_estimate" / "none"
    orbit_role: str        # "primary" / "secondary"
    P_days: float | None
    T_jd: float | None
    e: float | None
    a_AU: float | None
    i_rad: float | None
    omega_rad: float | None
    Omega_rad: float | None
    q: float | None
    dist_pc: float | None
    # WDS pair geometry — sep + position angle of the secondary relative
    # to the primary at ``sep_pa_epoch_jd`` (WDS ``date_last``). Populated
    # on BOTH component rows of a pair to keep the per-row schema simple.
    # Standalone rows leave all three as ``None``; the pair-walk hasn't
    # seen the (wds_id, component) combination so there is no anchor.
    sep_arcsec: float | None
    pa_deg: float | None
    sep_pa_epoch_jd: float | None
    # WDS apparent-magnitude difference (mag_sec − mag_pri). Companion
    # promotion uses it to impute the secondary's absmag when the
    # multiples row inherited the primary's AT-HYG entry. ``None`` when
    # either WDS magnitude is missing — promotion drops the row.
    dmag: float | None
    # This component's best WDS offset from the SYSTEM ANCHOR letter
    # (see compute_anchor_offsets). ``None`` when no geometry chain
    # reaches the component, or the component IS the anchor.
    anchor_sep_arcsec: float | None = None
    anchor_pa_deg: float | None = None


def _system_id_for_pair(pair: WdsPair) -> str:
    """``"{wds_id}-{components}"`` (e.g. ``"00491+5749-AB"``) — stable
    across both rows of the same WDS pair so the catalog binary writer
    can group them."""
    return f"{pair.wds_id}-{pair.components}"


def _system_id_for_standalone(wds_id: str, component: str) -> str:
    """``"{wds_id}-_{component}"`` (leading underscore is the standalone
    marker). The ``-_`` prefix never collides with a pair-row id because
    WDS ``components`` strings are letters/digits only — no underscore."""
    return f"{wds_id}-_{component}"


def _athyg_row_for_component(
    component: ResolvedComponent, indices: IdentifierIndices,
) -> AthygRow | None:
    """Look up AT-HYG row for a resolved component. Strict priority:

    1. ``component.athyg_row`` — the position-matched row set by Stage 2's
       ``resolve_via_position`` or Stage 3's ``attach_athyg_position_fallback``.
       Bound when the row exists in AT-HYG but carries neither ``hip``
       nor ``gaia`` (ξ UMa-shape: AT-HYG-HD-only WDS systems). The
       identifier-indexed lookups below would miss these rows.
    2. ``src_to_athyg`` — Gaia source_id index. Most reliable for
       components Stage 2 resolved to a Gaia DR3 source.
    3. ``hip_to_athyg`` — HIP index. Fallback for Gaia-saturated bright
       primaries (Sirius / α Cen / Procyon) whose AT-HYG row carries
       the HIP but not the Gaia source.
    """
    if component.athyg_row is not None:
        return component.athyg_row
    if component.gaia_source_id is not None:
        row = indices.src_to_athyg.get(component.gaia_source_id)
        if row is not None:
            return row
    if component.hip is not None:
        return indices.hip_to_athyg.get(component.hip)
    return None


def _position_pc(astrometry: ComponentAstrometry) -> SystemAnchor | None:
    """ICRS RA/Dec + parallax → (x_pc, y_pc, z_pc, dist_pc), with the
    direction PM-propagated from the measurement's native ``ref_epoch``
    to ``CATALOG_SCENE_EPOCH`` so every emitted position shares one epoch
    with the single-star catalogue. Gaia routes (native J2016.0) are a
    zero-Δt no-op; hip2_long_baseline (J1991.25) and athyg_position
    advance forward. Returns ``None`` when the astrometry row is
    unresolved or carries no positive parallax — Phase 3 reads the empty
    columns as "no position constraint" and falls back to the AT-HYG
    single-component position if needed."""
    if (
        astrometry.ra_deg is None
        or astrometry.dec_deg is None
        or astrometry.parallax_mas is None
        or astrometry.parallax_mas <= 0.0
    ):
        return None
    ra_deg, dec_deg = astrometry.ra_deg, astrometry.dec_deg
    if astrometry.ref_epoch is not None:
        ra_deg, dec_deg = _propagate_position(
            ra_deg, dec_deg,
            astrometry.pmra_masyr, astrometry.pmdec_masyr,
            astrometry.ref_epoch, CATALOG_SCENE_EPOCH,
        )
    dist_pc = 1000.0 / astrometry.parallax_mas
    x, y, z = _spherical_to_unit_vec(ra_deg, dec_deg)
    return x * dist_pc, y * dist_pc, z * dist_pc, dist_pc


def compute_system_anchors(
    pairs: list[WdsPair],
    components: list[ResolvedComponent],
    astrometry: list[ComponentAstrometry],
) -> dict[str, SystemAnchor]:
    """One (x_pc, y_pc, z_pc, dist_pc) anchor per wds_id — used by Stage 6
    when a component's own astrometry resolved to ``unresolved`` but the
    same system has another component with a real Gaia 5p (or HIP2) row.
    Tight inner binaries blend in Gaia (40 Eri B/C, Castor C/D) and never
    get a per-component 5p fit, but the outer pair's primary always does;
    the inner pair's components sit at the primary's distance to within a
    handful of AU, which at parsec scales is no measurable offset.

    The first resolved component in a system wins the anchor slot; on a
    tie the primary takes precedence over the secondary.
    """
    return first_astrometry_field_per_system(
        pairs, components, astrometry, _position_pc,
    )


_GeomAdj = dict[str, dict[str, tuple[float, float, float | None]]]


def _anchor_token_rank(tok: str) -> tuple[int, int, str]:
    """Mirror of companion-promotion.ts ``isMoreCanonicalAnchor``: ``A``
    first, then shortest, then alphabetical — so the letter these offsets
    chain from is the same one promotion resolves as the WDS-root anchor."""
    return (0 if tok == "A" else 1, len(tok), tok)


def _proxy_endpoints(tok: str) -> list[str]:
    """A compound token's constituent letters (``"BC" → [B, C]``), or the
    token itself for single-component forms."""
    letters = _token_letters(tok)
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


def compute_anchor_offsets(
    pairs: list[WdsPair],
    components: list[ResolvedComponent],
    classifications: list[OpticalClassification],
) -> dict[tuple[str, str], tuple[float, float]]:
    """Per-component ``(sep_arcsec, pa_deg)`` offset from the system
    anchor letter, keyed ``(wds_id, canonical token)``.

    Offsets compose WDS (ρ, θ) tangent-plane vectors from three edge
    tiers: kept (Stage-5-physical) pair rows; Stage-5-REJECTED pair
    rows (a sep+PA measurement is real astrometry regardless of
    boundness classification — the pair stays dropped, only its
    geometry is consulted: Acrux AB, whose WDS ``U`` flag rejects the
    pair while B remains a V≈1.6 star with no other measured
    position); and compound photocentre proxies (a row with a
    multi-letter side lends its vector to each constituent letter —
    ``A,BC`` places B and C at the BC photocentre).

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
    kept_primary_tokens: dict[str, set[str]] = {}
    for j, (pair, primary, secondary) in enumerate(
        iter_decomposing_pair_components(pairs, components),
    ):
        is_kept = classifications[j].is_physical
        p_tok = primary.component
        s_tok = expand_wds_truncated_secondary(p_tok, secondary.component)
        if is_kept:
            kept_primary_tokens.setdefault(pair.wds_id, set()).add(p_tok)
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
    for wds_id, primary_tokens in kept_primary_tokens.items():
        anchor = min(primary_tokens, key=_anchor_token_rank)
        g0 = kept.get(wds_id, {})
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
    return out


def compute_pair_masses(
    pairs: list[WdsPair],
    components: list[ResolvedComponent],
    indices: IdentifierIndices,
) -> list[float]:
    """Total system mass (M_sun) per decomposing WDS pair, in
    ``resolve_all_pairs`` iteration order — parallel to Stage 5's
    classification list. Each component's mass comes from its resolved
    spectral type (``_resolve_spect`` → ``mass_from_spectral_class``); a
    component with no parsable type contributes
    ``ESCAPE_GATE_DEFAULT_COMPONENT_MASS_MSUN`` so the sum stays generous
    (the escape-velocity gate is lenient by construction). Feeds Stage 5's
    escape-velocity sub-gate, which reads only the total."""
    out: list[float] = []
    for pair, primary, secondary in iter_decomposing_pair_components(
        pairs, components,
    ):
        total = 0.0
        for comp in (primary, secondary):
            spect, _ = _resolve_spect(
                pair.wds_id, comp.component,
                _athyg_row_for_component(comp, indices), indices,
            )
            mass = mass_from_spectral_class(spect, None)
            total += mass if mass is not None else ESCAPE_GATE_DEFAULT_COMPONENT_MASS_MSUN
        out.append(total)
    return out


def _resolve_position(
    astrometry: ComponentAstrometry | None,
    anchor: SystemAnchor | None,
) -> tuple[SystemAnchor | None, bool]:
    """Position resolution with the system-anchor fallback. Returns the
    (x_pc, y_pc, z_pc, dist_pc) tuple plus an ``inherited`` flag — True
    when the anchor backstopped a component whose own astrometry was
    unresolved or missing. Position is ``None`` only when both the
    component AND its system anchor are unknown (entirely Gaia-blind
    WDS systems); ``inherited`` is False in that case."""
    own = _position_pc(astrometry) if astrometry is not None else None
    if own is not None:
        return own, False
    return anchor, anchor is not None


def _astrometry_via(
    astrometry: ComponentAstrometry | None, inherited: bool,
) -> str:
    """Map the (astrometry, inherited) pair to a multiples-row
    ``astrometry_via`` tag. Inherited rows always tag as
    ``ASTROMETRY_VIA_SYSTEM_INHERITED`` regardless of what the source
    astrometry resolved to; rows without astrometry (the standalone
    no-Gaia case) tag ``"unresolved"``."""
    if inherited:
        return ASTROMETRY_VIA_SYSTEM_INHERITED
    if astrometry is None:
        return "unresolved"
    return astrometry.astrometry_via


def _resolve_spect(
    wds_id: str, component: str,
    athyg: AthygRow | None, indices: IdentifierIndices,
) -> tuple[str, str]:
    """Per-component spectral type with curated → SIMBAD → AT-HYG →
    none fallback, returned alongside the ``spect_via`` provenance tag.
    The curated tier (``component_sptype_overrides``) carries literature
    types for components SIMBAD's WDS cross-IDs never enumerate (Algol
    Aa2's K0IV); SIMBAD's per-component sp_type wins over AT-HYG because
    AT-HYG carries a single per-system string that gets inherited by
    every component, even when each has its own MK / WD class.
    Standalone rows pass ``athyg=None``."""
    curated_spect = indices.component_sptype_overrides.get((wds_id, component))
    if curated_spect:
        return curated_spect, SPECT_VIA_CURATED
    simbad_spect = indices.simbad_wds_spectra.get((wds_id, component))
    if simbad_spect:
        return simbad_spect, SPECT_VIA_SIMBAD
    athyg_spect = athyg.spect if athyg is not None else ""
    if athyg_spect:
        return athyg_spect, SPECT_VIA_ATHYG
    return "", SPECT_VIA_NONE


def _photometry_via(
    athyg: AthygRow | None,
    primary_athyg: AthygRow | None,
    *,
    is_primary: bool,
) -> str:
    """``photometry_via`` tag for a row. The primary is always
    ``athyg_own`` when an AT-HYG row resolved. The secondary is
    ``athyg_system_inherited`` when its AT-HYG row IS the primary's —
    Hipparcos resolved both as a single star, so the absmag/ci that
    came through ``_athyg_row_for_component`` actually belongs to the
    brighter component. Companion promotion uses this tag to switch
    to Δmag imputation."""
    if athyg is None:
        return PHOTOMETRY_VIA_NONE
    if is_primary:
        return PHOTOMETRY_VIA_OWN
    if primary_athyg is not None and athyg is primary_athyg:
        return PHOTOMETRY_VIA_SYSTEM_INHERITED
    return PHOTOMETRY_VIA_OWN


def _component_astrometry_from_gaia(gaia) -> ComponentAstrometry:
    """Wrap a per-source ``GaiaAstrometryRow`` into a
    ``ComponentAstrometry`` tagged ``gaia_5p``, so the standalone path
    can share ``_position_pc`` / ``_resolve_position`` /
    ``_astrometry_via`` with the pair walk."""
    return ComponentAstrometry(
        astrometry_via=ASTROMETRY_VIA_GAIA_5P,
        ra_deg=gaia.ra_deg, dec_deg=gaia.dec_deg,
        parallax_mas=gaia.parallax_mas,
        parallax_error_mas=gaia.parallax_error_mas,
        pmra_masyr=gaia.pmra_masyr, pmdec_masyr=gaia.pmdec_masyr,
        ref_epoch=gaia.ref_epoch,
    )


# ---- Gaia-photometry absmag / ci derivation (own-DR3 companions) ------
#
# A WDS component with its own Gaia DR3 5p fit but no AT-HYG row carries
# no absmag/ci and is otherwise dropped at companion promotion for want
# of a brightness. Its Gaia row does carry G + BP + RP + parallax, from
# which an honest absolute magnitude and colour are derivable. absmag is
# Johnson V (the catalogue's absmag convention) and ci is Johnson B−V
# (the colour-LUT convention), so both go through a Gaia→Johnson
# transform rather than the raw Gaia bands. Provenance tag
# PHOTOMETRY_VIA_GAIA. See SCIENCE.md § Multiple-star pipeline (companion
# promotion) for the science framing and full source citations.

# Gaia EDR3 → Johnson V: G − V as a cubic in (BP − RP). Riello et al.
# 2021, A&A 649, A3, Table 5.7 (σ = 0.030 mag; valid −0.5 < BP−RP < 5.0).
GAIA_G_MINUS_V_COEFFS: tuple[float, ...] = (
    -0.02704, 0.01424, -0.2156, 0.01426,
)
GAIA_G_MINUS_V_COLOR_RANGE: tuple[float, float] = (-0.5, 5.0)

# Gaia (BP − RP) → effective temperature: fifth-order fit, Montalto et
# al. 2021 (PLATO Input Catalogue), A&A 653, A98 (valid 0.5 < BP−RP <
# 5.0). Feeds the catalogue's Ballesteros B−V↔Teff convention so the
# recovered ci lands on the same colour manifold every other star uses
# (ballesteros_bv_from_teff mirrors scripts/colour/blackbody-lut-pure.ts).
GAIA_BPRP_TEFF_COEFFS: tuple[float, ...] = (
    9453.14, -6859.40, 3542.16, -1053.09, 165.635, -10.5672,
)
GAIA_BPRP_TEFF_COLOR_RANGE: tuple[float, float] = (0.5, 5.0)

# B−V clamp matching the blackbody LUT span (scripts/colour/
# blackbody-lut-pure.ts BV_MIN / BV_MAX). Colours past either end
# saturate at the endpoint, exactly as the runtime LUT sampler does.
BALLESTEROS_BV_MIN = -0.4
BALLESTEROS_BV_MAX = 2.0


def _polyval_ascending(coeffs: tuple[float, ...], x: float) -> float:
    """Horner evaluation of ``coeffs[0] + coeffs[1]·x + coeffs[2]·x² …``
    (coefficients in ascending power order)."""
    acc = 0.0
    for c in reversed(coeffs):
        acc = acc * x + c
    return acc


def ballesteros_bv_from_teff(teff: float) -> float:
    """Analytic inverse of Ballesteros 2012 (Teff K → Johnson B−V).
    Python mirror of ``ballesterosBvFromTeff`` in
    scripts/colour/blackbody-lut-pure.ts — keep the two in sync (pinned
    by the Stage-6 unit test against the solar value)."""
    k = teff / 4600.0
    disc = math.sqrt(4.0 + 1.1664 * k * k)
    u = (2.0 - 2.32 * k + disc) / (2.0 * k)
    return u / 0.92


def gaia_photometry_absmag_ci(
    gaia: GaiaAstrometryRow,
) -> tuple[float, float | None] | None:
    """Derive ``(absmag_V, ci_BV)`` for a component from its own Gaia DR3
    photometry + parallax. Returns ``None`` when the row carries no G
    magnitude or no positive parallax — nothing to anchor a magnitude on.

    absmag: ``M_G = G + 5·log10(ϖ_mas) − 10``, then ``M_V = M_G − (G−V)``
    with the Riello 2021 G−V(BP−RP) cubic. Raw ``M_G`` is the fallback
    when BP or RP is absent (~0.3 mag redward bias vs the transform for
    cool stars, but honest).

    ci: BP−RP → Teff (Montalto 2021) → B−V via the catalogue's
    Ballesteros inverse, so the stored colour round-trips to the
    Gaia-implied temperature through the same relation the renderer
    reads. ``None`` when BP/RP is absent or BP−RP falls outside the Teff
    polynomial's validity range — companion promotion then falls back to
    its spectral / solar ci path."""
    if (
        gaia.g_mag is None
        or gaia.parallax_mas is None
        or gaia.parallax_mas <= 0.0
    ):
        return None
    abs_g = gaia.g_mag + 5.0 * math.log10(gaia.parallax_mas) - 10.0

    if gaia.bp_mag is None or gaia.rp_mag is None:
        return abs_g, None

    bp_rp = gaia.bp_mag - gaia.rp_mag
    gv_lo, gv_hi = GAIA_G_MINUS_V_COLOR_RANGE
    g_minus_v = _polyval_ascending(
        GAIA_G_MINUS_V_COEFFS, min(max(bp_rp, gv_lo), gv_hi),
    )
    absmag_v = abs_g - g_minus_v

    teff_lo, teff_hi = GAIA_BPRP_TEFF_COLOR_RANGE
    if bp_rp < teff_lo or bp_rp > teff_hi:
        return absmag_v, None
    teff = _polyval_ascending(GAIA_BPRP_TEFF_COEFFS, bp_rp)
    ci = min(max(ballesteros_bv_from_teff(teff), BALLESTEROS_BV_MIN),
             BALLESTEROS_BV_MAX)
    return absmag_v, ci


# Circular-orbit ω convention. For e = 0 periastron is undefined, so a
# fitted circular orbit legitimately publishes no ω (YY Gem's ORB6 row)
# — but the runtime's has_orbit contract requires one. ω = π/2 puts
# conjunction (the eclipse, for edge-on systems) at T₀, matching the
# minimum-epoch convention eclipser ephemerides fit T₀ against.
CIRCULAR_ORBIT_OMEGA_RAD = math.pi / 2.0


# Orbit routes the estimated-element backstops apply to. Non-visual
# orbits (spectroscopic / eclipsing / NSS) describe sub-resolution
# pairs whose baked placement is collocation — an estimated q / a can
# only add motion, never contradict a measured WDS placement. ORB6
# visual orbits are excluded: their pairs carry real baked sep+PA
# placements, and animating them on a guessed mass ratio widens the
# baked-vs-R(epoch) disagreement set the multi-star regression corpus
# ratchets (curate those per-pair instead).
ESTIMATED_ELEMENT_ORBIT_VIAS: frozenset[str] = frozenset({
    "gaia_nss", "orb6_spectroscopic",
})


def finalize_renderable_elements(
    primary_row: MultiplesRow,
    secondary_row: MultiplesRow,
    orbit: OrbitElements | None,
) -> None:
    """Backstop the orbit quantities the runtime cannot animate
    without, after the spectral q backfill has had its chance. Only
    for ``ESTIMATED_ELEMENT_ORBIT_VIAS`` routes:

    - ``q`` ← ``UNKNOWN_COMPANION_MASS_RATIO_Q`` when no catalog value
      and no spectral estimate exists (unresolved companion with no
      per-component type).
    - ``omega_rad`` ← ``CIRCULAR_ORBIT_OMEGA_RAD`` when the published
      orbit is exactly circular (e = 0) and carries no ω — degenerate,
      not missing. Eccentric orbits missing ω stay ``None``.
    - ``a_AU`` ← Kepler ``a³ = M_total·P²`` when the orbit source
      published no relative semi-major axis. ``M_total = M₁/(1−q)``
      from the primary's spectral-table mass; tagged
      ``a_via=kepler_mass_estimate`` on both rows.

    Mutates both rows in place; a no-op without an orbit or without P.
    """
    if orbit is None:
        return
    if primary_row.orbit_via not in ESTIMATED_ELEMENT_ORBIT_VIAS:
        return
    if primary_row.q is None:
        primary_row.q = UNKNOWN_COMPANION_MASS_RATIO_Q
        secondary_row.q = UNKNOWN_COMPANION_MASS_RATIO_Q
    if primary_row.omega_rad is None and orbit.e == 0.0:
        primary_row.omega_rad = CIRCULAR_ORBIT_OMEGA_RAD
        secondary_row.omega_rad = CIRCULAR_ORBIT_OMEGA_RAD
    if primary_row.a_AU is not None or orbit.P_days is None:
        return
    m_primary = mass_from_spectral_class(primary_row.spect, primary_row.absmag)
    if m_primary is None:
        m_primary = DEFAULT_PRIMARY_MASS_MSUN
    a_au = kepler_semimajor_axis_au(
        orbit.P_days, m_primary / (1.0 - primary_row.q),
    )
    if a_au is None:
        return
    for row in (primary_row, secondary_row):
        row.a_AU = a_au
        row.a_via = A_VIA_KEPLER_MASS_ESTIMATE


def build_multiples_row(
    pair: WdsPair,
    component: ResolvedComponent,
    astrometry: ComponentAstrometry,
    orbit: OrbitElements | None,
    orbit_via: str,
    is_primary: bool,
    indices: IdentifierIndices,
    system_anchor: SystemAnchor | None = None,
    primary_athyg: AthygRow | None = None,
    partner_gaia_source_id: int | None = None,
    partner_has_athyg: bool = False,
) -> MultiplesRow:
    """Project Stage 2-4 outputs for one component into one canonical
    ``MultiplesRow`` keyed by ``_system_id_for_pair``. ``_position_pc``
    PM-propagates the position from its native epoch to
    ``CATALOG_SCENE_EPOCH`` so both component rows of a pair — and the
    single-star catalogue they render alongside — share one epoch.

    ``system_anchor`` is the inherited-position fallback — when the
    component's own astrometry resolved to ``"unresolved"`` (tight inner
    binary blended out of Gaia DR3), the row inherits the system
    primary's position and promotes ``astrometry_via`` to
    ``"system_inherited"``.

    ``primary_athyg`` lets the call site flag the inherited-photometry
    case: when the secondary's own AT-HYG row resolves to the same
    AthygRow instance as the primary's, ``photometry_via`` becomes
    ``athyg_system_inherited`` (the photometry actually belongs to the
    primary; companion promotion downstream uses Δmag imputation).
    Pass ``None`` for primary rows and standalone rows.

    ``partner_gaia_source_id`` / ``partner_has_athyg`` describe the pair
    partner, and gate the Gaia-photometry path against blend leakage:
    astrometry_via=gaia_5p is NOT proof of an own per-component fit when
    Stage 2's blend-identity propagation copied the partner's source onto
    a component that resolved nothing of its own (both rows then carry one
    source). When that shared source is AT-HYG-backed, the partner already
    carries the system light through the AT-HYG path, so deriving here
    would mint a twin of it — suppressed. The symmetric blend (neither in
    AT-HYG) still derives the source's COMBINED magnitude; companion
    promotion divides it across the collocated records it backs.
    """
    athyg = _athyg_row_for_component(component, indices)
    position, inherited = _resolve_position(astrometry, system_anchor)
    spect, spect_via = _resolve_spect(
        pair.wds_id, component.component, athyg, indices,
    )
    astrometry_via = _astrometry_via(astrometry, inherited)
    photometry_via = _photometry_via(athyg, primary_athyg, is_primary=is_primary)
    absmag = athyg.absmag if athyg is not None else None
    ci = athyg.ci if athyg is not None else None

    # No AT-HYG row backs this component, but it earned its own Gaia 5p
    # fit — derive absmag (and ci) from that same source's G/BP/RP +
    # parallax so promotion's 'own' photometry path keeps it instead of
    # dropping it for a blank absmag. Gated on astrometry_via=gaia_5p AND
    # a not-blend-into-an-AT-HYG-partner check (see the partner_* args):
    # excluded sources are already absent from src_to_astrometry.
    shares_athyg_partner_source = (
        partner_has_athyg
        and partner_gaia_source_id is not None
        and partner_gaia_source_id == component.gaia_source_id
    )
    if (
        athyg is None
        and astrometry_via == ASTROMETRY_VIA_GAIA_5P
        and component.gaia_source_id is not None
        and not shares_athyg_partner_source
    ):
        gaia_row = indices.src_to_astrometry.get(component.gaia_source_id)
        derived = (
            gaia_photometry_absmag_ci(gaia_row)
            if gaia_row is not None else None
        )
        if derived is not None:
            absmag, ci = derived
            photometry_via = PHOTOMETRY_VIA_GAIA

    return MultiplesRow(
        system_id=_system_id_for_pair(pair),
        comp=component.component,
        hip=component.hip,
        gaia_source_id=component.gaia_source_id,
        x_pc=position[0] if position is not None else None,
        y_pc=position[1] if position is not None else None,
        z_pc=position[2] if position is not None else None,
        absmag=absmag,
        ci=ci,
        spect=spect,
        name=athyg.proper if athyg is not None else "",
        source=SOURCE_ATHYG if athyg is not None else SOURCE_WDS,
        regime=ORBIT_VIA_TO_REGIME.get(orbit_via, 0),
        resolve_via=component.resolve_via,
        astrometry_via=astrometry_via,
        orbit_via=orbit_via,
        spect_via=spect_via,
        photometry_via=photometry_via,
        a_via=(
            A_VIA_CATALOG
            if orbit is not None and orbit.a_AU is not None
            else A_VIA_NONE
        ),
        orbit_role=ORBIT_ROLE_PRIMARY if is_primary else ORBIT_ROLE_SECONDARY,
        P_days=orbit.P_days if orbit is not None else None,
        T_jd=orbit.T_jd if orbit is not None else None,
        e=orbit.e if orbit is not None else None,
        a_AU=orbit.a_AU if orbit is not None else None,
        i_rad=orbit.i_rad if orbit is not None else None,
        omega_rad=orbit.omega_rad if orbit is not None else None,
        Omega_rad=orbit.Omega_rad if orbit is not None else None,
        q=orbit.q if orbit is not None else None,
        dist_pc=position[3] if position is not None else None,
        sep_arcsec=pair.rho_last,
        pa_deg=pair.theta_last,
        sep_pa_epoch_jd=wds_year_to_jd(pair.date_last),
        dmag=wds_dmag(pair.mag_pri, pair.mag_sec),
    )


def build_multiples_rows(
    pairs: list[WdsPair],
    components: list[ResolvedComponent],
    astrometry: list[ComponentAstrometry],
    orbits: list[tuple[OrbitElements | None, str]],
    classifications: list[OpticalClassification],
    indices: IdentifierIndices,
    simbad_xids: dict[tuple[str, str], SimbadWdsXid] | None = None,
    system_anchors: dict[str, SystemAnchor] | None = None,
) -> list[MultiplesRow]:
    """Walk the per-pair Stage 2/3/4/5 outputs in lockstep. Skips pairs
    Stage 5 classified as optical (their rows are absent from the TSV
    entirely — downstream consumers should not see optical-flagged
    SYN-NNN injections), and skips pairs where neither the components'
    own astrometry NOR the system-anchor backstop yields a position
    (entirely Gaia-blind WDS systems — Aitken-only doubles with no HIP /
    AT-HYG cover at all).

    ``simbad_xids`` opt-in argument turns on per-component augmentation:
    after the pair-walk, sweep every (wds_id, component) SIMBAD knows
    about and emit a standalone row for any combination not already
    represented in the pair output. Position falls back through
    component-native → system-anchor → ``None`` in the same order as
    the pair rows.

    ``system_anchors`` is the precomputed per-``wds_id`` anchor map. The
    caller shares one map between Stage 5's anchor-distance gate and this
    emit so anchors are computed once; ``None`` recomputes them here (the
    in-process tests).
    """
    n_pairs = sum(1 for p in pairs if split_components(p.components) is not None)
    if not (len(orbits) == n_pairs == len(classifications)):
        raise ValueError(
            "Stage 6 input cardinality disagreement — orbits / "
            "classifications must run parallel to decomposing pairs"
        )

    if system_anchors is None:
        system_anchors = compute_system_anchors(pairs, components, astrometry)
    anchor_offsets = compute_anchor_offsets(pairs, components, classifications)

    out: list[MultiplesRow] = []
    emitted_keys: set[tuple[str, str]] = set()
    for j, (pair, primary, secondary, p_ast, s_ast) in enumerate(
        iter_decomposing_pairs(pairs, components, astrometry),
    ):
        if not classifications[j].is_physical:
            continue
        orbit, via = orbits[j]
        anchor = system_anchors.get(pair.wds_id)
        if (
            anchor is None
            and _position_pc(p_ast) is None
            and _position_pc(s_ast) is None
        ):
            continue
        primary_athyg = _athyg_row_for_component(primary, indices)
        secondary_athyg = _athyg_row_for_component(secondary, indices)
        primary_row = build_multiples_row(
            pair, primary, p_ast, orbit, via,
            is_primary=True, indices=indices,
            system_anchor=anchor,
            partner_gaia_source_id=secondary.gaia_source_id,
            partner_has_athyg=secondary_athyg is not None,
        )
        secondary_row = build_multiples_row(
            pair, secondary, s_ast, orbit, via,
            is_primary=False, indices=indices,
            system_anchor=anchor,
            primary_athyg=primary_athyg,
            partner_gaia_source_id=primary.gaia_source_id,
            partner_has_athyg=primary_athyg is not None,
        )
        if (
            orbit is not None
            and orbit.q is None
            and primary_row.q is None
            and secondary_row.q is None
        ):
            estimated_q = mass_ratio_from_components(
                primary_row.spect, primary_row.absmag,
                secondary_row.spect, secondary_row.absmag,
            )
            if estimated_q is not None:
                primary_row.q = estimated_q
                secondary_row.q = estimated_q
        finalize_renderable_elements(primary_row, secondary_row, orbit)
        s_tok = expand_wds_truncated_secondary(
            primary.component, secondary.component,
        )
        for row, tok in (
            (primary_row, primary.component), (secondary_row, s_tok),
        ):
            offset = anchor_offsets.get((pair.wds_id, tok))
            if offset is not None:
                row.anchor_sep_arcsec, row.anchor_pa_deg = offset
        out.append(primary_row)
        out.append(secondary_row)
        emitted_keys.add((pair.wds_id, primary.component))
        emitted_keys.add((pair.wds_id, secondary.component))

    if simbad_xids:
        out.extend(build_standalone_rows(
            simbad_xids=simbad_xids,
            emitted_keys=emitted_keys,
            system_anchors=system_anchors,
            indices=indices,
            anchor_offsets=anchor_offsets,
        ))
    return out


def build_standalone_rows(
    simbad_xids: dict[tuple[str, str], SimbadWdsXid],
    emitted_keys: set[tuple[str, str]],
    system_anchors: dict[str, SystemAnchor],
    indices: IdentifierIndices,
    anchor_offsets: dict[tuple[str, str], tuple[float, float]] | None = None,
) -> list[MultiplesRow]:
    """For every (wds_id, component) SIMBAD has a cross-ID for that
    isn't already in ``emitted_keys`` (from the pair walk), emit a
    standalone row. Captures sub-component cases the pair-walk
    structurally can't reach (e.g. a SIMBAD-known component that WDS
    never enumerates as the side of any decomposing pair).

    Position falls back through component-native Gaia 5p →
    system-anchor → ``None``; ``orbit_role=standalone`` distinguishes
    these rows downstream so the binary writer can model them as
    single-source enrichment rather than half of a pair.
    """
    out: list[MultiplesRow] = []
    for (wds_id, component), xid in simbad_xids.items():
        if (wds_id, component) in emitted_keys:
            continue
        synth_ast: ComponentAstrometry | None = None
        if xid.gaia_source_id is not None:
            gaia = indices.src_to_astrometry.get(xid.gaia_source_id)
            if gaia is not None:
                synth_ast = _component_astrometry_from_gaia(gaia)
        position, inherited = _resolve_position(
            synth_ast, system_anchors.get(wds_id),
        )
        astrometry_via = _astrometry_via(synth_ast, inherited)
        spect, spect_via = _resolve_spect(wds_id, component, None, indices)
        offset = (anchor_offsets or {}).get((wds_id, component))

        out.append(MultiplesRow(
            system_id=_system_id_for_standalone(wds_id, component),
            comp=component,
            hip=xid.hip,
            gaia_source_id=xid.gaia_source_id,
            x_pc=position[0] if position is not None else None,
            y_pc=position[1] if position is not None else None,
            z_pc=position[2] if position is not None else None,
            absmag=None, ci=None,
            spect=spect, name=xid.simbad_main_id,
            source=SOURCE_SIMBAD,
            regime=0,
            resolve_via="simbad_xid",
            astrometry_via=astrometry_via,
            orbit_via="none",
            spect_via=spect_via,
            photometry_via=PHOTOMETRY_VIA_NONE,
            a_via=A_VIA_NONE,
            orbit_role=ORBIT_ROLE_STANDALONE,
            P_days=None, T_jd=None, e=None, a_AU=None,
            i_rad=None, omega_rad=None, Omega_rad=None,
            q=None,
            dist_pc=position[3] if position is not None else None,
            sep_arcsec=None, pa_deg=None, sep_pa_epoch_jd=None,
            dmag=None,
            anchor_sep_arcsec=offset[0] if offset is not None else None,
            anchor_pa_deg=offset[1] if offset is not None else None,
        ))
    return out


def _fmt_float(v: float | None, places: int) -> str:
    return f"{v:.{places}f}" if v is not None else ""


def _fmt_int(v: int | None) -> str:
    return str(v) if v is not None else ""


def write_multiples_tsv(rows: list[MultiplesRow], path: Path) -> int:
    """Emit ``rows`` to ``path`` as a tab-separated table with the
    canonical ``MULTIPLES_TSV_COLUMNS`` header. Numeric precision is
    chosen so the round-trip into Phase 3's binary format loses no
    user-visible precision: positions 6 dp (~µpc), magnitudes 4 dp,
    radians 6 dp, period 6 dp, eccentricity 6 dp, WDS sep 3 dp
    (matches the ρ catalogue's published resolution), PA 2 dp
    (matches θ), epoch 4 dp (mirrors T_jd).
    """
    with path.open("w") as fh:
        fh.write("\t".join(MULTIPLES_TSV_COLUMNS) + "\n")
        for r in rows:
            fh.write("\t".join((
                r.system_id,
                r.comp,
                _fmt_int(r.hip),
                _fmt_int(r.gaia_source_id),
                _fmt_float(r.x_pc, 6),
                _fmt_float(r.y_pc, 6),
                _fmt_float(r.z_pc, 6),
                _fmt_float(r.absmag, 4),
                _fmt_float(r.ci, 4),
                r.spect,
                r.name,
                r.source,
                str(r.regime),
                r.resolve_via,
                r.astrometry_via,
                r.orbit_via,
                r.spect_via,
                r.photometry_via,
                r.a_via,
                r.orbit_role,
                _fmt_float(r.P_days, 6),
                _fmt_float(r.T_jd, 4),
                _fmt_float(r.e, 6),
                _fmt_float(r.a_AU, 6),
                _fmt_float(r.i_rad, 6),
                _fmt_float(r.omega_rad, 6),
                _fmt_float(r.Omega_rad, 6),
                _fmt_float(r.q, 6),
                _fmt_float(r.dist_pc, 6),
                _fmt_float(r.sep_arcsec, 3),
                _fmt_float(r.pa_deg, 2),
                _fmt_float(r.sep_pa_epoch_jd, 4),
                _fmt_float(r.dmag, 4),
                _fmt_float(r.anchor_sep_arcsec, 3),
                _fmt_float(r.anchor_pa_deg, 2),
            )) + "\n")
    return len(rows)


