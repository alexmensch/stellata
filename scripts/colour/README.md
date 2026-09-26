# Blackbody colour LUT

`blackbody-lut-pure.ts` — the chromaticity chain and the LUT shape
constants, node-free so client code can import it:
[Ballesteros 2012](/data/papers/index.md#ballesteros2012) eq. 14 (B–V → Teff)
and its analytic inverse — this project's algebra, since the paper gives only
the forward relation — the Planck spectrum, CIE 1931 colour matching
([Wyman 2013](/data/papers/index.md#wyman2013) multi-Gaussian fits), the
sRGB D65 transform, and `linearSrgbFromColourIndex` — one call from a
colour index to a peak-normalised linear triplet.

`blackbody-lut.ts` — quantises that chain into a 256-entry
**linear-sRGB** lookup table indexed by B–V over [-0.4, 2.0]. Output:
`src/client/star-pipeline/blackbody-lut-data.ts` (committed;
AUTO-GENERATED — `pnpm run build:lut` to regenerate on drift).
Byte-signature pinned by `blackbody-lut.test.ts`.

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

Four consumers reach past the table into the pure module:
`scripts/catalog/spectral/physical-radius.ts` for the
inverse of [Ballesteros 2012](/data/papers/index.md#ballesteros2012) eq. 14 at
build time, and — for their population tints
([Population colours](/src/client/milkyway/calibration/README.md#population-colours--the-discs-is-solved-not-cited)) — the
band's column integrand, the Local Group emission block, and the
population constants the two layers share in
`src/client/hdr/emission/population-colour-pure.ts`. Which is why the
chain lives there and not beside the CLI. A layer's
component hue and a single star's are then the same function of B–V,
differing only in that the layer takes it unquantised.

**That equivalence is pinned, not assumed.** `blackbody-lut.test.ts`
sweeps the whole B–V range and holds `linearSrgbFromColourIndex` against
`sampleLut` to **0.669 / 255** worst case — under one quantisation step,
so the two routes cannot silently diverge. The chain's own behaviour
(Python parity, peak- not luma-normalisation, monotonic warmth) is
`blackbody-lut-pure.test.ts`, beside the code.

## One definition of the coefficients, three implementations

`BALLESTEROS_T0` / `BALLESTEROS_BV_SCALE` / `BALLESTEROS_QUAD_LINEAR` /
`BALLESTEROS_DISC_K2` are exported from `blackbody-lut-pure.ts` and are
the single definition. Two of the three implementations import them
(the functions here, and the TSL graph in
`src/client/webgpu/star/star-vertex-tsl.ts`); GLSL cannot, so
`../../src/client/webgpu/star/star-vertex-tsl.ts` imports each one, so
nothing can drift from its position in the
expression against the exported constant, plus an inline snapshot of the
whole body so a reshuffle or sign flip fails too. Intentional edits
change the constants AND the snapshot.

The LUT is consumed at render time via `DataTexture` sampling in the
star vertex shader.
