# Planet textures

Per-body equirectangular surface/cloud maps for the Sol planets and
major moons, plus the ring-system radial strips. Two layers in this
folder:

- `src/` — frozen source maps as downloaded, the frozen DEM reductions,
  plus the authored ring tables (LFS for the JPEGs and TIFFs; see
  `src/README.md` for the per-file provenance table).
- `*.jpg` + `<body>-rings.png` + `<body>-normal.webp` (this level) — the
  built runtime artifacts. Produced by
  `scripts/textures/build-textures.py` (manual, infrequent — like the
  dust build); `scripts/textures/sync-textures.ts` mirrors them to
  `public/textures/` on every `pnpm run build` / `dev`. The colour maps
  and ring strips stay on regular git (each well under `data/README.md`'s
  ~1 MB LFS threshold, ~8 MB in total); the **normal maps ride LFS**
  (`data/textures/*.webp`) at 3.8–7.5 MB each, like `data/dust/`'s
  chunks — same shape, a built artifact whose canonical home is here and
  whose `public/` copy is a gitignored mirror.

## Artifact contract

- Equirectangular (plate carrée), **positive-east** left-to-right —
  sources stored positive-west (PDS `LongitudeDirection`, several USGS
  moon mosaics) are flipped at build (`FLIP_HORIZONTAL`). Longitude 0
  at the left edge or map centre per source convention — the
  renderer's prime-meridian offset is a per-body concern
  (`mapCenterLonDeg` in
  `src/client/solar-system/planets/rotation/rotation-elements-pure.ts`), not baked
  here. Planets are centred on 0° except Pluto (~180°E, Sputnik
  Planitia at map centre); moon maps are centred on 180° except the
  Moon and Io (0°).
- Max 2048 px wide, JPEG quality 82; sources narrower than 2048 keep
  their native size (never upscaled).
- One file per body, `<body>.jpg`, lazy-loaded on close approach —
  the lazy-load unit is one body.
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

## Surface relief — DEM-derived normal maps

`<body>-normal.webp` is a **4096×2048 lossless WebP tangent-space
surface-normal map** derived from that body's real global DEM, shipped
alongside the colour map for the three bodies where it buys something
measurable: **Moon, Mercury, Mars**. Frozen DEM reductions and their
provenance are in `src/README.md`; `scripts/textures/dem_relief.py`
owns the derivation and the per-body contract.

- **Encoded frame is (+x east, +y north, +z out of the surface)** —
  what a GL-sampled equirect map gives with `flipY`, v increasing
  northward. **Blue carries no signal**: z is positive by construction
  on a heightfield, so the consumer reconstructs it as
  `sqrt(1 − x² − y²)`. It is nonetheless written as the encoding of
  z = +1 (255) rather than 0, because a consumer that samples all three
  channels and skips the reconstruction then reads a merely shallow
  normal instead of an inverted one. Constant either way, so it costs
  ~1 % of file size; encoding the true z would cost 5–21 %, which is
  what makes dropping it worthwhile.
- **Registered to the body's COLOUR map, not to its DEM.** The
  MESSENGER Mercury DEM is centred on 180°E while PIA15063 is centred
  on 0°, so the build rolls it; `dem_relief.py` carries both centres
  per body and `dem-relief.test.ts` pins the target against the
  runtime's `mapCenterLonDeg`. This is the failure with no other
  symptom — a mis-rolled map shades real terrain in the wrong place
  and everything else about the render looks fine.
- Derivation: area-average the DEM to the target width (never
  LANCZOS — ringing at a crater rim is a slope that isn't there),
  central-difference in metres, divide the longitude derivative by
  cos(latitude), zero it past **±85°** where the equirect
  u-derivative degenerates, then `normalize(−dz/du, −dz/dv, 1)`
  encoded `n·0.5 + 0.5`. The v-derivative needs no such cutoff, and the
  top and bottom rows take it across the pole — the row beyond a pole
  is that same row half a world away in longitude, so differencing
  against itself would halve its gradient.
- Vertical exaggeration is **none**: slopes are true, computed against
  the radius the body is *drawn* at, so relief is honest at any camera
  distance.
- Measured area-weighted tilt off the local vertical, over the same
  ±85° window, ships in `relief.json` and is pinned by
  `dem-relief.test.ts`: median / p90 of **3.27° / 11.66°** (Moon),
  **1.14° / 3.94°** (Mercury), **0.44° / 2.58°** (Mars). The ordering
  Moon ≫ Mercury > Mars holds at every map width, which is why the
  Moon is the body this work is scoped around — at a 15° sun its p90
  slope is a ~4× terminator brightness contrast.

**Lossless, and that is not a default.** WebP q98 errs 1.62° of normal
angle against the Moon's 2.65° median tilt — most of the signal — so
lossy encoding is rejected at file level. (GPU block compression is a
separate question: BC5 is the standard normal-map format and the KTX2
work should evaluate it rather than inherit this verdict.) Shipping the
**height** map and differencing in the shader is also rejected: 8-bit
height quantises to 0.82° of slope terracing, a third of the median
tilt, and a 16-bit height PNG is larger than the normal map it would
produce while costing three taps per fragment.

**Why 4096 when the colour maps are 2048.** The slope signal is what
buys terminator contrast, and it keeps climbing past the colour map's
useful width — the Moon's p90 tilt goes 9.7° → 11.6° from 2048 to
4096. 4096 uncompressed is ~45 MB of VRAM per body, which is
affordable for a lazily-loaded body; 8192 is ~179 MB and is not, so it
waits on KTX2/Basis block compression.

Those two figures assume **RGBA8 plus mipmaps**, which is what a WebP
decoded to an `ImageBitmap` uploads as by default. Since blue carries
no signal, an `RG8` upload (WebGL2) halves both: ~22 MB at 4096 and
~89 MB at 8192. Whether that lands is 2f6.42's call, but it has to be
settled before the 8192 question is reopened — it moves 8192 from
unaffordable to arguable, so quoting ~179 MB as the blocker without
the channel assumption would decide that question by accident.

**Which bodies are eligible at all.** Relief applies only where the
rendered texture IS the solid surface. That excludes **Venus** (we
render the cloud deck by design), **Titan** (the 938 nm map is surface
seen *through* the haze, and the haze is the visible appearance), and
**all four giants**, which have no surface. No global DEM exists for
Io, Europa, Ganymede, Callisto, Triton, or the Saturnian mids;
Enceladus and Pluto have one each, and Pluto's covers the encounter
hemisphere only — matching its colour map's real data gap.

**Earth is deliberately absent.** Its land relief is the flattest of
the four candidates by a wide margin (p90 0.93° at 2048, 2.27° at
8192) and is not worth shipping below 8192, so it waits on the same
block-compression work. When it lands, its elevation **must be clamped
to ≥ 0 before differencing**: over water the visible surface is the sea
surface, and shipping raw bathymetry as relief raises the measured p90
from 0.93° to 1.37°, all of it wrong.

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

## Colour fidelity — index-anchored calibration

The maps come from different instruments, filter sets, and processing
eras; per-map colour judgement doesn't scale. Instead the build
calibrates every map with a published disc-integrated colour to a
**measured target** (`scripts/textures/texture_calibration.py`):

- **Reference white is the solar spectrum**, not D65 — a body
  reflecting sunlight neutrally renders R = G = B. Decision record in
  `docs/science-solar-system.md` § Naked-eye colour calibration.
- Each body's target chromaticity is its adopted **B−V / V−Rc** from
  Mallama, Krobusek & Pavlov 2017 (Icarus 282, 19, Table 3),
  expressed as flux ratios against the Sun's own indices and mapped
  B→blue, V→green, Rc→red.
- Per-map linear-RGB gains move the map's **sphere-weighted mean**
  (rows weighted by cos-latitude; no-data gaps excluded) onto the
  target while preserving mean luminance. Achieved-vs-target numbers
  live in the committed `calibration.json`, pinned by
  `scripts/textures/texture-calibration.test.ts`.
- **Moons are not yet index-calibrated** — Mallama 2017 covers the
  planets only, so the moon maps keep the hand treatments below until
  a vetted satellite index table exists. The machinery extends with
  one row per body in `COLOUR_INDICES`.

What the calibration corrects, per planet:

- **Earth** — the Blue Marble 2002 composite (real ocean + clouds)
  was near-neutral; nudged to Earth's measured bluish tone.
- **Jupiter** — Cassini natural colour; near-target, small nudge.
- **Venus** — Jónsson's colourised UV cloud structure read far
  yellower than Venus measures; calibrated to its near-neutral white
  (B−V 0.70 is barely off the Sun's 0.653). Cloud FEATURES remain UV
  structure — in visible light the deck is nearly featureless.
- **Neptune** — 1989 Voyager OGB deep azure paled toward the measured
  tone, consistent with Irwin et al. 2024.
- **Mars** — the Viking MDIM 2.1 mosaic's blue boost dimmed ~0.57×;
  lands on the muted butterscotch Mars presents from space.
- **Mercury** — the MESSENGER mosaic is monochrome (every MESSENGER
  colour product is false colour), so the calibration gains ARE the
  tint: measured warm gray, replacing the old hand-tuned half-chroma
  judgement.
- **Saturn** — Jónsson reconstruction, small warm correction. (Its
  V−Rc uses the paper's internally-consistent synthetic pair; the
  photometric V and synthetic Rc rows disagree by 0.17 mag.)
- **Pluto** — NOT calibrated: no adopted index row in Mallama 2017,
  and the New Horizons natural-ish colour is trusted as shipped. The
  un-imaged southern band (real data gap) is filled with the map's
  mean imaged colour, feathered at the boundary, so it reads as
  "no data", not as a contrasting terrain band.

Moon treatments (hand-tuned pending measured targets):

- **Moon** — LROC WAC colour (NASA SVS CGI Moon Kit), untouched.
- **Io / Ganymede** — USGS Galileo/Voyager colour merges, natural-ish
  colour, untouched (Ganymede's un-imaged polar wedges gap-fill with
  the map's feathered mean colour).
- **Europa / Callisto** — the only global USGS mosaics are grayscale;
  the build tints them with each body's representative colour at half
  chroma (both are near-neutral bodies).
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

The moon treatments live in `build-textures.py`
(`REPRESENTATIVE_COLOURS`, tint + desaturate + gap-fill + flip
helpers); the tint colours are pinned to `SOL_BODIES` by
`scripts/textures/texture-colours.test.ts`, so the tinted maps always
match the disc the body renders as at distance.

## Rebuilding

```
pnpm run build:textures     # src/ -> artifacts (needs Pillow + NumPy)
```

Idempotent (mtime-gated). NOT part of `pnpm run build` — CI and deploy
only run the pure-copy sync step, so Pillow is never a build
dependency. To replace a source map, drop the new file into `src/`,
update `src/README.md` + `BODIES` in the build script, rerun, and
commit both layers. Replacing a **DEM** additionally goes through
`scripts/textures/reduce_dem.py` — `src/README.md` § Refresh recipe.

## Credits

NASA/USGS imagery is public domain. The Venus, Saturn, and Neptune
maps and the ring profiles were created by **Björn Jónsson**
(https://bjj.mmedia.is/ — used with attribution per his usage terms).
Full per-file provenance in `src/README.md`; summary rows in
`SCIENCE.md` § Data sources.
