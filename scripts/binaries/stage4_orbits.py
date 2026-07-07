#!/usr/bin/env python3
"""Stage 4 — orbital-element selection per WDS pair.
Picks between Gaia NSS, ORB6 visual, and ORB6 spectroscopic orbits.
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator, TypeVar

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parsers import Orb6Entry, WdsPair, safe_float  # noqa: E402
from indices import IdentifierIndices  # noqa: E402
from stage2_resolve import (  # noqa: E402
    ResolvedComponent,
    group_orb6_by_pair,
    iter_decomposing_pair_cursor,
)
from stage3_astrometry import ComponentAstrometry  # noqa: E402


# ─── Stage 4: orbital-element selection ──────────────────────────────


# Routing tags Stage 4 may emit per WDS pair, in priority order. The
# log line and unit tests both read from this tuple so renaming a route
# only edits one place.
ORBIT_VIA_VALUES: tuple[str, ...] = (
    "orb6",
    "gaia_nss",
    "orb6_spectroscopic",
    "none",
)

# NSS detectability-regime gate. NSS claims a pair with no ORB6 visual
# orbit whenever (any component carries an NSS row) AND (period < ~3 yr
# OR apparent photocentre semi-major axis a0 < 1″). The OR is
# non-exclusive: a long-period system Gaia detected with a sub-arcsec
# photocentre orbit still routes to NSS. 95.8% of DR3 NSS rows have
# P < 3 yr — the threshold is conservative against the bulk of the
# catalog. The few longer-period rows (P up to ~27 yr) are captured by
# the sub-arcsec gate when their TI algebra resolves a0 < 1″.
NSS_PERIOD_THRESHOLD_DAYS = 3.0 * 365.25
NSS_SEPARATION_THRESHOLD_MAS = 1000.0

# Separation-sanity gate bounds — mass ceiling and ρ/a_max ratio for
# _nss_separation_consistent. See README.md § Stage 4 for the leak
# mechanism and the apastron derivation.
NSS_MAX_SYSTEM_MASS_MSUN = 150.0
NSS_SEPARATION_SANITY_RATIO = 3.0

# Gaia DR3 reference epoch J2016.0 as JD. NSS stores t_periastron in
# days from this epoch — Stage 4 converts to absolute JD for parity
# with ORB6's T0 column.
GAIA_DR3_REF_EPOCH_JD = 2457389.0

# Reference epoch J2000.0 as JD (for the ORB6 'y' = Julian-year T0 code).
J2000_REF_EPOCH_JD = 2451545.0

# Modified Julian Date offset (ORB6 T0_unit='m').
MJD_TO_JD_OFFSET = 2400000.5

# Truncated Julian Date offset (ORB6 T0_unit='d': the file stores
# JD − 2,400,000). Also the recovery reading for the ~50 truncated-JD
# epochs the catalog mislabels with the 'y' flag (see _orb6_T0_jd).
TRUNCATED_JD_TO_JD_OFFSET = 2400000.0

# Physically-possible window for a fitted periastron epoch, in full JD
# (Besselian years ≈1700–2600). A flag-driven conversion landing outside
# it means the ORB6 unit flag is wrong for that row; _orb6_T0_jd retries
# the truncated-JD reading and select_orbits_all asserts every emitted
# epoch stays inside.
T0_MIN_PLAUSIBLE_JD = J2000_REF_EPOCH_JD + (1700.0 - 2000.0) * 365.25
T0_MAX_PLAUSIBLE_JD = J2000_REF_EPOCH_JD + (2600.0 - 2000.0) * 365.25

# NSS solution types whose Thiele-Innes constants encode the
# PHOTOCENTRE's orbit around the barycentre, not the relative A–B
# orbit (A,B,F,G populated in 100% of DR3 rows; the stored
# inclination / arg_periastron columns are null).
NSS_TI_DERIVED_SOLUTION_TYPES: frozenset[str] = frozenset({
    "Orbital",
    "OrbitalAlternative",
    "OrbitalAlternativeValidated",
    "OrbitalTargetedSearch",
    "OrbitalTargetedSearchValidated",
    "AstroSpectroSB1",
})

# NSS eclipsing solution types — inclination and arg_periastron stored
# directly in the catalog columns (no TI). EclipsingSpectro adds mass
# ratio from spectroscopy. No semi-major axis is recoverable from
# eclipse photometry alone, so ``a_AU`` / ``Omega_rad`` are left None
# and the downstream renderer is expected to fall back to conventional
# defaults for these axes.
NSS_ECLIPSING_SOLUTION_TYPES: frozenset[str] = frozenset({
    "EclipsingBinary",
    "EclipsingSpectro",
})

# NSS spectroscopic-only solution types. SB1/SB2 carry arg_periastron;
# SB1C/SB2C ("compact" variants) carry only P/T/e/omega-from-Kepler
# elements without storing arg_periastron explicitly. Inclination and
# longitude-of-ascending-node are unrecoverable from RV alone.
NSS_SPECTROSCOPIC_SOLUTION_TYPES: frozenset[str] = frozenset({
    "SB1", "SB1C", "SB2", "SB2C",
})

NSS_SUPPORTED_SOLUTION_TYPES: frozenset[str] = (
    NSS_TI_DERIVED_SOLUTION_TYPES
    | NSS_ECLIPSING_SOLUTION_TYPES
    | NSS_SPECTROSCOPIC_SOLUTION_TYPES
)

# ORB6 grade classification. 1-5 = visual orbits in decreasing quality
# (definitive → indeterminate); 8 = interferometric-visibilities-only;
# 9 = astrometric / spectroscopic. Grade 7 is undocumented in the ORB6
# format text; the file's grade-7 rows are photometric / eclipsing
# orbits (YY Gem, EQ Tau, BX And — variable-star discoverer names,
# i ≈ 80-95°) with real fitted elements, so they route with the other
# non-visual grades. Visual grades own the ``orb6`` route; 7/8/9 own
# ``orb6_spectroscopic``.
ORB6_VISUAL_GRADES: frozenset[int] = frozenset({1, 2, 3, 4, 5})
ORB6_SPECTROSCOPIC_GRADES: frozenset[int] = frozenset({7, 8, 9})


@dataclass
class OrbitElements:
    """Canonical per-system orbital-element payload. Mirrors the runtime
    units that ``binary-orbit-pure.ts`` consumes (days / JD / radians) so
    Stage 6's multiples.tsv writer + Phase 3's v6-binary writer can
    serialise without per-consumer unit conversion.

    Fields are ``None`` when the underlying solution doesn't constrain
    them. The ``orb6_spectroscopic`` route leaves the underdetermined
    angles ``None`` rather than filling a conventional default — the
    convention is the downstream consumer's call.
    """

    P_days: float | None
    T_jd: float | None
    e: float | None
    a_AU: float | None
    i_rad: float | None
    omega_rad: float | None
    Omega_rad: float | None
    q: float | None              # mass ratio (where derivable)
    distance_pc: float | None    # from system parallax


def _thiele_innes_to_campbell(
    A: float, B: float, F: float, G: float,
) -> tuple[float, float, float, float] | None:
    """Heintz 1978 / Halbwachs+ 2023 Appendix C closed form.

    Inputs A,B,F,G in mas (Gaia DR3 NSS native). Returns
    ``(a_mas, i_rad, Omega_rad, omega_rad)`` where ``Omega`` is the
    longitude of ascending node mapped into [0, π) (the astronomical
    convention: the TI algebra leaves the ascending-vs-descending
    branch ambiguous, and the canonical fix is to halve the angle range
    so the rendered orbit picks one consistent orientation).

    Derivation. With ``u = (A² + B² + F² + G²) / 2`` and ``v = AG − BF``,
    the TI quartet satisfies ``2u = a²(1 + cos²i)`` and ``v = a²·cos i``,
    yielding ``a² = u + √(u² − v²)`` (the bigger root of the resulting
    quadratic in ``a²``) and ``cos²i = (u − √(u² − v²)) / (u + √(u²
    − v²))``. The sign of ``cos i`` follows ``sign(v)`` so retrograde
    orbits (i > π/2) recover correctly.

    Returns ``None`` only when the TI quartet degenerates (rare:
    zero-amplitude solution or numerical underflow); callers fall back
    to ORB6 in that case.
    """
    u = (A * A + B * B + F * F + G * G) / 2.0
    v = A * G - B * F
    disc = u * u - v * v
    if disc < 0.0:
        # Float jitter near the boundary of physical solutions. The
        # algebra is exact when (A,B,F,G) are consistent; a negative
        # discriminant here means the row's TI quartet is degenerate.
        return None
    root = math.sqrt(disc)
    a_sq = u + root
    if a_sq <= 0.0:
        return None
    a_mas = math.sqrt(a_sq)

    denom = u + root
    cos_i_sq = (u - root) / denom if denom > 0.0 else 0.0
    # Clamp [0,1] against floating-point jitter at the i=0 / i=π/2
    # boundaries where (u-root) → 0 or (u-root) → u.
    cos_i_sq = max(0.0, min(1.0, cos_i_sq))
    cos_i = math.sqrt(cos_i_sq)
    if v < 0.0:
        cos_i = -cos_i
    i_rad = math.acos(cos_i)

    sum_omega = math.atan2(B - F, A + G)     # ω + Ω
    diff_omega = math.atan2(-B - F, A - G)   # ω − Ω
    omega_rad = (sum_omega + diff_omega) / 2.0
    Omega_rad = (sum_omega - diff_omega) / 2.0

    # Convention: Ω ∈ [0, π). Add π and rotate ω accordingly so the
    # physical orbit is unchanged but the ambiguity collapses.
    if Omega_rad < 0.0:
        Omega_rad += math.pi
        omega_rad += math.pi
    omega_rad = omega_rad % (2.0 * math.pi)
    return a_mas, i_rad, Omega_rad, omega_rad


def _distance_pc(plx_mas: float | None) -> float | None:
    if plx_mas is None or plx_mas <= 0.0:
        return None
    return 1000.0 / plx_mas


def kepler_semimajor_axis_au(
    P_days: float, m_total_msun: float,
) -> float | None:
    """Kepler's third law in solar units: a³ = M_total · P_yr². Returns
    ``None`` for non-positive inputs. Stage 6 uses this to estimate the
    relative semi-major axis for orbits whose catalog source never
    publishes one (every Gaia NSS solution type; ORB6 rows missing the
    parallax the a″→AU conversion needs)."""
    if P_days <= 0.0 or m_total_msun <= 0.0:
        return None
    P_yr = P_days / 365.25
    return (m_total_msun * P_yr * P_yr) ** (1.0 / 3.0)


def _common_nss_period_T_e(
    nss_row: dict[str, str],
) -> tuple[float | None, float | None, float | None]:
    """Period (days), T (JD), and eccentricity from the always-present
    NSS columns. ``t_periastron`` is stored as days-since-J2016.0; we
    rebase to absolute JD here so every solution-type branch can emit
    a directly-comparable orbit_dict."""
    P_days = safe_float(nss_row.get("period", ""))
    t_peri_rel = safe_float(nss_row.get("t_periastron", ""))
    T_jd = t_peri_rel + GAIA_DR3_REF_EPOCH_JD if t_peri_rel is not None else None
    e = safe_float(nss_row.get("eccentricity", ""))
    return P_days, T_jd, e


def nss_to_canonical_elements(
    nss_row: dict[str, str], plx_mas: float | None,
) -> OrbitElements | None:
    """Convert a Gaia DR3 ``nss_two_body_orbit`` row to canonical
    elements, routing by ``nss_solution_type``:

    * TI-derived (``Orbital``, ``OrbitalAlternative*``,
      ``OrbitalTargetedSearch*``, ``AstroSpectroSB1``) — recover
      i/Ω/ω from A,B,F,G via Heintz 1978 algebra. The TI semi-major
      axis is the photocentre's a0, not the relative A–B orbit, so
      ``a_AU`` is always left ``None`` (README.md § Stage 4); ω is
      the photocentre's, π away from the secondary's relative-orbit
      ω when the primary dominates the flux.
    * Eclipsing (``EclipsingBinary``, ``EclipsingSpectro``) — read
      inclination + arg_periastron from the stored columns; eclipse
      photometry doesn't constrain ``a`` or ``Ω``. ``EclipsingSpectro``
      is the only NSS type that publishes ``mass_ratio``.
    * Spectroscopic-only (``SB1``, ``SB2``, ``SB1C``, ``SB2C``) — read
      arg_periastron when stored; inclination is unrecoverable from
      RV alone. The SB2C set is the "compact" variant (period/T/e only)
      and is intentionally passed through without geometry.

    Returns ``None`` for solution types we don't yet handle (none in
    DR3 today, but a forward guard against future NSS extensions); the
    caller falls through to ORB6.

    Cross-checked against the ESA NSSTools algebra (Halbwachs+ 2023);
    the algebra is inlined rather than imported because the package
    has not been maintained for 2+ years and the closed form is ~10
    lines.
    """
    soln = (nss_row.get("nss_solution_type") or "").strip()
    if soln not in NSS_SUPPORTED_SOLUTION_TYPES:
        return None

    P_days, T_jd, e = _common_nss_period_T_e(nss_row)

    a_AU: float | None = None
    i_rad: float | None = None
    Omega_rad: float | None = None
    omega_rad: float | None = None
    # Gaia NSS mass_ratio is M_S/M_P (a ratio, can exceed 1); q stores the
    # M_2/(M_1+M_2) fraction every other stage assumes, so convert.
    _mass_ratio = safe_float(nss_row.get("mass_ratio", ""))
    q: float | None = (
        _mass_ratio / (1.0 + _mass_ratio)
        if _mass_ratio is not None and _mass_ratio > 0.0
        else None
    )

    if soln in NSS_TI_DERIVED_SOLUTION_TYPES:
        A = safe_float(nss_row.get("a_thiele_innes", ""))
        B = safe_float(nss_row.get("b_thiele_innes", ""))
        F = safe_float(nss_row.get("f_thiele_innes", ""))
        G = safe_float(nss_row.get("g_thiele_innes", ""))
        if A is not None and B is not None and F is not None and G is not None:
            camp = _thiele_innes_to_campbell(A, B, F, G)
            if camp is not None:
                _a0_mas, i_rad, Omega_rad, omega_rad = camp
    elif soln in NSS_ECLIPSING_SOLUTION_TYPES:
        i_deg = safe_float(nss_row.get("inclination", ""))
        omega_deg = safe_float(nss_row.get("arg_periastron", ""))
        i_rad = math.radians(i_deg) if i_deg is not None else None
        omega_rad = math.radians(omega_deg) if omega_deg is not None else None
    else:  # NSS_SPECTROSCOPIC_SOLUTION_TYPES
        omega_deg = safe_float(nss_row.get("arg_periastron", ""))
        omega_rad = math.radians(omega_deg) if omega_deg is not None else None

    return OrbitElements(
        P_days=P_days, T_jd=T_jd, e=e,
        a_AU=a_AU, i_rad=i_rad,
        omega_rad=omega_rad, Omega_rad=Omega_rad,
        q=q,
        distance_pc=_distance_pc(plx_mas),
    )


def _nss_apparent_a0_mas(nss_row: dict[str, str]) -> float | None:
    """Apparent photocentre semi-major axis a0 in mas for the
    detectability-regime gate. TI-derived only — eclipsing / SB types
    don't constrain spatial scale so they get gated on period alone.
    """
    soln = (nss_row.get("nss_solution_type") or "").strip()
    if soln not in NSS_TI_DERIVED_SOLUTION_TYPES:
        return None
    A = safe_float(nss_row.get("a_thiele_innes", ""))
    B = safe_float(nss_row.get("b_thiele_innes", ""))
    F = safe_float(nss_row.get("f_thiele_innes", ""))
    G = safe_float(nss_row.get("g_thiele_innes", ""))
    if A is None or B is None or F is None or G is None:
        return None
    camp = _thiele_innes_to_campbell(A, B, F, G)
    if camp is None:
        return None
    return camp[0]


def _nss_in_regime(nss_row: dict[str, str]) -> bool:
    """``period < 3 yr`` OR ``a0 < 1″``. Either gate alone is
    sufficient. If neither quantity is computable (P missing AND no
    TI), the row is treated as out-of-regime — the caller falls
    through to ORB6 spectroscopic / none.
    """
    P_days = safe_float(nss_row.get("period", ""))
    if P_days is not None and P_days < NSS_PERIOD_THRESHOLD_DAYS:
        return True
    a0_mas = _nss_apparent_a0_mas(nss_row)
    if a0_mas is not None and a0_mas < NSS_SEPARATION_THRESHOLD_MAS:
        return True
    return False


def _nss_separation_consistent(
    nss_row: dict[str, str],
    wds_rho_arcsec: float | None,
    plx_mas: float | None,
) -> bool:
    """Reject attaching an NSS orbit to a pair whose WDS separation is far
    too wide to be that orbit. Consistent (returns ``True``) whenever ρ
    can't be evaluated — ρ missing / ≤ 0 (sub-resolution or the
    subdivide.py-synthesized inner pair that IS the orbit's true home), or
    no parallax / period — so the guard fires only when the separation is
    measured and demonstrably too wide for the period at any plausible
    mass. See NSS_SEPARATION_SANITY_RATIO.
    """
    if wds_rho_arcsec is None or wds_rho_arcsec <= 0.0:
        return True
    if plx_mas is None or plx_mas <= 0.0:
        return True
    P_days = safe_float(nss_row.get("period", ""))
    if P_days is None:
        return True
    a_max_au = kepler_semimajor_axis_au(P_days, NSS_MAX_SYSTEM_MASS_MSUN)
    if a_max_au is None:
        return True
    rho_au = wds_rho_arcsec * (1000.0 / plx_mas)
    return rho_au <= NSS_SEPARATION_SANITY_RATIO * a_max_au


def _orb6_period_days(entry: Orb6Entry) -> float | None:
    """Normalise ORB6's ``P_val`` to days. Returns ``None`` for unknown
    or garbage unit codes (rare; ~3 rows of 4,054 use stray digits from
    fixed-format misalignment — those rows are skipped rather than
    guessed) and for non-positive periods, which would otherwise mint
    renderable elements whose Kepler eval divides by P."""
    if entry.P_val is None or entry.P_val <= 0:
        return None
    unit = entry.P_unit
    if unit == "y":
        return entry.P_val * 365.25
    if unit == "d":
        return entry.P_val
    if unit == "c":
        return entry.P_val * 100.0 * 365.25
    if unit == "h":
        return entry.P_val / 24.0
    if unit == "m":
        return entry.P_val / (24.0 * 60.0)
    return None


def _orb6_semimajor_au(
    entry: Orb6Entry, plx_mas: float | None,
) -> float | None:
    """Convert ORB6's ``a_val`` + ``a_unit`` to AU using the system's
    Gaia/HIP2 parallax. Unit codes: ``a`` = arcsec, ``m`` = mas (``M``
    is a known typo of ``m`` in two rows; treated the same). Other
    codes ('1','5','') are garbage from fixed-column misalignment and
    return ``None`` rather than guess."""
    if entry.a_val is None or plx_mas is None or plx_mas <= 0.0:
        return None
    unit = entry.a_unit
    if unit == "a":
        a_mas = entry.a_val * 1000.0
    elif unit in ("m", "M"):
        a_mas = entry.a_val
    else:
        return None
    return a_mas / plx_mas


def _orb6_T0_jd(entry: Orb6Entry) -> float | None:
    """Normalise ORB6's ``T0_val`` + ``T0_unit`` to absolute JD.

    Unit codes (orb6format.txt): ``d`` = truncated JD (the file stores
    JD − 2,400,000), ``m`` = MJD (JD − 2,400,000.5), ``y`` = fractional
    Besselian year (via the J2000 anchor + 365.25-day year, matching
    ``wds_year_to_jd``). ``c`` and blank codes aren't reliably
    interpretable — the documented ``c`` = year/100 form matches none of
    the file's ``c`` rows — so they return ``None``.

    ORB6 mislabels ~50 truncated-JD epochs with the ``y`` flag — e.g.
    WDS 04227+1503 Aa,Ab stores ``59501.496 y`` (a JD − 2,400,000 value)
    for a 4-day spectroscopic pair — and the year formula then throws the
    epoch out past JD 2e7. A ``y`` conversion landing outside the
    physically-possible epoch window is retried as a truncated JD, the
    sole observed mislabel mode; if that too is implausible the row
    returns ``None`` so the renderer falls back to the WDS-epoch static
    placement.
    """
    if entry.T0_val is None:
        return None
    val = entry.T0_val
    unit = entry.T0_unit
    if unit == "d":
        return val + TRUNCATED_JD_TO_JD_OFFSET
    if unit == "m":
        return val + MJD_TO_JD_OFFSET
    if unit == "y":
        year_jd = J2000_REF_EPOCH_JD + (val - 2000.0) * 365.25
        if T0_MIN_PLAUSIBLE_JD <= year_jd <= T0_MAX_PLAUSIBLE_JD:
            return year_jd
        truncated_jd = val + TRUNCATED_JD_TO_JD_OFFSET
        if T0_MIN_PLAUSIBLE_JD <= truncated_jd <= T0_MAX_PLAUSIBLE_JD:
            return truncated_jd
        return None
    return None


def orb6_to_canonical_elements(
    entry: Orb6Entry, plx_mas: float | None,
) -> OrbitElements | None:
    """ORB6 row → canonical ``OrbitElements``. Returns ``None`` only
    when the period is unparseable or non-positive; an unparseable T0 or a
    missing parallax leaves the affected fields ``None`` but the rest
    of the orbit still populates so downstream consumers can choose
    their own fallback.

    ORB6 visual grades populate i / Ω / ω directly from the catalog
    columns (degrees → radians). Spectroscopic-only entries (grades
    8-9) may have ``i_deg = None``; in that case ``i_rad`` is left
    ``None`` (the historic Regime-3 convention of synthesising i=0 is
    deferred to the renderer per the ``orb6_spectroscopic`` route).
    """
    P_days = _orb6_period_days(entry)
    if P_days is None:
        return None

    return OrbitElements(
        P_days=P_days,
        T_jd=_orb6_T0_jd(entry),
        e=entry.e,
        a_AU=_orb6_semimajor_au(entry, plx_mas),
        i_rad=math.radians(entry.i_deg) if entry.i_deg is not None else None,
        omega_rad=math.radians(entry.omega_deg) if entry.omega_deg is not None else None,
        Omega_rad=math.radians(entry.Omega_deg) if entry.Omega_deg is not None else None,
        q=None,
        distance_pc=_distance_pc(plx_mas),
    )


def _pick_best_orb6(entries: list[Orb6Entry]) -> Orb6Entry:
    """Grade tiebreak (lowest numeric grade = best); ref-year secondary
    tiebreak (most recent wins). ``entries`` is already filtered to a
    single grade band — visual (1-5) or spectroscopic (8-9) — by the
    caller, so the tiebreak never mixes regimes.
    """
    def ref_year(e: Orb6Entry) -> int:
        # ORB6 refs are like "Ake2021" / "Krv2017" — 3-letter initials
        # then a 4-digit year. Pull the trailing digits; older
        # surveyor-only refs without a year sort to the bottom.
        tail = e.ref[-4:]
        return int(tail) if tail.isdigit() else 0

    return min(entries, key=lambda e: (e.grade, -ref_year(e)))


def _system_parallax_mas(
    astrometry_for_pair: list[ComponentAstrometry],
) -> float | None:
    """Pick the system's parallax from the most-trustworthy component
    astrometry available — primary first, secondary as fallback. The
    Stage 3 route on each row carries the provenance; we don't
    differentiate further here (gaia_5p, gaia_nss_systemic, and
    hip2_long_baseline all populate parallax_mas equivalently)."""
    for a in astrometry_for_pair:
        plx = _component_parallax_mas(a)
        if plx is not None:
            return plx
    return None


def select_orbit(
    primary: ResolvedComponent,
    secondary: ResolvedComponent,
    primary_astrometry: ComponentAstrometry,
    secondary_astrometry: ComponentAstrometry,
    orb6_for_pair: list[Orb6Entry],
    indices: IdentifierIndices,
    wds_rho_arcsec: float | None = None,
    system_parallax_mas: float | None = None,
) -> tuple[OrbitElements | None, str]:
    """Priority cascade per WDS pair:

    1. ``orb6`` — ORB6 visual orbit (grade ∈ {1..5}). Grade tiebreak;
       ref-year secondary tiebreak. The genuine relative A–B orbit —
       outranks NSS, whose solution types never yield a relative
       semi-major axis (the TI a is the photocentre's a0).
    2. ``gaia_nss`` — a component has an NSS two-body row, its partner
       is not a different resolved source (distinct-source pairs host
       the orbit INSIDE the carrying component — see the branch
       comment), AND the solution falls inside Gaia's astrometric-
       detectability regime (P < ~3 yr OR a0 < 1″), AND the pair's WDS
       separation isn't far too wide to be that orbit (interior orbits
       leak onto wide companions of a blended primary — see
       ``_nss_separation_consistent``). Primary's NSS row preferred when
       both components have one (secondary is rarely the catalogued
       systemic source).
    3. ``orb6_spectroscopic`` — ORB6 non-visual orbits
       (grade ∈ {7,8,9}). Same tiebreaks.
    4. ``none`` — visual-only pair with no orbital information on file.

    The two ``ComponentAstrometry`` arguments are required (not
    optional) so the parallax-needed conversion (ORB6 a_unit='a'/'m' →
    AU) always has a value to consult, even when only one of the two
    components has 5p astrometry attached.
    """
    plx_mas = _system_parallax_mas([primary_astrometry, secondary_astrometry])

    # ORB6 visual branch.
    visual = [e for e in orb6_for_pair if e.grade in ORB6_VISUAL_GRADES]
    if visual:
        best = _pick_best_orb6(visual)
        orbit = orb6_to_canonical_elements(best, plx_mas)
        if orbit is not None:
            return orbit, "orb6"

    # NSS branch — primary then secondary. An NSS orbit describes the
    # SOURCE's own two-body motion; when the partner is a different
    # resolved source, that orbit is interior to the carrying component
    # (its unseen sub-companion), not this pair's — subdivide.py
    # re-homes it on a synthesized inner pair instead. Only a partner
    # sharing the same blended source (or carrying none) can be the
    # NSS orbit's other body.
    for comp, other in ((primary, secondary), (secondary, primary)):
        if comp.gaia_source_id is None:
            continue
        if (
            other.gaia_source_id is not None
            and other.gaia_source_id != comp.gaia_source_id
        ):
            continue
        nss_row = indices.src_to_nss.get(comp.gaia_source_id)
        if nss_row is None:
            continue
        if not _nss_in_regime(nss_row):
            continue
        gate_plx = plx_mas if plx_mas is not None else system_parallax_mas
        if not _nss_separation_consistent(nss_row, wds_rho_arcsec, gate_plx):
            continue
        orbit = nss_to_canonical_elements(nss_row, plx_mas)
        if orbit is not None:
            return orbit, "gaia_nss"

    # ORB6 spectroscopic / astrometric-only branch.
    spec = [e for e in orb6_for_pair if e.grade in ORB6_SPECTROSCOPIC_GRADES]
    if spec:
        best = _pick_best_orb6(spec)
        orbit = orb6_to_canonical_elements(best, plx_mas)
        if orbit is not None:
            return orbit, "orb6_spectroscopic"

    return None, "none"


def iter_decomposing_pairs(
    pairs: list[WdsPair],
    components: list[ResolvedComponent],
    astrometry: list[ComponentAstrometry],
) -> Iterator[tuple[
    WdsPair, ResolvedComponent, ResolvedComponent,
    ComponentAstrometry, ComponentAstrometry,
]]:
    """Walk ``pairs`` alongside Stage 2's ``components`` and Stage 3's
    ``astrometry`` outputs in lockstep, yielding one tuple per pair
    that decomposed into two components. Pairs ``resolve_all_pairs``
    skipped (empty / ambiguous components string) are skipped here too,
    keeping cursor alignment.

    The components+astrometry lists must be the untouched outputs of
    ``resolve_all_pairs`` and ``attach_astrometry_all``; the
    two-per-pair invariant fails on any filtered/reordered input.
    """
    if len(components) != len(astrometry):
        raise ValueError(
            "components / astrometry list lengths disagree — Stage 3 "
            "output contract violated"
        )
    for pair, i in iter_decomposing_pair_cursor(pairs, components):
        yield pair, components[i], components[i + 1], astrometry[i], astrometry[i + 1]


_T = TypeVar("_T")


def first_astrometry_field_per_system(
    pairs: list[WdsPair],
    components: list[ResolvedComponent],
    astrometry: list[ComponentAstrometry],
    extract: Callable[[ComponentAstrometry], _T | None],
) -> dict[str, _T]:
    """First non-``None`` ``extract(component_astrometry)`` per ``wds_id``,
    primary preferred then secondary, first system row wins. Shared by
    Stage 4's separation-gate parallax lookup
    (``compute_system_parallaxes``) and Stage 6's ``compute_system_anchors``
    — the two differ only in what they pull off the anchoring component.
    """
    out: dict[str, _T] = {}
    for pair, _primary, _secondary, p_ast, s_ast in iter_decomposing_pairs(
        pairs, components, astrometry,
    ):
        if pair.wds_id in out:
            continue
        for ast in (p_ast, s_ast):
            value = extract(ast)
            if value is not None:
                out[pair.wds_id] = value
                break
    return out


def _component_parallax_mas(ast: ComponentAstrometry) -> float | None:
    if ast.parallax_mas is not None and ast.parallax_mas > 0.0:
        return ast.parallax_mas
    return None


def _component_parallax_with_error(
    ast: ComponentAstrometry,
) -> tuple[float, float | None] | None:
    """``(parallax_mas, e_parallax_mas)`` for the first usable value, or
    ``None`` when no positive parallax. The error term may itself be
    ``None`` (HIP2 rows the parser doesn't surface a σ for); Stage 5's
    separation gate treats a missing σ as zero in the combined-error
    quadrature."""
    if ast.parallax_mas is not None and ast.parallax_mas > 0.0:
        return ast.parallax_mas, ast.parallax_error_mas
    return None


def compute_system_parallaxes(
    pairs: list[WdsPair],
    components: list[ResolvedComponent],
    astrometry: list[ComponentAstrometry],
) -> dict[str, float]:
    """One parallax (mas) per ``wds_id`` from the first system component
    with a usable Gaia/HIP2 value. Feeds the separation-sanity gate a
    distance even when a pair's own two components both resolved to
    ``unresolved`` — the same first-resolved-per-system anchor Stage 6's
    ``compute_system_anchors`` places them at, so the gate rejects on
    approximately the render distance. (Stage 6 additionally requires a
    position, not just a parallax, so the two can pick different anchor
    components; harmless, since a system's components share a distance.)"""
    return first_astrometry_field_per_system(
        pairs, components, astrometry, _component_parallax_mas,
    )


def compute_system_parallax_anchors(
    pairs: list[WdsPair],
    components: list[ResolvedComponent],
    astrometry: list[ComponentAstrometry],
) -> dict[str, tuple[float, float | None]]:
    """One ``(parallax_mas, e_parallax_mas)`` anchor per ``wds_id`` from the
    first system component with a usable parallax — the measurement Stage 5's
    separation-limit gate compares a resolved companion's own distance
    against. Same first-resolved-per-system anchor as
    ``compute_system_anchors``, but carrying the parallax + its error rather
    than the Cartesian position, so the gate can apply its combined-error
    radial-significance test."""
    return first_astrometry_field_per_system(
        pairs, components, astrometry, _component_parallax_with_error,
    )


def select_orbits_all(
    pairs: list[WdsPair],
    components: list[ResolvedComponent],
    astrometry: list[ComponentAstrometry],
    orb6: list[Orb6Entry],
    indices: IdentifierIndices,
) -> list[tuple[OrbitElements | None, str]]:
    """One ``(orbit, orbit_via)`` per decomposing WDS pair, in
    ``resolve_all_pairs`` iteration order. Stage 6's multiples.tsv
    writer joins this list back against the same pair iteration to
    populate per-pair element columns.
    """
    orb6_by_pair = group_orb6_by_pair(orb6)
    system_parallax = compute_system_parallaxes(pairs, components, astrometry)
    out: list[tuple[OrbitElements | None, str]] = []
    for pair, p, s, p_ast, s_ast in iter_decomposing_pairs(
        pairs, components, astrometry,
    ):
        orb6_for_pair = orb6_by_pair.get((pair.wds_id, pair.components), [])
        orbit, via = select_orbit(
            primary=p, secondary=s,
            primary_astrometry=p_ast, secondary_astrometry=s_ast,
            orb6_for_pair=orb6_for_pair, indices=indices,
            wds_rho_arcsec=pair.rho_last,
            system_parallax_mas=system_parallax.get(pair.wds_id),
        )
        if orbit is not None and orbit.P_days is not None and orbit.T_jd is not None:
            if not (T0_MIN_PLAUSIBLE_JD <= orbit.T_jd <= T0_MAX_PLAUSIBLE_JD):
                raise ValueError(
                    f"Stage 4 periastron epoch out of range for "
                    f"{pair.wds_id}/{pair.components} via {via}: "
                    f"T_jd={orbit.T_jd} (expected "
                    f"[{T0_MIN_PLAUSIBLE_JD}, {T0_MAX_PLAUSIBLE_JD}])"
                )
        out.append((orbit, via))
    return out


def orbit_counts(
    orbits: list[tuple[OrbitElements | None, str]],
) -> dict[str, int]:
    """Per-route counters in canonical ``ORBIT_VIA_VALUES`` order.
    Every key present (zero-filled) so the log line shape stays stable
    across runs."""
    counts: dict[str, int] = {k: 0 for k in ORBIT_VIA_VALUES}
    for _, via in orbits:
        counts[via] = counts.get(via, 0) + 1
    return counts


