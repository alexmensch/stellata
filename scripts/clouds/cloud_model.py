"""Molecular-cloud density model shared by build-clouds.py (clouds.json v3)
and build-dust.py (extinction column check): Zucker 2021 Plummer profiles,
column calibration, taxonomy, noise constants. docs/science-molecular-clouds.md §§ 2-5."""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SRC_2021_T1 = ROOT / 'data' / 'molecular-clouds' / 'zucker2021-table1.dat'
SRC_2021_T2 = ROOT / 'data' / 'molecular-clouds' / 'zucker2021-table2.dat'
SRC_2021_T3 = ROOT / 'data' / 'molecular-clouds' / 'zucker2021-table3.dat'

# Units chain (docs/science-molecular-clouds.md § 2): every layer works in
# extinction rate; n_H [cm^-3] converts through these.
AV_PER_NH_PC = 1.65e-3      # mag A_V per pc per (n_H cm^-3)
ZGR_PER_NH = 6.02e-4        # E_ZGR per pc per (n_H cm^-3)
AK_OVER_AV = 0.117          # CCM 1989 at R_V = 3.1

# Zhang-Green-Rix 2023 "E" unit → V-band extinction: A_V = ZGR_TO_AV * E_ZGR.
# Edenhofer densities are E_ZGR/pc, so a path integral times this yields A_V.
# The ZGR23 curve (Zenodo 10.5281/zenodo.7811871) gives A_λ/E_ZGR = 2.78 at
# 540 nm, 2.73 at 545 nm; 2.742 is λ ≈ 544 nm, inside the V-band effective
# wavelength (Edenhofer 2024 round to 2.8). Agrees with the n_H chain
# (AV_PER_NH_PC / ZGR_PER_NH = 2.741) to <0.1%. Applied at runtime in the
# shader / dust manifest, never baked into the stored density — retuning
# needs no re-encode.
ZGR_TO_AV = 2.742

# Mass integral M/Msun = MSUN_PER_NH_PC3 * ∫ n dV  (n in cm^-3, V in pc^3),
# mu = 1.37 per H nucleon.
_MU = 1.37
_M_H_G = 1.6735575e-24
_PC_CM = 3.0856775814913673e18
_MSUN_G = 1.98892e33
MSUN_PER_NH_PC3 = _MU * _M_H_G * _PC_CM ** 3 / _MSUN_G

# Soft envelope at the ellipsoid edge: density fades to zero over the
# outer 15% of the ellipsoidal radius u.
ENVELOPE_FADE_START = 0.85

# Semi-axis / sphere-radius floor for rendered cloud geometry: a degenerate
# flat bbox (Musca's fitted box is 0.5 pc thin) would render invisibly
# edge-on, so both the ellipsoid axes and the Z2020 sphere radii floor to
# this. Single source shared with build-clouds.py.
MIN_AXIS_PC = 3.0

# Half-extent of the Edenhofer dust voxel cube (build-dust.py bakes into
# ±this along each ICRS axis). Clouds fully inside get baked per-star
# extinction; the rest are presence-only (docs/science-molecular-clouds.md § 1
# decision 2).
DUST_GRID_HALF_EXTENT_PC = 1250.0

# Mass budget: the peak-column calibration alone over-fills elongated /
# near-uniform-profile clouds (a real cloud is a filament inside its bbox,
# not a filled ellipsoid). Where the column-calibrated smooth model
# exceeds MASS_CAP_FACTOR x mass_leike, the envelope tightens (u_env < 1)
# until the mass budget holds, re-solving the column calibration at the
# tightened chord.
MASS_CAP_FACTOR = 2.0

# Class-based defaults (docs/science-molecular-clouds.md §§ 4.3, 5.1, 7.1).
SIGMA_S_BY_CLASS = {'dark': 1.3, 'sf': 1.7, 'hii': 1.9}
AV_TARGET_BY_CLASS = {'dark': 2.0, 'sf': 3.0, 'hii': 4.0}
SPHERE_RFLAT_FRACTION = 0.25
SPHERE_PLUMMER_P = 2.0

# Curated cloud classes. The 12 Zucker 2021 clouds by known content
# (<=B1 star -> hii, B2-B9 -> sf, else dark); the sphere entries are the
# out-of-grid famous HII regions + IC 443 (an SNR, tinted as hii).
# The A.5 embedded-star cross-match supersedes this table for in-grid
# clouds; unlisted clouds default to 'dark'.
CLOUD_CLASS: dict[str, str] = {
    # Zucker 2021 (raw table names)
    'Chamaeleon': 'dark',
    'Ophiuchus': 'sf',
    'Lupus': 'dark',
    'Taurus': 'dark',
    'Perseus': 'sf',
    'Musca': 'dark',
    'Pipe': 'dark',
    'Cepheus': 'dark',
    'Coraus': 'sf',
    'Oriona': 'hii',
    'Orionb': 'hii',
    'Orionlam': 'hii',
    # Zucker 2020 spheres (raw table names)
    'Carina': 'hii',
    'W3': 'hii',
    'W4': 'hii',
    'W5': 'hii',
    'M16': 'hii',
    'M17': 'hii',
    'Rosette': 'hii',
    'IC2944': 'hii',
    'NGC6604': 'hii',
    'Gem_OB1': 'hii',
    'IC443': 'hii',
}
DEFAULT_CLASS = 'dark'

# Substructure noise ladder for the presence-pass shader (A.4/A.6,
# docs/science-molecular-clouds.md § 5): one geometric ladder from the cloud's
# major diameter down to LAMBDA_MIN_PC, evaluated wholly in-shader (the
# voxel field carries the real Edenhofer structure; no synthetic noise is
# baked). Per-octave variance follows a turbulence power-law: variance
# ratio per octave toward finer scales = 2^(3 - BETA_SPECTRAL) (density
# spectral slope beta ~ 2 for supersonic turbulence), so most of
# sigma_s^2 lives at small scales.
NOISE_LACUNARITY = 2.0
BETA_SPECTRAL = 2.0
LAMBDA_MIN_PC = 0.3
DOMAIN_STRETCH_MAJOR = 2.5
NOISE_CLAMP_SIGMA = 2.5
RIDGED_FINEST_COUNT = 2
RIDGED_EXPONENT = {'dark': 2.0, 'sf': 3.0, 'hii': 3.0}

# The one exported table the shader-side ladder (A.4/A.6) consumes via
# clouds.json.
NOISE_MODEL = {
    'lacunarity': NOISE_LACUNARITY,
    'betaSpectral': BETA_SPECTRAL,
    'lambdaMinPc': LAMBDA_MIN_PC,
    'domainStretchMajor': DOMAIN_STRETCH_MAJOR,
    'noiseClampSigma': NOISE_CLAMP_SIGMA,
    'ridgedFinestCount': RIDGED_FINEST_COUNT,
    'ridgedExponent': RIDGED_EXPONENT,
    'sigmaS': SIGMA_S_BY_CLASS,
    'hash': 'pcg3d',
    'interp': 'quintic',
}

# IAU/Hipparcos J2000 galactic-frame definition (must match
# src/client/galactic-coords.ts so all coordinate transforms agree).
ALPHA_GC = math.radians(266.4051)
DELTA_GC = math.radians(-28.93617)
ALPHA_NGP = math.radians(192.85948)
DELTA_NGP = math.radians(27.12825)


def normalise(v: tuple[float, float, float]) -> tuple[float, float, float]:
    n = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
    return (v[0] / n, v[1] / n, v[2] / n)


def cross(
    a: tuple[float, float, float],
    b: tuple[float, float, float],
) -> tuple[float, float, float]:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def build_gal_to_icrs() -> list[list[float]]:
    """3x3 rotation matrix mapping galactic-Cartesian -> ICRS-Cartesian.
    Columns are unit vectors of galactic +X, +Y, +Z expressed in ICRS.
    """
    gc_dir = normalise((
        math.cos(DELTA_GC) * math.cos(ALPHA_GC),
        math.cos(DELTA_GC) * math.sin(ALPHA_GC),
        math.sin(DELTA_GC),
    ))
    ngp_dir = normalise((
        math.cos(DELTA_NGP) * math.cos(ALPHA_NGP),
        math.cos(DELTA_NGP) * math.sin(ALPHA_NGP),
        math.sin(DELTA_NGP),
    ))
    gal_y = normalise(cross(ngp_dir, gc_dir))
    gal_z = normalise(cross(gc_dir, gal_y))
    # Column-major: row i column j = component i of basis vector j.
    return [
        [gc_dir[0], gal_y[0], gal_z[0]],
        [gc_dir[1], gal_y[1], gal_z[1]],
        [gc_dir[2], gal_y[2], gal_z[2]],
    ]


GAL_TO_ICRS = build_gal_to_icrs()


def matvec(m: list[list[float]], v: tuple[float, float, float]) -> tuple[float, float, float]:
    return (
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    )


def matrix_to_quat(m: list[list[float]]) -> tuple[float, float, float, float]:
    """Convert a 3x3 rotation matrix to a unit quaternion [x, y, z, w].
    Standard Shepperd's method — robust to all rotations.
    """
    m00, m01, m02 = m[0]
    m10, m11, m12 = m[1]
    m20, m21, m22 = m[2]
    trace = m00 + m11 + m22
    if trace > 0:
        s = 0.5 / math.sqrt(trace + 1.0)
        return ((m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s)
    if m00 > m11 and m00 > m22:
        s = 2.0 * math.sqrt(1.0 + m00 - m11 - m22)
        return (0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s)
    if m11 > m22:
        s = 2.0 * math.sqrt(1.0 + m11 - m00 - m22)
        return ((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s)
    s = 2.0 * math.sqrt(1.0 + m22 - m00 - m11)
    return ((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s)


def galactic_lbd_to_xyz_pc(l_deg: float, b_deg: float, d_pc: float) -> tuple[float, float, float]:
    """Galactic spherical (l, b, distance) -> galactic-Cartesian heliocentric pc."""
    lr = math.radians(l_deg)
    br = math.radians(b_deg)
    cb = math.cos(br)
    return (d_pc * cb * math.cos(lr), d_pc * cb * math.sin(lr), d_pc * math.sin(br))


def fnv1a32(s: str) -> int:
    """Deterministic per-cloud noise seed from the cloud id."""
    h = 0x811C9DC5
    for byte in s.encode('utf-8'):
        h = ((h ^ byte) * 0x01000193) & 0xFFFFFFFF
    return h


def parse_z2021_table1(path: Path = SRC_2021_T1) -> list[dict]:
    """Zucker 2021 Table 1 (whitespace-delimited): 3D bounding boxes."""
    out: list[dict] = []
    with path.open() as fh:
        header = fh.readline().split()
        col = {name: i for i, name in enumerate(header)}
        for line in fh:
            parts = line.split()
            if not parts:
                continue
            out.append({
                'cloud': parts[col['cloud']],
                'lmed': float(parts[col['lmed']]),
                'bmed': float(parts[col['bmed']]),
                'dmed': float(parts[col['dmed']]),
                'xmin': float(parts[col['xmin']]),
                'xmax': float(parts[col['xmax']]),
                'ymin': float(parts[col['ymin']]),
                'ymax': float(parts[col['ymax']]),
                'zmin': float(parts[col['zmin']]),
                'zmax': float(parts[col['zmax']]),
            })
    return out


def parse_z2021_table2(path: Path = SRC_2021_T2) -> dict[str, dict]:
    """Zucker 2021 Table 2: fitted radial-profile parameters. Only the
    Plummer columns (n0, rflat, p) are consumed; the Gaussian fits are not.
    Corona Australis has a Table 1 bbox but no Table 2 row."""
    out: dict[str, dict] = {}
    with path.open() as fh:
        header = fh.readline().split()
        col = {name: i for i, name in enumerate(header)}
        for line in fh:
            parts = line.split()
            if not parts:
                continue
            out[parts[col['cloud']]] = {
                'n0': float(parts[col['n0']]),
                'rflat': float(parts[col['rflat']]),
                'p': float(parts[col['p']]),
            }
    return out


def parse_z2021_table3(path: Path = SRC_2021_T3) -> dict[str, dict]:
    """Zucker 2021 Table 3: masses + peak A_K at both map resolutions."""
    out: dict[str, dict] = {}
    with path.open() as fh:
        header = fh.readline().split()
        col = {name: i for i, name in enumerate(header)}
        for line in fh:
            parts = line.split()
            if not parts:
                continue
            out[parts[col['cloud']]] = {
                'mass_nicest': float(parts[col['mass_nicest']]),
                'mass_leike': float(parts[col['mass_leike']]),
                'max_ak_nicest': float(parts[col['max_ak_nicest']]),
                'max_ak_leike': float(parts[col['max_ak_leike']]),
            }
    return out


def cloud_class(raw_name: str) -> str:
    return CLOUD_CLASS.get(raw_name, DEFAULT_CLASS)


def _clip01(t):
    """Scalar-or-ndarray clamp so the model formulas below serve both the
    stdlib-pure calibration (build-clouds.py runs without numpy in CI) and
    the vectorised bake (build-dust.py)."""
    if isinstance(t, float):
        return min(max(t, 0.0), 1.0)
    return t.clip(0.0, 1.0)


def envelope(u, u_env: float = 1.0):
    """Soft edge at the ellipsoid boundary: 1 inside, fading to 0 at
    u = u_env (the mass-budget tightening; 1.0 = the full bbox ellipsoid)."""
    t = _clip01((u / u_env - ENVELOPE_FADE_START) / (1.0 - ENVELOPE_FADE_START))
    return 1.0 - t * t * (3.0 - 2.0 * t)


def plummer(r_eff, rflat: float, p: float):
    return (1.0 + (r_eff / rflat) ** 2) ** (-0.5 * p)


def column_integral_pc(rflat: float, p: float, s_min: float, u_env: float = 1.0,
                       n_samples: int = 4001) -> float:
    """∫ plummer(|l|) * envelope(|l|/s_min) dl over the shortest-axis chord
    through the centroid, in pc (unit amplitude). Trapezoid rule, stdlib-pure."""
    half = s_min * u_env
    h = 2.0 * half / (n_samples - 1)
    total = 0.0
    for i in range(n_samples):
        l = abs(-half + i * h)
        f = plummer(l, rflat, p) * envelope(l / s_min, u_env)
        total += f if 0 < i < n_samples - 1 else 0.5 * f
    return total * h


def volume_integral_pc3(rflat: float, p: float, axes: tuple[float, float, float],
                        u_env: float = 1.0, n_samples: int = 4001) -> float:
    """∫ plummer(r_eff) * envelope(u) dV over the ellipsoid, in pc^3 (unit
    amplitude). Substituting w = x_local/axes maps the ellipsoid to the unit
    ball with dV = a*b*c*dw and r_eff = |w|*s_min. Trapezoid rule, stdlib-pure."""
    s_min = min(axes)
    h = u_env / (n_samples - 1)
    total = 0.0
    for i in range(n_samples):
        u = i * h
        f = plummer(u * s_min, rflat, p) * envelope(u, u_env) * u * u
        total += f if 0 < i < n_samples - 1 else 0.5 * f
    shell = 4.0 * math.pi * total * h
    return axes[0] * axes[1] * axes[2] * shell


@dataclass
class ProfiledCloud:
    """One of the 11 Zucker 2021 clouds with a fitted Plummer profile
    (Corona Australis has a bbox but no Table 2/3 rows and is
    presence-only, like the Zucker 2020 spheres)."""
    raw_name: str
    center_icrs: tuple[float, float, float]   # pc, heliocentric
    axes_gal: tuple[float, float, float]      # semi-axes along galactic XYZ, pc
    cls: str
    n0_fit: float                             # Table 2 amplitude, cm^-3 (shape source only)
    rflat: float                              # pc
    p: float
    mass_leike: float                         # Msun
    ak_leike: float                           # mag
    n0_cal: float                             # calibrated amplitude, cm^-3
    u_env: float                              # envelope tightening (1 = full bbox)
    sigma_s: float                            # total log-normal sigma
    seed: int
    av_column_target: float                   # mag, = ak_leike / AK_OVER_AV
    mass_model: float                         # Msun, smooth calibrated model


def calibrate(rflat: float, p: float, axes: tuple[float, float, float],
              target_av: float, mass_leike: float) -> tuple[float, float, float]:
    """Solve (n0_cal, u_env, mass_model): the column calibration with the
    mass budget. n0_cal always sets the centroid shortest-axis column to
    target_av at the solved envelope; u_env < 1 only when the full-bbox
    model exceeds MASS_CAP_FACTOR x mass_leike (mass is monotonic in u_env,
    so a bisection converges)."""
    s_min = min(axes)
    cap = MASS_CAP_FACTOR * mass_leike

    def solve_at(u_env: float) -> tuple[float, float]:
        col = column_integral_pc(rflat, p, s_min, u_env)
        n0 = target_av / (AV_PER_NH_PC * col)
        vol = volume_integral_pc3(rflat, p, axes, u_env)
        return n0, MSUN_PER_NH_PC3 * n0 * vol

    n0, mass = solve_at(1.0)
    if mass <= cap:
        return n0, 1.0, mass
    lo, hi = 0.05, 1.0
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        n0, mass = solve_at(mid)
        if mass > cap:
            hi = mid
        else:
            lo = mid
    n0, mass = solve_at(lo)
    return n0, lo, mass


def profiled_clouds() -> list[ProfiledCloud]:
    """The calibrated per-cloud parameter set driving both the voxel bake
    and the clouds.json v3 fields. Calibration: solve n0_cal so the
    shortest-axis column through the centroid equals the observed
    Leike-resolution peak column, under the mass budget
    (docs/science-molecular-clouds.md § 4.2)."""
    t1 = parse_z2021_table1()
    t2 = parse_z2021_table2()
    t3 = parse_z2021_table3()
    out: list[ProfiledCloud] = []
    for e in t1:
        name = e['cloud']
        if name not in t2 or name not in t3:
            continue  # Corona Australis: bbox only, presence-only cloud
        cx = 0.5 * (e['xmin'] + e['xmax'])
        cy = 0.5 * (e['ymin'] + e['ymax'])
        cz = 0.5 * (e['zmin'] + e['zmax'])
        axes = (
            max(0.5 * (e['xmax'] - e['xmin']), MIN_AXIS_PC),
            max(0.5 * (e['ymax'] - e['ymin']), MIN_AXIS_PC),
            max(0.5 * (e['zmax'] - e['zmin']), MIN_AXIS_PC),
        )
        center_icrs = matvec(GAL_TO_ICRS, (cx, cy, cz))
        fit = t2[name]
        obs = t3[name]
        target_av = obs['max_ak_leike'] / AK_OVER_AV
        n0_cal, u_env, mass_model = calibrate(
            fit['rflat'], fit['p'], axes, target_av, obs['mass_leike'])
        cls = cloud_class(name)
        sigma_s = SIGMA_S_BY_CLASS[cls]
        out.append(ProfiledCloud(
            raw_name=name,
            center_icrs=center_icrs,
            axes_gal=axes,
            cls=cls,
            n0_fit=fit['n0'],
            rflat=fit['rflat'],
            p=fit['p'],
            mass_leike=obs['mass_leike'],
            ak_leike=obs['max_ak_leike'],
            n0_cal=n0_cal,
            u_env=u_env,
            sigma_s=sigma_s,
            seed=fnv1a32(name),
            av_column_target=target_av,
            mass_model=mass_model,
        ))
    return out


