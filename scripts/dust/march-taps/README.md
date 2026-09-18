# Extinction march tap sweep

Analysis-only. Prices the accuracy side of the per-star extinction march's
tap budget (`src/client/star-pipeline/extinction/README.md` § The march):
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
    (+ test)            sample, and the fixed-unclipped march shape.
  measure.ts            Entry point: the sweep.
```

## What it measures

Per vantage, per scheme: mean taps per star (the GPU loop's trip count —
the kernel is texture-fetch bound, so this is close to a linear cost
lever) and the p50 / p90 / p99 / max of |A_V(scheme) − A_V(reference)| in
magnitudes. The reference is `avAlongSegment`
(`scripts/catalog/distance/dust-deextinction-pure.ts`): midpoint rule at
a step of at most one voxel over the segment's overlap with the cube.
Every scheme samples the same CPU trilinear read of the encoded grid the
GPU sampler performs, so the residual is quadrature alone.

Schemes:

- **unclipped fixed 48** — `unclippedFixedMarch`: taps spread over the
  whole camera→star segment, out-of-cube taps skipped but spent.
- **clipped fixed N** — `dustRaymarchAv` with a constant tap rule: N taps
  over the in-cube overlap.
- **adaptive d pc/tap** — `dustRaymarchAv` with `dustMarchTapCount(len, d)`:
  one tap per `d` pc of in-cube path, clamped to `[DUST_TAPS_MIN,
  DUST_TAPS_MAX]`. The shipped rule is `d = DUST_TAP_PC`.

Vantages: Sol, and 500 pc / 3 kpc / 1 Mpc along the galactic north pole
(`GALACTIC_NORTH_POLE_ICRS`). The 1 Mpc row is the `lg` canon vantage's
regime — every sightline crosses the whole cube.

## Reading a result

**Choose on the tail, not the median.** The median error stays under
0.01 mag for every scheme; the p99 and max are where a coarse tap steps
over a cloud core, and a star a few tenths of a magnitude wrong is the
visible failure. State the vantage with any figure: from inside the dust
the unclipped and clipped fixed schemes agree, from outside they do not.

The clipped schemes' mean taps at Sol are what a `--force-recompute`
dwell pays per star in the fetch-bound kernel; the unclipped row's 48 is
paid whether or not the taps land inside the cube.
