# Reflected glare — a planet reads exactly like a star

The instanced billboard that carries a body's reflected light while it is
unresolved, and the point↔bloom behaviour it morphs through as the mesh
takes over. `../README.md` § Planet mesh LOD owns the resolvedness band
both halves ride; this folder owns the glare half of it.

```
src/client/solar-system/planets/glare/
  planet.vert.glsl,
  planet.frag.glsl   Instanced reflected-glare billboards (point↔bloom on
                     resolvedness, phase-gated + photocentre-shifted).
                     Imports perceptual-disc.glsl from
                     ../../../star-pipeline/ — the shared glow profile with
                     stars. Built and driven by ../planet-body-field.ts.
```

The glare is the **shared star-perceptual point** — a planet reads
*exactly* like a star of its apparent magnitude: size =
`perceptualAppSizePx(appMag)`, peak =
`stellataPointSourcePeak(uExposure, appMag, 0.5·physSize)` —
the same emission rule the star field runs
(`../emission/README.md`). This is the load-bearing invariant:
**visibility matches magnitude.** A body visible in chart mode
(`appMag ≤ slider`) is equally visible here, rendered like the naked-eye
"wandering star" it is — Mars (~+1.3), Jupiter (~−2), Saturn (~+0.5),
Venus (~−4) all show, ordered by magnitude, exactly as the surrounding
star field does.

`appMag` already folds the phase factor φ(α)
(`../../perceptual-magnitude.ts`), so a crescent is correctly dimmer — no
separate illumFrac on brightness. A ring system folds in the same way, on
`iRingFlux` (`../rings/README.md` § Ring photometry): its flux belongs in
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

That occlusion is the local depth pass; the old core mask is gone.

`planet.frag.glsl` writes no `gl_FragDepth`, and may not: a static write
costs the whole draw its early-z, so only `star.frag.glsl` carries one
(`../../../star-pipeline/README.md` § Early-z, pinned by
`tests/shader-frag-depth.test.ts`). The glare is a non-raw
`ShaderMaterial`, so in the main pass three's `logdepthbuf_fragment`
writes the depth; in the local pass fixed-function depth is already
exactly `gl_FragCoord.z`.

The billboard also carries `vFluxPeakL` — the same kernel renormalised so
its integral is the body's true flux, for the exposure statistic's flux
channel (`../../../hdr/attachments/README.md`).

**There is no gain on the peak, and adding one would break the invariant
above.** A `uGlareGain` debug multiplier rode both channels until the
emission rule was physical; at 1 it did nothing, and at anything else it made
a planet read as a star of a *different* magnitude. `mesh-crossfade.test.ts`
pins its absence from the shader. Calibration lives in `../emission/README.md`.
