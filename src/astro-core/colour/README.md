# Blackbody colour chain

`blackbody-lut-pure.ts` (+ test) — the chromaticity chain and the LUT
shape constants:
[Ballesteros 2012](/data/papers/index.md#ballesteros2012) eq. 14 (B–V → Teff)
and its analytic inverse — this project's algebra, since the paper gives only
the forward relation — the Planck spectrum, CIE 1931 colour matching
([Wyman 2013](/data/papers/index.md#wyman2013) multi-Gaussian fits), the
sRGB D65 transform, and `linearSrgbFromColourIndex` — one call from a
colour index to a peak-normalised linear triplet. The table quantised from
it, and why it is linear and peak-normalised, is
[`scripts/colour/`](/scripts/colour/README.md).

Four consumers reach past the table into this module:
`/scripts/catalog/spectral/physical-radius.ts` for the
inverse of [Ballesteros 2012](/data/papers/index.md#ballesteros2012) eq. 14,
and — for their population tints
([Population colours](/src/astro-core/milkyway/calibration/README.md#population-colours--the-discs-is-solved-not-cited)) — the
band's column integrand, the Local Group emission block, and the
population constants the two layers share in
`/src/astro-core/emission/population-colour-pure.ts`. A layer's
component hue and a single star's are then the same function of B–V,
differing only in that the layer takes it unquantised. The chain's own
behaviour (Python parity, peak- not luma-normalisation, monotonic warmth)
is `blackbody-lut-pure.test.ts`.

## One definition of the coefficients, three implementations

`BALLESTEROS_T0` / `BALLESTEROS_BV_SCALE` / `BALLESTEROS_QUAD_LINEAR` /
`BALLESTEROS_DISC_K2` are exported from `blackbody-lut-pure.ts` and are
the single definition. Two of the three implementations import them
(the functions here, and the TSL graph in
`src/client/webgpu/star/star-vertex-tsl.ts`); GLSL cannot, so
`/src/client/webgpu/star/star-vertex-tsl.ts` imports each one, so nothing can drift from its position in the
expression against the exported constant, plus an inline snapshot of the
whole body so a reshuffle or sign flip fails too. Intentional edits
change the constants AND the snapshot.
