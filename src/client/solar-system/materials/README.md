# The solar-system material seam

Which shader backend the solar-system surfaces are built on, and the one
contract both sides implement. The layers above (`../planets/`,
`../probes/`) keep every line of their CPU logic — ephemeris walk, LOD
band, texture ladder, per-frame uniform writes — and take their materials
from here, so a WebGPU boot swaps shaders without a second copy of any of
that. The port child that added this folder is `../../webgpu/README.md`'s.

## Files in this area

```
src/client/solar-system/materials/
  emitter-material.ts       EmitterMaterial + SolarSystemMaterials: the
                            neutral contract. Type-only.
  glsl-materials.ts         The WebGL2 implementation — the four RawGLSL
    (+ test)                surfaces, their uniform blocks, and the
                            blend/depth state each one's contract rests
                            on. Also the atmosphere chunk splice and the
                            sample-count defines.
```

The WebGPU twin is `../../webgpu/solar-system/tsl-materials.ts`, behind
the dynamic-import boundary; the test here pins the two factories' uniform
keys against each other.

## The layer writes `uniforms`, never `material.uniforms`

`EmitterMaterial` pairs a `THREE.Material` with the uniform slots its
layer drives. That indirection is the whole seam: a TSL `uniform()` node
carries `.value` exactly as an `IUniform` does, so
`u.uFade.value = fade` and `(u.uSunDirView.value as Vector3).copy(...)`
reach either backend unchanged and no layer learns which one it has.

Two slot kinds need a word:

- **Textures.** A `texture()` node's `.value` is its texture, so a rung
  swap is the same assignment on both sides.
- **`uCasters`.** WebGPU has no uniform-array-of-vec4 node carrying
  `.value`; `uniformSlotsOf` puts an `IUniform` face over
  `UniformArrayNode.array`, which the layer mutates in place and the node
  re-packs every render.

## Neutral defaults, then the body's own values

Neither factory takes a `Planet`. Every per-body constant — the relief
horizon bound, the terrain albedo, the terminator softness, the ring
geometry — is written by the layer straight after construction, over a
neutral default. So the two factories stay pure shader plumbing, and the
one place a body's constants reach a uniform is the layer that owns the
body.

## Why the probe glyph is split out

`makeGlslProbeMaterial` / `makeTslProbeMaterial` build the glyph alone.
It reads neither the HDR seam nor a texture, and the layer that owns it
(`../probes/probe-field.ts`) is not the one that owns the planet
surfaces, so requiring it to supply an `hdr` bundle and a placeholder it
has no use for would be a config full of dead fields. For the same
reason `probeMarker` takes its `uViewport` / `uPixelRatio` pair as a call
argument: it is the only surface here that reads a frame-shared slot by
reference.

## The one surface that is NOT here

The reflected-glare billboard. Its 13 per-instance attributes exceed
WebGPU's 8 vertex buffers, so it cannot share a geometry across backends
and ports as its own packed layer instead
(`../../webgpu/solar-system/README.md` § The glare packs). Everything
else in the family — the spheroid mesh, its ring annulus, its atmosphere
shell, the probe glyph — has a geometry that crosses unchanged.
