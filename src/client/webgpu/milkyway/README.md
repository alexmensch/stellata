# Milky Way band on WebGPU

The TSL half of the band: a log-distributed march through each proxy mesh
with running per-channel dust extinction, plus the chart-mode isobar
contour. The WebGL2 shaders (`../../milkyway/`) stay the shipped renderer
and the semantic reference; the density profiles, the ρ₀ solve and the
calibration are not re-decided here.

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
move, which is why `WebGpuSeam.bandMaterials` says to read it once.

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
authored constant, so the layer seeds every shared slot straight after
construction. On the WebGL path that write is a no-op over the value the
factory already set; on this one it is what puts the dust model in the
shader at all. A slot added to `bandSharedUniformNodes` without a matching
seed line renders with the placeholder.

## `uIsBulge` becomes compile-time

The GLSL carries it as a **uniform** and branches on it inside the
fragment — one program, two draws. Here the builder takes the flag and
emits one density profile or the other, so there is no branch and no dead
half. Same consequence as the LG family split: a component's profile is
fixed for the material's life, which it already was.

## Three outcomes, none of which can be a return

The fragment resolves to no coverage, the isobar contour, or the emission,
and WGSL has no value-carrying return to bail with. So coverage is one
predicate and the three outcomes are nested selects.

**The isobar is chart ink, not light**, so it claims neither the statistic
nor the diffuse attachment — the selects for those two exclude the isobar
branch as well as the uncovered one.

**`sb` is computed outside the branch**, exactly as the GLSL comments say,
so the screen-space derivatives stay in uniform control flow.
`fwidth` has no TSL node and is `|dFdx| + |dFdy|` by definition.

## What is NOT ported

The measured-dust cascade. The band still marches the **analytic** dust
slab on both backends; the per-cloud tiering and the voxel-grid read are
`stellata-ty4.5`'s, and the prefilter mechanism behind them is still
behind a design gate. A change there lands in both shader variants or is
deferred to whichever bead owns it — the dual-maintenance rule in
`../README.md`.
