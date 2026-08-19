#!/usr/bin/env python3
"""Sky view factor: the cosine-weighted terrain share of each texel's sky, over
the whole arc terrain can occlude (data/textures/relief/README.md § Sky view
factor)."""

import numpy as np

from dem_relief import dem_target_w, weighted_quantile
from horizon_map import (
    HORIZON_AZIMUTHS,
    box_reduce,
    horizon_angles,
    horizon_target_w,
    search_arc,
)

# Full scale of the encoded factor. A view factor is a fraction of the sky, so
# the encodable ceiling is 1 — but the measured maximum over all four bodies is
# 0.171, and spending the range on values no terrain reaches would throw away
# most of the 8 bits. One code is 0.001 of sky, which reaches the screen as
# 0.012 % of lit ground on the Moon: two orders under the faintest shadow the
# tone-map can show (§ What the fill term is worth).
SKY_VIEW_RANGE = 0.25


def sky_view_target_w(spec: dict) -> int:
    """Same grid as the horizon pair — half the DEM. The factor is smooth where
    the skyline is not, so it loses less to the reduction than they would."""
    return horizon_target_w(spec)


def near_bound(w_dem: int) -> float:
    """Central angle the march begins at: ONE DEM texel.

    The shadow march starts four times further out, and deliberately — a caster
    that close throws a shadow the colour map cannot draw. Sky occlusion carries
    no such requirement: a wall too small to resolve still blocks its share of
    the sky, and that near arc is where a crater floor loses most of its.
    Inside one texel there is no neighbour left to block anything, and the
    elevation angle to a blocker degenerates as the range goes to zero.
    """
    return 2 * np.pi / w_dem


def encode_sky_view(factor: np.ndarray) -> np.ndarray:
    """Raw 0–255 codes, the inverse of `decode_sky_view`."""
    return np.rint(np.clip(factor / SKY_VIEW_RANGE, 0.0, 1.0) * 255).astype(np.uint8)


def decode_sky_view(raw: np.ndarray) -> np.ndarray:
    return raw / 255.0 * SKY_VIEW_RANGE


def sky_view_factor(elev: np.ndarray, spec: dict) -> tuple[np.ndarray, dict]:
    """The single-channel map for one body, plus its manifest row.

    `mean(max(sin h, 0)²)` over the stored azimuths — the same quantity
    `stellataTerrainViewFactor` derives from the horizon planes, but marched
    over the whole arc rather than the far field alone. Clamping under the local
    horizontal before the square is what keeps a plain at essentially zero:
    every azimuth there reads the body's own limb bound, which is negative.
    """
    w_dem = dem_target_w(spec)
    ang = horizon_angles(
        elev, spec, HORIZON_AZIMUTHS, w_dem, (near_bound(w_dem), search_arc(spec))
    )
    s = np.maximum(np.sin(ang), 0.0)
    del ang
    factor = box_reduce((s * s).mean(axis=2), sky_view_target_w(spec))
    del s

    h, w = factor.shape
    lat = np.radians(90.0 - (np.arange(h) + 0.5) * 180.0 / h)
    weights = np.repeat(np.cos(lat), w)
    flat = factor.ravel()
    return encode_sky_view(factor), {
        "width": w,
        "azimuths": HORIZON_AZIMUTHS,
        "range": SKY_VIEW_RANGE,
        "medianFactor": round(weighted_quantile(flat, weights, 0.5), 5),
        "p99Factor": round(weighted_quantile(flat, weights, 0.99), 5),
        "maxFactor": round(float(flat.max()), 5),
        "clampedPct": round(float(100 * np.mean(flat > SKY_VIEW_RANGE)), 4),
    }
