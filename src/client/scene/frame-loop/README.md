# Frame loop — one tick, in order

`FrameLoop` is the `requestAnimationFrame` loop. Each tick runs a fixed
sequence of steps owned by other subsystems; what this module owns is the
**order**, and every step's position in it is a claim about the steps
around it. The shell constructs it last, after every owner it drives,
registers its `lastCameraWriteEntry`, and calls `start()`.

## Files

- `frame-loop.ts` (+ test) — `FrameLoop`: the tick, the frame's `FrameCtx`
  (built once, mutated in place each tick), the epoch-follow step, and the
  first-frame GLSL residents check
  ([No GLSL material may reach a WebGPU boot](../README.md#no-glsl-material-may-reach-a-webgpu-boot)).

## The tick

Above the gate — every tick, rendered or not:

1. **Epoch step.** `StarFrame.advanceEpochTo(t, focusedStar)`; when it
   crosses a bucket, invalidate the gate (`'epoch-bucket'`), re-key the
   extinction prepass, and hand the focal star's displacement to
   `FocalRides.followEpochStep`
   ([The epoch follow](../../camera/focus/focal-ride/README.md#the-epoch-follow)).
2. **Origin.** `FloatingOrigin.tick()`; a recentre reseeds the
   moving-focal ride.
3. `StarFrame.flushLocalPositions()` — before anything reads
   `localPositions`, and the one rewrite a frame with both an epoch step
   and a recentre pays ([star-frame/](../../star-pipeline/star-frame/README.md)).
4. **Camera.** `CameraStep.advance(nowMs)`
   ([camera-step/](../../camera/camera-step/README.md)); its verdict is the
   gate's transition input.
5. **Frame context**, then the `'realtime'` predicate over it — see
   [Above the gate](#above-the-gate).
6. **The gate.** `RenderGate.tick` with `continuous` (camera animating or a
   realtime layer), `cadenceDue` (`ClockCadence.isDue`) and the tick's one
   `nowMs`. A refusal schedules the next tick and returns
   ([render-gate/](../../render-gate/README.md)).

Below the gate — rendered frames only:

7. Per-frame uniform writes: camera position, the focused-star pin, the
   model clock.
8. `OccluderSet.beginFrame()`, then the scene-layer fan-out
   (`layers.updateAll`), then the extinction prepass.
9. `ClockCadence.refresh` — after the fan-out, so every rate report reads
   this frame's positions.
10. `ExposureFrameStep.measure` — after the fan-out and before the first
    draw, so measurement and frame are never one frame apart.
11. `hdr.bind()`, `StarFrame.syncPhysSizeWindow()` ahead of the uniform-node
    sync that copies it, then the star compaction between that sync and the
    draws it feeds ([compaction/](../../webgpu/star/compaction/README.md)).
12. Main render, local depth pass, tone-map resolve, then the exposure
    reduction — after the resolve, so it never delays the frame it measures
    ([reduction/](../../hdr/exposure/reduction/README.md)).
13. `resolveAndPublishGpuFrame` after the last pass, listened to or not
    ([gpu-timing/](../../debug/gpu-timing/README.md)).
14. The `'frame'` emit, then the next tick is scheduled.

The perf HUD's sections (`frame.total`, `controls.update`, `pre-render`,
`star.compaction`, `submit.*`, `frame.handlers`) bracket these steps
([debug/](../../debug/README.md)).

## Above the gate

The frame context and the `'realtime'` predicate are built **before** the
render decision, on every tick. Asking the predicate only on rendered
frames would make a layer that starts needing wall-clock frames while the
gate idles wait a whole cap for one, and forever with the clock paused,
which schedules no cadence frame at all
([Declaring how time moves a layer](../README.md#declaring-how-time-moves-a-layer)).

The adaptation measurement is the opposite case and stays **below**: its
park counts wake probes in rendered frames, and hoisting it above the gate
would make a parked static view pay a probe every few ticks forever
([What a skipped tick must not break](../../render-gate/README.md#what-a-skipped-tick-must-not-break)).

## The frustum

`FrameCtx.frustum` is invalidated when the frame context is built and
refreshed by `lastCameraWriteEntry` — the registry entry the shell places
after the frame's last camera write (the orbit lock), so every frustum test
registered below it reads the pose this frame renders
([Camera writes, then camera reads](../README.md#camera-writes-then-camera-reads)).
A frustum read before that entry throws. `dispose()` invalidates it too.
