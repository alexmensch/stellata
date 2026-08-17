#!/usr/bin/env python3
"""Cast-shadow half of surface relief: per-texel horizon elevation in
HORIZON_AZIMUTHS directions, packed into two RGBA maps (rationale in
data/textures/README.md § Cast shadows)."""

import numpy as np

from dem_relief import roll_to_map_centre, weighted_quantile

HORIZON_AZIMUTHS = 8
HORIZON_TARGET_W = 2048

# Full-scale of the encoded horizon SINE, both signs. Wider than any body's own
# limb bound, which is where the negative side saturates on its own; the
# positive side has to reach a crater wall seen from its floor.
HORIZON_SIN_RANGE = 0.4


def box_reduce(a: np.ndarray, width: int) -> np.ndarray:
    """Area-average an equirect array down to `width`, integer factors only."""
    f = a.shape[1] // width
    if f <= 1:
        return a
    h = a.shape[0] // f
    return a.reshape(h, f, width, f, *a.shape[2:]).mean(axis=(1, 3))


def search_arc(spec: dict) -> float:
    """Central angle past which no ground on this body can occlude any other.

    The extremal case — the highest summit over the deepest floor — puts the
    maximum of the horizon angle exactly here, and every gentler pair peaks
    earlier, so this bound is exact rather than a heuristic cut-off.
    """
    r = spec["radius_km"] * 1000.0
    return float(np.arccos((r + spec["span_m"][0]) / (r + spec["span_m"][1])))


def _sample_ring(field: np.ndarray, lat2: np.ndarray, col: np.ndarray) -> np.ndarray:
    """Bilinear `field` at latitude `lat2` (per output row) and fractional
    column `col`, wrapping in longitude and clamping across the poles."""
    h, w = field.shape
    row = np.clip((90.0 - np.degrees(lat2)) * h / 180.0 - 0.5, 0.0, h - 1.0)
    r0 = np.floor(row).astype(np.intp)
    r1 = np.minimum(r0 + 1, h - 1)
    fr = (row - r0)[:, None]
    c0f = np.floor(col)
    fc = col - c0f
    c0 = c0f.astype(np.intp) % w
    c1 = (c0 + 1) % w
    top = field[r0[:, None], c0] * (1 - fc) + field[r0[:, None], c1] * fc
    bot = field[r1[:, None], c0] * (1 - fc) + field[r1[:, None], c1] * fc
    return top * (1 - fr) + bot * fr


def horizon_angles(
    elev: np.ndarray,
    spec: dict,
    n_az: int = HORIZON_AZIMUTHS,
    out_width: int | None = None,
) -> np.ndarray:
    """`(h, w, n_az)` horizon elevation angles in radians on an `out_width`
    grid, azimuth measured from east toward north — the frame the mesh
    shader's tangent basis builds.

    The elevation angle of a candidate blocker is taken against the sample
    point's true local horizontal on the sphere, so the body's own limb is one
    of the occluders: over flat ground at the reference sphere the answer is 0,
    and no slope anywhere can see the sun past that.

    **The ray is always stepped at the DEM's resolution**, however coarse the
    output grid. Marching at the output texel instead loses the horizon's own
    curvature drop over that first step — half an output texel of solar
    depression, which at any width worth shipping is a large fraction of the
    band this map exists to darken.

    `surface_normals` zeroes its east-west derivative past ±85° because the
    equirect u-derivative degenerates there; this walks real geodesics and has
    no such term, so it stays valid to the pole.
    """
    elev = roll_to_map_centre(elev, spec)
    h_d, w_d = elev.shape
    w_o = out_width or w_d
    h_o = w_o // 2
    r_field = spec["radius_km"] * 1000.0 + elev
    r_p = box_reduce(r_field, w_o)
    lat = np.radians(90.0 - (np.arange(h_o) + 0.5) * 180.0 / h_o)
    sin_lat, cos_lat = np.sin(lat), np.cos(lat)
    col_base = ((np.arange(w_o) + 0.5) * (w_d / w_o) - 0.5)[None, :]

    psi_max = search_arc(spec)
    step = 2 * np.pi / w_d
    steps = max(1, int(np.ceil(psi_max / step)))
    out = np.full((h_o, w_o, n_az), -np.pi / 2, dtype=np.float32)
    for a in range(n_az):
        phi = 2 * np.pi * a / n_az
        for k in range(steps):
            psi = psi_max * (k + 1) / steps
            sin_psi, cos_psi = np.sin(psi), np.cos(psi)
            sin_lat2 = np.clip(sin_lat * cos_psi + cos_lat * sin_psi * np.sin(phi), -1, 1)
            lat2 = np.arcsin(sin_lat2)
            dlon = np.arctan2(np.cos(phi) * sin_psi * cos_lat, cos_psi - sin_lat * sin_lat2)
            col = col_base + (dlon * w_d / (2 * np.pi))[:, None]
            r_q = _sample_ring(r_field, lat2, col)
            theta = np.arctan2(r_q * cos_psi - r_p, r_q * sin_psi)
            np.maximum(out[:, :, a], theta, out=out[:, :, a])
    return out


def encode_horizon(angles: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The two RGBA planes the renderer samples: azimuths 0–3, then 4–7.

    The sine rather than the angle, because the shader compares against
    `dot(n, sunDir)` and an inverse trig per fragment buys nothing at these
    amplitudes.
    """
    assert angles.shape[2] == HORIZON_AZIMUTHS, angles.shape
    e = np.clip(np.sin(angles) / HORIZON_SIN_RANGE, -1.0, 1.0) * 0.5 + 0.5
    q = np.rint(e * 255).astype(np.uint8)
    return q[..., :4], q[..., 4:]


def decode_horizon_sin(
    planes: np.ndarray, sun_east: np.ndarray, sun_north: np.ndarray
) -> np.ndarray:
    """Sine of the skyline toward `(sun_east, sun_north)` out of the two shipped
    planes' `HORIZON_AZIMUTHS` raw channels — the Python side of
    `encode_horizon`, mirroring `stellataHorizonSin` in the mesh shader."""
    turn = np.arctan2(sun_north, sun_east) / (2 * np.pi)
    slot = (turn - np.floor(turn)) * HORIZON_AZIMUTHS
    base = np.floor(slot)
    i0 = base.astype(np.intp) % HORIZON_AZIMUTHS
    i1 = (i0 + 1) % HORIZON_AZIMUTHS
    rows = np.arange(planes.shape[0])[:, None]
    cols = np.arange(planes.shape[1])[None, :]
    f = (slot - base).astype(np.float32)
    enc = planes[rows, cols, i0] * (1 - f) + planes[rows, cols, i1] * f
    return (enc / 255.0 * 2 - 1) * HORIZON_SIN_RANGE


def horizon_maps(elev: np.ndarray, spec: dict) -> tuple[np.ndarray, np.ndarray, dict]:
    """The two shipped planes for one body, plus its manifest row."""
    ang = horizon_angles(elev, spec, HORIZON_AZIMUTHS, HORIZON_TARGET_W)
    h = ang.shape[0]
    lat = np.radians(90.0 - (np.arange(h) + 0.5) * 180.0 / h)
    weights = np.repeat(np.cos(lat), ang.shape[1] * HORIZON_AZIMUTHS)
    deg = np.degrees(ang).ravel()
    a, b = encode_horizon(ang)
    stats = {
        "width": HORIZON_TARGET_W,
        "azimuths": HORIZON_AZIMUTHS,
        "medianHorizonDeg": round(weighted_quantile(deg, weights, 0.5), 3),
        "p99HorizonDeg": round(weighted_quantile(deg, weights, 0.99), 3),
        "clampedPct": round(
            float(100 * np.mean(np.abs(np.sin(ang)) > HORIZON_SIN_RANGE)), 4
        ),
    }
    return a, b, stats
