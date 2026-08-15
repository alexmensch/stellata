# Band dust-prefilter sweep

Analysis-only. Nothing here ships or feeds a build artifact — it produced the
numbers behind `docs/science-galactic-structure.md` § The prefilter mechanism,
and it is the harness the band's prefiltered-vs-direct agreement pin should be
built on when the read lands (stellata-ty4.5).

```bash
pnpm run analyse:prefilter   # accuracy sweep, ~95 s, needs data/dust/ (LFS)
pnpm run analyse:prefilter-cost   # texel + fetch counts, instant
```

The pinned geometry — summation patch, the cell angle derived from it, slice
count, fill rate — is **not** here: the client's froxel fill reads the same
pins, so they live in `src/client/dust/froxel/froxel-pins.ts` with the
tan-space cell counts (`froxel-grid-pure.ts`) beside them. Everything below
imports from there.

```
scripts/dust/prefilter/
  dust-grid.ts          Chunk reader + the cascade's analytic tier. Grid
                        geometry and the u8-log decode come from
                        data/dust/manifest.json, never from constants here.
  froxel.ts             The grid emulation, the reference march, and the
    (+ test)            direct-read alternative.
  march-plan.ts         The band march factored so the dust read is a
    (+ test)            plug-in. Pinned bit-exact against
                        milkyway-column-pure's mirror with dust off.
  cost-pure.ts (+ test) The sky-fixed half of the cell-count geometry; the
                        screen-space half is the client's.
  measure.ts            Entry point: the accuracy sweep.
  cost.ts               Entry point: texel and fetch counts.
```

## What it measures

The band march reading its measured dust from a **froxel grid** — the A_V
column stored per (sky cell × log-distance slice) — against a direct march at
quarter-voxel steps. One emulation covers both parameterisations the design gate
named, because a camera-anchored all-sky map and a view-frustum grid differ only
in what indexes the cells; `FroxelConfig` spans the difference as a cell angle,
a slice count, a grid pose, rays per cell and a fill rate.

Every figure is the read and the reference **both convolved over a 32-point flat
disc** of the resolve's summation patch (`src/client/hdr/summation/README.md`),
whose 13.0′ diameter `froxel-pins.ts` derives from
`DEFAULT_SUMMATION_ARCSEC2` — so an instrument change moves the sweep with it.
Comparing pointwise instead would score a correct prefilter as error, since the
display never carries finer structure.

`measure.ts` reports, per configuration: the surface-brightness error, the
measured-column error, the Rift-edge displacement (mag error over the local
gradient of the true profile — the angular error the requirement is stated in),
and the shimmer a screen-space grid shows as its cells slide under rotation.
Both the displacement and the shimmer are taken **across grid poses**, since a
screen grid arrives at an arbitrary sub-cell offset *and* an arbitrary roll; a
sky-fixed grid holds one pose, so its shimmer is identically zero. `cost.ts` is
arithmetic only, in dust-texture fetches per fill and texels held, against the
shipped per-star extinction prepass as the scale.

## Three things to know before changing it

- **A screen-space grid is uniform in tan θ, not in solid angle.**
  `dθ/dx = cos²θ`, so the on-axis cell is the coarsest and the cell count is
  the tan-space area — 1.42× the solid-angle count at 50° FOV and 5.51× at
  120°. `src/client/dust/froxel/froxel-grid-pure.ts` owns that distinction;
  the accuracy sweep measures the coarsest cell, so its numbers apply to the
  whole frustum.
- **The grid is sampled trilinearly on decoded density, where the GPU filters
  the u8 log codes.** That is a geometric mean and under-reads a gradient; the
  deviation is deliberate, because the prefilter's own storage is linear in A_V
  and does not inherit it. Anything comparing against `dust-raymarch-pure.ts`
  has to account for the difference.
- **The plan's analytic tier is integrated finer than the shader's.** Two
  substeps per dust scale height against the shader's one sample per march
  step — 0.013 mag at an extragalactic vantage, pinned in
  `march-plan.test.ts`. Both the froxel read and the direct read carry it, so
  it cancels in every ΔS the sweep reports; it would not cancel against a
  shipped-march number.

## Coverage is the 1.25 kpc sphere, not the data cube

The cube's corners carry data out to 2165 pc; the cascade contract is written
on the sphere inscribed in it, and the entry/exit distances the read needs are
its roots.
