#!/usr/bin/env python3
"""Build public/local-bubble.bin (shell mesh) from the Zucker 2022 wall-
distance HEALPix map, cross-checked against the Edenhofer dust grid.
See scripts/local-bubble/README.md."""

import argparse
import json
import struct
import sys
from pathlib import Path

import numpy as np
import healpy as hp
from astropy.coordinates import SkyCoord
from astropy.io import fits
import astropy.units as u

REPO = Path(__file__).resolve().parents[2]
FITS_PATH = REPO / "data" / "local-bubble" / "zucker2022-inner-surface.fits"
# Committed product (LFS), like the dust grid — sync-local-bubble.ts copies
# it to public/ at build time so deploy needs no astro-Python.
OUT_PATH = REPO / "data" / "local-bubble" / "local-bubble.bin"
DUST_DIR = REPO / "data" / "dust"

MAGIC = b"LBUB"
VERSION = 1


def load_wall_radii(column: str) -> tuple[np.ndarray, int]:
    """HEALPix RING map of wall distance (pc) for `column`, plus nside."""
    with fits.open(FITS_PATH) as h:
        r = np.asarray(h[1].data[column], dtype=np.float64)
    return r, hp.npix2nside(len(r))


def galactic_dirs_to_icrs(l_deg: np.ndarray, b_deg: np.ndarray) -> np.ndarray:
    """(n,) galactic l,b in degrees -> (n,3) ICRS unit vectors, the catalog
    frame's convention (x at ra=0/dec=0, z at dec=+90)."""
    c = SkyCoord(l=l_deg * u.deg, b=b_deg * u.deg, frame="galactic").icrs.cartesian
    return np.stack([c.x.value, c.y.value, c.z.value], axis=-1)


def build_mesh(r_map: np.ndarray, n_lat: int, n_lon: int):
    """Resample the wall map onto an (n_lat+1) x n_lon lat-long grid and
    triangulate. Returns (positions f32 (V,3), indices u32 (T*3,), centroid)."""
    # Ring lat lines b in [-90, 90] inclusive (poles collapse per-lon —
    # degenerate tris there are dropped by computeVertexNormals); lon wraps.
    b = np.linspace(-90.0, 90.0, n_lat + 1)
    l = np.linspace(0.0, 360.0, n_lon, endpoint=False)
    bb, ll = np.meshgrid(b, l, indexing="ij")  # (n_lat+1, n_lon)
    flat_l, flat_b = ll.ravel(), bb.ravel()
    # Bilinear HEALPix interpolation of the wall distance at each grid dir.
    theta = np.radians(90.0 - flat_b)
    phi = np.radians(flat_l)
    radius = hp.get_interp_val(r_map, theta, phi)  # pc
    dirs = galactic_dirs_to_icrs(flat_l, flat_b)
    positions = (dirs * radius[:, None]).astype(np.float32)

    rows, cols = n_lat + 1, n_lon
    tris = []
    for i in range(rows - 1):
        for j in range(cols):
            jn = (j + 1) % cols
            a = i * cols + j
            b_ = i * cols + jn
            c = (i + 1) * cols + j
            d = (i + 1) * cols + jn
            tris.append((a, c, b_))
            tris.append((b_, c, d))
    faces = np.asarray(tris, dtype=np.uint32)
    # Orient winding so face normals point OUTWARD (away from the Sun). The
    # surface is star-shaped from the origin, so outward ≈ the face-centre
    # direction. FrontSide culling then hides the shell when the camera is
    # inside it (the common view at Sol) — matching the heliopause.
    p = positions.astype(np.float64)
    v0, v1, v2 = p[faces[:, 0]], p[faces[:, 1]], p[faces[:, 2]]
    fnorm = np.cross(v1 - v0, v2 - v0)
    fcen = (v0 + v1 + v2) / 3.0
    if np.sum(fnorm * fcen) < 0.0:
        faces = faces[:, ::-1].copy()  # reverse winding globally
    indices = faces.ravel()
    centroid = positions.mean(axis=0).astype(np.float32)
    return positions, indices, centroid


def dust_crosscheck(r_map: np.ndarray, nside: int) -> None:
    """Assert the independent Edenhofer dust grid peaks at this wall."""
    m = json.loads((DUST_DIR / "manifest.json").read_text())
    N, CS = m["gridSize"], m["chunkSize"]
    lo, _ = m["boundsPc"]
    vs = m["voxelSizePc"]
    dmin, dmax = m["densityMin"], m["densityMax"]
    grid = np.zeros((N, N, N), dtype=np.uint8)  # [z, y, x]
    for c in m["chunks"]:
        blk = np.fromfile(DUST_DIR / c["file"], dtype=np.uint8).reshape(CS, CS, CS)
        ix, iy, iz = c["ix"], c["iy"], c["iz"]
        grid[iz * CS:(iz + 1) * CS, iy * CS:(iy + 1) * CS, ix * CS:(ix + 1) * CS] = blk

    def density_at(p: np.ndarray) -> np.ndarray:
        idx = np.floor((p - lo) / vs).astype(int)
        ok = np.all((idx >= 0) & (idx < N), axis=1)
        out = np.zeros(len(p))
        gi = idx[ok]
        u8 = grid[gi[:, 2], gi[:, 1], gi[:, 0]].astype(float)
        out[ok] = dmin * (dmax / dmin) ** (u8 / 255.0)
        return out

    rng = np.random.default_rng(0)
    samp = rng.choice(len(r_map), 4000, replace=False)
    lg, bg = hp.pix2ang(nside, samp, lonlat=True)
    dirs = galactic_dirs_to_icrs(lg, bg)
    radius = r_map[samp]
    frac = np.linspace(0.4, 1.4, 26)
    prof = np.array([density_at(dirs * (radius * f)[:, None]) for f in frac])
    peak = frac[prof.argmax(axis=0)]
    med = float(np.median(peak))
    print(f"dust cross-check: per-ray peak-density radius median={med:.2f} R "
          f"(mean={peak.mean():.2f} R, >=0.9 R: {(peak >= 0.9).mean() * 100:.0f}%)")
    if not (0.85 <= med <= 1.05):
        sys.exit(f"ERROR: dust wall ({med:.2f} R) does not track the surface — "
                 "frame/scale/units regression in the ingest.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--column", default="r_in_lmax-08",
                    help="FITS wall-distance column (SH truncation).")
    ap.add_argument("--n-lat", type=int, default=96)
    ap.add_argument("--n-lon", type=int, default=192)
    ap.add_argument("--skip-crosscheck", action="store_true")
    args = ap.parse_args()

    r_map, nside = load_wall_radii(args.column)
    print(f"wall map: {args.column}  nside={nside}  "
          f"R min/mean/max = {r_map.min():.0f}/{r_map.mean():.0f}/{r_map.max():.0f} pc")
    if not args.skip_crosscheck:
        dust_crosscheck(r_map, nside)

    positions, indices, centroid = build_mesh(r_map, args.n_lat, args.n_lon)
    print(f"mesh: {len(positions)} vertices, {len(indices) // 3} triangles, "
          f"centroid ICRS = ({centroid[0]:.0f}, {centroid[1]:.0f}, {centroid[2]:.0f}) pc")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "wb") as f:
        f.write(MAGIC)
        f.write(struct.pack("<III", VERSION, len(positions), len(indices)))
        f.write(struct.pack("<fff", *centroid.tolist()))
        f.write(struct.pack("<I", 0))  # reserved
        f.write(positions.tobytes())
        f.write(indices.tobytes())
    print(f"wrote {OUT_PATH.relative_to(REPO)} ({OUT_PATH.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
