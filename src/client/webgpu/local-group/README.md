# Local Group emission on WebGPU

The TSL half of the Local Group's volumetric glow: two instanced
raymarches — Sérsic spheroids and exponential discs — writing the diffuse
attachment the resolve convolves. The WebGL2 shaders
(`../../local-group/emission/`) stay the shipped renderer and the semantic
reference; the luminosity model is not re-decided here.

**It ports as a material swap.** The layer keeps its instance packing,
per-frame rebase, chart and enable gates, and both geometries — six or
seven vertex buffers per family, inside WebGPU's eight — and takes its
materials through `../../local-group/emission/README.md` § The material
seam.

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
shared with the Milky Way band exactly as the GLSL chunk is.

## The family is compile-time, so it is two graphs

`FAMILY_DISC` is a define on the GLSL side and a `boolean` argument to the
builder here. It selects the density profile, the step count (64 for
discs, 32 for spheroids — grazing disc rays run tens of kpc against a
~10² pc scale height) and whether the vertical footprint share is computed
at all. Same consequence either way: a pass's family is fixed for the
material's life.

## `flat` has no TSL spelling, and does not need one

Every varying but `vMeshLocalPos` and `vWorldPos` is computed from
per-instance attributes, so all three vertices of a triangle carry
identical values and interpolating them is exact. GLSL's `flat` is a cost
choice there, not a correctness one — including `k`, which depends on the
camera distance to the *instance* centre and so is per-instance too.

## Neither pass owns a uniform

All seven slots these shaders read — the six HDR emitter slots and
`uWorldOffset` — are in the shared node mirror, so the factory hands back
an empty slot record and there is nothing per-frame for the layer to
write.

**The layer's own `uWorldOffset` is inert here.** On the WebGL path the
layer keeps its own object and copies into it from `update()`; on this
backend that copy reaches nothing, and `FloatingOrigin`'s write to the
shared map reaches the mirror instead. Same number, shorter route — but
it means a future change that made the layer's offset differ from the
frame's would silently diverge between backends.

## The output struct is the gate, so the mesh's mark is inert

Both meshes stay `markDiffuseEmitter`ed and that call reaches nothing
here: it sets state the WebGL draw-buffer gate reads, and a WebGPU boot
never constructs that pipeline. What opens attachments 1 and 2 on this
backend is the fragment's own output struct (`../hdr/README.md` § The gate
becomes the output struct) — same shape as the cloud absorption's
`markAbsorber` (`../molecular-clouds/README.md`). Drop the diffuse member
from the struct and the glow still draws, still sorts, and never reaches
the resolve.

## Three early returns became one predicate

The GLSL bails three times — behind the sphere, past the far root, and on
a degenerate segment — each writing the same all-zero texel set. WGSL has
no value-carrying return, so the fragment computes one `covered` predicate
and selects.

**A zero column is not the same as no coverage**, which is why the select
is on the whole texel set rather than left to fall out of `accum = 0`: an
extended source's statistic alpha is 1, so an uncovered fragment would
still add alpha under the additive blend.

## The jitter hash is the GLSL's own

The march keeps `fract(sin(dot(fragCoord, …)))` rather than taking the
shared interleaved gradient noise (`../tsl/README.md`). Both are uniform
over the step, so both preserve the expected column the CPU mirror
computes with deterministic midpoints — but they produce visibly different
grain, so keeping this one is what makes the two backends' noise the same
*kind* of noise.

**It is not the same noise pixel for pixel, and a smoke should not expect
it to be.** `screenCoordinate` follows the WebGPU convention — origin
top-left, y downward — where `gl_FragCoord` is y-up, so the hash takes a
different argument at every fragment. Same statistics, same visual
character, different speckle. A vertically mirrored grain pattern is
parity, not a bug.

Its constants, the unit-ball exit slack and both step counts all live in
`../../local-group/emission/local-group-emission-pure.ts` — one home for
the three consumers (this graph, the GLSL, the CPU mirror), with the GLSL's
spelled-out copies pinned against it in `local-group-emission.test.ts`.
