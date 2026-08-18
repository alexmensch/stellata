#!/usr/bin/env python3
"""What the relief terms light: ground past the terminator against the same
march at full DEM width, and the disc integral against phase. Manual, run by
hand; method and results in data/textures/README.md § Cast shadows."""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

from dem_relief import DEM_BODIES, POLE_CUTOFF_DEG, read_frozen_dem, surface_normals
from horizon_map import (
    HORIZON_AZIMUTHS,
    HORIZON_SIN_RANGE,
    decode_horizon_sin,
    horizon_angles,
)

TEXTURES = Path(__file__).resolve().parents[2] / "data" / "textures"
BINS = ((0, 2), (2, 5), (5, 10), (10, 20))
PHASE_ANGLES_DEG = (0, 90, 120, 150, 170)

# Mirrors of the mesh shader's own shading constants — LIMB_FLOOR / LIMB_EXP in
# src/client/solar-system/planets/emission/mesh-surface-pure.ts and the
# airless terminator's floor on the softness half-width. horizon-map.test.ts
# pins these against the originals.
LIMB_FLOOR = 0.45
LIMB_EXP = 0.5
TERM_SOFTNESS_FLOOR = 1e-4
# Geometric albedo per relief body — Planet.albedo / SolMoon.albedo in
# src/client/solar-system/planet-system.ts, the reflectance the interreflected
# term pays a second time. horizon-map.test.ts pins these against the originals.
ALBEDO = {"moon": 0.12, "mercury": 0.142, "mars": 0.170}


def _smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def _upsample(a: np.ndarray, factor: int) -> np.ndarray:
    return np.repeat(np.repeat(a, factor, 0), factor, 1)


def _horizon_gate(
    planes: np.ndarray, sun_east: np.ndarray, sun_north: np.ndarray, factor: int
) -> np.ndarray:
    """Skyline sine per DEM texel: the shipped planes decoded at their own
    resolution against the sun's bearing there, then repeated back up."""
    return _upsample(
        decode_horizon_sin(
            planes, sun_east[::factor, ::factor], sun_north[::factor, ::factor]
        ),
        factor,
    )


def _terrain_view(planes: np.ndarray, factor: int) -> np.ndarray:
    """Cosine-weighted terrain fraction of each patch's sky, mirroring
    `stellataTerrainViewFactor`: the mean of `max(sin h, 0)²` over the stored
    azimuths, clamped so a skyline under the local horizontal reads as sky."""
    s = np.maximum((planes / 255.0 * 2 - 1) * HORIZON_SIN_RANGE, 0.0)
    return _upsample((s * s).mean(axis=2), factor)


def _shipped_planes(body: str) -> np.ndarray:
    """Both halves as one `(h, w, HORIZON_AZIMUTHS)` stack of raw channels."""
    halves = [
        np.asarray(Image.open(TEXTURES / f"{body}-horizon-{half}.webp").convert("RGBA"))
        for half in "ab"
    ]
    stack = np.concatenate(halves, axis=2).astype(np.float32)
    assert stack.shape[2] == HORIZON_AZIMUTHS, stack.shape
    return stack


def _tangent_frame(lat: np.ndarray, lon: np.ndarray):
    """Up, east and north at each texel, in the body-fixed frame."""
    cos_lat, sin_lat = np.cos(lat), np.sin(lat)
    up = np.stack(
        [cos_lat * np.cos(lon), cos_lat * np.sin(lon), sin_lat * np.ones_like(lon)],
        axis=-1,
    )
    east = np.stack(
        [-np.sin(lon) * np.ones_like(lat), np.cos(lon) * np.ones_like(lat),
         np.zeros_like(up[..., 0])],
        axis=-1,
    )
    north = np.cross(up, east)
    return up, east, north


def _dayside(sun_cos: np.ndarray) -> np.ndarray:
    """The shader's airless direct term, on whichever cosine it is handed."""
    w = TERM_SOFTNESS_FLOOR
    return _smoothstep(-w, w, sun_cos) * np.maximum(sun_cos, w)


def phase_curve(body: str) -> None:
    """Disc integral against phase, smooth sphere vs each relief term."""
    spec = DEM_BODIES[body]
    elev = read_frozen_dem(TEXTURES / "src" / spec["src"])
    h, w = elev.shape
    lat = np.radians(90.0 - (np.arange(h) + 0.5) * 180.0 / h)[:, None]
    lon = np.radians((np.arange(w) + 0.5) * 360.0 / w - 180.0)[None, :]
    up, east, north = _tangent_frame(lat, lon)
    area = np.cos(lat) * np.ones_like(lon)

    nrm, _ = surface_normals(elev, spec)
    t_e = (nrm[..., 0].astype(np.float32) / 255.0) * 2 - 1
    t_n = (nrm[..., 1].astype(np.float32) / 255.0) * 2 - 1
    t_z = np.sqrt(np.maximum(1 - t_e**2 - t_n**2, 0))
    facet = east * t_e[..., None] + north * t_n[..., None] + up * t_z[..., None]
    facet /= np.linalg.norm(facet, axis=-1, keepdims=True)
    del nrm, t_e, t_n, t_z

    planes = _shipped_planes(body)
    factor = w // planes.shape[1]
    view = np.array([0.0, 0.0, 1.0])

    terrain_view = _terrain_view(planes, factor)
    print(f"\n{body}: disc integral vs the smooth sphere, magnitudes")
    print("  phase     normal map only    + horizon maps  + interreflection")
    for alpha in PHASE_ANGLES_DEG:
        rad = np.radians(alpha)
        sun = np.array([np.sin(rad), 0.0, np.cos(rad)])
        ndotv = up @ view
        visible = ndotv > 0
        limb = LIMB_FLOOR + (1 - LIMB_FLOOR) * np.power(np.maximum(ndotv, 0), LIMB_EXP)
        weight = np.where(visible, area * np.maximum(ndotv, 0) * limb, 0.0)
        sun_cos = up @ sun
        gate = _horizon_gate(planes, east @ sun, north @ sun, factor)
        shadowed = _dayside(facet @ sun) * (sun_cos > gate)
        # The shader adds this to col rather than into dayside, and it carries
        # the albedo a second time — the bounce off the illuminating slope.
        fill = ALBEDO[body] * terrain_view * np.maximum(sun_cos, 0.0)
        lit_by = {
            "smooth": _dayside(sun_cos),
            "relief": _dayside(facet @ sun),
            "horizon": shadowed,
            "fill": shadowed + fill,
        }
        total = {k: float((v * weight).sum()) for k, v in lit_by.items()}
        dmag = {
            k: -2.5 * np.log10(total[k] / total["smooth"]) if total[k] > 0 else np.inf
            for k in ("relief", "horizon", "fill")
        }
        print(f"  {alpha:>4}      {dmag['relief']:>+16.3f}  {dmag['horizon']:>+16.3f}"
              f"  {dmag['fill']:>+17.3f}")


def measure(body: str) -> None:
    spec = DEM_BODIES[body]
    elev = read_frozen_dem(TEXTURES / "src" / spec["src"])
    h, w = elev.shape

    lat = np.radians(90.0 - (np.arange(h) + 0.5) * 180.0 / h)[:, None]
    dlon = np.radians((np.arange(w) + 0.5) * 360.0 / w - 180.0)[None, :]
    sun_up = np.cos(lat) * np.cos(dlon)
    sun_east = -np.sin(dlon) * np.ones_like(lat)
    sun_north = -np.sin(lat) * np.cos(dlon)

    nrm, _ = surface_normals(elev, spec)
    n_e = (nrm[..., 0].astype(np.float32) / 255.0) * 2 - 1
    n_n = (nrm[..., 1].astype(np.float32) / 255.0) * 2 - 1
    n_z = np.sqrt(np.maximum(1 - n_e**2 - n_n**2, 0))
    facet_lit = (n_e * sun_east + n_n * sun_north + n_z * sun_up) > 0
    del nrm, n_e, n_n, n_z

    r = spec["radius_km"] * 1000.0
    summit = r + spec["span_m"][1]
    full = np.sqrt(max(0.0, 1 - (r / summit) ** 2))
    none = np.sqrt(max(0.0, 1 - ((r + spec["span_m"][0]) / summit) ** 2))

    # Due east/west is deliberate, not an approximation of the true bearing:
    # the sun sits in the equatorial plane, so at the terminator that IS the
    # bearing, and landing on a stored azimuth with zero interpolation weight
    # holds width and encoding under test without azimuth count — which is
    # measured separately, and lets the reference stand on two azimuths.
    planes = _shipped_planes(body)
    factor = w // planes.shape[1]
    due_east = np.where(sun_east >= 0, 1.0, -1.0) * np.ones_like(sun_up)
    sin_map = _horizon_gate(planes, due_east, np.zeros_like(due_east), factor)
    reference = horizon_angles(elev, spec, 2)
    sin_ref = np.sin(np.where(sun_east >= 0, reference[..., 0], reference[..., 1]))
    del reference

    # The reference column is this same march at the DEM's own width, so it
    # shares the algorithm's first-step floor rather than being ground truth —
    # what it isolates is the cost of the OUTPUT grid and the encoding.
    columns = {
        "normal map only": facet_lit & (_smoothstep(-none, -full, sun_up) > 0),
        "+ horizon maps": facet_lit & (sun_up > sin_map),
        "full-DEM horizon": facet_lit & (sun_up > sin_ref),
    }

    keep = np.abs(np.degrees(lat[:, 0])) <= POLE_CUTOFF_DEG
    weight = np.repeat(np.cos(lat[keep, 0]), w).reshape(-1, w)
    depression = -np.degrees(np.arcsin(np.clip(sun_up, -1, 1)))
    print(f"\n{body}: lit area %, cos-lat weighted, |lat| <= {POLE_CUTOFF_DEG}")
    print("  depression  " + "  ".join(f"{k:>16}" for k in columns))
    for lo, hi in BINS:
        sel = ((depression >= lo) & (depression < hi))[keep]
        total = weight[sel].sum()
        cells = (100 * weight[sel & m[keep]].sum() / total for m in columns.values())
        print(f"  {lo:>4}-{hi:<6}  " + "  ".join(f"{v:16.1f}" for v in cells))


if __name__ == "__main__":
    for name in sys.argv[1:] or list(DEM_BODIES):
        measure(name)
        phase_curve(name)
