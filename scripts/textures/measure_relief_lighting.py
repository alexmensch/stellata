#!/usr/bin/env python3
"""What the relief terms light: ground past the terminator against the exact
horizon, and the disc integral against phase. Manual, run by hand; method and
results in data/textures/README.md § Cast shadows."""

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

# Sun in the body's equatorial plane, so its bearing at every texel near the
# terminator is due east or west — one of the stored azimuths. That isolates
# the map's WIDTH and encoding from its azimuth resolution, which is measured
# separately (README.md § Cast shadows).
EAST_CHANNEL = 0
WEST_CHANNEL = 4


def _smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def _shipped_horizon_sin(body: str, channel: int) -> np.ndarray:
    half = "a" if channel < 4 else "b"
    plane = np.asarray(
        Image.open(TEXTURES / f"{body}-horizon-{half}.webp").convert("RGBA")
    )
    enc = plane[..., channel % 4].astype(np.float32) / 255.0
    return (enc * 2 - 1) * HORIZON_SIN_RANGE


def _upsample(a: np.ndarray, factor: int) -> np.ndarray:
    return np.repeat(np.repeat(a, factor, 0), factor, 1)


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
    t = np.clip((sun_cos + w) / (2 * w), 0, 1)
    return t * t * (3 - 2 * t) * np.maximum(sun_cos, w)


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

    print(f"\n{body}: disc integral vs the smooth sphere, magnitudes")
    print("  phase     normal map only    + horizon maps")
    for alpha in PHASE_ANGLES_DEG:
        rad = np.radians(alpha)
        sun = np.array([np.sin(rad), 0.0, np.cos(rad)])
        ndotv = up @ view
        visible = ndotv > 0
        limb = LIMB_FLOOR + (1 - LIMB_FLOOR) * np.power(np.maximum(ndotv, 0), LIMB_EXP)
        weight = np.where(visible, area * np.maximum(ndotv, 0) * limb, 0.0)
        sun_cos = up @ sun
        gate = decode_horizon_sin(
            planes, (east @ sun)[::factor, ::factor], (north @ sun)[::factor, ::factor]
        )
        lit_by = {
            "smooth": _dayside(sun_cos),
            "relief": _dayside(facet @ sun),
            "horizon": _dayside(facet @ sun) * (sun_cos > _upsample(gate, factor)),
        }
        total = {k: float((v * weight).sum()) for k, v in lit_by.items()}
        dmag = {
            k: -2.5 * np.log10(total[k] / total["smooth"]) if total[k] > 0 else np.inf
            for k in ("relief", "horizon")
        }
        print(f"  {alpha:>4}      {dmag['relief']:>+16.3f}  {dmag['horizon']:>+16.3f}")


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

    shipped = _shipped_horizon_sin(body, EAST_CHANNEL)
    factor = w // shipped.shape[1]
    sin_map = np.where(
        sun_east >= 0,
        _upsample(shipped, factor),
        _upsample(_shipped_horizon_sin(body, WEST_CHANNEL), factor),
    )
    exact = horizon_angles(elev, spec, 2)
    sin_true = np.sin(np.where(sun_east >= 0, exact[..., 0], exact[..., 1]))
    del exact

    columns = {
        "normal map only": facet_lit & (_smoothstep(-none, -full, sun_up) > 0),
        "+ horizon maps": facet_lit & (sun_up > sin_map),
        "exact horizon": facet_lit & (sun_up > sin_true),
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
