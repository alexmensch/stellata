# Blackbody colour LUT

`blackbody-lut.ts` — Ballesteros 2012 (B–V → Teff) + Planck spectrum +
CIE 1931 colour matching → 256-entry **linear-sRGB** lookup table indexed
by B–V over [-0.4, 2.0]. Output:
`src/client/star-pipeline/blackbody-lut-data.ts` (committed;
AUTO-GENERATED — `pnpm run build:lut` to regenerate on drift).
Byte-signature pinned by `blackbody-lut.test.ts`.

## Linear storage, peak-normalised

The table holds **linear light, not gamma-encoded values** — the HDR
tone-map pass is the codebase's only sRGB encode
(`docs/science-hdr-pipeline.md` § 2), so an encode here would be a
double one. Every named-star pin in the test encodes on read, which is
why the Python reference triplets are unchanged by the switch.

Entries are normalised so the **largest component is 1**, not so
luminance is 1. The design gate asks emission sites for a `Y = 1`
chromaticity, but a Y-normalised triplet reaches 1.88 at the blue end and
will not fit a uint8 table; the star vertex shader divides its sample by
`dot(rgb, LUMA_WEIGHTS)` instead. Peak-normalised linear also quantises
well — the smallest component anywhere in the table is 0.189 (red end),
so uint8 costs at most 0.91%.

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
