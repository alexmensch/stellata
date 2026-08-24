# The clock cadence

How long the render gate may idle while the sim clock runs. The gate
itself — holds, the pose snapshot, the settle tail, the invalidation
roster — is `../README.md`; this folder owns the answer to "when does
elapsed model time next need a frame".

```
src/client/render-gate/cadence/
  clock-cadence-pure.ts        The rate report every layer files, the
    (+ test)                   thresholds, the budget, and the due test.
  cadence-trust-pure.ts        The safety net: audit a scheduled frame
    (+ test)                   against what the budget promised.
  cadence-vantages.test.ts     The pinned acceptance numbers
                               (§ Pinned vantages).
```

Nothing here imports the parent, which is why it splits cleanly: the
gate consumes a budget it knows nothing about the derivation of, and the
shell (`../../stellata.ts` `refreshCadence`) is the only thing that holds
both ends.

## Why it exists

A running clock used to be a continuous condition: variables pulsate,
binaries orbit and ephemeris bodies move on the sim clock, so any
non-zero rate rendered every tick. The clock's default is live 1×, so
that meant the out-of-the-box Sol view redrew every rAF tick forever.

It now schedules instead. **Every layer reports, per frame, the maximum
on-screen speed of anything it currently draws**, computed from that
thing's own state in the camera's frame; the gate turns the frame's
fastest report into one sim-time budget, and ticks skip until elapsed
sim time reaches it.

One rule, and the discipline is in what it excludes: not a ceiling over
a population, not a peak over an orbit, not a min over every attached
body drawn or not. Each of those was in the first attempt at this
(closed unmerged), and their errors multiplied — a global 100 km/s speed
bound is 2× wrong for Mercury and ~100× for a slow moon; Jupiter's spin
rate applied to every body is 27× wrong for the tidally locked Moon; and
the ridden focal's translation is *infinitely* wrong, because keeping it
still on screen is exactly what the ride does. The result at the vantage
the feature most needs to win — focused Earth at closest approach — was
130× too fast, which landed under a 2-second idle floor added to stop
the nonsense hurting, which rendered every refresh.

## The contract

`SceneLayer.timeBehaviour` is **required** and a discriminated union, so
a layer cannot stay silent about time; `../../scene/README.md` § Declaring
how time moves a layer owns that half. A `'clock'` layer's `rate(ctx)`
returns a `CadenceReport`:

| channel | unit | what it is |
| --- | --- | --- |
| `screenPxPerSimS` | CSS px / sim s | fastest on-screen speed of anything drawn |
| `fluxFracPerSimS` | fraction / sim s | fastest brightness slope of anything drawn |
| `observedPx` | CSS px | what actually moved since the last frame (§ The safety net) |
| `observedFluxFrac` | fraction | what actually changed since the last frame |

**Layers report rates; the gate owns every threshold.** `CadenceCtx`
deliberately carries no pixel ratio, so a layer *cannot* reach the
device-pixel threshold even by accident — `cadenceSimBudgetS` is the one
place a rate becomes a budget, and the one place the ratio is applied.

The budget is the smallest of four: the motion threshold over the
reported pixel rate, the JND over the reported flux slope, the
catalogue's pulsation bound, and `CADENCE_CAP_SIM_S`. **A NaN rate
cannot win the reduction** — `fasterRate` compares rather than calling
`Math.max`, in both directions, so one layer returning garbage cannot
freeze the clock for every other layer.

## The thresholds

`CADENCE_VISIBLE_STEP_DEVICE_PX` is 0.5: a step smaller than half a
device pixel between two rendered frames is below what the eye resolves.
Device, not CSS — a 0.5 CSS-px step is a whole physical pixel wherever
the display runs at ratio 2.

The **scheduling** threshold is half of that, 0.25, and the factor of two
is a deliberate purchase. An accurate rate carries no slack, which
inverts the failure direction: with a conservative bound a forgotten term
wasted frames, and with an accurate one it shows as a visible FREEZE.
2× the frames buys a 2× error margin on every term at once, and it is
what makes the handoff to the cap clean (§ Emerging from behind
something).

**No idle floor.** With honest rates the closest realistic vantage
budgets seconds, not milliseconds, so nothing needs a floor to keep it
from thrashing — and a floor was policy covering a measurement error
anyway. The due test is `>=` against elapsed sim time, which is
"schedule to the first tick at or past the due time": one tick of
overshoot at worst, no cliff from 60 fps to 0.5 fps.

Faster than live never idles. `|rate| > 1` is the user asking to watch
time move, and generalising the cadence past live rate is what puts a
held frame in front of someone waiting for one. That is a product
decision, not a modelling limit.

## Only ink on screen counts

A star too faint to see must not set the frame rate. The visibility
predicate is **the one the shader uses** — the existing
`emitterPutsInkOnScreen` / `bodyInkVisible` machinery reading the live
exposure, which is legitimate here precisely because the decision is
per-frame and cached nowhere (`../../solar-system/planets/README.md`
§ The pick's adapted gate makes the same argument for the pick path).

Three exclusions, all first-class:

- **Off screen.** A body whose whole disc sits outside the frustum
  corner draws nothing. This is what makes the budget *rise and fall*:
  turn toward Jupiter from Io and the budget drops to Jupiter's
  parallax; turn away and it returns.
- **Behind its parent.** A moon round the far side of its planet
  contributes nothing, and contributes again the moment it emerges. One
  angular-separation test against the parent's own angular radius, which
  is the same separation the body-collapse test already computes —
  extracted rather than duplicated.
- **Below the cut.** The adaptation cut takes faint bodies off screen
  entirely; those report nothing.

**Delegation is gone.** No layer asks for a global min over a
population. What survives is content *anchored* to another layer's
content — see § Anchored content.

## Camera motion is subtracted, never bounded

The focal ride's velocity is known exactly: it is the delta the ride just
applied over the sim-time step. `CadenceCtx.cameraVelPcPerSimS` carries
it, and each body differences its own velocity against it.

This is exact rather than approximate, and the mechanism is worth
stating because it is what makes the headline result *zero* rather than
*small*: the ride translates the camera by precisely the focal's
displacement over the interval, and the focal's own velocity is
differenced over the same interval from the same numbers, so the
subtraction cancels to the bit. The ridden focal then contributes only
its own rotation.

It also dissolves the ride fudge factor the first attempt carried (a
blanket halving of the budget on any frame a ride moved the camera)
rather than fixing it — along with that factor's wrong justification,
which assumed the ridden focal is always the nearest body. The true
ratio is `d_focal / d_nearest`, unbounded in general.

## Two terms per body, and they ADD

A body contributes its **translation** (transverse relative velocity over
camera distance) plus its **own rotation** (its IAU prime-meridian rate
across its own angular radius). They add rather than competing for a
min, because a feature on the limb of a translating, spinning body
carries both and their directions are unrelated. The rotation term
self-gates: an unresolved body's angular radius is negligible, so a
distant rotator cannot bind.

## Photometric drivers difference what they just computed

`d(dim)/dt` from this frame's target against the last, over the elapsed
sim time. No radius-and-speed model of a shadow: differencing is exact,
it goes to zero through totality on its own, it needs no assumption about
stellar radii, and it makes the binary and planetary cases one mechanism
instead of two arguments. Both dim fields ping-pong a pair of target maps
for it, so the pair costs no allocation.

The wall-clock anti-strobe blend those targets feed
(`ECLIPSE_DIM_TAU_S`) is unaffected: at a multi-second gap the one-pole
factor saturates, so the buffer lands on the target in one frame. The
blend exists for 60 Hz, and it is not a `'realtime'` driver.

## Emerging from behind something

The cap's job is exactly two things, and nothing else: **something that
has not started yet cannot be differenced** (an eclipse onset has no
previous dip to difference against) and **something not yet visible
cannot be rated** (a body behind its parent was contributing nothing the
frame before).

The handoff is clean, and the argument is scale-free. While a moon is
hidden the binding rate is the occluder's own rotation, so
`budget = thresh / ((ω·R/d)·pxPerRad·ratio)`, and the moon's emergence
error in device px is `v·budget/d·pxPerRad·ratio` — the `d` and the plate
scale cancel:

```
error_device_px = thresh_device · v_moon / (ω_parent · R_parent)
```

For Io behind Jupiter that is **0.345 device px**. Compare it against the
**visible step** (0.5), not the scheduling threshold (0.25): the safety
factor is exactly the margin this spends, and 0.345 lands at 0.69 of it.
No visible jump, at any distance. Very close in, the true angular radius
`atan(R/d)` lengthens the budget over the small-angle form by
`d·atan(R/d)/R`, which is 8 % at two Jupiter radii — closer than any
emergence the model can show — and 1.0 by a million km.

## The safety net

An accurate estimator with no margin fails toward a freeze, so the
declarations are audited against what actually happened.

The promise being checked is the gate's own: **between two rendered
frames nothing drawn moves further than the threshold or changes
brightness by more than a JND.** Each layer therefore reports, alongside
its rate, the displacement it OBSERVED since the last rendered frame —
measured as the angle the body actually swept between the two frames'
camera positions, which is a different code path from the
transverse-velocity-over-distance the rate comes out of. An audit that
re-ran the rate model would only confirm its own arithmetic.

`auditCadenceFrame` fires when an observation exceeds the tolerance,
which is set to the safety factor — so **the net fires if and only if
something moved a step a viewer could have seen**. Anything smaller is
inside the margin the factor bought, including the one tick of `>=`
overshoot and the difference between a secant velocity and the tangent at
its end.

Three properties worth knowing:

- **It only audits frames the CADENCE scheduled.** On a frame the gate
  drew for any other reason — a camera move, a hold, the settle tail, a
  fast-forward rate — content legitimately crosses the screen, and
  auditing those would report the gate doing its job as a fault.
  `RenderGate.lastFrameWasCadenceScheduled` is that gate, and it is
  deliberately narrower than `cadenceDue`.
- **Backing off is persistent, and it learns.** `trust` is a standing
  multiplier on the budget, halved per violation down to 1/64 and crept
  back at 1.25× per clean scheduled frame. A 10× under-report costs
  three halvings — a handful of late frames — and then the schedule is
  honest again. It floors rather than collapsing to continuous
  rendering, because a frame rate that looks fine would hide the
  diagnosis.
- **It reports.** A silent net is worse than none, so a live correction
  is the TOP verdict in `debug.renderWatch()`, above holds
  (`../../debug/render-watch/README.md` § DECLARATION UNDER-REPORTED).

**What it cannot catch, stated plainly:** a driver on content no layer
enumerates at all. The observation comes from the same walk as the rate,
so it audits the *model* — a forgotten term, a wrong distance, a sign
error in the camera subtraction, a gating mistake — and not the
*enumeration*. Catching an enumeration gap needs a look at the pixels,
and the free candidate does not work: the HDR reduction already reads
back `meanL`, `discL` and `coverage` every few frames, and **all three
are exactly invariant under a rigid translation** — the dominant driver
— because they are means over the same area. A dedicated small mip tap
off the reduction chain would work and costs one extra readback on
frames the gate had idled anyway; it is filed separately rather than
built here.

## Anchored content

Several registry entries draw views of ONE subsystem's content: a moon's
orbit ring is centred on the moon's parent, the star local cluster
mirrors slots the binary walk wrote, a constellation figure's vertex may
BE a binary member. Each still has to declare a rate rather than stay
silent, and each declares the rate of the subsystem it is anchored to.

That is not the delegation-to-a-global-min the mandate removes, and the
reason is arithmetic: the owning field already reports the max over the
content it draws, and anchored geometry cannot move faster than the thing
it is anchored to, so `min(a, a) = a` — the frame's budget is identical
either way. What it buys is that no entry is silent. The field caches its
walk on `CadenceCtx.frameId`, so however many entries ask, the walk runs
once per frame.

## What the planet field reports

`cadenceReport(ctx)` is this field's declaration to the render gate: the
fastest on-screen speed of the bodies it is actually drawing, and the
fastest brightness slope among them. `../../../render-gate/cadence/README.md`
owns the design; four things about it are specific to this field.

- **The walk is `forEachDrawnBodyView` plus two more gates.** `bodyInkVisible`
  (the same live-exposure test the pick path uses, § The pick's adapted
  gate) and occlusion by the parent. The second is one angular-separation
  test against the parent's own angular radius, and it shares
  `parentGeometryInto` with the body-collapse verdict rather than
  open-coding the cross-and-dot a second time — the two want opposite ends
  of the angular range, which is why both ride `angleBetweenRad`
  (`../../../util/README.md`) instead of the phase function's `acos` form.
- **Each body's velocity is differenced, not modelled.** `prevBodyLocal64`
  holds the positions the LAST rendered frame drew, snapshotted at the top
  of `update` before the ephemeris walk overwrites them. That is what makes
  the camera subtraction exact: the focal ride translated the camera by
  precisely the focal's displacement over the same interval, so the ridden
  focal's translation term cancels to the bit and only its rotation
  remains. `recenter` shifts the snapshot by the origin step rather than
  re-seeding it — re-seeding would read as every body jumping the shift,
  which the safety net would report as a violation.
- **A culled host reports zero motion, correctly.** Its positions were not
  rewritten this frame, so the difference is zero — and a body whose
  rendered position did not move genuinely did not move on screen. The
  cadence prices what is DRAWN, so the cull needs no special case.
- **The dim slope is the difference of two frames' targets.** `dimTargets`
  and `prevDimTargets` ping-pong at the top of `update`, so the pair costs
  no allocation and the slope is exact through totality with no
  radius-and-speed model. A dip's first frame differences 1 against 1 and
  reports nothing — onset is what the 30 s cap is for.

Several registry entries (the mesh + glare, the orbit rings, the
solar-system local cluster) share this one report; the field caches it on
`CadenceCtx.frameId` so the walk runs once per frame however many ask.

## What the binary field reports

`cadenceReport(ctx)` prices the pairs the walk actually animated, for the
render gate (this file). Per active relation the
pair's own sweep rate is `ΔR` **differenced over the last rendered
frame** — the quantity the walk already computed — split by the same
barycentric coefficients it applies, then projected across each member's
line of sight over its camera distance.

That replaces the periapsis peak the LOD gate happens to hold. A pair
three quarters of the way round a 0.9-eccentricity orbit is crawling, and
pricing it at its periapsis speed cost two orders of magnitude for
nothing. Gated-out and sub-pixel-suppressed relations never reach the
split, so they contribute nothing — they move nothing on screen either.

Three pieces of state, all reset on `dispose`:

- `relDelta` / `prevRelDelta` — this frame's and the last rendered
  frame's `ΔR` per relation, copied rather than ping-ponged because the
  array is 84 relations long.
- `activeRelations` — the relations that ran Kepler this frame. Empty
  after a static-frame skip, which is consistent: a skip only fires when
  the previous walk evaluated zero Kepler relations.
- `prevMemberLocal` — the member slots' positions as the last rendered
  frame drew them, in `orbitMemberSlots` order. The safety net's measured
  channel differences these, which is the one signal here independent of
  the `ΔR` arithmetic above. `recenter()` and `markBaselinesDirty()`
  invalidate it for one frame: the shell's wholesale rewrite of
  `localPositions` predates a step no pair actually swept, and reading it
  would report the gate doing its job as a fault.

**A hierarchical focal leaves a residual** rather than cancelling to
zero: the camera subtraction is exact for a simple focused pair, and for
an inner pair the parent's own sweep survives — which that relation
reports on its own line anyway.

## Pinned vantages

`cadence-vantages.test.ts` pins the number each declaration produces at
four named vantages, with `toBe` / `toBeCloseTo` and never a one-sided
inequality — the whole point being that with an accurate rate the value
is derivable, so it is checkable, so it gets checked. All quoted at
900 CSS px of viewport height, 50° vertical FOV, 16:9, ratio 2
(pxPerRadian = 1031.32).

| vantage | binding driver | budget |
| --- | --- | --- |
| default Sol view, 30 pc | nothing drawn moves | **30 s** (the cap) |
| focused Earth, 15 800 km | Earth's rotation alone | **4.34 s** |
| focused Io, 3 000 km, looking at Io | Io's rotation alone | **5.40 s** |
| same, turned toward Jupiter | Jupiter's parallax + spin | **1.72 s** |

Two of those differ from the numbers the mandate quotes, both
deliberately and both in the safe direction:

- The mandate's 4.9–8.3 s for close Earth is the same physics at the
  **un-halved** threshold (8.67 s here) with a small-angle disc radius
  `R/d` in place of `atan(R/d)`. The shipped 4.34 s is half of it by the
  safety factor. Either way it is ~114× what the first attempt computed
  for the same vantage, and emphatically not "renders every refresh".
- The mandate's Io example takes a **min** over Jupiter's parallax
  (5.9 s) and its rotation (8.3 s). Those add here, which under-counts
  nothing: a feature on Jupiter's limb carries both.
