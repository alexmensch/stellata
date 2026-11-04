# Blackbody colour LUT

`blackbody-lut.ts` — quantises the B–V → linear-sRGB chain
(`/src/astro-core/colour/blackbody-lut-pure.ts`, its own README) into a
256-entry **linear-sRGB** lookup table indexed by B–V over [-0.4, 2.0].
Output: `src/client/star-pipeline/blackbody-lut-data.ts` (committed;
AUTO-GENERATED — `pnpm run build:lut` to regenerate on drift), written
through `emitArtifacts` (`../util/README.md`), declared in `blackbody-lut-outputs.ts`.
Byte-signature pinned by `/tests/integration/blackbody-lut.test.ts`.

## Linear storage, peak-normalised

The table holds **linear light, not gamma-encoded values** — the HDR
tone-map pass is the codebase's only sRGB encode
([§ 2](/docs/science-hdr-pipeline.md#2-tone-map-operator)), so an encode here would be a
double one. Every named-star pin in the test encodes on read, which is
why the Python reference triplets are unchanged by the switch.

Entries are normalised so the **largest component is 1**, not so
luminance is 1. The design gate asks emission sites for a `Y = 1`
chromaticity, but a Y-normalised triplet reaches 1.88 at the blue end and
will not fit a uint8 table; the star vertex shader divides its sample by
`dot(rgb, LUMA_WEIGHTS)` instead. Peak-normalised linear also quantises
well — the smallest component anywhere in the table is 0.189 (red end),
so uint8 costs at most 0.91%.

**The table and the unquantised chain are pinned equal, not assumed.**
`/tests/integration/blackbody-lut.test.ts` sweeps the whole B–V range and holds
`linearSrgbFromColourIndex` against `sampleLut` to **0.669 / 255** worst
case — under one quantisation step, so a layer that takes the chain
unquantised and a star that samples the table cannot silently diverge.

The LUT is consumed at render time via `DataTexture` sampling in the
star vertex shader.
