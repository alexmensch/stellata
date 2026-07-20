#!/usr/bin/env python3
"""Build the molecular cloud catalog consumed by the client renderer.
See scripts/clouds/README.md for sources, schema, and merge logic."""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

import cloud_model
from cloud_model import (
    AV_PER_NH_PC,
    AV_TARGET_BY_CLASS,
    DUST_GRID_HALF_EXTENT_PC,
    GAL_TO_ICRS,
    MIN_AXIS_PC,
    NOISE_MODEL,
    SIGMA_S_BY_CLASS,
    SPHERE_PLUMMER_P,
    SPHERE_RFLAT_FRACTION,
    cloud_class,
    fnv1a32,
    galactic_lbd_to_xyz_pc,
    matrix_to_quat,
    matvec,
    parse_z2021_table3,
    profiled_clouds,
)

ROOT = Path(__file__).resolve().parent.parent.parent
SRC_2020 = ROOT / 'data' / 'molecular-clouds' / 'zucker2020-tablea1.tsv'
SRC_2021 = ROOT / 'data' / 'molecular-clouds' / 'zucker2021-table1.dat'
SRC_2021_T3 = ROOT / 'data' / 'molecular-clouds' / 'zucker2021-table3.dat'
OUT = ROOT / 'public' / 'clouds.json'

# Default sphere radius for Zucker-2020 clouds with only a single sightline.
# Most local SF clouds fall in the 5–30 pc effective-radius range; 5 pc is the
# small end so over-estimation isn't visually dominant. Multi-sightline clouds
# get a real spread-based radius.
DEFAULT_SPHERE_RADIUS_PC = 5.0


# Display-name normalisation. Z2020 uses underscores; Z2021 uses contracted
# forms ("Coraus", "Oriona", "Orionb", "Orionlam"). Map both to clean human
# forms for search and label display.
DISPLAY_NAME_OVERRIDES: dict[str, str] = {
    'Coraus': 'Corona Australis',
    'Corona_Australis': 'Corona Australis',
    'Oriona': 'Orion A',
    'Orionb': 'Orion B',
    'Orionlam': 'Orion λ',
    'Orion_Lam': 'Orion λ',
    'Aquila_Rift': 'Aquila Rift',
    'Aquila_S': 'Aquila South',
    'CMa_OB1': 'CMa OB1',
    'Gem_OB1': 'Gem OB1',
    'Mon_OB1_NGC2264': 'Mon OB1 / NGC 2264',
    'Cam': 'Cam',
    'CygnusX': 'Cygnus X',
    'IC1396': 'IC 1396',
    'IC2118': 'IC 2118',
    'IC2944': 'IC 2944',
    'IC443': 'IC 443',
    'IC5146': 'IC 5146',
    'NGC2362': 'NGC 2362',
    'NGC6604': 'NGC 6604',
    'Pipe_B59': 'Pipe (B59)',
}


def display_name(raw: str) -> str:
    if raw in DISPLAY_NAME_OVERRIDES:
        return DISPLAY_NAME_OVERRIDES[raw]
    # Generic fallback: replace underscores with spaces, leave other casing.
    return raw.replace('_', ' ')


# Map from Zucker 2021 raw cloud name → canonical Z2020 cloud name to
# suppress when the Z2021 entry is present. Without this we'd render two
# overlapping objects (sphere from Z2020 + ellipsoid from Z2021) for the
# same cloud. Z2020 sub-regions (Ophiuchus_Arc etc.) are NOT suppressed —
# they're separate physical structures even when contained in the Z2021
# parent ellipsoid.
Z2021_TO_Z2020_SUPPRESS: dict[str, str] = {
    'Chamaeleon': 'Chamaeleon',
    'Ophiuchus': 'Ophiuchus',
    'Lupus': 'Lupus',
    'Taurus': 'Taurus',
    'Perseus': 'Perseus',
    'Cepheus': 'Cepheus',
    'Coraus': 'Corona_Australis',
    'Pipe': 'Pipe_B59',
    'Oriona': 'Orion',
    'Orionb': 'Orion',
    'Orionlam': 'Orion_Lam',
    # Musca has no Z2020 counterpart at this granularity; nothing to suppress.
}


def slugify(name: str) -> str:
    s = re.sub(r'[^A-Za-z0-9]+', '-', name).strip('-').lower()
    return s or 'cloud'


def parse_z2020(path: Path) -> dict[str, list[dict]]:
    """Parse the Zucker 2020 VizieR TSV. Returns {cloud_name: [sightline,...]}.
    Each sightline carries glon, glat, d_pc."""
    rows: dict[str, list[dict]] = {}
    with path.open() as fh:
        for line in fh:
            line = line.rstrip('\n')
            if not line or line.startswith('#'):
                continue
            parts = line.split('\t')
            if len(parts) < 16:
                continue
            # The header rows ("recno\tName\t...", units, dashes) survive the
            # comment filter. Skip anything where field 0 isn't a number.
            try:
                int(parts[0].strip())
            except ValueError:
                continue
            name = parts[1].strip()
            try:
                glon = float(parts[2])
                glat = float(parts[3])
                d50 = float(parts[14])  # 50th-percentile cloud distance
            except ValueError:
                continue
            rows.setdefault(name, []).append({'l': glon, 'b': glat, 'd': d50})
    return rows


def in_grid(center_icrs: tuple[float, float, float], half_extents_icrs: tuple[float, float, float]) -> bool:
    """True when the cloud volume lies fully inside the dust voxel cube."""
    return all(
        abs(c) + h <= DUST_GRID_HALF_EXTENT_PC
        for c, h in zip(center_icrs, half_extents_icrs)
    )


def density_model_fields(raw_name: str, *, radius_pc: float,
                         profiled: dict[str, cloud_model.ProfiledCloud]) -> dict:
    """The clouds.json v2 per-cloud density-model block. Profiled clouds
    carry the calibrated Plummer parameters the bake used; the rest get the
    class-based presence-pass defaults (docs/molecular-clouds.md § 4.3)."""
    cls = cloud_class(raw_name)
    common = {
        'class': cls,
        'sigmaS': SIGMA_S_BY_CLASS[cls],
        'seed': fnv1a32(raw_name),
        'embedded': [],
    }
    p = profiled.get(raw_name)
    if p is not None:
        return common | {
            'n0Cal': round(p.n0_cal, 2),
            'uEnv': round(p.u_env, 4),
            'rflat': p.rflat,
            'p': p.p,
            'massLeike': p.mass_leike,
            'akPeak': p.ak_leike,
        }
    av_target = AV_TARGET_BY_CLASS[cls]
    return common | {
        'n0Cal': round(av_target / (2.0 * radius_pc * AV_PER_NH_PC), 2),
        'uEnv': 1.0,
        'rflat': round(SPHERE_RFLAT_FRACTION * radius_pc, 2),
        'p': SPHERE_PLUMMER_P,
        'massLeike': None,
        'akPeak': None,
    }


def build_z2021_clouds(entries: list[dict], masses: dict[str, float],
                       profiled: dict[str, cloud_model.ProfiledCloud]) -> list[dict]:
    """Z2021 → ellipsoid clouds in ICRS frame.
    Bounding box is axis-aligned in galactic Cartesian; rotate the *centre*
    to ICRS, and emit the GAL_TO_ICRS rotation as the orientation quaternion
    so the ellipsoid axes correctly align with galactic +X/+Y/+Z when
    expanded by the renderer.
    """
    quat_gal_to_icrs = matrix_to_quat(GAL_TO_ICRS)
    out: list[dict] = []
    for e in entries:
        cx = 0.5 * (e['xmin'] + e['xmax'])
        cy = 0.5 * (e['ymin'] + e['ymax'])
        cz = 0.5 * (e['zmin'] + e['zmax'])
        a = 0.5 * (e['xmax'] - e['xmin'])
        b = 0.5 * (e['ymax'] - e['ymin'])
        c = 0.5 * (e['zmax'] - e['zmin'])
        # Per-axis floor — Musca's c=7 pc is fine, but a degenerate flat box
        # would render invisibly edge-on. Shared with the density model
        # (cloud_model.MIN_AXIS_PC) so extinction and rendering agree.
        a = max(a, MIN_AXIS_PC)
        b = max(b, MIN_AXIS_PC)
        c = max(c, MIN_AXIS_PC)
        center_icrs = matvec(GAL_TO_ICRS, (cx, cy, cz))
        name = display_name(e['cloud'])
        d = math.sqrt(center_icrs[0] ** 2 + center_icrs[1] ** 2 + center_icrs[2] ** 2)
        # ICRS-axis half-extents of the rotated ellipsoid's bounding box.
        half = tuple(
            sum(abs(GAL_TO_ICRS[i][j]) * ax for j, ax in enumerate((a, b, c)))
            for i in range(3)
        )
        cloud = {
            'name': name,
            'id': slugify(name),
            'center': [round(center_icrs[0], 2), round(center_icrs[1], 2), round(center_icrs[2], 2)],
            'axes': [round(a, 2), round(b, 2), round(c, 2)],
            'quat': [round(q, 6) for q in quat_gal_to_icrs],
            'source': 'Z2021T1',
            'distance': round(d, 1),
            'inGrid': in_grid(center_icrs, half),
        }
        if e['cloud'] in masses:
            cloud['mass'] = masses[e['cloud']]
        cloud |= density_model_fields(e['cloud'], radius_pc=min(a, b, c), profiled=profiled)
        out.append(cloud)
    return out


def build_z2020_clouds(
    grouped: dict[str, list[dict]],
    suppress: set[str],
    profiled: dict[str, cloud_model.ProfiledCloud],
) -> list[dict]:
    """Z2020 → sphere clouds in ICRS frame.
    For multi-sightline clouds, the sphere radius is the maximum distance from
    centroid to any sightline (with a small floor). Singletons get a default.
    """
    out: list[dict] = []
    for raw_name, sightlines in grouped.items():
        if raw_name in suppress:
            continue
        if not sightlines:
            continue
        # Centroid in galactic Cartesian (then rotate to ICRS).
        gal_pts = [galactic_lbd_to_xyz_pc(s['l'], s['b'], s['d']) for s in sightlines]
        cx = sum(p[0] for p in gal_pts) / len(gal_pts)
        cy = sum(p[1] for p in gal_pts) / len(gal_pts)
        cz = sum(p[2] for p in gal_pts) / len(gal_pts)
        if len(gal_pts) >= 2:
            spread = max(
                math.sqrt((p[0] - cx) ** 2 + (p[1] - cy) ** 2 + (p[2] - cz) ** 2)
                for p in gal_pts
            )
            radius = max(spread, MIN_AXIS_PC)
        else:
            radius = DEFAULT_SPHERE_RADIUS_PC
        center_icrs = matvec(GAL_TO_ICRS, (cx, cy, cz))
        name = display_name(raw_name)
        d = math.sqrt(center_icrs[0] ** 2 + center_icrs[1] ** 2 + center_icrs[2] ** 2)
        cloud = {
            'name': name,
            'id': slugify(name),
            'center': [round(center_icrs[0], 2), round(center_icrs[1], 2), round(center_icrs[2], 2)],
            'axes': [round(radius, 2), round(radius, 2), round(radius, 2)],
            'quat': [0, 0, 0, 1],
            'source': 'Z2020',
            'distance': round(d, 1),
            'inGrid': in_grid(center_icrs, (radius, radius, radius)),
        }
        cloud |= density_model_fields(raw_name, radius_pc=radius, profiled=profiled)
        out.append(cloud)
    return out


def is_up_to_date() -> bool:
    if not OUT.exists():
        return False
    out_mtime = OUT.stat().st_mtime
    sources = (SRC_2020, SRC_2021, cloud_model.SRC_2021_T2, SRC_2021_T3,
               Path(__file__), Path(cloud_model.__file__))
    for src in sources:
        if src.stat().st_mtime > out_mtime:
            return False
    return True


def main() -> None:
    if '--force' not in sys.argv and is_up_to_date():
        print(f'clouds.json up to date — skipping (use --force to rebuild)')
        return

    if not SRC_2020.exists():
        print(f'error: missing {SRC_2020}', file=sys.stderr)
        sys.exit(1)
    if not SRC_2021.exists():
        print(f'error: missing {SRC_2021}', file=sys.stderr)
        sys.exit(1)
    if not SRC_2021_T3.exists():
        print(f'error: missing {SRC_2021_T3}', file=sys.stderr)
        sys.exit(1)

    z2020 = parse_z2020(SRC_2020)
    z2021 = cloud_model.parse_z2021_table1(SRC_2021)
    # Display mass stays mass_nicest: the Leike-2020 3D map saturates in
    # dense gas and underestimates by up to ~14x (Orionlam), so the
    # NICEST extinction-based value is the one comparable to literature
    # cloud masses. The density model calibrates against the
    # Leike-resolution values separately (massLeike / akPeak fields).
    masses = {name: row['mass_nicest']
              for name, row in parse_z2021_table3(SRC_2021_T3).items()}
    profiled = {p.raw_name: p for p in profiled_clouds()}
    suppress = {z20 for raw, z20 in Z2021_TO_Z2020_SUPPRESS.items()
                if any(raw == e['cloud'] for e in z2021)}
    ellipsoids = build_z2021_clouds(z2021, masses, profiled)
    spheres = build_z2020_clouds(z2020, suppress, profiled)

    # Dedup by id — Z2021 wins when ids collide (defensive; the suppress
    # table should already have prevented this).
    by_id: dict[str, dict] = {}
    for c in ellipsoids + spheres:
        by_id.setdefault(c['id'], c)
    clouds = sorted(by_id.values(), key=lambda c: c['name'].lower())

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        'version': 2,
        'count': len(clouds),
        'noiseModel': NOISE_MODEL,
        'clouds': clouds,
    }
    OUT.write_text(json.dumps(payload, separators=(',', ':')) + '\n')
    print(
        f'wrote {OUT.relative_to(ROOT)} '
        f'({len(ellipsoids)} ellipsoids from Z2021, '
        f'{len(spheres)} spheres from Z2020, '
        f'{len(clouds)} total)'
    )


if __name__ == '__main__':
    main()
