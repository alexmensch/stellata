# Build-time de-extinction

The Sol→star extinction the catalogue build subtracts from every record's
`absmag` and observed `ci`, integrated through the same encoded Edenhofer
dust grid the runtime march samples. The cancellation invariant below is
the load-bearing content — a change to either side of it ships with the
other.

## Files in this area

```
scripts/catalog/distance/dust/
  dust-deextinction-pure.ts       The converged integral over a segment's
    (+ test)                      overlap with the cube (`avAlongSegment`,
                                  with `avSolToStar` the origin-anchored form
                                  the build calls), sharing the runtime
                                  march's `segmentCubeOverlap`; the trilinear
                                  sampler mirroring the GPU read
                                  (`sampleEncodedAt`, decoded by
                                  `sampleDensityAt`); and the shared `R_V`.
                                  Imported by ../../parse/, ../../companions/
                                  and scripts/dust/march-taps/.
  dust-deextinction.ts (+ test)   `loadDustGrid` assembles data/dust/
                                  (manifest + 64 chunks) into one flat grid;
                                  decode constants come from the manifest,
                                  never redefined.
```

## Why the build subtracts

AT-HYG `absmag` is `mag − 5·log₁₀(d/10)` with no de-extinction, so it
embeds the real Sol→star extinction A_V; the ~15% of stars without an
Apsis Teff carry the observed (reddened) B−V in `ci` too. The runtime
shader then raymarches the camera→star A_V and adds it on top — so with
the camera at Sol a dusty-sightline star used to render ≈2·A_V too faint
(and tier-3 colours double-reddened): extinction counted once in the data
and once in the raymarch.

The fix de-extincts at build time against **the same encoded dust the
shader raymarches**: `absmag' = absmag − A_map(Sol→star)` and
`ci' = ci − A_map/R_V`, where `A_map` is a converged Sol→star integral
through the Edenhofer voxel grid. Because the source is the same model
the runtime re-adds, at camera=Sol the build subtraction and the runtime
addition cancel identically for every star — map calibration, cube
truncation at 1.25 kpc, and the `avPerDensityPerPc` conversion all cancel
by construction — so rendered `appMag` reproduces the AT-HYG observed
magnitude. The only at-Sol residual is the shader's tap-rule quadrature
against this converged integral
(`src/client/star-pipeline/extinction/README.md` § The march;
`scripts/dust/march-taps/README.md` measures it). Camera-anywhere: from
within the cube, vantages get physically consistent re-lighting.

- Runs inside `readStars` after the distance overrides settle final xyz,
  **before** `physicalRadius` (radii size off the de-extincted, brighter
  absmag — hence the count re-pin) and before companion promotion.
- Promoted companions de-extinct along their own sightline in
  `../../companions/companion-promotion.ts`, except where the value is
  already intrinsic: a spectral-derived absmag (class→M_V) and a derived
  ci (Ballesteros / solar fallback) are left untouched; observed-photometry
  absmag and the row's own observed ci get the subtraction.
- **Dust data absent at build → HARD FAIL** (`loadDustGrid` throws). The
  Bailer-Jones soft-continue precedent does not apply: a soft-continue
  would ship extincted absmags into a runtime that assumes de-extincted,
  silently reintroducing the double-count.
- Beyond the 1.25 kpc cube the runtime raymarch adds ≈0, so distant
  dusty sightlines stay single-counted (extinction embedded in absmag,
  still exact from Sol) until the raymarch stack is extended.

## The invariant

The build-time de-extinction integral and the runtime extinction stack
must model the same dust (same maps + slab). Any runtime-stack change
ships with the mirrored build-side integral extension + a catalog rebuild
in the same release. The build integrates the converged in-cube integral
rather than the runtime's tap rule, on purpose: the tap constants stay
runtime-only knobs, the stored `absmag` (and the radius derived from it)
stays anchored to the map rather than to a quadrature, and the residual
the sweep reports is the whole cancellation error. Apsis `azero_gspphot`
(offset 64–67) is a validation cross-check only, never the de-extinction
source — a different estimator than the raymarch would leave a Sol
residual.
