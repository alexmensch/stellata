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
  clock-cadence-pure.ts        The motion-aware clock cadence: budget
    (+ test)                   composition, the pulsation bound, and the
                               per-tick due test (§ The clock cadence).
```

Both sentinels reset on `dispose()` — the pose snapshot back to NaN, the
hold count to zero. The cadence's three live on the shell rather than
here (the budget is composed from the layer fan-out, which the gate knows
nothing about) and `Stellata.dispose` resets them alongside
`lastInvalidatedDm`: sim stamp to NaN, budget to 0, pulsation bound to
Infinity — the seeds that make the first tick after a reboot render.
A hold released *after* that zeroing floors at 0
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
2. **Continuous condition**, recomputed each tick by `animate()`: a
   camera transition in flight. It is **not re-derived** — it falls out
   of the controller dispatch chain that runs immediately above, which
   already picked the branch: `cameraAnimating` defaults true and only
   the two steady-state branches (observe look-around, trackball) clear
   it. Re-asking the five predicates would be a second definition of
   "camera busy" for a new transition to drift out of. A running clock
   is deliberately NOT continuous any more — it renders on the cadence
   below (§ The clock cadence), so the out-of-the-box live-1× Sol view
   idles too.
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
exposure owns why the division cannot cancel it). The slew now parks the
applied cut bit-identical inside its settle band
(`../hdr/exposure/README.md` § Adaptation, *It settles*), which broke
the specific limit cycle that used to alternate `dm` every frame — but
this threshold stays anyway: it guards the class (frame scheduling must
never key on exact float equality of a GPU-read continuous quantity),
not that one instance. `exposureCutMoved` therefore compares against
`ADAPT_SLEW_SETTLE_MAG` — the exposure subsystem's own "this much `dm`
is the same `dm`", borrowed rather than re-picked — and anchors on the
cut at the **last invalidate**, never the last frame's, so
sub-threshold steps that all go one way still accumulate into a wake.

## The clock cadence — how often a running clock needs a frame

At live 1× almost nothing the sim clock drives moves a pixel per tick:
planet angular motion is sub-pixel for minutes at most vantages, and
GCVS periods run hours to years. So a nonzero rate renders on a
**cadence**: each rendered frame stores a sim-time budget — the largest
step nothing drawn can turn into visible change — and ticks skip until
the elapsed sim time reaches it. `clockFrameDue` is the per-tick test;
a rate high enough (fast-forward, or a close body) collapses the budget
below one tick's sim delta and rendering is continuous again, which is
how "every vantage where motion is visibly super-threshold renders
every frame" falls out with no special case.

The budget is a min over four sources (`cadenceSimBudgetS`):

- **Layer budgets** — the `SceneLayer.cadenceSimBudgetS` hook
  (`../scene/scene-layer.ts`), collected right after the update fan-out
  so each reads the state its own update wrote. Implemented by the
  planet body field (per-body translation + spin bounds), the probe
  field (sampled velocity over camera distance), and the binary orbit
  field (per-Kepler-active-pair sweep bound). Each converts a
  conservative screen-motion rate through
  `CADENCE_MOTION_THRESHOLD_PX` (0.5 px). **A new layer whose drawn
  content the sim clock moves on screen MUST implement the hook** — the
  miss shows as that layer freezing between cadence frames, the same
  frozen-frame class as a missed invalidation source.
- **The pulsation bound** — catalog-wide constant: `CADENCE_JND_MAG`
  (0.01 mag) over the fastest unsuppressed variable's brightness slope
  (A·π/P). Vantage-free because a magnitude step is a magnitude step
  wherever the star is visible.
- **`CADENCE_CAP_SIM_S` (30 s)** — the ceiling covering every
  sim-driven change WITHOUT a per-frame bound: an eclipse dip's onset
  (both dim fields evaluate on rendered frames, so a dip can start at
  most one cap late — at 1× that is 30 real seconds into an hours-long
  event), and anything future not yet reporting a budget. It also
  bounds the idle floor: one frame per 30 s at 1×.
- A **cadence frame does not stamp activity** (`decideRender`'s
  `cadenceDue` input): stamping would drag the whole `SETTLE_MS` tail
  behind every scheduled redraw — ~90 extra frames each — which is the
  idleness the cadence exists to buy.

Two event mechanisms ride on top rather than through the budget. A
**live eclipse dim** (binary or planetary) invalidates on every rendered
frame while active, so the settle tail self-sustains continuous
rendering until the event decays — dims only change on rendered frames,
and their wall-clock anti-strobe blends need real-time frames the sim
budget cannot express. And an **epoch-bucket crossing**
(`maybeReAdvanceEpoch`) invalidates once: the star buffer was rewritten,
so the "nothing moved" premise no longer holds.

**The dim hold is gated on the dimmed body being on screen** — both
fields answer `holdsVisibleEclipseDim`, not a count of active dims, and
each tests its own emitter against the **live** `uExposure` (allowed
here because the verdict is recomputed per frame and cached nowhere —
`../hdr/exposure/README.md` § Adaptation). Without that gate the idle
win is mostly theoretical rather than mostly real: the outer planets'
moons cross their parents' shadows a large fraction of the time (each
Galilean is eclipsed for 2–4 h once per orbit — Io alone ~5% of the
time, the four together ~12%, with Saturn's inner moons adding more
around each Saturnian equinox), and a bright eclipsing binary's dip runs
for hours. Every one of those bodies sits far under the default view's
adaptation cut, so holding frames for them buys nothing and costs the
whole idle. The dims themselves still evaluate — only the frame hold is
gated.

What stays continuous regardless: any focus whose moving-focal ride
translates the camera per frame (an orbiting binary member, a planet, a
probe under a running clock) — the ride's camera write trips the pose
snapshot every tick, exactly as before this cadence existed. The idle
win applies to vantages where the camera itself is still, the default
Sol view first among them.

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
- The adaptation park counts its wake probes in **rendered** frames, not
  ticks, because `adaptation.measure()` sits below the gate's early
  return — which is what stops a parked static view paying a probe every
  six ticks forever. Hoisting that call above the gate to keep the cut
  current would silently undo it
  (`../hdr/exposure/README.md` § Parking the measurement).
