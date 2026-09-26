# Milky Way band on WebGPU

The band's graph: a log-distributed march through each proxy mesh with
running per-channel dust extinction. The density profiles, the ρ₀ solve
and the calibration live in `../../milkyway/` and are not re-decided
here.

<a id="the-chart-isobar-contour-has-never-drawn"></a>**The chart isobar contour has never drawn.** Chart
mode hides both meshes, so the branch is unreachable
([Chart mode + warp](../../milkyway/README.md#chart-mode--warp)). It is kept for a
future treatment, not because anything renders it. Treat every mention
of it below as describing dead code.

The layer owns its two proxy meshes, the per-frame galactic-centre
rebase, every debug-panel lever and the chart handoff; this folder is
only the materials it takes through [The material seam](../../milkyway/README.md#the-material-seam).

## Files in this area

```
src/client/webgpu/milkyway/
  milkyway-band-tsl.ts      The march, in both components.
  milkyway-band-tsl-drift.test.ts
                            Constant-drift guard against the CPU mirror:
                            the march's step counts and τ conversion are
                            imported from milkyway-column-pure, never
                            restated. README.md#the-bound-is-taken-off-the-mirror-so-this-march-has-to-match-it.
  band-uniform-nodes.ts     The seam's two uniform blocks as TSL nodes —
                            the shared group and the per-component one.
  tsl-band-materials.ts     The factory implementing BandMaterials.
```

## The bound is taken off the mirror, so this march has to match it

`MilkyWay.peakSurfaceBrightnessBound` is computed from
`../../milkyway/column/milkyway-column-pure.ts` and decides whether the band draws
at all ([The brightest rendered sightline](../../milkyway/README.md#the-brightest-rendered-sightline)), so a
march here that has drifted from that mirror yields a bound on a picture
nobody is looking at — and the failure is silent,
because the bound stays internally consistent while being about the wrong
shader. `milkyway-band-tsl-drift.test.ts` holds the march's own shape
(`STEPS`, `FOREGROUND_DUST_STEPS`, `S_MIN_PC`, `UNIT_BALL_SLACK`,
`MAG_PER_TAU`) and what the resolution-hole fetch scales its two
coordinates by (`RESOLVED_HOLE_SHELLS` / `_LOG_DISTANCE0` /
`_DEX_PER_SHELL` / `_MIN_DISTANCE_PC`) to the mirror's constants by
import, plus the explicit `.level(int(0))` on the hole fetch, which keeps
the sampler's derivatives out of the march
([The table is a 3D grid](../../milkyway/calibration/README.md#the-table-is-a-3d-grid-not-a-uniform-array)). The profile and dust parameters need no entry there: they arrive
as uniform nodes that `seedBandSharedSlots` alone writes ([Seeding,
because a node starts on its declared default](#seeding-because-a-node-starts-on-its-declared-default)). The hole grid crosses as
a `texture3D()` node over the `Data3DTexture` the seed and the debug lever
write in place — its extent reaches the shader as the one constant the
coordinate divides by, so nothing else about the layout can drift.

The write tail it ends on is `../extended-emitter-tsl.ts`, shared with
the Local Group emission.

## The shared nodes are built once per factory

The disc and the bulge hold the dust model, the galactic frame, the
surface-brightness anchor and the chart isobar **by reference to each
other** — one slider write reaches both draws. So
`bandSharedUniformNodes()` is called once in the factory and both
components take the same node objects. A factory per component would give
two independent dust models that happened to agree until the first slider
move — so `bootWebGpu` caches this factory rather than rebuilding it per
read, unlike the per-consumer ones beside it (`../README.md`).

**These are deliberately NOT the shared uniform-node mirror's**, even
where a name collides — `uDustEnabled`, `uExtinctionStrength`,
`uDustAvPerDensityPc`, `uWorldOffset`. Those mirror the *frame-wide* map,
which `registry.sync()` copies from every rendered frame; a write the band
made into one would be overwritten on the next frame.
`Stellata.setExtinctionStrength` writes the frame map and the band
separately for the same reason.

Only `uLimitMag`, the six HDR emitter slots and the two solid angles come
off the mirror — those the band genuinely reads by reference from the
exposure controller and the HDR pipeline.

## Seeding, because a node starts on its declared default

A `uniform()` node is constructed with a literal, not with the layer's
authored constant, so the placeholders in `bandSharedUniformNodes` are
never what a shader should march. **The factory seeds them**, through
`seedBandSharedSlots` (`../../milkyway/band-materials.ts`) — the one
writer of the authored values, so the layer holds no copy of the list. A slot added to `BandSharedSlots` without a line there
fails `band-materials.test.ts`.

## The chart toggle rebuilds the pipeline; the clouds' does not

`setIsobar` swaps `material.blending` and sets `needsUpdate`, which is a
WGSL recompile of the march — blend state is baked into a
WebGPU pipeline, so the swap cannot land without one. The sibling cloud
layer deliberately refused that trade and put its chart flip in a uniform
branch instead ([One rim graph, both modes](../molecular-clouds/README.md#one-rim-graph-both-modes)).
The band diverges because its uniform branch is the *dead* one:
the recompile is what the blend swap costs, and it lands on chart **exit**,
when the meshes unhide. Unmeasured, and cheap to make moot — the flip has
nothing to show either way while the contour does not draw.

## `uIsBulge` becomes compile-time

The builder takes the flag and emits one density profile or the other,
so there is no branch and no dead half. Same consequence as the LG
family split: a component's profile is fixed for the material's life.

## Three outcomes, none of which can be a return

The fragment resolves to no coverage, the isobar contour ([dead](#the-chart-isobar-contour-has-never-drawn)),
or the emission, and WGSL has no value-carrying return to bail with. So
coverage is one predicate and the three outcomes are nested selects.

**The isobar would be chart ink, not light**, so it claims neither the
statistic nor the diffuse attachment — the selects for those two exclude
the isobar branch as well as the uncovered one. That exclusion is
intent, not an observed behaviour: nothing draws under
`uChartIsobar = 1`.

**`sb` is computed outside the branch**, so the screen-space derivatives
stay in uniform control flow.
`fwidth` has no TSL node and is `|dFdx| + |dFdy|` by definition.

**Both arms of every `select` are evaluated** — that is what `select` is,
in TSL and in WGSL alike — so the emitter tail and the (dead) isobar path
are both live on every covered fragment. A real cost, and an unmeasured
one.

## The dust is the analytic slab

The band marches the **analytic** dust slab; the measured-dust cascade —
the per-cloud tiering and the voxel-grid read — is `stellata-ty4.5`'s,
and the prefilter mechanism behind it is still behind a design gate
([Dust](../../milkyway/column/README.md#dust--the-analytic-tier-and-what-composes-with-it)).
