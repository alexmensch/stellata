# Texture pipeline

Planet texture build + sync. Data contract and per-body provenance
live in `data/textures/README.md`; this folder owns the two scripts.

- `build-textures.py` — `data/textures/src/` → `data/textures/`
  artifacts (per-body ≤2048-wide equirect JPEG + the 2048×1 RGBA
  `saturn-rings.png` strip). Manual, infrequent (`pnpm run
  build:textures`); needs Pillow. Idempotent via mtime against source
  + script. Uranus is deliberately absent from `BODIES` (2f6.6 design
  record: texture-less by design).
- `sync-textures.ts` (+ `-pure.ts`, test) — mirrors the committed
  artifacts to `public/textures/` (gitignored) on every `pnpm run
  build` / `dev`; pure copy, so CI/deploy never needs Pillow. The
  allowlist predicate keeps README/source files out of the deployed
  bundle, mirroring `scripts/dust/sync-dust-pure.ts`.
