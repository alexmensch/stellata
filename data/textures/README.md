# Planet textures

Per-body equirectangular surface/cloud maps for the Sol planets and
major moons, plus the ring-system radial strips. Two layers in this
folder:

- `src/` — frozen source maps as downloaded, plus the authored ring
  tables (LFS for the JPEGs; see `src/README.md` for the per-file
  provenance table).
- `*.jpg` + `<body>-rings.png` (this level) — the built runtime
  artifacts, committed on regular git (~8 MB total). Produced by
  `scripts/textures/build-textures.py` (manual, infrequent — like the
  dust build); `scripts/textures/sync-textures.ts` mirrors them to
  `public/textures/` on every `pnpm run build` / `dev`.

## Artifact contract

- Equirectangular (plate carrée), **positive-east** left-to-right —
  sources stored positive-west (PDS `LongitudeDirection`, several USGS
  moon mosaics) are flipped at build (`FLIP_HORIZONTAL`). Longitude 0
  at the left edge or map centre per source convention — the
  renderer's prime-meridian offset is a per-body concern
  (`mapCenterLonDeg` in
  `src/client/solar-system/rotation-elements-pure.ts`), not baked
  here. Planets are centred on 0° except Pluto (~180°E, Sputnik
  Planitia at map centre); moon maps are centred on 180° except the
  Moon and Io (0°).
- Max 2048 px wide, JPEG quality 82; sources narrower than 2048 keep
  their native size (never upscaled).
- One file per body, `<body>.jpg`, lazy-loaded on close approach —
  the lazy-load unit is one body. `earth-night.jpg` is the Black
  Marble night-lights companion consumed by the city-lights blend
  (stellata-2f6.14).
- **Uranus has no texture by design** — a featureless cyan spheroid
  with limb darkening is the accurate rendering (2f6.6 design
  record); it exercises the renderer's texture-less base path.
- `<body>-rings.png` (saturn, uranus, neptune) is a 2048×1 RGBA
  strip: RGB = ring colour, A = opacity. U maps ring-plane radius
  from the body's centre across the strip span (left → right edge):
  Saturn **74,510 → 140,390 km** (the Jónsson profile span, source
  transparency inverted), Uranus **41,600 → 51,300 km**, Neptune
  **40,900 → 63,100 km**. Each span must match the body's `rings`
  entry in `src/client/solar-system/planet-system.ts` —
  `scripts/textures/ring-strips.test.ts` pins the parity.

## Ring strips — true opacity and the 8-bit floor

The Uranus and Neptune strips are rendered from literature ring
tables (`src/rings-<body>.tsv`) at **true opacity**: alpha is
`1 − e^−τ` from each ring's normal optical depth, box-averaged onto
the strip so a ring narrower than a texel dilutes linearly
(equivalent width — opacity × width — is conserved; mipmaps preserve
it further down). No brightening for effect: these rings read as
barely-there charcoal threads, which is the physically correct look.

The strip's 8-bit alpha floor (1/255 ≈ 3.9×10⁻³) is the binding
physical constraint, and it drives three scope decisions:

- **Uranus** ships its 10 narrow main rings (6, 5, 4, α, β, η, γ, δ,
  λ, ε) — all survive the floor after box averaging (peaks 13–167 of
  255; ε dominant). The ζ, ν and μ dust rings (τ ≲ 10⁻⁴) fall below
  it and are excluded; ν/μ would also double the span and halve the
  narrow rings' texel resolution.
- **Neptune** ships all five rings for data honesty, but only
  Le Verrier (τ 0.0062 → alpha 2) and Adams (alpha 4) survive; the
  Galle/Lassell/Arago sheets (τ ~10⁻⁴) render to 0. The Adams τ folds
  its azimuthal arcs in as a longitude average (a 1-D radial strip
  cannot carry arc structure): non-arc τ 0.011 plus the arcs'
  τ 0.03–0.09 over ~25° of longitude → 0.014.
- **Jupiter ships no strip at all.** Its rings' normal optical depth
  (main ring ~10⁻⁶, all components < 10⁻⁵) sits three orders of
  magnitude below the floor — at true opacity the strip is
  identically zero, so shipping one would be dead weight. Jupiter's
  rings are genuinely invisible in backscattered visible light; they
  were discovered in forward scatter.

Display RGB anchors the ~0.05 particle geometric albedo (dark,
Uranian-moon-like material; Neptune's slightly red) to the Saturn
strip's bright-ring tone: 0.05/0.50 × ~0.97 ≈ 0.10.

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
  band (real data gap) is filled with the map's mean imaged colour,
  feathered at the boundary, so it reads as "no data", not as a
  contrasting terrain band.
- **Moon** — LROC WAC colour (NASA SVS CGI Moon Kit), untouched.
- **Io / Ganymede** — USGS Galileo/Voyager colour merges, natural-ish
  colour, untouched (Ganymede's un-imaged polar wedges gap-fill with
  the map's feathered mean colour).
- **Europa / Callisto** — the only global USGS mosaics are grayscale;
  the build tints them with each body's representative colour at half
  chroma (both are near-neutral bodies), same treatment as Mercury.
- **Saturnian mids (Mimas, Enceladus, Tethys, Dione, Rhea, Iapetus)
  and Triton** — Schenk 2014 IR-G-UV *enhanced-colour* mosaics; the
  colour separation is exaggerated far past what the eye would see on
  these near-neutral ices, so the build pulls chroma halfway back
  toward gray (`DESATURATE`). Triton's un-imaged northern hemisphere
  gap-fills with the map's feathered mean colour, like Pluto's band.
- **Titan** — Cassini ISS 938 nm mosaic: surface detail seen THROUGH
  the opaque haze, not the visible-light appearance. The build tints
  the grayscale with Titan's full representative orange so the
  naked-eye haze colour dominates and the surface reads as faint
  markings (the Venus-style "features colourised to visible tones"
  caveat).
- **Uranian moons** — no texture by design: Voyager southern-
  hemisphere-only coverage; they exercise the renderer's texture-less
  base path.

The per-body treatments live in `build-textures.py`
(`REPRESENTATIVE_COLOURS`, tint + desaturate + gap-fill + flip
helpers); the colour constants are pinned to `SOL_BODIES` by
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
