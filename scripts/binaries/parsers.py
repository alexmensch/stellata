#!/usr/bin/env python3
"""Stage 1 parsers + Row dataclasses for the reference catalogs.
Per-row dirty data drops just that row; a missing required column is fatal.
"""

from __future__ import annotations

import csv
import re
import sys
from dataclasses import dataclass
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent / "refresh"))
from refresh_lib import (  # noqa: E402
    athyg_int_or_none,
    athyg_str_or_none,
)


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


# Per-parser non-null floors for headline fixed-width columns. A drop
# below the floor signals that the source catalog's column offsets have
# shifted (which has historically happened to WDS / ORB6), at which point
# every downstream stage that reads the field would silently receive
# None. Calibrated against current committed data — both fields pass at
# ~100%; the gap to 95% / 90% absorbs the small fraction of historical
# WDS / ORB6 rows that legitimately omit the field without flagging a
# legitimate build as broken.
WDS_SUMM_PRECISE_COORD_FLOOR = 0.95
ORB6_PERIOD_COVERAGE_FLOOR = 0.90


def _assert_field_coverage(
    rows: list,
    parser_name: str,
    field_name: str,
    floor: float,
) -> None:
    """Raise SystemExit when fewer than `floor` of `rows` carry a
    non-None `field_name`. Pinned at parser exit so a silent column-
    offset drift in a future WDS / ORB6 release fails the build
    immediately rather than letting every downstream stage parse all-
    None values from a misaligned field."""
    if not rows:
        return
    n_ok = sum(1 for r in rows if getattr(r, field_name) is not None)
    rate = n_ok / len(rows)
    if rate < floor:
        raise SystemExit(
            f"{parser_name}: '{field_name}' non-null rate {rate:.1%} "
            f"({n_ok:,}/{len(rows):,}) below {floor:.0%} floor — likely "
            f"a column-offset drift in the source file. Re-verify the "
            f"fixed-width layout against the parser indices."
        )


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
    # cos(dec)-applied (i.e. μ_α* = μ_α cos δ), matching the convention
    # AT-HYG inherits from Hipparcos / Gaia. Stage 2's PM-propagation
    # uses these to bring J1991.25-effective HIP-sourced rows forward
    # to the WDS precise_coord epoch before the position-match check.
    pm_ra_masyr: float | None
    pm_de_masyr: float | None


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
                pm_ra_masyr=safe_float(r.get("pm_ra") or ""),
                pm_de_masyr=safe_float(r.get("pm_dec") or ""),
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
    _assert_field_coverage(
        pairs, "parse_wds_summ", "precise_ra_deg",
        WDS_SUMM_PRECISE_COORD_FLOOR,
    )
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
    grade: int              # 1=definitive..5=indeterminate; 7/8/9 non-visual (see README § Stage 4)
    ref: str
    # ORB6's own J2000 coordinate prefix (cols 1-18, same HHMMSS.SS±DDMMSS.S
    # layout as the WDS precise coord). Position anchor for synthesized
    # sub-pairs whose wds_id has no WDS_SUMM row at all.
    precise_ra_deg: float | None = None
    precise_dec_deg: float | None = None


def parse_orb6(path: Path) -> list[Orb6Entry]:
    """Returns one entry per orbit row. Multiple fits per system are
    possible (different grades / refs); Stage 4 tie-breaks.

    Discoverer at [30:37], components at [37:44] — fixed-width per
    the ORB6 file format.
    """
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
            discoverer = line[30:37].strip()
            components = line[37:44].strip()
            grade_str = line[233:234].strip()
            precise = _parse_wds_precise_coord(line[0:18])
            out.append(Orb6Entry(
                wds_id=wds_id,
                discoverer=discoverer,
                components=components,
                precise_ra_deg=precise[0] if precise else None,
                precise_dec_deg=precise[1] if precise else None,
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
    _assert_field_coverage(
        out, "parse_orb6", "P_val", ORB6_PERIOD_COVERAGE_FLOOR,
    )
    return out


# ─── GCVS ────────────────────────────────────────────────────────────


@dataclass
class GcvsRow:
    """One row of ``gcvs5.txt`` (main variable-star catalog).

    Only the fields Stage 5 (intrinsic-variability cross-match) actually
    needs are pinned here; type / period / amplitude parsing live in
    ``scripts/catalog/catalog-pure.ts`` for the TS-side consumer and need not be
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
    cannot win the tie-break and silently displace a real match."""
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
    ``parse_gaia_hip_xmatch``."""
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
    ``scripts/refresh/refresh-gaia-astrometry.py`` and contains one row
    per resolved source_id in
    ``data/gaia/gaia_astrometry_source_id_request.tsv``.

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
    """One row of ``data/simbad/simbad_wds_xids.tsv`` — SIMBAD's curated
    ``WDS J<wds_id><component>`` cross-reference. Produced by
    ``scripts/refresh/refresh-simbad-wds-xids.py``. ``gaia_source_id`` is
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


def parse_component_sptype_overrides(path: Path) -> dict[tuple[str, str], str]:
    """Load ``data/binaries/component_sptype_overrides.tsv`` into a
    ``(wds_id, component) -> sp_type`` map. The component key is the raw
    multiples.tsv ``comp`` form (WDS-truncated: Algol's Aa1,2 secondary
    is ``"2"``). ``#``-prefixed preamble lines are skipped."""
    out: dict[tuple[str, str], str] = {}
    with path.open(newline="") as fh:
        reader = csv.DictReader(
            (line for line in fh if not line.startswith("#")), delimiter="\t",
        )
        for r in reader:
            wds_id = (r.get("wds_id") or "").strip()
            component = (r.get("component") or "").strip()
            sp_type = (r.get("sp_type") or "").strip()
            if not wds_id or not component or not sp_type:
                continue
            out[(wds_id, component)] = sp_type
    return out


def parse_orb6_component_overrides(path: Path) -> dict[tuple[str, str], str]:
    """Load ``data/binaries/orb6_component_overrides.tsv`` into a
    ``(wds_id, discoverer) -> components`` map. Curates WDS component
    letters onto ORB6 rows whose ``components`` field is blank (the
    catalog names the pair only by its variable-star designation, e.g.
    YY Gem = Castor Ca,Cb). ``#``-prefixed preamble lines are skipped."""
    out: dict[tuple[str, str], str] = {}
    with path.open(newline="") as fh:
        reader = csv.DictReader(
            (line for line in fh if not line.startswith("#")), delimiter="\t",
        )
        for r in reader:
            wds_id = (r.get("wds_id") or "").strip()
            discoverer = (r.get("discoverer") or "").strip()
            components = (r.get("components") or "").strip()
            if not wds_id or not discoverer or not components:
                continue
            out[(wds_id, discoverer)] = components
    return out


def parse_simbad_wds_spectra(
    simbad_sptype_path: Path, simbad_wds_xids_path: Path,
) -> dict[tuple[str, str], str]:
    """Join ``simbad_sptype.tsv`` against ``simbad_wds_xids.tsv`` on
    ``simbad_oid``, returning a ``(wds_id, component) -> sp_type`` map.
    See scripts/binaries/README.md § Stage 6 for the AT-HYG fallback
    contract."""
    sp_by_oid: dict[int, str] = {}
    with simbad_sptype_path.open(newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for r in reader:
            oid = safe_int(r.get("simbad_oid") or "")
            if oid is None:
                continue
            sp = (r.get("sp_type") or "").strip()
            if not sp:
                continue
            sp_by_oid[oid] = sp

    out: dict[tuple[str, str], str] = {}
    xids = parse_simbad_wds_xids(simbad_wds_xids_path)
    for (wds_id, component), xid in xids.items():
        sp = sp_by_oid.get(xid.simbad_oid)
        if sp:
            out[(wds_id, component)] = sp
    return out


