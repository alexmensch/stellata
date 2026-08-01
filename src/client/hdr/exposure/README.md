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
    (+ test)                 L_ADAPT, the highlight guard's L_CAP, the
                             measured L_TARGET, the disc peak-over-mean
                             that separates them, and the slew.
  scene-adaptation.ts        SceneAdaptation — folds the frame-late
    (+ test)                 measurement into the applied cut.
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
peak_max = max  over the frame of its G channel
           both rescaled to the BASE instrument exposure
dm       = max( min(0, −2.5·log10(L̄ / L_ADAPT)),
                min(0, −2.5·log10(peak_max / L_CAP)) )
```

**Two branches, and only the first is a perception model.** `L̄` drives
the eye branch; `peak_max` drives the **highlight guard**, which is a
display compensation — `docs/science-hdr-pipeline.md` § 3.2 (*The
highlight guard*) is the design gate and the only place the reasoning
lives. Three properties the implementation must keep, because callers
depend on them rather than on the formula:

- **`max` of two ≤ 0 cuts, so the guard can only raise exposure.** No
  source entering the frame can darken it through the guard.
- **The branches are equal at coverage
  `L_ADAPT · DISC_PEAK_OVER_MEAN / L_CAP` (5.1%)**, so the handover is
  continuous and stateless. Nothing here caches which branch governed last
  frame, and nothing may start to.
- **A buffer max is never below a buffer mean**, which is what keeps the
  `max` well-behaved: a frame bright enough to want a cut cannot hand the
  guard a peak under `L_CAP` and have the guard's zero win. Feeding the
  two branches an inconsistent pair — as only a synthetic test can — is
  the one way to see `max` cancel a cut the mean deserved.

**What the two channels are.** Attachment 1 carries **flux-correct**
luminance in R and **peak-correct** luminance in G, because the mean and
the max need different normalisations of the same light and one channel
cannot carry both. For an extended source the two are the same quantity —
its true surface brightness. For a point source they are not: the display
kernel preserves *peak*, not energy, so summing what attachment 0 holds
would over-count a threshold star's flux by 1.96x and a knee-saturated
bright one by 28.9x. R divides that kernel by its own area integral;
`../../star-pipeline/README.md` § Star intensity profile owns the integral
and `../statistic/README.md` owns the texel rule.

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

**`L_CAP` is 1.80, and that is the same level 1.2 was.** A buffer max
returns the frame's true brightest pixel where the source walk returned a
disc *mean*, and a Lambert disc's peak over mean is exactly 3/2
(`DISC_PEAK_OVER_MEAN`, 0.44 mag — the margin the walk-era README already
flagged). `adaptedDiscMeanL` and `trimStopsForCoverage` are defined on disc
means and thread the ratio back out, so day-side exposure is unchanged.

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

## Not here yet

`f_ref` (`ADAPT_REF_COVERAGE`) and `L̄` become debug-panel readouts in
H8. Veiling glare — the angular term a single global scalar cannot
express — is its own bead and belongs on the emission side, upstream of
the operator, not in this folder's scalar.
