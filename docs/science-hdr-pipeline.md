# HDR pipeline — physical-luminance unit, unified tone-map, exposure epochs

Design gate for the HDR epic (stellata-xypg). Every implementation child
(H2 plumbing, H3 stars, H4 Milky Way, H5 planets, H6 exposure wiring,
H7 validation, H8 debug panel) builds against this document. The problem
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
so that a point source exactly at the magnitude-slider limit
`m_lim` (= `uMaxAppMag`) carries `L = L_THRESH`**:

```
L(m) = L_THRESH · 10^(0.4 · (m_lim − m))
```

- `L_THRESH` (default **0.02**) is the display value a threshold star
  lands on. The tone-map is ~linear in this toe, so after sRGB encode a
  threshold star renders at ≈ 0.15 of full scale — dim but present,
  matching the current soft-taper feel at the cutoff.
- The exposure is *inside* the formula: the shared uniform is
  `uExposure = L_THRESH · 10^(0.4 · m_lim)`, and every emitting shader
  computes `L = uExposure · 10^(−0.4 · m)` from its physical apparent
  magnitude `m`. Moving the slider moves every layer identically — that
  is the entire cross-layer calibration mechanism.
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
values at the naked-eye preset (`m_lim = 6.5`, `uExposure ≈ 7.96`):

| Source | m | L | tone-mapped (Lw = 20) |
| --- | --- | --- | --- |
| threshold star | 6.5 | 0.02 | 0.02 → faint |
| Vega | 0.0 | 8.0 | 0.90 |
| Sirius | −1.46 | 30.5 | ≈ 1.0 (white) |
| Venus (max) | −4.7 | 605 | white + bloom |
| MW band pixel (S ≈ 20 mag/″², 94″/px) | ≈ 10.1 | 7e-4 | barely visible |
| Sun disc at 1 AU | −26.7 | ceiling clamp | white |

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
  case — the real 30″ PSF is sub-pixel at practical FOVs): the star's
  entire flux lands at its peak, `peak_L = L(m)`. The super-Gaussian
  footprint (appSize, √Δm, per-preset exaggeration K, soft-knee) is
  retained unchanged as a **display kernel normalized to peak 1** — it
  spreads the light for legibility but no longer encodes brightness.
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
effect and stops being a calibration knob.

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
  exactly 1.0. `DR_MAG` is *the* faint-end calibration lever: strict
  physicality (7.5) renders the MW band as faint as the real
  suburban-sky band; H7's eso0932a comparison is expected to tune it
  into the 5–8 range (the panorama is itself a long exposure). Defaults
  `L_THRESH = 0.02`, `DR_MAG = 7.5` ⇒ `Lw = 20`.
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

## 3. Exposure model — slider and epochs

**The magnitude slider is the single exposure control.** `m_lim` sets
`uExposure = L_THRESH · 10^(0.4·m_lim)`; every layer reads the same
uniform. The presets become exposure presets:

| Preset | m_lim | uExposure | white-point mag (m_lim − DR_MAG) |
| --- | --- | --- | --- |
| naked-eye | 6.5 | ≈ 7.96 | −1.0 (Sirius just saturates) |
| binoculars | 10.5 | ≈ 317 | 3.0 |
| all | 15.0 | 2.0e4 | 7.5 |

**Population cutoff and exposure agree by construction.** The vertex
cull at `m_lim` (+ 0.5-mag taper) is retained — but as a *performance*
cull that coincides with the visibility threshold: a star fainter than
`m_lim` would render below `L_THRESH`, i.e. at or under the
just-noticeable floor the unit is anchored to. The slider therefore
keeps its population semantics *and* gains photometric meaning, with no
divergence between the two. (This resolves the old
slider-as-cutoff-vs-slider-as-exposure tension: they are the same
number on the same scale.)

**Epoch model.** The naked-eye preset is the **base exposure epoch** —
the grounding for all light decisions (its `uExposure`, its PSF/K
angular targets). A future instrument preset (binoculars, telescope) is
authored as a pair of multipliers *on top of* the base epoch:

```
uExposure   = baseExposure(m_lim) · instrument.exposureMul     // aperture gain
angular σ,K = base targets        / instrument.angularMag      // resolution gain
```

`epochExposure()` in the exposure module takes the instrument record
(identity today) so the accommodation is structural, not speculative.
Physical sanity check the model already passes: 50 mm binoculars gain
≈ (50/7)² ≈ 51× ≈ 4.3 mag — the existing naked-eye→binoculars preset
step is 4.0 mag. Instrument presets themselves are out of scope
(future epic); only this shape is mandated.

## 4. Per-layer mapping — every current squash and its replacement

Physical layers (emit `L`, exposure-multiplied, pre-tone-map):

| Layer | Current squash | HDR replacement |
| --- | --- | --- |
| Star glow + disc (`star.frag.glsl`) | peak-1 profile; brightness = footprint only | `peak_L = L(m) / max(1, π·r_phys²)` × unit-peak profile (§ 1); footprint math untouched |
| Star halo (MaxEquation) + core mask | unchanged mechanisms | blend equations operate on linear L; depth rules unchanged |
| Milky Way (`milkyway.frag.glsl`) | `1 − exp(−colorAccum · 5.35e-6 · gate)`, `uGlowMagOffset` vs slider gate | *Shipped as designed (H4).* `L_px = uExposure · 10^(−0.4·m_px)` where `m_px = uGlowMagOffset − 2.5·log10(column · Ω_px)`; `Ω_px` = pixel solid angle in arcsec², so **surface brightness** rather than per-pixel luminance is the FOV-invariant (zooming dims the band exactly as it dims a resolved stellar disc). `DEFAULT_BRIGHTNESS`, the gate, and the exp squash are deleted. The magnitude round-trip collapses to one scalar gain, so the sightline's chromaticity survives untouched. `uGlowMagOffset` is provisionally **31.3** — the GC sightline at S ≈ 20.2 mag/arcsec², the § 1 band reference — pending H7's per-sightline re-derivation (§ 8) |
| LG emission (shelved) | same gate + exp squash, magnitude-domain | identical mapping as MW when unshelved — it already computes a per-pixel magnitude, so it lands on the unit for free; no new bead until unshelve |
| Planet glare / billboard (`planet.vert/frag`) | peak-1 white ceiling (2f6.27) | identical point-source rule as stars, `m` from `planetApparentMagnitude` — mesh↔glare continuity by construction |
| Planet mesh (`planet-mesh.frag.glsl`) | `litIntensity`: irradiance^0.25 × slider^0.25, clamp [0.12, 1.6] | true surface brightness: per-px `L` such that the disc-integral equals `L(m_planet)`; Lambert/phase/limb shading redistributes within the disc at unit mean; `HOST_IRRADIANCE_DISPLAY_EXPONENT`, `HOST_INTENSITY_MIN/MAX`, and the litIntensity slider-composition are deleted (tone-map does the compression; uExposure does the slider) |
| Planet rings | multiply litIntensity | multiply the same surface-brightness scalar (host irradiance at the ring) — ring↔body contrast preserved |
| Earth night lights | emissive add, tuned | stays a tuned emissive luminance constant (Black Marble radiometry out of scope) — pick the constant in HDR units in H5 |
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
- **So the seam ships dormant.** `HDR_DEFAULT_ENABLED` (in
  `src/client/hdr/hdr-pipeline.ts`) is false: the default path stays the
  pre-HDR one, and turning the seam on is a dev switch
  (`stellata.setHdrEnabled(true)`) until H3–H5 have converted the
  emitters. Enabling it earlier would only trade a correct-looking scene
  for a mis-calibrated one. The render target allocates lazily so a
  dormant seam costs no VRAM. Flip the constant in the bead that lands
  the last conversion.
  **Consequence for H3 onward:** with the seam off, an emitter's physical
  luminance would reach the canvas with no operator, so the inline
  `stellata_tonemap` fallback (§ 6) stops being an exotic-hardware
  concern and becomes a requirement of the *default* path. Every bead
  from H3 keeps both paths working.
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
  stretches per preset. H4 shipped **31.3** as a provisional single-point
  anchor (GC sightline → S ≈ 20.2); the known gap it leaves is a
  latitude gradient steeper than the real sky's — the model puts NGP near
  25.3 mag/arcsec² against a real ~23.5–24. Fixing that is a density-
  profile question, not an offset one.
- **`DR_MAG` is the tunable** reconciling strict physicality with the
  panorama's long-exposure look; land its shipped default in H7 and
  record the chosen value here.
- Cross-layer smoke per preset: threshold stars at the just-visible
  floor; Sirius/Vega ordering; Venus > Sirius; MW band rises with
  m_lim in step with the star field (not just population); planet
  resolve-step continuity (glare↔mesh at equal `L(m)`); moon vs
  dim-surfaced parent ordering at true flux.

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
  + gate (*deleted in H4*), planet-disc floor/exponent constants,
  dynamic-range exponent — from the tuning surface entirely (they stop
  existing in code, not just in the panel; H4/H5 delete them). The panel gains: operator
  params (`DR_MAG`, `L_THRESH`, desaturation), exposure + active-preset
  readout, and `LUMA_CEIL`. `uGlowMagOffset` survives as a *calibration
  constant* set by H7, debug-visible but not a user knob.
- **Deliverable placement:** this doc (cross-cutting) + a
  `src/client/hdr/README.md` from H2 for RT/pass implementation detail.

## Out of scope

Instrument presets (only the epoch accommodation is mandated) ·
Display-P3 output (zsr.2 — plugs into the § 2 encode) · BC_photopic
(a7d.2.10 — substitutes into `L(m)` when it lands) · scotopic/mesopic
eye modelling (rod spatial summation can't be reproduced on a display;
`DR_MAG` absorbs the compression) · bloom/lens-flare post effects (the
existing PSF footprint is the bloom).
