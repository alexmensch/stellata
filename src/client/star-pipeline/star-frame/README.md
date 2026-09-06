# Star frame

The CPU-side state every star pass reads: `StarFrame` owns
`catalog.positions` in the renderer's frame (the local-position buffer,
epoch advance, derived per-instance buffers, proximity queries). The
floating origin itself and the shared uniform map live in
`../../frame/` (`FloatingOrigin`, `buildSharedUniforms`) — this class
consumes both. Nothing in `../` imports this folder.

## Files in this area

```
src/client/star-pipeline/star-frame/
  star-frame.ts (+ test)          StarFrame — the local-position
                                  buffer, epoch advance, the
                                  per-instance buffers derived at load,
                                  and the Sol-distance proximity
                                  queries including the core-mask gate.
                                  The test covers the recentre rewrite,
                                  epoch re-advance + focal delta, and
                                  the proximity / core-mask window.
```

## The star frame

`StarFrame` (`star-frame.ts`) owns `catalog.positions` in the
renderer's frame — everything CPU-side that depends on where the stars
actually are:

- **The local-position buffer.** `localPositions`
  (`catalog.positions − worldOffset`, bound to the dynamic `iPosition`
  attribute), rewritten against `FloatingOrigin.worldOffset` — held by
  readonly reference; the service is the only writer. `rewriteAt` is
  the frame's leg of a recentre: registered as the FIRST `onRecenter`
  listener, it rewrites the buffer in float64 per axis before the
  float32 write-back, ahead of the camera shift and the scene-layer
  fan-out (`../../frame/README.md` § Recentre fan-out).
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

**One rewrite per frame.** Rewriting the 390k-star local buffer costs
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

## `forEachStarNearCamera` — sorted-distance binary-search window

`star-frame.ts`. The core depth-mask gate (`shouldEnableCoreMask`) and
the star local-depth membership scan both need "which stars sit
within `dThresh` pc of the camera?" The original implementation
scanned all 390k positions every frame in every mode.

Build-time setup: sort the indices by distance from Sol once; store
the sorted index and parallel distances as `Uint32Array` +
`Float32Array`. At query time, compute
`camDistFromSol = (camera.position + worldOffset).length()` (the
absolute frame, not the floating-origin local frame), binary-search
for `[camDistFromSol − dThresh, camDistFromSol + dThresh]`, and
walk only that window. Triangle-inequality guarantees no candidate
falls outside it.

Typical window: 50–500 candidates instead of 390k.
