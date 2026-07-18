# Planet textures

Per-body equirectangular surface/cloud maps for the Sol planets, plus
the Saturn-ring radial profile. Two layers in this folder:

- `src/` — frozen source maps as downloaded (LFS for the JPEGs; see
  `src/README.md` for the per-file provenance table).
- `*.jpg` + `saturn-rings.png` (this level) — the built runtime
  artifacts, committed on regular git (~1.9 MB total). Produced by
  `scripts/textures/build-textures.py` (manual, infrequent — like the
  dust build); `scripts/textures/sync-textures.ts` mirrors them to
  `public/textures/` on every `pnpm run build` / `dev`.

## Artifact contract

- Equirectangular (plate carrée), longitude 0 at the left edge or map
  centre per source convention — the renderer's prime-meridian offset
  is a per-body concern handled with the IAU rotation elements
  (stellata-2f6.13), not baked here.
- Max 2048 px wide, JPEG quality 82; sources narrower than 2048 keep
  their native size (never upscaled). Mercury stays grayscale (`L`) —
  the source mosaic is monochrome.
- One file per body, `<body>.jpg`, lazy-loaded on close approach —
  the lazy-load unit is one body. `earth-night.jpg` is the Black
  Marble night-lights companion consumed by the city-lights blend
  (stellata-2f6.14).
- **Uranus has no texture by design** — a featureless cyan spheroid
  with limb darkening is the accurate rendering (2f6.6 design
  record); it exercises the renderer's texture-less base path.
- `saturn-rings.png` is a 2048×1 RGBA strip: RGB = ring colour, A =
  opacity (source transparency inverted). The radial span is
  **74,510 km → 140,390 km** from Saturn's centre (left → right edge)
  — consumers (stellata-2f6.15) map ring-plane radius to U with that
  span.

## Rebuilding

```
pnpm run build:textures     # src/ -> artifacts (needs Pillow)
```

Idempotent (mtime-gated). NOT part of `pnpm run build` — CI and deploy
only run the pure-copy sync step, so Pillow is never a build
dependency. To replace a source map, drop the new file into `src/`,
update `src/README.md` + `BODIES` in the build script, rerun, and
commit both layers.

## Credits

NASA/USGS imagery is public domain. The Venus, Saturn, and Neptune
maps and the ring profiles were created by **Björn Jónsson**
(https://bjj.mmedia.is/ — used with attribution per his usage terms);
the Mars map is Solar System Scope's Viking-derived map (CC BY 4.0).
Full per-file provenance in `src/README.md`; summary rows in
`SCIENCE.md` § Data sources.
