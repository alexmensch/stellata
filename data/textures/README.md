# Planet textures

Per-body equirectangular surface/cloud maps for the Sol planets and
major moons, plus the ring-system radial strips. Two layers in this
folder:

- `src/` — frozen source maps as downloaded, the frozen DEM reductions,
  plus the authored ring tables (LFS for the JPEGs and TIFFs; see
  `src/README.md` for the per-file provenance table).
- `*.jpg` + `<body>-rings.png` + `<body>-normal.webp` +
  `<body>-horizon-{a,b}.webp` (this level) — the built runtime artifacts.
  Produced by
  `scripts/textures/build-textures.py` (manual, infrequent — like the
  dust build); `scripts/textures/sync-textures.ts` mirrors them to
  `public/textures/` on every `pnpm run build` / `dev`. The colour maps
  and ring strips stay on regular git (each well under `data/README.md`'s
  ~1 MB LFS threshold, ~8 MB in total); the **relief maps ride LFS**
  (`data/textures/*.webp`) — normals at 3.8–7.5 MB each and a horizon
  pair at 5.6–9.4 MB — like `data/dust/`'s
  chunks: same shape, a built artifact whose canonical home is here and
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
- Each body's **elevation span** (`span_m`, asserted against the published
  one by `reduce_dem.py`) is read twice: it decodes the reduction, and the
  renderer fences relief lighting at the depression that span's summit can
  see past the limb —
  `src/client/solar-system/planets/README.md` § Surface relief.
- Measured area-weighted tilt off the local vertical, over the same
  ±85° window, ships in `relief.json` and is pinned by
  `dem-relief.test.ts`: median / p90 of **3.27° / 11.66°** (Moon),
  **1.14° / 3.94°** (Mercury), **0.44° / 2.58°** (Mars). The ordering
  Moon ≫ Mercury > Mars holds at every map width, which is why the
  Moon is the body this work is scoped around — at a 15° sun its p90
  slope is a ~4× terminator brightness contrast.

**Lossless, and that is not a default.** WebP q98 errs 1.62° of normal
angle against the Moon's 2.65° median tilt — most of the signal — so
lossy encoding is rejected at file level. Shipping the
**height** map and differencing in the shader is also rejected: 8-bit
height quantises to 0.82° of slope terracing, a third of the median
tilt, and a 16-bit height PNG is larger than the normal map it would
produce while costing three taps per fragment.

**Why 4096 when the colour maps are 2048.** The slope signal is what
buys terminator contrast, and it keeps climbing past the colour map's
useful width — the Moon's p90 tilt goes 9.7° → 11.6° from 2048 to
4096.

**The normal map uploads as `RG8`, not `RGBA8`** — blue is a constant
by construction and alpha is unused, so two of the four channels were
paying VRAM for nothing. With mipmaps that is **~22 MB per body at
4096** and ~89 MB at 8192, against 45 and 179 for the RGBA8 upload a
decoded `ImageBitmap` gives by default. Any VRAM figure for these maps
has to state its channel assumption: ~179 MB reads as the blocker on
the 8192 tier and ~89 MB does not.

**Only the normal map may narrow.** Each horizon plane carries an
azimuth in *every* channel, alpha included, so the same conversion
would silently delete four of the eight — a whole-branch `RG8` is the
plausible-looking mistake here, and it reads as wrong terrain rather
than a missing map. `planet-mesh-layer.test.ts` pins the split.

### BC5 measured — the file-level verdict does not transfer

`measure_block_compression.py` runs the shipped maps through a reference
BC4/BC5 codec and through lossy WebP, against the same 8-bit source, so
the number that rejected WebP and the number deciding block compression
are the same measurement. cos(lat)-weighted normal-angle error:

| body | BC5 p50 / p90 / p99 | WebP q98 p50 / p90 / p99 |
|---|---|---|
| Moon | 0.45° / 1.01° / 1.91° | 1.01° / 3.42° / 7.41° |
| Mercury | 0.00° / 0.45° / 0.90° | 0.64° / 1.42° / 3.05° |
| Mars | 0.00° / 0.45° / 0.90° | 0.45° / 1.35° / 3.28° |

BC5 costs about **a third** of q98 at p90 on every body, so § Lossless
above is a statement about DCT at file level and genuinely does not
carry over — which is what it said, now measured rather than suspected.
On the Moon 1.01° sits against the map's own 11.66° p90 tilt: **8.6 % of
the signal**, where q98 spends 29 %.

**The error is flat in resolution, and that is the argument for 8192.**
Same codec across widths area-averaged down from the shipped map — p90
1.006° at 1024, 1.043° at 2048, 1.007° at 4096 — while the signal keeps
climbing (p90 tilt 9.7° → 11.66° from 2048 to 4096). Every rung
therefore improves the ratio, and 8192-BC5 buys a doubling's slope for
about 1° of added angle. VRAM at 1 byte/texel with mips: **11 MB at
4096, 45 MB at 8192** — half the `RG8` upload again.

**It does not meet the bar stellata-2f6.46 set**, which was "near the
0.177° of an exact 8-bit encode"; BC5 is 5.7× that at p90. The bar is
the wrong comparison — error against the *signal*, and against what a
resolution doubling buys, is what decides whether a tier is worth
shipping — but that is a call to make deliberately, not by quietly
substituting a friendlier test. The caveat that matters: no 8192 map
exists yet, so the trend above is measured at ≤4096 and extrapolated.

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

## Cast shadows — DEM-derived horizon maps

`<body>-horizon-a.webp` + `-b.webp` are a **pair of 2048×1024 lossless RGBA
WebP** carrying, per texel, the elevation of the local skyline in **8
azimuths** — the eight channels of the two files concatenated, azimuth 0 on
east and running toward north. A normal map says which way the ground tilts;
this says what the ground can *see*. `scripts/textures/horizon_map.py` owns
the derivation, on the same three bodies and the same frozen DEMs.

- **Encoded value is the SINE of the skyline elevation**, `sin/0.4` mapped
  onto [0, 1] — the shader compares it against `dot(n, sunDir)`, so an
  inverse trig per fragment would buy nothing. ±0.4 (±23.6°) covers the
  measured range with 0.058 % of Moon texels clamped, all of them steep
  walls seen at high sun; the negative half never comes close, because the
  floor is the body's own limb bound (8.65° on the Moon).
- **Saved with libwebp `exact=True`.** Without it libwebp is free to rewrite
  RGB wherever alpha is 0, which here is one azimuth's skyline silently
  overwriting three others. The **same hazard exists at upload** and is not
  guarded: `THREE.TextureLoader` goes through `HTMLImageElement`, so RGB rides
  the browser's premultiply round-trip, and alpha here is azimuth 3 / azimuth 7
  data rather than opacity. Its floor is the limb bound (≈79/255 on the Moon),
  where the round-trip can cost ~1.5 quantisation steps ≈ 0.3° of skyline in
  the other three channels — the same order as the azimuth error below. Chrome
  and Firefox are exact on the unpremultiplied path; Safari historically was
  not, so a Safari-only skyline error in the NW/SE azimuths points here.
  `ImageBitmapLoader` with `premultiplyAlpha: 'none'` is the fix if it bites.
- **Both occluders in one number.** The elevation angle to a candidate
  blocker is exact spherical geometry against the sample point's true local
  horizontal, so it carries the `d²/2R` the ground drops away by — which is
  what makes the body's own limb an occluder, the larger of the two terms.
  A crater wall reads as a positive skyline on top. Flat ground at the
  reference sphere does **not** read exactly 0, though: the march never samples
  closer than its start distance, so it reads that distance's own drop —
  −0.176° at two output texels, `flat_floor` in `horizon_map.test.py`. Bounded,
  and slack toward lighting rather than shadowing, so it errs on the safe side
  of "the sun sets at the geometric terminator".
- **The search runs to `arccos(r_floor / r_summit)`** — 262 km on the Moon,
  219 on Mercury, 446 on Mars. Not a cut-off: for the extremal pair (highest
  summit over deepest floor) the elevation angle *peaks* exactly there and
  every gentler pair peaks earlier, so nothing past it can win. It is the
  same quantity as the renderer's fallback limb bound, and
  `horizon-map.test.ts` pins the identity.
- **The march starts two output texels out and steps at the DEM's 4096
  resolution from there** — two independent parameters, and only the first
  moved. `HORIZON_MARCH_START_TEXELS` sets the near bound: 10.7 km on the Moon,
  15.0 on Mercury, 20.8 on Mars, past both the normal map's domain and what the
  colour map can draw. It used to be one DEM texel, 2.7 km, and that single step
  set **35 %** of every stored value — a third of the cast shadows thrown by a
  caster no camera distance can resolve, and double-counted against the facet
  slope the normal map already applies. The step size is unchanged and stays at
  the DEM's resolution however coarse the output grid, so a narrow ridge at
  range is sampled rather than averaged away.
- **The observer is NOT sampled at a different scale from the blockers**, which
  looks like it should be a bias and is not. `r_p` is a box average over the
  output cell while a blocker is a bilinear sample of the DEM; at the shipped
  4096 → 2048 ratio the bilinear sample at a cell centre IS that box average, to
  2×10⁻¹⁰ m. It stops being true the moment the ratio is not 2 — refine the DEM
  to 8192 without widening the output and the observer really does smooth
  against sharp neighbours, biasing the skyline upward in rough terrain.
- Registered to the body's **colour** map, rolled exactly like the normal
  map. Unlike the normal map there is **no ±85° cutoff**: the march walks
  real geodesics and has no equirect derivative to degenerate.

**Why 2048 and 8 azimuths — measured, not assumed.** The scoping guess was
that a 512-wide map would do, on the grounds that the skyline signal lives at
tens to hundreds of km. It does not: the limiting factor is how well the map
knows the **elevation of the point it answers for**, because the limb term is
a height effect and height varies at texel scale. Lit area 0–2° past the
terminator, Moon, against the same march at full DEM width — 8.4 %.

**Both tables in this subsection were measured at the previous 2.7 km march
start**, so their absolute levels no longer match the verification table above.
What they establish is the comparison down each row, and the start distance
moves every column of a row together — a coarser grid still knows its own
texel's elevation worse, and interpolating between stored azimuths still
over-shadows. Refreshing the levels is `stellata-2f6.57`; the choice of 2048
and 8 is not reopened by it.

| output width | 512 | 1024 | 2048 |
|---|---|---|---|
| lit area | 5.4 % | 7.2 % | 8.5 % |
| pair size (Moon) | 0.8 MB | 2.7 MB | 9.4 MB |
| VRAM, RGBA8 + mips | 1.4 MB | 5.6 MB | 22.4 MB |

Azimuth count trades against width at a fixed byte budget, and loses. Linear
interpolation between stored azimuths **over-shadows** — the skyline has
narrow peaks, so averaging two neighbours over-estimates the gap between
them — and at the worst-case bearing (exactly between two samples) the same
0–2 % band reads 6.7 % at 8 azimuths and 4.2 % at 4. Four azimuths at 2048
costs the same bytes as eight at 1024 and is worse than either. Sixteen would
need four files; its mean skyline error is 0.11° against 0.32° for eight,
which does not pay for the third and fourth texture fetch.

That 22.4 MB per body sits on top of the normal map's own 22.4, so a session
that visits all three relief bodies holds ~134 MB of relief texture. The
horizon pair cannot take the normal map's `RG8` narrowing — every channel of
both planes carries an azimuth — so block compression is the only lever left
on this half.

**Verification** is `scripts/textures/measure_relief_lighting.py` (manual,
needs the LFS objects): it reads the *shipped* artifacts, so it exercises the
encoding, the channel packing and the search bound end to end, and prints both
the lit-area table and the disc integral against phase. Its reference column is
the same march at full DEM width rather than ground truth — it isolates what
the output grid and the encoding cost, and carries the first-step floor above
itself. The geometry underneath is pinned separately by
`scripts/textures/horizon_map.test.py`. Shipped Moon numbers, sun in the
equatorial plane:

| solar depression | normal map only | + horizon maps | full-DEM horizon |
|---|---|---|---|
| 0–2° | 38.7 % | 9.6 % | 8.7 % |
| 2–5° | 17.7 % | 0.3 % | 0.2 % |
| 5–10° | 6.7 % | 0.0 % | 0.0 % |

Mercury reads 22.0 % → 6.3 % against a 5.6 % reference in the 0–2° band, Mars
15.6 % → 8.2 % against 7.0 %. Both columns moved together when the march's
start distance did, since the reference shares it.

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
