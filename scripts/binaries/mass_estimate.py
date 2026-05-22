#!/usr/bin/env python3
"""Per-component stellar mass estimate from a SIMBAD/MK spectral string.

Used by Stage 6 to derive a mass-ratio q for visual binaries (ORB6
route) where Gaia NSS spectroscopy didn't already supply one. The Gaia
NSS ``mass_ratio`` column always wins; this module is the fallback.

Returns mass in solar masses or ``None`` when the spectral string is
unparseable. Reference tables condensed from Cox 2000 §15.2 (Allen's
Astrophysical Quantities 4th ed.) for MS / III / IV / I, plus the
solar-neighbourhood mean WD mass (~0.6 M_sun). The white-dwarf branch
intentionally ignores the WD subclass digit: per-WD masses span 0.3 to
1.4 M_sun on cooling tracks and cannot be recovered from sp_type
alone (Sirius B's 1.0 M_sun is the canonical counterexample).
"""

from __future__ import annotations

import re
from dataclasses import dataclass


# ─── Spectral-string parser ──────────────────────────────────────────


# Spectral first-letter → class index. Mirrors catalog-pure.ts's
# spectClassIndex so a future reader sees the same encoding on both
# sides of the pipeline. 7 collects carbon / S / Wolf-Rayet (off the
# main MK grid); 8 is unknown.
_CLASS_IDX: dict[str, int] = {
    "O": 0, "B": 1, "A": 2, "F": 3, "G": 4, "K": 5, "M": 6,
    "C": 7, "S": 7, "W": 7, "N": 7, "R": 7,
}


# Luminosity-class numeric codes. Matches catalog-pure.ts's encoding:
#   0 = VII/D (WD)  1 = VI/sd (subdwarf)  2 = V (MS)  3 = IV (subgiant)
#   4 = III (giant)  5 = II (bright giant)  6 = Ib  7 = Iab  8 = Ia
#   9 = Ia+ / 0 (hypergiant)  255 = unknown
_LUM_PREFIXES: tuple[tuple[re.Pattern[str], int], ...] = tuple(
    (re.compile(pat), lc)
    for pat, lc in (
        (r"^IA\+|^0(?!\d)", 9),
        (r"^IAB",           7),
        (r"^IA(?!B)",       8),
        (r"^IB",            6),
        (r"^III",           4),
        (r"^II(?!I)",       5),
        (r"^IV",            3),
        (r"^VII",           0),
        (r"^VI(?!I)",       1),
        (r"^V(?!I)",        2),
        (r"^I(?![IV])",     7),
    )
)


@dataclass(frozen=True)
class ParsedSpect:
    """Class / subclass / lum-class triple extracted from an MK string.
    ``classIdx`` 8 = unknown / unparseable first letter; ``lumClass``
    255 = no Roman tail recognised; ``isWhiteDwarf`` true for D-prefix
    SIMBAD strings (overrides ``lumClass`` numerically to 0).
    """
    classIdx: int
    subclass: int          # 0-9, defaults to 5 when missing
    lumClass: int          # 0-9 or 255
    isWhiteDwarf: bool


def _lookup_lum_class(window: str) -> int:
    upper = window.upper()
    for pat, lc in _LUM_PREFIXES:
        if pat.search(upper):
            return lc
    return 255


def parse_spectral_type(raw: str | None) -> ParsedSpect | None:
    """Minimal SIMBAD/MK parser sufficient to look up a mass table.
    Handles the same surface shapes catalog-pure.ts.classifyFromSimbad
    handles — plain MK ("G2V"), white dwarfs ("DA1.9"), subdwarfs
    ("sdB"), Yerkes ("dM4.0", "gK0"), carbon/S/WR ("C5,2e", "WN5"). For
    composite Am/Ap tags (k/h/m) and chemical peculiarities the parser
    intentionally stops at the first MK body — mass estimates don't
    need to disambiguate composite-type discrepancies.
    """
    if not raw:
        return None
    s = re.sub(r"\s+", "", raw)
    if not s:
        return None

    # White-dwarf prefix: D + one or more subtype letters + optional digit.
    wd_match = re.match(r"^D[ABCOHQXZV]+(?:\d(?:\.\d)?)?", s)
    if wd_match:
        return ParsedSpect(classIdx=8, subclass=5, lumClass=0, isWhiteDwarf=True)

    # Yerkes lowercase prefix: d=dwarf (V), g=giant (III).
    yerkes = re.match(r"^([dg])([OBAFGKM])(\d(?:\.\d)?)?", s)
    if yerkes:
        cls = _CLASS_IDX[yerkes.group(2)]
        sub = int(yerkes.group(3).split(".")[0]) if yerkes.group(3) else 5
        return ParsedSpect(
            classIdx=cls, subclass=sub,
            lumClass=4 if yerkes.group(1) == "g" else 2,
            isWhiteDwarf=False,
        )

    # Subdwarf: "sdB5", "sdO".
    sd = re.match(r"^sd([OBAFGKM])(\d(?:\.\d)?)?", s)
    if sd:
        cls = _CLASS_IDX[sd.group(1)]
        sub = int(sd.group(2).split(".")[0]) if sd.group(2) else 5
        return ParsedSpect(classIdx=cls, subclass=sub, lumClass=1, isWhiteDwarf=False)

    # Strip a leading composite k/h/m tag so "kA5hA8mF1(III)" lands on
    # the m-body ("F1") for the first-letter gate below; per Pecaut &
    # Mamajek the metallic-line type is closest to the effective
    # surface temperature.
    composite_iter = list(re.finditer(r"([khm])([OBAFGKM])(\d(?:\.\d)?)?", s))
    if composite_iter:
        m_body = h_body = k_body = ""
        m_end = 0
        for cm in composite_iter:
            body = cm.group(2) + (cm.group(3) or "")
            if cm.group(1) == "m":
                m_body = body
            elif cm.group(1) == "h":
                h_body = body
            else:
                k_body = body
            m_end = cm.end()
        body = m_body or h_body or k_body
        lum_window = s[m_end:].lstrip("(")
    else:
        body = s
        lum_window = ""

    first = body[:1].upper()
    if first not in _CLASS_IDX:
        return None
    cls = _CLASS_IDX[first]

    # Subclass digit — integer part of an optionally-fractional digit.
    sub_match = re.match(r"^(\d)(?:\.\d)?", body[1:])
    subclass = int(sub_match.group(1)) if sub_match else 5
    after_sub = 1 + (len(sub_match.group(0)) if sub_match else 0)

    # Carbon / S / WR: classIdx=7, no Roman lum class to resolve.
    if cls == 7:
        return ParsedSpect(classIdx=7, subclass=subclass, lumClass=255, isWhiteDwarf=False)

    if not lum_window:
        lum_window = body[after_sub:]
    return ParsedSpect(
        classIdx=cls, subclass=subclass,
        lumClass=_lookup_lum_class(lum_window),
        isWhiteDwarf=False,
    )


# ─── Mass tables ─────────────────────────────────────────────────────


# Each row is mass (M_sun) at subclass 0,1,...,9 for that spectral
# class — entries cover Cox 2000 §15.2 / Pecaut & Mamajek 2013 with
# linear interpolation between published anchors. Rows are indexed by
# class index (0=O .. 6=M). Class 7 (C/S/WR) and 8 (unknown) fall back
# to a single representative mass at the bottom.
#
# Main-sequence (V) anchors — Pecaut & Mamajek 2013, Table 5, with the
# Cox high-mass O/B end ramping to canonical zero-age MS values.
_MS_MASS: tuple[tuple[float, ...], ...] = (
    # O0 .. O9
    (60.0, 50.0, 40.0, 32.0, 28.0, 25.0, 22.0, 20.0, 18.0, 17.0),
    # B0 .. B9
    (17.0, 13.0, 9.0, 7.0, 6.5, 5.9, 4.5, 3.8, 3.3, 3.0),
    # A0 .. A9
    (2.9, 2.6, 2.4, 2.2, 2.1, 2.0, 1.85, 1.75, 1.65, 1.55),
    # F0 .. F9
    (1.6, 1.55, 1.5, 1.46, 1.42, 1.4, 1.3, 1.2, 1.12, 1.07),
    # G0 .. G9
    (1.05, 1.02, 1.0, 0.98, 0.96, 0.95, 0.92, 0.88, 0.83, 0.80),
    # K0 .. K9
    (0.80, 0.76, 0.72, 0.70, 0.68, 0.65, 0.58, 0.54, 0.50, 0.48),
    # M0 .. M9
    (0.50, 0.42, 0.36, 0.32, 0.28, 0.20, 0.13, 0.09, 0.07, 0.05),
)


# Giant (III) anchors — Cox 2000 Table 15.7; less subclass dependence
# than MS so the rows are flatter.
_III_MASS: tuple[tuple[float, ...], ...] = (
    (40.0,) * 10,                                      # O III — extrapolated
    (15.0, 13.0, 11.0, 9.0, 8.0, 7.0, 6.5, 6.0, 5.5, 5.0),     # B III
    (4.0, 3.8, 3.5, 3.2, 3.0, 2.8, 2.6, 2.4, 2.3, 2.2),         # A III
    (2.2, 2.1, 2.0, 1.9, 1.8, 1.8, 1.7, 1.6, 1.6, 1.6),         # F III
    (2.5, 2.3, 2.1, 2.0, 1.9, 1.9, 1.8, 1.7, 1.6, 1.6),         # G III
    (1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.4, 1.4, 1.4, 1.4),         # K III
    (1.5, 1.4, 1.4, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3),         # M III
)


# Subgiant (IV) is structurally between MS and III on the HRD; we
# interpolate per-class with a small bias toward III since subgiants
# are post-MS and slightly more evolved.
def _iv_mass(class_idx: int, sub: int) -> float:
    a = _MS_MASS[class_idx][sub]
    b = _III_MASS[class_idx][sub]
    return 0.55 * b + 0.45 * a


# Supergiant (I, Ia, Iab, Ib) — Cox 2000 Table 15.7. Masses are much
# larger and span a wider range; we approximate Ia ~ Iab ~ Ib with one
# row since the per-luminosity-tier resolution doesn't beat the input
# spectral-type granularity.
_I_MASS: tuple[tuple[float, ...], ...] = (
    (70.0, 60.0, 50.0, 45.0, 40.0, 35.0, 32.0, 30.0, 28.0, 27.0),   # O I
    (25.0, 22.0, 20.0, 18.0, 16.0, 14.0, 13.0, 12.0, 11.0, 10.0),   # B I
    (16.0, 15.0, 14.0, 13.0, 12.0, 12.0, 11.0, 11.0, 10.0, 10.0),   # A I
    (12.0, 12.0, 12.0, 12.0, 12.0, 12.0, 12.0, 12.0, 12.0, 12.0),   # F I
    (12.0, 12.0, 13.0, 13.0, 13.0, 13.0, 14.0, 14.0, 14.0, 14.0),   # G I
    (14.0, 14.0, 14.0, 14.0, 14.0, 14.0, 15.0, 15.0, 15.0, 15.0),   # K I
    (16.0, 16.0, 16.0, 16.0, 17.0, 17.0, 17.0, 17.0, 18.0, 18.0),   # M I
)


# Mean solar-neighbourhood WD mass (Kepler+ 2007, Kilic+ 2020). True
# range is 0.3 - 1.4; without a cooling-track model we cannot do
# better from sp_type alone.
WD_MASS_DEFAULT = 0.6


# Single representative mass for class index 7 (carbon / S / WR) and
# unparseable class 8 — these are uncommon in the WDS pair set and
# the q estimate is intended as a coarse improvement on q=None, not
# a precise per-system mass.
CARBON_WR_MASS_DEFAULT = 3.0


def mass_from_spectral_class(spect_str: str | None, absmag: float | None) -> float | None:
    """Estimate stellar mass in solar masses from a SIMBAD/MK spectral
    string. Returns ``None`` when the string is unparseable or empty.

    ``absmag`` is accepted for forward-compatibility (mass-luminosity
    relations needing it can land later) but the current table is
    spectral-class-only — the WD branch ignores ``absmag`` deliberately
    (cooling-track mass refinement deferred). The argument is therefore
    optional and unused today; callers may pass ``None``.
    """
    _ = absmag  # reserved; see docstring
    parsed = parse_spectral_type(spect_str)
    if parsed is None:
        return None
    if parsed.isWhiteDwarf:
        return WD_MASS_DEFAULT
    if parsed.classIdx == 7:
        return CARBON_WR_MASS_DEFAULT
    if parsed.classIdx == 8:
        return None
    sub = max(0, min(9, parsed.subclass))
    lc = parsed.lumClass
    if lc == 0:
        return WD_MASS_DEFAULT
    if lc == 4 or lc == 5:
        return _III_MASS[parsed.classIdx][sub]
    if lc == 3:
        return _iv_mass(parsed.classIdx, sub)
    if lc in (6, 7, 8, 9):
        return _I_MASS[parsed.classIdx][sub]
    return _MS_MASS[parsed.classIdx][sub]


def mass_ratio_from_components(
    primary_spect: str | None,
    primary_absmag: float | None,
    secondary_spect: str | None,
    secondary_absmag: float | None,
) -> float | None:
    """q = M_secondary / (M_primary + M_secondary). Returns ``None`` if
    either component's spectral string is unparseable (or yields class
    index 8 / no mass). Both components are passed through the same
    helper so a future ``absmag``-aware refinement applies symmetrically.
    """
    m_a = mass_from_spectral_class(primary_spect, primary_absmag)
    m_b = mass_from_spectral_class(secondary_spect, secondary_absmag)
    if m_a is None or m_b is None or (m_a + m_b) <= 0.0:
        return None
    return m_b / (m_a + m_b)
