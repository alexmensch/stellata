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

The LUT is consumed at render time via `DataTexture` sampling in the
star vertex shader.
