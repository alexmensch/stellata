# Dust resampler

`build-dust.py` — Edenhofer 2024 dust posteriors → resampled voxel
chunks + importance-sampled particle field. Outputs to `data/dust/`
(LFS-committed). `sync-dust.ts` mirrors `data/dust/` → `public/dust/`
on dev/build.

Python deps in `requirements-dust.txt`.

Layer is shelved at the renderer (strength = 0 → mesh hidden); see
`src/client/dust/README.md`.
