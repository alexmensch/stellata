# Contribution — what a layer can put on screen

The second of the two declarations every scene layer owes, and the
view frustum a gated one tests against. `LayerContribution` and
`ContributionSkip` are declared with the rest of the contract in
`../scene-layer.ts`; this folder owns what they MEAN and the one
module only they use.

```
src/client/scene/contribution/
  frame-frustum.ts (+ test)   FrameFrustum — the view planes a gated
                              layer's frustum test reads off FrameCtx,
                              with the validity sentinel that throws on
                              a read above the frame's last camera
                              write.
```

## Declaring what a layer can put on screen

`contribution` is the second **required** declaration, and a
discriminated union for the same reason as `timeBehaviour`: an omitted
hook would read as "always draws", which is the silent answer every
layer gave before the contract existed, and the failure it prevents is
paying a draw and a per-frame update for something that cannot reach a
single display pixel from this vantage ([§ 2](/docs/render-rules.md#2-contribution-gated-liveness) is
the rule; this is its mechanism).

Two kinds:

- **`'always'`** — every frame. Sequencing-only entries, the camera
  writers, anything that writes uniforms or membership other layers
  read (the solar and star clusters), and every layer not yet adopted.
- **`'gated'`** — `skip(ctx)` returns a `ContributionSkip` reason or
  `null`, and `setContributing(on)` hides or shows the layer's own
  groups. Four reasons are admissible. Three are geometric:
  `'frustum'` (bounding volume outside `ctx.frustum`), `'legibility'`
  (projected extent under `isFeatureLegible` /
  `FEATURE_LEGIBILITY_MIN_PX`, via `ctx.pxPerRadian`), `'opacity'`
  (the layer's own authored, distance-faded opacity is zero). The
  fourth, `'brightness'`, is photometric: the layer's brightest pixel
  encodes under half an 8-bit step at the live exposure
  ([The brightness reason](#the-brightness-reason)).

**A layer may use a floor of its own where the shared one is too wide.**
`'legibility'` names `FEATURE_LEGIBILITY_MIN_PX` because one floor across
labelled features is what keeps a label and its geometry vanishing
together — but a contribution test may only ever *dim*, so a layer whose
own threshold is stricter must use that instead. The star core mask stamps
down to `RESOLVED_DISC_MIN_PX`; the planet mesh gates at
`TEXTURE_PREFETCH_PX`, half a pixel *below* its own 1 px crossfade floor,
because its `update` is where the texture fetch that feeds the band starts
([Planet mesh LOD](../../solar-system/planets/README.md#planet-mesh-lod)). The shared 6 px
floor would reject frames both layers do work on. What is forbidden is a
second projected-size *helper* ([§ 2](/docs/render-rules.md#2-contribution-gated-liveness)), not a second
threshold — and a layer may gate looser than it draws, since admitting a
frame that draws nothing is the direction the contract allows.

### Which layers are gated, and which refused

Eight are gated: molecular clouds, the probe fleet and the boundary
shells on `'legibility'`; the galactic disc on `'opacity'` then
`'frustum'`; the planet mesh LOD and the star core mask on floors of
their own; the Milky Way band and the Local Group pair on
`'brightness'`. The refusals are the part worth writing down, because
each looks like an omission:

- **Coordinate spheres** track the camera at 50 kpc, so no frustum,
  legibility or opacity test can ever fire on one. Their gate is user
  chrome — observe mode and the `coordSphere` four-state — which stays
  inside `update` like every permit.
- **The constellation figure**'s four gates are all pushed permits and
  selection state, and a frustum test would have to read a bounding
  volume its own `update` writes, which `skip` runs before.
- **The solar and star clusters** write membership and uniforms other
  layers read, so they draw every frame by definition.

`../../star-pipeline/README.md` carries why the core mask is the one part
of the star pipeline in this registry at all.

**The registry owns the skip; the layer owns its groups.** `updateAll`
runs `skip` before `update` and, on a skip, calls neither `update` nor
the draw — three skips a hidden group for free. `setContributing` fires
on the **transition only**, so a layer that stays skipped pays one
predicate call per frame. `recenter`, `setMonochrome` and `dispose` still
reach a skipped layer; `update`, the draw and both per-frame
`timeBehaviour` polls are elided ([A skipped layer reports nothing](#a-skipped-layer-reports-nothing)).
Detail-permit and warp gating stay inside `update` — contribution is a
layer above them, and a skipped layer never evaluates its permit. **A
permit-disabled layer hides its groups on `update`'s first line and
returns** (`updateWarpGatedRefLayer` is the shared spelling), so the
registry needs no second axis: the residue past it measures ~3 µs of a
22.5 ms frame. The probe resample and the planet ephemeris walk are the
two a permit may never elide — focus and the moving-focal ride read
positions only `update` refreshes. Per-layer state seeds `contributing
= true`, so a layer that draws from its first frame keeps its
constructed visibility and is never told anything.

**A layer that skips must reset every dirty-track sentinel on the way
out** ([Sentinel-init](/docs/authoring-patterns.md#sentinel-init-for-dirty-track)) inside
`setContributing(false)` — a "same as last frame" short-circuit computed
before the skip is exactly what refuses to repaint on re-entry.
`FresnelShell.permitted` starting `false` to agree with its constructed
`group.visible` is the worked example ([Invariants](../../fresnel-shell/README.md#invariants)).

**The frustum is valid only below the orbit lock.** The focal rides and
the lock move the camera *inside* the fan-out, and the lock is a
rotation — so `FrameCtx.frustum` is invalidated every tick in
`refreshFrameCtx` and refreshed by the orbit-lock entry after its write
(§ Camera writes, then camera reads). A `'frustum'` test on an entry
registered above the lock throws on its first frame rather than culling
against a pose the frame does not render.

**Eight entries are above the lock, and which ones is not obvious from
reading `registerSceneLayers` alone.** All five kind-module layers —
molecular clouds, Local Group, the boundary shells, planets, probes —
register in the constructor's roster loop, which runs *before*
`registerSceneLayers` (§ How the shell uses it); the moving-focal ride,
the orbit rings and the binary orbits are the three inline entries ahead
of the lock. So clouds, the Local Group and the shells may gate on
legibility and opacity but **not** on frustum, and moving them below the
lock is not free: a module layer writes the positions the focal ride
reads, and the ride must precede the lock. Splitting one into a
position-write half and a draw-gate half is the only route, and it is
adoption's problem, not the contract's. `realtimeFramesNeeded` never
sees a valid frustum from any position — it runs above the gate, ahead
of every camera write in the frame.

`pxPerRadian` has no such constraint: it is a function of viewport and
FOV alone, hoisted above the gate, and `CadenceCtx.pxPerRadian` is a
copy of it.

### The brightness reason

`FrameCtx.exposure` is the fourth reason's input: live `uExposure`, the
base exposure, `Ω_sum`, `Ω_px`, the white point, the last **landed**
frame statistic and the adaptation tuning — **null in chart**, where the
seam is bypassed, so nothing may skip on it there. It is rewritten in
place every tick — one preallocated slot on the shell, like every other
`FrameCtx` field — which is exactly the stateless per-frame reader
[One writer, five slots](../../hdr/exposure/README.md#one-writer-five-slots) exempts from the
prohibition on consumers keyed on adaptation: what that forbids is
*holding* something derived from the cut, not the record's identity.

**It carries the cut the LAST rendered frame was drawn with.** The
fan-out runs before `measure()` folds this frame's landing, so a verdict
is one frame behind the exposure it names. That is the same lateness
[§ 3.5](/docs/science-hdr-pipeline.md#35-skipping-a-diffuse-emitter-the-display-cannot-show--the-share-bound) already argues is conservative on
both transitions, and a cut still slewing invalidates every frame
anyway, so the stale window is a settled cut that has not moved.

**The reason cannot be evaluated layer-locally.** Skipping an emitter
removes its share from the exposure statistic, which eases the cut,
which can bring the emitter back — so the predicate lives in
`../../hdr/exposure/visibility/emitter-visibility-pure.ts` (`brightnessSkip`)
and takes the layer's own `contributing` flag: its share is subtracted
from `L̄` while it draws and never while it is skipped. Two rules close
the loop — test at the exposure that will obtain *without* the emitter,
and only where that shift is under `CADENCE_JND_MAG`. § 3.5 is the
derivation and the authority.

**That flag is not this registry's transition state alone.** A layer the
user or the declutter floor has switched off is out of `L̄` as surely as a
skipped one, so both emitters refuse *above* the predicate rather than
passing it `false` — the verdict cannot change a frame they are absent
from, and each would spend milliseconds on a peak bound to reach it
([Skipping an emitter the display cannot show](../../hdr/exposure/visibility/README.md#skipping-an-emitter-the-display-cannot-show)).
A gated layer whose own predicate is expensive owes the same
refusal; the star core mask's is the third
(`../../star-pipeline/README.md`).

### A skipped layer reports nothing

The two per-frame polls that read `timeBehaviour` — `cadenceReport` and
`realtimeFramesNeeded` — skip a non-contributing layer, so the fan-outs
a skipped layer still receives are `recenter`, `setMonochrome` and
`dispose` alone. Both have the same two reasons. Its `update` did not
run, so a rate it reported would be computed from the state of whichever
frame it last drew; and a layer that cannot put a pixel on screen cannot
move one, so it has no claim on the frame's redraw budget. Asking it
anyway would leave the layer scheduling frames for content it is not
drawing — the draw and the update saved, the frames not.

**A skipped layer is only ever re-tested on a frame something else
schedules**, so every reason has to answer for its own wake path.
Frustum, legibility and opacity are functions of camera pose, and camera
motion wakes the gate on its own — that answer is free.

**Brightness is a function of the live exposure, not of pose**, and its
wake is discharged by construction rather than by a scheduler: every
input to the verdict changes only on a rendered frame. The instrument
and the EV trim invalidate through `onChange`; the applied cut
invalidates from `animate()` whenever it moves past `CADENCE_JND_MAG`;
`Ω_px` moves only on a resize or an FOV change; a statistic lands only
off a rendered frame's reduction; and camera pose renders. What is left
is sub-JND drift of the applied cut, which renders nothing and can leave
a verdict stale by under 0.01 mag of exposure — invisible by the same
definition the verdict uses. [§ 3.5](/docs/science-hdr-pipeline.md#35-skipping-a-diffuse-emitter-the-display-cannot-show--the-share-bound) carries
the enumeration; adding a fifth reason means redoing it.

`cadenceReport` runs after `updateAll`, so it reads this frame's
verdicts. `realtimeFramesNeeded` runs above the gate and reads the last
rendered frame's — a layer stays presumed-skipped until a frame proves
otherwise, which is the conservative direction.

**The contract is per layer.** Per-instance culling inside a layer —
one cloud of ninety-six behind the camera — is [§ 1](/docs/render-rules.md#1-draw-at-visible-count-not-catalogue-count)'s
territory and lives in the layer's own `update`; the layer-level
verdict fires only when the whole population fails one test.

**No hysteresis, in any of the four.** The geometric three cross their
boundary only under camera motion, which already renders every frame; a
one-pixel pop at the six-pixel legibility floor is a level-of-detail
step, not a scheduling oscillation. Brightness is the one that *looks*
like it needs hysteresis and does not: the slew parks the applied cut
bit-identical inside its settle band, so a verdict that is a function of
it cannot chatter on quantiser noise, and a real slew moves it in whole
magnitudes. What stands in for hysteresis is rule 2 — a skip whose own
exposure shift would exceed the JND is refused outright, so the
oscillator has no step to take.

**Enforced two ways.** `tsc` refuses a layer without the declaration;
`../../../tests/cadence-layer-declarations.test.ts` scans the shipped
source for the always / gated census and pins that every registration
carries both declarations. `SceneLayerRegistry.contributionCensus()` is
the live audit surface — which layers are skipping right now and why —
printed by `debug.renderWatch()` (`../../debug/render-watch/README.md`).
