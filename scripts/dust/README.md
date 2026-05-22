# Dust resampler

`build-dust.py` — Edenhofer 2024 dust posteriors → resampled voxel
chunks + importance-sampled particle field. Outputs to `data/dust/`
(LFS-committed). `sync-dust.ts` mirrors `data/dust/` → `public/dust/`
on dev/build.

Python deps in `requirements-dust.txt`.

Particle-layer rendering is currently shelved (strength = 0 → mesh
hidden); voxel extinction (read per-star in the star pipeline) stays
live.
