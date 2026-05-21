#!/usr/bin/env python3
"""Stage 6 — emit ``data/binaries/multiples.tsv``.

Two rows per kept (physical) pair, columns per ``MULTIPLES_TSV_COLUMNS``:
system_id, component, hip / gaia_source_id, ICRS x/y/z parsec position,
AT-HYG photometric / spectral metadata, orbital elements from Stage 4,
resolve / astrometry / orbit provenance tags. Phase 3's v6 binary
writer is the consumer.

Lifted out of ``build-binaries.py`` in stellata-9mm.204.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, fields
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parsers import AthygRow, WdsPair  # noqa: E402
from indices import IdentifierIndices  # noqa: E402
from stage2_resolve import (  # noqa: E402
    ResolvedComponent,
    _spherical_to_unit_vec,
    split_components,
)
from stage3_astrometry import ComponentAstrometry  # noqa: E402
from stage4_orbits import OrbitElements  # noqa: E402
from stage5_optical import OpticalClassification  # noqa: E402


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
    "resolve_via", "astrometry_via", "orbit_via",
    "orbit_role",
    "P_days", "T_jd", "e", "a_AU",
    "i_rad", "omega_rad", "Omega_rad",
    "q", "dist_pc",
)


# orbit_via → numeric ``regime`` tag for parity with the legacy
# pre-dch.27 column. 0 = no orbital information; 2 = full orbital
# elements (Gaia NSS or ORB6 visual); 3 = spectroscopic-only. Phase 3's
# v6 binary writer keys orbit-element population off this tag; finer
# provenance lives in ``orbit_via`` alongside.
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


def build_multiples_row(
    pair: WdsPair,
    component: ResolvedComponent,
    astrometry: ComponentAstrometry,
    orbit: OrbitElements | None,
    orbit_via: str,
    is_primary: bool,
    indices: IdentifierIndices,
) -> MultiplesRow:
    """Project Stage 2-4 outputs for one component into one canonical
    ``MultiplesRow``. The ``system_id`` is ``"{wds_id}-{components}"``
    (e.g. ``"00491+5749-AB"``) — stable across A-row and B-row of the
    same pair so the catalog binary writer can group them. Position is
    computed at the astrometry's native epoch; proper-motion-to-J2000
    propagation is deferred to Phase 3 per the Stage 3 docstring."""
    athyg = _athyg_row_for_component(component, indices)
    position = _position_pc(astrometry)

    return MultiplesRow(
        system_id=f"{pair.wds_id}-{pair.components}",
        comp=component.component,
        hip=component.hip,
        gaia_source_id=component.gaia_source_id,
        x_pc=position[0] if position is not None else None,
        y_pc=position[1] if position is not None else None,
        z_pc=position[2] if position is not None else None,
        absmag=athyg.absmag if athyg is not None else None,
        ci=athyg.ci if athyg is not None else None,
        spect=athyg.spect if athyg is not None else "",
        name=athyg.proper if athyg is not None else "",
        source="athyg" if athyg is not None else "wds",
        regime=ORBIT_VIA_TO_REGIME.get(orbit_via, 0),
        resolve_via=component.resolve_via,
        astrometry_via=astrometry.astrometry_via,
        orbit_via=orbit_via,
        orbit_role="primary" if is_primary else "secondary",
        P_days=orbit.P_days if orbit is not None else None,
        T_jd=orbit.T_jd if orbit is not None else None,
        e=orbit.e if orbit is not None else None,
        a_AU=orbit.a_AU if orbit is not None else None,
        i_rad=orbit.i_rad if orbit is not None else None,
        omega_rad=orbit.omega_rad if orbit is not None else None,
        Omega_rad=orbit.Omega_rad if orbit is not None else None,
        q=orbit.q if orbit is not None else None,
        dist_pc=position[3] if position is not None else None,
    )


def build_multiples_rows(
    pairs: list[WdsPair],
    components: list[ResolvedComponent],
    astrometry: list[ComponentAstrometry],
    orbits: list[tuple[OrbitElements | None, str]],
    classifications: list[OpticalClassification],
    indices: IdentifierIndices,
) -> list[MultiplesRow]:
    """Walk the per-pair Stage 2/3/4/5 outputs in lockstep. Skips pairs
    Stage 5 classified as optical (their rows are absent from the TSV
    entirely — downstream consumers should not see optical-flagged
    SYN-NNN injections), and skips pairs where both components lack
    any astrometry (no position constraint to emit).
    """
    n_pairs = sum(1 for p in pairs if split_components(p.components) is not None)
    if not (len(orbits) == n_pairs == len(classifications)):
        raise ValueError(
            "Stage 6 input cardinality disagreement — orbits / "
            "classifications must run parallel to decomposing pairs"
        )

    out: list[MultiplesRow] = []
    i = 0       # cursor into components / astrometry
    j = 0       # cursor into orbits / classifications
    for pair in pairs:
        if split_components(pair.components) is None:
            continue
        cls = classifications[j]
        if cls.is_physical:
            primary = components[i]
            secondary = components[i + 1]
            p_ast = astrometry[i]
            s_ast = astrometry[i + 1]
            orbit, via = orbits[j]
            p_pos = _position_pc(p_ast)
            s_pos = _position_pc(s_ast)
            if p_pos is not None or s_pos is not None:
                out.append(build_multiples_row(
                    pair, primary, p_ast, orbit, via,
                    is_primary=True, indices=indices,
                ))
                out.append(build_multiples_row(
                    pair, secondary, s_ast, orbit, via,
                    is_primary=False, indices=indices,
                ))
        i += 2
        j += 1
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
    radians 6 dp, period 6 dp, eccentricity 6 dp.
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
            )) + "\n")
    return len(rows)


