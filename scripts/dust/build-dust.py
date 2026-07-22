#!/usr/bin/env python3
"""Resample the Edenhofer+ 2023 3D dust map onto a Cartesian voxel grid
and emit it as 64 chunks for progressive client-side loading. See
scripts/dust/README.md for grid params, encoding, and CLI usage."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "clouds"))
import cloud_model  # noqa: E402

# Canonical grid params — changing any of these is a format version bump.
GRID_SIZE = 512
CHUNK_SIZE = 128
CHUNKS_PER_AXIS = GRID_SIZE // CHUNK_SIZE   # 4
BOUNDS_PC = cloud_model.DUST_GRID_HALF_EXTENT_PC  # half-extent; full cube is 2*bounds
VOXEL_SIZE_PC = 2.0 * BOUNDS_PC / GRID_SIZE  # ≈ 4.883

# Encoding params. DENSITY_MIN is fixed below the real-data noise floor;
# DENSITY_MAX is a fixed ceiling covering the raw Edenhofer peak with
# headroom (grid max 0.135 E_ZGR/pc, in the rho Oph core). The previous
# 99.95th-percentile autotune (0.0053) silently clipped dense molecular
# cloud cores 25x — peak cloud columns encoded at 0.06-0.6 mag A_V where
# the raw field carries 0.8-2.7 mag (docs/science-molecular-clouds.md § 2.2).
# The build asserts the ceiling still covers the data each run.
# Synthetic mode uses the same DENSITY_MIN and a fixed DENSITY_MAX matching
# the real-data scale, so both pipelines share a single shader decode.
DENSITY_MIN = 1e-7
DENSITY_MAX_SYNTHETIC = 0.1
DENSITY_MAX_REAL = 0.2
DENSITY_MAX_HEADROOM = 1.2

# Particle cloud — for visualising dust as discrete additive billboards
# (replaces the fullscreen raymarch fog, which had unfixable banding/
# jitter at far zoom). Particles are importance-sampled with probability
# proportional to voxel density: dense regions get many particles, diffuse
# regions get few or none. The result is a smooth-looking cloud with no
# voxel aliasing because adjacent particles are at different sub-voxel
# positions (per-particle jitter).
PARTICLE_COUNT_DEFAULT = 50_000
# Voxels below this density threshold contribute no particles — keeps the
# sampling concentrated where there's actually visible structure.
PARTICLE_DENSITY_THRESHOLD = 1e-6

# A_V-per-E_ZGR conversion (cloud_model.ZGR_TO_AV) is applied at runtime in
# the shader / manifest, never baked into the stored density.
# Sanity check: Aquila Rift at ~200 pc, peak density ~0.05 E_ZGR/pc,
# sightline 200 pc → 10 E_ZGR → 27 mag A_V peak-through-the-densest-filament
# (matches published values; most real sightlines clip far below this).

DATA_DUST = ROOT / "data" / "dust"
PUBLIC_DUST = ROOT / "public" / "dust"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--synthetic", action="store_true",
                        help="Generate a test-pattern voxel grid without any real data.")
    parser.add_argument("--flavor", default="main", choices=["main", "less_data_but_2kpc"],
                        help="Edenhofer map flavor: 'main' is 1.25 kpc standard, "
                             "'less_data_but_2kpc' is a validation run extending to 2 kpc.")
    parser.add_argument("--output", type=Path, default=DATA_DUST,
                        help=f"Output directory for chunks + manifest (default: {DATA_DUST.relative_to(ROOT)}).")
    parser.add_argument("--skip-public", action="store_true",
                        help="Skip mirroring to public/dust/ (useful for alt output dirs).")
    parser.add_argument("--force-resample", action="store_true",
                        help="Ignore any cached .voxels.npy and re-run the full resample.")
    parser.add_argument("--particle-count", type=int, default=PARTICLE_COUNT_DEFAULT,
                        help=f"Number of dust particles to emit (default: {PARTICLE_COUNT_DEFAULT}).")
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)

    zucker_report = None
    if args.synthetic:
        print("Generating synthetic test-pattern dust grid…", file=sys.stderr)
        voxels = make_synthetic_grid()
        density_max = DENSITY_MAX_SYNTHETIC
    else:
        # Cache the raw resampled float32 grid (~512 MiB, gitignored) so
        # re-encoding after tweaking DENSITY_MAX etc. doesn't require
        # re-running the 10-minute query phase. Delete it manually to force
        # a fresh resample.
        cache_path = args.output / ".voxels.npy"
        if cache_path.exists() and not args.force_resample:
            print(f"Loading cached voxel grid from {cache_path.relative_to(ROOT)}…", file=sys.stderr)
            voxels = np.load(cache_path)
        else:
            print(f"Fetching + resampling Edenhofer 2023 dust map (flavor={args.flavor})…", file=sys.stderr)
            voxels = resample_edenhofer(flavor=args.flavor)
            print(f"Saving raw grid cache to {cache_path.relative_to(ROOT)}…", file=sys.stderr)
            np.save(cache_path, voxels)
        zucker_report = zucker_column_check(voxels)
        density_max = DENSITY_MAX_REAL

    # Encode float densities → uint8 via pure-log scaling over
    # [DENSITY_MIN, density_max]. The shader inverts this; manifest carries
    # both ends so the decode constants match.
    encoded = encode_log_uint8(voxels, DENSITY_MIN, density_max)
    nonzero_mean = voxels[voxels > 0].mean() if (voxels > 0).any() else 0.0
    print(f"Encoded density: raw {voxels.min():.6f}..{voxels.max():.6f}  "
          f"(nonzero mean {nonzero_mean:.6f}); "
          f"uint8 {int(encoded.min())}..{int(encoded.max())}; "
          f"log window [{DENSITY_MIN:.0e}, {density_max:.6f}]", file=sys.stderr)

    # Write chunks + manifest to `args.output`. Then mirror into public/dust/
    # so Vite and the Cloudflare asset build see them; data/dust/ remains
    # the canonical LFS-tracked source.
    chunks = write_chunks(encoded, args.output)

    # Particle cloud — importance-sampled from the float voxel grid (not
    # the encoded uint8) so dense cores get representative particle density.
    print(f"Sampling {args.particle_count} dust particles…", file=sys.stderr)
    particles = sample_particles(voxels, args.particle_count)
    write_particles(particles, args.output / "particles.bin")
    print(f"Wrote particles.bin ({particles.shape[0]} particles, "
          f"{(particles.shape[0] * 16 + 16) / 1024:.1f} KiB)", file=sys.stderr)

    manifest = build_manifest(
        chunks, synthetic=args.synthetic, density_max=density_max,
        particle_count=int(particles.shape[0]), zucker=zucker_report,
    )
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {len(chunks)} chunks + manifest to {args.output.relative_to(ROOT)}/", file=sys.stderr)

    if not args.skip_public and args.output == DATA_DUST:
        copy_to_public()

    return 0


def _peak_column_av(voxels: np.ndarray, cloud, rot: np.ndarray,
                    offset_step_pc: float = 2.0, n_samples: int = 201) -> float:
    """Peak A_V column through the raw grid across the cloud's bounding
    ellipsoid, along the local shortest axis (trilinear, trapezoid) —
    mirrors the shader's raymarch geometry."""
    axes = np.array(cloud.axes_gal, dtype=np.float64)
    center = np.array(cloud.center_icrs, dtype=np.float64)
    k_min = int(np.argmin(axes))
    perp = [i for i in range(3) if i != k_min]
    s_min = float(axes.min())
    o1 = np.arange(-axes[perp[0]], axes[perp[0]] + 1e-9, offset_step_pc)
    o2 = np.arange(-axes[perp[1]], axes[perp[1]] + 1e-9, offset_step_pc)
    t = np.linspace(-s_min, s_min, n_samples)

    off = np.zeros((len(o1), len(o2), 3))
    off[..., perp[0]] = o1[:, None]
    off[..., perp[1]] = o2[None, :]
    e_chord = np.zeros(3)
    e_chord[k_min] = 1.0
    # chord points: (n1, n2, nl, 3) in ICRS
    pts = (off[:, :, None, :] + t[None, None, :, None] * e_chord) @ rot.T + center

    g = np.clip((pts + BOUNDS_PC) / VOXEL_SIZE_PC - 0.5, 0.0, GRID_SIZE - 1.001)
    i0 = np.floor(g).astype(np.int64)
    f = g - i0
    acc = np.zeros(pts.shape[:-1])
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = ((f[..., 0] if dx else 1 - f[..., 0])
                     * (f[..., 1] if dy else 1 - f[..., 1])
                     * (f[..., 2] if dz else 1 - f[..., 2]))
                acc += w * voxels[i0[..., 0] + dx, i0[..., 1] + dy, i0[..., 2] + dz]
    cols = np.trapezoid(acc, t, axis=-1) * cloud_model.ZGR_TO_AV
    return float(cols.max())


def zucker_column_check(voxels: np.ndarray) -> dict:
    """Compare peak extinction columns through the raw Edenhofer field
    against the Zucker 2021 Leike-resolution peak columns, per profiled
    cloud. Read-only: per-star extinction reads pure Edenhofer — the
    real reconstruction carries each cloud's morphology (cores sit
    off-centre in their bboxes), and the analytic cloud model in
    clouds.json drives only the presence pass. The ratios below run
    0.3–1.0 with the fixed DENSITY_MAX ceiling, consistent with 1 pc →
    4.9 pc beam dilution of the Leike peaks (docs/science-molecular-clouds.md § 4).
    Also asserts the encode ceiling covers the data."""
    cm = cloud_model
    rot = np.array(cm.GAL_TO_ICRS, dtype=np.float64)
    report: list[dict] = []
    for cloud in cm.profiled_clouds():
        peak_av = _peak_column_av(voxels, cloud, rot)
        ratio = peak_av / cloud.av_column_target
        report.append({
            "cloud": cloud.raw_name,
            "avColumnTargetLeike": round(cloud.av_column_target, 3),
            "avPeakColumnEdenhofer": round(peak_av, 3),
            "ratio": round(ratio, 3),
        })
        print(f"  zucker-check {cloud.raw_name:12} peak column "
              f"{peak_av:5.2f} / target {cloud.av_column_target:5.2f} mag "
              f"({ratio:4.2f}x)", file=sys.stderr)
        assert ratio >= 0.03, \
            f"{cloud.raw_name}: peak column {peak_av:.2f} mag is <3% of the " \
            f"Leike target — encoding or resample regression"

    grid_max = float(voxels.max())
    assert grid_max * DENSITY_MAX_HEADROOM <= DENSITY_MAX_REAL, \
        f"grid max {grid_max:.4f} E_ZGR/pc needs DENSITY_MAX_REAL >= " \
        f"{grid_max * DENSITY_MAX_HEADROOM:.4f} (currently {DENSITY_MAX_REAL})"

    return {"gridMaxZgr": round(grid_max, 4), "clouds": report}


def sample_particles(voxels: np.ndarray, n: int, seed: int = 42) -> np.ndarray:
    """Importance-sample `n` particles from the density grid.

    Returns an (n, 4) float32 array: columns are (x, y, z, density). Each
    particle is placed at a uniformly-jittered position within its source
    voxel so the sampled cloud isn't quantised to voxel centres.

    Sampling probability is proportional to voxel density (clipped at the
    threshold); regions of zero density contribute no particles.
    """
    rng = np.random.default_rng(seed)

    flat = voxels.ravel()
    weights = np.where(flat > PARTICLE_DENSITY_THRESHOLD, flat, 0.0).astype(np.float64)
    total = weights.sum()
    if total <= 0.0:
        return np.zeros((0, 4), dtype=np.float32)
    weights /= total

    flat_idx = rng.choice(weights.size, size=n, replace=True, p=weights)

    # voxels.ravel() is C-order with last axis innermost, so for our [ix,iy,iz]
    # layout the flat index decomposes as iz innermost.
    n_axis = voxels.shape[0]
    iz = flat_idx % n_axis
    iy = (flat_idx // n_axis) % n_axis
    ix = flat_idx // (n_axis * n_axis)

    # Per-particle jitter inside the voxel breaks the voxel-grid look that
    # would otherwise show in dense regions where many particles share a
    # voxel.
    jitter = rng.uniform(-0.5, 0.5, size=(n, 3)).astype(np.float32) * VOXEL_SIZE_PC
    centres_x = (ix.astype(np.float32) + 0.5) * VOXEL_SIZE_PC - BOUNDS_PC
    centres_y = (iy.astype(np.float32) + 0.5) * VOXEL_SIZE_PC - BOUNDS_PC
    centres_z = (iz.astype(np.float32) + 0.5) * VOXEL_SIZE_PC - BOUNDS_PC
    pos = np.stack([centres_x, centres_y, centres_z], axis=1) + jitter
    density = flat[flat_idx].astype(np.float32)
    return np.column_stack([pos, density]).astype(np.float32)


def write_particles(particles: np.ndarray, path: Path) -> None:
    """Write particles as a tiny binary file: 16-byte header + raw float32.

    Header (16 bytes):
      0..3   ASCII 'PART'
      4..7   uint32 version (= 1)
      8..11  uint32 count
      12..15 reserved (zero)
    Records: count × 16 bytes (4 float32: x, y, z, density)."""
    count = int(particles.shape[0])
    header = bytearray(16)
    header[0:4] = b"PART"
    header[4:8] = (1).to_bytes(4, "little")
    header[8:12] = count.to_bytes(4, "little")
    with open(path, "wb") as f:
        f.write(header)
        f.write(particles.astype(np.float32).tobytes())


def encode_log_uint8(voxels: np.ndarray, dmin: float, dmax: float) -> np.ndarray:
    """Pure-log encoding over [dmin, dmax] → [0,1] → uint8.

    Values below dmin clamp to uint8=0 (decodes as dmin — a bias that's
    negligible for the shader's accumulated path extinction). Values above
    dmax clamp to uint8=255 (decodes as dmax — saturation in dense cores,
    which underestimates extinction through the very densest clouds but
    preserves their visual prominence)."""
    clipped = np.clip(voxels, dmin, dmax)
    log_lo = math.log10(dmin)
    log_hi = math.log10(dmax)
    norm = (np.log10(clipped) - log_lo) / (log_hi - log_lo)
    return np.clip(np.round(norm * 255.0), 0, 255).astype(np.uint8)


def make_synthetic_grid() -> np.ndarray:
    """Deterministic test pattern for end-to-end dev without external data.

    Uses realistic E_ZGR/pc density scales so the resulting A_V values
    match what the real map produces through the same shader pipeline —
    switching between synthetic and real mode doesn't require re-tuning
    uExtinctionStrength.

    - Dense slab in +X direction (200-400 pc), peak ~0.05/pc (Aquila-Rift
      scale). Stars behind along +X should show ~5 mag A_V at the centre.
    - -X hemisphere is completely clear (control). No diffuse plane —
      earlier versions had one but it contaminated the control direction.
    """
    n = GRID_SIZE
    ax = (np.arange(n, dtype=np.float32) + 0.5) * VOXEL_SIZE_PC - BOUNDS_PC
    xs, ys, zs = np.meshgrid(ax, ax, ax, indexing="ij")

    x_in_band = np.where((xs > 200) & (xs < 400), 1.0, 0.0)
    yz_r = np.sqrt(ys * ys + zs * zs)
    slab = 0.05 * x_in_band * np.exp(-(yz_r / 120.0) ** 2)

    r3 = np.sqrt(xs * xs + ys * ys + zs * zs)
    total = np.where(r3 <= BOUNDS_PC, slab, 0.0)
    return total.astype(np.float32)


def resample_edenhofer(*, flavor: str) -> np.ndarray:
    """Load the Edenhofer 2023 dust map and resample onto our Cartesian grid.

    Imports dustmaps/astropy lazily so --synthetic mode has zero extra deps.
    """
    try:
        import astropy.units as u
        from astropy.coordinates import SkyCoord
        import dustmaps.edenhofer2023
        from dustmaps.edenhofer2023 import Edenhofer2023Query
    except ImportError as e:
        raise SystemExit(
            f"Missing dependency: {e.name}. Install with:\n"
            f"  pip install -r scripts/requirements-dust.txt"
        ) from None

    # Fetch the data if not already present. Respects the user's
    # dustmaps.config['data_dir'] — set it in ~/.dustmapsrc to relocate.
    # 'main' flavor is the 3.2 GB mean+std HEALPix file; 2kpc flavor adds
    # a second file of similar size. We do not download samples (19 GB),
    # which would only matter for uncertainty propagation.
    try:
        dustmaps.edenhofer2023.fetch(fetch_2kpc=(flavor == "less_data_but_2kpc"))
    except Exception as e:  # pragma: no cover — network / filesystem errors
        raise SystemExit(f"Failed to fetch Edenhofer map: {e}") from None

    query = Edenhofer2023Query(flavor=flavor)

    # Build voxel-center coordinates in ICRS heliocentric Cartesian (parsecs),
    # matching catalog.bin's frame. astropy handles the ICRS → Galactic
    # conversion internally when the query pulls (l, b, distance) off the
    # SkyCoord.
    n = GRID_SIZE
    ax = (np.arange(n, dtype=np.float32) + 0.5) * VOXEL_SIZE_PC - BOUNDS_PC

    print("  Preparing voxel-center coords…", file=sys.stderr)
    # Query in Z-slab batches to keep peak memory bounded. Each slab is
    # 512*512 = 262,144 voxels.
    out = np.zeros((n, n, n), dtype=np.float32)
    xs2d, ys2d = np.meshgrid(ax, ax, indexing="ij")
    xs_flat = xs2d.ravel()
    ys_flat = ys2d.ravel()

    for iz, z in enumerate(ax):
        zs_flat = np.full_like(xs_flat, float(z))
        sc = SkyCoord(
            x=xs_flat * u.pc, y=ys_flat * u.pc, z=zs_flat * u.pc,
            frame="icrs", representation_type="cartesian",
        )
        # Queries outside the map's coverage return NaN; we sanitise below.
        d = query(sc)
        out[:, :, iz] = np.asarray(d, dtype=np.float32).reshape(n, n)
        if iz % 32 == 0:
            print(f"  …z-slab {iz}/{n}", file=sys.stderr)

    out = np.nan_to_num(out, nan=0.0, posinf=0.0, neginf=0.0)
    # Clip negatives (shouldn't occur, but rounding in float32 can produce
    # tiny negative values that the uint8 encoding would then misrender).
    out = np.clip(out, 0.0, None)
    return out


def write_chunks(encoded: np.ndarray, out_dir: Path) -> list[dict]:
    """Split the full grid into 64 chunks and write each as raw uint8 bytes.

    Axis order: data is indexed encoded[ix, iy, iz] in the Cartesian grid.
    Each chunk file's bytes are X-innermost, Y-middle, Z-outermost
    (WebGL texSubImage3D expects this layout for its width/height/depth
    arguments), so we transpose to (iz, iy, ix) before tobytes().
    """
    chunks: list[dict] = []
    c = CHUNK_SIZE
    for ix in range(CHUNKS_PER_AXIS):
        for iy in range(CHUNKS_PER_AXIS):
            for iz in range(CHUNKS_PER_AXIS):
                sub = encoded[ix*c:(ix+1)*c, iy*c:(iy+1)*c, iz*c:(iz+1)*c]
                # Reorder to Z-major for WebGL upload.
                raw = np.ascontiguousarray(sub.transpose(2, 1, 0)).tobytes()
                assert len(raw) == c * c * c
                name = f"chunk_{ix}_{iy}_{iz}.bin"
                path = out_dir / name
                path.write_bytes(raw)
                chunks.append({
                    "ix": ix, "iy": iy, "iz": iz,
                    "file": name,
                    "bytes": len(raw),
                    "sha256": hashlib.sha256(raw).hexdigest()[:16],
                    # Central pc coord of the chunk — lets the loader
                    # prioritise chunks by distance from the camera without
                    # recomputing from indices.
                    "centerPc": [
                        -BOUNDS_PC + (ix + 0.5) * c * VOXEL_SIZE_PC,
                        -BOUNDS_PC + (iy + 0.5) * c * VOXEL_SIZE_PC,
                        -BOUNDS_PC + (iz + 0.5) * c * VOXEL_SIZE_PC,
                    ],
                })
    return chunks


def build_manifest(chunks: list[dict], *, synthetic: bool, density_max: float,
                   particle_count: int, zucker: dict | None) -> dict:
    manifest = {
        "version": 2,
        "format": "u8-log-window",
        "synthetic": synthetic,
        "gridSize": GRID_SIZE,
        "chunkSize": CHUNK_SIZE,
        "chunksPerAxis": CHUNKS_PER_AXIS,
        "totalChunks": CHUNKS_PER_AXIS ** 3,
        "boundsPc": [-BOUNDS_PC, BOUNDS_PC],
        "voxelSizePc": VOXEL_SIZE_PC,
        "axisOrderInFile": "z-major (innermost = x)",
        "frame": "ICRS heliocentric Cartesian (matches catalog.bin)",
        "densityMin": DENSITY_MIN,
        "densityMax": density_max,
        "encoding": "uint8: 255 * (log10(clamp(d,dmin,dmax)) - log10(dmin)) / log10(dmax/dmin)",
        "avPerDensityPerPc": cloud_model.ZGR_TO_AV,
        "chunks": chunks,
        "particles": {
            "file": "particles.bin",
            "count": particle_count,
        },
    }
    if zucker is not None:
        manifest["zucker"] = zucker
    return manifest


def is_runtime_asset(name: str) -> bool:
    """Mirror of the sync-dust-pure.ts allowlist — only runtime assets may
    land in public/dust/ (tests/bundle-content.test.ts guards the built
    tree against strays like README.md or the .voxels.npy cache)."""
    return (name == "manifest.json" or name == "particles.bin"
            or (name.startswith("chunk_") and name.endswith(".bin")))


def copy_to_public() -> None:
    """Mirror data/dust → public/dust so Vite serves the chunks at /dust/.

    `data/dust/` is the canonical LFS-tracked location; `public/dust/` is a
    gitignored copy so the dev server and Vite build pick it up without
    the preprocessor having to know about two locations.
    """
    import shutil
    PUBLIC_DUST.mkdir(parents=True, exist_ok=True)
    # Wipe stale files so stepping back from --synthetic to real (or vice
    # versa) doesn't leave mismatched chunks behind.
    for old in PUBLIC_DUST.iterdir():
        if old.is_file():
            old.unlink()
    for src in DATA_DUST.iterdir():
        if src.is_file() and is_runtime_asset(src.name):
            shutil.copy2(src, PUBLIC_DUST / src.name)
    print(f"Mirrored to {PUBLIC_DUST.relative_to(ROOT)}/", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
