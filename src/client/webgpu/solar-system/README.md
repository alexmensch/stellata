# Solar-system surfaces on WebGPU

The TSL half of the solar-system shader family: the spheroid mesh, its
ring annulus and atmosphere shell, the reflected-glare billboard, the
probe glyph, and the single-scattering integrator two of them share. The
WebGL2 shaders (`../../solar-system/`) stay the shipped renderer and the
semantic reference; parity is the A/B smoke, same `/v/<blob>/` with and
without the `#renderer=webgpu` fragment.

**Four of the five port as a material swap, not a layer.** The CPU
layers keep every line they had and take their surfaces through
`../../solar-system/materials/README.md` — that README owns which
surfaces this family asks for, the neutral-defaults rule, and why the
probe glyph is split out; the `EmitterMaterial` contract they are handed
back is `../../scene/README.md` § The material seam. Only the glare needed a layer of its own (§ The glare
packs).

## Files in this area

```
src/client/webgpu/solar-system/
  atmosphere-scatter-tsl.ts   Ray helpers, the analytic shadow span, the
                              skylight model, and the view/light march —
                              the TSL twin of atmosphere-scatter.glsl.
  planet-mesh-tsl.ts          The lit spheroid: terminator, DEM relief and
                              its cast shadows, caster loop, umbral glow,
                              disc airlight.
  planet-rings-tsl.ts         The ring annulus over its radial strip.
  planet-atmosphere-tsl.ts    The limb-halo shell, premultiplied-over.
  probe-tsl.ts                The fixed-pixel diamond glyph.
  planet-glare-tsl.ts         The reflected-glare billboard's vertex and
                              fragment graphs, main pass and mirror.
  planet-glare-geometry.ts    Its packed instanced geometry (§ The glare
                              packs).
  planet-glare-layer.ts       PlanetGlareLayer: the main mesh into the
    (+ test)                  seam's scene, the mirror into the field's
                              localGroup (the pass scene), the per-frame
                              re-pack, the chart blend swap, dispose.
  planet-glare-uniforms.ts    The four slots PlanetBodyField owns rather
                              than shares through the frame map.
  uniform-nodes.ts            TSL uniform-node twins of the seam's
                              uniform blocks, texture slots seeded from
                              the shared roster
                              (`../../solar-system/materials/README.md`
                              § Texture-slot rosters).
  tsl-materials.ts (+ test)   The factory implementing SolarSystemMaterials.
  tsl-drift.test.ts           § Constant drift runs in both directions.
```

## Constant drift runs in both directions

A constant both backends read is authored once in a `*-pure.ts` module.
GLSL cannot import, so its guards pin each literal in the source text
against that module (`atmosphere-glsl-drift.test.ts`,
`ring-photometry-pure.test.ts`). These files **can** import, so their
guard is the mirror image: `tsl-drift.test.ts` asserts every pinned
constant is referenced by name across the six surfaces, and that none of
their values reappears as a bare literal in any of them. A number copied
out of the GLSL into a TSL twin is the drift that has no compiler to
catch it.

The literal half compares by **value**, through the scan shared with the
other subsystems' guards (`../tsl/README.md` § TSL test pattern) — so a
constant restated as `30.0` is caught where a text pattern for `30` was
not. The cost is that a number coinciding with a pinned one has to be
excused by name: `atmosphere-scatter-tsl.ts` spells 16 in the Rayleigh
phase normalisation `3/(16π)`, which is not `ATMO_N_VIEW`. An exemption
also stops the real constant being caught in that file, so the list is
meant to stay short.

## Vertex stages: three of five need none

`NodeMaterial`'s own model-view-projection is exactly what
`planet-mesh.vert.glsl`, `planet-atmosphere.vert.glsl` and
`planet-rings.vert.glsl` do, and each of their varyings is a TSL built-in
— `positionView`, `normalView`, `uv()`, and `varying(positionGeometry.xy)`
for the annulus. So those three set `fragmentNode` alone. The glare and
the glyph project their own screen-space quads and carry a `vertexNode`.

`normalView` normalises after interpolation where the GLSL normalises at
use; the drawn value is the same, and the oblate mesh scale is handled
the same way in both (three's `modelNormalMatrix` is the inverse
transpose, exactly what GLSL's `normalMatrix` was).

## Every fragment writes the whole output struct

Every surface here reaches the HDR target, so every one of them declares
all three attachment outputs and swaps to a single output when the target
is not bound (`../hdr/README.md` § The gate becomes the output struct,
`../hdr/mrt-material.ts`). A slot the WebGL gate would have masked off
writes `vec4(0)`: alpha 0 is the identity under both blends used here —
additive leaves the destination because the source is zero, and
alpha-composited leaves it because the alpha went to zero with the rest.

The **park mask multiplies the whole statistic texel**, not just its flux
(`maskedStatisticTexelTsl`). Masking the flux alone is correct only for
an additive writer; the mesh, annulus and shell composite, so a texel of
`(0, 0, 0, alpha)` would keep dimming the attachment by `1 − alpha`.

## The glare packs

The billboard's 13 per-instance attributes exceed WebGPU's 8 vertex
buffers, so it is the one surface that cannot share a geometry with the
WebGL path. `planet-glare-geometry.ts` builds exactly 8:

| buffer | contents | source |
| --- | --- | --- |
| `aCorner` | quad corner, per vertex | shared constant |
| `iHostLocalPos`, `iLocalRel` | vec3 each | the field's arrays, by reference |
| `iPhaseCoefsA`, `iPhaseCoefsB` | vec4 each | the field's arrays, by reference |
| `iColourSolidity` | `colour.rgb`, `solidity` | packed |
| `iBody` | `radiusPc`, `albedoP`, `hostAbsmag`, `c7` | packed |
| `iDyn` | `ringFlux`, `eclipseDim` | packed, per frame |

`iPhaseCoefsC` is gone: only Mercury carries a degree-7 term and the
other three slots were reserved, so `c7` rides `iBody.w` and a whole
buffer with it. That is what brings 9 down to 8.

**Four attributes are the field's own arrays wrapped in a second
`InstancedBufferAttribute`** — no copy, and a `PlanetBodyField` write
lands in both. The other three interleave, so they cannot share.

**The re-pack splits on the field's own seam, not on a dirty-track.**
`PlanetBodyField.writeHostStaticAttributes` fires on attach / detach /
grow — exactly what `layoutVersion` reports — while `writeHostPositions`
and the dim / ring-flux blends fire every frame. So `iPhaseCoefsA`,
`iPhaseCoefsB`, `iColourSolidity` and `iBody` re-pack and re-upload only
when a body joins or leaves, and a steady frame pays three attributes:

| when | attributes |
| --- | --- |
| every frame (`perFrame`) | `iHostLocalPos`, `iLocalRel`, `iDyn` |
| `layoutVersion` change (`perLayout`) | `iPhaseCoefsA`, `iPhaseCoefsB`, `iColourSolidity`, `iBody` |

`iHostLocalPos` is static per body and still rides the per-frame list: a
floating-origin recentre rewrites it **without** bumping `layoutVersion`,
so the layout signal cannot cover it. A grow is the one layout event that
also replaces every array and needs the geometry rebuilt.

## Which pass draws them

The mesh, the annulus and the shell render in the local depth pass
(`../../local-depth/README.md`), which runs on this boot since its port
child landed. So do the pass's line layers — orbit rings, binary orbit
paths, probe trails — through the chrome line seam
(`../chrome-lines/README.md`), which is what gave their built-in
`LineBasicMaterial` a fragment that can create a WGSL pipeline against the
three-attachment HDR target.

## The probe glyph needs no mirror variant

`probe.vert.glsl` / `probe.frag.glsl` differ between the main pass and
the local mirror only by `#ifndef LOCAL_DEPTH_PASS` around the log-depth
chunks. Reversed-z deleted those chunks, so one TSL graph serves both
draws and `probeMarker`'s `localPass` argument is inert on this backend.
The same reasoning covers the glare's *fragment* stage; its **vertex**
stage still needs both variants, because `uLocalPassRange` gates opposite
senses there.

## Loop control and the discard that is not a return

The march runs `Loop(ATMO_N_VIEW)` over `Loop(ATMO_N_LIGHT)` — 16 × 10 —
so it must stay a real loop rather than an unroll. Two authoring traps it
lives under:

- **A `continue` becomes an `If` around the body.** A concise arrow
  returns its expression, so `() => Continue()` hands the jump back as
  the branch's output and the generator emits it twice
  (`../tsl/README.md` § TSL test pattern).
- **WGSL's `discard` is not a return.** The invocation keeps running, so
  the atmosphere shell guards its whole march behind the same condition
  it discards on — otherwise every disc-bound ray would pay for a march
  whose result is thrown away.
