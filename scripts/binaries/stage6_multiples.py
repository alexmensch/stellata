#!/usr/bin/env python3
"""Stage 6 — emit ``data/binaries/multiples.tsv``.

Two rows per kept (physical) pair, columns per ``MULTIPLES_TSV_COLUMNS``:
system_id, component, hip / gaia_source_id, ICRS x/y/z parsec position,
AT-HYG photometric / spectral metadata, orbital elements from Stage 4,
resolve / astrometry / orbit provenance tags. Phase 3's v6 binary
writer is the consumer.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, fields
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parsers import AthygRow, SimbadWdsXid, WdsPair  # noqa: E402
from indices import IdentifierIndices  # noqa: E402
from stage2_resolve import (  # noqa: E402
    ResolvedComponent,
    _spherical_to_unit_vec,
    split_components,
)
from stage3_astrometry import ComponentAstrometry  # noqa: E402
from stage4_orbits import OrbitElements  # noqa: E402
from stage5_optical import OpticalClassification  # noqa: E402
from mass_estimate import mass_ratio_from_components  # noqa: E402


# ─── Stage 6: multiples.tsv emit ─────────────────────────────────────


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
    "orbit_role",
    "P_days", "T_jd", "e", "a_AU",
    "i_rad", "omega_rad", "Omega_rad",
    "q", "dist_pc",
    "sep_arcsec", "pa_deg", "sep_pa_epoch_jd",
)


# WDS publishes ``date_last`` as a 4-digit year of the last reported
# observation. Convert to Julian Date treating the year as a Julian-year
# epoch (start of that calendar year) — sub-day precision is irrelevant
# because the sep/PA columns drive a static placement, not a time-
# resolved propagation. The reference anchor is J2000 = JD 2451545.0.
_JD_J2000 = 2451545.0
_DAYS_PER_JULIAN_YEAR = 365.25


def wds_year_to_jd(year: int | None) -> float | None:
    """Convert a WDS ``date_last`` 4-digit year integer to JD. ``None``
    passes through so a row without an observation date keeps an empty
    epoch cell."""
    if year is None:
        return None
    return _JD_J2000 + (float(year) - 2000.0) * _DAYS_PER_JULIAN_YEAR


# ``spect_via`` provenance tags for the per-component spectral column.
# Mirrors the per-section ``_VIA_VALUES`` pattern from the other stages
# (resolve / astrometry / orbit / optical) so stage 7's count-snapshot
# diff surfaces each tier independently.
SPECT_VIA_SIMBAD = "simbad"
SPECT_VIA_ATHYG = "athyg"
SPECT_VIA_NONE = "none"
SPECT_VIA_VALUES: tuple[str, ...] = (
    SPECT_VIA_SIMBAD, SPECT_VIA_ATHYG, SPECT_VIA_NONE,
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
    """Look up AT-HYG row for a resolved component, preferring the
    gaia_source_id index (most reliable; carries Gaia source_id direct
    from AT-HYG's own ingest). Falls back to the HIP index for
    Gaia-saturated bright primaries (Sirius / α Cen / Procyon) whose
    AT-HYG row carries the HIP but not the Gaia source.
    """
    if component.gaia_source_id is not None:
        row = indices.src_to_athyg.get(component.gaia_source_id)
        if row is not None:
            return row
    if component.hip is not None:
        return indices.hip_to_athyg.get(component.hip)
    return None


def _position_pc(astrometry: ComponentAstrometry) -> tuple[float, float, float, float] | None:
    """ICRS RA/Dec + parallax → (x_pc, y_pc, z_pc, dist_pc). Returns
    ``None`` when the astrometry row is unresolved or carries no
    positive parallax — Phase 3 reads the empty columns as "no
    position constraint" and falls back to the AT-HYG single-component
    position if needed."""
    if (
        astrometry.ra_deg is None
        or astrometry.dec_deg is None
        or astrometry.parallax_mas is None
        or astrometry.parallax_mas <= 0.0
    ):
        return None
    dist_pc = 1000.0 / astrometry.parallax_mas
    x, y, z = _spherical_to_unit_vec(astrometry.ra_deg, astrometry.dec_deg)
    return x * dist_pc, y * dist_pc, z * dist_pc, dist_pc


SystemAnchor = tuple[float, float, float, float]


def _iter_decomposing_pairs(
    pairs: list[WdsPair],
    components: list[ResolvedComponent],
    astrometry: list[ComponentAstrometry],
):
    """Yield ``(pair, primary, secondary, p_ast, s_ast)`` for each
    decomposing WDS pair, skipping the ones Stage 2 left as
    system-level / ambiguous ``components`` strings. Shared by
    ``compute_system_anchors`` and ``build_multiples_rows`` so both
    paths agree on the cursor (any change to the skip condition lands
    in exactly one place)."""
    i = 0
    for pair in pairs:
        if split_components(pair.components) is None:
            continue
        yield pair, components[i], components[i + 1], astrometry[i], astrometry[i + 1]
        i += 2


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
    out: dict[str, SystemAnchor] = {}
    for pair, primary, secondary, p_ast, s_ast in _iter_decomposing_pairs(
        pairs, components, astrometry,
    ):
        if pair.wds_id in out:
            continue
        pos = _position_pc(p_ast)
        if pos is not None:
            out[pair.wds_id] = pos
            continue
        pos = _position_pc(s_ast)
        if pos is not None:
            out[pair.wds_id] = pos
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
    """Per-component spectral type with SIMBAD → AT-HYG → none fallback,
    returned alongside the ``spect_via`` provenance tag. SIMBAD's
    per-component sp_type wins because AT-HYG carries a single
    per-system string that gets inherited by every component, even
    when each has its own MK / WD class. Standalone rows pass
    ``athyg=None``."""
    simbad_spect = indices.simbad_wds_spectra.get((wds_id, component))
    if simbad_spect:
        return simbad_spect, SPECT_VIA_SIMBAD
    athyg_spect = athyg.spect if athyg is not None else ""
    if athyg_spect:
        return athyg_spect, SPECT_VIA_ATHYG
    return "", SPECT_VIA_NONE


def _component_astrometry_from_gaia(gaia) -> ComponentAstrometry:
    """Wrap a per-source ``GaiaAstrometryRow`` into a
    ``ComponentAstrometry`` tagged ``gaia_5p``, so the standalone path
    can share ``_position_pc`` / ``_resolve_position`` /
    ``_astrometry_via`` with the pair walk."""
    return ComponentAstrometry(
        astrometry_via="gaia_5p",
        ra_deg=gaia.ra_deg, dec_deg=gaia.dec_deg,
        parallax_mas=gaia.parallax_mas,
        pmra_masyr=gaia.pmra_masyr, pmdec_masyr=gaia.pmdec_masyr,
        ref_epoch=gaia.ref_epoch,
    )


def build_multiples_row(
    pair: WdsPair,
    component: ResolvedComponent,
    astrometry: ComponentAstrometry,
    orbit: OrbitElements | None,
    orbit_via: str,
    is_primary: bool,
    indices: IdentifierIndices,
    system_anchor: SystemAnchor | None = None,
) -> MultiplesRow:
    """Project Stage 2-4 outputs for one component into one canonical
    ``MultiplesRow`` keyed by ``_system_id_for_pair``. Position is
    computed at the astrometry's native epoch; proper-motion-to-J2000
    propagation is deferred to Phase 3 per the Stage 3 docstring.

    ``system_anchor`` is the inherited-position fallback — when the
    component's own astrometry resolved to ``"unresolved"`` (tight inner
    binary blended out of Gaia DR3), the row inherits the system
    primary's position and promotes ``astrometry_via`` to
    ``"system_inherited"``.
    """
    athyg = _athyg_row_for_component(component, indices)
    position, inherited = _resolve_position(astrometry, system_anchor)
    spect, spect_via = _resolve_spect(
        pair.wds_id, component.component, athyg, indices,
    )
    astrometry_via = _astrometry_via(astrometry, inherited)

    return MultiplesRow(
        system_id=_system_id_for_pair(pair),
        comp=component.component,
        hip=component.hip,
        gaia_source_id=component.gaia_source_id,
        x_pc=position[0] if position is not None else None,
        y_pc=position[1] if position is not None else None,
        z_pc=position[2] if position is not None else None,
        absmag=athyg.absmag if athyg is not None else None,
        ci=athyg.ci if athyg is not None else None,
        spect=spect,
        name=athyg.proper if athyg is not None else "",
        source=SOURCE_ATHYG if athyg is not None else SOURCE_WDS,
        regime=ORBIT_VIA_TO_REGIME.get(orbit_via, 0),
        resolve_via=component.resolve_via,
        astrometry_via=astrometry_via,
        orbit_via=orbit_via,
        spect_via=spect_via,
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
    )


def build_multiples_rows(
    pairs: list[WdsPair],
    components: list[ResolvedComponent],
    astrometry: list[ComponentAstrometry],
    orbits: list[tuple[OrbitElements | None, str]],
    classifications: list[OpticalClassification],
    indices: IdentifierIndices,
    simbad_xids: dict[tuple[str, str], SimbadWdsXid] | None = None,
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
    """
    n_pairs = sum(1 for p in pairs if split_components(p.components) is not None)
    if not (len(orbits) == n_pairs == len(classifications)):
        raise ValueError(
            "Stage 6 input cardinality disagreement — orbits / "
            "classifications must run parallel to decomposing pairs"
        )

    system_anchors = compute_system_anchors(pairs, components, astrometry)

    out: list[MultiplesRow] = []
    emitted_keys: set[tuple[str, str]] = set()
    for j, (pair, primary, secondary, p_ast, s_ast) in enumerate(
        _iter_decomposing_pairs(pairs, components, astrometry),
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
        primary_row = build_multiples_row(
            pair, primary, p_ast, orbit, via,
            is_primary=True, indices=indices,
            system_anchor=anchor,
        )
        secondary_row = build_multiples_row(
            pair, secondary, s_ast, orbit, via,
            is_primary=False, indices=indices,
            system_anchor=anchor,
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
        ))
    return out


def build_standalone_rows(
    simbad_xids: dict[tuple[str, str], SimbadWdsXid],
    emitted_keys: set[tuple[str, str]],
    system_anchors: dict[str, SystemAnchor],
    indices: IdentifierIndices,
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
            orbit_role=ORBIT_ROLE_STANDALONE,
            P_days=None, T_jd=None, e=None, a_AU=None,
            i_rad=None, omega_rad=None, Omega_rad=None,
            q=None,
            dist_pc=position[3] if position is not None else None,
            sep_arcsec=None, pa_deg=None, sep_pa_epoch_jd=None,
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
            )) + "\n")
    return len(rows)


