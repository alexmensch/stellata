#!/usr/bin/env python3
"""What the relief terms light: ground past the terminator against the same
march at full DEM width, and the disc integral against phase. Manual, run by
hand; method and results in data/textures/relief/README.md § Cast shadows."""

import io
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from dem_relief import DEM_BODIES, POLE_CUTOFF_DEG, read_frozen_dem, surface_normals
from horizon_map import (
    HORIZON_AZIMUTHS,
    azimuth_lerp,
    decode_horizon_sin,
    decode_sin,
    encode_horizon,
    encode_sin,
    horizon_angles,
    horizon_target_w,
    march_start,
    search_arc,
)
from sky_view import decode_sky_view

TEXTURES = Path(__file__).resolve().parents[2] / "data" / "textures"
RELIEF = TEXTURES / "relief"
BINS = ((0, 2), (2, 5), (5, 10), (10, 20))
PHASE_ANGLES_DEG = (0, 90, 120, 150, 170)

# The output widths the sweep costs out against the shipped one.
WIDTH_RUNGS = (512, 1024, 2048)
AZIMUTH_CANDIDATES = (4, 8, 16)
# Reference azimuth count for the sweep. Divisible by every candidate, so each
# is a subset of ONE march rather than a march of its own, and all of them are
# read against the same angles.
AZIMUTH_REF = 48

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
ALBEDO = {"moon": 0.12, "mercury": 0.142, "mars": 0.170, "earth": 0.434}


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


def _terrain_view(body: str, planes: np.ndarray, factor: int) -> np.ndarray:
    """Cosine-weighted terrain fraction of each patch's sky, as the SHADER
    reads it: the shipped sky-view map where the body has one, and only where
    it does not the horizon planes' own `mean(max(sin h, 0)²)` fallback.

    Reading the fallback here while the renderer samples the map would measure
    the disc integral of a body we do not ship — and under-read it about
    twofold, which is the whole point of the separate artifact.
    """
    path = RELIEF / f"{body}-skyview.webp"
    if path.exists():
        raw = np.asarray(Image.open(path).convert("L")).astype(np.float32)
        return _upsample(decode_sky_view(raw), factor)
    s = np.maximum(decode_sin(planes), 0.0)
    return _upsample((s * s).mean(axis=2), factor)


def _shipped_planes(body: str) -> np.ndarray:
    """Both halves as one `(h, w, HORIZON_AZIMUTHS)` stack of raw channels."""
    halves = [
        np.asarray(Image.open(RELIEF / f"{body}-horizon-{half}.webp").convert("RGBA"))
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

    terrain_view = _terrain_view(body, planes, factor)
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
        # uPhaseScale is absent from every column because it rides the fill and
        # the direct term alike, so it cancels in the ratio these magnitudes are.
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


def _sun_field(h: np.ndarray, w: int):
    """Latitude per row, and the sun's direction in each texel's own tangent
    frame, for the sun in the body's equatorial plane. That places the bearing
    due east/west at every latitude on the terminator."""
    lat = np.radians(90.0 - (np.arange(h) + 0.5) * 180.0 / h)[:, None]
    dlon = np.radians((np.arange(w) + 0.5) * 360.0 / w - 180.0)[None, :]
    return (
        lat,
        np.cos(lat) * np.cos(dlon),
        -np.sin(dlon) * np.ones_like(lat),
        -np.sin(lat) * np.cos(dlon),
    )


def _facet_lit(
    elev: np.ndarray,
    spec: dict,
    sun_up: np.ndarray,
    sun_east: np.ndarray,
    sun_north: np.ndarray,
) -> np.ndarray:
    """Which texels the normal map alone turns toward the sun."""
    nrm, _ = surface_normals(elev, spec)
    n_e = (nrm[..., 0].astype(np.float32) / 255.0) * 2 - 1
    n_n = (nrm[..., 1].astype(np.float32) / 255.0) * 2 - 1
    n_z = np.sqrt(np.maximum(1 - n_e**2 - n_n**2, 0))
    return (n_e * sun_east + n_n * sun_north + n_z * sun_up) > 0


def _band(lat: np.ndarray, w: int, sun_up: np.ndarray, lo: float, hi: float):
    """Row mask, cos-lat weights and the texel selection for one solar-
    depression band, off the poles the normal map's derivative degenerates at."""
    keep = np.abs(np.degrees(lat[:, 0])) <= POLE_CUTOFF_DEG
    weight = np.repeat(np.cos(lat[keep, 0]), w).reshape(-1, w)
    depression = -np.degrees(np.arcsin(np.clip(sun_up, -1, 1)))
    return keep, weight, ((depression >= lo) & (depression < hi))[keep]


def _lit_pct(mask: np.ndarray, keep: np.ndarray, weight: np.ndarray, sel: np.ndarray):
    return 100 * weight[sel & mask[keep]].sum() / weight[sel].sum()


def measure(body: str) -> None:
    spec = DEM_BODIES[body]
    elev = read_frozen_dem(TEXTURES / "src" / spec["src"])
    h, w = elev.shape

    lat, sun_up, sun_east, sun_north = _sun_field(h, w)
    facet_lit = _facet_lit(elev, spec, sun_up, sun_east, sun_north)

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
    # The reference marches from the SHIPPED map's start distance rather than
    # from its own width's. Left to default it would begin at half that — the
    # near bound is `HORIZON_MARCH_START_TEXELS` OUTPUT texels, and the
    # reference's grid is twice as wide — so the gap between the columns would
    # be mostly start distance and only incidentally the output grid.
    reference = horizon_angles(
        elev, spec, 2, None, (march_start(planes.shape[1]), search_arc(spec))
    )
    sin_ref = np.sin(np.where(sun_east >= 0, reference[..., 0], reference[..., 1]))
    del reference

    # The reference column is this same march at the DEM's own width from the
    # same distance, so it shares the algorithm's first-step floor rather than
    # being ground truth — what it isolates is the OUTPUT grid and the encoding.
    columns = {
        "normal map only": facet_lit & (_smoothstep(-none, -full, sun_up) > 0),
        "+ horizon maps": facet_lit & (sun_up > sin_map),
        "full-DEM horizon": facet_lit & (sun_up > sin_ref),
    }

    print(f"\n{body}: lit area %, cos-lat weighted, |lat| <= {POLE_CUTOFF_DEG}")
    print("  depression  " + "  ".join(f"{k:>16}" for k in columns))
    for lo, hi in BINS:
        keep, weight, sel = _band(lat, w, sun_up, lo, hi)
        cells = (_lit_pct(m, keep, weight, sel) for m in columns.values())
        print(f"  {lo:>4}-{hi:<6}  " + "  ".join(f"{v:16.1f}" for v in cells))


def _pair_bytes(angles: np.ndarray) -> int:
    """Bytes the two planes take at this grid, encoded exactly as the build
    writes them — the size column is a measurement, not an estimate."""
    total = 0
    for plane in encode_horizon(angles):
        buf = io.BytesIO()
        Image.fromarray(plane, "RGBA").save(
            buf, "WEBP", lossless=True, exact=True, method=6
        )
        total += buf.tell()
    return total


def _vram_bytes(out_w: int) -> float:
    """RGBA8 resident with a full mip chain, both planes."""
    return out_w * (out_w // 2) * 4 * 2 * 4 / 3


def _azimuth_error_deg(ref: np.ndarray, n_az: int, weight: np.ndarray) -> float:
    """Mean skyline error of an `n_az` grid, in degrees, over the bearings it
    has to interpolate.

    Read against the same march evaluated exactly at those bearings, and only
    at the `AZIMUTH_REF` bearings NO candidate stores — a bearing a grid holds
    outright scores zero and would reward the denser grid for coincidence
    rather than accuracy. Interpolation runs in the sine the plane stores,
    which is where the shader does it, but the values are unquantised: this is
    the azimuth count's error alone, with the encoding's own floor left out.
    """
    stored = np.sin(ref[..., :: AZIMUTH_REF // n_az])
    finest = AZIMUTH_REF // max(AZIMUTH_CANDIDATES)
    total = 0.0
    for j in range(AZIMUTH_REF):
        if j % finest == 0:
            continue
        phi = 2 * np.pi * j / AZIMUTH_REF
        got = azimuth_lerp(
            stored,
            np.full(stored.shape[:2], np.cos(phi)),
            np.full(stored.shape[:2], np.sin(phi)),
        )
        err = np.abs(np.degrees(np.arcsin(np.clip(got, -1, 1)) - ref[..., j]))
        total += float((err * weight).sum())
    bearings = AZIMUTH_REF - AZIMUTH_REF // finest
    return total / (bearings * float(weight.sum()))


def _sweep_setup(body: str):
    """Everything both sweep halves read off the body: its DEM, the sun field,
    the normal map's own verdict, and the 0–2° band the tables are quoted in."""
    spec = DEM_BODIES[body]
    elev = read_frozen_dem(TEXTURES / "src" / spec["src"])
    h, w = elev.shape
    lat, sun_up, sun_east, sun_north = _sun_field(h, w)
    facet_lit = _facet_lit(elev, spec, sun_up, sun_east, sun_north)
    keep, weight, sel = _band(lat, w, sun_up, *BINS[0])
    due_east = np.where(sun_east >= 0, 1.0, -1.0) * np.ones_like(sun_up)
    return spec, elev, w, sun_up, facet_lit, keep, weight, sel, due_east


def sweep_width(body: str) -> None:
    """What each output width lights, costs on disk, and costs in VRAM — the
    width table in data/textures/relief/README.md § Cast shadows."""
    spec, elev, w, sun_up, facet_lit, keep, weight, sel, due_east = _sweep_setup(body)
    lo, hi = BINS[0]

    # `march_start` is defined in OUTPUT texels, so a narrower grid also begins
    # its march further out — 42.6 km at 512 against 10.7 at 2048 on the Moon.
    # The shipped column is that coupled answer, which is what a rung would
    # actually ship; the pinned column repeats it with every width marching from
    # the SHIPPED start distance, which is the only way to read the output
    # grid's own contribution off the pair.
    pinned = (march_start(horizon_target_w(spec)), search_arc(spec))
    print(f"\n{body}: output width, {HORIZON_AZIMUTHS} azimuths")
    print(f"  width   start km   lit {lo}-{hi}deg   same start   pair MB   VRAM MB")
    for out_w in WIDTH_RUNGS:
        cells = []
        for rng in (None, pinned):
            ang = horizon_angles(elev, spec, HORIZON_AZIMUTHS, out_w, rng)
            gate = _horizon_gate(
                encode_sin(ang).astype(np.float32),
                due_east,
                np.zeros_like(due_east),
                w // out_w,
            )
            cells.append(_lit_pct(facet_lit & (sun_up > gate), keep, weight, sel))
            if rng is None:
                pair_mb = _pair_bytes(ang) / 1e6
            del ang, gate
        km = march_start(out_w) * spec["radius_km"]
        print(f"  {out_w:>5}  {km:>9.1f}  {cells[0]:>12.1f}  {cells[1]:>11.1f}"
              f"  {pair_mb:>8.1f}  {_vram_bytes(out_w) / 1e6:>8.1f}")


def sweep_azimuths(body: str) -> None:
    """What each azimuth count costs in skyline accuracy — the azimuth table in
    data/textures/relief/README.md § Cast shadows. Slow: it marches
    `AZIMUTH_REF` directions so every candidate is a subset of one march."""
    spec, elev, w, sun_up, facet_lit, keep, weight, sel, due_east = _sweep_setup(body)
    lo, hi = BINS[0]
    out_w = horizon_target_w(spec)
    ref = horizon_angles(elev, spec, AZIMUTH_REF, out_w)
    out_h = out_w // 2
    row_weight = np.cos(
        np.radians(90.0 - (np.arange(out_h) + 0.5) * 180.0 / out_h)
    )[:, None] * np.ones(out_w)
    print(f"\n{body}: azimuth count at width {out_w}")
    print(f"  azimuths   mean err deg   lit {lo}-{hi}deg, on-axis   worst-case bearing")
    for n_az in AZIMUTH_CANDIDATES:
        step = AZIMUTH_REF // n_az
        cells = []
        # Offsetting the STORED grid by half a step, rather than steering the
        # sun, is what puts the bearing exactly between two samples while every
        # other term of the comparison holds still.
        for offset in (0, step // 2):
            phi = 2 * np.pi * offset / AZIMUTH_REF
            gate = _horizon_gate(
                encode_sin(ref[..., offset::step]).astype(np.float32),
                due_east * np.cos(phi),
                -due_east * np.sin(phi),
                w // out_w,
            )
            cells.append(_lit_pct(facet_lit & (sun_up > gate), keep, weight, sel))
        err = _azimuth_error_deg(ref, n_az, row_weight)
        print(f"  {n_az:>8}   {err:>12.2f}   {cells[0]:>21.1f}   {cells[1]:>18.1f}")


if __name__ == "__main__":
    flags = {a for a in sys.argv[1:] if a.startswith("-")}
    for name in [a for a in sys.argv[1:] if not a.startswith("-")] or list(DEM_BODIES):
        if flags & {"--sweep", "--sweep-width"}:
            sweep_width(name)
        if flags & {"--sweep", "--sweep-azimuths"}:
            sweep_azimuths(name)
        if not flags:
            measure(name)
            phase_curve(name)
