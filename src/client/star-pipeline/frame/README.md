# Star frame and shared uniforms

The CPU-side state every star pass reads: `StarFrame` owns
`catalog.positions` in the renderer's frame (floating origin, epoch
advance, derived per-instance buffers, proximity queries), and
`buildStarSharedUniforms` builds the one uniform map all three passes
and every downstream consumer hold **by reference**.

They live together because the frame writes into the map — `uWorldOffset`
on recentre, `uFovYRad` / `uViewport` for its windows — and both are the
seam the integration shell (`../../stellata.ts`) delegates to rather than
owning itself. Nothing in `../` imports this folder.

## Files in this area

```
src/client/star-pipeline/frame/
  star-frame.ts (+ test)          StarFrame — floating origin, epoch
                                  advance, the per-instance buffers
                                  derived at load, and the Sol-distance
                                  proximity queries including the
                                  core-mask gate. The test covers origin
                                  recentre, epoch re-advance + focal
                                  delta, and the proximity / core-mask
                                  window.
  star-shared-uniforms.ts         buildStarSharedUniforms — the one
    (+ test)                      uniform map all three passes (and the
                                  planet body field + Milky Way pass)
                                  share by reference. The test pins
                                  seeding + the perceptual-disc slot
                                  identities the planet pipeline picks
                                  out.
```

## Shared uniforms

`buildStarSharedUniforms` (`star-shared-uniforms.ts`) returns the one
uniform map the disc, glow, and core-mask passes spread into their
materials — `uRenderMode` is the only divergent slot, bound per
material by `StarPipeline`. Every other consumer picks slots out of the
same object **by reference**, so a single write reaches all of them
with no bookkeeping: `FilterController` (the filter / preset / render
knobs), `PlanetBodyField` (via `pickPerceptualDiscUniforms` +
`pickChartDiscUniforms`), `MilkyWay` (`uMaxAppMag`, for its chart-mode
isobar contour only — the band's own brightness is photometric),
`StarLocalMirror`, `ExtinctionPrepass`, `StarFrame`
(`uWorldOffset`, and `uFovYRad` / `uViewport` for its windows), and
`Picker`. The three renderer-derived seeds (pixel ratio, FOV, viewport)
are arguments; the rest come from `DEFAULT_FILTER` /
`STAR_RENDER_DEFAULTS` and the pipeline's own constants.

The one set of slots this map does **not** own is
`HdrPipeline.emitterUniforms` — `uExposure`, `uOmegaPxArcsec2`,
`uWhitePoint`, `uHighlightDesat`, `uHdrTarget` — passed in as the `hdr`
option and spread in by reference. `HdrPipeline` rewrites `uHdrTarget` on every
seam / resolve / chart-mode change, so copying the values instead of
sharing the objects would leave the star passes tone-mapping inline into
an already-tone-mapped target. Pinned in the test; see
`../../hdr/README.md` § Unit.

The integration shell builds the map once and keeps writing through
`starPipeline.discMaterial.uniforms` per frame — the encapsulation is
construction, not access discipline.

## The star frame

`StarFrame` (`star-frame.ts`) owns `catalog.positions` in the
renderer's frame — everything CPU-side that depends on where the stars
actually are:

- **Floating origin.** `worldOffset` (the absolute coordinate at local
  `(0,0,0)`) and `localPositions` (`catalog.positions − worldOffset`,
  the buffer bound to the dynamic `iPosition` attribute). `recenterTo`
  rewrites the buffer in float64 per axis before the float32
  write-back, moves `worldOffset`, and mirrors the new origin into
  `uWorldOffset` for the shader's absolute-position reconstruction. The
  camera / orbit-target shift and the scene-layer recenter fan-out stay
  on the integration shell's `recenterOrigin`, which wraps this — see
  `../README.md` § Floating origin.
- **Epoch advance.** The immutable J2016.0 `basePositions` snapshot and
  `advanceEpochTo(t, focalIdx, outDelta)`, which re-runs the
  space-motion pass whenever the model clock crosses a
  `bucketEpochJyr` bucket and reports the focal star's space-motion
  delta so the shell can translate the camera by it.
- **Derived per-instance buffers.** `logRadii`, `lumClassF32`,
  `distSol`, `teffApsis`, and `maxPhysicalRadiusPc`, all computed once
  off the *advanced* positions, so `StarPipeline`'s attributes and
  every downstream consumer inherit current-epoch positions by
  construction.
- **Proximity queries.** The Sol-distance-sorted index and
  `forEachStarNearCamera` / `discWindowPcFor` / `shouldEnableCoreMask`
  built on it (§ Star rendering, core depth-mask). `Picker` slices the
  same index for its distSol-filter window.

Anything that writes `onLocalPositionsWritten` side effects — the GPU
re-upload flag and `BinaryOrbitField`'s baseline invalidation — is
passed in by the shell, which is the only thing that knows the
attribute and the lazily-attached binary field.

**One rewrite per frame.** Rewriting the 313k-star local buffer costs
a full pass plus a GPU re-upload, and two of them can be provoked in
the same frame: a fast time-scrub crosses an epoch bucket while a hard
focus has drifted past `FOCAL_ORIGIN_DRIFT_RATIO`, so the epoch
re-advance and the origin recentre both invalidate it. So
`advanceEpochTo` only marks the buffer stale and
`flushLocalPositions` — called by `animate()` right after the
re-advance / recentre pair — does the single rewrite at whatever the
origin ended up being; a recentre in between rewrites it directly and
clears the flag. That leaves exactly one window where
`localPositions` trails `catalog.positions`: between `advanceEpochTo`
and the flush. Nothing may read the buffer inside it (the focal-drift
recentre in that gap reads only camera + orbit target), and anything
new landing there has to sit after the flush instead.
