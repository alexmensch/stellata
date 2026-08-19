# DEM-derived relief maps

The surface-relief and cast-shadow artifacts for the four bodies with a
usable global DEM — **Moon, Mercury, Mars, Earth** — plus the measurements
that decided their width, encoding and channel packing. The colour maps they
modulate, and the ladder those ride, are `../README.md`; the frozen DEM
reductions and their provenance are `../src/README.md`;
`scripts/textures/dem_relief.py` and `horizon_map.py` own the derivations.

These ship as **LFS** (`data/textures/relief/*.webp`) — normals at
3.7–7.4 MB each and a horizon pair at 4.1–9.4 MB. `sync-textures.ts`
mirrors them **flat** into `public/textures/`, alongside the colour rungs:
this folder groups them at rest, and the renderer's URLs are unchanged by
that grouping.

## Surface relief — DEM-derived normal maps

`<body>-normal.webp` is a **lossless WebP tangent-space surface-normal
map** derived from that body's real global DEM, shipped alongside the
colour map for the four bodies where it buys something measurable:
**Moon, Mercury, Mars at 4096×2048, and Earth at 8192×4096** — the width
is per body (`DEM_TARGET_W` is a default a body may override). Frozen DEM reductions and their
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
  **1.14° / 3.94°** (Mercury), **0.44° / 2.58°** (Mars), **0.0° / 0.52°**
  (Earth, all-texel — see the Earth note below for why that row is not
  comparable). The ordering Moon ≫ Mercury > Mars holds at every map
  width, which is why the Moon is the body this work is scoped around —
  at a 15° sun its p90 slope is a ~4× terminator brightness contrast.

**Lossless, and that is not a default.** Both channels through one lossy
WebP at q98 errs **1.58° of normal angle, mean**, against the Moon's
3.27° median tilt — about half the signal — so lossy encoding is
rejected at file level. Shipping the
**height** map and differencing in the shader is also rejected: 8-bit
height quantises to 0.82° of slope terracing, a third of the median
tilt, and a 16-bit height PNG is larger than the normal map it would
produce while costing three taps per fragment. What that q98 number is
and is not evidence of: § BC5 measured.

**Why 4096.** The slope signal buys terminator contrast and keeps
climbing with width — the Moon's p90 tilt goes 9.7° → 11.6° from 2048
to 4096. The colour ladder now reaches 8192 on the same bodies, so the
normal map is the narrower of the two and is the next thing to widen.

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
than a missing map. `surface-relief-pure.test.ts` pins the split.

### BC5 measured — and § Lossless caught the packing, not the codec

`measure_block_compression.py` runs the shipped maps through a reference
BC4/BC5 codec and through lossy WebP three ways, against the same 8-bit
source and the same cos(lat)-weighted statistics `dem_relief.py` reports
tilt under (|lat| ≤ 85°, its own quantile estimator). Normal-angle
error, mean / p90 / p99:

| body | BC5 | q98, one RGB file | q98, one file per channel |
|---|---|---|---|
| Moon | 0.42° / 1.01° / 1.91° | 1.58° / 3.43° / 7.42° | 0.48° / 1.01° / 1.42° |
| Mercury | 0.09° / 0.45° / 0.90° | 0.79° / 1.42° / 3.05° | 0.39° / 0.90° / 1.27° |
| Mars | 0.07° / 0.45° / 0.90° | 0.69° / 1.35° / 3.28° | 0.31° / 0.64° / 1.01° |

**The gap to the middle column is chroma subsampling, not DCT.**
libwebp's lossy path is 4:2:0, so an RGB file carries G at quarter
resolution — and here G is half the signal, not a chroma channel. Give
each channel its own grayscale file and the same codec at the same
quality ties BC5 at p90 on the Moon and beats it at p99 on all three.
So § Lossless's verdict transfers to *packing two independent channels
into one photographic frame*, which is the mistake it actually caught;
it says nothing about whether a DCT can carry a normal map. Quoting
BC5 as "a third of q98" would have decided the 8192 tier on that
artifact.

**BC5's case is VRAM, and it stands on its own.** 1 byte/texel resident
with mips: **11 MB per body at 4096, 45 MB at 8192** — half the `RG8`
upload again, where a WebP of any packing decodes to `RG8` and pays the
full 22 MB. That is the axis to decide 8192 on.

**The error is flat in resolution.** Same codec across widths — p90
1.006° at 1024, 1.052° at 2048, 1.007° at 4096 — while the signal keeps
climbing (p90 tilt 9.7° → 11.66° from 2048 to 4096), so every rung
improves the ratio. One caveat stands: the narrower rungs are
area-averaged encoded normals, not maps re-derived from a reduced DEM
the way `reduce_dem.py` builds the shipped one. The other has since been
answered — Earth's map is a real 8192, so the tier is no longer measured
only by extrapolation, though Earth's own slope signal is too weak to
re-test the codec against.

**It does not meet the bar stellata-2f6.46 set**, which was "near the
0.177° of an exact 8-bit encode"; BC5 is 5.7× that at p90. Recorded as
not-met rather than re-scored against a friendlier test — though the
bar was the wrong comparison: what decides a tier is error against the
*signal* (1.01° of 11.66° p90 tilt is 8.6 %) and VRAM against what a
doubling buys.

**Which bodies are eligible at all.** Relief applies only where the
rendered texture IS the solid surface. That excludes **Venus** (we
render the cloud deck by design), **Titan** (the 938 nm map is surface
seen *through* the haze, and the haze is the visible appearance), and
**all four giants**, which have no surface. No global DEM exists for
Io, Europa, Ganymede, Callisto, Triton, or the Saturnian mids;
Enceladus and Pluto have one each, and Pluto's covers the encounter
hemisphere only — matching its colour map's real data gap.

**Earth ships at 8192, and its DEM is clamped at the sea surface.** Its
land relief is the flattest of the four candidates by a wide margin and is
not worth shipping below 8192, which is why it waited; the colour ladder
reaching 8192 and the `RG8` upload settled that. Two things about it are
unlike the other three:

- **Elevation is clamped to ≥ 0 before the reduction averages.** Over
  water the visible surface is the sea surface, not the seabed — shipping
  raw bathymetry as relief measures a p90 of 1.37° against 0.93°, all of
  it wrong. Clamping *before* the area-average rather than after is what
  makes a coastal cell the mean visible surface height instead of a
  land-and-ocean mean dragged under by the seabed beside it. It also
  flattens the few real dry basins below datum (the Dead Sea shore at
  −430 m); separating those from ocean needs a land mask this product does
  not carry, and against an 8354 m span they cost nothing measurable.
- **Its `relief.json` tilt row is NOT comparable to the other three**,
  because 70.7 % of its surface is now flat ocean. All-texel median 0.0° /
  p90 0.521°; over land alone the same map measures **median 0.265° / p90
  2.157°**, max 35.3°. The land figure is the one the 8192 width was
  chosen on, and the one to read against the Moon's 11.66°.

Its horizon pair is therefore **4096×2048**, not 2048×1024 — the output
grid is half the DEM width by the identity in § Cast shadows.

**One consequence in the renderer.** With the floor at the reference sphere
there is no basin for a summit to stand over, so Earth's two limb bounds
coincide (2.93° both) — and the shader feeds that pair straight to
`smoothstep`, which is undefined when its edges are equal.
`reliefHorizonUniform` widens the band by 1e-4 at the uniform, leaving
`reliefHorizonSines` exactly the geometry so its `none` stays
`sin(search_arc)`.

## Cast shadows — DEM-derived horizon maps

`<body>-horizon-a.webp` + `-b.webp` are a **pair of lossless RGBA WebP**
— 2048×1024, and 4096×2048 on Earth, always half the body's own DEM width —
carrying, per texel, the elevation of the local skyline in **8
azimuths** — the eight channels of the two files concatenated, azimuth 0 on
east and running toward north. A normal map says which way the ground tilts;
this says what the ground can *see*. `scripts/textures/horizon_map.py` owns
the derivation, on the same four bodies and the same frozen DEMs.

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
  219 on Mercury, 446 on Mars, 326 on Earth (short, because its floor is
  the reference sphere rather than a basin). Not a cut-off: for the extremal pair (highest
  summit over deepest floor) the elevation angle *peaks* exactly there and
  every gentler pair peaks earlier, so nothing past it can win. It is the
  same quantity as the renderer's fallback limb bound, and
  `horizon-map.test.ts` pins the identity.
- **The march starts two output texels out and steps at the DEM's own
  resolution from there** — two independent parameters, and only the first
  moved. `HORIZON_MARCH_START_TEXELS` sets the near bound: 10.7 km on the Moon,
  15.0 on Mercury, 20.8 on Mars, 19.5 on Earth, past both the normal map's
  domain and what the colour map can draw. It used to be one DEM texel, 2.7 km, and that single step
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

