#!/usr/bin/env python3
"""Catalogue builder for the source-ID-anchored binary-system pipeline — Stages 1-7.

Stage 1 (``stellata-dch.27``) loads every reference catalog the resolution
chain needs (WDS + ORB6 + AT-HYG + GCVS + CCDM + HIP2 + Gaia HIP/Tyc
cross-walks + Gaia NSS + Gaia 5p astrometry) and builds the identifier
indices that Stages 2-7 consume.

Stage 2 (``stellata-dch.28`` + ``.60``) resolves each WDS component to a
Gaia DR3 ``source_id`` via the cascade canonicalised in
``RESOLVE_VIA_VALUES``:

* ``orb6_hip`` — primary's ORB6-published HIP → Gaia HIP xwalk.
* ``athyg_gaia_native`` — AT-HYG's natively-stored ``gaia`` field
  reached either through the same HIP or, in a later pass, via a 2″
  position match against the WDS precise coordinates.
* ``simbad_xid`` (``stellata-dch.60``) — SIMBAD's curated
  ``WDS J<id><comp>`` ↔ Gaia DR3 cross-IDs read from the committed
  ``data/simbad_wds_xids.tsv`` side-file (refresh script
  ``scripts/refresh-simbad-wds-xids.py``). Per-component resolution
  with reliable coverage of the well-known hard cases.
* ``position_pm`` / ``position_nopm`` — PM-propagated and bare
  position match against ``data/gaia_dr3_astrometry.tsv``. Stubbed
  (placeholder tier names; ``stellata-dch.29`` lands the data file
  but the cascade hand-off for these tiers is future work).

Stage 3 (``stellata-dch.30``) attaches the most-trustworthy astrometric
measurement to each resolved component, routing between Gaia DR3 5p,
Gaia NSS-systemic, and Hipparcos-2 long-baseline solutions:

* ``gaia_nss_systemic`` — source has an NSS two-body-orbit row AND the
  5p solution is flagged unreliable (``ruwe > 1.4`` OR
  ``ipd_frac_multi_peak > 0.02``). Gaia DR3 refits ``gaia_source`` to
  the centre-of-mass for NSS-modeled sources, so the same row's values
  surface with this routing tag distinguishing provenance for Stage 4.
* ``hip2_long_baseline`` — the WDS pair has a close companion (min
  ρ across all pair rows the source participates in is ≤ 5″) AND
  ``|pmRA_gaia − pmRA_hip2| > 50 mas/yr`` OR ``|pmDE_gaia − pmDE_hip2|
  > 50 mas/yr``. Hipparcos's J1991.25-anchored long baseline averages
  a different window of the orbit than Gaia's 2014-2017 window; for
  bright close binaries (Sirius, α Cen, Castor) the long-baseline PM
  is closer to the systemic motion of the centre of mass.
* ``gaia_5p`` — default.

Stage 4 (``stellata-dch.31``) picks orbital elements per WDS pair from
Gaia NSS two-body orbits or ORB6, preferring NSS inside Gaia's
astrometric-detectability regime (P < ~3 yr OR a < 1″). ORB6 grades
1-5 own the visual-orbit fallback; ORB6 grades 8-9 own the
spectroscopic-only fallback. The Thiele-Innes → Campbell algebra
(Heintz 1978 / Halbwachs+ 2023 Appendix B) is implemented in-repo
rather than via ESA NSSTools — the dependency is unmaintained and the
algebra is ~10 lines. Returns ``(orbit_dict, orbit_via)`` per pair via
``select_orbit``; ``orbit_via`` ∈ ``{gaia_nss, orb6, orb6_spectroscopic,
none}``.

Stage 2 emits ``data/gaia_astrometry_source_id_request.tsv`` (the deduped
union of every Gaia source_id Stage 2 resolved, across every tier), which
``scripts/refresh-gaia-astrometry.py`` (dch.29) reads to drive its ADQL
query.

Stage 5 (``stellata-dch.32``) classifies each WDS pair as physical or
optical via a 5-tier ID-anchored cascade: WDS Notes flag chars (T/V/Z
keep, S/U/X/Y reject) → both-Gaia gate (parallax 3σ + per-axis PM
≤5 mas/yr) → asymmetric-Gaia gate (Gaia primary + HIP2-anchored
secondary, or vice versa; catches Sirius A-C/D/E/F directly) →
orbit-on-file override (Stage 4 selected real orbital elements, so
the pair is empirically bound; rescues WD-companion pairs like
Sirius A-B that mag-gap alone would reject) → mag-gap heuristic
backstop (|Δmag| ≤ 5 keep).

Stage 6 (``stellata-dch.32``) emits ``data/multiples.tsv`` — two rows
per kept pair, columns per ``MULTIPLES_TSV_COLUMNS`` (system_id,
component, hip / gaia_source_id, ICRS x/y/z parsec position, AT-HYG
photometric / spectral metadata, orbital elements from Stage 4,
resolve / astrometry / orbit provenance tags). Phase 3's v6 binary
writer is the consumer.

Stage 7 (``stellata-dch.32``) flattens per-strategy + per-tier counters
into ``scripts/build-binaries-expected.json`` for ``stellata-dch.39``
(Phase 4 Tier B) to gate population statistical bounds against.
Refresh deliberately with ``UPDATE_BUILD_COUNTS=1``.

Run via ``npm run build:binaries`` (or directly: ``python3
scripts/build-binaries.py``). Idempotent against ``data/multiples.tsv``;
pass ``--force`` to ignore the mtime check and reload everything.

See the parent epic ``stellata-dch`` for the seven-stage architecture.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SCRIPT = Path(__file__).resolve()

sys.path.insert(0, str(SCRIPT.parent))
from refresh_lib import (  # noqa: E402
    athyg_int_or_none,
    athyg_str_or_none,
    is_up_to_date,
)

SRC_WDS_SUMM = DATA / "wds_summ.txt"
SRC_ORB6 = DATA / "orb6_orbits.txt"
SRC_ATHYG = DATA / "athyg_33_classic_ids.csv"
SRC_GCVS = DATA / "gcvs5.txt"
SRC_GCVS_CROSSID = DATA / "crossid.txt"
SRC_CCDM = DATA / "hip_ccdm.tsv"
SRC_HIP2 = DATA / "hip2_van_leeuwen.tsv"
SRC_GAIA_HIP_XM = DATA / "gaia_dr3_hip_xmatch.tsv"
SRC_GAIA_TYC_XM = DATA / "gaia_dr3_tyc_xmatch.tsv"
SRC_GAIA_NSS = DATA / "gaia_dr3_nss_two_body.tsv"
SRC_GAIA_ASTROMETRY = DATA / "gaia_dr3_astrometry.tsv"
SRC_SIMBAD_WDS_XIDS = DATA / "simbad_wds_xids.tsv"

OUT_MULTIPLES = DATA / "multiples.tsv"
OUT_ASTROMETRY_REQUEST = DATA / "gaia_astrometry_source_id_request.tsv"

# Committed snapshot of per-strategy / per-tier counts emitted at the
# end of every build. ``stellata-dch.39`` (Phase 4 Tier B) will pin
# bounds against this file from the TS side. The Python comparator
# below mirrors ``build-catalog.ts``'s ``assertOrUpdateBuildCounts``
# flow — refresh deliberately with ``UPDATE_BUILD_COUNTS=1``.
EXPECTED_COUNTS = SCRIPT.parent / "build-binaries-expected.json"

# Expected fraction of AT-HYG rows that carry a Gaia DR3 source_id. AT-HYG
# documentation reports ~98% coverage (the remainder are bright stars Gaia
# saturated or systems Gaia could not detect). Coverage outside this band
# signals an input drift worth flagging at build time.
ATHYG_GAIA_COVERAGE_BOUNDS = (0.90, 1.00)

# Strict priority order Stage 2 attempts for every WDS component. The
# log line and unit tests both read from this tuple so adding a tier or
# renaming one only edits the canonical list. Order is significant —
# earlier strategies win when more than one would succeed.
RESOLVE_VIA_VALUES: tuple[str, ...] = (
    "orb6_hip",
    "athyg_gaia_native",
    "simbad_xid",
    "position_pm",
    "position_nopm",
    "unresolved",
)

# Strict priority lookup keyed off ``RESOLVE_VIA_VALUES``. Lower index =
# stronger evidence. Consumed by ``propagate_within_system`` to pick the
# canonical tag when multiple pair rows resolve the same component
# letter through different tiers.
RESOLVE_VIA_PRIORITY: dict[str, int] = {
    tag: i for i, tag in enumerate(RESOLVE_VIA_VALUES)
}

# ─── Parsing primitives ──────────────────────────────────────────────


def safe_float(s: str) -> float | None:
    s = s.strip()
    if not s or s == ".":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def safe_int(s: str) -> int | None:
    s = s.strip()
    if not s or s == ".":
        return None
    try:
        return int(s)
    except ValueError:
        return None


# ─── AT-HYG ──────────────────────────────────────────────────────────


@dataclass
class AthygRow:
    """Subset of the AT-HYG v3.3 classic-IDs CSV the binary pipeline reads.

    All three classical identifiers are surfaced — ``hip``, ``tyc``,
    ``gaia`` — so Stage 2 can resolve a WDS / GCVS component through any
    available channel before falling back to position-match.
    """

    hip: int | None
    tyc: str | None       # Tycho-2 designation, e.g. "4669-731-1"
    gaia: int | None      # Gaia DR3 source_id
    hd: int | None
    ra_deg: float
    dec_deg: float
    x_pc: float
    y_pc: float
    z_pc: float
    dist_pc: float
    v_mag: float | None
    absmag: float
    ci: float | None
    spect: str
    proper: str


def parse_athyg(path: Path) -> list[AthygRow]:
    """Parse the AT-HYG v3.3 classic-IDs CSV. ValueError on a per-row
    cell (e.g. dirty positional data) drops just that row; KeyError on
    a missing required column propagates — a header rename is a fatal
    misconfiguration, not per-row dirty data, and the build must fail
    loudly rather than silently return ``loaded 0 AT-HYG rows``.

    Classical identifier cells (hip / tyc / gaia / hd) are read through
    ``refresh_lib.athyg_int_or_none`` / ``athyg_str_or_none`` so the
    AT-HYG "'' or '0' = missing" sentinel collapses to None at the
    boundary; downstream indices keyed on these ids never see a 0.
    """
    rows: list[AthygRow] = []
    with path.open(newline="") as fh:
        reader = csv.DictReader(fh)
        for r in reader:
            try:
                ra_h = float(r["ra"])     # AT-HYG stores RA in hours
                dec_d = float(r["dec"])
                x = float(r["x0"])
                y = float(r["y0"])
                z = float(r["z0"])
                dist = float(r["dist"])
            except ValueError:
                continue
            absmag = safe_float(r.get("absmag") or "")
            if absmag is None:
                continue
            rows.append(AthygRow(
                hip=athyg_int_or_none(r.get("hip")),
                tyc=athyg_str_or_none(r.get("tyc")),
                gaia=athyg_int_or_none(r.get("gaia")),
                hd=athyg_int_or_none(r.get("hd")),
                ra_deg=ra_h * 15.0,
                dec_deg=dec_d,
                x_pc=x, y_pc=y, z_pc=z,
                dist_pc=dist,
                v_mag=safe_float(r.get("mag") or ""),
                absmag=absmag,
                ci=safe_float(r.get("ci") or ""),
                spect=(r.get("spect") or "").strip(),
                proper=(r.get("proper") or "").strip(),
            ))
    return rows


# ─── WDS summary ─────────────────────────────────────────────────────


@dataclass
class WdsPair:
    wds_id: str           # "HHMMm±DDMM" 10-char positional anchor
    discoverer: str       # e.g. "STF  202", "BU  860"
    components: str       # e.g. "AB", "AC", "Aa,Ab"; "" for the system-level row
    date_last: int | None
    rho_last: float | None       # arcsec
    theta_last: float | None     # degrees east of north
    mag_pri: float | None
    mag_sec: float | None
    spectral: str
    notes: str            # 4-char flag block (cols 107-110)
    precise_ra_deg: float | None
    precise_dec_deg: float | None


_WDS_HEADER_RE = re.compile(r"^[A-Za-z<]")


def _parse_wds_precise_coord(s: str) -> tuple[float, float] | None:
    """``HHMMSS.SS[+-]DDMMSS.S`` (cols 113-130) → (RA°, Dec°)."""
    s = s.strip()
    if len(s) < 17:
        return None
    try:
        ra_h = int(s[0:2])
        ra_m = int(s[2:4])
        ra_s = float(s[4:9])
        sign = -1 if s[9] == "-" else 1
        dec_d = int(s[10:12])
        dec_m = int(s[12:14])
        dec_s = float(s[14:])
    except (ValueError, IndexError):
        return None
    ra_deg = (ra_h + ra_m / 60.0 + ra_s / 3600.0) * 15.0
    dec_deg = sign * (dec_d + dec_m / 60.0 + dec_s / 3600.0)
    return ra_deg, dec_deg


def parse_wds_summ(path: Path) -> list[WdsPair]:
    pairs: list[WdsPair] = []
    with path.open(errors="replace") as fh:
        for line in fh:
            line = line.rstrip("\r\n")
            if not line or len(line) < 22 or _WDS_HEADER_RE.match(line):
                continue
            try:
                int(line[0:5])    # WDS rows always start HHMMm — 5 digits
            except ValueError:
                continue
            wds_id = line[0:10].strip()
            discoverer = line[10:17].strip()
            if not wds_id or not discoverer:
                continue
            line = line.ljust(130)
            precise = _parse_wds_precise_coord(line[112:130])
            pairs.append(WdsPair(
                wds_id=wds_id,
                discoverer=discoverer,
                components=line[17:22].strip(),
                date_last=safe_int(line[28:32]),
                theta_last=safe_float(line[42:45]),
                rho_last=safe_float(line[52:57]),
                mag_pri=safe_float(line[58:63]),
                mag_sec=safe_float(line[64:69]),
                spectral=line[70:79].strip(),
                notes=line[107:111],
                precise_ra_deg=precise[0] if precise else None,
                precise_dec_deg=precise[1] if precise else None,
            ))
    return pairs


# ─── ORB6 ────────────────────────────────────────────────────────────


@dataclass
class Orb6Entry:
    """Sixth Catalog of Orbits row. Unit columns are kept verbatim — Stage 4
    (orbit picking) normalises them to canonical units (yr, arcsec, JD)."""

    wds_id: str
    discoverer: str
    components: str
    hd: int | None
    hip: int | None
    P_val: float | None     # period
    P_unit: str
    a_val: float | None     # semi-major axis
    a_unit: str
    i_deg: float | None
    Omega_deg: float | None
    omega_deg: float | None
    e: float | None
    T0_val: float | None
    T0_unit: str
    grade: int              # 1=definitive..5=indeterminate; 8/9 are spectroscopic/astrometric
    ref: str


_ORB6_COMPONENTS_RE = re.compile(r"([A-Za-z][A-Za-z\d,\-]*)$")


def parse_orb6(path: Path) -> list[Orb6Entry]:
    """Returns one entry per orbit row. Multiple fits per system are
    possible (different grades / refs); Stage 4 tie-breaks."""
    out: list[Orb6Entry] = []
    with path.open(errors="replace") as fh:
        for raw in fh:
            line = raw.rstrip("\r\n")
            if not line or len(line) < 30:
                continue
            head = line[0:9].strip()
            if not head or not head[0].isdigit():
                continue       # title + numeric-ruler banner lines (1-4)
            line = line.ljust(264)
            wds_id = line[19:29].strip()
            if not wds_id:
                continue
            disc_field = line[30:44]
            # Component designator (Aa,Ab / AB / B,C) is appended to the
            # discoverer field for some rows but absent for the majority.
            # Stage 4 orbit-picking treats the empty string as "system-
            # level / pair-default"; do not skip these rows at load time.
            m = _ORB6_COMPONENTS_RE.search(disc_field.rstrip())
            components = m.group(1) if m else ""
            grade_str = line[233:234].strip()
            out.append(Orb6Entry(
                wds_id=wds_id,
                discoverer=disc_field.strip(),
                components=components,
                hd=safe_int(line[51:57]),
                hip=safe_int(line[58:64]),
                P_val=safe_float(line[81:92]),
                P_unit=line[92:93].strip(),
                a_val=safe_float(line[105:114]),
                a_unit=line[114:115].strip(),
                i_deg=safe_float(line[125:133]),
                Omega_deg=safe_float(line[143:151]),
                omega_deg=safe_float(line[205:213]),
                e=safe_float(line[187:195]),
                T0_val=safe_float(line[162:174]),
                T0_unit=line[174:175].strip(),
                grade=int(grade_str) if grade_str.isdigit() else 5,
                ref=line[237:245].strip(),
            ))
    return out


# ─── GCVS ────────────────────────────────────────────────────────────


@dataclass
class GcvsRow:
    """One row of ``gcvs5.txt`` (main variable-star catalog).

    Only the fields Stage 5 (intrinsic-variability cross-match) actually
    needs are pinned here; type / period / amplitude parsing live in
    ``scripts/catalog-pure.ts`` for the TS-side consumer and need not be
    duplicated for Stage 1's load-and-count.
    """

    gcvs_id: str
    designation: str
    var_type: str
    max_mag: str        # raw string; uncertainty markers stripped at use-site
    min_mag: str


def parse_gcvs(path: Path) -> list[GcvsRow]:
    """Pipe-delimited records, skip VizieR header (`#...`) + sep/dash rows."""
    rows: list[GcvsRow] = []
    with path.open(errors="replace") as fh:
        for line in fh:
            if not line or line.startswith("#") or line.startswith("---"):
                continue
            parts = line.split("|")
            if len(parts) < 6:
                continue
            gcvs_id = parts[0].strip()
            if not gcvs_id.isdigit():
                continue
            rows.append(GcvsRow(
                gcvs_id=gcvs_id,
                designation=parts[1].strip(),
                var_type=parts[3].strip(),
                max_mag=parts[4].strip(),
                min_mag=parts[5].strip(),
            ))
    return rows


def parse_gcvs_crossid(path: Path) -> dict[str, list[str]]:
    """``crossid.txt`` → ``{gcvs_designation: [external IDs]}``.

    External IDs are the second pipe field; their format is heterogeneous
    (HIP / HD / Tycho / ADS / Stellarium etc.). Stage 5 parses out the HIP
    tokens when cross-matching GCVS rows to AT-HYG / Gaia.
    """
    out: dict[str, list[str]] = {}
    with path.open(errors="replace") as fh:
        for line in fh:
            if not line or line.startswith("#") or line.startswith("---"):
                continue
            if not line.startswith("GCVS"):
                continue
            parts = line.split("|")
            if len(parts) < 2:
                continue
            designation = parts[0][4:].strip()
            ext_id = parts[1].strip().lstrip("=").strip()
            if not designation or not ext_id:
                continue
            out.setdefault(designation, []).append(ext_id)
    return out


# ─── CCDM ────────────────────────────────────────────────────────────


@dataclass
class CcdmRow:
    hip: int
    ccdm: str           # may be empty for non-multiple systems
    mult_flag: str      # blank / "O" / etc. — see Hipparcos doc


def parse_ccdm(path: Path) -> list[CcdmRow]:
    """``hip_ccdm.tsv`` (VizieR): TSV with `#` comment lines, then a three-
    line header (column names, separator spec, dashes) before the data."""
    rows: list[CcdmRow] = []
    with path.open() as fh:
        in_data = False
        for line in fh:
            if not line or line.startswith("#"):
                continue
            stripped = line.rstrip("\n")
            if not in_data:
                # Sentinel: the first row that starts with ``------`` is the
                # dash separator immediately preceding the data.
                if stripped.startswith("------"):
                    in_data = True
                continue
            parts = stripped.split("\t")
            if len(parts) < 1:
                continue
            hip = safe_int(parts[0])
            if hip is None:
                continue
            rows.append(CcdmRow(
                hip=hip,
                ccdm=(parts[1].strip() if len(parts) > 1 else ""),
                mult_flag=(parts[2].strip() if len(parts) > 2 else ""),
            ))
    return rows


# ─── HIP2 van Leeuwen ────────────────────────────────────────────────


@dataclass
class Hip2Row:
    hip: int
    ra_deg: float
    dec_deg: float
    plx_mas: float | None
    e_plx_mas: float | None
    pm_ra_masyr: float | None
    pm_de_masyr: float | None
    e_pm_ra_masyr: float | None
    e_pm_de_masyr: float | None
    goodness_of_fit: float | None
    n_transits: int | None


def parse_hip2(path: Path) -> list[Hip2Row]:
    rows: list[Hip2Row] = []
    with path.open(newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for r in reader:
            hip = safe_int(r.get("hip") or "")
            try:
                ra = float(r["ra_icrs"])
                dec = float(r["de_icrs"])
            except (KeyError, ValueError):
                continue
            if hip is None:
                continue
            rows.append(Hip2Row(
                hip=hip,
                ra_deg=ra,
                dec_deg=dec,
                plx_mas=safe_float(r.get("plx") or ""),
                e_plx_mas=safe_float(r.get("e_plx") or ""),
                pm_ra_masyr=safe_float(r.get("pm_ra") or ""),
                pm_de_masyr=safe_float(r.get("pm_de") or ""),
                e_pm_ra_masyr=safe_float(r.get("e_pm_ra") or ""),
                e_pm_de_masyr=safe_float(r.get("e_pm_de") or ""),
                goodness_of_fit=safe_float(r.get("goodness_of_fit") or ""),
                n_transits=safe_int(r.get("n_transits") or ""),
            ))
    return rows


# ─── Gaia DR3 cross-walks ────────────────────────────────────────────


def parse_gaia_hip_xmatch(path: Path) -> dict[int, int]:
    """Returns ``hip -> gaia_source_id``. Many-to-one collisions keep the
    nearest match (lowest ``angular_distance``). Rows with missing /
    malformed ``angular_distance`` are coerced to ``+inf`` so they
    cannot win the tie-break and silently displace a real match (see
    stellata-9mm.197)."""
    by_hip: dict[int, tuple[float, int]] = {}
    with path.open(newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for r in reader:
            hip = safe_int(r.get("hip") or "")
            src = safe_int(r.get("gaia_source_id") or "")
            if hip is None or src is None:
                continue
            ang = safe_float(r.get("angular_distance") or "")
            if ang is None:
                ang = float("inf")
            best = by_hip.get(hip)
            if best is None or ang < best[0]:
                by_hip[hip] = (ang, src)
    return {hip: src for hip, (_, src) in by_hip.items()}


def parse_gaia_tyc_xmatch(path: Path) -> dict[str, int]:
    """Returns ``tyc -> gaia_source_id`` (nearest match per Tycho ID).
    Same malformed-``angular_distance`` handling as
    ``parse_gaia_hip_xmatch`` (stellata-9mm.197)."""
    by_tyc: dict[str, tuple[float, int]] = {}
    with path.open(newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for r in reader:
            tyc = (r.get("tyc") or "").strip()
            src = safe_int(r.get("gaia_source_id") or "")
            if not tyc or src is None:
                continue
            ang = safe_float(r.get("angular_distance") or "")
            if ang is None:
                ang = float("inf")
            best = by_tyc.get(tyc)
            if best is None or ang < best[0]:
                by_tyc[tyc] = (ang, src)
    return {tyc: src for tyc, (_, src) in by_tyc.items()}


@dataclass
class GaiaAstrometryRow:
    """One row of ``gaia_dr3_astrometry.tsv``. Stage 3 reads the 5p
    columns plus the two quality flags (``ruwe`` and
    ``ipd_frac_multi_peak``) that gate the NSS-systemic fallback;
    Stage 5 reads the per-axis errors for the parallax-3σ /
    pm-difference both-Gaia gate, and the photometry columns for the
    mag-gap heuristic backstop."""

    source_id: int
    ra_deg: float
    dec_deg: float
    parallax_mas: float | None
    parallax_error_mas: float | None
    pmra_masyr: float | None
    pmra_error_masyr: float | None
    pmdec_masyr: float | None
    pmdec_error_masyr: float | None
    ref_epoch: float
    ruwe: float | None
    ipd_frac_multi_peak: float | None
    g_mag: float | None
    bp_mag: float | None
    rp_mag: float | None


def parse_gaia_astrometry(path: Path) -> dict[int, GaiaAstrometryRow]:
    """Returns ``source_id -> GaiaAstrometryRow``. The TSV is produced by
    ``scripts/refresh-gaia-astrometry.py`` (``stellata-dch.29``) and
    contains one row per resolved source_id in
    ``data/gaia_astrometry_source_id_request.tsv``.

    Rows missing the four mandatory positional columns (``source_id``,
    ``ra``, ``dec``, ``ref_epoch``) are skipped — those represent
    rejected ADQL records, not a parser failure.
    """
    by_src: dict[int, GaiaAstrometryRow] = {}
    with path.open(newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for r in reader:
            src = safe_int(r.get("source_id") or "")
            if src is None:
                continue
            try:
                ra = float(r["ra"])
                dec = float(r["dec"])
                ref_epoch = float(r["ref_epoch"])
            except (KeyError, ValueError):
                continue
            by_src[src] = GaiaAstrometryRow(
                source_id=src,
                ra_deg=ra,
                dec_deg=dec,
                parallax_mas=safe_float(r.get("parallax") or ""),
                parallax_error_mas=safe_float(r.get("parallax_error") or ""),
                pmra_masyr=safe_float(r.get("pmra") or ""),
                pmra_error_masyr=safe_float(r.get("pmra_error") or ""),
                pmdec_masyr=safe_float(r.get("pmdec") or ""),
                pmdec_error_masyr=safe_float(r.get("pmdec_error") or ""),
                ref_epoch=ref_epoch,
                ruwe=safe_float(r.get("ruwe") or ""),
                ipd_frac_multi_peak=safe_float(r.get("ipd_frac_multi_peak") or ""),
                g_mag=safe_float(r.get("phot_g_mean_mag") or ""),
                bp_mag=safe_float(r.get("phot_bp_mean_mag") or ""),
                rp_mag=safe_float(r.get("phot_rp_mean_mag") or ""),
            )
    return by_src


def parse_gaia_nss(path: Path) -> dict[int, dict[str, str]]:
    """Returns ``source_id -> NSS two-body row`` (raw dict per record).
    Schema is wide (28 columns) and Stage 4 reads only the orbital subset;
    handing back the raw row keeps Stage 1 schema-agnostic.
    """
    by_src: dict[int, dict[str, str]] = {}
    with path.open(newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for r in reader:
            src = safe_int(r.get("source_id") or "")
            if src is None:
                continue
            by_src[src] = dict(r)
    return by_src


# ─── SIMBAD WDS cross-IDs side-file ──────────────────────────────────


@dataclass
class SimbadWdsXid:
    """One row of ``data/simbad_wds_xids.tsv`` — SIMBAD's curated
    ``WDS J<wds_id><component>`` cross-reference. Produced by
    ``scripts/refresh-simbad-wds-xids.py``. ``gaia_source_id`` is
    ``None`` when SIMBAD resolves the component to an oid but has no
    Gaia DR3 cross-ID (α Cen A/B's saturation gap is the canonical
    case — HIP is still set, so Stage 3's HIP2 fallback can attach
    astrometry)."""

    simbad_oid: int
    simbad_main_id: str
    gaia_source_id: int | None
    hip: int | None


def parse_simbad_wds_xids(path: Path) -> dict[tuple[str, str], SimbadWdsXid]:
    """Load the SIMBAD WDS↔Gaia side-file into a
    ``(wds_id, component) -> SimbadWdsXid`` map. Stage 2's
    ``simbad_xid`` tier looks every unresolved component up in this
    map after the HIP-mediated tier-1/2 passes."""
    out: dict[tuple[str, str], SimbadWdsXid] = {}
    with path.open(newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for r in reader:
            wds_id = (r.get("wds_id") or "").strip()
            component = (r.get("component") or "").strip()
            oid = safe_int(r.get("simbad_oid") or "")
            if not wds_id or not component or oid is None:
                continue
            out[(wds_id, component)] = SimbadWdsXid(
                simbad_oid=oid,
                simbad_main_id=(r.get("simbad_main_id") or "").strip(),
                gaia_source_id=safe_int(r.get("gaia_source_id") or ""),
                hip=safe_int(r.get("hip") or ""),
            )
    return out


# ─── Identifier indices ──────────────────────────────────────────────


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


def build_indices(
    athyg: list[AthygRow],
    hip2: list[Hip2Row],
    hip_to_gaia: dict[int, int],
    tyc_to_gaia: dict[str, int],
    src_to_nss: dict[int, dict[str, str]],
    src_to_astrometry: dict[int, GaiaAstrometryRow] | None = None,
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
    )


# ─── Stage 2: WDS-component → gaia_source_id resolution ─────────────


@dataclass
class ResolvedComponent:
    """One row of Stage 2's output. ``gaia_source_id`` is ``None`` only
    when ``resolve_via == 'unresolved'``. ``hip`` is populated whenever
    a classical Hipparcos identifier is known for the component —
    either from an ORB6 entry (primary) or from a position-matched
    AT-HYG row — regardless of whether Gaia could be reached from it.
    Stage 3 reads ``hip`` for its HIP2 fallback so saturated bright
    stars (Sirius, α Cen) that have no Gaia source still attach
    astrometry.
    """

    wds_id: str
    discoverer: str
    component: str            # e.g. 'A', 'B', 'Aa', 'Ab'
    is_primary: bool
    gaia_source_id: int | None
    resolve_via: str
    hip: int | None = None


def split_components(comp_str: str) -> tuple[str, str] | None:
    """Decompose a WDS ``components`` field into (primary, secondary).

    Returns ``None`` for system-level rows (empty field) and for rows we
    cannot confidently split. Stage 2 treats ``None`` as "skip this pair"
    rather than guessing.

    The WDS convention is:

    * ``"AB"``  → ("A", "B")
    * ``"Aa,Ab"`` → ("Aa", "Ab")  — comma separates multi-character labels
    * ``"BC,D"`` → ("BC", "D")    — first part can be multi-letter

    Three-letter unbraced forms like ``"ABC"`` are ambiguous (could mean
    A vs BC, or AB vs C) and are skipped rather than partitioned wrong.
    """
    s = comp_str.strip()
    if not s:
        return None
    if "," in s:
        parts = [p.strip() for p in s.split(",") if p.strip()]
        if len(parts) == 2:
            return parts[0], parts[1]
        return None
    if len(s) == 2:
        return s[0], s[1]
    return None


def group_orb6_by_pair(
    orb6: list[Orb6Entry],
) -> dict[tuple[str, str], list[Orb6Entry]]:
    """Index ORB6 entries by ``(wds_id, components)`` so Stage 2 can fetch
    every fit for a given WDS pair in O(1).

    Components-string match is strict: ``"AB"`` and ``""`` (system-level)
    are different keys. Stage 2 only consults the entry whose components
    string exactly matches the pair it is resolving — using a system-level
    ORB6 HIP for an ``"AC"`` pair would attribute the primary's gaia
    source to the wrong component when multiple orbit fits coexist.
    """
    out: dict[tuple[str, str], list[Orb6Entry]] = {}
    for e in orb6:
        out.setdefault((e.wds_id, e.components), []).append(e)
    return out


def _gaia_from_athyg_via_hip(
    hip: int, indices: IdentifierIndices,
) -> int | None:
    """HIP-mediated AT-HYG lookup. AT-HYG's gaia field (~98% coverage) is
    broader than Gaia's HIP cross-walk because AT-HYG ingests source_ids
    through its own pipeline. When a HIP exists but Gaia's published
    xwalk misses it, AT-HYG often still carries a gaia value. Tagged
    ``athyg_gaia_native`` in ``RESOLVE_VIA_VALUES``."""
    row = indices.hip_to_athyg.get(hip)
    if row is None or row.gaia is None:
        return None
    return row.gaia


def resolve_component(
    pair: WdsPair,
    component: str,
    is_primary: bool,
    orb6_for_pair: list[Orb6Entry],
    indices: IdentifierIndices,
) -> ResolvedComponent:
    """Resolve a single WDS component to a Gaia DR3 source_id via the
    HIP-anchored cascade prefix (``orb6_hip`` → ``athyg_gaia_native``
    HIP-mediated). Returns an ``unresolved`` record when neither fires;
    ``resolve_via_simbad`` and ``resolve_via_position`` then take
    successive swings before the cascade falls through.

    Secondary components have no direct ORB6 signal (ORB6 publishes one
    HIP per orbit row, which by convention is the primary's), so
    ``orb6_hip`` only applies to primaries.
    """
    def emit(gaia: int | None, via: str, hip: int | None) -> ResolvedComponent:
        return ResolvedComponent(
            wds_id=pair.wds_id,
            discoverer=pair.discoverer,
            component=component,
            is_primary=is_primary,
            gaia_source_id=gaia,
            resolve_via=via,
            hip=hip,
        )

    candidate_hips: list[int] = []

    if is_primary:
        for e in orb6_for_pair:
            if e.hip is None:
                continue
            candidate_hips.append(e.hip)
            # ``orb6_hip``: Gaia-published HIP xwalk is the canonical source.
            gaia = indices.hip_to_gaia.get(e.hip)
            if gaia is not None:
                return emit(gaia, "orb6_hip", e.hip)

    for hip in candidate_hips:
        gaia = _gaia_from_athyg_via_hip(hip, indices)
        if gaia is not None:
            return emit(gaia, "athyg_gaia_native", hip)

    # HIP-anchored prefix missed. Keep the first ORB6-published HIP (if
    # any) so Stage 3's HIP2 fallback can still attach astrometry for
    # stars Gaia couldn't observe — Sirius / α Cen-shaped saturated
    # primaries.
    return emit(None, "unresolved", candidate_hips[0] if candidate_hips else None)


# ─── SIMBAD-backed cross-ID path ─────────────────────────────────────


def resolve_via_simbad(
    components: list[ResolvedComponent],
    simbad_xids: dict[tuple[str, str], SimbadWdsXid],
) -> None:
    """Cascade pass following ``resolve_component`` and preceding
    ``resolve_via_position``. For every component still unresolved by
    the HIP-anchored prefix, look up ``(wds_id, component)`` in the
    SIMBAD WDS↔Gaia side-file and bind whichever cross-IDs SIMBAD
    carries. Mutates ``components`` in place.

    Binding rules:

    * SIMBAD has a Gaia DR3 source_id → set ``gaia_source_id``,
      rewrite ``resolve_via`` to ``simbad_xid``, and fill ``hip`` if
      SIMBAD has one and the component doesn't yet.
    * SIMBAD has a HIP but no Gaia (α Cen A/B-shaped saturation gap) →
      fill ``hip`` only; leave ``gaia_source_id`` ``None`` and
      ``resolve_via`` ``unresolved`` so Stage 3's HIP2 long-baseline
      fallback can route on the freshly-bound HIP.
    * SIMBAD doesn't have the component → leave it alone.

    Suffixed-HIP forms in SIMBAD (``HIP 55203A``) are filtered out by
    the refresh script (see ``refresh-simbad-wds-xids.py``); only
    plain-integer HIPs reach this map, so no ambiguity-handling is
    needed here.
    """
    for c in components:
        if c.gaia_source_id is not None:
            continue
        xid = simbad_xids.get((c.wds_id, c.component))
        if xid is None:
            continue
        if xid.gaia_source_id is not None:
            c.gaia_source_id = xid.gaia_source_id
            c.resolve_via = "simbad_xid"
            if c.hip is None and xid.hip is not None:
                c.hip = xid.hip
        elif xid.hip is not None and c.hip is None:
            c.hip = xid.hip


# ─── Position-match path ─────────────────────────────────────────────


# Position-match tolerance for the AT-HYG position branch. 2″ matches
# the bead's stated bar and is well below the typical AT-HYG inter-
# source separation away from the densest clusters. High-PM stars may
# miss at this tolerance — that's intentional; the ``position_pm``
# (PM-propagated match against Gaia astrometry, stubbed until a future
# bead lands) is the principled fix for the PM-driven epoch-residual
# class.
ATHYG_POSITION_MATCH_TOLERANCE_ARCSEC = 2.0


def _spherical_to_unit_vec(ra_deg: float, dec_deg: float) -> tuple[float, float, float]:
    """ICRS spherical (degrees) → unit vector on the celestial sphere.
    Chord distance squared between two such vectors is monotone with
    angular separation, so the squared dot/chord forms can be compared
    directly without trig in the hot loop.
    """
    ra_rad = math.radians(ra_deg)
    dec_rad = math.radians(dec_deg)
    c = math.cos(dec_rad)
    return c * math.cos(ra_rad), c * math.sin(ra_rad), math.sin(dec_rad)


def build_athyg_position_grid(
    athyg: list[AthygRow],
) -> dict[tuple[int, int], list[int]]:
    """Bucket AT-HYG rows by ``(int(ra_deg) % 360, int(dec_deg) + 90)`` —
    1°×1° cells with the dec axis shifted into ``[0, 180)`` so the key is
    always non-negative. Cell occupancy averages ~5 rows; the query walks
    a 3-cell-tall dec strip whose ra width is widened by ``1/cos(dec)``
    so the search radius stays consistent at high declinations.
    """
    grid: dict[tuple[int, int], list[int]] = {}
    for i, row in enumerate(athyg):
        key = (int(row.ra_deg) % 360, int(row.dec_deg) + 90)
        grid.setdefault(key, []).append(i)
    return grid


def find_nearest_athyg_at_position(
    ra_deg: float,
    dec_deg: float,
    grid: dict[tuple[int, int], list[int]],
    athyg: list[AthygRow],
    tol_arcsec: float,
    exclude_idx: int | None = None,
) -> int | None:
    """Return the AT-HYG list index nearest to ``(ra_deg, dec_deg)`` within
    ``tol_arcsec`` (or ``None`` if no row is within tolerance).

    ``exclude_idx`` skips a known row — used when matching a secondary
    component so the primary's own AT-HYG row cannot win.
    """
    cos_dec = max(math.cos(math.radians(dec_deg)), 1e-3)
    ra_window = max(1, int(math.ceil(1.0 / cos_dec)))
    base_ra = int(ra_deg) % 360
    base_dec = int(dec_deg) + 90
    qx, qy, qz = _spherical_to_unit_vec(ra_deg, dec_deg)
    threshold_chord_sq = (2.0 * math.sin(math.radians(tol_arcsec / 3600.0) / 2.0)) ** 2

    best_idx: int | None = None
    best_chord_sq = float("inf")
    for ddec in (-1, 0, 1):
        dec_key = base_dec + ddec
        for dra in range(-ra_window, ra_window + 1):
            ra_key = (base_ra + dra) % 360
            for i in grid.get((ra_key, dec_key), ()):
                if i == exclude_idx:
                    continue
                rx, ry, rz = _spherical_to_unit_vec(
                    athyg[i].ra_deg, athyg[i].dec_deg,
                )
                dx = rx - qx
                dy = ry - qy
                dz = rz - qz
                d_sq = dx * dx + dy * dy + dz * dz
                if d_sq < best_chord_sq:
                    best_chord_sq = d_sq
                    best_idx = i
    if best_idx is None or best_chord_sq > threshold_chord_sq:
        return None
    return best_idx


def predict_secondary_position(
    primary_ra_deg: float,
    primary_dec_deg: float,
    rho_arcsec: float,
    theta_deg: float,
) -> tuple[float, float]:
    """Offset a primary's ICRS position by the WDS (ρ, θ) pair last-seen
    relative motion — θ measured east of north, ρ in arcseconds. The
    small-offset approximation is fine at WDS separations (<1000″ for
    the vast majority of pairs); larger separations are rare and the
    secondary is usually individually catalogued in AT-HYG.
    """
    theta_rad = math.radians(theta_deg)
    rho_deg = rho_arcsec / 3600.0
    new_dec = primary_dec_deg + rho_deg * math.cos(theta_rad)
    cos_dec = max(math.cos(math.radians(primary_dec_deg)), 1e-3)
    new_ra = (primary_ra_deg + (rho_deg * math.sin(theta_rad)) / cos_dec) % 360.0
    return new_ra, new_dec


def build_pair_by_wds_disc(
    pairs: list[WdsPair],
) -> dict[tuple[str, str], list[WdsPair]]:
    """Bucket WDS pairs by ``(wds_id, discoverer)`` — the canonical
    component-letter-to-pair lookup key. For typical WDS_SUMM data each
    bucket holds one pair, so per-component lookup via
    ``find_owning_pair`` is O(1) in practice.
    """
    out: dict[tuple[str, str], list[WdsPair]] = {}
    for p in pairs:
        out.setdefault((p.wds_id, p.discoverer), []).append(p)
    return out


def find_owning_pair(
    c: ResolvedComponent,
    pair_by_wds_disc: dict[tuple[str, str], list[WdsPair]],
) -> WdsPair | None:
    """Resolve a component back to the WDS pair whose components-string
    decomposition assigns this letter to the matching primary/secondary
    slot. Returns ``None`` if no such pair exists in the index.
    """
    slot = 0 if c.is_primary else 1
    for p in pair_by_wds_disc.get((c.wds_id, c.discoverer), ()):
        split = split_components(p.components)
        if split is not None and split[slot] == c.component:
            return p
    return None


def resolve_via_position(
    components: list[ResolvedComponent],
    pairs: list[WdsPair],
    athyg: list[AthygRow],
    tolerance_arcsec: float = ATHYG_POSITION_MATCH_TOLERANCE_ARCSEC,
) -> None:
    """Cascade pass following ``resolve_via_simbad``. For components
    still unresolved after the HIP-anchored prefix and the SIMBAD-backed
    cross-ID pass, position-matches WDS precise coordinates into AT-HYG
    and reads the resulting row's natively-stored gaia field. Mutates
    ``components`` in place — sets ``gaia_source_id`` and rewrites
    ``resolve_via`` from ``unresolved`` to ``athyg_gaia_native`` on hit.

    Primary uses the WDS pair's ``precise_ra/dec``; secondary uses that
    plus the pair's last-reported ``(ρ, θ)`` offset, EXCLUDING the
    primary's matched row so a close-binary primary cannot claim its own
    secondary slot. Components without precise coords (or, for
    secondaries, without ρ/θ) stay unresolved here.
    """
    grid = build_athyg_position_grid(athyg)
    pair_by_wds_disc = build_pair_by_wds_disc(pairs)

    # Pass 1 — primaries. Cache the AT-HYG row each primary claims so
    # the secondary pass can exclude it (close-binary primaries must not
    # be matched twice for both slots of the same pair).
    primary_athyg_idx: dict[tuple[str, str, str], int] = {}
    for c in components:
        if c.gaia_source_id is not None or not c.is_primary:
            continue
        pair = find_owning_pair(c, pair_by_wds_disc)
        if pair is None or pair.precise_ra_deg is None or pair.precise_dec_deg is None:
            continue
        match_idx = find_nearest_athyg_at_position(
            pair.precise_ra_deg, pair.precise_dec_deg,
            grid, athyg, tolerance_arcsec,
        )
        if match_idx is None:
            continue
        row = athyg[match_idx]
        primary_athyg_idx[(c.wds_id, c.discoverer, pair.components)] = match_idx
        if c.hip is None and row.hip is not None:
            c.hip = row.hip
        if row.gaia is not None:
            c.gaia_source_id = row.gaia
            c.resolve_via = "athyg_gaia_native"

    # Pass 2 — secondaries. Predict position from primary + (ρ, θ),
    # exclude the primary's AT-HYG row.
    for c in components:
        if c.gaia_source_id is not None or c.is_primary:
            continue
        pair = find_owning_pair(c, pair_by_wds_disc)
        if (
            pair is None
            or pair.precise_ra_deg is None
            or pair.precise_dec_deg is None
            or pair.rho_last is None
            or pair.theta_last is None
        ):
            continue
        secondary_ra, secondary_dec = predict_secondary_position(
            pair.precise_ra_deg, pair.precise_dec_deg,
            pair.rho_last, pair.theta_last,
        )
        primary_idx = primary_athyg_idx.get(
            (c.wds_id, c.discoverer, pair.components),
        )
        match_idx = find_nearest_athyg_at_position(
            secondary_ra, secondary_dec,
            grid, athyg, tolerance_arcsec, exclude_idx=primary_idx,
        )
        if match_idx is None:
            continue
        row = athyg[match_idx]
        if c.hip is None and row.hip is not None:
            c.hip = row.hip
        if row.gaia is not None:
            c.gaia_source_id = row.gaia
            c.resolve_via = "athyg_gaia_native"


def resolve_all_pairs(
    pairs: list[WdsPair],
    orb6: list[Orb6Entry],
    indices: IdentifierIndices,
    athyg: list[AthygRow],
    simbad_xids: dict[tuple[str, str], SimbadWdsXid] | None = None,
    position_tolerance_arcsec: float = ATHYG_POSITION_MATCH_TOLERANCE_ARCSEC,
) -> list[ResolvedComponent]:
    """Run Stage 2's full resolution chain over every WDS pair that
    decomposes into two components. System-level rows (empty
    ``components``) and rows we cannot split are skipped. Cascade
    strategies and order are canonicalised in ``RESOLVE_VIA_VALUES``.

    1. ``resolve_component`` runs the HIP-anchored prefix:
       ``orb6_hip`` (primary's ORB6 HIP → Gaia xwalk) then
       ``athyg_gaia_native`` (HIP-mediated AT-HYG lookup).
    2. ``resolve_via_simbad`` runs the SIMBAD-backed cross-ID pass
       against the committed ``data/simbad_wds_xids.tsv`` side-file —
       tagged ``simbad_xid``. Skipped when ``simbad_xids`` is empty /
       absent (the in-process tests pass ``None``).
    3. ``resolve_via_position`` runs the AT-HYG position-match pass —
       tagged ``athyg_gaia_native`` (the same tag as branch 1's
       HIP-mediated AT-HYG read because both routes land on AT-HYG's
       natively-stored gaia field; the ``position_pm`` /
       ``position_nopm`` tags are reserved for a future PM-propagated
       match against ``data/gaia_dr3_astrometry.tsv``).
    4. ``propagate_within_system`` copies a resolved letter binding
       (and any HIP it carries) across every pair row that shares the
       same ``(wds_id, letter)``.
    """
    orb6_by_pair = group_orb6_by_pair(orb6)
    out: list[ResolvedComponent] = []
    for pair in pairs:
        split = split_components(pair.components)
        if split is None:
            continue
        primary, secondary = split
        orb6_for_pair = orb6_by_pair.get((pair.wds_id, pair.components), [])
        out.append(resolve_component(
            pair, primary, is_primary=True,
            orb6_for_pair=orb6_for_pair, indices=indices,
        ))
        out.append(resolve_component(
            pair, secondary, is_primary=False,
            orb6_for_pair=orb6_for_pair, indices=indices,
        ))
    if simbad_xids:
        resolve_via_simbad(components=out, simbad_xids=simbad_xids)
    resolve_via_position(
        components=out, pairs=pairs, athyg=athyg,
        tolerance_arcsec=position_tolerance_arcsec,
    )
    propagate_within_system(out)
    return out


def propagate_within_system(components: list[ResolvedComponent]) -> None:
    """Within each WDS system, the same component letter always refers
    to the same physical star (e.g. component A of WDS 00491+5749 is η
    Cas A whether it appears in the AB, AC, AD, …, AH pair rows). When
    one pair's A primary resolves but the other A primaries can't
    (their pair has no ORB6 entry and the WDS precise coord drift
    exceeds the 2″ position tolerance), this pass copies the resolved
    binding forward. The inherited ``resolve_via`` classification is
    preserved so the per-tier counts log the strategy that actually
    fetched the source_id, not a synthetic propagation tag.

    When more than one pair row in the same system resolves the
    same letter through different strategies (e.g. one A hits
    ``orb6_hip`` while another A hits ``simbad_xid``), the canonical
    binding is the highest-priority tag per ``RESOLVE_VIA_PRIORITY``,
    not whichever happened to iterate first. The underlying
    ``gaia_source_id`` is identical either way — same letter / same
    physical star — only the tag the cascade counter sees differs.

    HIP propagation runs alongside source_id propagation but is
    independent: a saturated bright primary (Sirius / α Cen) has no
    Gaia source_id to propagate but still surfaces its HIP across
    every pair row in the system so Stage 3's HIP2 fallback engages
    consistently across the wide companions too. No priority ordering
    exists across HIP sources, so first-write-wins is correct.
    """
    by_system_letter: dict[tuple[str, str], tuple[int, str]] = {}
    hip_by_system_letter: dict[tuple[str, str], int] = {}
    for c in components:
        key = (c.wds_id, c.component)
        if c.gaia_source_id is not None:
            cur = by_system_letter.get(key)
            if cur is None or RESOLVE_VIA_PRIORITY[c.resolve_via] < RESOLVE_VIA_PRIORITY[cur[1]]:
                by_system_letter[key] = (c.gaia_source_id, c.resolve_via)
        if c.hip is not None:
            hip_by_system_letter.setdefault(key, c.hip)
    for c in components:
        key = (c.wds_id, c.component)
        if c.gaia_source_id is None:
            binding = by_system_letter.get(key)
            if binding is not None:
                c.gaia_source_id, c.resolve_via = binding
        if c.hip is None:
            hip = hip_by_system_letter.get(key)
            if hip is not None:
                c.hip = hip


def resolution_counts(
    components: list[ResolvedComponent],
) -> dict[str, int]:
    """Per-strategy counters in canonical ``RESOLVE_VIA_VALUES`` order.
    Every key present so the log line shape stays stable across runs."""
    counts: dict[str, int] = {k: 0 for k in RESOLVE_VIA_VALUES}
    for c in components:
        counts[c.resolve_via] = counts.get(c.resolve_via, 0) + 1
    return counts


def write_astrometry_request(
    components: list[ResolvedComponent], path: Path,
) -> int:
    """Emit the deduped union of every Gaia source_id Stage 2 resolved,
    across every tier in ``RESOLVE_VIA_VALUES``.

    ``stellata-dch.29`` (``scripts/refresh-gaia-astrometry.py``) reads
    this file to drive its ADQL ``WHERE source_id IN (...)`` query — so
    Stage 3 onward has 5-parameter Gaia astrometry for exactly the
    sources we resolved here.
    """
    ids = sorted({c.gaia_source_id for c in components if c.gaia_source_id is not None})
    with path.open("w") as fh:
        fh.write("gaia_source_id\n")
        for sid in ids:
            fh.write(f"{sid}\n")
    return len(ids)


# ─── Stage 3: per-component astrometry attachment ────────────────────


# Routing tags Stage 3 may emit for any component, in priority order.
# `astrometry_counts` and the canonical build-time log line read from
# this tuple so renaming a route only edits one place.
ASTROMETRY_VIA_VALUES: tuple[str, ...] = (
    "gaia_nss_systemic",
    "hip2_long_baseline",
    "gaia_5p",
    "unresolved",
)

# Gaia DR3 5p reliability thresholds. The NSS-systemic route engages
# only when the 5p solution shows orbit-corrupted fit indicators, so a
# clean 5p with an NSS row alongside still uses the 5p directly.
GAIA_RUWE_UNRELIABLE_THRESHOLD = 1.4
GAIA_IPD_FRAC_MULTI_PEAK_THRESHOLD = 0.02

# HIP2 long-baseline fallback thresholds. The separation gate is
# checked against the *minimum* WDS ρ across all pair rows the source
# participates in (a star in both a tight AB and a wide AC pair counts
# as close), not the current pair row's ρ in isolation. Stars Gaia
# could not observe (saturated bright primaries like Sirius / α Cen)
# bypass both gates entirely — they take the no-Gaia HIP2 branch
# below, where HIP2 is the only available astrometry by construction.
HIP2_COMPANION_SEPARATION_ARCSEC = 5.0
HIP2_PM_DELTA_THRESHOLD_MASYR = 50.0


@dataclass
class ComponentAstrometry:
    """Per-component astrometric payload, parallel to ``ResolvedComponent``.
    ``astrometry_via`` is always set; the remaining fields are ``None``
    when the route is ``"unresolved"`` (component had no gaia_source_id,
    or its source_id was not covered by ``gaia_dr3_astrometry.tsv``).

    ``ref_epoch`` is the native catalog epoch — Gaia DR3 J2016.0 for
    the Gaia routes, J1991.25 for hip2_long_baseline. Downstream
    propagation to J2000 happens at multiples.tsv emit time so we
    don't drop information here.
    """

    astrometry_via: str
    ra_deg: float | None
    dec_deg: float | None
    parallax_mas: float | None
    pmra_masyr: float | None
    pmdec_masyr: float | None
    ref_epoch: float | None


# Hipparcos-2 reference epoch (van Leeuwen 2007 reduction). Stored at
# module scope so the HIP2 branch and downstream J2000 propagation
# both pull from the same constant.
HIP2_REF_EPOCH = 1991.25


def _from_gaia(row: GaiaAstrometryRow, via: str) -> ComponentAstrometry:
    return ComponentAstrometry(
        astrometry_via=via,
        ra_deg=row.ra_deg,
        dec_deg=row.dec_deg,
        parallax_mas=row.parallax_mas,
        pmra_masyr=row.pmra_masyr,
        pmdec_masyr=row.pmdec_masyr,
        ref_epoch=row.ref_epoch,
    )


def _unresolved_astrometry() -> ComponentAstrometry:
    return ComponentAstrometry(
        astrometry_via="unresolved",
        ra_deg=None, dec_deg=None,
        parallax_mas=None,
        pmra_masyr=None, pmdec_masyr=None,
        ref_epoch=None,
    )


def gaia_5p_unreliable(row: GaiaAstrometryRow) -> bool:
    """The 5p fit shows orbit-corrupted indicators. Either gate alone
    is sufficient — ruwe captures residual normalised to per-transit
    error, ipd_frac_multi_peak captures contaminated-image detections
    on a different sample of the same Gaia transits.
    """
    if (
        row.ruwe is not None
        and row.ruwe > GAIA_RUWE_UNRELIABLE_THRESHOLD
    ):
        return True
    if (
        row.ipd_frac_multi_peak is not None
        and row.ipd_frac_multi_peak > GAIA_IPD_FRAC_MULTI_PEAK_THRESHOLD
    ):
        return True
    return False


def _hip2_pm_disagrees(
    gaia: GaiaAstrometryRow, hip2: Hip2Row,
) -> bool:
    """``|Δ pmRA| > 50 mas/yr`` OR ``|Δ pmDE| > 50 mas/yr``. Either
    axis alone trips the fallback — orbit contamination doesn't have
    to show on both axes simultaneously to flag the 5p PM as suspect.
    Returns ``False`` when either input is missing a PM value (no
    comparison possible).
    """
    if (
        gaia.pmra_masyr is None
        or gaia.pmdec_masyr is None
        or hip2.pm_ra_masyr is None
        or hip2.pm_de_masyr is None
    ):
        return False
    if abs(gaia.pmra_masyr - hip2.pm_ra_masyr) > HIP2_PM_DELTA_THRESHOLD_MASYR:
        return True
    if abs(gaia.pmdec_masyr - hip2.pm_de_masyr) > HIP2_PM_DELTA_THRESHOLD_MASYR:
        return True
    return False


def _from_hip2(hip2: Hip2Row) -> ComponentAstrometry:
    return ComponentAstrometry(
        astrometry_via="hip2_long_baseline",
        ra_deg=hip2.ra_deg,
        dec_deg=hip2.dec_deg,
        parallax_mas=hip2.plx_mas,
        pmra_masyr=hip2.pm_ra_masyr,
        pmdec_masyr=hip2.pm_de_masyr,
        ref_epoch=HIP2_REF_EPOCH,
    )


def _component_hip(
    component: ResolvedComponent, indices: IdentifierIndices,
) -> int | None:
    """The HIP for this component if known. Prefers ``component.hip``
    (set by Stage 2 from ORB6 / AT-HYG), falls back to inverting the
    Gaia HIP cross-walk via the component's resolved Gaia source_id.
    """
    if component.hip is not None:
        return component.hip
    if component.gaia_source_id is None:
        return None
    return indices.src_to_hip.get(component.gaia_source_id)


def attach_astrometry(
    component: ResolvedComponent,
    min_rho_arcsec: float | None,
    indices: IdentifierIndices,
) -> ComponentAstrometry:
    """Route to the most-trustworthy astrometric measurement for a
    single resolved component. Priority order:

    1. ``gaia_nss_systemic`` — Gaia astrometry exists, source has an
       NSS row, AND the 5p solution is flagged unreliable (``ruwe >
       1.4`` OR ``ipd_frac_multi_peak > 0.02``). Gaia DR3 refits
       ``gaia_source`` to the centre-of-mass for NSS-modeled sources,
       so the same row's values surface here with the NSS tag
       distinguishing provenance for Stage 4 (which prefers NSS
       orbital elements over ORB6 for these sources).
    2. ``hip2_long_baseline`` (Gaia-vs-HIP2 disagreement) — the system
       has a known companion within 5″ (``min_rho_arcsec ≤ 5.0``) AND
       ``|Δ pmRA| > 50 mas/yr`` OR ``|Δ pmDE| > 50 mas/yr`` between
       Gaia and HIP2. Hipparcos's J1991.25-anchored measurement
       averages a different window of the orbit than Gaia's 2014-2017
       window; for bright close binaries with both available, HIP2 is
       closer to the systemic motion of the centre of mass.
    3. ``gaia_5p`` — default.
    4. ``hip2_long_baseline`` (Gaia-saturated fallback) — no Gaia
       source resolved at all but a HIP is known and HIP2 covers it.
       Sirius / α Cen / Algol / Procyon-shaped bright primaries Gaia
       saturated out of its catalog get astrometry from HIP2 because
       it's the only measurement available.

    ``min_rho_arcsec`` is the minimum WDS ρ across every pair row this
    source_id participates in. A star in both a tight AB pair and a
    wide AC pair takes the tight ρ — the same physical star always
    gets the same routing across all its system rows.

    Returns ``ComponentAstrometry`` tagged ``"unresolved"`` (all
    values ``None``) when neither a Gaia astrometry row nor a HIP2
    row can be reached — Stage 5 can still emit the row with whatever
    upstream signals exist.
    """
    gaia = (
        indices.src_to_astrometry.get(component.gaia_source_id)
        if component.gaia_source_id is not None
        else None
    )

    if gaia is None:
        # No Gaia astrometry — try HIP2 directly. Bright saturated
        # stars never get past this branch.
        hip = _component_hip(component, indices)
        if hip is not None:
            hip2 = indices.hip_to_hip2.get(hip)
            if hip2 is not None:
                return _from_hip2(hip2)
        return _unresolved_astrometry()

    has_nss = component.gaia_source_id in indices.src_to_nss
    if has_nss and gaia_5p_unreliable(gaia):
        return _from_gaia(gaia, "gaia_nss_systemic")

    if (
        min_rho_arcsec is not None
        and min_rho_arcsec <= HIP2_COMPANION_SEPARATION_ARCSEC
    ):
        hip = _component_hip(component, indices)
        if hip is not None:
            hip2 = indices.hip_to_hip2.get(hip)
            if hip2 is not None and _hip2_pm_disagrees(gaia, hip2):
                return _from_hip2(hip2)

    return _from_gaia(gaia, "gaia_5p")


def compute_min_rho_per_source(
    components: list[ResolvedComponent],
    pair_by_wds_disc: dict[tuple[str, str], list[WdsPair]],
) -> dict[int, float]:
    """Smallest WDS ρ across every pair row each gaia_source_id appears
    in. The HIP2 5″ gate runs against this per-source minimum so a
    physical star whose system has any close pair always routes
    consistently across the system's wider pair rows.
    """
    out: dict[int, float] = {}
    for c in components:
        if c.gaia_source_id is None:
            continue
        pair = find_owning_pair(c, pair_by_wds_disc)
        if pair is None or pair.rho_last is None:
            continue
        prev = out.get(c.gaia_source_id)
        if prev is None or pair.rho_last < prev:
            out[c.gaia_source_id] = pair.rho_last
    return out


def attach_astrometry_all(
    components: list[ResolvedComponent],
    pairs: list[WdsPair],
    indices: IdentifierIndices,
) -> list[ComponentAstrometry]:
    """Route astrometry for every component. The returned list is
    parallel to ``components`` (same order, same length) so Stage 4-7
    can zip the two together. The HIP2 5″ gate uses the per-source
    min ρ (see ``compute_min_rho_per_source``) rather than the current
    pair row's ρ in isolation.
    """
    pair_by_wds_disc = build_pair_by_wds_disc(pairs)
    min_rho = compute_min_rho_per_source(components, pair_by_wds_disc)
    return [
        attach_astrometry(
            c,
            min_rho.get(c.gaia_source_id) if c.gaia_source_id is not None else None,
            indices,
        )
        for c in components
    ]


def astrometry_counts(
    astrometry: list[ComponentAstrometry],
) -> dict[str, int]:
    """Per-route counters in canonical ``ASTROMETRY_VIA_VALUES`` order.
    Every key is present (zero-filled) so the log line shape stays
    stable across runs."""
    counts: dict[str, int] = {k: 0 for k in ASTROMETRY_VIA_VALUES}
    for a in astrometry:
        counts[a.astrometry_via] = counts.get(a.astrometry_via, 0) + 1
    return counts


# ─── Stage 4: orbital-element selection ──────────────────────────────


# Routing tags Stage 4 may emit per WDS pair, in priority order. The
# log line and unit tests both read from this tuple so renaming a route
# only edits one place.
ORBIT_VIA_VALUES: tuple[str, ...] = (
    "gaia_nss",
    "orb6",
    "orb6_spectroscopic",
    "none",
)

# NSS-vs-ORB6 routing gate. NSS wins whenever (any component carries an
# NSS row) AND (period < ~3 yr OR apparent angular semi-major axis <
# 1″). The OR is non-exclusive: a long-period system Gaia detected with
# a sub-arcsec photocentre orbit still routes to NSS. 95.8% of DR3 NSS
# rows have P < 3 yr — the threshold is conservative against the bulk
# of the catalog. The few longer-period rows (P up to ~27 yr) are
# captured by the sub-arcsec gate when their TI algebra resolves a < 1″.
NSS_PERIOD_THRESHOLD_DAYS = 3.0 * 365.25
NSS_SEPARATION_THRESHOLD_MAS = 1000.0

# Gaia DR3 reference epoch J2016.0 as JD. NSS stores t_periastron in
# days from this epoch — Stage 4 converts to absolute JD for parity
# with ORB6's T0 column.
GAIA_DR3_REF_EPOCH_JD = 2457389.0

# Reference epoch J2000.0 as JD (for the ORB6 'y' = Julian-year T0 code).
J2000_REF_EPOCH_JD = 2451545.0

# Modified Julian Date offset (ORB6 T0_unit='m').
MJD_TO_JD_OFFSET = 2400000.5

# NSS solution types whose Thiele-Innes constants encode the full
# orbital geometry (A,B,F,G populated in 100% of rows per the dch.25
# probe). The TI → Campbell algebra recovers a (mas), i (rad), Ω (rad),
# ω (rad); the stored inclination / arg_periastron columns are null
# for these rows.
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
# defaults for these axes (mirrors how Regime-3 ORB6 entries were
# handled in dch.8).
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
# (definitive → indeterminate); 8 = interferometric / astrometric with
# no visual coverage; 9 = spectroscopic. Visual grades own the
# ``orb6`` route; 8/9 own ``orb6_spectroscopic``. Grade-7 entries
# (rare; preliminary / problematic) fall through both gates and become
# ``orbit_via=none`` rather than picking up a default that misleads
# downstream consumers.
ORB6_VISUAL_GRADES: frozenset[int] = frozenset({1, 2, 3, 4, 5})
ORB6_SPECTROSCOPIC_GRADES: frozenset[int] = frozenset({8, 9})


@dataclass
class OrbitElements:
    """Canonical per-system orbital-element payload — the v5 schema
    populated since dch.7 + dch.8. Mirrors the runtime units that
    ``binary-orbit-pure.ts`` consumes (days / JD / radians) so Stage 6's
    multiples.tsv writer + Phase 3's v6-binary writer can serialise
    without per-consumer unit conversion.

    Fields are ``None`` when the underlying solution doesn't constrain
    them. The ``orb6_spectroscopic`` route from dch.8's Regime 3
    historically filled ``i`` with a conventional default at the
    renderer; Stage 4 keeps the underdetermination explicit here and
    leaves the convention to the downstream consumer.
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
      a/i/Ω/ω from A,B,F,G via Heintz 1978 algebra. ``a`` requires a
      system parallax to convert mas → AU; if ``plx_mas`` is ``None``
      or non-positive, ``a_AU`` is left ``None`` but the angles still
      populate.
    * Eclipsing (``EclipsingBinary``, ``EclipsingSpectro``) — read
      inclination + arg_periastron from the stored columns; eclipse
      photometry doesn't constrain ``a`` or ``Ω``. ``EclipsingSpectro``
      also carries spectroscopic ``mass_ratio``.
    * Spectroscopic-only (``SB1``, ``SB2``, ``SB1C``, ``SB2C``) — read
      arg_periastron when stored; inclination is unrecoverable from
      RV alone. SB2 / SB2C variants carry ``mass_ratio`` (the SB2C set
      is the "compact" variant — period/T/e only — and is intentionally
      passed through without geometry).

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
    q: float | None = safe_float(nss_row.get("mass_ratio", ""))

    if soln in NSS_TI_DERIVED_SOLUTION_TYPES:
        A = safe_float(nss_row.get("a_thiele_innes", ""))
        B = safe_float(nss_row.get("b_thiele_innes", ""))
        F = safe_float(nss_row.get("f_thiele_innes", ""))
        G = safe_float(nss_row.get("g_thiele_innes", ""))
        if A is not None and B is not None and F is not None and G is not None:
            camp = _thiele_innes_to_campbell(A, B, F, G)
            if camp is not None:
                a_mas, i_rad, Omega_rad, omega_rad = camp
                if plx_mas is not None and plx_mas > 0.0:
                    a_AU = a_mas / plx_mas
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


def _nss_apparent_a_mas(nss_row: dict[str, str]) -> float | None:
    """Apparent angular semi-major axis in mas for the regime gate. TI-
    derived only — eclipsing / SB types don't constrain spatial scale
    so they get gated on period alone.
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
    """``period < 3 yr`` OR ``a < 1″``. Either gate alone is sufficient.
    If neither quantity is computable (P missing AND no TI), the row is
    treated as out-of-regime — the caller falls through to ORB6.
    """
    P_days = safe_float(nss_row.get("period", ""))
    if P_days is not None and P_days < NSS_PERIOD_THRESHOLD_DAYS:
        return True
    a_mas = _nss_apparent_a_mas(nss_row)
    if a_mas is not None and a_mas < NSS_SEPARATION_THRESHOLD_MAS:
        return True
    return False


def _orb6_period_days(entry: Orb6Entry) -> float | None:
    """Normalise ORB6's ``P_val`` to days. Returns ``None`` for unknown
    or garbage unit codes (rare; ~3 rows of 4,054 use stray digits from
    fixed-format misalignment per the dch.25 probe — those rows are
    skipped rather than guessed)."""
    if entry.P_val is None:
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
    """Normalise ORB6's ``T0_val`` + ``T0_unit`` to absolute JD. Unit
    codes: ``y`` = Julian year (modern ORB6 convention; converts via
    J2000 anchor + 365.25-d year), ``d`` = JD outright, ``m`` = MJD.
    Other codes are rare and skipped (``None``)."""
    if entry.T0_val is None:
        return None
    unit = entry.T0_unit
    if unit == "y":
        return J2000_REF_EPOCH_JD + (entry.T0_val - 2000.0) * 365.25
    if unit == "d":
        return entry.T0_val
    if unit == "m":
        return entry.T0_val + MJD_TO_JD_OFFSET
    return None


def orb6_to_canonical_elements(
    entry: Orb6Entry, plx_mas: float | None,
) -> OrbitElements | None:
    """ORB6 row → canonical ``OrbitElements``. Returns ``None`` only
    when the period unit is unparseable; an unparseable T0 or a
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
        if a.parallax_mas is not None and a.parallax_mas > 0.0:
            return a.parallax_mas
    return None


def select_orbit(
    primary: ResolvedComponent,
    secondary: ResolvedComponent,
    primary_astrometry: ComponentAstrometry,
    secondary_astrometry: ComponentAstrometry,
    orb6_for_pair: list[Orb6Entry],
    indices: IdentifierIndices,
) -> tuple[OrbitElements | None, str]:
    """Priority cascade per WDS pair:

    1. ``gaia_nss`` — any component has an NSS two-body row AND the
       solution falls inside Gaia's astrometric-detectability regime
       (P < ~3 yr OR a < 1″). Primary's NSS row preferred when both
       components have one (secondary is rarely the catalogued
       systemic source).
    2. ``orb6`` — ORB6 visual orbit (grade ∈ {1..5}). Grade tiebreak;
       ref-year secondary tiebreak.
    3. ``orb6_spectroscopic`` — ORB6 spectroscopic / astrometric-only
       (grade ∈ {8,9}). Same tiebreaks.
    4. ``none`` — visual-only pair with no orbital information on file.

    The two ``ComponentAstrometry`` arguments are required (not
    optional) so the parallax-needed conversions (NSS a_mas → AU; ORB6
    a_unit='a'/'m' → AU) always have a value to consult, even when only
    one of the two components has 5p astrometry attached.
    """
    plx_mas = _system_parallax_mas([primary_astrometry, secondary_astrometry])

    # NSS branch — primary then secondary.
    for comp in (primary, secondary):
        if comp.gaia_source_id is None:
            continue
        nss_row = indices.src_to_nss.get(comp.gaia_source_id)
        if nss_row is None:
            continue
        if not _nss_in_regime(nss_row):
            continue
        orbit = nss_to_canonical_elements(nss_row, plx_mas)
        if orbit is not None:
            return orbit, "gaia_nss"

    # ORB6 visual branch.
    visual = [e for e in orb6_for_pair if e.grade in ORB6_VISUAL_GRADES]
    if visual:
        best = _pick_best_orb6(visual)
        orbit = orb6_to_canonical_elements(best, plx_mas)
        if orbit is not None:
            return orbit, "orb6"

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
    i = 0
    for pair in pairs:
        if split_components(pair.components) is None:
            continue
        if i + 1 >= len(components):
            raise RuntimeError(
                "Stage 4 cursor exhausted before pairs did — Stage 2 "
                "output truncated"
            )
        c1 = components[i]
        c2 = components[i + 1]
        if c1.wds_id != pair.wds_id or c2.wds_id != pair.wds_id:
            raise RuntimeError(
                f"Stage 4 cursor desync at pair {pair.wds_id}/{pair.components}"
                f": got components {c1.wds_id} + {c2.wds_id}"
            )
        yield pair, c1, c2, astrometry[i], astrometry[i + 1]
        i += 2


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
    out: list[tuple[OrbitElements | None, str]] = []
    for pair, p, s, p_ast, s_ast in iter_decomposing_pairs(
        pairs, components, astrometry,
    ):
        orb6_for_pair = orb6_by_pair.get((pair.wds_id, pair.components), [])
        orbit, via = select_orbit(
            primary=p, secondary=s,
            primary_astrometry=p_ast, secondary_astrometry=s_ast,
            orb6_for_pair=orb6_for_pair, indices=indices,
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
    i = 0
    j = 0
    for pair in pairs:
        if split_components(pair.components) is None:
            continue
        if i + 1 >= len(components):
            raise RuntimeError(
                "Stage 5 cursor exhausted before pairs did — Stage 2 "
                "output truncated"
            )
        p = components[i]
        s = components[i + 1]
        _, orbit_via = orbits[j]
        out.append(classify_pair_optical(pair, p, s, orbit_via, indices))
        i += 2
        j += 1
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


# ─── Stage 7: build-time stats ───────────────────────────────────────


# Environment variable that flips the counts snapshot from compare
# mode (the default) to write-or-overwrite. Shared with
# ``build-catalog.ts`` so a single refresh command updates both
# snapshots when the pipeline shifts.
UPDATE_COUNTS_ENV_VAR = "UPDATE_BUILD_COUNTS"


def build_binaries_counts(
    *,
    pairs: list[WdsPair],
    components: list[ResolvedComponent],
    astrometry: list[ComponentAstrometry],
    orbits: list[tuple[OrbitElements | None, str]],
    classifications: list[OpticalClassification],
    multiples_rows: list[MultiplesRow],
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

    out: dict[str, int] = {
        "wds_pairs_total": len(pairs),
        "decomposing_pairs": len(orbits),
        "components_total": len(components),
        "multiples_rows_emitted": len(multiples_rows),
    }
    for tag in RESOLVE_VIA_VALUES:
        out[f"resolution_{tag}"] = res[tag]
    for tag in ASTROMETRY_VIA_VALUES:
        out[f"astrometry_{tag}"] = ast[tag]
    for tag in ORBIT_VIA_VALUES:
        out[f"orbit_{tag}"] = orb[tag]
    for tag in OPTICAL_VIA_VALUES:
        out[f"optical_{tag}"] = opt[tag]
    return out


@dataclass
class CountDiff:
    """One row of the snapshot diff. ``status`` is ``"match"``,
    ``"mismatch"``, ``"missing_actual"`` (key in expected but not in
    actual), or ``"missing_expected"`` (key in actual but not in
    expected — typically a newly-introduced counter)."""

    key: str
    status: str
    expected: int | None
    actual: int | None


def compare_build_counts(
    expected: dict[str, int], actual: dict[str, int],
) -> list[CountDiff]:
    """Per-key diff between two flat count dicts. The union of keys is
    walked so newly-added or newly-removed counters surface explicitly
    rather than disappearing into the matched set."""
    out: list[CountDiff] = []
    for key in sorted(expected.keys() | actual.keys()):
        e = expected.get(key)
        a = actual.get(key)
        if key not in actual:
            out.append(CountDiff(key, "missing_actual", e, None))
        elif key not in expected:
            out.append(CountDiff(key, "missing_expected", None, a))
        elif e == a:
            out.append(CountDiff(key, "match", e, a))
        else:
            out.append(CountDiff(key, "mismatch", e, a))
    return out


def format_count_diff(diff: list[CountDiff]) -> str:
    """Pretty-printer matching ``build-counts.ts``'s ``formatCountDiff``
    shape — single match line when everything passes, otherwise the
    mismatches listed first (each with signed delta), then any new /
    removed keys."""
    mismatches = [d for d in diff if d.status == "mismatch"]
    missing_actual = [d for d in diff if d.status == "missing_actual"]
    missing_expected = [d for d in diff if d.status == "missing_expected"]
    total_diffs = len(mismatches) + len(missing_actual) + len(missing_expected)
    lines: list[str] = []
    if total_diffs == 0:
        lines.append(f"build-binaries counts: all {len(diff)} counts match")
        return "\n".join(lines)
    lines.append(
        f"build-binaries counts: {total_diffs} of {len(diff)} counts differ"
    )
    for m in mismatches:
        delta = (m.actual or 0) - (m.expected or 0)
        sign = "+" if delta > 0 else ""
        lines.append(
            f"  {m.key:<40} expected {m.expected}, got {m.actual} ({sign}{delta})"
        )
    for m in missing_actual:
        lines.append(f"  {m.key:<40} expected {m.expected}, missing in actual")
    for m in missing_expected:
        lines.append(f"  {m.key:<40} new key, got {m.actual} (no snapshot)")
    return "\n".join(lines)


def assert_or_update_counts(actual: dict[str, int], expected_path: Path) -> bool:
    """Compare ``actual`` against the committed snapshot at
    ``expected_path``. Returns ``True`` on full match, ``False``
    otherwise. Side effect: when the env var ``UPDATE_BUILD_COUNTS=1``
    is set OR the snapshot file is missing, write ``actual`` to disk
    and return ``True``.

    Mirrors ``build-catalog.ts``'s ``assertOrUpdateBuildCounts`` so a
    single ``UPDATE_BUILD_COUNTS=1`` refresh covers both the TS and
    Python sides of the pipeline.
    """
    should_update = os.environ.get(UPDATE_COUNTS_ENV_VAR) == "1"

    if should_update or not expected_path.exists():
        expected_path.write_text(json.dumps(actual, indent=2) + "\n")
        try:
            shown = expected_path.relative_to(ROOT)
        except ValueError:
            shown = expected_path
        log(
            f"{'Updated' if should_update else 'Wrote initial'} {shown}"
        )
        return True

    expected = json.loads(expected_path.read_text())
    diff = compare_build_counts(expected, actual)
    report = format_count_diff(diff)
    log(report)
    return all(d.status == "match" for d in diff)


# ─── Driver ──────────────────────────────────────────────────────────


def _iter_input_paths() -> Iterator[Path]:
    yield SCRIPT
    yield SRC_WDS_SUMM
    yield SRC_ORB6
    yield SRC_ATHYG
    yield SRC_GCVS
    yield SRC_GCVS_CROSSID
    yield SRC_CCDM
    yield SRC_HIP2
    yield SRC_GAIA_HIP_XM
    yield SRC_GAIA_TYC_XM
    yield SRC_GAIA_NSS
    yield SRC_GAIA_ASTROMETRY
    yield SRC_SIMBAD_WDS_XIDS


def log(msg: str) -> None:
    print(f"[build-binaries] {msg}")


def run(force: bool) -> int:
    if not force and OUT_MULTIPLES.exists() and is_up_to_date(
        OUT_MULTIPLES, _iter_input_paths(),
    ):
        log(
            f"{OUT_MULTIPLES.relative_to(ROOT)} up to date — skipping "
            "(use --force to rebuild)"
        )
        return 0

    log("loading reference catalogs (Stage 1) …")

    wds_pairs = parse_wds_summ(SRC_WDS_SUMM)
    log(f"loaded {len(wds_pairs):,} WDS pair rows")

    orb6 = parse_orb6(SRC_ORB6)
    log(f"loaded {len(orb6):,} ORB6 orbit rows")

    athyg = parse_athyg(SRC_ATHYG)
    n_gaia = sum(1 for r in athyg if r.gaia is not None)
    log(f"loaded {len(athyg):,} AT-HYG rows")
    coverage = n_gaia / len(athyg) if athyg else 0.0
    log(f"{n_gaia:,} / {len(athyg):,} AT-HYG rows carry gaia ({coverage:.1%})")
    lo, hi = ATHYG_GAIA_COVERAGE_BOUNDS
    if not (lo <= coverage <= hi):
        log(
            f"WARNING: AT-HYG gaia coverage {coverage:.1%} outside expected "
            f"band [{lo:.0%}, {hi:.0%}] — input drift suspected"
        )

    gcvs = parse_gcvs(SRC_GCVS)
    log(f"loaded {len(gcvs):,} GCVS variable-star rows")

    gcvs_xid = parse_gcvs_crossid(SRC_GCVS_CROSSID)
    log(
        f"loaded GCVS cross-IDs for {len(gcvs_xid):,} designations "
        f"({sum(len(v) for v in gcvs_xid.values()):,} external refs)"
    )

    ccdm = parse_ccdm(SRC_CCDM)
    log(f"loaded {len(ccdm):,} CCDM rows")

    hip2 = parse_hip2(SRC_HIP2)
    log(f"loaded {len(hip2):,} HIP2 van Leeuwen astrometry rows")

    hip_to_gaia = parse_gaia_hip_xmatch(SRC_GAIA_HIP_XM)
    log(
        f"loaded Gaia HIP xmatch; built hip -> gaia_source_id of "
        f"cardinality {len(hip_to_gaia):,}"
    )

    tyc_to_gaia = parse_gaia_tyc_xmatch(SRC_GAIA_TYC_XM)
    log(
        f"loaded Gaia Tycho xmatch; built tyc -> gaia_source_id of "
        f"cardinality {len(tyc_to_gaia):,}"
    )

    src_to_nss = parse_gaia_nss(SRC_GAIA_NSS)
    log(
        f"loaded Gaia NSS two-body; built gaia_source_id -> nss_row of "
        f"cardinality {len(src_to_nss):,}"
    )

    src_to_astrometry = parse_gaia_astrometry(SRC_GAIA_ASTROMETRY)
    log(
        f"loaded Gaia 5p astrometry for {len(src_to_astrometry):,} source_ids"
    )

    simbad_wds_xids = parse_simbad_wds_xids(SRC_SIMBAD_WDS_XIDS)
    n_simbad_gaia = sum(1 for x in simbad_wds_xids.values() if x.gaia_source_id is not None)
    n_simbad_hip = sum(1 for x in simbad_wds_xids.values() if x.hip is not None)
    log(
        f"loaded SIMBAD WDS xids for {len(simbad_wds_xids):,} components "
        f"({n_simbad_gaia:,} Gaia DR3 / {n_simbad_hip:,} HIP)"
    )

    indices = build_indices(
        athyg, hip2, hip_to_gaia, tyc_to_gaia, src_to_nss,
        src_to_astrometry=src_to_astrometry,
    )
    log(
        f"built AT-HYG identifier views: "
        f"hip -> row {len(indices.hip_to_athyg):,}, "
        f"tyc -> row {len(indices.tyc_to_athyg):,}, "
        f"gaia_source_id -> row {len(indices.src_to_athyg):,}"
    )
    log(
        f"built hip -> hip2_row of cardinality {len(indices.hip_to_hip2):,}, "
        f"gaia_source_id -> hip of cardinality {len(indices.src_to_hip):,}"
    )

    log("Stage 1 complete. Resolving WDS components (Stage 2) …")

    components = resolve_all_pairs(
        pairs=wds_pairs, orb6=orb6,
        indices=indices, athyg=athyg,
        simbad_xids=simbad_wds_xids,
    )
    counts = resolution_counts(components)
    log(
        "Resolution: "
        + ", ".join(f"{k}={counts[k]:,}" for k in RESOLVE_VIA_VALUES)
    )

    n_requested = write_astrometry_request(components, OUT_ASTROMETRY_REQUEST)
    log(
        f"wrote {OUT_ASTROMETRY_REQUEST.relative_to(ROOT)} with "
        f"{n_requested:,} unique source_ids (input for stellata-dch.29)"
    )

    log("Stage 2 complete. Attaching per-component astrometry (Stage 3) …")

    astrometry = attach_astrometry_all(
        components=components, pairs=wds_pairs, indices=indices,
    )
    a_counts = astrometry_counts(astrometry)
    log(
        "astrometry routing: "
        + ", ".join(f"{k}={a_counts[k]:,}" for k in ASTROMETRY_VIA_VALUES)
    )

    log("Stage 3 complete. Selecting per-system orbital elements (Stage 4) …")

    orbits = select_orbits_all(
        pairs=wds_pairs, components=components,
        astrometry=astrometry, orb6=orb6, indices=indices,
    )
    o_counts = orbit_counts(orbits)
    log(
        "orbits sourced: "
        + ", ".join(f"{k}={o_counts[k]:,}" for k in ORBIT_VIA_VALUES)
    )

    log("Stage 4 complete. Classifying optical-vs-physical pairs (Stage 5) …")

    classifications = classify_all_pairs(
        pairs=wds_pairs, components=components,
        orbits=orbits, indices=indices,
    )
    op_counts = optical_counts(classifications)
    log(
        "optical-pair cascade: "
        + ", ".join(f"{k}={op_counts[k]:,}" for k in OPTICAL_VIA_VALUES)
    )
    rejected = sum(
        op_counts[k] for k in OPTICAL_VIA_VALUES if k.endswith("_rejected")
    )
    total = len(classifications)
    rejected_rate = rejected / total if total else 0.0
    log(f"optical rejected rate: {rejected_rate:.1%} ({rejected:,} / {total:,})")

    log("Stage 5 complete. Emitting multiples.tsv (Stage 6) …")

    rows = build_multiples_rows(
        pairs=wds_pairs, components=components,
        astrometry=astrometry, orbits=orbits,
        classifications=classifications, indices=indices,
    )
    n_emitted = write_multiples_tsv(rows, OUT_MULTIPLES)
    log(
        f"wrote {OUT_MULTIPLES.relative_to(ROOT)} with {n_emitted:,} "
        f"component rows ({n_emitted // 2:,} physical pairs)"
    )

    log("Stage 6 complete. Comparing build counts against snapshot (Stage 7) …")

    counts = build_binaries_counts(
        pairs=wds_pairs, components=components, astrometry=astrometry,
        orbits=orbits, classifications=classifications, multiples_rows=rows,
    )
    counts_match = assert_or_update_counts(counts, EXPECTED_COUNTS)
    if not counts_match:
        log(
            f"build-binaries count assertion failed. If the change is "
            f"intentional, refresh with: "
            f"{UPDATE_COUNTS_ENV_VAR}=1 npm run build:binaries"
        )
        return 1

    log("Stage 7 complete. data/multiples.tsv ready for Phase 3 ingest.")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--force", action="store_true",
        help="ignore mtime check and reload all inputs",
    )
    args = p.parse_args()
    return run(force=args.force)


if __name__ == "__main__":
    sys.exit(main())
