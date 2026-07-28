# HDR pipeline — physical-luminance unit, unified tone-map, exposure epochs

Design gate for the HDR epic (stellata-xypg). Every implementation child
(H2 plumbing, H3 stars, H4 Milky Way, H5 planets, H6 exposure wiring,
H7 validation, H8 debug panel, then H15 instrument epoch, H16 FOV,
H17 adaptation, H18 EV trim) builds against this document. The problem
it solves: today every light-emitting layer invents its own squash into
the 8-bit [0,1] canvas — star peak-1/appSize encoding, the Milky Way's
`1 − exp(−colorAccum · 5.35e-6)`, the planet mesh's `^0.25` clamp to
[0.12, 1.6], the planet glare's peak-1 ceiling — so cross-layer
brightness is never physically consistent and can only be knob-matched
by hand. One float render target in one physical unit plus one scene-wide
tone-map makes the layers consistent by construction.

This doc lives in `docs/` because it spans `star-pipeline/`, `milkyway/`,
`solar-system/`, `local-group/`, `chart-mode/`, and the integration
shell. The H2 plumbing lands in a new `src/client/hdr/` folder whose
README carries implementation detail (RT lifecycle, pass wiring); this
doc carries the unit, the operator, and the calibration contract.

## 1. The unit — threshold-anchored display luminance

The HDR render target stores **linear relative luminance `L`, anchored
so that a point source exactly at the instrument's limiting magnitude
`m_lim` (= `uLimitMag`) carries `L = L_THRESH`**:

```
L(m) = L_THRESH · 10^(0.4 · (m_lim − m))
```

- `L_THRESH` (default **0.02**) is the display value a threshold star
  lands on. The tone-map is ~linear in this toe, so after sRGB encode a
  threshold star renders at ≈ 0.15 of full scale — dim but present,
  matching the current soft-taper feel at the cutoff.
- The exposure is *inside* the formula: the shared uniform is
  `uExposure`, and every emitting shader computes
  `L = uExposure · 10^(−0.4 · m)` from its physical apparent magnitude
  `m`. One write moves every layer identically — that is the entire
  cross-layer calibration mechanism. `uExposure` is the instrument's
  `L_THRESH · 10^(0.4 · m_lim)` times the adaptation and manual-trim
  terms (§ 3).
- `m` is V-band apparent magnitude, the scale all three calibrated
  inputs already share: catalog `absmag` + distance modulus for stars,
  `planetApparentMagnitude` (validated against the −12.7 full-Moon
  anchor) for planets, and the Milky Way's per-pixel
  `uGlowMagOffset − 2.5·log10(column)` magnitude once H4 re-anchors
  `uGlowMagOffset` to published surface photometry (§ 8). The
  `BC_photopic(Teff)` refinement (stellata-a7d.2.10) later replaces `m`
  with `m + BC_photopic` at every emission site — one substitution, no
  structural change.

**Exposure multiplies at emission, not at the tone-map.** Storing
un-exposed physical flux would span mag +15 … −26.7 (Sun at 1 AU) ≈
10^16.7 — far outside fp16. Exposed values sit in a display-centred
window (see budget below); an exposure change is one uniform write, so
nothing is lost by folding it in early.

### Range budget (RGBA16F)

fp16 max ≈ 6.5e4, min normal ≈ 6.1e-5 (subnormals to 6e-8). Worked
values for the unaided eye at `dm = 0`, EV 0 (`m_lim = 7.8`,
`uExposure ≈ 26.4`):

| Source | m | L | tone-mapped (Lw = 20) |
| --- | --- | --- | --- |
| threshold star | 7.8 | 0.02 | 0.02 → faint |
| Vega | 0.0 | 26.4 | 1.03 → clips white |
| Sirius | −1.46 | 101 | 1.24 → white |
| Venus (max) | −4.7 | 2.0e3 | white |
| MW band pixel (S ≈ 20 mag/″², 94″/px) | ≈ 10.1 | 2.4e-3 | barely visible |
| Sun disc at 1 AU | −26.7 | ceiling clamp | white |

Adaptation only ever *cuts* from this table (§ 3.1), so these are the
brightest values any source reaches — the budget is an upper bound, not
a typical frame.

Every emission clamps at **`LUMA_CEIL = 4096`** before write. Extended
Reinhard maps everything past ~10× the white point to visually
indistinguishable white, so the clamp loses nothing, and it leaves 16×
additive-accumulation headroom under the fp16 max. The faint tail
(soft-taper stars, MW wings ~1e-4…1e-5) sits at or above fp16 subnormal
territory; per-fragment accumulation happens in fp32 shader registers,
so only the final store quantises.

### Flux vs peak — what a star's quad emits

Stars communicate brightness today purely through footprint size
(√Δm appSize curve) with peak clamped at 1. Under HDR the profile's
**peak scales with flux** under one continuity rule:

```
peak_L = L(m) / max(1, π · r_phys_px²)
```

- **Physically unresolved** (`r_phys_px < 1`, the overwhelmingly common
  case — the real 30″ PSF is sub-pixel at every FOV wide enough to hold
  a constellation): the star's entire flux lands at its peak,
  `peak_L = L(m)`. The super-Gaussian footprint (appSize, √Δm,
  exaggeration K, soft-knee) is retained unchanged as a **display kernel
  normalized to peak 1** — it spreads the light for legibility but no
  longer encodes brightness.
- **Physically resolving** (`r_phys_px ≥ 1`): the emission becomes true
  surface brightness — flux over the physical disc area. A star
  approached at close range dims per-pixel toward its finite surface
  brightness exactly as in nature, and Sol's disc from 1 AU pins at the
  ceiling (white). The divisor uses the *physical* radius regardless of
  which term wins `max(appSize, physSize)`, so there is no pop at the
  disc/glow pass split (the split happens at footprints ≫ 1 px where
  the two rules would otherwise disagree by ~100×).

`r_phys_px` is settled by H3 as the **unclamped** radius in **CSS**
pixels: unclamped so a viewport-fraction cap on the drawn footprint
can't report a higher-than-true surface brightness at the zoom floor,
and CSS rather than device pixels so the same scene doesn't change
brightness on a different `devicePixelRatio` — with device pixels the
resolved branch would dim 4× at DPR 2 while the unresolved branch, whose
peak is DPR-invariant, would not.

**Accepted over-count:** because the drawn footprint is K-exaggerated
(~5–12× the real PSF) while the peak is flux-anchored, a star's
*integrated* frame flux over-counts its physical flux by roughly the
footprint-area exaggeration. This is a deliberate presentation choice —
the alternative (conserving flux over the exaggerated footprint)
renders bright stars as dim smears. Consequence for validation (§ 8):
star-vs-MW comparisons are made on **per-pixel luminance** (peak vs
band), never on integrals across the exaggerated footprint. K's role
narrows to pure legibility (footprint size); it has no brightness
effect and stops being a calibration knob. The over-count therefore
shrinks as the camera zooms in, because K itself shrinks with FOV
(§ 3.3) — at the true PSF it is gone.

Existing magnitude-domain modifiers survive unchanged and become
photometrically real: extinction A_V adds to `m`, `iEclipseDim` folds in
as `−2.5·log10(dim)`, variable-star `magMod` now modulates true
luminance (not just footprint), and the ±0.5-mag soft taper multiplies
`L`.

### Colour — linear chromaticity, luminance-normalized

The RT is linear-light. `vColor` was an sRGB-encoded LUT sample; under
HDR the blackbody LUT (`scripts/colour/blackbody-lut.ts`) regenerates as
**linear RGB normalized to relative luminance Y = 1**, so
`emitted = vColor_linear · peak_L` has luminance exactly `peak_L` and
chromaticity carries no brightness side-channel.

*As built (H3):* the table stores linear light **peak-normalized** and
the shader divides each sample by `dot(rgb, LUMA_WEIGHTS)`. A
Y-normalized triplet reaches 1.88 at the blue end, which a uint8 table
cannot hold, and linear uint8 costs at most 0.91% on any component
(smallest anywhere in the table: 0.189). Same result for `vColor`,
no texture-format change. Same treatment for
the MW / LG population colours (constants, converted once at
definition) and planet representative colours. Planet day-map textures
keep loading with `NoColorSpace` but the mesh shader decodes them to
linear before lighting (they are sRGB-authored imagery).

## 2. Tone-map operator

**Luminance-domain extended Reinhard, hue-preserving:**

```
Y   = dot(rgb, LUMA_WEIGHTS)            // Rec.709 luminance
Yd  = Y · (1 + Y/Lw²) / (1 + Y)
rgb_out = rgb · (Yd / Y), then highlight desaturation, then sRGB encode
```

- **White point `Lw`** is expressed in magnitudes:
  `Lw = L_THRESH · 10^(0.4 · DR_MAG)` with **`DR_MAG` default 7.5**
  (≈ 1000:1, the usable dynamic range of an 8-bit sRGB display). A
  source `DR_MAG` magnitudes brighter than the threshold star maps to
  exactly 1.0. Defaults `L_THRESH = 0.02`, `DR_MAG = 7.5` ⇒ `Lw = 20`.
  **`DR_MAG` is pinned at 7.5 by physiology, not tuned.** A human eye
  does not resolve a large magnitude range in one scene at one instant:
  instantaneous range at a fixed adaptation state is ~2–3 log units,
  i.e. ≈ 5.0–7.5 magnitudes. The eye's ~10^14 total range is achieved
  over *time* and *across the retina*, never simultaneously in one
  glance — which is why § 3.1's moving window, not a wider `DR_MAG`, is
  the mechanism that shows a bright disc and a faint field. H7 still
  compares against eso0932a, but as *validation* of 7.5 rather than as a
  search over 5–8; raising it would be an explicit exaggeration on the
  luminance axis (the same move K makes on the size axis) and must be
  recorded as one.
- **Scaling luminance and preserving the RGB ratio keeps hue exact** —
  the calibrated Ballesteros/blackbody star colours and the CCM
  reddening ratios survive the operator untouched. ACES/filmic was
  rejected for exactly this: its per-channel fits skew hue (blue→purple,
  orange→red) and its fixed S-curve toe crushes the faint MW wings that
  the calibration effort centres on.
- **Highlight desaturation:** above `Y ≈ Lw` the colour mixes toward
  white with a tunable strength (default gentle), modelling photopic
  saturation — Sirius reads white-hot rather than pale blue-grey.
  Chromaticity below the knee is untouched.
- **Output transfer:** linear → sRGB encode in the same pass, plus a
  ±0.5/255 dither after the encode, where 8-bit quantisation actually
  happens (the faint MW gradient toe will band without it). Shipped as
  interleaved-gradient noise rather than true blue noise — adequate
  spectrally and it ships no texture. This pass is the single place the
  output transfer lives — the Display-P3 investigation (stellata-zsr.2)
  plugs in here as an alternate encode + gamut matrix, nowhere else.
- **Hue survives the operator, but not the 8-bit clip.** Any
  luminance-domain operator sends `Y = Lw` to output luminance 1, so a
  *chromatic* source at the white point necessarily drives its brightest
  channel past full scale and clips. Clipping — not the operator — is
  what breaks hue at the top end, which is what highlight desaturation
  is for. Corollary for H7: desaturation preserves luminance only
  pre-clamp, so post-clamp luminance is not a testable invariant above
  the knee.
- Operator, `DR_MAG`, `L_THRESH`, desaturation strength, and exposure
  readout are all live on the debug panel (H8).

The operator implementation lives in a **shared GLSL chunk**
(`src/client/hdr/tonemap.glsl`, exported alongside a test-pinned pure
TS mirror) consumed by both the fullscreen pass and the no-float-RT
fallback (§ 6) — the `dust-raymarch.glsl` two-consumers pattern.

**The dither is not part of the operator for an overlapping emitter.**
It is a function of `fragCoord` alone, so N additively-blended fragments
on one pixel add the same offset N times — a coherent bias over dense
fields, not noise that cancels. H3 split `stellataTonemapUndithered`
out for emitters that overlap; the resolve and any single-coverage
volume keep the dithered call.

## 3. Exposure model — instrument, adaptation, and the EV trim

*Shipped in H15–H18, replacing H6's "the magnitude slider is the single
exposure control". `exposureForMagLimit` survives in
`src/client/hdr/exposure-epoch.ts`; `InstrumentEpoch` and its multiplier
pair do not (§ 3.4).*

Four things were welded onto one slider. They separate as:

| Knob | Meaning | Default | Moves visibility? |
| --- | --- | --- | --- |
| **Instrument** | the observing model: aperture, plus the limiting magnitude, PSF width, sky background and passband derived from it | unaided eye, 7 mm, `m_lim` 7.8 | yes |
| **Adaptation** | automatic exposure cut driven by scene luminance | on, `dm ≤ 0` | yes |
| **EV trim** | manual, ±3 stops in 1/3 steps | 0 | yes |
| **FOV** | plate scale — how finely the sky is sampled | the instrument's default, 50° | no (§ 3.3) |

```
uExposure = exposureForMagLimit(instrument.mLim) · 10^(0.4·dm_adapt) · 2^(ev)
```

**There is no data-magnitude filter.** The user-facing "max apparent
magnitude" slider is *deleted*, not re-scoped: under this model "show me
fainter stars" is a request for a larger aperture — i.e. a different
instrument — so a second control expressing it in magnitudes is a
second, contradictory answer to the same question.

**`uMaxAppMag` splits three ways, and the split is what makes each
consumer's cache honest.** The old uniform carried four meanings at once,
which was only a defect while one of them was a *data filter*. Removing
the filter left three genuinely different magnitudes:

| uniform | value | who reads it |
| --- | --- | --- |
| `uLimitMag` | the instrument's `m_lim` | exposure anchor, `perceptualDmEff`'s `√Δm` footprint window, chart disc sizing, the MW chart isobar |
| `uThresholdMag` | `m_lim + 0.753·ev` | the fragment taper, every "is it drawn?" CPU mirror |
| `uCullMag` | `m_lim + 3·0.753 + 0.5` | the vertex cull, nothing else |

`uThresholdMag` is where a source lands exactly on `L_THRESH`, so the
fragment taper anchors **there** and not on the cull bound — a star at
the threshold carries the just-visible floor at any trim, which is the
property the taper exists to express. **Adaptation is deliberately absent
from all three.** It moves every frame; keying a cull, a footprint window
or a dirty-tracked cache on it would thrash them, and the eye's
dark-adapted limit is a property of the instrument rather than of what
happens to be in frame. What adaptation moves is the *effective* limiting
magnitude the readout reports (§ 3.2).

**The cull bound is derived, and is not the limit itself.** A star
between `m_lim` and `uCullMag` is invisible at EV 0 but reachable at +3
stops, so the cull sits at that bound and the visible faint edge can
never be a *population* edge. (1 stop = 0.753 magnitudes — a conversion
this section needs constantly; the 0.5 is the existing soft taper.)
Adaptation only ever cuts, so it never widens the bound, which is exactly
why the bound can be static. At `m_lim` 7.8 it is 10.56.

**This retracts H6's claim that population cutoff and exposure agree by
construction.** They agreed only while one number served both. The claim
was true as shipped and is false under this model: exposure is now a
product of three terms, and the cull is a derived bound on one of them.

### 3.1 Adaptation — what drives the cut

The reference observer is **optimistic best case**: fully dark-adapted,
no adaptation delay, and presumed to have scanned the whole field. So
adaptation is a function of frame content with no time constant and no
dependence on which object is focused.

**The statistic is the area-weighted mean linear luminance over the
viewport** — retinal illuminance across the attended region:

```
L̄  = Σᵢ (Lᵢ · Aᵢ) / A_viewport
dm = min(0, −2.5 · log10(max(1, L̄ / L_ADAPT)))
```

`Aᵢ` is source *i*'s **true angular coverage** in pixels — never the
K-exaggerated kernel, or the footprint exaggeration would drive
adaptation. Unresolved sources floor at 1 px.

**Coverage cancels, and that is the whole reason this is cheap.** A
source's per-pixel luminance is its flux over `max(1, π·r_px²)` — the
same denominator `stellataPointSourcePeak` uses — so `Lᵢ·Aᵢ` is `L(mᵢ)`
whether the source is resolved or sub-pixel, and the statistic is
literally **mean visible flux per viewport pixel**. Coverage survives in
exactly one place: the fraction of a source's own footprint that lands
inside the frame. That is what makes frustum-edge continuity free
(below), and it is why a body the camera has flown inside of contributes
its surface brightness rather than its whole flux.

Why an area-weighted arithmetic mean, and not the two obvious
alternatives:

- **Not a log-average** (the standard Reinhard key). On a sky that is
  99.9% black the log-average sits at the floor, `dm` pins at 0, and a
  resolved planet stays blown out — it fails the exact case the
  mechanism exists for.
- **Not a maximum or a high percentile.** One bright pixel would crater
  the frame: Sirius in view would dim the star field around it.
- **The discriminator is angular extent, not luminance.** Venus filling
  the frame adapts the eye; Sirius as a point does not. Area weighting
  *is* that discriminator, and it is what pupil response physically
  integrates.

Contributions on a 1920×1080 viewport at the unaided eye's 50° FOV, so
`uExposure` = 26.365 and `Ω_px` = 27 778 arcsec². Every row is pinned in
`src/client/hdr/scene-adaptation-pure.test.ts` from exactly these inputs:

| in frame | contribution to `L̄` |
| --- | --- |
| resolved Venus filling 20% of the frame (`S₀` = +0.78, so `L_surf` 3.6e5) | 7.1e4 |
| Sol's disc at 1 AU (m −26.74; 0.53° = 11.4 px across, 103 px² of 2.07e6) | 6.3e5 |
| the frame's share of 100 000 threshold-magnitude stars, 1 px each | 1.0e-4 |
| Milky Way band at 22.55 mag/arcsec² over the full frame | 7.0e-4 |
| Venus unresolved from Earth (m −4.4, on the 1 px floor) | 7.3e-4 |

**The two aggregate rows are per-frame, and an earlier draft of this
table had them whole-sky.** The statistic is a mean over *this frame's*
pixels, so a whole-sky star count belongs in it only through the fraction
of the sphere the frame covers — 10.8% at 50° on a 16:9 viewport, so
100 000 threshold stars contribute 1.0e-4 rather than 9.6e-4. The band's
surface brightness is the anticentre-plane 22.55 mag/arcsec² the Milky
Way layer's own gradient derives (`src/client/milkyway/README.md`), not a
round 22: the band is what a frame pointed at it actually contains, and
the layer is the authority on how bright that is. The diffuse field is
therefore **Milky-Way-dominated by 6.7×**, where the earlier rows had the
two within 25% of each other.

Nearly eight decades separate the cases that must adapt from the cases
that must not, and the aggregate field sits **two** decades below
`L_ADAPT` — not four as that same draft had it. The margin is ample
either way: `dm` is exactly 0 for any `L̄ ≤ L_ADAPT`, so the diffuse term
can never produce a cut on its own.

**Frustum-edge continuity is free.** A source sliding into frame
contributes in proportion to its covered pixels, which ramps
continuously from zero, and coverage of a disc crossing a straight
frustum edge is smooth. No radial taper, no centre weighting, no new
constant. (An earlier draft proposed a fovea-like radial weight; the
coverage term already does its job, and a camera-centred weight would
also re-introduce the gaze dependence the scanned-observer premise
rejects.)

**`dm ≤ 0` is an invariant.** A fully dark-adapted eye at the
instrument's `m_lim` is the ceiling — nothing adapts to see fainter than
threshold. Automatic compensation only cuts; the manual trim is the one
term that may go positive.

**`L_ADAPT` is measured, not invented.** It was going to be a constant of
taste like `L_THRESH`, and the principled guess was mid-grey. A smoke pass
settled it empirically instead, by using the pre-H15 magnitude slider as a
manual exposure control and recording the setting at which each planet's
disc read as correctly exposed:

| body | slider `m_lim` | disc-mean `L` | output sRGB |
| --- | --- | --- | --- |
| Neptune | 2.0 | 0.919 | 0.722 |
| Uranus | 0.8 | 0.824 | 0.703 |
| Jupiter | −2.0 | 0.940 | 0.726 |

**`L_TARGET` ≈ 0.89, i.e. output sRGB ≈ 0.72** — a bright grey. The three
judgements span **0.14 magnitudes** across bodies covering a 40× range in
intrinsic surface brightness, which is a far tighter agreement than a
taste constant has any right to show, and it is the strongest evidence in
this document that the perception model is well-posed.

It also retires the mid-grey proposal: mid-grey is `L` = 0.272, **1.29 mag
too dark**. A correctly-exposed sunlit disc is not a mid-grey card.

`L_ADAPT` then follows from `L_TARGET` and one free parameter. Solving
`dm` so a body of coverage `f` lands its disc mean on `L_TARGET` gives

```
L_ADAPT = L_TARGET · f_ref        ⇒  0.089 (f_ref 0.10)
                                     0.134 (f_ref 0.15)
                                     0.179 (f_ref 0.20)
```

**`f_ref` — the reference coverage — is the honest remaining choice**, and
it is where § 3.2's coverage sensitivity enters: the model lands exactly at
`f_ref` and drifts by the coverage ratio away from it. Ship `f_ref` = 0.15
(`L_ADAPT` = 0.134), which sits mid-band and inside the ±3-stop trim for
coverages from ~4% to ~55%. Expose it on the debug panel (H8).

Two rows from the same pass bound the other end, and both are consistent
with the model rather than with a tuning error: Saturn at `L` = 0.259 and
Pluto at 0.148 were judged acceptable but were not independently optimised
(Saturn shared Jupiter's slider setting), and Mercury / Venus / Earth /
Mars all remained over the white point even at the slider's floor — the
8.5 magnitudes of cut it offers is short of the ~10.5 Venus needs, which is
precisely the gap automatic adaptation exists to close.

**Measure on the CPU, analytically.** The inputs are all to hand —
every drawn body's magnitude and true projected size, plus the stars near
the camera — so the statistic is a pure function, stall-free and
unit-testable. A GPU mip-reduce is *not* needed and would be actively
wrong on approach: `LUMA_CEIL = 4096` clamps at emission, so a GPU
measurement reads a resolved Venus as 4096, a 38× underestimate precisely
when adaptation matters most.

**What the shipped collector walks** (`src/client/hdr/scene-adaptation.ts`):

- **Every drawn solar-system body**, through the same visibility gate
  `pick()` uses, at its true angular diameter with eclipse dim folded in
  as the real flux loss it is.
- **Stars gated on flux, not on resolvedness.** Sol at 100 AU is a third
  of a pixel wide and 473× over `L_ADAPT`, so "is it a disc yet?" is the
  wrong question. The camera window is *derived*: it is the distance at
  which a star of absolute magnitude −6 falls to 3% of `L_ADAPT` (8.9 pc
  on the frame above), which covers every fainter star exactly, since a
  fainter one cannot reach the gate from further out. Only 120 catalogue
  stars are brighter than that reference and the 22 brighter than −8 all
  sit at extragalactic distances; a **taper over the outer fifth of the
  window** carries any of them out continuously, so crossing the bound
  can never pop the exposure. Walking the whole catalogue per frame would
  cost ~3M flops for a term the diffuse floor already covers.
- **One constant for the diffuse field** — the two aggregate rows of the
  table above summed (8.0e-4). Inert by construction, and honest
  bookkeeping rather than a live measurement.

The statistic is measured at the **base instrument exposure**, never the
live scalar it then writes: feeding the adapted, trimmed value back in
would close a loop, and would make +3 stops of trim provoke a
compensating cut.

### 3.2 What the model does and does not fix

Adaptation is driven by **coverage**; correct exposure depends on
**surface brightness**. The two meet only over a band of coverages:

- A body's adapted disc mean is `L_ADAPT / f`, so it lands on `L_TARGET`
  exactly at `f_ref` and drifts by the coverage ratio away from it.
- At 2% of frame it sits ~2.2 mag over and stays a small brilliant
  clipped dot. That is the right answer; a brilliant dot should read as
  a brilliant dot.
- The trim buys back `log2(f_ref/f)` stops, so ±3 stops covers coverages
  from **1.9% of the frame upward** — a factor 8 either side of `f_ref`,
  not the 4%–55% band an earlier draft quoted (that was 2.26 read as
  stops rather than magnitudes). Pinned in
  `scene-adaptation-pure.test.ts`.

**Adaptation does not subsume a solar filter.** Sol at 1 AU subtends
0.53° — 103 px of 2.07e6 — so `L̄` = 6.3e5 gives `dm` = −16.7 mag while
the disc's own −10.59 mag/arcsec² surface needs −22.0 to fall under the
white point, and −3 stops closes only 2.26 more: **3.1 mag short**. The
Sun stays clipped white unless the camera is close enough to fill the
frame. Phenomenologically that is correct: you cannot resolve granulation
with an unaided eye at 1 AU. The affordance that fixes it is **an
instrument** — a filtered solar telescope is a small effective aperture
with a deep negative exposure — not a separate neutral-density control.

**The operator stays GLOBAL, and the statistic does not breach that.**
`stellata_tonemap` is a pure function of one pixel's luminance and one
scene-wide scalar. Adaptation moves the scalar; nothing makes the
operator depend on screen position or on which object a fragment belongs
to. The *measurement* is weighted by coverage; the *application* is not
weighted at all. Keep that boundary crisp, or it becomes the loophole
every cinematic effect walks through:

- **Per-layer and per-object exposure are out** by this rule rather than
  by preference. "Render planets dimmer than the stars" is per-object
  exposure — the same per-layer squash H5 deleted.
- **Spatially-varying (local) tone mapping is out.** It is the only
  thing that *would* show 17 magnitudes at once, it is the cinematic
  HDR-photograph look, and nothing in the physical chain does it —
  not the eye at an instant, not any instrument.
- **Veiling glare is in scope later, and does not breach the rule.**
  Ocular scatter is real light redistributed in the optics *before*
  detection, so it belongs on the emission side as a convolution
  upstream of the operator. It is the mechanism that makes a bright
  source destroy *nearby* faint detail — which a single global scalar
  cannot express. Standard model: the Vos & van den Berg glare-spread
  function (CIE 135/1, valid 0.1°–100°); the simple form is
  Stiles–Holladay, `L_veil ≈ 10·E/θ²` with θ in degrees. Deferred to
  its own bead.

**Apply compensation at emission, never at the resolve.** `uExposure`
already multiplies at emission and `LUMA_CEIL` clamps there, so a lower
exposure yields a lower pre-clamp value and the ceiling is harmless.
Resolve-side gain would make that clamp lossy *and* would scale the
pre-inverse-mapped chrome colours (`src/client/hdr/chrome/README.md`).

**A limiting-magnitude readout is mandatory**, distinct from any slider
value. Without it, a star field correctly vanishing reads as a bug. The
EV row carries it: *"0 EV · adapted to Venus · stars to m 1.2"*, where the
magnitude is `uThresholdMag + dm` — the one place adaptation is allowed to
move a magnitude — and the adapted-to clause names the source carrying
most of the frame's flux, dropped entirely while `dm` is 0.

### 3.3 FOV is magnification; the instrument is aperture

An optical system carries three quantities, and real instruments bundle
two of them — which is exactly why FOV and instrument feel tangled:

- **Aperture `D`** — collecting area ∝ D². Sets how *faint* you can go.
- **Magnification / focal length** — sets plate scale, hence FOV on a
  fixed detector. Sets how *finely* you sample.
- **f-ratio `f/D`** — derived; governs extended-source brightness.

Point and extended sources respond differently, and that asymmetry is
the whole answer:

| | bigger aperture, same FOV | narrower FOV, same aperture |
| --- | --- | --- |
| point source | brighter → fainter stars appear | total flux flat; per-pixel peak dims once resolved |
| extended source | brighter | **dims ∝ FOV²** |

**The split: the instrument owns aperture, the FOV slider owns
magnification.** Narrowing the FOV is therefore a constant-aperture
telephoto, with three honest consequences:

1. **Point-source limiting magnitude is FOV-invariant.** An unresolved
   star's peak is `L(m)` at any plate scale. Zooming reveals no star
   that was not already there.
2. **Extended sources dim quadratically.** `Ω_px` falls as FOV², so the
   Milky Way band fades as the camera zooms into it and a marginal
   planet disc can drop under the floor. This is real — you cannot
   magnify nebulosity into visibility — and it is what makes changing
   *instrument* the answer rather than zooming further. +3 stops of trim
   recovers roughly 50° → 18°.
3. **Only aperture moves depth**, and aperture belongs to the
   instrument.

*Rejected alternative: evaluate photometry at a fixed reference plate
scale so extended sources stay FOV-invariant. It is numerically a
constant-f-ratio zoom, which means aperture grows as you zoom —
smuggling light collection in through the FOV control and re-tangling
the two axes.*

**The exaggeration K becomes plate-scale-derived.** K exists because
σ = 30″ is sub-pixel at 50° FOV; it is a sub-pixel-visibility hack, not
physics, so it must retire as it stops being needed. Express it as *the
factor that lands a threshold star on a target pixel size*:

```
arcsec_per_px = fov_deg · 3600 / viewport_height_css_px
K = K_density(instrument) · max(1, TARGET_PX · arcsec_per_px / σ)
```

Then `sizeMinPx = σ·K / arcsec_per_px = TARGET_PX` identically —
**star pixel size is invariant in both FOV and viewport size**, until K
floors at 1 and true physics takes over. Three problems close at once:

- **FOV.** What zooming buys is **separation, not size**: two stars that
  merged into one blob at 50° resolve at 10°, because the exaggeration
  inflating them has shrunk. The merged blob was never physics — it was K.
- **Viewport width.** Stars used to grow when the window widened, which
  is wrong: a fixed *vertical* FOV means widening the window should show
  more sky at the same scale. The cause was the arcsec-to-px conversion
  dividing by `max(w, h)` rather than by height, which inflated the plate
  scale on wide displays (≈ 2.9 px at 1440 wide vs ≈ 6.9 px at 3440).
  Deriving K from **height** — the axis `camera.fov` actually maps to -
  removed it, and put K on the same reference dimension `Ω_px` already
  uses, so the two plate-scale conventions stopped differing.
- **Small viewports.** `max(w, h)` existed to stop stars vanishing on
  landscape mobile (height 390 px). That is now solved by construction:
  a coarser plate scale raises K, so a threshold star still lands on
  `TARGET_PX`. The apologetic refDim compromise retires rather than being
  re-tuned.

`TARGET_PX` is the one calibration this introduces, and **3.84 shipped**:
it preserves the rendered size on a 1920×1080 desktop, the most common
config and so the least disruptive. (2.16 was the other defensible anchor
— it preserves `K = 12` at 50° / 1080 px height.) Either way every
viewport converges on one size instead of scattering — ultrawides shrink
toward it, small laptops grow toward it.

**Where K floors depends on `TARGET_PX`.** `K = 1` at
`arcsec_per_px = σ/TARGET_PX`, so on a 1080-px viewport the crossover is
**2.34°** at 3.84 (it would be 4.17° at 2.16). Below it the true 30″ PSF
is wider than a pixel and the disc **grows** as the FOV narrows — the
honest angular size, no exaggeration left to shrink.

**`K_density` is the instrument's half of K.** The shipped per-preset
values (12 / 9 / 5) conflated the plate-scale term with a *crowding*
term: a deeper limit needs a smaller footprint or a dense field washes
into a solid sheet. `K_density` is 1 for the unaided eye and is a
per-instrument calibration for anything deeper. Derivation:
`docs/science-stellar-modelling.md` § Stellar perception model.

One consequence for § 1's accepted flux over-count: K is now large on
small viewports and ~1 at narrow FOV, so the over-count varies with both.
It never affects per-pixel luminance (the peak stays flux-anchored), which
is why § 8 compares peaks and never integrals — but any comparison must
record the FOV and viewport it was made at.

The honest simplification: in reality, summing a point source's PSF over
a larger aperture improves limiting magnitude even at fixed f-ratio —
photon statistics, which is why aperture buys depth regardless of
f-number. Visibility here is per-pixel luminance against a *perceptual*
floor, not a photon-noise floor, so aperture reaches `m_lim` only
through the instrument record. That is precisely the simplification that
keeps the two axes independent instead of tangled.

### 3.4 The instrument record — aperture is the single number

An instrument is **one physical parameter plus derived quantities**, not
a bag of tuned multipliers:

```
{ apertureMm, defaultFovDeg, skyBackgroundMagArcsec2, passband }
   → mLim, PSF width (λ/D + aberration), K_density
```

`InstrumentEpoch.exposureMul` **retires as redundant**: aperture gain
and a limiting-magnitude shift are the same fact stated twice. 50 mm
over a 7 mm pupil is (50/7)² = 51× = 4.3 mag, and the shipped
naked-eye→binoculars preset step was 4.0 mag — the preset was already
expressing aperture gain *as* an `m_lim` change. Specify both and it
double-counts. Aperture is primary; `m_lim` derives from it.

`InstrumentEpoch.angularMag` retires too: FOV owns plate scale (§ 3.3),
so an instrument supplies a *default* FOV, never a magnification.

The unaided eye is `apertureMm = 7` — the dark-adapted pupil the σ = 30″
PSF is already derived at — with **`m_lim` = 7.8**: Bortle-1 best case,
in vacuum, fully night-adapted, which is the observer this whole model
assumes. That is 1.3 mag deeper than the shipped 6.5, and it is not
free. The visible window runs `m_lim` → `m_lim − DR_MAG`, so full white
moves from m −1.0 to **m +0.3**, and most of the first-magnitude list
(Canopus, α Cen A, Arcturus, Vega, Capella, Rigel) clips where only
Sirius did.

**Accepted, and arguably more correct:** a dark-adapted eye is
rod-dominated and genuinely sees bright stars as colourless white.
Stellar chromaticity returns the way it does in nature — by flying close
enough that adaptation drives the observer photopic, at which point
cones carry the colour. `DR_MAG` stays **7.5**; H7 inherits no retune
from this change.

**The three axes a future preset needs, named here so the record does
not have to be reopened per preset:** aperture/resolution (above),
sky-background luminance (`skyBackgroundMagArcsec2` — no consumer yet;
it lands as an additive floor on `L`), and passband (no consumer yet; it
substitutes for V in `L(m)`, alongside `BC_photopic`). The presets
themselves — binoculars, telescope, filtered solar telescope,
light-polluted city, JWST — stay out of scope; only the record shape is
mandated here.

## 4. Per-layer mapping — every current squash and its replacement

Physical layers (emit `L`, exposure-multiplied, pre-tone-map):

| Layer | Current squash | HDR replacement |
| --- | --- | --- |
| Star glow + disc (`star.frag.glsl`) | peak-1 profile; brightness = footprint only | `peak_L = L(m) / max(1, π·r_phys²)` × unit-peak profile (§ 1); footprint math untouched |
| Star halo (MaxEquation) + core mask | unchanged mechanisms | blend equations operate on linear L; depth rules unchanged |
| Milky Way (`milkyway.frag.glsl`) | `1 − exp(−colorAccum · 5.35e-6 · gate)`, `uGlowMagOffset` vs slider gate | *Shipped as designed (H4).* `L_px = uExposure · 10^(−0.4·m_px)` where `m_px = uGlowMagOffset − 2.5·log10(column · Ω_px)`; `Ω_px` = pixel solid angle in arcsec², so **surface brightness** rather than per-pixel luminance is the FOV-invariant (zooming dims the band exactly as it dims a resolved stellar disc). `DEFAULT_BRIGHTNESS`, the gate, and the exp squash are deleted. The magnitude round-trip collapses to one scalar gain, so the sightline's chromaticity survives untouched. `uGlowMagOffset` is **derived** (≈ 31.054) from a declarative single-point anchor — the GC sightline at S = 20.0 mag/arcsec², the § 1 band reference — pending H7's per-sightline re-derivation (§ 8). Dust optical depth is seeded from the camera, not from each proxy mesh's own entry point, or the bulge emits through none of the 3.1 kpc Sol-to-boundary column |
| LG emission (shelved) | same gate + exp squash, magnitude-domain | identical mapping as MW when unshelved — it already computes a per-pixel magnitude, so it lands on the unit for free; no new bead until unshelve |
| Planet glare / billboard (`planet.vert/frag`) | peak-1 white ceiling (2f6.27) | *Shipped as designed (H5).* Identical point-source rule as stars, `m` from `planetApparentMagnitude`; `uGlareGain` demoted to a debug multiplier. mesh↔glare continuity by construction — pinned to 1e-12 relative in `mesh-surface-pure.test.ts` |
| Planet mesh (`planet-mesh.frag.glsl`) | `litIntensity`: irradiance^0.25 × slider^0.25, clamp [0.12, 1.6] | *Shipped as designed (H5).* True surface brightness: `S₀ = m_host@body + 2.5·log10(π / (ARCSEC_TO_RAD²·p))` — radius and viewer distance cancel out of `m + 2.5·log10(Ω_disc)`, so it is distance-invariant and validates on the full Moon's measured +3.4 mag/arcsec². Lambert/phase/limb shading redistributes at unit mean via a closed-form disc mean, and the day map is divided by its own measured mean luminance so a brightness-stretched mosaic contributes pattern only. `hostIntensityScale`, `HOST_IRRADIANCE_DISPLAY_EXPONENT` and `HOST_INTENSITY_MIN/MAX` are deleted. Detail: `src/client/solar-system/planets/README.md` § Physical-luminance emission |
| Planet rings | multiply litIntensity | *Shipped as designed (H5).* Multiply the same host-irradiance scalar the disc airlight and the atmosphere shell ride (`hostIrradianceLuminance`), so ring↔body contrast is fixed by the shared exposure. The strip's RGB is read as a LINEAR reflectance and deliberately not sRGB-decoded — it was authored as an albedo proxy, and decoding would darken the rings ~5x against the true-opacity alpha |
| Earth night lights | **no codepath** | Nothing to convert: both the renderer path and the `earth-night` map were removed before H5, so this row described a layer that no longer existed. Re-adding city lights needs a radiometric calibration source (Black Marble) rather than a tuned constant, which is why H5 deliberately left it out — tracked separately |
| Molecular-cloud absorption | premultiplied attenuation of background | **unchanged and now more correct**: transmittance is a multiplicative, exposure-invariant factor, and it attenuates linear luminance instead of squashed values. No exposure multiply — attenuation factors must never carry `uExposure` |

Non-physical chrome (galactic disc + grid, LG wireframes, constellation
figure, orbit rings, binary orbit paths, heliopause + Local Bubble
fresnel shells, cloud rim shells, dust particles if unshelved): these
render **into the HDR RT** (they must depth-test against the scene) but
**never multiply `uExposure`**, and their authored display colours are
mapped through the CPU-side inverse of the tone-map
(`inverseTonemapConstant(displayRGB)` at material set-time) so they
come out of the pass at their authored appearance at any exposure.
Additive/translucent chrome blending now happens in linear space — a
slight look shift accepted in H2, which is where the per-material
mapping lands (`src/client/hdr/README.md` § Chrome; the mapping has two
variants, because whether a material carries three's own output encode
decides what "authored appearance" means for it). (Rejected alternative: render
chrome after the tone-map via a depth blit — an extra full-res depth
copy per frame to preserve exactness nobody will notice.)

SVG overlays are DOM, composited above the canvas — untouched by
construction.

## 5. Chart mode — full bypass

Chart mode renders **direct to the default framebuffer, exactly as
today**: no HDR RT, no tone-map pass, no exposure. Chart is
deliberately non-photometric ink-on-paper (MultiplyBlending, flat
discs, linear-in-magnitude sizing) and every physical premise above is
wrong for it. The chart↔realistic flip re-targets the renderer
(`setRenderTarget(null)` ↔ RT) alongside the existing material swaps in
`chart-mode.ts`. This is cheaper and more honest than an identity
tone-map path, and it keeps chart snapshots pixel-identical across the
epic.

**Chart depth follows the instrument, and nothing else.** Its
magnitude-linear disc sizing reads `uLimitMag`, so a chart shows what the
current instrument can perceive — a paper chart of the naked-eye sky
under the unaided eye, a telescopic atlas under a telescope. It inherits
neither adaptation nor the EV trim, and that is correct rather than a
gap: paper has no exposure state.

## 6. Float-RT fallback

Primary path requires a float-renderable target: RGBA16F via WebGL2
`EXT_color_buffer_float`, else `EXT_color_buffer_half_float` (fp16
blending needs no further extension; `EXT_float_blend` is only a 32F
concern — we never need 32F).

On contexts with neither, mirror the extinction-prepass strategy
(`star-pipeline/extinction/README.md` § The prepass cache — same chunk,
two paths):
**each emitting fragment shader applies the shared `tonemap.glsl` chunk
inline and renders direct to the canvas** — no intermediate RT at all.
Calibration is identical (same `L`, same operator, same exposure); what
degrades is compositing: additive accumulation happens on tone-mapped
values, so dense star fields and the MW band over-brighten slightly
where sources overlap, and per-channel-max discs blend post-curve.
Accepted — the fallback population is ~zero on real hardware, and the
result is approximately right rather than differently-calibrated.
A `stellata.setHdrEnabled(false)` dev switch parks the renderer on the
fallback path for A/B, mirroring `setExtinctionPrepassEnabled`.

The fallback is why the operator must live in the shared chunk from H2
day one — the fullscreen pass and the inline path can never drift.

## 7. Plumbing constraints (H2 scope)

- One RGBA16F RT sized canvas × pixelRatio (existing cap 2), resized
  with the renderer; depth-stencil renderbuffer attached (the main
  pass's depth semantics, core masks, and the log-depth split are
  unchanged — depth encoding is orthogonal to colour encoding).
- Pass order: main pass → local depth pass (renders **into the same
  RT**, repainting over the finished frame as today) → fullscreen
  tone-map → canvas. `localDepthPass.render` keeps its position; only
  the bound target changes.
- The canvas is `alpha: true` with a transparent clear in realistic
  mode (chart mode swaps the clear colour to opaque paper — another
  reason for the § 5 bypass); the RT clears to transparent black and
  the tone-map pass maps RGB, passes accumulated alpha through, so page
  background compositing is preserved.
- **H2 cannot be look-neutral, and must not pretend to be.** An earlier
  draft of this section asked for "no visible regression at exposure 1"
  on the theory that the operator is near-identity over `[0,1]`. It
  isn't: at `Lw = 20` the operator sends 1.0 → 0.50 and 0.1 → 0.091,
  and — decisively — *no shader in the repo performs an sRGB encode*
  (there is no `colorspace_fragment` include anywhere; the star pass is
  `RawShaderMaterial` and the blackbody LUT loads `NoColorSpace`), so
  today's authored values are already display-encoded and the pass's
  encode re-encodes them. The two effects are large and opposed.
- **The seam shipped dormant through H3–H5 and is now live.**
  `HDR_DEFAULT_ENABLED` (in `src/client/hdr/hdr-pipeline.ts`) was false
  while emitters were still on their old encodings — enabling it earlier
  would only have traded a correct-looking scene for a mis-calibrated
  one — and H5 flipped it with the last conversion. The render target
  allocates lazily, which is what made the dormant period cost no VRAM
  and still serves `setHdrEnabled(false)` and chart mode.
  **Consequence that outlives the flip:** with the seam off, an emitter's
  physical luminance reaches the canvas with no operator, so the inline
  `stellata_tonemap` fallback (§ 6) is not exotic-hardware insurance. It
  was the default path throughout H3–H5 and remains the A/B and the
  no-float-RT path, so every emitter keeps both paths working.
  The one emitter still outside the scale is the shelved Local Group
  emission pass (stellata-gxx.8) — convert before un-shelving.
- **Exposure and `Ω_px` are not H2's.** `uExposure`, `LUMA_CEIL`, and
  `Ω_px` land with their first consumer — stars (H3), the Milky Way (H4),
  the exposure wiring (H6) — rather than in the plumbing bead, where they
  would be uniforms and resize bookkeeping with no reader.
  H3 landed `uExposure` and `LUMA_CEIL` in `src/client/hdr/emission.glsl`
  + `emission-pure.ts`, reachable through
  `HdrPipeline.emitterUniforms` — the by-reference uniform seam H4 and
  H5 bind to as well. Both chunks are `#ifndef`-guarded because an
  emitter deriving a per-pixel magnitude (H4) needs the unit and the
  operator in one stage.
  H4 added `uOmegaPxArcsec2` to the same seam, written by
  `HdrPipeline.setPixelSolidAngle` from the CSS-pixel viewport **height**
  and `fovYRad`; the shell drives it from `setCameraFov` and resize.

## 8. Validation contract (H7)

- **Compare per-pixel luminance, not integrals.** Star peaks vs MW band
  brightness — the K-exaggerated footprint over-counts star integrals
  by design (§ 1).
- **MW anchor:** re-derive `uGlowMagOffset` so a chosen sightline
  matches published V-band surface photometry (GC bulge / Baade's
  window and an anticentre point), then confirm against eso0932a
  stretches per instrument. The offset is **derived** from a single-point
  anchor (`GC_BAND_REFERENCE_MAG_ARCSEC2 = 20.0` → `uGlowMagOffset ≈
  31.054`), so H7's job is to replace the *anchor*, not to tune the
  offset. The known gap it leaves is a latitude gradient steeper than the
  real sky's — the model puts NGP near 25.1 mag/arcsec² against a real
  ~23.5–24. Fixing that is a density-profile question, not an offset one.
- **`DR_MAG` is validated, not tuned** (§ 2): H7 confirms 7.5 against the
  panorama rather than searching 5–8, and records any departure as an
  explicit exaggeration.
- Cross-layer smoke at the unaided eye: threshold stars at the
  just-visible floor; Sirius/Vega ordering *pre-clip*; Venus > Sirius;
  planet resolve-step continuity (glare↔mesh at equal `L(m)`); moon vs
  dim-surfaced parent ordering at true flux.
- **Adaptation acceptance (H17)** — the auto model must land every case
  within the trim's ±3 stops, or the trim range is wrong. That is a
  requirement on the model, not a discovery for smoke: fly to Venus,
  Mars, Jupiter and Pluto (the 9-magnitude spread) and confirm each disc
  reaches surface detail within ±3 stops of EV 0. Since the envelope is a
  *coverage* band (§ 3.2, ≥ 1.9% of the frame), a case that fails is a
  case flown from too far out — check the disc's frame fraction before
  concluding `L_ADAPT` is wrong. The known exception is Sol at 1 AU,
  3.1 mag out of reach by design.
- **FOV invariants (H16)** — star pixel size constant from 120° down to
  the `K = 1` crossover (2.34° on a 1080-px viewport at `TARGET_PX` 3.84),
  below which the resolved 30″ PSF makes the disc *grow*; a close pair
  merged at 50° resolving at 10°; no new star appearing at any FOV; the MW
  band dimming quadratically (the accepted § 3.3 consequence, not a
  regression).

## 9. Bead-shape decisions

- **H3 (stars) and H6 (exposure wiring) stay separate beads.** *Shipped
  as designed.* H3
  converts star emission with `uExposure` pinned at the base epoch
  (slider keeps its current population-only semantics for that interim);
  H6 then routes slider + presets → `uExposure`, builds the epoch
  structure (§ 3), and deletes the planet-side litIntensity slider
  composition — it is cross-layer wiring, not a star change. The
  interim state (physical star emission, fixed exposure) is coherent
  and shippable.
- **H8 retires the per-layer brightness knobs** — MW brightness scalar
  + gate (*deleted in H4*), planet-disc floor/exponent constants
  (*deleted in H5*), dynamic-range exponent — from the tuning surface
  entirely (they stop existing in code, not just in the panel). The panel gains: operator
  params (`DR_MAG`, `L_THRESH`, desaturation), the exposure + instrument
  + mean-luminance readouts, and `LUMA_CEIL`. `uGlowMagOffset` survives as a *calibration
  constant* set by H7, debug-visible but not a user knob.
- **§ 3 splits four ways, and the order is forced.** *All four shipped.*
  H15 (instrument
  epoch replaces the presets, `uMaxAppMag` → `uLimitMag`, filter deleted)
  → H16 (FOV-derived K) → H17 (adaptation) → H18 (EV trim). H16 precedes
  H17 because it changes the `Ω_px` and footprint scale H17's statistic
  is computed against; H18 follows H17 because a trim needs an automatic
  term to trim. H15 is the only one that is independently shippable —
  the others each leave a visible gap until the next lands.
- **Deliverable placement:** this doc (cross-cutting) + a
  `src/client/hdr/README.md` from H2 for RT/pass implementation detail.
  The K derivation belongs to
  `docs/science-stellar-modelling.md` § Stellar perception model, which
  already owns σ and the √Δm curve; § 3.3 states the rule and points
  there.

## Out of scope

Instrument *presets* (§ 3.4 mandates the record shape and names the three
axes; the presets themselves are a future epic) · veiling glare (§ 3.2 —
own bead, deferred) · Display-P3 output (zsr.2 — plugs into the § 2
encode) · BC_photopic (a7d.2.10 — substitutes into `L(m)` when it lands)
· time-domain adaptation dynamics (§ 3.1 is deliberately instantaneous:
no light/dark-adapt time constants, no feedback loop) · scotopic/mesopic
eye modelling (rod spatial summation can't be reproduced on a display;
`DR_MAG` absorbs the compression) · bloom/lens-flare post effects (the
existing PSF footprint is the bloom).
