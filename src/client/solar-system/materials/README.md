# The solar-system material seam

Which shader backend the solar-system surfaces are built on, and which
surfaces the family asks for. The contract both sides implement —
`EmitterMaterial` — is shared with the boundary shells and the dust
sprite and lives in `../../scene/README.md` § The material seam. The
layers above (`../planets/`, `../probes/`) keep every line of their CPU
logic — ephemeris walk, LOD
band, texture ladder, per-frame uniform writes — and take their materials
from here, so a WebGPU boot swaps shaders without a second copy of any of
that. The port child that added this folder is `../../webgpu/README.md`'s.

## Files in this area

```
src/client/solar-system/materials/
  solar-system-materials.ts SolarSystemMaterials, ProbeMaterials and
                            ViewportUniforms: which surfaces this family
                            builds, over the shared EmitterMaterial.
                            Type-only.
  texture-slots.ts          Which texture slots the mesh and the annulus
                            carry, and what each roster's slots owe
                            (§ Texture-slot rosters).
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

Why the indirection is `../../scene/README.md` § The material seam; here
it reads `u.uFade.value = fade` and
`(u.uSunDirView.value as Vector3).copy(...)`, reaching either backend
unchanged.

Two slot kinds need a word here:

- **Textures.** A `texture()` node's `.value` is its texture, so a rung
  swap is the same assignment on both sides.
- **`uCasters`.** WebGPU has no uniform-array-of-vec4 node carrying
  `.value`; `uniformSlotsOf` (`../../webgpu/tsl/README.md` § Uniform
  slots, shared with the boundary shells and the dust sprite) puts an
  `IUniform` face over
  `UniformArrayNode.array`, which the layer mutates in place and the node
  re-packs every render.

## Texture-slot rosters

`texture-slots.ts` is the ONE declaration of which slots hold a texture.
Both factories seed theirs by spreading `textureSlotRecord(<roster>, …)`,
so neither can carry a subset — and `planet-mesh-layer.ts` snapshots its
release targets off the same roster, so the layer cannot look for a slot a
factory never built. Adding a sixth map is one edit here.

The two rosters differ in what a slot **owes**, which is why they are two
constants rather than one list:

- **Mesh slots are released back to their own stand-in** whenever the map
  is absent or not yet loaded. Miss that and the slot keeps whatever
  another body last bound — a wrong-looking planet with nothing to point
  at.
- **`uRingMap` is deliberately fallback-free.** An annulus has no
  representative-colour stand-in, so an unready ring map hides the ring;
  giving it a release path would be a visual change, not a bug fix.

Both rosters still mint a stand-in **per slot** on the WebGPU side, for the
binding-merge reason `texture-slots.ts` carries. The guard is
`glsl-materials.test.ts`: it reads each built record for the slots actually
holding a `THREE.Texture` and compares that against the roster, on both
backends — a texture slot added outside the roster fails there rather than
rendering the wrong map.

## Neutral defaults, then the body's own values

Neither factory takes a `Planet`. Every per-body constant — the relief
horizon bound, the terrain albedo, the terminator softness, the ring
geometry — is written by the layer straight after construction, over a
neutral default. So the two factories stay pure shader plumbing, and the
one place a body's constants reach a uniform is the layer that owns the
body.

## Why the probe glyph is split out

`ProbeMaterials` is its own interface, built by `makeGlslProbeMaterial` /
`makeTslProbeMaterial`. The glyph reads neither the HDR seam nor a
texture, and the layer that owns it (`../probes/probe-field.ts`) is not
the one that owns the planet surfaces, so folding it into
`SolarSystemMaterials` would hand the mesh layer a surface it never
builds and the probe field a config full of dead fields.

`uViewport` / `uPixelRatio` — the only frame-shared pair a surface here
reads by reference — bind onto the **factory**, not onto each call. The
two backends hold them in forms that cannot be swapped (an `IUniform`
spliced into a `ShaderMaterial`'s block; a node off the shared mirror),
so a per-call argument could only ever be honoured by one of them, and
TypeScript would not notice the other dropping it.

`probeMarker(localPass)` returns **two distinct materials on GLSL** (the
variants differ by the `LOCAL_DEPTH_PASS` define) and **one shared
material on TSL**, where reversed-z already deleted the only chunk that
differed. Sharing is why the TSL factory refcounts dispose: the probe
field builds both variants and disposes both, and the material has to
outlive the first of those.

## The one surface that is NOT here

The reflected-glare billboard. Its 13 per-instance attributes exceed
WebGPU's 8 vertex buffers, so it cannot share a geometry across backends
and ports as its own packed layer instead
(`../../webgpu/solar-system/README.md` § The glare packs). Everything
else in the family — the spheroid mesh, its ring annulus, its atmosphere
shell, the probe glyph — has a geometry that crosses unchanged.
