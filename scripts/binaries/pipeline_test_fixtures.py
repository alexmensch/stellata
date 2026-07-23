"""Shared unittest fixtures for the binaries per-stage test files.
Builder helpers + committed-data path constants, imported by the
``*.test.py`` siblings so no fixture logic duplicates across them."""

from __future__ import annotations

import math
from pathlib import Path

from scripts.util.paths import REPO_ROOT
from scripts.binaries.indices import (
    IdentifierIndices,
    build_indices,
)
from scripts.binaries.parsers import (
    AthygRow,
    GaiaAstrometryRow,
    Hip2Row,
    MscOrbitRow,
    MscSystemRow,
    Orb6Entry,
    WdsPair,
)
from scripts.binaries.stage2_resolve import (
    ResolvedComponent,
    split_components,
)
from scripts.binaries.stage3_astrometry import (
    ComponentAstrometry,
)

_DATA = REPO_ROOT / "data"
SRC_COMPONENT_SPTYPE_OVERRIDES = _DATA / "binaries" / "component_sptype_overrides.tsv"
SRC_ASTROMETRY_EXCLUSIONS = _DATA / "binaries" / "astrometry_exclusions.tsv"
SRC_MSC_SYSTEMS = _DATA / "msc" / "msc_systems.tsv"
SRC_MSC_ORBITS = _DATA / "msc" / "msc_orbits.tsv"

def _write(dirpath: Path, name: str, body: str) -> Path:
    p = dirpath / name
    p.write_text(body)
    return p

def _wds_line(*, with_precise: bool) -> str:
    base = (
        "00000+7530A  1248      1904 1982    5 246 235   0.8   0.6 "
        "10.27 11.5  A7IV      +034+005          +74 1056      "
    )
    if with_precise:
        return (base + "000006.64+752859.8").ljust(130)
    return base.ljust(130)  # cols 112-130 blank → precise coord is None

def _orb6_line(*, with_period: bool) -> str:
    # Real ORB6 row with a 11.06y period at cols 81:92. Blank that
    # span for the drift variant; the rest of the line is unchanged.
    line = "000233.44+184100.1 00026+1841 HDS   2Aa,Ab   .     225000    201   8.49  10.62     22.68    y   0.34       0.1106 a  0.0028   59.8      1.3     17.4       2.3     2020.967       0.074    0.6313   0.0130   302.2      3.1    2000 2023 3 n Tok2024a wds00026+1841b.png"
    if with_period:
        return line
    return line[:81] + (" " * 11) + line[92:]

def _blank_pair(
    *, wds_id: str, discoverer: str = "TST   1",
    precise_ra: float | None = None, precise_dec: float | None = None,
) -> "WdsPair":
    return WdsPair(
        wds_id=wds_id, discoverer=discoverer, components="",
        date_last=None, rho_last=None, theta_last=None,
        mag_pri=None, mag_sec=None, spectral="", notes="    ",
        precise_ra_deg=precise_ra, precise_dec_deg=precise_dec,
    )

def _athyg_row(
    *, hip: int | None = None, gaia: int | None = None,
    ra_deg: float = 0.0, dec_deg: float = 0.0,
    v_mag: float | None = None, hd: int | None = None,
) -> "AthygRow":
    return AthygRow(
        hip=hip, tyc=None, gaia=gaia, hd=hd,
        ra_deg=ra_deg, dec_deg=dec_deg,
        x_pc=0.0, y_pc=0.0, z_pc=0.0,
        dist_pc=1.0, v_mag=v_mag, absmag=5.0,
        ci=None, spect="", proper="",
        pm_ra_masyr=None, pm_de_masyr=None,
    )

def _indices(
    *,
    hip_to_gaia: dict[int, int] | None = None,
    athyg: list["AthygRow"] | None = None,
) -> "IdentifierIndices":
    return build_indices(
        athyg=athyg or [],
        hip2=[],
        hip_to_gaia=hip_to_gaia or {},
        tyc_to_gaia={},
        src_to_nss={},
    )

def _orb6(*, wds_id: str, components: str, hip: int | None) -> "Orb6Entry":
    return Orb6Entry(
        wds_id=wds_id, discoverer="TST   1", components=components,
        hd=None, hip=hip,
        P_val=None, P_unit="", a_val=None, a_unit="",
        i_deg=None, Omega_deg=None, omega_deg=None,
        e=None, T0_val=None, T0_unit="", grade=5, ref="",
    )

def _wds_pair_with_pos(
    *, wds_id: str = "14296-6241", components: str = "Ca,Cb",
    precise_ra: float | None = None, precise_dec: float | None = None,
    rho: float | None = None, theta: float | None = None,
) -> "WdsPair":
    return WdsPair(
        wds_id=wds_id, discoverer="TST   1", components=components,
        date_last=None, rho_last=rho, theta_last=theta,
        mag_pri=None, mag_sec=None, spectral="", notes="    ",
        precise_ra_deg=precise_ra, precise_dec_deg=precise_dec,
    )

def _athyg_row_at(
    *, ra: float, dec: float, gaia: int | None,
    hip: int | None = None,
    pm_ra_masyr: float | None = None,
    pm_de_masyr: float | None = None,
) -> "AthygRow":
    return AthygRow(
        hip=hip, tyc=None, gaia=gaia, hd=None,
        ra_deg=ra, dec_deg=dec,
        x_pc=0.0, y_pc=0.0, z_pc=0.0,
        dist_pc=1.0, v_mag=None, absmag=5.0,
        ci=None, spect="", proper="",
        pm_ra_masyr=pm_ra_masyr, pm_de_masyr=pm_de_masyr,
    )

def _gaia_astrometry_row(
    *,
    source_id: int = 100,
    ra_deg: float = 100.0, dec_deg: float = 0.0,
    parallax_mas: float | None = 10.0,
    parallax_error_mas: float | None = 0.05,
    pmra_masyr: float | None = 1.0,
    pmra_error_masyr: float | None = 0.05,
    pmdec_masyr: float | None = -1.0,
    pmdec_error_masyr: float | None = 0.05,
    ref_epoch: float = 2016.0,
    ruwe: float | None = 1.0,
    ipd_frac_multi_peak: float | None = 0.0,
    g_mag: float | None = None,
    bp_mag: float | None = None,
    rp_mag: float | None = None,
) -> "GaiaAstrometryRow":
    return GaiaAstrometryRow(
        source_id=source_id,
        ra_deg=ra_deg, dec_deg=dec_deg,
        parallax_mas=parallax_mas,
        parallax_error_mas=parallax_error_mas,
        pmra_masyr=pmra_masyr, pmra_error_masyr=pmra_error_masyr,
        pmdec_masyr=pmdec_masyr, pmdec_error_masyr=pmdec_error_masyr,
        ref_epoch=ref_epoch,
        ruwe=ruwe, ipd_frac_multi_peak=ipd_frac_multi_peak,
        g_mag=g_mag, bp_mag=bp_mag, rp_mag=rp_mag,
    )

def _hip2_row(
    *,
    hip: int,
    pm_ra_masyr: float | None = 1.0,
    pm_de_masyr: float | None = -1.0,
    plx_mas: float | None = 10.0,
    ra_deg: float = 100.0, dec_deg: float = 0.0,
) -> "Hip2Row":
    return Hip2Row(
        hip=hip,
        ra_deg=ra_deg, dec_deg=dec_deg,
        plx_mas=plx_mas, e_plx_mas=None,
        pm_ra_masyr=pm_ra_masyr, pm_de_masyr=pm_de_masyr,
        e_pm_ra_masyr=None, e_pm_de_masyr=None,
        goodness_of_fit=None, n_transits=None,
    )

def _resolved(
    *,
    gaia: int | None,
    wds_id: str = "WDS-1", discoverer: str = "TST   1",
    component: str = "A", is_primary: bool = True,
    via: str = "orb6_hip",
    hip: int | None = None,
    hd: int | None = None,
) -> "ResolvedComponent":
    return ResolvedComponent(
        wds_id=wds_id, discoverer=discoverer,
        component=component, is_primary=is_primary,
        gaia_source_id=gaia, resolve_via=via,
        hip=hip, hd=hd,
    )

def _indices_with_astrometry(
    *,
    src_to_astrometry: dict[int, "GaiaAstrometryRow"] | None = None,
    src_to_nss: dict[int, dict[str, str]] | None = None,
    hip_to_gaia: dict[int, int] | None = None,
    hip2: list["Hip2Row"] | None = None,
    athyg: list["AthygRow"] | None = None,
    simbad_wds_spectra: dict[tuple[str, str], str] | None = None,
) -> "IdentifierIndices":
    return build_indices(
        athyg=athyg or [], hip2=hip2 or [],
        hip_to_gaia=hip_to_gaia or {},
        tyc_to_gaia={},
        src_to_nss=src_to_nss or {},
        src_to_astrometry=src_to_astrometry or {},
        simbad_wds_spectra=simbad_wds_spectra or {},
    )

def _ti_from_campbell(
    a_mas: float, i_rad: float, Omega_rad: float, omega_rad: float,
) -> tuple[float, float, float, float]:
    """Forward Thiele-Innes from Campbell — Halbwachs+ 2023 Eq. (16)
    convention. The unit tests round-trip through ``_thiele_innes_to_
    campbell`` so any sign/ordering drift in the inverse algebra
    surfaces immediately.
    """
    co, so = math.cos(omega_rad), math.sin(omega_rad)
    cO, sO = math.cos(Omega_rad), math.sin(Omega_rad)
    ci = math.cos(i_rad)
    A = a_mas * (co * cO - so * sO * ci)
    B = a_mas * (co * sO + so * cO * ci)
    F = a_mas * (-so * cO - co * sO * ci)
    G = a_mas * (-so * sO + co * cO * ci)
    return A, B, F, G

def _nss_orbital_row(
    *, a_mas: float = 12.5, i_deg: float = 57.3,
    Omega_deg: float = 110.0, omega_deg: float = 45.0,
    period_days: float = 365.0,
    t_periastron_rel_days: float = 100.0,
    eccentricity: float = 0.1,
) -> dict[str, str]:
    A, B, F, G = _ti_from_campbell(
        a_mas, math.radians(i_deg),
        math.radians(Omega_deg), math.radians(omega_deg),
    )
    return {
        "nss_solution_type": "Orbital",
        "period": f"{period_days}",
        "t_periastron": f"{t_periastron_rel_days}",
        "eccentricity": f"{eccentricity}",
        "a_thiele_innes": f"{A}",
        "b_thiele_innes": f"{B}",
        "f_thiele_innes": f"{F}",
        "g_thiele_innes": f"{G}",
    }

def _orb6_visual(
    *, P_val: float = 50.0, P_unit: str = "y",
    a_val: float = 1.0, a_unit: str = "a",
    i_deg: float = 90.0, Omega_deg: float = 45.0, omega_deg: float = 30.0,
    e: float = 0.5,
    T0_val: float = 1990.0, T0_unit: str = "y",
    grade: int = 2, ref: str = "Ref2020",
) -> "Orb6Entry":
    return Orb6Entry(
        wds_id="00000+0000", discoverer="TST   1", components="AB",
        hd=None, hip=None,
        P_val=P_val, P_unit=P_unit,
        a_val=a_val, a_unit=a_unit,
        i_deg=i_deg, Omega_deg=Omega_deg, omega_deg=omega_deg,
        e=e, T0_val=T0_val, T0_unit=T0_unit,
        grade=grade, ref=ref,
    )

def _ast(
    parallax_mas: float | None = 10.0,
    parallax_error_mas: float | None = 0.05,
) -> "ComponentAstrometry":
    return ComponentAstrometry(
        astrometry_via="gaia_5p",
        ra_deg=0.0, dec_deg=0.0,
        parallax_mas=parallax_mas,
        parallax_error_mas=parallax_error_mas,
        pmra_masyr=0.0, pmdec_masyr=0.0,
        ref_epoch=2016.0,
    )

def _indices_for_orbit(
    *, src_to_nss: dict[int, dict[str, str]] | None = None,
) -> "IdentifierIndices":
    return build_indices(
        athyg=[], hip2=[],
        hip_to_gaia={}, tyc_to_gaia={},
        src_to_nss=src_to_nss or {},
    )

def _wds_pair(
    *,
    wds_id: str = "WDS-1",
    discoverer: str = "TST   1",
    components: str = "AB",
    notes: str = "    ",
    rho_last: float | None = 5.0,
    theta_last: float | None = 90.0,
    mag_pri: float | None = 4.0,
    mag_sec: float | None = 6.0,
    precise_ra_deg: float | None = 100.0,
    precise_dec_deg: float | None = 0.0,
    date_last: int | None = 2020,
    spectral: str = "",
    date_first: int | None = None,
    theta_first: float | None = None,
    rho_first: float | None = None,
) -> "WdsPair":
    return WdsPair(
        wds_id=wds_id, discoverer=discoverer, components=components,
        date_last=date_last, rho_last=rho_last, theta_last=theta_last,
        mag_pri=mag_pri, mag_sec=mag_sec, spectral=spectral,
        notes=notes,
        precise_ra_deg=precise_ra_deg, precise_dec_deg=precise_dec_deg,
        date_first=date_first, theta_first=theta_first,
        rho_first=rho_first,
    )

def _cpm_pair(
    *,
    date_first: int | None = 1900,
    theta_first: float | None = 90.0,
    rho_first: float | None = 5.0,
    date_last: int | None = 2000,
    theta_last: float | None = 90.0,
    rho_last: float | None = 5.0,
) -> "WdsPair":
    """A 100-yr-baseline pair; defaults hold the relative geometry
    static (the CPM-confirmed shape)."""
    return _wds_pair(
        date_first=date_first, theta_first=theta_first,
        rho_first=rho_first, date_last=date_last,
        theta_last=theta_last, rho_last=rho_last,
        mag_pri=4.0, mag_sec=6.0,
    )

def _component_astrometry(
    *,
    astrometry_via: str = "gaia_5p",
    ra_deg: float | None = 100.0,
    dec_deg: float | None = 0.0,
    parallax_mas: float | None = 10.0,
    parallax_error_mas: float | None = 0.05,
    pmra_masyr: float | None = 1.0,
    pmdec_masyr: float | None = -1.0,
    ref_epoch: float | None = 2016.0,
) -> "ComponentAstrometry":
    return ComponentAstrometry(
        astrometry_via=astrometry_via,
        ra_deg=ra_deg, dec_deg=dec_deg,
        parallax_mas=parallax_mas,
        parallax_error_mas=parallax_error_mas,
        pmra_masyr=pmra_masyr, pmdec_masyr=pmdec_masyr,
        ref_epoch=ref_epoch,
    )

def _orphan_orb6(
    *, wds_id: str = "00490+1656", discoverer: str = "64 Psc",
    components: str = "Aa,Ab", grade: int = 8,
    precise_ra_deg: float | None = 12.25,
    precise_dec_deg: float | None = 16.94,
) -> "Orb6Entry":
    e = _orb6_visual(grade=grade)
    e.wds_id = wds_id
    e.discoverer = discoverer
    e.components = components
    e.precise_ra_deg = precise_ra_deg
    e.precise_dec_deg = precise_dec_deg
    return e

def _wds_pair_full(
    *, wds_id: str, discoverer: str, components: str,
) -> "WdsPair":
    return WdsPair(
        wds_id=wds_id, discoverer=discoverer, components=components,
        date_last=None, rho_last=0.0, theta_last=0.0,
        mag_pri=None, mag_sec=None, spectral="", notes="    ",
        precise_ra_deg=None, precise_dec_deg=None,
    )

def _bi_pair(
    wds_id: str, comps: str, rho: float | None, theta: float | None,
    date: int = 2016,
) -> "WdsPair":
    return WdsPair(
        wds_id=wds_id, discoverer="X 1", components=comps,
        date_last=date, rho_last=rho, theta_last=theta,
        mag_pri=None, mag_sec=None, spectral="", notes="    ",
        precise_ra_deg=None, precise_dec_deg=None,
    )

def _bi_comp(
    wds_id: str, tok: str, is_primary: bool,
    gaia: int | None, hip: int | None = None, via: str = "simbad_xid",
) -> "ResolvedComponent":
    return ResolvedComponent(
        wds_id=wds_id, discoverer="X 1", component=tok,
        is_primary=is_primary,
        gaia_source_id=gaia, resolve_via=(via if gaia is not None else "unresolved"),
        hip=hip,
    )

def _bi_astro(
    sid: int, e_arcsec: float, n_arcsec: float,
    *, pmra: float = 0.0, pmdec: float = 0.0, epoch: float = 2016.0,
) -> "GaiaAstrometryRow":
    """A Gaia astrometry row placed at (E, N) arcsec from RA=180°, Dec=0°."""
    dec = n_arcsec / 3600.0
    ra = 180.0 + (e_arcsec / 3600.0)  # cos(0°) = 1
    return GaiaAstrometryRow(
        source_id=sid, ra_deg=ra, dec_deg=dec,
        parallax_mas=10.0, parallax_error_mas=0.1,
        pmra_masyr=pmra, pmra_error_masyr=0.1,
        pmdec_masyr=pmdec, pmdec_error_masyr=0.1,
        ref_epoch=epoch, ruwe=1.0, ipd_frac_multi_peak=0.0,
        g_mag=5.0, bp_mag=5.0, rp_mag=5.0,
    )

def _bi_indices(
    src_to_astrometry: dict[int, "GaiaAstrometryRow"],
    hip_to_gaia: dict[int, int] | None = None,
) -> "IdentifierIndices":
    return build_indices(
        athyg=[], hip2=[], hip_to_gaia=hip_to_gaia or {},
        tyc_to_gaia={}, src_to_nss={},
        src_to_astrometry=src_to_astrometry,
    )

def _bi_system(
    rows: list[tuple[str, float | None, float | None,
                     tuple[int | None, int | None],
                     tuple[int | None, int | None]]],
    wds_id: str = "10000+0000",
) -> tuple[list["WdsPair"], list["ResolvedComponent"]]:
    """(pairs, components) aligned in pair order (primary, secondary per
    decomposing pair) for the binding-integrity audit. Each row is
    (comps, rho, theta, (p_gaia, p_hip), (s_gaia, s_hip))."""
    pairs: list[WdsPair] = []
    comps: list[ResolvedComponent] = []
    for comps_str, rho, theta, pb, sb in rows:
        p_tok, s_tok = split_components(comps_str)
        pairs.append(_bi_pair(wds_id, comps_str, rho, theta))
        comps.append(_bi_comp(wds_id, p_tok, True, pb[0], pb[1]))
        comps.append(_bi_comp(wds_id, s_tok, False, sb[0], sb[1]))
    return pairs, comps

def _msc_system(
    wds_id: str = "10000+0000", prim: str = "A", sec: str = "B",
    parent: str = "*", vmag1: float | None = None, spt1: str = "",
    vmag2: float | None = None, spt2: str = "",
) -> "MscSystemRow":
    return MscSystemRow(
        wds_id=wds_id, prim=prim, sec=sec, parent=parent, obs_type="",
        vmag1=vmag1, spt1=spt1, vmag2=vmag2, spt2=spt2,
    )

def _msc_orbit(
    wds_id: str = "10000+0000", syst: str = "Aa,Ab",
    per: float | None = 6.0663, per_unit: str = "d",
    t0: float | None = 40087.19, e: float | None = 0.25,
    a_arcsec: float | None = None, node_deg: float | None = None,
    longp_deg: float | None = 31.4, incl_deg: float | None = None,
    note: str = "",
) -> "MscOrbitRow":
    return MscOrbitRow(
        wds_id=wds_id, syst=syst, per=per, per_unit=per_unit, t0=t0, e=e,
        a_arcsec=a_arcsec, node_deg=node_deg, longp_deg=longp_deg,
        incl_deg=incl_deg, note=note,
    )
