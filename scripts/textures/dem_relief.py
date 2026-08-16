#!/usr/bin/env python3
"""Surface-relief half of the texture build: the frozen-DEM contract and the
DEM -> tangent-space normal-map derivation (rationale in
data/textures/README.md § Surface relief)."""

import numpy as np
from PIL import Image

# The frozen reductions store metres above the body's reference sphere as
# uint16 biased by this, so a signed elevation survives a format every tool
# reads back identically.
DEM_ZERO_LEVEL = 32768
DEM_TARGET_W = 4096

# Latitude past which the equirect longitude derivative degenerates: texels
# converge on the pole, so a metre of east-west relief spans a vanishing
# distance and the slope diverges. Zeroed there rather than clamped — a pole
# reading flat beats a pole reading vertical.
POLE_CUTOFF_DEG = 85.0

# Latitude excluded from the reported tilt statistics, matching the probe the
# pinned numbers come from.
STATS_CUTOFF_DEG = 88.0

# Per-body relief contract. `dtype`/`scale`/`offset`/`span_m` decode the
# DOWNLOADED original (reduce_dem.py); the rest drive every build.
#
# `dem_center_lon` is the frozen reduction's own map-centre east longitude and
# `map_center_lon` is that body's COLOUR map's — the build rolls the first onto
# the second. A normal map centred differently from the colour map it shades
# puts every slope on the wrong feature and has no other symptom, so
# dem-relief.test.ts pins map_center_lon against the runtime's
# RotationElements.mapCenterLonDeg.
#
# `radius_km` sets the vertical exaggeration and is the radius the body is
# DRAWN at (SOL_BODIES), not the DEM's georeferencing radius — the relief has
# to belong to the sphere it shades. The same test pins it.
DEM_BODIES = {
    "moon": {
        "src": "moon-dem-svs.tif",
        "dtype": "<u2",
        # The SVS LDEMs carry NO GDAL scale tag and are NOT metres: samples are
        # half-metres above a 1727400 m datum. Missing the factor doubles every
        # slope and puts the highest summit at +31 km.
        "scale": 0.5,
        "offset": -10000.0,
        "span_m": (-9110, 10760),
        "dem_center_lon": 0,
        "map_center_lon": 0,
        "radius_km": 1737.4,
    },
    "mercury": {
        "src": "mercury-dem-messenger.tif",
        "dtype": "<i2",
        "scale": 0.5,
        "offset": 0.0,
        "span_m": (-5380, 4480),
        "dem_center_lon": 180,
        "map_center_lon": 0,
        "radius_km": 2440,
    },
    "mars": {
        "src": "mars-dem-mola.tif",
        "dtype": "<i2",
        "scale": 1.0,
        "offset": 0.0,
        "span_m": (-8200, 21230),
        "dem_center_lon": 0,
        "map_center_lon": 0,
        "radius_km": 3390,
    },
}


def read_frozen_dem(path) -> np.ndarray:
    """The frozen reduction as metres above the body's reference sphere."""
    a = np.asarray(Image.open(path), dtype=np.int32)
    return (a - DEM_ZERO_LEVEL).astype(np.float32)


def _roll_to_map_centre(elev: np.ndarray, spec: dict) -> np.ndarray:
    w = elev.shape[1]
    shift = (spec["dem_center_lon"] - spec["map_center_lon"]) * w // 360
    return np.roll(elev, shift, axis=1) if shift % w else elev


def _weighted_quantile(values: np.ndarray, weights: np.ndarray, q: float) -> float:
    order = np.argsort(values)
    v, w = values[order], weights[order]
    cdf = (np.cumsum(w) - 0.5 * w) / w.sum()
    return float(np.interp(q, cdf, v))


def surface_normals(elev: np.ndarray, spec: dict) -> tuple[np.ndarray, dict]:
    """Tangent-space normal map + its tilt statistics.

    The encoded frame is (+x east, +y north, +z out of the surface), which is
    what a GL-sampled equirect map gives with flipY — v increases northward.
    Blue is unused: z is positive by construction, so the shader reconstructs
    it and the channel costs nothing to leave flat.
    """
    elev = _roll_to_map_centre(elev, spec)
    h, w = elev.shape
    lat = 90.0 - (np.arange(h) + 0.5) * 180.0 / h
    cos_lat = np.cos(np.radians(lat))[:, None]

    # North-south texel spacing in metres. Equirect with h = w/2 makes the
    # east-west spacing the same number scaled by cos(latitude).
    step_m = 2 * np.pi * spec["radius_km"] * 1000.0 / w

    d_east = (np.roll(elev, -1, axis=1) - np.roll(elev, 1, axis=1)) / (
        2 * step_m * np.maximum(cos_lat, 1e-6)
    )
    d_east[np.abs(lat) > POLE_CUTOFF_DEG, :] = 0.0
    north = np.vstack([elev[:1], elev[:-1]])
    south = np.vstack([elev[1:], elev[-1:]])
    d_north = (north - south) / (2 * step_m)

    n = np.stack([-d_east, -d_north, np.ones_like(d_east)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)

    keep = np.abs(lat) <= STATS_CUTOFF_DEG
    tilt = np.degrees(np.arccos(np.clip(n[keep, :, 2], -1.0, 1.0))).ravel()
    weights = np.repeat(cos_lat[keep, 0], w)
    stats = {
        "medianTiltDeg": round(_weighted_quantile(tilt, weights, 0.5), 3),
        "p90TiltDeg": round(_weighted_quantile(tilt, weights, 0.9), 3),
        "width": w,
    }

    rgb = np.zeros((h, w, 3), dtype=np.uint8)
    rgb[..., :2] = np.rint(np.clip(n[..., :2] * 0.5 + 0.5, 0.0, 1.0) * 255)
    return rgb, stats
