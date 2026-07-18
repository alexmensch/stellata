# Local Bubble build

`build-local-bubble.py` turns the Zucker 2022 inner-surface HEALPix map
(`data/local-bubble/`) into `data/local-bubble/local-bubble.bin` — a
star-shaped triangle-mesh shell of the Local Bubble's dust wall, consumed
by `src/client/local-bubble/`.

The Python build needs numpy/astropy/healpy, so — like the dust grid — it
runs **offline** and its output is **committed** (LFS). The deploy build
never runs it: `build:local-bubble-sync` (`sync-local-bubble.ts`, in the
`pnpm run build` chain) just copies `data/local-bubble/local-bubble.bin` →
`public/local-bubble.bin`. Regenerate offline and commit the result:

```
python3 -m venv .venv && ./.venv/bin/pip install -r scripts/local-bubble/requirements.txt
pnpm run build:local-bubble          # default: r_in_lmax-08, 96×192 grid
./.venv/bin/python scripts/local-bubble/build-local-bubble.py --column r_in_lmax-10
```

The map gives, per galactic direction, the distance to the wall in pc.
The shell is single-valued from the Sun, so the build resamples the map
onto a lat-long grid (bilinear HEALPix interpolation), rotates each
direction galactic→ICRS (the `catalog.bin` frame), scales by the wall
distance, orients the winding outward (so the client's FrontSide material
culls when the camera is inside), and triangulates. Runtime computes
vertex normals.

## Output format (`local-bubble.bin`, magic `LBUB`)

- Header (32 B): `LBUB` · uint32 version · uint32 vertexCount · uint32
  indexCount · float32×3 volume centroid (ICRS pc, Sol origin) · uint32
  reserved.
- `vertexCount × float32×3` positions (ICRS pc, Sol origin).
- `indexCount × uint32` triangle indices.

## Dust cross-check (build guard)

The build asserts the surface against the **independent** Edenhofer dust
grid (`data/dust/`): sampling the dust along each wall direction, the
density must peak at ~1.0 R (median per-ray peak-density radius in
[0.85, 1.05] R, currently ≈0.96). A galactic/ICRS frame swap, a pc-scale
error, or a bad column breaks that correlation and fails the build.
Skip with `--skip-crosscheck` (dev only).
