# Band dust-prefilter sweep

Analysis-only. Nothing here ships or feeds a build artifact — it produced the
numbers behind `docs/science-galactic-structure.md` § The prefilter mechanism,
and it is the harness the band's prefiltered-vs-direct agreement pin should be
built on when the read lands (stellata-ty4.5).

```bash
pnpm run analyse:prefilter   # accuracy sweep, ~20 s, needs data/dust/ (LFS)
pnpm run analyse:prefilter-cost   # texel + fetch counts, instant
```

## What it measures

The band march reading its measured dust from a **froxel grid** — the A_V
column stored per (sky cell × log-distance slice) — against a direct march at
quarter-voxel steps. One emulation covers both parameterisations the design gate
named, because a camera-anchored all-sky map and a view-frustum grid differ only
in what indexes the cells; `FroxelConfig` spans the difference as a cell angle,
a slice count, a sub-cell phase and rays per cell.

Every figure is the read and the reference **both convolved over a 32-point flat
disc of 13.0′ diameter** — the resolve's summation patch
(`src/client/hdr/summation/README.md`). Comparing pointwise instead would score
a correct prefilter as error, since the display never carries finer structure.

`measure.ts` reports, per configuration: the surface-brightness error, the
measured-column error, the Rift-edge displacement (mag error over the local
gradient of the true profile — the angular error the requirement is stated in),
and the shimmer a screen-space grid shows as its cells slide under rotation
(the spread across sub-cell phase, which is identically zero for a sky-fixed
grid). `cost.ts` is arithmetic only, in dust-texture fetches per fill and texels
held, against the shipped per-star extinction prepass as the scale.

## The sweep it has not run

`TRUTH_STEP_PC` is one constant doing two jobs: the reference march's step
*and* the rate the froxel fill integrates each cell ray at. The second is a 2×
lever on fill cost that has never been priced — split the two and sweep the fill
rate over {1.22, 2.44, 4.88, 9.77} pc when the GPU spike says the fill is the
term that hurts (`docs/science-galactic-structure.md` § What is not measured).

## Two things to know before changing it

- **The grid is sampled trilinearly on decoded density, where the GPU filters
  the u8 log codes.** That is a geometric mean and under-reads a gradient; the
  deviation is deliberate, because the prefilter's own storage is linear in A_V
  and does not inherit it. Anything comparing against `dust-raymarch-pure.ts`
  has to account for the difference.
- **Coverage is the 1.25 kpc sphere, not the data cube.** The cube's corners
  carry data out to 2165 pc; the cascade contract is written on the sphere, and
  the entry/exit distances the read needs are its roots.
