# Extinction march tap sweep

Analysis-only. Prices the accuracy side of the per-star extinction march's
tap budget ([The march](/src/client/star-pipeline/extinction/README.md#the-march)):
each tap scheme's A_V error against the converged in-cube integral the
catalogue build uses, over sampled catalogue stars, from several vantages.
Nothing here ships or feeds a build artifact.

```bash
pnpm run analyse:march-taps                # ~20 s, needs data/dust/ (LFS) + public/ built
pnpm run analyse:march-taps -- --stars 5000
```

```
scripts/dust/march-taps/
  march-taps-pure.ts    Nearest-rank percentiles, the deterministic stride
    (+ test)            sample, the fixed-unclipped march shape, the frozen
                        48-tap yardstick both this sweep and ../prefilter/
                        quote against, and the single-precision twin.
  measure.ts            Entry point: the sweep.
```

## What it measures

Per vantage, per scheme: mean taps per star (the GPU loop's trip count —
the kernel is texture-fetch bound, so this is close to a linear cost
lever) and the p50 / p90 / p99 / max of |A_V(scheme) − A_V(reference)| in
magnitudes. The reference is `avAlongSegment`
(`scripts/catalog/distance/dust/dust-deextinction-pure.ts`): midpoint rule at
a step of at most one voxel over the segment's overlap with the cube.
Every scheme samples the same CPU trilinear read of the encoded grid the
GPU sampler performs, so the residual is quadrature alone.

Schemes:

- **unclipped fixed 48** — `unclippedFixedMarch`: taps spread over the
  whole camera→star segment, out-of-cube taps skipped but spent.
- **clipped fixed N** — `dustRaymarchAv` with a constant tap rule: N taps
  over the in-cube overlap.
- **d pc/tap cap c** — `dustRaymarchAv` with `dustMarchTapCount(len, d)`
  capped at `c`: one tap per `d` pc of in-cube path, clamped to
  `[DUST_TAPS_MIN, c]`, at the pre-clip cap of 48 and at `DUST_TAPS_MAX`.
  The row marked *(shipped)* is `DUST_TAP_PC` at `DUST_TAPS_MAX`.
- **…, fp32** — the shipped rule with every operation rounded to single
  precision (`fp32March`), against the same double-precision reference.
  [Single precision is where the difference shows](#single-precision-is-where-the-difference-shows).

Vantages: Sol, and 500 pc / 3 kpc / 1 Mpc along the galactic north pole
(`GALACTIC_NORTH_POLE_ICRS`). The 1 Mpc row is the `lg` canon vantage's
regime — every sightline crosses the whole cube.

## Reading a result

**Choose on the tail, not the median.** The median error stays under
0.01 mag for every scheme; the p99 and max are where a coarse tap steps
over a cloud core, and a star a few tenths of a magnitude wrong is the
visible failure. State the vantage with any figure: from inside the dust
the unclipped and clipped fixed schemes agree, from outside they do not.

**The density moves the mean; the cap moves the tail.** Every scheme
sharing a cap shares its max at Sol, because the worst sightline runs
through a core the cap cannot resolve at any density. Raise the cap for
the tail, lower the density for the cost.

The clipped schemes' mean taps at Sol are what a `--force-recompute`
dwell pays per star in the fetch-bound kernel; the unclipped row's 48 is
paid whether or not the taps land inside the cube.

## Single precision is where the difference shows

Every scheme above runs in JavaScript, which computes in double precision
(64-bit floating point, ~16 significant digits). Both shaders compute in
single precision (32-bit, ~7 digits), and the gap is not uniform over the
vantages: from far outside the cube, a tap position is `absFrom + delta·t`
where both terms are around a million parsecs and the answer is around a
thousand, so the two large numbers cancel and the surviving digits are the
few the inputs had left. At 1 Mpc a single-precision coordinate is only
good to ~0.06 pc to begin with, against a 4.88 pc voxel.

Measured rather than argued — the `fp32` row against its
double-precision twin, 20k stars:

| vantage | p50 | p90 | p99 | max |
| --- | --- | --- | --- | --- |
| Sol, 500 pc | identical | identical | identical | identical |
| 3 kpc | identical | identical | identical | +0.0002 |
| 1 Mpc | identical | identical | +0.0004 | +0.0109 |

So the clip's far-vantage win survives single precision: the percentiles
do not move and the worst single star gains ~0.011 mag at 1 Mpc. **Keep
reading the `fp32` row whenever the vantage set grows outward** — the
error is set by how far the camera sits outside the cube, so a vantage
beyond 1 Mpc is not covered by this table.

`fp32March` prices the **geometry** alone. The sampler interpolates
between texels at its own limited sub-texel precision and the GPU's `exp`
is not correctly rounded; neither is modelled here, so this is a floor on
the divergence, not a bound on it. `stellata.verifyExtinction()` cannot
see any of it either — it compares two single-precision stages against
each other.
