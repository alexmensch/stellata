# Render gate — draw only when something changed

`RenderGate` decides, once per `requestAnimationFrame` tick, whether
`stellata.ts` `animate()` submits the frame. The rAF loop, the camera
controllers, and `controls.update()` run every tick regardless — input
stays responsive and momentum keeps decaying — but on a skipped tick
everything from the per-frame uniform writes through the GPU passes and
the `'preRender'` / `'frame'` emits is elided. Both events therefore keep
their documented meaning — either side of each render — while no longer
being per-rAF heartbeats. Which of the two a camera writer belongs on is
`../util/event-bus/README.md` § The two per-frame events.

## Files

```
src/client/render-gate/
  render-gate.ts (+ test)      RenderGate — holds, DOM wake listeners,
                               pose rebase, the per-tick decision.
  render-gate-pure.ts (+ test) Pose snapshot compare, the translation
                               rebase, and the render/skip decision.
  cadence/                     How long the gate may idle while the sim
                               clock runs — the per-layer rate report,
                               the thresholds, the safety net, and the
                               pinned vantages. Its own README.
```

Every sentinel resets on `dispose()` — the pose snapshot back to NaN, the
hold count to zero, the cadence budget to 0 and its sim stamp to NaN, the
trust state to whole. A hold released *after* that zeroing floors at 0
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
2. **Continuous conditions**, recomputed each tick by `animate()`: a
   camera transition in flight, or a `'realtime'` layer asking for
   wall-clock frames (there are none — § Declaring how time moves a
   layer in `../scene/README.md`). **A running clock is NOT one of
   them**: it schedules through the cadence below instead, which is what
   lets the out-of-the-box live-1× view idle. The transition half is
   **not re-derived** — it falls out of the controller dispatch chain
   that runs immediately above, which already picked the branch:
   `cameraAnimating` defaults true and only the two steady-state
   branches (observe look-around, trackball) clear it. Re-asking the
   five predicates would be a second definition of "camera busy" for a
   new transition to drift out of.

   The `'realtime'` predicate is evaluated **above** the gate, on every
   tick, which is why `animate()` builds `frameCtx` before the decision
   rather than after it. Asking it only on rendered frames would make a
   layer that starts needing wall-clock frames wait one whole cap for
   them — and wait forever with the clock paused, which fires no cadence
   frame to be read on.

2b. **The clock cadence**: the running clock has outrun the sim-time
   budget the last rendered frame computed. A cadence frame renders THIS
   tick without stamping activity, so no settle tail rides it (§ The
   clock cadence).
3. **Pose change**: a 14-slot exact-equality snapshot — camera position,
   quaternion, fov, `controls.target`, `worldOffset`. Catches every
   camera mutation whatever its source (trackball damping, observe
   look-around momentum, recentres, `setCameraFov`). The snapshot is
   NaN-seeded so the first tick always renders, and advances only on
   rendered frames, so drift accumulated across skipped ticks still
   triggers. Exact equality is deliberate: as long as anything actually
   moves, we render; when damping converges to bit-identical floats, we
   stop. That convergence is not free — a TrackballControls tail decays
   forever, so navigate-mode damping carries its own pixel-scale floor
   (`../camera/controls/input/README.md` § Damping settle floor), without
   which one camera nudge holds the gate open for over two minutes.

   **A slot RE-DERIVED each frame never converges, and that is a distinct
   failure from a decaying tail.** A value recomputed from inputs that
   round differently lands a few representable steps away every frame
   forever: no floor helps, because there is no tail to cut, and no
   threshold on the absolute delta finds it, because the number is
   correct to every digit a viewer could care about. `firstPoseDrift`
   therefore reports the move in **ULP** — representable float steps —
   alongside the raw delta, and `debug.renderWatch()` prints both. A
   handful of ULP is this failure; millions is something genuinely
   moving. Reading only the slot name cannot tell them apart, which is
   what made an early diagnosis of this chase the wrong subsystem.
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
and fp16 rounding in the statistic attachment turns that loop into a
quantiser (`../hdr/exposure/reduction/README.md` § Measure at the base
exposure owns why the division cannot cancel it). The threshold guards
the class: frame scheduling must never key on exact float equality of a
GPU-read continuous quantity.

**And the threshold is PERCEPTUAL, not the exposure subsystem's settle
band.** `ADAPT_SLEW_SETTLE_MAG` answers "is this numerically the same
cut", is sized against that fp16 quantiser, and is 10× tighter in
magnitudes than anything a viewer resolves. Borrowing it here read as
tidy — one subsystem's own resolution, re-used rather than re-picked —
and was a category error: it made a *scheduling* decision out of a
*numerical-equality* epsilon, and the two questions have different
answers. The cost was the whole cadence. Each wake buys `SETTLE_MS` of
frames, every one of those frames re-measures, and the measurement's own
noise re-armed the tail before it could expire — so a static view at a
vantage with any real cut rendered continuously, reporting `TAIL NEVER
EXPIRES` with nothing stamping it. That is the focal ride's shape by
another route (§ The focal ride), and the same lesson: a wake that
produces the frames that produce the next wake never settles.

`exposureCutMoved` therefore compares against `CADENCE_JND_MAG` — the
same 1 % of flux every other brightness driver schedules against
(`cadence/README.md` § The thresholds), in the magnitudes `dm` is
already expressed in. A real slew still wakes on its first frame, since
entering a bright scene ramps whole magnitudes.

It anchors on the cut at the **last invalidate**, never the last
frame's, so sub-threshold steps that all go one way still accumulate
into a wake. Note what that anchor does to a threshold set too low: it
re-seeds on every wake, so a cut *hunting* inside a band never settles
into silence the way a converging one does — it turns a bounded
oscillation into an accumulator. The anchor is right; it just cannot
carry a threshold below the measurement's own noise.

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
- `KindContext.requestRender(reason)` — the seam for a kind module's own
  async landings, which reach neither the shell nor the bus. Its one
  caller today is the planet mesh layer's lazy texture load
  (`../solar-system/planets/README.md` § Planet mesh LOD): the body
  draws a white placeholder until the map resolves, and with the clock
  paused nothing else would ask for the frame that swaps it in.

**A missed source shows as a frozen frame, which is a worse bug than a
slow one** — when adding a mutation that changes what the frame draws
without moving the camera, the clock, or emitting `'state'`, call
`stellata.renderGate.invalidate(reason)` from it (or
`ctx.requestRender(reason)` from inside a kind module, which is the same
call).

**`reason` is required, and it is a short stable slug.** A wake is
otherwise untraceable: every source writes the same timestamp, so a
frame rate pinned by one of a dozen callers cannot be attributed after
the fact. `debug.renderWatch()` prints the last one verbatim
(`../debug/render-watch/README.md`). Dev-console setters that
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
- The adaptation park counts its wake probes in **rendered** frames, not
  ticks, because `adaptation.measure()` sits below the gate's early
  return — which is what stops a parked static view paying a probe every
  six ticks forever. Hoisting that call above the gate to keep the cut
  current would silently undo it
  (`../hdr/exposure/park/README.md`).

## The clock cadence

A running clock no longer renders every tick; it schedules against a
per-frame rate report from every layer. The whole design — the contract,
the thresholds, what counts as ink on screen, how camera motion is
subtracted, the safety net and the pinned acceptance numbers — is
`cadence/README.md`. What stays here is the gate's own half: the
`cadenceDue` input above, and the pose rebase below.

## The focal ride

Focusing a moving body — a binary member, a planet, a probe — used to pin
the gate open for as long as the focus lasted, at any distance and any
vantage, and not for the reason it looks like. Both rides
(`applyFocalFrameRide`, `applyMovingFocalRide`) translate camera and
target inside the scene-layer update fan-out, which runs BELOW the gate.
So the write lands AFTER `tick()` captured that frame's pose snapshot;
the next tick reads it as a fresh camera move, renders, rides again, and
stamps activity. It is self-sustaining and never reaches a skipped tick.

`Stellata.applyRideDelta` — now the single place either ride reaches the
camera — calls `RenderGate.rebasePose(delta)`, shifting the stored
snapshot's position and target slots by the same translation. The next
tick compares equal and the cadence owns the schedule. **A delta that
reaches the camera without reaching `rebasePose` reinstates the loop**,
which is why the extraction matters as much as the call, and why the
regression is pinned both ways: an absorbed step stays quiet across six
consecutive rides, and the same step unabsorbed wakes the gate on every
one.

The rebase touches exactly the six translation slots. Orientation, fov and
`worldOffset` stay: absorbing a rotation would hide a real camera move, and
a pan that moves `target` alone still wakes the gate.

**A rotation applied below the gate therefore has no rebase to reach for,
and the only other way to stay inside the schedule is to decline the write.**
The attitude indicator's orbit lock is the second such writer — it swings the
camera round with the focused object so the 8-ball stands still
(`../attitude/orbit-frame/README.md` § The lock) — and it rides only a turn
past `cadenceVisibleTurnRad`, the scheduling threshold expressed as a camera
turn, holding the un-ridden remainder so sub-threshold turns accumulate into
one that is worth a frame. Without that it is this section's loop exactly: at
live 1× a moon's datum turns a few millionths of a degree per tick, every tick
writes, and the gate never reaches the cadence. **A camera writer that cannot
be rebased and does not threshold has no third option** — it will pin the gate
open, and its own reading will look perfectly correct while it does.

**What that carve-out originally justified itself with was wrong, and cost
the cadence.** It read "the only writer is a ride, which translates camera
and target together and rotates nothing". The ride rotates nothing — but
the code DOWNSTREAM of it re-derives pose components from the translated
values, and those derivations are not exact. Three of them existed:
`TrackballControls.update()` rebuilds `position` from `target + eye` and
re-derives orientation with `lookAt(target)` (navigate), and the OBSERVE
look pin recomputed `target = position + forward` every frame. Each landed
a few ULP from what the ride wrote, every frame, forever — the § Pose
change failure class, let in by this very paragraph. With a moving focus
and the clock running the gate woke on 28–55 % of ticks.

The fix is at the derivations, not here: the navigate pair is floored and
restored around `update()`
(`../camera/controls/input/README.md` § Derived-pose settle floor), and the
OBSERVE pin is re-derived only on rotation
(`../camera/observe/README.md` § The serialised look pin). The gate keeps
exact equality. **Anything new that recomputes a pose slot below the gate
inherits this defect** — the ULP column in `debug.renderWatch()` is how you
find it, and a handful of ULP on a slot nothing should have touched is the
signature.

`applyRideDelta` also accumulates the frame's ride translation, which
divided by the sim step IS `CadenceCtx.cameraVelPcPerSimS` (§ Camera
motion is subtracted).
