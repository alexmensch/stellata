# Render gate — draw only when something changed

`RenderGate` decides, once per `requestAnimationFrame` tick, whether
`stellata.ts` `animate()` submits the frame. The rAF loop, the camera
controllers, and `controls.update()` run every tick regardless — input
stays responsive and momentum keeps decaying — but on a skipped tick
everything from the per-frame uniform writes through the GPU passes and
the `'frame'` emit is elided. The `'frame'` event therefore keeps its
documented meaning ("after each render") while no longer being a
per-rAF heartbeat.

## Files

```
src/client/render-gate/
  render-gate.ts (+ test)      RenderGate — holds, DOM wake listeners,
                               the per-tick decision.
  render-gate-pure.ts (+ test) Pose snapshot compare + the render/skip
                               decision.
```

Both sentinels reset on `dispose()` — the pose snapshot back to NaN, the
hold count to zero. A hold released *after* that zeroing floors at 0
rather than going negative: `Stellata.dispose()` does not close an open
debug panel, so its release outlives the gate, and a negative count
would silently make the next `hold()` a no-op.

## The decision, in priority order

1. **Holds** (`hold()` → release): render every frame while any hold is
   live. Held by the debug panel while open (its readouts and perf ring
   buffers are per-frame) and by `debug.priceFrame()` for the length of
   a sweep (its dwells count `gpu.frame` samples per frame — a skipped
   frame would read as the run aborting). Ref-counted; releases are
   idempotent.
2. **Continuous conditions**, recomputed each tick by `animate()`:
   clock rate ≠ 0 (variables pulsate, binaries orbit, and ephemeris
   bodies move on the sim clock — note the clock's **default is live
   1×**, so the idle win requires the clock paused), or a camera
   transition in flight. The transition half is **not re-derived** — it
   falls out of the controller dispatch chain that runs immediately
   above, which already picked the branch: `cameraAnimating` defaults
   true and only the two steady-state branches (observe look-around,
   trackball) clear it. Re-asking the five predicates would be a second
   definition of "camera busy" for a new transition to drift out of.
3. **Pose change**: a 14-slot exact-equality snapshot — camera position,
   quaternion, fov, `controls.target`, `worldOffset`. Catches every
   camera mutation whatever its source (trackball damping, observe
   look-around momentum, recentres, `setCameraFov`). The snapshot is
   NaN-seeded so the first tick always renders, and advances only on
   rendered frames, so drift accumulated across skipped ticks still
   triggers. Exact equality is deliberate: as long as anything actually
   moves, we render; when damping converges to bit-identical floats, we
   stop.
4. **The settle tail**: `SETTLE_MS` (1500 ms) of frames after the last
   activity or `invalidate()`. This is what covers frame-late feedback
   and wall-clock blends with no queryable flag — the exposure
   reduction's readback landing (~4 frames), and the eclipse-dim
   one-pole blend (the only wall-clock animation in a render layer).
   The exposure slew itself does not rely on the tail: `animate()`
   calls `invalidate()` whenever the applied `dm` moved, so a slew in
   flight keeps frames coming until it snaps.

**"Moved" is not exact inequality for the cut, and must not become
one.** Unlike the pose — a CPU value that genuinely stops — the applied
`dm` is read back off the GPU and feeds the exposure it was measured at,
and fp16 rounding in the statistic attachment leaves that loop
alternating between two values ~1e-4 mag apart forever
(`../hdr/exposure/reduction/README.md` § Measure at the base exposure
owns why the division cannot cancel it). Close to a lit surface that
alternation is permanent, so an `!==` test wakes the gate every frame
and the idle win disappears at exactly the viewpoints it matters most.
`exposureCutMoved` therefore compares against `ADAPT_SLEW_SETTLE_MAG` —
the exposure subsystem's own "this much `dm` is the same `dm`", borrowed
rather than re-picked — and anchors on the cut at the **last
invalidate**, never the last frame's, so sub-threshold steps that all go
one way still accumulate into a wake.

## Invalidation sources (`invalidate()` callers)

- Bus `'state'` — focus, vector, filter (every `FilterController`
  mutation, and every `ExposureController` one through its `onChange`),
  cameraMode, pois, warp start, monochrome, and every discrete clock
  jump through `Stellata.notifyClockJumped()` — plus `'planetSystem'`
  (emits alone; a loaded system adds drawables).
- Canvas `pointerdown/move/up/cancel` + `wheel`, window `keydown`
  (`attachDom`) — hover, drags, and shortcuts repaint within one tick.
- Resize (`onResize`).
- The `attach*` family (dust, binaries, dust particles, constellation
  boundaries) and each streamed dust voxel chunk landing.
- An applied adaptation `dm` that moved this frame (see above).
- `KindContext.requestRender()` — the seam for a kind module's own
  async landings, which reach neither the shell nor the bus. Its one
  caller today is the planet mesh layer's lazy texture load
  (`../solar-system/planets/README.md` § Planet mesh LOD): the body
  draws a white placeholder until the map resolves, and with the clock
  paused nothing else would ask for the frame that swaps it in.

**A missed source shows as a frozen frame, which is a worse bug than a
slow one** — when adding a mutation that changes what the frame draws
without moving the camera, the clock, or emitting `'state'`, call
`stellata.renderGate.invalidate()` from it (or `ctx.requestRender()`
from inside a kind module, which is the same call). Dev-console setters that
bypass the bus (`stellata.hdr.*` switches, `setExtinctionStrength`, …)
are covered in practice by the keydown/panel wake paths, but a console
poke with hands off the keyboard can force a repaint with
`stellata.renderGate.invalidate()`.

## What a skipped tick must not break

- The exposure reduction may sit with a fence in flight across an idle
  gap; `poll()` runs on the next rendered frame and the landed texel
  pairs with the exposure captured at request time, so the reading is
  consistent — and describes a frame identical to the one on screen.
- Three.js buffer writes on skipped ticks (`flushLocalPositions`) only
  set `needsUpdate`; the upload happens inside the next real render.
