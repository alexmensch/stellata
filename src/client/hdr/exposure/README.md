# Exposure — what the scene is exposed for

The three terms that set the one scalar every physical emitter
multiplies by, and the magnitude bounds derived from the same state.
`../README.md` owns the render target and the operator; this folder owns
the number they run on.

`docs/science-hdr-pipeline.md` § 3 is the design gate — the perception
model, the measured calibration, and the rejected alternatives live
there. This README carries the implementation contract.

## Files in this area

```
src/client/hdr/exposure/
  exposure-epoch.ts          The model as pure functions: instrument
    (+ test)                 limit → uExposure, the EV-trim constants,
                             and the threshold / cull / draw-cutoff
                             magnitudes. No GLSL side — the shaders only
                             ever read the resulting scalars.
  exposure-controller.ts     ExposureController — sole writer of
    (+ test)                 uExposure and the three magnitude bounds,
                             and the effective-limit readout's source.
  scene-adaptation-pure.ts   The two branches — the eye's anchor
    (+ test)                 L_ADAPT, the resolved-surface pin's
                             measured L_TARGET, the coverage ramp
                             joining them, and the slew.
  scene-adaptation.ts        SceneAdaptation — folds the frame-late
    (+ test)                 measurement into the applied cut, and owns
                             the three debug overrides (§ Debug panel).
  exposure-tuning.ts         The debug panel's Exposure section: the live
                             readout plus the five sliders.
  exposure-tuning-pure.ts    Readout text — the branch labels and the
    (+ test)                 no-measurement case.
  reduction/                 The GPU reduction of the HDR target's
                             statistic attachment, and its readback. Its
                             own README.
```

## The three terms

```
uExposure = L_THRESH · 10^(0.4·m_lim) · 10^(0.4·dm) · 2^ev
```

The **instrument** sets what the scene is exposed *for*: a source at its
`m_lim` (7.8 for the unaided eye) lands on the just-noticeable floor the
unit is anchored to, and every emitter reading the shared uniform moves
together. **Adaptation** (`dm ≤ 0`) is the automatic per-frame cut
(§ Adaptation). The **EV trim** is the user's manual ±3 stops in 1/3
steps, and is the only term that may go positive.

**There is no data-magnitude filter**, and its absence is a design
position rather than an omission: under this model "show me fainter
stars" is a request for a larger aperture — a different instrument — so a
second control expressing it in magnitudes would be a second,
contradictory answer to the same question.

## One writer, five slots

**`ExposureController` owns every write** — `uExposure`,
`uOmegaSummationArcsec2`, and the three magnitude bounds — so the scalar
and the bounds cannot disagree. It is
constructed *before* every consumer of those uniforms and rewrites all
five from its own constructor, which is why the seeds in
`buildSharedUniforms` never reach a shader. This is the one exception
to "`HdrPipeline` owns `emitterUniforms`", and it moved here from
`FilterController` when adaptation arrived: the exposure is no longer a
function of filter state alone.

| uniform | value | who reads it |
| --- | --- | --- |
| `uLimitMag` | the instrument's `m_lim` | exposure anchor, `perceptualDmEff`'s footprint window, chart disc sizing, the MW chart isobar |
| `uThresholdMag` | `m_lim + MAG_PER_STOP·ev` | the fragment taper, every CPU "is it drawn?" mirror (`drawCutoffMag`) |
| `uCullMag` | `m_lim + 3·MAG_PER_STOP + 0.5` = 10.56 | the vertex cull, nothing else |
| `uOmegaSummationArcsec2` | `10^(0.4·(S_lim − m_lim))` = 4.7863e5 arcsec² | both volumetric emitters' display gain, and the chart isobar |

**`uOmegaSummationArcsec2` is static in the exposure state, and that is
the point.** It is the offset between two *thresholds* — the point-source
`m_lim` and the extended-source `S_lim`, which is the instrument's
`skyBackgroundMagArcsec2` (`../../filters/filter-state.ts`
`extendedThresholdSbFor`) — and adaptation and the trim move both together,
so only an instrument change may write it. The derivation is
`../emission/README.md` § Extended sources; the convolution it gains into is
`../summation/README.md`.

**There is no `uThresholdMag` analogue on the extended side.** The
point-source pair ships an anchor *and* a trimmed edge; the extended side
ships only the anchor, so the `S_lim` that `stellataExtendedThresholdSb`
recovers is always the untrimmed 22.0. Harmless while the only consumer is
the chart isobar, which inherits no exposure state — but a scene-mode
isobar would need `S_lim + MAG_PER_STOP·ev`, not this.

**The taper anchors on `uThresholdMag`, the cull on `uCullMag`.** A
source at the threshold carries exactly `L_THRESH` at any trim, which is
the property the soft taper exists to express; a star between the
threshold and the cull bound is invisible at EV 0 but reachable at +3
stops, so the visible faint edge is always the taper and can never be a
*population* edge.

**Adaptation is deliberately absent from all three.** It moves every
frame, so a cull, a footprint window, or any dirty-tracked cache keyed on
it would thrash — and the dark-adapted limit is a property of the
instrument, not of what happens to be in frame.
`getEffectiveLimitMag()` (`uThresholdMag + dm`) is the one place
adaptation moves a magnitude, and it feeds the readout and nothing else.

`setAdaptation` is the one setter that does **not** fire `onChange`: it
runs every frame, and the URL sync and panel listen to that event.

## Adaptation — the frame measures itself

`SceneAdaptation.measure()` runs in `animate()` before the first draw and
consumes the reduction that landed for an **earlier** frame
(`reduction/README.md`). It is not one frame's own measurement, and does
not need to be: the applied cut is slew-limited over 300 ms, so a frame or
two of lag sits far inside the ramp.

```
L̄        = mean over the frame of the statistic attachment's R channel
S̄        = mean over the frame of R × the lit-surface mask in G
f        = mean over the frame of that mask alone — the coverage
           L̄ and S̄ rescaled to the BASE instrument exposure; f is a
           fraction and must NOT be
D        = S̄ / f — the lit surface's OWN mean brightness
eye      = min(0, −2.5·log10(L̄ / L_ADAPT))
pin      = min(0, −2.5·log10(D  / L_TARGET))
floor    =         −2.5·log10(Lw / L_ADAPT)
w        = smoothstep over log f from ADAPT_DOT_COVERAGE to
           ADAPT_PIN_COVERAGE
dm       = mix(max(eye, floor), pin, w)
```

**`D` is the whole point, and it is the statistic the ported guard did not
have.** A frame mean alone is `D × f`, so it tracks coverage and a body
dims as the camera closes on it; a frame *max* is `D ×` the body's own
peak-over-mean, so it tracks texture and every body wants a different
constant. Dividing two frame means recovers `D` free of both, which is what
lets one setting expose every body and lets an approach neither dim nor
brighten the subject.

`adaptationBranches` is the **only** implementation of that block —
`adaptationDm` reads its `dm`, and the readout reads the same object, so a
panel row can never describe a branch the frame did not run. It also names
which term set the cut (`open` / `eye` / `floor` / `surface` / `handover`),
the distinction quite differently-caused frames otherwise share a symptom
over. **`open` is a frame no term asked for a cut on** — the tie the old
`guard ≥ eye` test broke silently toward the guard, reporting a governing
branch on a frame where nothing set anything.

**The display floor is derived from the operator's white point, so
`DR_MAG` has to reach it.** `SceneAdaptation` takes it as a `whitePoint`
dep off `HdrPipeline.emitterUniforms` rather than reading the
default-valued `ADAPT_DISPLAY_FLOOR_DM`: a wider range is a brighter
full-white frame and therefore *justifies a deeper cut*, so a swept
`DR_MAG` left out of the floor clamps the field to a display range the
operator no longer has (`DR_MAG` 11 sinks the floor 3.5 mag). The constant
survives as the default-tuning value the design gate's numbers are quoted
at.

**One scene measurement, two display models.** `L̄` drives the eye branch,
the only perceptual claim; the **resolved-surface pin** (`D` held at
`L_TARGET`) and the **display floor** (`ADAPT_DISPLAY_FLOOR_DM`, the eye
branch's own response to a full-white frame) are display compensations at
the two ends of the operator's range — `docs/science-hdr-pipeline.md`
§ 3.2 (*The resolved-surface pin*, *The display floor*) is the design gate
and the only place the reasoning lives. Four properties the implementation
must keep, because callers depend on them rather than on the formula:

- **The floor bounds every frame the pin does not govern.** Nothing
  entering the frame as a kernel or a diffuse column can darken it past
  `ADAPT_DISPLAY_FLOOR_DM`, because none of them writes a mask. The pin
  *is* allowed past the floor, and must be: a parked Venus needs 14 mag
  and the floor stops at 6.29. This replaces the walk-era
  `dm ≥ max(eye, guard)`, which the pin deliberately breaks.
- **The ramp is stateless and its two ends are derived** — nothing caches
  which branch governed last frame, and nothing may start to.
  `ADAPT_PIN_COVERAGE` is the park framing, where the two branches agree
  exactly for a body-dominated frame (`L_ADAPT = L_TARGET · f_ref` is that
  identity), so the top closes with no step of its own.
  `ADAPT_DOT_COVERAGE` is `f_ref / 2^EV_MAX_STOPS` — the smallest framing
  the trim could still pull back to `L_TARGET`, under which § 3.2's
  brilliant dot is the honest reading. Neither is a tuned constant.
- **Approaching a body only ever deepens the cut.** `pin` is constant in
  coverage and `w` rises with it, so `dm` is monotone along an approach —
  the model cannot brighten a body and then dim it again on the way in.
- **`D` is undefined without coverage, and reads 0 there** — a frame with
  no lit resolved surface hands the pin a zero, which clamps its branch to
  zero, and `w` is zero anyway. The two agree rather than one covering for
  the other.

**What the two channels are.** Attachment 1 carries **flux-correct**
luminance in R and the **lit-surface mask** in G. R needs its own
normalisation because the display kernel preserves *peak*, not energy, so
summing what attachment 0 holds would over-count a threshold star's flux
by 1.96x and a knee-saturated bright one by 28.9x; R divides that kernel
by its own area integral (`../../star-pipeline/README.md` § Star intensity
profile owns the integral, `../attachments/README.md` the texel rule).
**G was peak-correct luminance and is not any more.** The highlight guard
was its only consumer and retired with it, and for a resolved surface R
and G were the same number anyway — so the channel was free, which is why
the coverage term costs no memory. The masked mean it feeds is formed in
the reduction's first pass, out of R × G (`reduction/README.md`).

**Occlusion, frame clipping and the diffuse field are all automatic now.**
A surface that overwrote a star's pixels overwrote its statistic texels;
a source off the edge of the frame wrote no texels at all; the Milky Way
band and the faint star field are drawn light like anything else. The
walk-era `DIFFUSE_FIELD_L` constant is therefore **retired rather than
re-derived**: its two rows were the frame's share of the threshold-star
population and the band, and both are now measured. What is left over — the
genuinely sub-threshold population — is what the Milky Way layer's
volumetric raymarch integrates by construction (`../../milkyway/README.md`),
so carrying a constant for it would double-count. The constant was two
decades under the anchor and could never produce a cut on its own, so
dropping it changes nothing observable, including with `mw=0`.

**The measurement is instantaneous; the applied cut is slew-limited.**
`measure()` returns a one-pole filter of the measurement with
`ADAPT_SLEW_TAU_S` (300 ms), reusing `dimBlendFactor` from the eclipse
photometry — so `nowMs` is wall-clock and a time-warped frame does not
slew faster. Three things this has to get right:

- **It filters `dm`, in magnitudes**, so the ramp is a constant number of
  stops per second whatever the frame's absolute level.
- **Warp snaps** (`blend = 1`). The camera is somewhere else by the next
  frame, so ramping from the old scene's cut is just a flash.
- **It settles.** `slewDm` snaps inside `ADAPT_SLEW_SETTLE_MAG`, because
  `dm === 0` is the sentinel `setAdaptation`'s skip-if-unchanged reads, and
  an exponential never arrives. Chart's `reset()` drops `lastNowMs` too, so
  re-entering the scene snaps.

The readout follows the **applied** cut, not the measurement, so the
number on screen always describes the frame on screen.

**No spatial weighting.** A plain mean over the target is the shape the
scanned-observer premise implies; centre weighting or a fovea-like radial
term would re-introduce the gaze dependence it rejects, and the buffer
gives the plain mean for free.

**`DISC_PEAK_OVER_MEAN` retired with the guard, and must not come back as
a real-body ratio.** The 3/2 was the exact Lambert value for a *smooth
untextured sphere*, and the ported guard used it to convert a buffer max
back to a disc mean — valid for nothing the model actually draws. Smoke
measured real bodies at 2.25 (Venus, a featureless cloud deck) to 6.7+
(Mercury, bare cratered rock), a different number each, which is why no
single `L_CAP` could work and why the statistic had to change rather than
the constant. `adaptedDiscMeanL` and `trimStopsForCoverage` reason about a
lone body's disc mean and now need no peak at all.

**Two invariants a change here must not break:**

- **Measure at the base instrument exposure**, never the live scalar. The
  target is rendered *with* the live one, so the reduction divides it back
  out (`reduction/README.md` § Measure at the base exposure) — that is the
  one genuinely new trap in a buffer measurement, and the most likely
  source of a feedback loop.
- **Chart mode measures nothing** and reports `dm = 0` rather than leaving
  the last scene's cut standing; chart bypasses the whole seam
  (`../README.md` § Chart mode).

**What the frame-wide reduction gave up: per-source attribution.** The
readout's "· adapted to Venus" clause retired with the walk — a mean over
pixels has no dominant source to name. Deliberate, and the trade for
seeing every emitter: the walk could name a source only because it could
not see most of the light.

Perf row: `adaptation` (now a handful of arithmetic), plus
`submit.reduction` / `gpu.reduction` for the measurement itself
(`reduction/README.md`). The star walk's sorted-distance window, its
`renderedSizeComponents` calls and the O(n) reduce over the source pool are
all gone; what replaces them is GPU work on half the frames.

## Debug panel

The panel's **Exposure** section (`exposure-tuning.ts`, first section in
`debug/debug.ts`) reads this folder and writes three overrides.

Readout, per frame: `L̄`, the lit-surface coverage and the `D` they divide
to, all at the base exposure · the three branch terms, the ramp weight and
the governing regime · **measured vs applied `dm`**, which is the slew lag
made visible · `m_lim`, EV and the effective limiting magnitude · live
`uExposure` · both ends of the coverage ramp. **`dm_eye` minus the applied
`dm` is the one-line diagnostic** for a frame exposed wrong: it is how much
cut the scene measurement asked for and did not get. `L_THRESH` and
`LUMA_CEIL` print as *baked*, because they are. `Lw` and `S_lim` print as
*derived* and are neither baked nor slidable here: `Lw` follows the
`DR_MAG` slider through `uWhitePoint`, and `S_lim` follows the instrument.

Sliders: `L_ADAPT`, `L_TARGET` and the slew τ, held on `SceneAdaptation` —
plus `DR_MAG` and the desaturation strength, which are `HdrPipeline`'s
(`../README.md` § Dev switches). **The overrides survive a chart
round-trip**: `reset()` clears the statistic and the slew, never the
knobs. **They survive a panel close too, so every slider seeds off its
live getter rather than the module constant** — `togglePanel` rebuilds
each section on open, and a constant seed would put five sliders at
defaults over a swept build.

**τ is the only tunable in the transient, and it is not what a large scene
change is showing.** The filter is one-pole; the staircase is `LUMA_CEIL`
bounding each measurement to 9.2 mag of cut and converging from above
(`reduction/README.md`), stepping every other frame at worst. A regime flip
is the third mechanism, and the readout's regime row is how to tell the
three apart before blaming the filter.

**No slider may reach `L_THRESH` or `LUMA_CEIL`.** Both are compile-time
GLSL constants in seven emitter shaders, and `L_THRESH` is the *unit's own
anchor* — `SB_ZERO_POINT`, the band's ρ₀ solve, `L_ADAPT`, `L_TARGET` and the
floor are all expressed against it, so a live one would invalidate the
calibration it was reached for.

## Not here yet

Veiling glare — the angular term a single global scalar cannot
express — is its own bead and belongs on the emission side, upstream of
the operator, not in this folder's scalar.
