# Texture pipeline

Planet texture build + sync. Data contract and per-body provenance
live in `data/textures/README.md`; this folder owns the scripts.

Everything Python here runs on the project venv —
`requirements.txt` carries the install line. A rebuild is
pixel-reproducible but not byte-reproducible: Pillow's zlib build
picks the compressed stream, so a version change can rewrite an
artifact to identical pixels under a different tail. Revert that churn
rather than shipping it.

- `texture_ladder.py` — `RUNGS`, `MASTER_W`, and `rungs_for(width)`: the
  one answer to how wide a body's maps are, shared by the build and the
  reduction script. § Size ladder below.
- `reduce_source.py` — one-shot, run by hand, NOT part of the build:
  downloaded full-resolution map(s) → the frozen
  `data/textures/src/` master at `MASTER_W`. `--grid CxR` reduces each
  tile of a tiled original *before* placing it, so the assembled grid is
  never held whole (Earth's eight BMNG tiles are 11 GB assembled, 96 MB
  a tile at a time). Preserves a grayscale original's single channel,
  and asserts the result is 2:1 equirectangular so a mis-ordered mosaic
  fails loudly rather than shipping a scrambled world.
- `build-textures.py` — `data/textures/src/` → `data/textures/`
  artifacts (per-body ladder of equirect JPEGs + the 2048×1 RGBA
  `<body>-rings.png` strips: Saturn from the Jónsson radial profiles,
  Uranus/Neptune from authored ring tables at true opacity —
  `data/textures/README.md` § Ring strips — + the 4096-wide
  `<body>-normal.webp` and paired half-width
  `<body>-horizon-{a,b}.webp` relief maps for the four bodies with a
  usable global DEM — Earth at double the rest). Manual, infrequent
  (`pnpm run build:textures`); needs Pillow + NumPy. Idempotent via
  mtime, per artifact, against its own sources and the helper module
  it derives from — only this script gates everything, so editing the
  relief leg does not rewrite the colour maps or the ring strips.
  Uranus is deliberately absent from
  `BODIES` (2f6.6 design record: texture-less by design — its ring
  strip is separate). `ring-strips.test.ts` pins `RING_TABLES` spans
  to `SOL_PLANETS` and the strips' 8-bit visibility claims.
- `dem_relief.py` — surface-relief half of the build (imported by
  it): the `DEM_BODIES` per-body contract and the DEM →
  tangent-space normal-map derivation. Owns the three facts nothing
  else can state — each frozen DEM's own map centre versus its
  **colour** map's (the build rolls the first onto the second), the
  radius the body is drawn at, which sets the slope scale, and the
  elevation span, which both decodes the reduction and gives the
  renderer its limb bound on relief lighting.
  `dem-relief.test.ts` pins all three against `SOL_BODIES` /
  `RotationElements.mapCenterLonDeg` /
  `surface-relief-pure.ts:RELIEF_ELEV_SPAN_M`, plus the achieved tilt
  statistics in `data/textures/relief/relief.json`, the shipped maps' own
  dimensions read from their WebP headers, and the +1 encoding of the
  unused third channel. Rationale:
  `data/textures/relief/README.md` § Surface relief.
- `horizon_map.py` — cast-shadow half of the build (imported by it):
  per-texel skyline elevation in 8 azimuths, encoded as sines into the
  two `<body>-horizon-{a,b}.webp` planes. Owns the exact spherical
  elevation-angle geometry that makes the body's own limb an occluder,
  the search arc that bounds it, and the encoding scale.
  `horizon-map.test.ts` pins the azimuth count and that scale against
  `surface-relief-pure.ts`, the search arc against the renderer's
  fallback limb bound, and the manifest rows against the shipped
  planes' own headers. Rationale:
  `data/textures/relief/README.md` § Cast shadows.
- `horizon_map.test.py` — stdlib unittest pins for the geometry the
  TS suite can only source-pin: the flat-ground floor's closed form,
  azimuth registration and its east/west handedness against a
  synthetic wall, the isolated-summit limb identity, and the encoding
  round-trip. Run directly: `python3 horizon_map.test.py` (needs
  NumPy). Not in CI, like every `*.test.py` here.
- `measure_relief_lighting.py` — manual, run by hand, NOT part of the
  build: reads the SHIPPED maps and reports how much ground each relief
  term lights past the terminator against the same march at full DEM width,
  plus the disc integral against phase. The verification behind both
  § Cast shadows and
  `src/client/solar-system/planets/emission/README.md`; re-run it before
  anything fits a phase curve.
- `measure_block_compression.py` (+ `block_compression.test.py`) —
  manual, run by hand, NOT part of the build: encodes the shipped
  normal maps through a reference BC4/BC5 codec and through lossy WebP
  three ways against the same 8-bit source, so the file-level verdict
  and the GPU-block-format verdict are one measurement. Reads the
  cos(lat) weighting, the ±85° window and the quantile estimator from
  `dem_relief.py` rather than restating them — the tilt figures these
  errors are quoted against come from there. Both WebP packings are
  measured because one RGB file puts the G channel in libwebp's shared
  4:2:0 chroma plane, which costs 3× what the DCT does and is what the
  file-level rejection actually caught. Also sweeps BC5 error against
  map width, which is how the 8192 tier gets decided without an 8192
  map to test. Rationale and the numbers:
  `data/textures/relief/README.md` § BC5 measured.
  Its unittest pins the codec — endpoint exactness, the
  per-mode error bound, the two-plane split, and the uint8-wraparound
  trap in the distance metric, on an **interior** texel: a block's min
  and max are exact palette entries under the wrapping metric too, so a
  fixture asserting only the extremes passes against the bug.
- `audit_sources.py` — manual, run by hand, NOT part of the build:
  measures every frozen source against the claims its provenance row
  makes — dimensions, near-black polar bands, the mirror test, mean
  chroma, and the longitudinal detail of any band a row calls
  reconstructed. Run it after ANY source swap. Polar bands are measured
  at the file's NATIVE row count so the edge matches the tenths the rows
  quote; the mirror and chroma passes run on a reduction, being
  scale-free. Every correlation is reported aligned AND longitude-shifted
  because only the gap between them is evidence. What each check can and
  cannot settle is `data/textures/src/README.md` § Auditing.
- `source-provenance.test.ts` — the mechanical half of that audit in
  CI: parses the provenance table and asserts every stated size against
  the file's own header (the FIRST size a row states, which is the
  README's own rule), the 2:1 equirect ratio, exact row and image-row
  counts so a source cannot leave coverage silently, and each row's
  colour-invention wording against `TINT_STRENGTH` / `DESATURATE` in
  `build-textures.py` — the one half of a row that is invented rather
  than measured. Self-skips per row on an unpulled LFS object, warning
  rather than passing quietly, like the two relief suites.
- `image-header-pure.ts` — dimensions straight out of a WebP, JPEG or
  TIFF header, so a pin reads the artifact rather than the prose beside
  it. Shared by both relief test suites and the provenance test. The
  LFS-stub gate is not here: `lfsContentReadable` in `../util/paths.ts`
  is the one every artifact-backed suite rides.
- `reduce_dem.py` — one-shot, run by hand, NOT part of the build:
  downloaded 0.5–2.0 GB global DEM → the frozen
  `data/textures/src/<body>-dem-*.tif` reduction, at the body's own
  `target_w` (8192 for Earth, `DEM_TARGET_W`'s 4096 for the rest).
  Applies a body's `clamp_min_m` BEFORE the area-average — Earth's sea
  surface — and asserts against `raw_span_m` where a body clamps, since
  the shipped span is then not the original's. Carries the decode
  traps (USGS int16-in-mode-`I` strips, the SVS half-metre datum, and
  ETOPO's tiled-compressed layout that has no strip block to memmap) and
  asserts the elevation span against the published one plus the
  absence of each body's declared no-data sentinel — declared per body
  because the SVS product is unsigned and has none, and a signed
  literal would compare false against it everywhere.
- `texture_calibration.py` — index-anchored colour calibration
  (imported by the build): per-map linear-RGB gains that move each
  map's sphere-weighted mean chromaticity onto the body's adopted
  Mallama 2017 B−V / V−Rc target, solar-spectrum reference white,
  luminance-preserving. Writes per-body numbers into
  `data/textures/calibration.json`;
  `texture-calibration.test.ts` pins targets, achieved means, and the
  index table. Rationale: `data/textures/README.md` § Colour fidelity.
- `sync-textures.ts` (+ `-pure.ts`, test) — mirrors the committed
  artifacts to `public/textures/` (gitignored) on every `pnpm run
  build` / `dev`; pure copy, so CI/deploy never needs Pillow. The
  allowlist predicate keeps README/source files out of the deployed
  bundle, mirroring `scripts/dust/sync-dust-pure.ts`.

## Size ladder

There is no one right width. 2048 is exactly right for 1080p and four
times short of a 5K display, so the build stops deciding and offers a
ladder instead: `texture_ladder.py` declares the rungs, the build writes
every rung a body's master can fill, and the renderer picks one per frame
(`src/client/solar-system/planets/README.md` § Texture tier selection).

**Where 8192 comes from.** `minOrbitDistForPlanet` solves
`d = R / tan(0.9 · fov_minor / 2)`, so at the camera floor EVERY body
spans 90 % of the viewport's minor axis, and the drawing buffer caps at
`min(devicePixelRatio, 2)`. An equirect map spends `W/2` texels on the
visible hemisphere, so texel-per-pixel needs `W = 2 · disc`:

| display | disc at floor | width needed |
|---|---|---|
| 1080p, dpr 1 | 972 px | 1944 |
| retina laptop (1117 css, dpr 2) | 2011 px | 4021 |
| 4K, dpr 1 | 1944 px | 3888 |
| 5K (1440 css, dpr 2) | 2592 px | 5184 |
| Pro Display XDR (1692 css, dpr 2) | 3046 px | 6091 |

**Two rules meet at the top rung**: never upscale, and never discard
detail the master already has. So the rungs are the powers of two below
the master, plus the master's own width — which is why Venus stops at
1800 and Saturn at 2880 rather than falling back to 1024 and 2048.

**The bodies that cap out are the right ones.** Venus 1800, Saturn 2880,
Jupiter 3601, Titan 4040 — every one a cloud or haze body. That is causal
rather than unlucky: a fluid atmosphere has no high-frequency detail to
photograph, so no sharper map was ever built and there is nothing sharper
to see. A soft Saturn is closer to correct than a sharp one. Pluto (5926)
and Mimas (6356) are the two solid surfaces short of 8192, both limited by
their frozen source rather than by physics.

**A full pyramid costs ~1.33× the top rung**, and only bytes at rest: a
client fetches one rung. Artifacts total ~137 MB against ~43 MB before
the ladder, while bytes over the wire go down.
