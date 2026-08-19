#!/usr/bin/env python3
"""Cast-shadow half of surface relief: per-texel horizon elevation in
HORIZON_AZIMUTHS directions, packed into two RGBA maps (rationale in
data/textures/relief/README.md § Cast shadows)."""

import numpy as np

from dem_relief import dem_target_w, roll_to_map_centre, weighted_quantile

HORIZON_AZIMUTHS = 8

# The output grid is HALF the DEM's width, and that ratio is load-bearing
# rather than a pair of independent constants. The observer's own elevation
# `r_p` is a box average over the output cell while every blocker is a
# bilinear sample of the DEM; at exactly 2 the bilinear sample at a cell
# centre IS that box average, to 2e-10 m. At any other ratio the observer
# smooths against sharp neighbours and the stored skyline biases upward in
# rough terrain (data/textures/relief/README.md § Cast shadows).
HORIZON_DEM_RATIO = 2


def horizon_target_w(spec: dict) -> int:
    return dem_target_w(spec) // HORIZON_DEM_RATIO


# Where the march begins, in OUTPUT texels. Ground closer than this is the
# normal map's, and a caster inside one output texel is half a colour-map texel
# — a shadow the screen has nothing to throw it with.
HORIZON_MARCH_START_TEXELS = 2.0

# Full-scale of the encoded horizon SINE, both signs. Wider than any body's own
# limb bound, which is where the negative side saturates on its own; the
# positive side has to reach a crater wall seen from its floor.
HORIZON_SIN_RANGE = 0.4


def decode_sin(raw: np.ndarray) -> np.ndarray:
    """Raw 0-255 channels back to the skyline sines they encode — the inverse of
    `encode_horizon`, shared by every reading of a shipped plane."""
    return (raw / 255.0 * 2 - 1) * HORIZON_SIN_RANGE


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


def march_start(out_width: int) -> float:
    """Central angle the march begins at — the closest blocker ever tested, and
    so the sole term in what flat ground at the reference sphere reads."""
    return HORIZON_MARCH_START_TEXELS * 2 * np.pi / out_width


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
    of the occluders and no slope anywhere can see the sun past it.

    **The march starts `HORIZON_MARCH_START_TEXELS` output texels out and steps
    at the DEM's resolution from there** — two independent choices. Starting
    further out hands the near field to the normal map; stepping finer than the
    output grid keeps a narrow ridge at range from being averaged away. Flat
    ground at the reference sphere therefore reads the START distance's own
    curvature drop rather than 0 — slack toward lighting, and `flat_floor` in
    `horizon_map.test.py` pins the closed form.

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
    psi_min = march_start(w_o)
    # Sampling inside psi_min is the defect the start distance exists to remove,
    # and a body whose search arc falls short of it would do exactly that.
    assert psi_max > psi_min, (
        f"search arc {psi_max:.6g} rad is inside the march start {psi_min:.6g} "
        f"at out_width={w_o}: every sample would be in the skipped near field"
    )
    step = 2 * np.pi / w_d
    steps = max(2, int(np.ceil((psi_max - psi_min) / step)) + 1)
    out = np.full((h_o, w_o, n_az), -np.pi / 2, dtype=np.float32)
    for a in range(n_az):
        phi = 2 * np.pi * a / n_az
        for k in range(steps):
            psi = psi_min + (psi_max - psi_min) * k / (steps - 1)
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
    return decode_sin(enc)


def horizon_maps(elev: np.ndarray, spec: dict) -> tuple[np.ndarray, np.ndarray, dict]:
    """The two shipped planes for one body, plus its manifest row."""
    ang = horizon_angles(elev, spec, HORIZON_AZIMUTHS, horizon_target_w(spec))
    h = ang.shape[0]
    lat = np.radians(90.0 - (np.arange(h) + 0.5) * 180.0 / h)
    weights = np.repeat(np.cos(lat), ang.shape[1] * HORIZON_AZIMUTHS)
    deg = np.degrees(ang).ravel()
    a, b = encode_horizon(ang)
    stats = {
        "width": horizon_target_w(spec),
        "azimuths": HORIZON_AZIMUTHS,
        "medianHorizonDeg": round(weighted_quantile(deg, weights, 0.5), 3),
        "p99HorizonDeg": round(weighted_quantile(deg, weights, 0.99), 3),
        "clampedPct": round(
            float(100 * np.mean(np.abs(np.sin(ang)) > HORIZON_SIN_RANGE)), 4
        ),
    }
    return a, b, stats
