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
  render-gate-pure.ts (+ test) Pose snapshot compare, the ride rebase,
                               and the render/skip decision.
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
GCVS periods run hours to years. So a live clock renders on a
**cadence**: each rendered frame stores a sim-time budget — the largest
step nothing drawn can turn into visible change, over every driver that
reports one — and ticks skip until the elapsed sim time reaches it.
`clockFrameDue` is the per-tick test.

**The budget alone does not decide, and must not.** It bounds how far
anything steps between two rendered frames — a *smoothness* measure. How
long the picture may be stale is a *different* measure, and the two
coincide only while frames are frequent: half a device pixel per frame is
invisible at 60 Hz and meaningless at one frame per two seconds. Two
guards therefore sit in front of the budget test, and either one renders
every tick:

- **Faster than live never idles** (`|rate| > 1`). A fast-forward is
  someone asking to watch time move, so a held frame reads as a hang
  whatever the pixel bound says — and the bound covers only the drivers
  that report one, which is a thin guarantee to hold a frame on. This
  replaces the old emergent story ("a high enough rate collapses the
  budget below one tick's sim delta"): true at large rates, but it left
  a band around 10–100× where the gap landed at seconds.
- **A gap too short to be worth idling**
  (`CADENCE_MIN_IDLE_GAP_REAL_S`, 2 real seconds; at live rate the budget
  *is* the gap). Below it a hold is long enough to read as a hang and too
  short to save anything, and it sits near one rAF tick — so the due test
  flips between rendering and skipping tick to tick, which is judder, not
  idle. Collapsing that band downward leaves two behaviours and no middle:
  continuous, or a gap nobody is waiting through.

Together they mean the cadence engages only at live rate or slower, and
only where the fastest reporting driver allows at least a two-second
hold. Everything else renders as it always did.

The budget is a min over four sources (`cadenceSimBudgetS`):

- **Layer budgets** — every layer's REQUIRED `timeBehaviour`
  declaration (`../scene/scene-layer.ts`), collected right after the
  update fan-out so each reads the state its own update wrote. `'clock'`
  layers supply a budget; `'static'` ones supply nothing and say so
  explicitly. It is a required discriminated union precisely because the
  old optional hook let a moving layer stay silent and freeze — `tsc` now
  refuses the omission. Budgets come from the planet body field (per-body
  translation + spin, plus a photometric term for a visible eclipse dim),
  the probe field (sampled velocity over camera distance), and the binary
  orbit field (per-Kepler-active-pair sweep). Each converts a
  conservative screen-motion rate through `cadenceBudgetFromRatePxS`
  (0.5 DEVICE px, so a rate in CSS px arrives with the pixel ratio).
  **The star pipeline is the standing exception**: it is not a scene
  layer at all, so its sim-clock content reaches the budget through the
  pulsation bound below and the epoch-bucket invalidate.
- **The pulsation bound** — catalog-wide constant: `CADENCE_JND_MAG`
  (0.01 mag) over the fastest unsuppressed variable's brightness slope
  (A·π/P). Vantage-free because a magnitude step is a magnitude step
  wherever the star is visible. **It bounds one of the three
  phase-locked modulations** (`../star-pipeline/pulsation/README.md`):
  the magnitude term. The radius swing (ρ^−0.5·cos φ) and the B−V swing
  ride the same phase and are NOT bounded — on a point source they are
  invisible, but on a resolved disc the radius term is the tighter of
  the two: a focused large-amplitude variable filling ~2000 px can step
  its disc edge a couple of pixels between cadence frames while the
  magnitude bound still reads "nothing moved". Bounding it needs the
  live disc size, so it belongs in a per-frame star-layer budget rather
  than this load-time constant — `stellata-8cg.32`.
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

One event mechanism rides on top rather than through the budget: an
**epoch-bucket crossing** (`maybeReAdvanceEpoch`) invalidates once,
because the star buffer was rewritten and the "nothing moved" premise no
longer holds.

**Eclipse dims used to be a second one, and it swallowed the whole win.**
Both dim fields invalidated on every rendered frame while a visible dim
was live, on the reasoning that a wall-clock anti-strobe blend needs
real-time frames. Measured, that was wrong twice over. `dimBlendFactor`
clamps its step to 0.25 s against a τ of 0.12 s, so a 30-second gap still
yields a blend of 0.875 — **the filter settles in two or three frames at
any cadence** and never needed real-time frames. And ~27 of the 80
geometrically eclipsing pairs in `multiples.tsv` are mid-eclipse at any
instant, so the hatch was open essentially always. Both invalidates are
gone. What replaced them:

- The **binary** dim needs nothing: the tightest catalogue eclipse takes
  48.6 sim-s to move a JND, against the 30 s cap — a 1.6× margin pinned
  by `tests/cadence-eclipse-rate.test.ts`, which fails if a refresh
  brings in a faster pair.
- The **planetary** dim does need a bound, and by two orders: a moon
  crossing its parent's shadow goes dark over its own diameter, ~0.4 s
  per JND for Io. `PlanetBodyField` folds that term in, gated on the dim
  actually putting ink on screen, so a visible ingress renders
  continuously and an invisible one costs nothing.

**The planet dim's term is gated on the body being on screen** — the
field tests its emitter against the **live** `uExposure` (allowed here
because the verdict is recomputed per frame and cached nowhere,
`../hdr/exposure/README.md` § Adaptation). Without that gate the outer
planets' moons would pin the frame rate a large fraction of the time:
each Galilean is eclipsed for 2–4 h once per orbit — Io alone ~5%, the
four together ~12%, with Saturn's inner moons adding more around each
Saturnian equinox — and nearly all of them sit far under the default
view's adaptation cut. The dims themselves still evaluate; only the
budget term is gated.

**`'realtime'` is the declared escape hatch, and it currently has zero
users.** A layer that genuinely animates on wall-clock time declares it
and names when (`needsFrames`), which enters as a continuous condition.
The count is worth watching — `behaviourCensus()` reports it — because
one always-on `'realtime'` layer reduces this whole mechanism to a
no-op, which is exactly what the eclipse-dim invalidate did before it
was declared and then removed.

### The focal ride, and the loop it used to close

Both rides — `applyFocalFrameRide` for a binary member,
`applyMovingFocalRide` for a planet or probe — translate camera and
target together so the focused object holds its screen position. They run
inside the scene-layer update fan-out, which sits **below** the gate, so
the write lands *after* `tick()` captured this frame's snapshot. The next
tick reads it as a fresh camera move, renders, rides again, and stamps
activity — a self-sustaining loop that pinned a moving focus at full
frame rate for as long as the focus lasted, at any distance and any
vantage. In a HUD it presents as a settle tail that never expires, which
is a misleading symptom: nothing is settling.

**The ride is not camera activity.** It keeps the focal at the same
screen position by construction. So `applyRideDelta` — the single place
either ride reaches the camera — calls `RenderGate.rebasePose(delta)`,
shifting the stored snapshot's position and target slots by the same
translation. The next tick compares equal and the clock cadence owns the
schedule again. **A delta that reaches the camera without reaching
`rebasePose` reinstates the loop**, which is exactly why both rides go
through one helper rather than repeating the four writes.

What the translation *does* move is parallax on everything that is not
the focal, and no layer prices it: each divides its own content's speed
by the camera distance without knowing the camera is moving too. Both
terms sit under the same body-speed ceiling, so the true relative rate is
at most twice what the layers reported — `CADENCE_RIDE_RATE_FACTOR`
halves the budget on any frame a ride moved the camera. Exact instead of
conservative would need each layer to difference its own content's
velocity against the ride's, a per-layer vector the hook does not carry.

Do not move a ride above the gate to make its write visible to the same
tick: it reads positions the field's walk writes below the gate, and the
mesh LOD sizes off the post-ride camera (`../stellata.ts`, the planet
layer's update).

The idle win therefore applies wherever the camera is still — the default
Sol view first among them, and now a moving focus the user has stopped
driving.

## Invalidation sources (`invalidate()` callers)

**Every caller passes a reason slug**, and the gate keeps the last one
(`debugState.lastWake`) alongside the last tick's decision inputs. Not
decoration: every source writes the same `lastActiveMs`, so once stamped,
a frame rate pinned by one of a dozen callers is unattributable. The
render watcher prints the slug (`../debug/render-watch/README.md`).


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
