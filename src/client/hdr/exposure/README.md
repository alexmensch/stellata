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
  scene-adaptation-pure.ts   The adaptation statistic: mean visible flux
    (+ test)                 per pixel, the brightest visible pixel and
                             the highlight guard's L_CAP, the measured
                             L_TARGET / L_ADAPT pair, exact disc↔viewport
                             clipping, and the star-window derivation.
  scene-adaptation.ts        SceneAdaptation — the per-frame collector
    (+ test)                 that walks the frame's light sources.
  coverage/                  How much of a source the camera can actually
                             see, measured on the GPU against the geometry
                             rendered. Its own README.
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

## One writer, four slots

**`ExposureController` owns every write** — `uExposure` plus the three
magnitude bounds — so the scalar and the bounds cannot disagree. It is
constructed *before* every consumer of those uniforms and rewrites all
four from its own constructor, which is why the seeds in
`buildStarSharedUniforms` never reach a shader. This is the one exception
to "`HdrPipeline` owns `emitterUniforms`", and it moved here from
`FilterController` when adaptation arrived: the exposure is no longer a
function of filter state alone.

| uniform | value | who reads it |
| --- | --- | --- |
| `uLimitMag` | the instrument's `m_lim` | exposure anchor, `perceptualDmEff`'s footprint window, chart disc sizing, the MW chart isobar |
| `uThresholdMag` | `m_lim + MAG_PER_STOP·ev` | the fragment taper, every CPU "is it drawn?" mirror (`drawCutoffMag`) |
| `uCullMag` | `m_lim + 3·MAG_PER_STOP + 0.5` = 10.56 | the vertex cull, nothing else |

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

## Adaptation — the scene measures itself, once per frame

`SceneAdaptation.measure()` runs in `animate()` after the layer fan-out
(ephemeris positions must be current) and before the first draw, so the
cut it writes can never be a frame behind the frame it measured.

```
visibleFractionᵢ = clippedᵢ · transmissionᵢ
L̄        = Σᵢ L(mᵢ)·fluxScaleᵢ·visibleFractionᵢ / (w·h) + DIFFUSE_FIELD_L
peak_max = maxᵢ  L(mᵢ)·fluxScaleᵢ / max(1, π·r_pxᵢ²)     (visible only)
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
- **The branches are equal at coverage `L_ADAPT / L_CAP` (5.1%)**, so the
  handover is continuous and stateless. Nothing here caches which branch
  governed last frame, and nothing may start to.
- **The guard reads the peak over VISIBLE sources only.** Occlusion and
  frame clipping remove a source from it, which is why `reduce()` computes
  the visible fraction before touching the peak accumulator.

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
  `dm === 0` is the sentinel `getDominantLabel()` and `setAdaptation`'s
  skip-if-unchanged both read, and an exponential never arrives. Chart's
  `reset()` drops `lastNowMs` too, so re-entering the scene snaps.

The readout follows the **applied** cut, not the measurement, so the
number on screen always describes the frame on screen.

**It is mean flux per pixel, and that is not an approximation.** A
source's per-pixel luminance is its flux over `max(1, π·r_px²)` — the
same denominator `stellataPointSourcePeak` uses — so `L·A` collapses to
`L(m)` in both the resolved and the sub-pixel regime. Coverage survives
only as the fraction of a source's footprint inside the frame, which is
why a source sliding into view ramps continuously (no radial taper, no
centre weighting — adding one would re-introduce the gaze dependence the
scanned-observer premise rejects) and why a body the camera has flown
inside of contributes its *surface brightness*.

**The clipping disc is floored at `ADAPT_EDGE_RAMP_PX` across.** A
sub-pixel source's own footprint would take its fraction 0 → 1 inside one
frame of camera jitter, which reads as exposure flicker; the floor spreads
that crossing over 12 px without touching the fully-inside or
fully-outside answer. It is deliberately not a hysteresis pair — that
would need per-source state, still step, and make the statistic depend on
the camera's approach direction.

Three invariants a change here must not break:

- **Measure at the base instrument exposure**, never the live scalar.
  `baseExposure` is `exposureForMagLimit(limitMag)` with no `dm` and no
  `ev`: the measurement feeds the term it would otherwise be reading,
  and with `ev` folded in, +3 stops of trim would provoke a compensating
  cut that cancels it.
- **True angular size only.** `LuminanceSample.diameterPx` is the body's
  or star's `physSize`, never the rendered `max(appSize, physSize)` — the
  perceptual glare kernel is a display exaggeration and must not drive
  exposure.
- **`fluxScale` carries real light losses only** — eclipse dim, the
  window taper. It is not a display weight, and it is not where occlusion
  goes: the eclipse dim is a *lighting* loss and occlusion is a
  *camera-path* loss, so they multiply rather than share a slot.

**Occlusion is measured on the GPU, and `coverage/README.md` owns it.**
`transmissionᵢ` is the mean throughput over source *i*'s footprint, taken
against the depth of the geometry that was actually rendered — so it
follows an oblate limb, a moon in transit, and a translucent ring
annulus, none of which a CPU mirror expressed. Two things this folder is
responsible for:

- **The walk buffers.** Every sample is copied out of its producer's
  scratch into a pool, and nothing is reduced until the walk finishes:
  the measurement lands a frame late, so the coverage pass reads that
  pool *after* the walk has ended. `sourceKey` is what survives the gap
  — pool order does not.
- **The candidate gate stays load-bearing.** `forEachDrawnBody` admits a
  body on EITHER render path — glare above the photometric cutoff, or a
  resolved surface — because at eclipse alignment φ(α) → 0 kills the
  glare while the body still fills the frame with opaque surface.
  Admitting it costs nothing on the source side (under threshold, it
  emits less than the floor), and a body that draws no surface writes no
  occluder depth, so the mesh-presence floor is now the rasteriser's
  business rather than a separate gate.
  `docs/science-hdr-pipeline.md` § 3.1 carries the reasoning.

**Sources.** Every drawn solar-system body
(`PlanetBodyField.forEachDrawnBody`, gated by the same visibility rule
`pick()` uses) plus stars near the camera, gated on **flux rather than
resolvedness** — Sol at 100 AU is a third of a pixel wide and 1036× over
`L_ADAPT`, so "is it a disc yet?" is the wrong question. The star window
is derived, not tuned: it is the distance at which a star of
`ADAPT_STAR_ABSMAG_REF` falls to `ADAPT_NEGLIGIBLE_FRACTION` of the
anchor (13.2 pc on a 1080p frame at 50°), which covers every fainter star
exactly — a fainter one cannot reach the gate from further out. Only ~120
catalogue stars are brighter than that reference, and a **taper over the
outer fifth of the window** carries them out continuously, so crossing
the bound can never pop the exposure. The diffuse field is one constant two
decades below the anchor, and therefore inert by construction: the
frame's **share** of the aggregate faint-star population (a 50° frame is
10.8% of the sphere) plus the Milky Way band at its anticentre-plane
surface brightness, which dominates it 6.7×.

`LuminanceSample` is filled from a **scratch object owned by the
producer** and is valid only inside one `visit` call — read it, don't
retain it.

**Chart mode measures nothing** and reports `dm = 0` rather than leaving
the last scene's cut standing; chart bypasses the whole seam
(`../README.md` § Chart mode).

Perf row: `adaptation`, plus `submit.coverage` / `gpu.coverage` for the
measurement (`coverage/README.md`). The dominant CPU cost is the star
walk's sorted-distance window — thousands of squared-distance tests at
mid-catalogue camera distances, a few hundred `renderedSizeComponents`
calls inside the window, and single digits of sources past the flux gate.
The window is a function of `L_ADAPT`, so a lower anchor widens it
cubically in cost. The reduce is now linear in the ~27 bodies plus
single-digit stars that survive the gate, where the circle-era occlusion
pass was O(n²).

## Not here yet

`f_ref` (`ADAPT_REF_COVERAGE`) and `L̄` become debug-panel readouts in
H8. Veiling glare — the angular term a single global scalar cannot
express — is its own bead and belongs on the emission side, upstream of
the operator, not in this folder's scalar.
