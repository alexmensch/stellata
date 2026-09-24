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
                                  epoch re-advance + focal delta, the
                                  proximity / core-mask window, and the
                                  partial-catalogue window bound.
  star-frame-pure.ts (+ test)     The proximity index's in-place merge,
                                  each chunk ordered by the shared radix
                                  sort (§ Absorbing a chunk). Pure;
                                  pinned against a full re-sort over an
                                  arbitrary chunk ramp.
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
  fan-out ([Recentre fan-out](../../frame/README.md#recentre-fan-out--order-is-load-bearing)).
- **Epoch advance.** The immutable J2016.0 `basePositions` snapshot and
  `advanceEpochTo(t, focalIdx, outDelta)`, which re-runs the
  space-motion pass whenever the model clock crosses a
  `bucketEpochJyr` bucket and reports the focal star's space-motion
  delta so the shell can translate the camera by it.
- **Derived per-instance buffers.** `logRadii`, `lumClassF32`,
  `distSol`, `teffApsis`, and `maxPhysicalRadiusPc`, all computed
  off the *advanced* positions, so `StarPipeline`'s attributes and
  every downstream consumer inherit current-epoch positions by
  construction.
- **Growing with the catalogue.** `absorbRecords()` folds each landing
  transport chunk's records into all of the above — see § Absorbing a
  chunk, which carries the two traps.
- **Proximity queries.** The Sol-distance-sorted index and
  `forEachStarNearCamera` / `discWindowPcFor` / `shouldEnableCoreMask`
  built on it (§ Star rendering, core depth-mask). `Picker` slices the
  same index for its distSol-filter window.
- **The physical-size window.** `syncPhysSizeWindow()` — § below.

## The physical-size window

`syncPhysSizeWindow()` is the **single writer** of `uPhysSizeWindowPc`,
the camera distance past which the WebGPU size solve skips the physical-
size branch. It composes `discWindowPcFor` over
`physSizeElisionBoundPx`, which owns what the bound has to satisfy
([Eliding the physical-size branch](../perceptual-disc/README.md#eliding-the-physical-size-branch)).

Every window solved through `discWindowPcFor` — this one, the core-mask
gate, the member scan — reads `maxPhysicalRadiusPc`, which is taken at
each star's **pulsation peak**, not its static radius. These are bounds
that must not move as a star breathes, and the peak/live distinction is
the one that already cost the occluder set a Mira
([The live-versus-peak pair](../../camera/controls/README.md#the-live-versus-peak-pair-and-which-one-a-caller-owes)).

The shell calls it once per rendered frame, **before** the node sync that
copies scalars onto the TSL uniform nodes: the window moves with FOV,
viewport and both `distN` sliders, so a write landing after the sync
would gate a frame against the previous one's plate scale. The slot
seeds past any distance the model reaches, so a solve running before the
first write takes the branch rather than eliding it.

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

## Absorbing a chunk

The catalogue arrives progressively ([Progressive catalog load](../../loaders/README.md#progressive-catalog-load)),
so every buffer above is allocated at the full
record count and filled forward, one window per chunk, by `absorbRecords()`.
The shell calls it from `Stellata.absorbCatalogRecords`, never on a timer.

Two things here are traps rather than choices:

- **`basePositions` is EXTENDED, never re-snapshotted.** `advanceEpochTo`
  writes `base + v·Δt` back over `catalog.positions`. A baseline taken while
  the tail was still zeroed would therefore overwrite those records with
  zeros the first time the model clock crossed a bucket — the stars would
  arrive, render, and then vanish on the first scrub.
- **Both sorted-distance arrays are re-sorted IN PLACE.** `Picker` captures
  `sortedByDistFromSol` and `sortedDistFromSol` by array reference, not
  through a getter, so reallocating either leaves it on a stale pair for the
  session.

**`distSol` AND `sortedDistFromSol` are both pre-filled with `Infinity`**,
and the second one is the one that matters. `sortedDistRange` binary-searches
`sortedDistFromSol` over its full allocated length, so whatever sits past the
decoded prefix decides where the search stops:

- At `Infinity` the array is monotone, every band ends at the decoded count,
  and the untouched `sortedByDistFromSol` tail is unreachable.
- At zero it is not monotone, and zero is *inside* every band a consumer asks
  for — so the search walks off the prefix and the window runs to the full
  record count. Every index slot out there reads 0, which is record 0, which
  is Sol. The Picker's band then scans several hundred thousand phantoms at
  the origin on every pick, and a camera far from Sol gets the opposite
  failure: `start` and `end` both land past the prefix and the near-camera
  walk sees *no* stars, so the core-mask gate never fires for the whole load.

`mergeSortedByDistance` (`star-frame-pure.ts`) takes that as its contract —
`Infinity` past `end` on entry, and the same on exit.

Filling `distSol` alone is the trap, because it looks sufficient: an
undecoded record does sort past every window, but only the *sorted* array is
ever searched.

**The window sorts by radix, not by comparator.** A comparator sort over a
167,772-record chunk measured 35 ms of the chunk's 42 ms absorb on the
main thread, which by then is drawing; `sortIndicesByKeyWords`
(`../../util/radix-sort.ts`) orders the same window on the
distances' float32 bit patterns in ~3 ms, ties by record index, identical
slot for slot on the shipped catalogue. It rests on
every distance being non-negative, since only then do the bit patterns
order as the values do — true of a `sqrt`, and the invariant to keep if
the key ever changes. The key rewrite starts at the lowest slot the merge
moved; everything below it is untouched, and the merge reads the loaded
run's distances from the key, so a slot left stale there misorders every
later chunk.

`maxPhysicalRadiusPc` and `maxEpochDriftPc` are running maxima over what has
landed. Both bound windows, so they may only grow — a chunk carrying a larger
star or a faster mover widens them, and nothing narrows them.

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
