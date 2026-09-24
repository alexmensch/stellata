# Local Group emission on WebGPU

The Local Group's volumetric glow: two instanced raymarches — Sérsic
spheroids and exponential discs — writing the diffuse attachment the
resolve convolves. The luminosity model lives in
`../../local-group/emission/` and is not re-decided here.

**Materials, not a layer.** The layer owns its instance packing, chart and
enable gates, and both geometries — six or seven vertex buffers per
family, inside WebGPU's eight — and takes its materials through
[The material seam](../../local-group/emission/README.md#the-material-seam).

## Files in this area

```
src/client/webgpu/local-group/
  local-group-emission-tsl.ts  Both family graphs: the resolution-floor
                               expansion in the vertex stage, the
                               log-distributed march in the fragment one.
  tsl-lg-materials.ts          The factory implementing LgEmissionMaterials.
```

The write tail both families end on — column → gain → three attachments,
and the inline operator off-target — is `../extended-emitter-tsl.ts`,
shared with the Milky Way band.

## The family is compile-time, so it is two graphs

The builder takes the family as a `boolean` argument. It selects the
density profile, the step count (64 for discs, 32 for spheroids — grazing
disc rays run tens of kpc against a ~10² pc scale height) and whether the
vertical footprint share is computed at all, so a pass's family is fixed
for the material's life.

## No varying needs `flat`

Every varying but `vMeshLocalPos` and `vWorldPos` is computed from
per-instance attributes, so all three vertices of a triangle carry
identical values and interpolating them is exact — including `k`, which
depends on the camera distance to the *instance* centre and so is
per-instance too.

## Neither pass owns a uniform

All seven slots these shaders read — the six HDR emitter slots and
`uWorldOffset` — are in the shared node mirror, so the factory hands back
an empty slot record and there is nothing per-frame for the layer to
write. `FloatingOrigin`'s write to the shared map is what reaches the
mirror.

## The output struct is the gate

What opens attachments 1 and 2 is the fragment's own output struct
([The gate becomes the output struct](../hdr/README.md#the-gate-becomes-the-output-struct)), in the
volumetric-emitter role ([The roles](../../hdr/attachments/README.md#the-roles)).
Drop the diffuse member from the struct and the glow still draws, still
sorts, and never reaches the resolve.

## One coverage predicate

A fragment is uncovered behind the sphere, past the far root, and on a
degenerate segment, each needing the same all-zero texel set. WGSL has no
value-carrying return, so the fragment computes one `covered` predicate
and selects.

**A zero column is not the same as no coverage**, which is why the select
is on the whole texel set rather than left to fall out of `accum = 0`: an
extended source's statistic alpha is 1, so an uncovered fragment would
still add alpha under the additive blend.

## The jitter hash

The march jitters with `fract(sin(dot(screenCoordinate, …)))` rather than
the shared interleaved gradient noise (`../tsl/README.md`). Both are
uniform over the step, so either preserves the expected column the CPU
mirror computes with deterministic midpoints; they differ in grain only.

Its constants, the unit-ball exit slack and both step counts all live in
`../../local-group/emission/local-group-emission-pure.ts` — one home for
the graph and the CPU mirror, which the graph imports.
