# The solar-system material seam

Which surfaces the solar-system family asks for, and the contract they
arrive through — `EmitterMaterial`, shared with the boundary shells and the dust
sprite and lives in [The material seam](../../scene/README.md#the-material-seam). The
layers above (`../planets/`, `../probes/`) keep every line of their CPU
logic — ephemeris walk, LOD
band, texture ladder, per-frame uniform writes — and take their materials
from here.

## Files in this area

```
src/client/solar-system/materials/
  solar-system-materials.ts SolarSystemMaterials and ProbeMaterials:
                            which surfaces this family
                            builds, over the shared EmitterMaterial —
                            the lit mesh, the ring annulus, the
                            atmosphere shell, and the depth-only
                            pre-stamp (`../planets/depth-stamp/README.md`),
                            which carries no uniforms.
                            Type-only.
  texture-slots.ts          Which texture slots the mesh and the annulus
                            carry, and what each roster's slots owe
                            (README.md#texture-slot-rosters).
  solar-system-materials    The seam's test doubles: one surface per
    -mock.ts                member, with the slots the layers write
                            THROUGH (vectors, the colour, the caster
                            array) seeded so a `.copy()` has an object.
```

The factory is `../../webgpu/solar-system/tsl-materials.ts`, behind the
dynamic-import boundary, and its own suite there pins the texture
rosters, the per-slot stand-ins and each surface's draw state.

## The layer writes `uniforms`, never `material.uniforms`

Why the indirection is [The material seam](../../scene/README.md#the-material-seam); here
it reads `u.uFade.value = fade` and
`(u.uSunDirView.value as Vector3).copy(...)`, reaching the shader
unchanged.

Two slot kinds need a word here:

- **Textures.** A `texture()` node's `.value` is its texture, so a rung
  swap is one assignment.
- **`uCasters`.** WebGPU has no uniform-array-of-vec4 node carrying
  `.value`; `uniformSlotsOf` ([Uniform slots,](../../webgpu/tsl/README.md#uniform-slots--the-face-a-layer-writes)
  shared with the boundary shells and the dust sprite) puts an
  `IUniform` face over
  `UniformArrayNode.array`, which the layer mutates in place and the node
  re-packs every render.

## Texture-slot rosters

`texture-slots.ts` is the ONE declaration of which slots hold a texture.
The factory seeds its record by spreading `textureSlotRecord(<roster>, …)`,
so it cannot carry a subset — and `planet-mesh-layer.ts` snapshots its
release targets off the same roster, so the layer cannot look for a slot the
factory never built. A sixth map is one edit here for the **slot**; the map
itself still needs its own `uHas*` flag in the factory, graph plumbing,
a ladder suffix (`../planets/textures/README.md`), and a release site.

The two rosters differ in what a slot **owes**, which is why they are two
constants rather than one list:

- **Mesh slots are released back to their own stand-in** whenever the map
  is absent or not yet loaded. Miss that and the slot keeps whatever
  another body last bound — a wrong-looking planet with nothing to point
  at.
- **`uRingMap` is deliberately fallback-free.** An annulus has no
  representative-colour stand-in, so an unready ring map hides the ring;
  giving it a release path would be a visual change, not a bug fix.

Both rosters mint a stand-in **per slot**, for the binding-merge reason
`texture-slots.ts` carries — cloned from the layer's one placeholder,
whose **filter pair is what every slot's WGSL fetches with**
([A stand-in's filters](../../webgpu/solar-system/README.md#a-stand-ins-filters)).

Two guards, because the roster **moves** the omission rather than deleting
it — the release sites are still written out one per slot, since each pairs
with its own readiness test and `uHas*` flag:

- `../../webgpu/solar-system/tsl-materials.test.ts` reads each built
  record for the slots actually holding a `THREE.Texture` and compares that
  against the roster. A texture slot added outside the roster fails there
  rather than rendering the wrong map; the atmosphere is pinned at zero
  slots.
- `planet-mesh-layer.test.ts` source-scans the layer for one
  `slotFallbacks.<slot>` write per mesh roster row. This is the direction
  that stays silent: a roster row with no release site builds and disposes
  correctly and throws nothing.

## Neutral defaults, then the body's own values

The factory does not take a `Planet`. Every per-body constant — the relief
horizon bound, the terrain albedo, the terminator softness, the ring
geometry — is written by the layer straight after construction, over a
neutral default. So the factory stays pure shader plumbing, and the one
place a body's constants reach a uniform is the layer that owns the
body.

## Why the probe glyph is split out

`ProbeMaterials` is its own interface, built by `makeTslProbeMaterial`.
The glyph reads neither the HDR seam nor a
texture, and the layer that owns it (`../probes/probe-field.ts`) is not
the one that owns the planet surfaces, so folding it into
`SolarSystemMaterials` would hand the mesh layer a surface it never
builds and the probe field a config full of dead fields.

`uViewport` / `uPixelRatio` — the only frame-shared pair a surface here
reads by reference — bind onto the **factory**, not onto each call: they
come off the shared uniform-node mirror rather than a per-call argument.

`probeMarker()` builds one material, and the probe field draws both its
main-pass mesh and its local-pass mirror with it: the two draws differ only
in render order and parent group, never in shading.

## The one surface that is NOT here

The reflected-glare billboard packs a geometry of its own
([The glare packs](../../webgpu/solar-system/README.md#the-glare-packs)).
