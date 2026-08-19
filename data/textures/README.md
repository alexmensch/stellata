# Planet textures

Per-body equirectangular surface/cloud maps for the Sol planets and
major moons, plus the ring-system radial strips. Two layers in this
folder:

- `src/` — frozen source maps as downloaded, the frozen DEM reductions,
  plus the authored ring tables (LFS for the JPEGs and TIFFs; see
  `src/README.md` for the per-file provenance table).
- `<body>-<width>.jpg` + `<body>-rings.png` (this level) — the built
  colour rungs and ring strips.
- `relief/` — the DEM-derived normal and horizon maps, and the
  measurements behind their width and encoding. Its own README.

Both artifact layers are produced by
`scripts/textures/build-textures.py` (manual, infrequent — like the dust
build); `scripts/textures/sync-textures.ts` mirrors them **flat** into
`public/textures/` on every `pnpm run build` / `dev`, so `relief/`
groups files at rest without changing any renderer URL. Everything built
here **rides LFS** (`data/textures/*.jpg`, `relief/*.webp`) — a colour
rung is 4–8 MB at 8192 — like `data/dust/`'s chunks: same shape, a built
artifact whose canonical home is here and whose `public/` copy is a
gitignored mirror.

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
- **A size ladder per body, not one width.** `<body>-<width>.jpg` at
  JPEG quality 82, one file per rung the body's master can fill —
  1024/2048/4096/8192, plus the master's own width as the top rung when
  that is not a power of two (Venus 1800, Saturn 2880, Jupiter 3601,
  Titan 4040, Pluto 5926, Mimas 6356). Nothing is ever upscaled and no
  detail the master has is discarded. Rungs and the per-body rationale:
  `scripts/textures/README.md` § Size ladder.
- Lazy-loaded on close approach; the lazy-load unit is one body at one
  rung, chosen from the live viewport
  (`src/client/solar-system/planets/README.md` § Texture tier selection).
- **Every rung of a body shares one mean luminance**, measured at build
  from the top rung and shipped in `texture-ladder-generated.ts`. The
  renderer divides it out of `uSurfaceLuminance` (§ Colour fidelity),
  so a per-rung measurement would make each tier swap a brightness step
  on a body whose magnitude is physically pinned.
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

## Surface relief and cast shadows

`relief/` — the DEM-derived `<body>-normal.webp`, the
`<body>-horizon-{a,b}.webp` pair and `<body>-skyview.webp`, on the four
bodies with a usable global DEM (Moon, Mercury, Mars, Earth). A normal map
says which way the ground tilts; a horizon map says what that ground can
*see*, which is what makes the body's own limb an occluder; the sky-view
factor says how much of the sky terrain takes away, over the near field the
horizon map skips. All are registered to the body's **colour** map
rather than to its DEM — the failure with no other symptom, since a
mis-rolled map shades real terrain in the wrong place and everything else
looks fine.

Widths, the lossless-and-not-by-default encoding, the RG8 and R8 narrowings
the normal and sky-view maps take, the BC5 measurements, and the lit-area
verification tables are `relief/README.md`.

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
- Each body's target chromaticity is its published **B−V / V−R**,
  expressed as flux ratios against the Sun's own indices and mapped
  B→blue, V→green, Rc→red. Planets take Mallama, Krobusek & Pavlov 2017
  (Icarus 282, 19, Table 3); satellites take Frey & Lowman, NASA Goddard
  X-922-74-112 (1974), Table IV, carrying Harris 1961 via Newburn &
  Gulkis 1973.
- **The photometric system is stored per row**, because the two sources
  are not on the same one. Frey & Lowman's Table III puts its R filter at
  0.69 µm — Johnson R, against Cousins Rc's ~0.64 — and the solar anchor
  (`SUN_VRC` = 0.352) is Cousins. Reading a Johnson index against it
  reddens the body: **0.26 mag on Titan**, worse than the hand tint it
  replaces. Each row keeps the number its source published and
  `vrc_of` converts, interpolating the paired Johnson/Cousins columns of
  Fitzgerald 1970 + Ducati et al. 2001 as tabulated by STScI, whose
  Cousins side is Bessell 1979. Inverting that transform at the adopted
  solar V−Rc returns a Johnson solar V−R of 0.53 against the ~0.52 the
  system is usually quoted at, which is the cross-check that it is
  pointing the right way.
- Per-map linear-RGB gains move the map's **sphere-weighted mean**
  (rows weighted by cos-latitude; no-data gaps excluded) onto the
  target. The triple is **normalised so its largest member is 1**, so a
  map is only ever darkened and no channel can clip: a gain above 1
  pins every already-bright texel at 255 and the mean stops short of
  the target, which is how Earth's 1.34× blue over its snow and ice
  landed 0.124 off — forty times the tolerance then in force. Only the
  ratios reach the screen, because the renderer divides each map's own
  mean luminance back out, so nothing is lost by giving up the old
  mean-luminance-preserving property that clipping broke anyway.
  Achieved-vs-target numbers live in the committed `calibration.json`,
  pinned by `scripts/textures/texture-calibration.test.ts`.
- **Eight moons are now index-calibrated** — Io, Europa, Ganymede,
  Callisto, Dione, Rhea, Titan and Triton, the bodies Frey & Lowman give
  both indices for. Enceladus, Tethys and Iapetus have a published B−V
  but **no V−R**, and Mimas has neither, so they keep the hand
  treatment: a red target cannot be invented for them, and half a
  measured target is not better than an honest one.

What the calibration corrects, per planet:

- **Earth** — the cloudless BMNG April-2004 base+topography composite
  reads warm (its ocean is flat dark surface reflectance and its land
  and snow dominate the mean); pulled to Earth's measured bluish tone.
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

Moon treatments:

- **Moon** — LROC WAC colour (NASA SVS CGI Moon Kit), untouched. Frey &
  Lowman covers outer-planet satellites only, so it carries no lunar row;
  its map is already natural colour rather than tinted or enhanced, which
  is why it is the one body that loses nothing by waiting.
- **Io / Ganymede** — USGS Galileo/Voyager colour merges, now calibrated
  to their measured indices (Ganymede's un-imaged polar wedges gap-fill
  with the map's feathered mean colour).
- **Europa / Callisto** — the only global USGS mosaics are grayscale, so
  the calibration gains ARE the tint, exactly as on Mercury. This
  replaces the old half-chroma hand tint against each body's
  representative colour.
- **Saturnian mids (Mimas, Enceladus, Tethys, Dione, Rhea, Iapetus)
  and Triton** — Schenk 2014 IR-G-UV *enhanced-colour* mosaics; the
  colour separation is exaggerated far past what the eye would see on
  these near-neutral ices, so the build pulls chroma halfway back
  toward gray (`DESATURATE`). **Desaturation runs before calibration**
  where a body takes both (Dione, Rhea, Triton): the two are orthogonal —
  one pulls back the exaggerated separation, the other puts the resulting
  mean on the measured index — but only in that order, since desaturating
  afterwards would drag the calibrated mean back toward gray. Triton's
  un-imaged northern hemisphere gap-fills with the map's feathered mean
  colour, like Pluto's band.
- **Titan** — Cassini ISS 938 nm mosaic: surface detail seen THROUGH
  the opaque haze, not the visible-light appearance. Calibrated to
  Titan's measured B−V 1.29 / V−R 0.84, which IS the naked-eye haze
  colour, so the grayscale reads as faint markings under it (the
  Venus-style "features colourised to visible tones" caveat). The
  measurement replaces a hand-picked full-chroma orange.
- **Uranian moons** — no texture by design: Voyager southern-
  hemisphere-only coverage; they exercise the renderer's texture-less
  base path. Frey & Lowman does give Titania and Oberon, so a row exists
  if one ever ships a map.

The remaining hand treatments live in `build-textures.py` (`DESATURATE`,
gap-fill + flip helpers).

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
