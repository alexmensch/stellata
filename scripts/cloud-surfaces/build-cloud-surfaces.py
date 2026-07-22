#!/usr/bin/env python3
"""Build data/molecular-clouds/cloud-surfaces.bin: per-cloud isosurface
meshes traced from the Edenhofer 2023 dust posterior mean, keyed by cloud
sid. See scripts/cloud-surfaces/README.md."""

import argparse
import json
import struct
import sys
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
CLOUDS_JSON = REPO / "public" / "clouds.json"
OUT_PATH = REPO / "data" / "molecular-clouds" / "cloud-surfaces.bin"

MAGIC = b"CSUR"
VERSION = 2

# Density-brick budget: the sampled volume ships (mean-pooled to fit)
# as a per-cloud uint8 3D texture so the runtime absorption raymarch
# integrates the SAME field the isosurface was traced from. Runtime GPU
# cost: 3D-texture VRAM per cloud grows as the cube of this.
MAX_BRICK_DIM = 72

# Sampling: ~0.5 pc inside each cloud's bbox (well below the 4.88 pc
# runtime voxel grid — the dustmaps GP posterior is queried directly),
# coarsening only for the larger clouds so no grid exceeds MAX_GRID_DIM
# per axis. MAX_GRID_DIM caps offline query cost (∝ dim³), not runtime.
STEP_PC = 0.5
MAX_GRID_DIM = 256
QUERY_BATCH = 2_000_000

# Envelope taper: density fades to zero over u ∈ [0.95, 1.05] of the
# Zucker ellipsoid so every surface closes inside the bbox and dust from
# a neighbouring cloud can't leak in.
ENVELOPE_LO = 0.95
ENVELOPE_HI = 1.05

# Iso-level calibration: per-cloud fraction of the in-envelope p99
# density, floored at a physical minimum (0.005 E_ZGR/pc ≈ 0.014 mag/pc
# A_V ≈ n_H 8 cm⁻³ — below any molecular boundary, so the floor only
# rejects clouds where Edenhofer sees essentially nothing).
ISO_FRAC = 0.25
ISO_FLOOR = 0.005

# Per-cloud floor overrides (by cloud id) for weak globules + distant HII
# regions the global ISO_FLOOR rejects but that carry a genuine — if faint
# — Edenhofer signal at their distance (out-of-grid clouds sample the
# noisier 2 kpc flavor, so their peaks read lower). Each floor is ~half the
# cloud's in-envelope peak, tracing the dense knot while staying above the
# diffuse-noise pedestal. Clouds with no real signal are deliberately
# absent (Carina, IC 2944, RCW38, the CB/LBN/Draco globules — they keep
# their ellipsoid fallback).
ISO_FLOOR_OVERRIDES: dict[str, float] = {
    "w4": 0.0023,       # W4
    "gem-ob1": 0.00175, # Gem OB1
    "m17": 0.0018,      # Omega Nebula
    "rosette": 0.0016,  # Rosette
    "ggd4": 0.0021,     # GGD4
    "m16": 0.0008,      # Eagle Nebula
    "ic-443": 0.0007,   # Jellyfish Nebula
    "m20": 0.0022,      # Trifid Nebula
    "l1251": 0.0022,    # L1251
    "l1355": 0.00185,   # L1355
    "l1307": 0.0014,    # L1307
    "l1335": 0.0013,    # L1335
    "lbn991": 0.00145,  # LBN991
    "lacerta": 0.0013,  # Lacerta
}

TARGET_TRIS = 6000
SMOOTH_ITERS = 6
# Drop disconnected speckle components below this share of a cloud's
# faces (tiny isolated blobs read as noise rims).
MIN_COMPONENT_FRAC = 0.02
MIN_COMPONENT_FACES = 50


def quat_to_matrix(q):
    """[qx,qy,qz,qw] → 3×3 rotation matrix (local → ICRS)."""
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def load_query(flavor="main"):
    from dustmaps.edenhofer2023 import Edenhofer2023Query
    return Edenhofer2023Query(flavor=flavor)


def query_for(cache, cloud):
    """Lazily load + memoise the Edenhofer flavor a cloud samples from:
    in-grid clouds use the cleaner 1.25 kpc 'main' posterior; out-of-grid
    clouds use the noisier 'less_data_but_2kpc' flavor that reaches 2 kpc."""
    flavor = "main" if cloud["inGrid"] else "less_data_but_2kpc"
    if flavor not in cache:
        print(f"  loading Edenhofer query (flavor={flavor})…")
        cache[flavor] = load_query(flavor)
    return cache[flavor]


def query_density(query, xyz):
    """Edenhofer mean density (E_ZGR pc⁻¹) at (n,3) ICRS pc points."""
    import astropy.units as u
    from astropy.coordinates import SkyCoord
    out = np.zeros(len(xyz))
    for lo in range(0, len(xyz), QUERY_BATCH):
        chunk = xyz[lo:lo + QUERY_BATCH]
        c = SkyCoord(
            x=chunk[:, 0] * u.pc, y=chunk[:, 1] * u.pc, z=chunk[:, 2] * u.pc,
            frame="icrs", representation_type="cartesian",
        )
        d = np.asarray(query(c), dtype=np.float64)
        out[lo:lo + len(chunk)] = np.nan_to_num(d, nan=0.0)
    return out


def sample_cloud(query, cloud):
    """Density grid over the cloud's world-frame AABB, envelope-tapered.
    Returns (volume [nx,ny,nz], aabb_min, step, u_ell [nx,ny,nz])."""
    center = np.array(cloud["center"])
    axes = np.array(cloud["axes"])
    rot = quat_to_matrix(cloud["quat"])
    # Half-extent of the rotated ellipsoid along each world axis.
    half = np.sqrt(((rot * axes[None, :]) ** 2).sum(axis=1)) * ENVELOPE_HI
    step = max(STEP_PC, 2 * half.max() / MAX_GRID_DIM)
    dims = np.maximum(np.ceil(2 * half / step).astype(int) + 1, 2)
    aabb_min = center - half
    ix = aabb_min[0] + np.arange(dims[0]) * step
    iy = aabb_min[1] + np.arange(dims[1]) * step
    iz = aabb_min[2] + np.arange(dims[2]) * step
    gx, gy, gz = np.meshgrid(ix, iy, iz, indexing="ij")
    pts = np.stack([gx.ravel(), gy.ravel(), gz.ravel()], axis=-1)

    local = (pts - center) @ rot  # R^T (x − c)
    u_ell = np.linalg.norm(local / axes, axis=1)
    rho = query_density(query, pts)
    t = np.clip((u_ell - ENVELOPE_LO) / (ENVELOPE_HI - ENVELOPE_LO), 0, 1)
    rho *= 1 - t * t * (3 - 2 * t)
    return rho.reshape(dims), aabb_min, step, u_ell.reshape(dims)


def largest_components(faces, min_faces):
    """Faces of connected components with ≥ min_faces faces (union-find
    over shared vertices)."""
    parent = np.arange(faces.max() + 1)

    def find(a):
        root = a
        while parent[root] != root:
            root = parent[root]
        while parent[a] != root:
            parent[a], a = root, parent[a]
        return root

    for f in faces:
        r0, r1, r2 = find(f[0]), find(f[1]), find(f[2])
        parent[r1] = r0
        parent[r2] = r0
    roots = np.array([find(f[0]) for f in faces])
    keep = np.zeros(len(faces), dtype=bool)
    for root, count in zip(*np.unique(roots, return_counts=True)):
        if count >= min_faces:
            keep |= roots == root
    return faces[keep]


def taubin_smooth(verts, faces, iters):
    """Taubin λ|μ smoothing (volume-preserving, unlike plain Laplacian)."""
    n = len(verts)
    edges = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    edges = np.unique(np.sort(edges, axis=1), axis=0)
    deg = np.bincount(edges.ravel(), minlength=n).astype(np.float64)
    deg[deg == 0] = 1
    v = verts.astype(np.float64)
    for lam in [0.5, -0.53] * iters:
        acc = np.zeros_like(v)
        np.add.at(acc, edges[:, 0], v[edges[:, 1]])
        np.add.at(acc, edges[:, 1], v[edges[:, 0]])
        v += lam * (acc / deg[:, None] - v)
    return v


def orient_outward(verts, faces):
    """Flip winding if the mesh's signed volume is negative (normals must
    point outward for the renderer's FrontSide hide-when-inside cull)."""
    v0, v1, v2 = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
    signed = np.einsum("ij,ij->i", v0, np.cross(v1, v2)).sum() / 6.0
    return faces[:, ::-1].copy() if signed < 0 else faces


def build_brick(volume, aabb_min, step):
    """Mean-pool the sampled volume to ≤ MAX_BRICK_DIM per axis and
    encode linear uint8 against the per-cloud max. Returns
    (data u8 [x-major ravel], dims, brick_aabb_min, brick_step, dmax)."""
    from skimage.measure import block_reduce
    factor = max(1, int(np.ceil(max(volume.shape) / MAX_BRICK_DIM)))
    pooled = block_reduce(volume, (factor, factor, factor), np.mean) \
        if factor > 1 else volume
    dmax = float(pooled.max())
    scale = 255.0 / dmax if dmax > 0 else 0.0
    data = np.clip(np.rint(pooled * scale), 0, 255).astype(np.uint8)
    # Pooled sample k averages source points [k·f, (k+1)·f) — its
    # effective position is aabb_min + (k·f + (f−1)/2)·step.
    brick_aabb_min = aabb_min + (factor - 1) / 2 * step
    return data, pooled.shape, brick_aabb_min, factor * step, dmax


def build_mesh(volume, iso, aabb_min, step):
    from skimage import measure
    import fast_simplification
    verts, faces, _, _ = measure.marching_cubes(volume, level=iso, spacing=(step, step, step))
    faces = largest_components(
        faces, max(MIN_COMPONENT_FACES, int(len(faces) * MIN_COMPONENT_FRAC)))
    if len(faces) == 0:
        return None
    used = np.unique(faces)
    remap = np.zeros(verts.shape[0], dtype=np.int64)
    remap[used] = np.arange(len(used))
    verts, faces = verts[used], remap[faces]
    verts = taubin_smooth(verts, faces, SMOOTH_ITERS)
    if len(faces) > TARGET_TRIS:
        verts, faces = fast_simplification.simplify(
            verts.astype(np.float32), faces.astype(np.int64),
            target_count=TARGET_TRIS)
    faces = orient_outward(np.asarray(verts, dtype=np.float64),
                           np.asarray(faces, dtype=np.int64))
    positions = (np.asarray(verts, dtype=np.float64) + aabb_min).astype(np.float32)
    return positions, np.asarray(faces, dtype=np.uint32).ravel()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="Build a single cloud by id (debug).")
    ap.add_argument("--dry-run", action="store_true",
                    help="Trace + report, write nothing.")
    args = ap.parse_args()

    if not CLOUDS_JSON.exists():
        sys.exit("public/clouds.json missing — run `pnpm run build:clouds` first.")
    catalog = json.loads(CLOUDS_JSON.read_text())
    if catalog.get("version") != 3:
        sys.exit(f"clouds.json version {catalog.get('version')} unsupported.")
    clouds = catalog["clouds"]
    if args.only:
        clouds = [c for c in clouds if c["id"] == args.only]
    for c in clouds:
        if "sid" not in c:
            sys.exit(f"cloud {c['id']} has no sid — run `pnpm run build:clouds`.")

    n_in = sum(c["inGrid"] for c in clouds)
    print(f"tracing {len(clouds)} clouds of {catalog['count']} "
          f"({n_in} in-grid main flavor + {len(clouds) - n_in} out-of-grid "
          f"2 kpc flavor)")
    queries: dict = {}

    entries = []
    skipped = []
    for c in clouds:
        query = query_for(queries, c)
        volume, aabb_min, step, u_ell = sample_cloud(query, c)
        inside = volume[u_ell < 1.0]
        peak = float(np.percentile(inside, 99)) if inside.size else 0.0
        iso = max(ISO_FLOOR_OVERRIDES.get(c["id"], ISO_FLOOR), ISO_FRAC * peak)
        if volume.max() <= iso:
            skipped.append(c["id"])
            print(f"  {c['name']:<24} step {step:4.2f}  p99 {peak:.4f}  "
                  f"max {float(volume.max()):.4f}  iso {iso:.4f}  "
                  f"— no surface (ellipsoid fallback)")
            continue
        mesh = build_mesh(volume, iso, aabb_min, step)
        if mesh is None:
            skipped.append(c["id"])
            print(f"  {c['name']:<24} step {step:4.2f}  p99 {peak:.4f}  "
                  f"— empty after speckle cut")
            continue
        positions, indices = mesh
        brick = build_brick(volume, aabb_min, step)
        entries.append((c["sid"], positions, indices, brick))
        bd = brick[1]
        print(f"  {c['name']:<24} step {step:4.2f}  p99 {peak:.4f}  iso {iso:.4f}  "
              f"{len(positions)} verts  {len(indices) // 3} tris  "
              f"brick {bd[0]}x{bd[1]}x{bd[2]}")

    total = sum(len(p) * 12 + len(i) * 4 + b[0].size
                for _, p, i, b in entries)
    print(f"{len(entries)} surfaces, {len(skipped)} fallbacks, "
          f"payload {total / 1024:.0f} KiB")
    if args.dry_run:
        return

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "wb") as f:
        f.write(MAGIC)
        f.write(struct.pack("<III", VERSION, len(entries), 0))
        for sid, positions, indices, brick in entries:
            data, dims, bmin, bstep, dmax = brick
            f.write(struct.pack("<III", sid, len(positions), len(indices)))
            f.write(struct.pack("<III", *dims))
            f.write(struct.pack("<fff", *bmin.tolist()))
            f.write(struct.pack("<ff", bstep, dmax))
        for _, positions, indices, brick in entries:
            f.write(positions.tobytes())
            f.write(indices.tobytes())
            # x-fastest ravel: WebGL 3D-texture layout (index = x + y·w + z·w·h).
            f.write(brick[0].transpose(2, 1, 0).tobytes())
    print(f"wrote {OUT_PATH.relative_to(REPO)} ({OUT_PATH.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
