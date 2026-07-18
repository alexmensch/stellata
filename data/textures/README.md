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
  their native size (never upscaled).
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

## Colour fidelity

Per-body colour status — the honest answer to "is that what it looks
like from space?":

- **Earth day/night** — NASA calibrated true colour (BMNG / VIIRS),
  untouched.
- **Jupiter** — Cassini natural colour, untouched.
- **Saturn / Venus / Neptune** — Björn Jónsson's natural-colour
  reconstructions. Venus caveat: the cloud FEATURES are ultraviolet
  structure colourised to Venus's visible tones (in visible light the
  cloud deck is nearly featureless pale yellow). Neptune caveat: 1989
  Voyager OGB-filter colour; Irwin et al. 2024 argue the true colour
  is paler and greener than the classic deep azure.
- **Mars** — USGS Viking MDIM 2.1 colorized mosaic, the muted
  butterscotch Mars actually presents from space (an earlier
  Solar System Scope map was rejected as over-saturated).
- **Mercury** — the MESSENGER mosaic is monochrome and every
  MESSENGER colour product is false colour (IR/blue filters), so the
  build tints the grayscale with the body's representative colour at
  half chroma — Mercury's true appearance is near-neutral gray-brown,
  Moon-like.
- **Pluto** — New Horizons natural-ish colour. The un-imaged southern
  band (real data gap) is filled with the representative disc colour
  so it reads as "no data", not as terrain.

The per-body treatments live in `build-textures.py`
(`REPRESENTATIVE_COLOURS`, tint + gap-fill helpers); the colour
constants are pinned to `SOL_PLANETS` by
`scripts/textures/texture-colours.test.ts`, so the treated regions
always match the disc the body renders as at distance.

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
(https://bjj.mmedia.is/ — used with attribution per his usage terms).
Full per-file provenance in `src/README.md`; summary rows in
`SCIENCE.md` § Data sources.
