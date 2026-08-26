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
| MW band, brightest sightline (S = 22.01 mag/″², Ω_sum) | 7.81 = `m_lim` by construction | 0.0199 | 0.149 → reads as a threshold star (§ Extended sources) |
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

### Extended sources — the second threshold

`L_THRESH` anchors a **point** source. An extended source mapped at its
raw per-pixel flux inherits no anchor at all, and the gap is not small:
at the shipped instrument and 900 px / 50°, the band toward the Galactic
centre rendered **1/23 of a threshold star** while a rod-summation patch
of it sits 2.3 mag **above** the same limit. The ordering was inverted.

The eye does not detect an extended source pixel by pixel. Rods sum over
a critical area (Ricco), so for a source larger than that area threshold
is a **surface brightness**, and the anchor is its own constant:

```
S_thresh = instrument.skyBackgroundMagArcsec2          (22.0, unaided eye)
Ω_sum    = 10^(0.4·(S_thresh − m_lim))                 = 4.7863e5 arcsec²
L_px     = uExposure · 10^(−0.4·S) · Ω_sum
```

so `Ω_sum` stands in for `Ω_px` on the display path and a source at
`S_thresh` lands on `L_THRESH` exactly, as a point source at `m_lim`
does. `rodSummationSolidAngleArcsec2` owns the pair.

**Why the threshold is the sky background.** An extended source is
detected as a *contrast* against the sky it sits in, and threshold
contrast for a large, soft, scotopic target is of order unity — so the
background level *is* the threshold surface brightness to the precision
this concession claims. That makes it an instrument property with no free
parameter, and it puts the `skyBackgroundMagArcsec2` axis (§ 3.4) to
work: a light-polluted preset loses the band while keeping its stars,
which is what a city sky does.

**The consistency check that makes it a summation area rather than a
fudge.** 22.0 against `m_lim` 7.8 implies a **13.0 arcmin** critical
diameter — inside the range measured for scotopic Ricco summation at a
non-zero background, and correctly smaller than the ~30–60′ quoted at
absolute darkness, since the critical area shrinks as background
luminance rises. Two independent constraints landing together is the
whole case; neither number was chosen to hit the other.

*Rejected: the absolute-flux form of the same model* — take a 1° patch
(the figure this bug was first measured with) and threshold on summed
flux alone. That gives `S_thresh` = 25.6 and 6.3 mag of lift at the
reference viewport, and it renders the NGP diffuse component at 0.19 of
full scale: a visible fog over the whole sky. It is the right criterion
against a *black* background, and Stellata's background is black only
because the airglow / zodiacal / unresolved terms are not drawn — the
very light `m_lim` = 7.8 was measured against. Thresholding on absolute
flux therefore double-counts them.

**This makes an extended source FOV-invariant, and that reverses § 3.3's
point 2 for the display path.** Per-pixel flux still falls as FOV²; what
does not is the flux the *retina* sums, because its summation area is
fixed in angle and a screen degree now covers less sky. The simulated
observer detects the band identically at any plate scale, so the rendered
level must not move. § 3.3's quadratic dimming survives as the
photographic statement and as the statistic's behaviour.

**It is not per-layer exposure** (§ 3.2's rejection). The distinction is
point-vs-extended — a property of the source's angular extent, which the
unit already branches on (`stellataPointSourcePeak` vs
`stellataSurfaceBrightnessLuminance`) — and it moves a *threshold anchor*,
not `uExposure` and not the operator, both of which stay global.

**Uniformity is a per-FRAGMENT property, so the substitution is a
convolution rather than a gain.** `10^(−0.4·S)·Ω_sum` is the flux in the
summation area only for a source **uniform across it**. The band from Sol is
the only emitter that qualifies everywhere, so what ships is
*average-then-gain*: the diffuse emitters write their `Ω_sum`-gained value to
its own render-target attachment and the resolve takes the mean over the
patch before compositing. Averaging first makes the assumption true by
construction, so **both volumetric emitters take the same anchor**, both are
FOV-invariant, and the resolution loss the eye applies comes along —
naked-eye M31 is a smudge, which a gain cannot reproduce.
`src/client/hdr/summation/README.md` is the implementation.

- **The ideal has no free parameter**, which is what makes every figure below
  an absolute error rather than a comparison with previous behaviour:
  `10^(−0.4·S̄)·Ω_sum` over the patch *is* the patch flux, so the reference
  needs only an integral of the published profile.
- **What a per-layer answer cost, and why neither choice was right.** Reusing
  the band's gain on M31 over-lifts the nucleus **3.95 mag**; the pixel solid
  angle under-lifts the envelope by the full **2.695 mag** the band gained,
  and the crossover between them sits at **3.6′** — inside which the profile
  is not uniform over 13.0′, outside which it is, to better than 0.02 mag.
  The flux-conservation form of the first: at its central surface brightness
  (15.30) one patch would claim 1.10 mag, **2.34 mag more than the whole
  galaxy's 3.44**. All of it pinned in
  `local-group-emission-calibration.test.ts`.
- **The seam was visible from Sol at the default view, not only from
  outside.** M31 sits at b = −21.6°, where the band's own diffuse component
  is 24.20 mag/arcsec² and renders 8.6/255 — while an M31 isophote at that
  same surface brightness rendered 0.7/255, a factor of 12 the wrong way,
  with the two overlapping on screen. The FOV response split too: the band
  held its level while every LG object dimmed quadratically.
- **A convolution can only average what the rasteriser sampled**, and a
  raymarch point-samples its profile at the pixel centre — so an aliased
  Sérsic cusp survives it intact. Both emitters therefore smooth their
  profile radius over one pixel's transverse footprint, `ε = s·d/√12`,
  matched on the second moment of a square pixel. No free parameter there
  either, and it tracks the exact area average to 0.1 mag across the whole
  FOV range.
- **What it delivers**, against that ideal: M31's nucleus **0.03–0.18 mag
  faint** at every reachable FOV (positive throughout — the core is never
  brighter than ideal), the smooth envelope inside **0.08 mag**, and the
  band's shipped display table from Sol unmoved, because a normalised kernel
  is an identity on a uniform field and the footprint is metres against a
  300 pc scale height from inside the disc.
- *Rejected: a per-fragment `fwidth(S)` cap on the effective summation
  area*, which was the cheap alternative to the pass. The over-count is
  driven by **curvature** and `fwidth` is a first derivative, so at the
  nucleus — profile flat, error worst — the cap does not bind at all and
  leaves the full 3.95 mag. Everywhere else it over-corrects, landing
  1.75–2.79 mag *fainter* than ideal across 0.5–6.5′, worse than not
  capping. Measured and pinned alongside the errors above.
- *Rejected: a separable Gaussian of matched σ.* The kernel is Ricco's flat
  patch, and a Gaussian is a different operator rather than a cheap
  approximation to it — 0.43 mag off at 10° FOV, and still 0.30 mag off when
  the patch spans 97 px, so it does not converge as the plate scale
  resolves. That is what forces a non-separable kernel, and therefore the
  resolution-adaptive downsample that keeps its tap count bounded.
- **The convolution is not spatially-varying tone mapping** (§ 3.2 rejects
  that by rule). It redistributes light on the **emission** side, upstream of
  a global operator, exactly as veiling glare will; the operator still reads
  one pixel's luminance and one scene-wide scalar.
- **Off-target there is no attachment and no pass**, so the anchor goes away
  for both emitters rather than one keeping a private fallback — the
  concession *is* the pass. That is the float-RT fallback (§ 6) and the
  chart mode, where the band returns to its per-pixel level.
- **Everything that dims the emission has to move with it.** Giving the
  diffuse emitters their own attachment takes them out of the chain that
  anything drawn in front of them composites against, and the depth-test
  argument for staying in one framebuffer says nothing about **blend** order.
  The rule the enumeration has to be derived from, rather than a list of the
  layers that came to mind: **a draw dims the diffuse field iff its blend's
  destination factor is not `One`**, so every such draw ordered after the
  emitters opens attachment 2 and writes black at its own alpha. Depth cannot
  stand in for it — the emitters draw first and the resolve adds attachment 2
  unconditionally, so an opaque body drawn later cannot subtract itself by
  writing depth. Additive and max blends are exempt: neither attenuates.
  Three consumers, and each is part of this design rather than a detail of it:
  - *Molecular-cloud absorption* is a multiply drawn after the band
    (`renderOrder` −2 against −3), so it opens attachment 2 as well and writes
    the same alpha-only texel to both — one blend equation covers every
    attachment, so it is a gate flag, not a second draw. Extinction therefore
    lands **before** the convolution, which is the physical order: light is
    absorbed in interstellar space, and the eye sums what survives. It is the
    only *interstellar* absorber in the scene; a future one takes the same mark
    (`src/client/hdr/attachments/README.md` § The gate).
  - *Every close-range surface in front of the band* — the planet mesh, the
    ring annulus, the atmosphere shell, all alpha-composited in the local
    depth pass. They emit and attenuate, so they open all three attachments.
    Their own occlusion contracts already said so and were silently void
    without this: an atmosphere shell is premultiplied-over specifically so a
    dense limb chord that scatters no light still extincts what is behind it,
    and a ring annulus dims a source behind it because no z-test could. Both
    claims are about the whole background, and the band had left it.
  - *The canvas alpha.* The resolve carried it through from attachment 0,
    which a diffuse fragment now leaves at the clear's zero while its rgb is
    the entire band. A premultiplied canvas composites `rgb > a` as nothing,
    so the band and M31 rendered black. The resolve is the whole frame and
    owns that channel: it writes alpha 1.

**The concession is absent from the statistic.** Attachment 1 keeps
`Ω_px` in both channels, and unconvolved: the adaptation model reads retinal
illuminance, and inflating a band pixel 12× there would let the display
concession drive the exposure cut. A normalised convolution conserves total
flux anyway, so the mean the reduction takes would barely move — the reason
to keep it out is the unit, not the size of the error.
`src/client/hdr/attachments/README.md` carries the headroom measurement.

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

**Luminance-domain extended Reinhard, hue-preserving, with a faint-end
detection toe:**

```
Y   = dot(rgb, LUMA_WEIGHTS)            // Rec.709 luminance
m   = −2.5·log10(Y/L_THRESH)            // magnitudes under threshold
Yt  = Y < L_THRESH ? L_THRESH · 10^(−0.4·(m + TOE_CURVATURE·m²)) : Y
Yd  = Yt · (1 + Yt/Lw²) / (1 + Yt)
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
- **The faint-end toe makes the threshold mean what it says.** Extended
  Reinhard is near-linear at small `Y` and the sRGB encode then lifts it,
  so sub-threshold light rendered at its linear value reads plainly on a
  dark screen — a patch 1.49 mag *under* the extended-source detection
  threshold rendered at 15.6/255. Physically you don't see that residual
  because it sits under a luminous natural sky background; Stellata
  renders a black sky, so the operator carries the detection rolloff
  instead: identity at and above `L_THRESH` (every anchor holds), and a
  toe below it that **leaves the knee at slope 1 (C1)** — `m` magnitudes
  under threshold display as `m + TOE_CURVATURE·m²` under it.
  `TOE_CURVATURE` is derived, not tuned: a source exactly
  **`TOE_BLACK_MAG` = 1.5 mag** under threshold lands on half an
  8-bit output step, the level the encode cannot distinguish from black.
  The first cut was a fixed-exponent power with the same endpoints, and
  its slope-3.5 kink at the knee projected a visible isophote onto every
  smooth gradient crossing threshold — molecular clouds silhouetted as
  hard-edged blots, and EV trims sweeping visible bands across the sky
  as isophotes crossed the contour. Detection near threshold is a
  graded probability (a frequency-of-seeing curve ~0.5 mag wide), not a
  cliff; slope 1 at the knee is the display transfer's rendering of
  that. Exactly invertible (quadratic formula in log-luminance), and
  the chrome mapping composes the inverse. The rejected alternative was rendering the sky background as
  a real luminance pedestal — more honest (threshold becomes a
  consequence), but it lifts the whole frame's black level and feeds the
  full-frame pedestal into the adaptation statistic and chart mode; the
  toe expresses the same detection claim in the display transfer, where
  the display's own floor is already a concession. Sub-threshold *stars*
  cross the toe too, on top of their emission-side taper — the visible
  faint edge tightens rather than moves, since the taper already ends
  0.5 mag past threshold.
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
- `DR_MAG`, the desaturation strength and the exposure readout are live on
  the debug panel (*shipped in H8*). `L_THRESH` is a **readout** there and
  stays baked: it is the unit's own anchor, so a live one would move every
  layer's calibration with it (`src/client/hdr/exposure/README.md`
  § Debug panel).

The operator implementation lives in a **shared GLSL chunk**
(`src/client/hdr/tonemap/tonemap.glsl`, exported alongside a test-pinned pure
TS mirror) consumed by both the fullscreen pass and the no-float-RT
fallback (§ 6) — the `dust-raymarch.glsl` two-consumers pattern.

**The dither is not part of the operator for an overlapping emitter.**
It is a function of `fragCoord` alone, so N additively-blended fragments
on one pixel add the same offset N times — a coherent bias over dense
fields, not noise that cancels. H3 split `stellataTonemapUndithered`
out for emitters that overlap; the resolve and any single-coverage
volume keep the dithered call.

**Stacked emitters only composite exactly on-target.** Off-target each
fragment runs the operator before the additive blend sums them, and the
operator is not additive, so a pixel covered by N fragments does not
resolve to the same value either way. This has always been true of the
Milky Way band, whose disc and bulge proxies overlap toward the Galactic
centre, and of M31's two components — but § 1's summation gain raised the
band's per-fragment `L` about 12×, which moves those fragments to a
steeper part of the curve and widens the gap. It is a property of chart mode
and the no-float-RT fallback, not of the shipped path, where the operator
runs once at the resolve.

## 3. Exposure model — instrument, adaptation, and the EV trim

*Shipped in H15–H18, replacing H6's "the magnitude slider is the single
exposure control". `exposureForMagLimit` survives in
`src/client/hdr/exposure/exposure-epoch.ts`; `InstrumentEpoch` and its
multiplier pair do not (§ 3.4).*

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
no adaptation delay, and presumed to have scanned the whole field. So the
*measurement* is a function of frame content with no time constant and no
dependence on which object is focused.

**The scan is a claim about the measurement, never a licence to composite
fixations into one frame** — the distinction § 3.2 turns on, and the reason
this premise coexists with a strictly global operator.

**The applied cut does carry a time constant, and it is not a claim about
the eye.** `dm` is slew-limited by a one-pole filter at 300 ms before it
reaches `uExposure`. The reason is that the statistic is genuinely
discontinuous in places the observer model has nothing to say about: a
body crossing the frame edge, an occluder clearing, a resolved surface
crossing the coverage ramp. Filtering the applied value
rather than the measurement keeps the model's claim intact — the
measurement is still instantaneous best-case — while stopping a
one-frame geometry change from reading as a flash. Warp bypasses it,
since the camera is somewhere else by the next frame.

**The statistic is the area-weighted mean linear luminance over the
viewport** — retinal illuminance across the attended region:

```
L̄       = Σᵢ (Lᵢ · Aᵢ) / A_viewport
dm_eye  = min(0, −2.5 · log10(max(1, L̄ / L_ADAPT)))
```

This section derives `dm_eye`, the **perception branch** — the scene
measurement. What the frame applies is the display model's composition
(§ 3.2's subsections *The resolved-surface pin* and *The display floor*):
where a lit resolved surface covers `f_ref` or more of the frame the pin
governs, everywhere under `f_ref/8` `dm_eye` applies bounded below by the
floor, and a smoothstep over log coverage joins the two. Neither term
carries a perceptual claim, and nothing below changes: the measurement
stays scene-referred and instantaneous.

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

**A source hidden behind a nearer body is not in the frame, and neither
is one the model cannot represent.** Both are the same defect, and both
are why the statistic is now a **reduction over what the frame drew**
rather than a walk over a per-source model. Occlusion went first: coverage
alone counted a body's flux whether or not anything was in front of it, so
Sol behind the night side of Saturn still dimmed the star field. Emission
followed: a body's sample carried reflected host light through the Mallama
phase curve and nothing else, so a backlit Titan's forward-scattered Mie
ring — of order the host's irradiance, against the ~1e-4 the sample
reported — was **~11 magnitudes** of light the exposure never knew about.
Ring annuli, the skylight term and every future emitter had the same hole.

The frame already contains all of it. Mechanism, units, latency and the
clamp argument are `src/client/hdr/exposure/reduction/README.md`; what
writes the measured attachment, and why the display target cannot be
measured directly, is `src/client/hdr/attachments/README.md`. Four
properties of the statistic itself:

- **The eclipse dim needs no separate slot.** It is light the body never
  received, so it is already in the pixels the body drew — as is every
  camera-path loss, because a surface that overwrote a source's pixels
  overwrote its statistic texels.
- **The emitter set is whatever rasterised**, not a list the statistic
  maintains — an oblate limb at its true polar radius, a moon in transit,
  an airlight ring, a translucent annulus. Mirroring any of that on the
  CPU is the shape that keeps drifting from the shader it mirrors.
- **Frame clipping is automatic.** A source off the edge writes no texels,
  and one half in frame writes half, so the frustum-edge ramp the walk
  needed a 12 px constant for falls out of the rasteriser.
- **Rings and airlight DO extinguish and DO emit**, by the same alpha they
  composite with. This **reverses** the position held through v3.7.0, that
  rings never dim a source behind them.

Why an area-weighted arithmetic mean, and not the two obvious
alternatives:

- **Not a log-average** (the standard Reinhard key). On a sky that is
  99.9% black the log-average sits at the floor, `dm` pins at 0, and a
  resolved planet stays blown out — it fails the exact case the
  mechanism exists for.
- **Not a maximum or a high percentile.** One bright pixel would crater
  the frame: Sirius in view would dim the star field around it. This
  objection killed the highlight guard too, one shipped version late — a
  frame `max` is exactly a maximum statistic, and § 3.2 records what it
  cost. What replaces it is a second *mean*, restricted to lit resolved
  surfaces, which inherits none of the objection.
- **The discriminator is angular extent, not luminance.** Venus filling
  the frame adapts the eye; Sirius as a point does not. Area weighting
  *is* that discriminator, and it is what pupil response physically
  integrates.

Contributions on a 1920×1080 viewport at the unaided eye's 50° FOV, so
`uExposure` = 26.365 and `Ω_px` = 27 778 arcsec². Every row is pinned in
`src/client/hdr/exposure/scene-adaptation-pure.test.ts` from exactly
these inputs:

| in frame | contribution to `L̄` |
| --- | --- |
| resolved Venus filling 20% of the frame (`S₀` = +0.78, so `L_surf` 3.6e5) | 7.1e4 |
| Sol's disc at 1 AU (m −26.74; 0.53° = 11.4 px across, 103 px² of 2.07e6) | 6.3e5 |
| the frame's share of 100 000 threshold-magnitude stars, 1 px each | 1.0e-4 |
| Milky Way band at 23.47 mag/arcsec² over the full frame | 3.0e-4 |
| Venus unresolved from Earth (m −4.4, on the 1 px floor) | 7.3e-4 |

**The two aggregate rows are per-frame, and an earlier draft of this
table had them whole-sky.** The statistic is a mean over *this frame's*
pixels, so a whole-sky star count belongs in it only through the fraction
of the sphere the frame covers — 10.8% at 50° on a 16:9 viewport, so
100 000 threshold stars contribute 1.0e-4 rather than 9.6e-4. The band's
surface brightness is the anticentre-plane figure the Milky Way layer's
own gradient derives (`src/client/milkyway/calibration/README.md`), not a
round 22:
the band is what a frame pointed at it actually contains, and the layer is
the authority on how bright that is. The test reads it out of the layer
rather than copying it, because it has moved twice — 22.55 under the
retired 20.0 anchor, 23.47 once the dust was normalised. The diffuse field
is therefore **Milky-Way-dominated by 2.9×**, where the earliest rows had
the two within 25% of each other.

Nearly eight decades separate the cases that must adapt from the cases
that must not, and the aggregate field sits **two** decades below
`L_ADAPT` — not four as that same draft had it. The margin is ample
either way: `dm` is exactly 0 for any `L̄ ≤ L_ADAPT`, so the diffuse term
can never produce a cut on its own.

**Frustum-edge continuity is free for a resolved source.** A source
sliding into frame contributes in proportion to its covered pixels, which
ramps continuously from zero, and coverage of a disc crossing a straight
frustum edge is smooth. No radial taper, no centre weighting. (An earlier
draft proposed a fovea-like radial weight; the coverage term already does
its job, and a camera-centred weight would also re-introduce the gaze
dependence the scanned-observer premise rejects.)

**It is not free for a point, and that is what needed a constant.** A
sub-pixel source's own footprint is 1.1 px across, so its clipping
fraction runs 0 → 1 inside a single frame's worth of camera jitter and a
bright star parked on the frame edge flickers the whole exposure. The fix
is to evaluate the clipping against a disc floored at
`ADAPT_EDGE_RAMP_PX` (12 px) across: the fraction is still exactly 1 well
inside the frame and 0 well outside it, so the floor sets only how wide
the crossing band is. **Deliberately not hysteresis** — a threshold pair
with per-source state would need a store keyed on identity across frames,
would still step (twice, at two positions), and would make the statistic
depend on which direction the camera arrived from. The cost is that a
source up to 6 px outside the frame contributes a little of its flux,
which is the honest reading of "partly in frame" at that scale.

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
L_ADAPT = L_TARGET · f_ref
```

**`f_ref` — the reference coverage — was the honest remaining choice, and
smoke settled it: it is the park coverage.** A focused body parks filling
`PLANET_PARK_FILL_FRACTION` (0.3) of the viewport's *minor* axis, so its
disc covers `π·0.15²·min(w,h)²/(w·h)` — **6.85%** on the calibration
viewport (1280×1320, portrait, so the minor axis is the width). Landing
the measured `L_TARGET` on the framing a body is actually *seen* in is
what makes the trim a correction rather than a standing offset, and it
retires the earlier mid-band guess of 0.15. Ship `L_ADAPT` = **0.061**.

Two consequences worth stating rather than discovering:

- **The park framing IS where the pin takes over**, and the two branches
  agree there exactly — `L_ADAPT = L_TARGET · f_ref` is that identity read
  the other way. So `f_ref` sets both the level at park and the top of the
  coverage ramp, and the ramp closes with no step of its own. (Through
  v3.3 the guard governed at park instead, at `L_CAP` — 0.43 stops over
  `L_TARGET` on a smooth sphere, and 1.2 to 3.5 mag over on a textured
  one, which is the defect § 3.2 records.)
- **The anchor no longer costs anything to lower.** It set the star
  walk's camera window, and dropping it 0.85 mag roughly tripled the
  squared-distance tests that walk ran. A frame reduction has no window:
  every drawn star is already in the buffer.

`f_ref` and `L̄` are on the debug panel, alongside the measured coverage,
the `D` they divide to, all three branch terms, the ramp weight and which
of them governs (*shipped in H8*).

Two rows from the same pass bound the other end, and both are consistent
with the model rather than with a tuning error: Saturn at `L` = 0.259 and
Pluto at 0.148 were judged acceptable but were not independently optimised
(Saturn shared Jupiter's slider setting), and Mercury / Venus / Earth /
Mars all remained over the white point even at the slider's floor — the
8.5 magnitudes of cut it offers is short of the ~10.5 Venus needs, which is
precisely the gap automatic adaptation exists to close.

**Measure the rendered frame — and not the display target.** An earlier
draft of this section argued for a CPU walk on the grounds that a GPU
mip-reduce would read `LUMA_CEIL`-clamped emission and understate a
resolved Venus by 38× exactly when adaptation matters most. That objection
dissolves under the base-exposure division below: the target is rendered
*with* the live cut, so at a settled `dm` nothing is near the ceiling, and
on the transient the clamp makes the measurement a **lower bound** — the
loop converges from above, bounded at 8.4 magnitudes of cut per
measurement, so Sol from wide open settles in two frames.

Two objections that do *not* dissolve, and that is why the reduction runs
over a **second, physical-luminance attachment** rather than over the
display target:

- **The display kernel preserves peak, not energy.** A star's quad is the
  K-exaggerated `max(appSize, physSize)`, so a mean over the display
  target over-counts a threshold star's flux by 1.96× and a
  knee-saturated bright one by 28.9× (+3.7 mag) — on the branch that
  governs, and scaling with a debug legibility slider.
- **Chrome renders into the same target.** Grids, coordinate spheres,
  boundaries and orbit rings carry authored colours inverse-mapped through
  the operator; counting them as scene light would make switching on the
  equatorial sphere darken the frame by ~0.3 mag.

So attachment 1 is RG16F, written by physical emitters only — flux-correct
luminance in R, and the lit-resolved-surface mask in G — and gated per
draw so chrome is excluded by construction rather than by patching every
chrome call site. `src/client/hdr/attachments/README.md` is the contract.
G carried peak-correct luminance for one shipped version; § 3.2 is where
that channel changed hands.

**The diffuse-field constant retires with the walk.** Its two rows were
the frame's share of the threshold-star population and the Milky Way band,
and the frame now draws both. What is genuinely left — the sub-threshold
population — is what the Milky Way layer's volumetric raymarch integrates
by construction, so a constant for it would double-count. It was two
decades under the anchor and could never produce a cut, so dropping it
changes nothing observable.

**What is given up: per-source attribution.** A mean over pixels has no
dominant source to name, so the EV readout's "adapted to X" clause goes
with the walk. Deliberate, and the trade for seeing every emitter — the
walk could name a source only because it could not see most of the light.

The statistic is still measured at the **base instrument exposure**, never
the live scalar it then writes: feeding the adapted, trimmed value back in
would close a loop, and would make +3 stops of trim provoke a compensating
cut. The target is rendered with the live scalar, so the reduction divides
it back out — the one genuinely new trap in a buffer measurement.

### 3.2 What the model does and does not fix

Adaptation is driven by **coverage**; correct exposure depends on
**surface brightness**. On the perception branch alone the two meet only
over a band of coverages:

- A body's adapted disc mean is `L_ADAPT / f`, so it lands on `L_TARGET`
  exactly at `f_ref` and drifts by the coverage ratio away from it.
- At 2% of frame it sits ~1.4 mag over and stays a small brilliant
  clipped dot. That is the right answer; a brilliant dot should read as
  a brilliant dot.
- The trim buys back `log2(f_ref/f)` stops, so ±3 stops covers coverages
  from **0.86% of the frame upward** — a factor 8 either side of `f_ref`,
  not the 4%–55% band an earlier draft quoted (that was 2.26 read as
  stops rather than magnitudes). Pinned in
  `scene-adaptation-pure.test.ts`.
- **The display floor narrows that claim to surfaces the floor never
  binds on.** A surface bright enough to need more than the floor's
  6.29 mag (Venus-class, ~3.6e5) settles far over the white point below
  `f_ref/8`, needing ~6 stops against the 3 the trim has — a brilliant
  dot reads as a brilliant dot, and parking it is what exposes it.

**Above `f_ref / 8` the drift stops being a drift and becomes a hard
ceiling, which the perception branch cannot fix at all** — that is what the
resolved-surface pin below is for, and the ramp between `f_ref/8` and
`f_ref` is where the two hand over. Everything in this list describes the
perception branch in isolation, and it is what still happens *under* the
ramp's foot.

**A host star's photosphere never takes the pin, at any distance.** It is
drawn by the point-source kernel, which writes no lit-surface mask, so Sol
stays on the perception branch even filling the frame — clipped white,
bounded by the floor. Deliberate and consistent with the paragraph below:
the pin protects *resolved surfaces*, and the affordance for looking at a
star is an instrument, not adaptation.

**Adaptation does not subsume a solar filter.** Sol at 1 AU subtends
0.53° — 103 px of 2.07e6 — so `L̄` = 6.3e5 *measures* −17.5 mag, the
display floor caps what applies at −6.29, and the disc's own −10.59
mag/arcsec² surface needs −22.0 to fall under the white point: **13.5 mag
short** even with the trim floored. The Sun stays clipped white unless
the camera is close enough to fill the frame. Phenomenologically that is
correct: you cannot resolve granulation with an unaided eye at 1 AU. The
affordance that fixes it is **an instrument** — the neutral-density
solar-filter exposure is a deep fixed cut, not adaptation.

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
  thing that *would* show 17 magnitudes at once, and it is the cinematic
  HDR-photograph look. The reason it is out is **structural**, not the
  claim that "nothing in the physical chain does it — not the eye at an
  instant": that reason contradicted § 3.1's scanning observer, since a
  fovea re-adapting per fixation is exactly a locally-tone-mapped
  percept. That contradiction is settled here rather than left open, and
  the conclusion survives it. Five findings, in the order they bind.

  **The scanning observer stands, in both sections.** § 3.1's premise is
  not weakened, and this section no longer contests it: averaging over
  every fixation is what *makes* an unweighted statistic the right one, so
  the scan is the reason there is no radial term. What the scan does not
  license is presenting its union as one instant. A locally-tone-mapped
  frame is a composite of many fixations — bright detail from fixation N
  beside faint detail from fixation M — and no observer, scanning or
  otherwise, ever perceives that composite. § 2's `DR_MAG` pin already
  says so: the eye's range is achieved over time *and across the retina*,
  never simultaneously in one glance.

  **The scan is the user's, and it is already live.** Stellata is not a
  still photograph. The user's own fovea scans their own monitor, and the
  camera moves — so per-fixation re-adaptation is already in the build,
  indexed by **framing** rather than by screen position: approach a bright
  body, its coverage rises, `dm` cuts, and the detail appears. § 3.1's
  coverage statistic *is* that mechanism, and it is physically honest
  because a real observer moving closer also gains coverage. Framing is
  stellata's fixation. A local operator would run the scan on the user's
  behalf and bake the result, double-counting what interactivity already
  supplies.

  **The accepted cost, stated rather than discovered:** simultaneous
  detail in a bright region and a faint one, in one frame, from a
  stationary camera. That is real, it is what the opening observation was
  about, and the answer to it is the camera and the trim rather than the
  operator. It is also the one case the resolved-surface pin patches — for
  the dominant surface only.

  **The rule that replaces the discarded reason: spatial variation is
  permitted upstream of the operator, where it moves light, and forbidden
  inside it, where it moves the mapping.** Rod summation (§ 1) and veiling
  glare (below) both convolve the luminance *field* — they change what
  reaches a pixel, they are real light redistributed in the optics, and the
  operator downstream of them is still one function of one luminance.
  Local tone mapping changes the *transfer function* per pixel, so the
  same luminance means different display values at different screen
  positions — which is exactly the cross-layer comparability this seam
  exists to establish. Per-layer and per-object exposure fall to the same
  clause one level up, which is why they need no separate argument.

  **And it is structurally incompatible with `chrome/` — a harder blocker
  than anything above.** `inverseTonemapConstant` bakes the inverse at
  material set-time against a scene-wide white point
  (`src/client/hdr/chrome/README.md`). A per-pixel mapping cannot be
  inverted at set-time: the local field is not known until the frame is
  drawn, and chrome draws into that same target, so the field a chrome
  fragment inverts against would depend on chrome itself. Deriving the
  neighbourhood from the chrome-excluded statistic attachment breaks the
  circularity but not the set-time bake. Shipping a local operator
  therefore means moving every chrome layer into a pass composited *after*
  the resolve, losing the depth test against the scene that is the reason
  those layers render into the target at all. That is the price, and no
  operator change alone pays it.

  **Revisiting it.** If it ever ships, it ships as a **display
  concession** in the resolved-surface pin's sense — never as a perceptual
  claim — and owes the same accounting: which display limit it works
  around, what it costs, and a name for what it exaggerates. The bar is
  the three constraints above: analytic invertibility for `chrome/` (or
  the composite-after pass and its depth cost), no camera-centred term
  (§ 3.1's gaze dependence), and no per-object or per-layer branch.
- **Veiling glare is in scope later, on the permitted side of that
  rule** — ocular scatter is real light, convolved upstream of the
  operator on the emission side. It is the mechanism that makes a bright
  source destroy *nearby* faint detail — which a single global scalar
  cannot express. Standard model: the Vos & van den Berg glare-spread
  function (CIE 135/1, valid 0.1°–100°); the simple form is
  Stiles–Holladay, `L_veil ≈ 10·E/θ²` with θ in degrees. Deferred to
  its own bead, but the seam it needs is now built and load-bearing: rod
  summation convolves the diffuse attachment upstream of the operator
  (§ 1, *Extended sources*), and a glare kernel is the same pass over a
  different radius.

**Apply compensation at emission, never at the resolve.** `uExposure`
already multiplies at emission and `LUMA_CEIL` clamps there, so a lower
exposure yields a lower pre-clamp value and the ceiling is harmless.
Resolve-side gain would make that clamp lossy *and* would scale the
pre-inverse-mapped chrome colours (`src/client/hdr/chrome/README.md`).

**A limiting-magnitude readout is mandatory**, distinct from any slider
value. Without it, a star field correctly vanishing reads as a bug. The
EV row carries it: *"0 EV · stars to m 1.2"*, where the magnitude is
`uThresholdMag + dm` — the one place adaptation is allowed to move a
magnitude. It once also named the source carrying most of the frame's
flux; a frame-wide reduction has no per-source attribution to name, so
that clause retired with the walk (§ 3.1).

#### The resolved-surface pin — a display concession, not a perceptual claim

Everything above this point in § 3 is a claim about an observer. This one
is not, and it is the first thing in the pipeline that isn't:

> We optimise for the dynamic range the monitor can output, and at the top
> of that range — where optimising for the ideal range would clip — we
> limit saturation. It is not accurate: it really would be much brighter.
> But we can't show that on a monitor, so we show what you can perceive
> without blowing it out.

**This is the bounded, scalar form of what a local operator would do, and
that is why accepting it is not the loophole § 3.2 warns about.** One
scene-wide number protects the dominant surface's level, so the pin cannot
invent a gradient the luminance field does not have, cannot reveal detail
that field does not carry, stays analytically invertible for `chrome/`, and
names its own cost below. A local operator's appeal is precisely the part
the pin refuses: a transfer function that varies per region. The
concession is the **pin**, not the locality.

The perception branch alone leaves a resolved surface at `L_ADAPT / f`, and
smoke measured what that costs. Retreating from Betelgeuse at EV 0, the
centre begins to saturate at a **65 px** disc and all colour is gone by
**40 px** — the display's graceful highlight band is **1.05 magnitudes
wide**, and any coverage above `f_ref` walks straight out of it.
(`perceptualDiscProfile`'s normalisation was checked clean over the same
pass — the centre is 1.0 exactly — so this is the operator's top end, not
a stray amplitude.) So:

```
D      = S̄ / f,  the lit surface's OWN mean brightness
dm_pin = −2.5·log10(D / L_TARGET),  ≤ 0
S̄      = mean over the statistic attachment of R × the lit-surface mask
f      = mean over the same frame of that mask alone
```

**What is pinned is a mean, and what makes that possible is measuring
coverage.** Two frame means divide to the surface's own brightness, free of
both how much of the frame it fills and how its texture is distributed.
"Visible" is automatic — an occluded surface's texels were overwritten and
an off-frame one wrote none — and so is phase: the mask is the lit
hemisphere, so a crescent is exposed for its crescent.

**Lit, not merely drawn, is the whole content of the mask**, and it binds
every claimer rather than the body mesh alone. `D` is a ratio, so area
counted with no light behind it is indistinguishable from the surface being
that much dimmer, and the pin obediently under-cuts. A body's night side is
the largest such region but not the only one: a ring annulus carries the
band inside the planet's shadow, and an atmosphere shell carries a
night-limb chord that is *denser* than the lit one — it occludes at full
opacity while scattering nothing toward the eye. Neither shrinks when the
lit area does, so a crescent is exactly where geometric coverage fails
worst. Each emitter therefore gates on its own illumination term
(`src/client/hdr/attachments/README.md` § The unit is the pinned table).

`L_TARGET` is the level the pin holds, and it is the **measured** 0.89 of
§ 3.1 rather than a second constant. It is the one knob smoke-tuning moves.

Three structural properties, in the sense that no refactor may lose them:

- **A body must not dim as the camera approaches it.** `D` is independent
  of coverage, so from `f_ref` to full-viewport fill the reading is
  identical — approach makes a body bigger and never darker. This is the
  binding constraint the pin exists to satisfy, and the reason a
  frame-mean pin (which reads `D · f`) cannot be the answer however the
  floor is set.
- **The handover is a pure coverage ramp, and both ends are derived.** The
  top is `f_ref` itself, where `dm_pin` and `dm_eye` agree exactly for a
  body-dominated frame — `L_ADAPT = L_TARGET · f_ref` read the other way —
  so the crossing needs no fade of its own. The foot is `f_ref/8`, the
  reach of the ±3-stop trim. Between them a smoothstep over log coverage,
  stateless, no hysteresis; `dm` is monotone in coverage, so an approach
  cannot brighten a body and then dim it again.
- **It protects surfaces, not points.** Anything drawing a kernel or a
  diffuse column writes no mask at all, so Sirius, Sol at 1 AU and the
  band cannot reach this branch at any framing. A point of light should
  read as blinding and has no detail to protect.

**What this replaced, and why the replacement was not a retune.** Through
v3.3 the concession was a **highlight guard**: `max` over a peak-correct
channel, pinned to `L_CAP` = 1.80. It was ported from a source walk that
measured each body's disc *mean* and pinned it at 1.2, and the port
converted between the two with the Lambert peak-over-mean of exactly 3/2 —
correct for a smooth untextured sphere and for nothing the model draws.
Smoke measured the real ratio at 2.25 (Venus, a featureless cloud deck) to
6.7+ (Mercury, bare cratered rock), a different value per body, so no
single `L_CAP` could expose them all. Worse, `dm_guard ≥ dm_eye` reduces to
a clean coverage threshold *only* under that same 3/2: what it actually
imposed was `5.08% × (peak-over-mean ÷ 1.5)`, so a textured body needed
13–15% coverage to take the pin where park framing supplies ~7%. **Every
parked planet therefore fell out of the pin regime into the floor-bounded
perception branch** — the regime the display-floor subsection below says
they must never reach — and Earth, Mars, Venus and Mercury rendered as flat
white discs 3.5 to 5.8 mag over-exposed. A maximum statistic also inherits
§ 3.1's own objection to maxima, one shipped version late.

**The known cost, stated rather than quietly fixed: every resolved surface
still reads the same level.** A stellar photosphere and a planet disc would
be indistinguishable in brightness — except that a photosphere is never a
resolved surface here (it draws a kernel), so the case does not arise in
the build. The smoke anchors put a star ~0.87 mag over a planet; if that
ordering is ever missed, the fallback is an incomplete-adaptation exponent
on the perception branch — `dm_eye = −2.5·k·log10(L̄/L_ADAPT)` with
`k` = 0.776 and `L_ADAPT` = 4.65e-3 fits both anchors exactly — but it
over-dims the full Moon to −5.06 against a real sky's −2.5 to −3, so it
is a fallback and not the ship. The second cost is that **in the pinned
regime the star field sits brighter than the perception model alone would
put it.** That is the display compensation doing its job, not a claim about
the observer.

This change **demotes** the operator-shoulder work from load-bearing to
optional: a longer shoulder would widen the 1.05-mag band the pin
currently works around. It does not remove the constraint that any new
curve stay analytically invertible (§ 2 / `src/client/hdr/chrome/README.md`).

#### The display floor — the bleaching the display cannot cause

The guard's twin at the other end of the range, and the same species of
concession: the observer is looking at a monitor emitting a couple of
hundred nits, so the retinal stimulus a scene-referred cut simulates is
never delivered. Applying the full physical cut dims the star field
twice — once because the display cannot render the bright source at its
true luminance, and again because the model assumes it did.

The bound is derived, not tuned: the strongest stimulus any displayed
frame can deliver is every pixel at the white point, and the perception
branch's own response to that frame is

```
ADAPT_DISPLAY_FLOOR_DM = −2.5·log10(L_w / L_ADAPT) = −6.29 mag
```

No displayed frame justifies a deeper cut, so the perception branch
applies `max(dm_eye, floor)`. Three consequences:

- **Sol at 1 AU keeps washing the frame out, but boundedly.** The
  measurement is still −17.5; the applied cut is −6.29, leaving the
  field's effective limit at m 1.51 — a handful of Sirius-class stars
  against a clipped disc, where the unbounded cut left nothing. The
  full physical wash-out is veiling glare's to model (its own bead),
  as real light in the optics rather than a retinal state.
- **The pinned regime is untouched.** A dominant lit surface (coverage at
  or over `f_ref`) takes the pin however deep — a parked Venus needs
  14.0 mag and gets it. The floor bounds the perception branch, never the
  pin, and the coverage ramp joins the two so a body drifting through
  cannot step the frame. The invariant is therefore **the floor bounds
  every frame the pin does not govern**, not the walk-era
  `dm ≥ max(dm_eye, dm_guard)`: nothing that writes no mask can darken the
  frame past the floor, and the pin is deliberately allowed past it.
  (v3.3 stated this bullet and did not implement it — the regime test sent
  every parked planet to the floor instead. See the pin subsection above.)
- **Under the ramp's foot, a floor-bound surface saturates past the trim's
  reach.** § 3.2's trim claim narrows accordingly (bulleted above):
  brilliant dots read as brilliant dots, and parking is what exposes
  them.

A pin-derived bound (the brightest *sustained* frame, since the cut slews
a full-white one down) would be the tidier fold on paper at −3.67 mag, but
it leaves hundreds of stars visible around Sol at 1 AU — it fails the
wash-out requirement by 2.6 mag, so the white point is the anchor.

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
2. **Extended sources dim quadratically at the detector, and that is not
   what the observer sees.** `Ω_px` falls as FOV², so a marginal planet
   disc drops under the floor and the statistic's view of the Milky Way
   band fades. But the *eye's* summation area is fixed in angle, so the
   band's rendered level is FOV-invariant by construction — § 1
   (*Extended sources*) is the amendment, and it reverses this row for
   the display path only. "You cannot magnify nebulosity into visibility"
   still holds: what zooming does not buy is *detection*, and the band is
   equally detectable at 90° and 20° rather than equally invisible.
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

`TARGET_PX` is the one calibration this introduces, and **2.592 shipped**,
set by eye against the real sky in smoke. The two derived candidates both
missed: 2.16 (preserving the retired `K = 12`'s angular exaggeration at
50° / 1080 px) read slightly small, and 3.84 (preserving its rendered
pixel size on 1920×1080) clearly large. 2.592 is 1.2× the former. Note it
must be `TARGET_PX` that carries this calibration and not the debug
multiplier or `K_density`, which multiply the *floored* term and so would
hold K above 1 at every zoom — see § the floor below. Either way every
viewport converges on one size instead of scattering — ultrawides shrink
toward it, small laptops grow toward it.

**Where K floors depends on `TARGET_PX`.** `K = 1` at
`arcsec_per_px = σ/TARGET_PX`, so on a 1080-px viewport the crossover is
**3.47°** at 2.592 (4.17° at 2.16, 2.34° at 3.84). Below it the true 30″ PSF
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
sky-background luminance (`skyBackgroundMagArcsec2` — **now the
extended-source threshold surface brightness `S_lim`**, § 1; still to
land as an additive floor on `L`), and passband (no consumer yet; it
substitutes for V in `L(m)`, alongside `BC_photopic`). The presets
themselves — binoculars, telescope, filtered solar telescope,
light-polluted city, JWST — stay out of scope; only the record shape is
mandated here.

**Aperture moves `m_lim` and leaves `S_lim` where it is**, and that falls
out rather than being asserted: `Ω_sum` carries `10^(−0.4·m_lim)`, so it
shrinks by exactly the aperture gain `uExposure` adds. A deeper
instrument reaches fainter *stars* without making the band brighter,
which is the visual-instrument fact that magnification and aperture
cannot raise surface brightness past the naked eye's. Pinned in
`emission-pure.test.ts`.

## 4. Per-layer mapping — every current squash and its replacement

Physical layers (emit `L`, exposure-multiplied, pre-tone-map):

| Layer | Current squash | HDR replacement |
| --- | --- | --- |
| Star glow + disc (`star.frag.glsl`) | peak-1 profile; brightness = footprint only | `peak_L = L(m) / max(1, π·r_phys²)` × unit-peak profile (§ 1); footprint math untouched |
| Star halo (MaxEquation) + core mask | unchanged mechanisms | blend equations operate on linear L; depth rules unchanged |
| Milky Way (`milkyway.frag.glsl`) | `1 − exp(−colorAccum · 5.35e-6 · gate)`, `uGlowMagOffset` vs slider gate | *Shipped as designed (H4).* `L_px = uExposure · 10^(−0.4·m_px)` where `m_px = uGlowMagOffset − 2.5·log10(column · Ω_px)`; the display path now takes the rod summation solid angle rather than `Ω_px` (§ 1, *Extended sources*), so the band's rendered level is FOV-invariant and the statistic keeps `Ω_px`. `DEFAULT_BRIGHTNESS`, the gate, and the exp squash are deleted. The magnitude round-trip collapses to one scalar gain, so the sightline's chromaticity survives untouched. `uGlowMagOffset` carries `SB_ZERO_POINT` (26.5721), the emission unit's own constant, shared verbatim with the Local Group layer; what the band derives is each component's `density0`, solved so the two proxy volumes integrate to the Galaxy's published M_V at its V-band LIGHT B/T, dust-free so the photometric scale cannot move with the extinction (§ 8). Dust optical depth is seeded from the camera, not from each proxy mesh's own entry point, or the bulge emits through none of the 3.1 kpc Sol-to-boundary column |
| LG emission (`local-group-emission.frag.glsl`) | `uGlowMagOffset`/`uLimitMag`/`uSizeSpan` gate + `1 − exp` squash, magnitude-domain | *Shipped (gxx.8).* Same mapping as the MW band — `L_px = uExposure · 10^(−0.4·S) · Ω_px` via `stellataSurfaceBrightnessLuminance`. It keeps `Ω_px` where the band moved to the summation area: these objects are not uniform over it (§ 1, *Extended sources*). The "lands on the unit for free" prediction was **half right**: the per-pixel magnitude did carry over, but the zero point did not. `uGlowMagOffset = 11.0` was tuned, and the physical value is *derivable* — a solved column is flux per steradian, so the zero point is the magnitude of one arcsec², 26.5721. The tuned constant sat 4.1 mag hot at 50°/900 px and, carrying no Ω_px, drifted further as the camera zoomed. Two things the row did not anticipate: the population tint needed luma-normalising (it multiplies a column the solver normalised against total flux, so an un-normalised tint is a 0.42 mag error, not a hue choice), and sub-pixel proxies needed the point-source resolution floor (gxx.7). The feared "blown core on a black disc" did not materialise — `DR_MAG` 7.5 covers M31's ~8.7 mag intra-object span |
| Planet glare / billboard (`planet.vert/frag`) | peak-1 white ceiling (2f6.27) | *Shipped as designed (H5).* Identical point-source rule as stars, `m` from `planetApparentMagnitude`; `uGlareGain` since deleted (no multiplier on a physical peak). mesh↔glare continuity by construction — pinned to 1e-12 relative in `mesh-surface-pure.test.ts` |
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
Accepted — the fallback population is ~zero on real hardware, and for a
point source the result is approximately right rather than
differently-calibrated.

**§ 1's convolution ended that symmetry for diffuse sources, and took the
dev switch with it.** Off-target there is no attachment 2 and no pass, so
both volumetric emitters lose the extended-source anchor and read several
magnitudes faint. A `stellata.hdr.setEnabled(false)` switch used to park the
whole frame here for A/B, mirroring `setExtinctionPrepassEnabled`; it is
**retired**, because a path that changes the calibration is not a
compositing comparison, and shipping it as a setting invited release notes
describing a mis-calibrated scene as what older hardware gets. What remains
is a hardware verdict (`supported`) and chart mode, neither of which anyone
selects.

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
- **The seam shipped dormant through H3–H5, went live, and now has no
  switch at all.** `HDR_DEFAULT_ENABLED` was false while emitters were
  still on their old encodings — enabling it earlier would only have traded
  a correct-looking scene for a mis-calibrated one — and H5 flipped it with
  the last conversion. The constant and its setter are since **removed**
  (§ 6): once the diffuse convolution made the off-target path
  differently-calibrated rather than approximately right, leaving a way to
  select it was leaving a way to ship a wrong scene. `wantsTarget()` is
  `supported && !chart`. The render target still allocates lazily, which is
  what made the dormant period cost no VRAM and still serves chart mode and
  an unsupported context.
  **Consequence that outlives all of it:** the inline `stellata_tonemap`
  fallback (§ 6) cannot be deleted, because **chart mode** runs on it. It
  was the default path throughout H3–H5 and is still the no-float-RT path,
  so every emitter keeps both paths compiling.
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
- **MW anchor: settled, and not by re-deriving the offset.** The
  single-point `GC_BAND_REFERENCE_MAG_ARCSEC2 = 20.0` anchor this section
  scoped H7 to replace is retired, and so is the resolved-star-corrected
  NGP sightline that replaced it. `uGlowMagOffset` is now the emission
  unit's `SB_ZERO_POINT`, not the band's to set; each component's
  `density0` is solved against the Galaxy's integrated M_V.

  Two corrections this section had backwards. The anchor was ~2.9 mag
  brighter than published V surface photometry for that sightline, and the
  cause of the too-steep gradient was **not** the density profile: the
  analytic dust was an order of magnitude thin and mis-cited to a source
  publishing no per-kpc rate. And the model was never "1.17 mag too faint
  at the NGP" — Leinert's table is *total* starlight, two thirds of which
  the star pipeline already draws as individual quads, so comparing the
  diffuse layer against it double-counted the star field. Subtract the
  resolved catalogue and the pole was already right, to 0.08 mag.
  `src/client/milkyway/calibration/README.md` is the authority.

  What is genuinely left, and it is smaller than this section assumed: a
  shape change does **not** reconcile the two constraints, because the
  pole column and the integrated total are both vertical integrals — the
  thick disc moved their ratio 0.09 mag. The solve now runs on the total
  and both sightlines are graded checks, disagreeing by 1.68 mag at the
  pole and 1.02 toward the centre in the same direction
  (`docs/science-galactic-structure.md` § The luminosity solve).
  Confirming against eso0932a stretches per instrument still stands, and
  is now the arbiter between the two published scales rather than a
  confirmation of one. Run and settled — *The eso0932a arbitration*
  below: the panorama sides with the total.
- **`DR_MAG` is validated, not tuned** (§ 2): 7.5, no departure recorded.
  H7 scoped the confirmation to this panorama; the run showed the
  panorama cannot supply it either way (*The eso0932a arbitration* below,
  last paragraph), so the value rests on its own validation instead.
- Cross-layer smoke at the unaided eye: threshold stars at the
  just-visible floor; Sirius/Vega ordering *pre-clip*; Venus > Sirius;
  planet resolve-step continuity (glare↔mesh at equal `L(m)`); moon vs
  dim-surfaced parent ordering at true flux.
- **Adaptation acceptance (H17)** — the auto model must land every case
  within the trim's ±3 stops, or the trim range is wrong. That is a
  requirement on the model, not a discovery for smoke: fly to Venus,
  Mars, Jupiter and Pluto (the 9-magnitude spread) and confirm each disc
  reaches surface detail within ±3 stops of EV 0 **at park framing**.
  At or above `f_ref` (§ 3.2, 6.85% of the frame — park framing by
  construction) the pin holds every one of their disc means at `L_TARGET`
  and the case is exactly inside the trim; under the ramp's foot a surface
  the display floor binds on clips *by design* (§ 3.2, *The display floor*), so a case that
  fails is a case flown from too far out — check the disc's frame
  fraction before concluding `L_ADAPT` is wrong. The known exception is
  Sol at 1 AU, 13.5 mag out of reach by design.
- **FOV invariants (H16)** — star pixel size constant from 120° down to
  the `K = 1` crossover (3.47° on a 1080-px viewport at `TARGET_PX` 2.592),
  below which the resolved 30″ PSF makes the disc *grow*; a close pair
  merged at 50° resolving at 10°; no new star appearing at any FOV; **the
  MW band holding its level** across the whole range — the summation area
  is fixed in angle (§ 1, *Extended sources*), which replaced this row's
  earlier expectation of quadratic dimming.

### The eso0932a arbitration (H7 result)

Measured against ESO eso0932a (Brunier's 360° panorama,
`https://cdn.eso.org/images/screen/eso0932a.jpg`, 1280 × 640 plate
carrée in galactic coordinates, GC centred, l increasing leftward —
mapping verified on the LMC/SMC/Carina/Sirius positions). One panorama
pixel subtends 16.9′ at the equator, commensurate with the 13.0′ rod
summation diameter (§ 1, *Extended sources*), so a panorama pixel and
the model's display anchor average over nearly the same solid angle.
Levels below are 8-bit sRGB — the panorama is itself a display-referred
image, which is what the model's pinned levels are. Model rows are the
shipped table (`src/client/milkyway/calibration/README.md`
§ *The gradient*),
FOV-invariant by construction and computed at `DR_MAG` 7.5 through the
shipped operator (C1 toe → extended Reinhard → sRGB encode); the two
Leinert columns shift the model's `S` by the pinned disagreements
(+1.02 GC-anchored, +1.68 pole-anchored), which bracket that scale.

Scope: the Milky Way band only, at the unaided-eye instrument, base
epoch, no EV trim — the only shipping instrument (the per-preset framing
the bead opened with predates § 3.4). The panorama cannot grade star
peaks or planets: at 16.9′/px the camera PSF dilutes point sources —
first-magnitude peaks read 20–75/255, Arcturus at 22 sitting *below* the
b = 10 band at 80, nothing like the eye's view — and the LMC/SMC/M31 in
frame are the Local Group layer's validation, not this one's.

| sightline | panorama /255 | shipped | Leinert −1.02 | Leinert −1.68 |
| --- | --- | --- | --- | --- |
| b = +5, l = 0 | 75.7 | 68.4 | 42.5 | 24.9 |
| GC | 144 (174 at the px) | 40.3 | 7.6 | 0.3 |
| anticentre | 61 | 36.6 | 3.6 | 0.1 |
| b = +30, l = 0 | 15.0 | 21.9 | 0.4 | 0.0 |
| NGP | 6.0 | 0.8 | 0.0 | 0.0 |

Panorama cells are medians over 3.1° square patches (star-peak rows: max
over 2.0°; latitude strips quoted below: 15.5° in l × 1.4° in b). The
panorama carries a 6–12/255 floor (median 8.5 over six dark patches —
airglow, zodiacal light, unresolved stars, JPEG) where the model
deliberately renders black (§ 2 rejected the pedestal); floor-subtracted
comparisons remove it in linear luminance.

**Verdict: the sky looks like the BHG16 total; the Leinert scale is
excluded.** Three measurements carry it:

- **Latitude extent.** The band stays above the panorama floor to
  |b| ≈ 45–60 at l ≈ 0 (b = 45 reads 11, b = 60 reads 10, the poles 6).
  Shipped holds the same shape — 6.9 at b = 45, 2.4 at b = 60, reaching
  the toe floor only at the pole. The Leinert scale puts b = 45 at 0.03
  and everything past it at zero, confining the visible band to the
  inner plane.
- **The inner-plane floor.** The darkest 3.1° patch on the plane (the
  Aquila rift, 24/255) still exceeds the Leinert counterfactual's GC —
  its *brightest* row — by 1.14 mag on the −1.02 scale and 4.5 mag on
  the −1.68 one.
- **Mid-latitude level.** b = +30 is the cleanest row — no discrete
  clouds, and the floor is measurable beside it. The Leinert
  counterfactuals land at 0.38 and 0.005 of 255, i.e. 3.2 and 8.0 mag
  faint and both under one 8-bit step, where the panorama plainly shows
  band. This row excludes Leinert; it does **not** endorse the shipped
  level, which now runs 1.40 mag bright against the same measurement.

Per-row residuals are ordered by contamination, not by scale: the
panorama reads 0.18 mag over shipped at b = +5, 1.40 mag *under* at
b = +30, and over a magnitude over on the plane rows — where the patch
includes the resolved star field Stellata draws separately (66 % of the
pole's light is catalogue stars; the plane's fraction is lower but its
absolute column far larger) and the discrete star clouds and rift the
smooth slab averages over. The panorama's own inner-plane spread is
2.3 mag (Baade's window 191, Aquila rift 24), wider than the
BHG16-vs-Leinert gap — so the low-|b| rows bound the scale only from
below, and the arbitration rests on the three measurements above.

### The high-|b| excess this measurement exposes

**The b = +30 residual is the one number the C1 toe moved, and it moved
the wrong way.** Under the first, steep toe (slope 3.5 at the knee) the
row read 0.23 mag model-bright; the C1 toe left 1.14, and correcting B/T
from a mass ratio to a V-band light one has since taken it to 1.40. The
toe changed no photometry — the gentler rolloff simply stopped crushing a
sub-threshold row that was already carrying an excess, which is what a
toe tuned for perceptual honesty rather than for agreement will do.

Three readings of the same fact:

- **Level**, 1.40 mag model-bright at b = +30, 1.10 at b = +45.
- **Gradient**, the model spanning 1.76 mag over b = 5 → 30 where the
  floor-subtracted panorama spans ≈ 4.2.
- **The Leinert pole check**, 1.68 mag in the same direction
  (`docs/science-galactic-structure.md` § The luminosity solve).

Both known measurement biases inflate it — floor subtraction eats real
high-|b| light, and the b = +5 row carries resolved-star light the model
draws separately — so 1.40 mag is an upper bound on the disagreement,
not an estimate of it. The sign is not in doubt: the disc's vertical
profile carries too much light at high |b|.

That this coexists with a panorama that *excludes* the Leinert global
scale is not a contradiction. The far-field emissivity-grid work carries
the reconciliation hypothesis: the Sun sits interarm (the Orion Spur), so the local
vertical column can sit below the azimuthal mean at the same
latitude — BHG16's integrated total and Leinert's sightlines can both be
right, disagreeing only through the smooth axisymmetric interpolation
between them. A measured emissivity grid captures that; a solved
constant cannot.

**`DR_MAG` stays 7.5, and this panorama cannot be what confirms it.** At
band luminances the extended-Reinhard white-point term `y/Lw²` is under
2 × 10⁻³, so every band row is white-point-independent: sweeping
`DR_MAG` from 5.5 to 11 moves the b = +5 residual by 0.007 mag and the
b = +30 residual by 0.001. The panorama cannot grade star peaks either
(16.9′/px dilutes them), and those are where the white point does work.
So no `DR_MAG` value is preferred or excluded here, and the framing this
section opened with — `DR_MAG` as the faint-end lever H7 tunes against
eso0932a — is retired. It was untrue before the toe as well; the value
rests on the top-end validation that preceded this run.

One panorama structure the model does not reproduce: the l = 0 maximum sits
at b = −2.5 (the Large Sagittarius Star Cloud, 155–175/255), not the slab's
smooth b = +5, and the Great Rift sits above the plane rather than centred on
it. Axisymmetric analytic dust cannot express that in either sign — the
panorama reads 2.60 mag brighter at b = −3 than at b = +3 and the shipped
model reads 0.00.

**Settled, and it splits in two.** The rift half is dust and is answered by
the measured cascade (`docs/science-galactic-structure.md` § The dust stack),
which recovers 2.03 mag of that 2.60 and incidentally takes the b = +30
residual above from 0.44 to 0.13 mag model-bright. The window half is not
dust: at b = −3 the panorama stays 3.08 mag brighter than the cascade,
because that patch is inner-disc and bulge light through a low-extinction
window and the emissivity here is smooth and axisymmetric. That half belongs
to the far-field emissivity grid, alongside the high-|b| excess above.

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
  entirely (they stop existing in code, not just in the panel).
  *Shipped.* The panel's sliders are the five live scalars — `L_ADAPT`,
  `L_TARGET`, the slew τ, `DR_MAG`, desaturation — over a readout carrying
  the statistic and its coverage, all three branch terms, the ramp weight,
  the governing regime, and the exposure decomposition. **`L_THRESH` and `LUMA_CEIL` are readouts, not
  sliders**: both are compile-time constants in seven emitter shaders,
  and `L_THRESH` anchors the unit every other calibration is expressed
  against. `uGlowMagOffset` survives as a *calibration
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
no light/dark-adapt time constants, no feedback loop) · bloom/lens-flare
post effects (the existing PSF footprint is the bloom) · local
(spatially-varying) tone mapping — **decided out**, not deferred, with the
conditions for revisiting it stated where the verdict is (§ 3.2).

**Rod spatial summation came into scope and shipped** (§ 1, *Extended
sources*). This section used to waive scotopic/mesopic eye modelling on the
grounds that "`DR_MAG` absorbs the compression". It does not: `DR_MAG` sets
the range from threshold to white and lifts point and extended sources
*together*, so it carries no term that can express a point-vs-extended
ratio. The waiver survived only because the Milky Way band was ~2.9 mag
over-bright, which silently supplied the missing lift; `stellata-xypg.29`
corrected the photometry and `stellata-xypg.34` replaced the accident with a
threshold. **Still out of scope: everything spatial about rod summation** —
the resolution loss, and the convolution that would let a *structured*
extended source take the same anchor (§ 1's second stated limit). What
shipped is the threshold, applied as a gain.
