# Blackbody colour LUT

`blackbody-lut.ts` — Ballesteros 2012 (B–V → Teff) + Planck spectrum +
CIE 1931 colour matching → 256-entry sRGB lookup table indexed by B–V
over [-0.4, 2.0]. Output: `src/client/star-pipeline/blackbody-lut-data.ts`
(committed; AUTO-GENERATED — `npm run build:lut` to regenerate on
drift). Byte-signature pinned by `blackbody-lut.test.ts`.

`blackbody-lut-pure.ts` — pure helpers (Planck integration, Ballesteros
inverse, CIE chromaticity → sRGB). Re-used by
`src/client/star-pipeline/star-color-routing-pure.ts` for the runtime
six-tier routing.

`ballesteros-glsl-drift.test.ts` — pins the `ballesterosBvFromTeff`
function body in `src/client/star-pipeline/star.vert.glsl` against the
TS coefficients in `blackbody-lut-pure.ts`. A coefficient drift on
either side fails the test; intentional edits update both sides AND
the inline snapshot.

The LUT is consumed at render time via `DataTexture` sampling in the
star vertex shader.
