# Texture pipeline

Planet texture build + sync. Data contract and per-body provenance
live in `data/textures/README.md`; this folder owns the two scripts.

- `build-textures.py` — `data/textures/src/` → `data/textures/`
  artifacts (per-body ≤2048-wide equirect JPEG + the 2048×1 RGBA
  `<body>-rings.png` strips: Saturn from the Jónsson radial profiles,
  Uranus/Neptune from authored ring tables at true opacity —
  `data/textures/README.md` § Ring strips). Manual, infrequent
  (`pnpm run build:textures`); needs Pillow. Idempotent via mtime
  against source + script. Uranus is deliberately absent from
  `BODIES` (2f6.6 design record: texture-less by design — its ring
  strip is separate). `ring-strips.test.ts` pins `RING_TABLES` spans
  to `SOL_PLANETS` and the strips' 8-bit visibility claims.
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
