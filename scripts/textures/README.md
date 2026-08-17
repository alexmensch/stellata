# Texture pipeline

Planet texture build + sync. Data contract and per-body provenance
live in `data/textures/README.md`; this folder owns the scripts.

- `build-textures.py` — `data/textures/src/` → `data/textures/`
  artifacts (per-body ≤2048-wide equirect JPEG + the 2048×1 RGBA
  `<body>-rings.png` strips: Saturn from the Jónsson radial profiles,
  Uranus/Neptune from authored ring tables at true opacity —
  `data/textures/README.md` § Ring strips — + the 4096-wide
  `<body>-normal.webp` and paired 2048-wide `<body>-horizon-{a,b}.webp`
  relief maps for the three bodies with a usable
  global DEM). Manual, infrequent
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
  statistics in `data/textures/relief.json`, the shipped maps' own
  dimensions read from their WebP headers, and the +1 encoding of the
  unused third channel. Rationale: `data/textures/README.md`
  § Surface relief.
- `horizon_map.py` — cast-shadow half of the build (imported by it):
  per-texel skyline elevation in 8 azimuths, encoded as sines into the
  two `<body>-horizon-{a,b}.webp` planes. Owns the exact spherical
  elevation-angle geometry that makes the body's own limb an occluder,
  the search arc that bounds it, and the encoding scale.
  `horizon-map.test.ts` pins the azimuth count and that scale against
  `surface-relief-pure.ts`, the search arc against the renderer's
  fallback limb bound, and the manifest rows against the shipped
  planes' own headers. Rationale: `data/textures/README.md`
  § Cast shadows.
- `measure_relief_lighting.py` — manual, run by hand, NOT part of the
  build: reads the SHIPPED maps and reports how much ground each relief
  term lights past the terminator against an exact per-texel horizon,
  plus the disc integral against phase. The verification behind both
  § Cast shadows and
  `src/client/solar-system/planets/emission/README.md`; re-run it before
  anything fits a phase curve.
- `webp-header-pure.ts` — dimensions and the LFS-pointer check straight
  out of a lossless WebP's own header, so an artifact pin reads the
  artifact rather than the manifest beside it. Shared by both relief
  test suites.
- `reduce_dem.py` — one-shot, run by hand, NOT part of the build:
  downloaded 0.5–2.0 GB global DEM → the frozen
  `data/textures/src/<body>-dem-*.tif` reduction. Carries the decode
  traps (USGS int16-in-mode-`I` strips, the SVS half-metre datum) and
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
