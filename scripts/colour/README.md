# Blackbody colour LUT

`blackbody-lut-pure.ts` — the chromaticity chain and the LUT shape
constants, node-free so client code can import it: Ballesteros 2012
(B–V → Teff) and its analytic inverse, the Planck spectrum, CIE 1931
colour matching (Wyman 2013 multi-Gaussian fits), the sRGB D65 transform,
and `linearSrgbFromColourIndex` — one call from a colour index to a
peak-normalised linear triplet.

`blackbody-lut.ts` — quantises that chain into a 256-entry
**linear-sRGB** lookup table indexed by B–V over [-0.4, 2.0]. Output:
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

Three consumers reach past the table into the pure module:
`scripts/catalog/catalog-pure.ts` for the Ballesteros inverse at build
time, and both volumetric layers for their population tints
(`src/client/milkyway/calibration/README.md` § Population colours) —
which is why the chain lives there and not beside the CLI. A layer's
component hue and a single star's are then the same function of B–V,
differing only in that the layer takes it unquantised.

`ballesteros-glsl-drift.test.ts` — pins the `ballesterosBvFromTeff`
function body in `src/client/star-pipeline/star.vert.glsl` against the
TS coefficients in `blackbody-lut-pure.ts`. A coefficient drift on
either side fails the test; intentional edits update both sides AND
the inline snapshot.

The LUT is consumed at render time via `DataTexture` sampling in the
star vertex shader.
