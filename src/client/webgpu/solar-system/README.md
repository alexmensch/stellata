# Solar-system surfaces

The solar-system shader family: the spheroid mesh, its
ring annulus and atmosphere shell, the reflected-glare billboard, the
probe glyph, and the single-scattering integrator two of them share.
These are the family's only surfaces; the physics they implement is
`../../solar-system/`'s, and that is where it is argued.

**Four of the five are materials over their CPU layer's own geometry.**
The layers take their surfaces through
`../../solar-system/materials/README.md` — that README owns which
surfaces this family asks for, the neutral-defaults rule, and why the
probe glyph is split out; the `EmitterMaterial` contract they are handed
back is [The material seam](../../scene/README.md#the-material-seam). Only the glare needed a layer of its own (§ The glare
packs).

## Files in this area

```
src/client/webgpu/solar-system/
  atmosphere-scatter-tsl.ts   Ray helpers, the analytic shadow span, the
                              skylight model, and the view/light march.
  planet-mesh-tsl.ts          The lit spheroid: terminator, DEM relief and
                              its cast shadows, caster loop, umbral glow,
                              disc airlight.
  planet-rings-tsl.ts         The ring annulus over its radial strip.
  planet-atmosphere-tsl.ts    The limb-halo shell, premultiplied-over.
  planet-depth-stamp-tsl.ts   The depth-only pre-stamp over the body
                              spheroid, colour writes off
                              (`../../solar-system/planets/depth-stamp/README.md`).
  probe-tsl.ts                The fixed-pixel diamond glyph.
  planet-glare-tsl.ts         The reflected-glare billboard's vertex and
                              fragment graphs, main pass and mirror.
  planet-glare-geometry.ts    Its packed instanced geometry (§ The glare
                              packs).
  planet-glare-layer.ts       PlanetGlareLayer: the main mesh into the
    (+ test)                  shell's scene, the mirror into the field's
                              localGroup (the pass scene), the per-frame
                              re-pack, the chart blend swap, dispose.
  planet-glare-uniforms.ts    The four slots PlanetBodyField owns rather
                              than shares through the frame map.
  uniform-nodes.ts            The uniform-node record behind each
                              surface's slots, texture slots seeded from
                              the shared roster
                              (`../../solar-system/materials/README.md#texture-slot-rosters`).
  tsl-materials.ts (+ test)   The factory implementing SolarSystemMaterials.
  tsl-drift.test.ts           § Constant drift.
```

## A stand-in's filters

Every mesh and annulus slot binds over a per-slot stand-in cloned from
`PlanetMeshLayer.placeholder` and takes its real map by a `.value` swap
([Texture-slot rosters](../../solar-system/materials/README.md#texture-slot-rosters)). **That
stand-in's `minFilter` / `magFilter` pair decides what the WGSL fetches
with, for the material's whole life** — it is load-bearing, not cosmetic
on a 1×1 white texel.

`WGSLNodeBuilder.isUnfilterable()` answers true when both filters are
`NearestFilter`, and `generateTexture()` then emits `textureLoad()` — an
unfiltered texel fetch — in place of `textureSample()`. That runs at
shader-**build** time, when every slot still holds the stand-in, and a
`DataTexture` defaults **both** filters to nearest. So a stand-in on the
default bakes a point fetch into the shader and the linear-filtered map
swapped on afterwards cannot change it; the sampler binding tracks the
swap correctly and is simply never read, which is why it looks innocent.

**Only a magnified slot shows it, which is what makes it hard to see.**
Point-sampling is invisible on a minified map, so the 8192 colour map
hides it and a body carrying nothing else — Jupiter, Venus, Callisto —
looks right. It surfaces on the relief bodies at the
orbit floor, in slot-width order: the horizon pair at 2048 (~2.25 device
px per texel) gives hard axis-aligned staircase edges on the cast-shadow
outlines, and the 4096 normal map reads as over-sharp lit terrain. So the
first suspect for a staircase on Moon or Mercury terrain is
this pair, not the horizon map's width or its 8-bit encoding.

The rule generalises past this folder: **a stand-in carries the filter
pair of the texture it stands in for.** The A_V prepass placeholder is
nearest because its r32float target must be ([The prepass](../extinction/README.md#the-prepass-kernel)
draw); the dust volume's and the cloud brick's are linear
because those volumes are. `tests/tsl-standin-filters.test.ts` pins that
every construction states the pair rather than inheriting the default.

## Constant drift

A constant the graph and its CPU mirror share is authored once in a
`*-pure.ts` module, and these files import it — so the copy that could
drift is the one written out by hand. `tsl-drift.test.ts` asserts every
pinned constant is referenced by name across the six surfaces, and that
none of their values reappears as a bare literal in any of them. A number
transcribed rather than imported is the drift no compiler catches.

The literal half compares by **value**, through the scan shared with the
other subsystems' guards ([TSL test pattern](../tsl/README.md#tsl-test-pattern--what-a-layers-suite-covers)) — so a
constant restated as `30.0` is caught where a text pattern for `30` was
not. The cost is that a number coinciding with a pinned one has to be
excused by name: `atmosphere-scatter-tsl.ts` spells 16 in the Rayleigh
phase normalisation `3/(16π)`, which is not `ATMO_N_VIEW`. An exemption
also stops the real constant being caught in that file, so the list is
meant to stay short.

## Vertex stages: four of six need none

`NodeMaterial`'s own model-view-projection is exactly what the mesh, the
shell and the annulus need, and each of their varyings is a TSL built-in
— `positionView`, `normalView`, `uv()`, and `varying(positionGeometry.xy)`
for the annulus. So those three set `fragmentNode` alone, and the depth
pre-stamp — the same spheroid, no varyings at all — sets a fragment that
writes nothing but still swaps ([Every fragment writes the whole output
struct](#every-fragment-writes-the-whole-output-struct)). The glare and the glyph project their own screen-space quads and
carry a `vertexNode`.

`normalView` normalises after interpolation, and three's
`modelNormalMatrix` is the inverse transpose, so the oblate mesh scale
reaches the normal correctly.

## Every fragment writes the whole output struct

Every surface here reaches the HDR target, so every one of them declares
all three attachment outputs and swaps to a single output when the target
is not bound ([The gate becomes the output struct,](../hdr/README.md#the-gate-becomes-the-output-struct)
`../hdr/mrt-material.ts`). The depth pre-stamp included: its colour writes
are off, so the swap is irrelevant to validity and mandatory for three's
pipeline cache — the same argument the star core mask carries. A slot a
draw does not write carries `vec4(0)`: alpha 0 is the identity under both blends used here —
additive leaves the destination because the source is zero, and
alpha-composited leaves it because the alpha went to zero with the rest.

The **park mask multiplies the whole statistic texel**, not just its flux
(`maskedStatisticTexelTsl`). Masking the flux alone is correct only for
an additive writer; the mesh, annulus and shell composite, so a texel of
`(0, 0, 0, alpha)` would keep dimming the attachment by `1 − alpha`.

## The glare packs

The billboard's 13 per-instance attributes exceed WebGPU's 8 vertex
buffers, so it is the one surface that builds a geometry of its own.
`planet-glare-geometry.ts` builds exactly 8:

| buffer | contents | source |
| --- | --- | --- |
| `aCorner` | quad corner, per vertex | shared constant |
| `iHostLocalPos`, `iLocalRel` | vec3 each | the field's arrays, by reference |
| `iPhaseCoefsA`, `iPhaseCoefsB` | vec4 each | the field's arrays, by reference |
| `iColourSolidity` | `colour.rgb`, `solidity` | packed |
| `iBody` | `radiusPc`, `albedoP`, `hostAbsmag`, `c7` | packed |
| `iDyn` | `ringFlux`, `eclipseDim` | packed, per frame |

Only Mercury carries a degree-7 phase term, so `c7` rides `iBody.w`
rather than a buffer of its own — which is what fits the table in 8.

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

**The split holds only while every attribute stays on the default usage.**
`DynamicDrawUsage` uploads an attribute on every render call whatever its
version ([One writer per buffer per submit](../README.md#one-writer-per-buffer-per-submit)), so the hint on
the four layout-rate attributes costs 2 KiB of constants per render call —
twice a frame while the local pass draws the mirror too — against a table
whose whole point is skipping them. Version carries the layout rate for
free: `packGlareLayout` runs behind the `layoutVersion` sentinel, and
`packGlareFrame` from `onBeforeRender`, which the renderer calls before it
reads the attributes. `planet-glare-layer.test.ts` pins the usages, because
the version assertions beside it cannot see an upload that bypasses
version.

**The three per-frame attributes still upload twice on a frame that draws
the mirror**, and that is accepted. Both meshes carry the `onBeforeRender`
hook, so the second `sync()` re-bumps the version the first upload just
satisfied — 1 KiB on the queue for bytes already there. Collapsing it wants
a frame identity `PlanetGlareSources` does not carry, to buy a quarter of
what the layout split already saves, well under anything `gpu.frame`
resolves.

## Reflected glare — a planet reads exactly like a star

The instanced billboard that carries a body's reflected light while it is
unresolved, and the point↔bloom behaviour it morphs through as the mesh
takes over. [Planet mesh LOD](../../solar-system/planets/README.md#planet-mesh-lod) owns the resolvedness band
both halves ride; this folder owns the glare half of it.

The billboard's graph and its packed geometry are
`./` (`planet-glare-tsl.ts`,
`planet-glare-geometry.ts`, `planet-glare-layer.ts`); the glow profile is
the one stars use (`../../star-pipeline/perceptual-disc/`), and
`../../solar-system/planets/planet-body-field.ts` writes the per-instance arrays it packs from.

The glare is the **shared star-perceptual point** — a planet reads
*exactly* like a star of its apparent magnitude: size =
`perceptualAppSizePx(appMag)`, peak =
`stellataPointSourcePeak(uExposure, appMag, 0.5·physSize)` —
the same emission rule the star field runs
(`../../solar-system/planets/emission/README.md`). This is the load-bearing invariant:
**visibility matches magnitude.** A body visible in chart mode
(`appMag ≤ slider`) is equally visible here, rendered like the naked-eye
"wandering star" it is — Mars (~+1.3), Jupiter (~−2), Saturn (~+0.5),
Venus (~−4) all show, ordered by magnitude, exactly as the surrounding
star field does.

`appMag` already folds the phase factor φ(α)
(`../../perceptual-magnitude.ts`), so a crescent is correctly dimmer — no
separate illumFrac on brightness. A ring system folds in the same way, on
`iRingFlux` ([Ring photometry](../../solar-system/planets/rings/README.md#ring-photometry--the-unresolved-magnitude)): its flux belongs in
the magnitude, so it ADDS to φ — same unit — rather than touching the
peak. Eclipse is the opposite call and folds in as a flux multiplier on
the peak.

**The photocentre shift is shape only, never brightness.** A shift toward
the sub-solar limb, scaled by crescentness `(1−illumFrac)` and
resolvedness `res`, keeps a barely-resolved crescent's halo off its dark
limb — which is what kills the ring — while leaving a sub-pixel dot
centred. `../mesh-crossfade.ts` carries the constant
(`uGlarePhotocentreShift`).

**When resolved the mesh hides the glare's core.** The mesh draws the
surface, writes depth, and occludes it: the magnitude bloom (`appSize`,
capped at `uSizeMax`) is smaller than a well-resolved disc (`physSize`),
so the glare sits inside the disc and only shows as a lit-limb halo while
the body is small and bright. The full-Moon calibration
(`../../perceptual-magnitude.test.ts`, −12.7) anchors the underlying flux,
so the magnitude — and therefore visibility — is correct for any host
star. CPU mirror for the hover footprint: `max(physSize, appSize)`.

That occlusion is the local depth pass.

The billboard writes no fragment depth, and may not: a static write costs
the whole draw its early-z, and nothing carries one
([Early-z](../../webgpu/README.md#early-z--the-star-layers-depth-honest-redesign)). Reversed-z leaves fixed-function
depth correct in both passes.

The billboard also carries `vFluxPeakL` — the same kernel renormalised so
its integral is the body's true flux, for the exposure statistic's flux
channel (`../../hdr/attachments/README.md`).

The layer packs from `PlanetBodyField.glareSources()` (§ The glare packs);
the field writes the arrays and owns nothing on the GPU, and its `drawn`
getter is the layer's visibility.

**There is no gain on the peak**, because any multiplier other than 1 makes
a planet read as a star of a *different* magnitude, breaking the invariant
above. `mesh-crossfade.test.ts` pins that the graph carries none.
Calibration lives in `../../solar-system/planets/emission/README.md`.

## Which pass draws them

The mesh, the annulus and the shell render in the local depth pass
(`../../local-depth/README.md`). So do the pass's line layers — orbit rings, binary orbit
paths, probe trails — through the chrome line seam
(`../chrome-lines/README.md`), which is what gave their built-in
`LineBasicMaterial` a fragment that can create a WGSL pipeline against the
three-attachment HDR target.

## The probe glyph is one material across both passes

The glyph's main-pass and local-mirror draws shade identically, so one
material serves both meshes. The glare is the contrast: its fragment stage
is shared the same way, but its **vertex** stage needs both variants,
because `uLocalPassRange` gates opposite senses there.

## Loop control and the discard that is not a return

The march runs `Loop(ATMO_N_VIEW)` over `Loop(ATMO_N_LIGHT)` — 16 × 10 —
so it must stay a real loop rather than an unroll. Two authoring traps it
lives under:

- **A `continue` becomes an `If` around the body.** A concise arrow
  returns its expression, so `() => Continue()` hands the jump back as
  the branch's output and the generator emits it twice
  ([TSL test pattern](../tsl/README.md#tsl-test-pattern--what-a-layers-suite-covers)).
- **WGSL's `discard` is not a return.** The invocation keeps running, so
  the atmosphere shell guards its whole march behind the same condition
  it discards on — otherwise every disc-bound ray would pay for a march
  whose result is thrown away.
