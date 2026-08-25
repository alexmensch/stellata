# Milky Way band on WebGPU

The TSL half of the band: a log-distributed march through each proxy mesh
with running per-channel dust extinction. The WebGL2 shaders
(`../../milkyway/`) stay the shipped renderer and the semantic reference;
the density profiles, the ρ₀ solve and the calibration are not re-decided
here.

**The chart isobar contour has never drawn, on either backend.** Chart
mode hides both meshes, so the branch is unreachable
(`../../milkyway/README.md` § Chart mode + warp). It is transcribed here
because the two shaders are maintained as one artefact — not because
anything renders it. Treat every mention of it below as describing dead
code kept warm for a future treatment.

**It ports as a material swap.** The layer keeps its two proxy meshes,
the per-frame galactic-centre rebase, every debug-panel lever and the
chart handoff, and takes its materials through `../../milkyway/README.md`
§ The material seam.

## Files in this area

```
src/client/webgpu/milkyway/
  milkyway-band-tsl.ts      The march, in both components.
  band-uniform-nodes.ts     TSL twins of the seam's two uniform blocks —
                            the shared group and the per-component one.
  tsl-band-materials.ts     The factory implementing BandMaterials.
```

The write tail it ends on is `../extended-emitter-tsl.ts`, shared with
the Local Group emission exactly as the GLSL chunk is.

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
made into one would be overwritten on the next frame. The band's WebGL
objects are its own too (`Stellata.setExtinctionStrength` writes the frame
map and the band separately), so mirroring them as the band's own nodes is
the faithful transcription, not a divergence.

Only `uLimitMag`, the six HDR emitter slots and the two solid angles come
off the mirror — those the band genuinely reads by reference from the
exposure controller and the HDR pipeline.

## Seeding, because a node starts on its declared default

A `uniform()` node is constructed with a literal, not with the layer's
authored constant, so the placeholders in `bandSharedUniformNodes` are
never what a shader should march. **The factory seeds them**, through
`seedBandSharedSlots` (`../../milkyway/band-materials.ts`) — the one
writer of the authored values, called by the WebGL factory too, so the
two backends cannot start on different constants and the layer holds no
copy of the list. A slot added to `BandSharedSlots` without a line there
fails `band-materials.test.ts`.

## The chart toggle rebuilds the pipeline; the clouds' does not

`setIsobar` swaps `material.blending` and sets `needsUpdate`, which on this
backend is a WGSL recompile of the march — blend state is baked into a
WebGPU pipeline, so the swap cannot land without one. The sibling cloud
layer deliberately refused that trade and put its chart flip in a uniform
branch instead (`../molecular-clouds/README.md` § One rim graph, both
modes). The band diverges because its uniform branch is the *dead* one:
the recompile is what the blend swap costs, and it lands on chart **exit**,
when the meshes unhide. Unmeasured, and cheap to make moot — the flip has
nothing to show either way while the contour does not draw.

## `uIsBulge` becomes compile-time

The GLSL carries it as a **uniform** and branches on it inside the
fragment — one program, two draws. Here the builder takes the flag and
emits one density profile or the other, so there is no branch and no dead
half. Same consequence as the LG family split: a component's profile is
fixed for the material's life, which it already was.

## Three outcomes, none of which can be a return

The fragment resolves to no coverage, the isobar contour (dead — § above),
or the emission, and WGSL has no value-carrying return to bail with. So
coverage is one predicate and the three outcomes are nested selects.

**The isobar would be chart ink, not light**, so it claims neither the
statistic nor the diffuse attachment — the selects for those two exclude
the isobar branch as well as the uncovered one. That exclusion is
transcription of the GLSL's intent, not an observed behaviour: nothing
draws under `uChartIsobar = 1`.

**`sb` is computed outside the branch**, exactly as the GLSL comments say,
so the screen-space derivatives stay in uniform control flow.
`fwidth` has no TSL node and is `|dFdx| + |dFdy|` by definition.

**Both arms of every `select` are evaluated** — that is what `select` is,
in TSL and in WGSL alike — so the emitter tail and the (dead) isobar path
are both live on every covered fragment, where the GLSL returned out of
them. Named here because it is a real cost the crossing introduces, and
an unmeasured one.

## What is NOT ported

The measured-dust cascade. The band still marches the **analytic** dust
slab on both backends; the per-cloud tiering and the voxel-grid read are
`stellata-ty4.5`'s, and the prefilter mechanism behind them is still
behind a design gate. A change there lands in both shader variants or is
deferred to whichever bead owns it — the dual-maintenance rule in
`../README.md`.
