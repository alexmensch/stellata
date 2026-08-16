# Planetary atmospheres

First-principles single-scattering airlight for the four bodies that
carry `Planet.atmosphere` — Venus, Earth, Mars, and Titan. The
integrator lives here once and is spliced into the planet mesh and
shell fragment shaders in `../planets/`; a CPU mirror pins it under
vitest.

## Files in this area

```
src/client/solar-system/atmosphere/
  atmosphere-scatter.glsl         Shared single-scattering integrator + ray
                                  helpers (shell entry, body-strike, luma),
                                  spliced into the mesh + shell frag sources
                                  (disc airlight + limb halo).
  atmosphere-uniforms.glsl        Shared atmosphere-scatter uniform contract,
                                  spliced into both frags (single source vs
                                  sharedAtmoUniforms in
                                  ../planets/planet-mesh-layer.ts).
  planet-atmosphere.vert.glsl,
  planet-atmosphere.frag.glsl     Atmosphere limb/halo shell shaders —
                                  single-scattering airlight for rays that
                                  miss the disc.
  atmosphere-scattering-pure.ts   CPU mirror of the integrator + per-body
    (+ test)                      calibration constants + phase functions,
                                  the analytic shadow span, the skylight
                                  term, and the full-phase disc means that
                                  keep the drawn disc on the body's flux.
                                  Vitest-pinned. The TS sample-count
                                  constants seed the GLSL #defines.
  atmosphere-glsl-drift.test.ts   Pins the GLSL literals against their TS
                                  constants, and the expression shapes the
                                  shadow-span / twilight fixes turn on —
                                  no GL context under vitest.
```

Per-body params live in `../planet-system.ts` as `PlanetAtmosphere`
rows: scale heights + **vertical optical depths** (`rayleighCoeff`,
`mieCoeff`, `absorbCoeff`). `atmosphereParamsOf` is the one place that
divides by H/R to get the surface extinction the integrator wants —
both the uniform write and the flux normaliser go through it, so they
cannot disagree about what a row means.

## The model

A Nishita/O'Neil few-sample march: `ATMO_N_VIEW` view samples ×
`ATMO_N_LIGHT` sun-ray samples. The TS constants seed the GLSL
sample-count `#define`s so the loop bounds cannot drift. Only runs in
the mesh-LOD regime; both paths ride the crossfade `uFade`.

Three species over two exponential density profiles ρ(h) = exp(−h/H):

- **Rayleigh** (molecular) — per-channel scatter coefficient ∝ 1/λ⁴ (blue),
  phase `3/16π·(1 + cos²θ)`. Earth's blue airlight.
- **Mie** (aerosol) — grey scatter coefficient, forward Henyey-Greenstein
  (default g = 0.76). The haze glow + Cassini-style back-lit limb ring.
- **Aerosol absorption** — a per-channel extinction term (no re-emission).
  This is the hue source a grey-Mie-scatter model cannot give: high-in-blue
  absorption removes blue from both the airlight and the view-path
  transmittance, so **Titan reads orange, Mars butterscotch, Venus pale
  yellow**. Earth's is zero. Do not invert the `absorbCoeff` channels — blue
  is the *most* absorbed.

The night/day terminator falls out of the geometry, and is **solved rather
than sampled**: the planetary shadow along a view ray is always exactly one
t-interval (`stellata_shadowSpan` — inside the infinite shadow cylinder, cut
against the terminator half-space), and each march sample is weighted by the
fraction of its segment outside it. That is the same question as "does the ray
from this sample toward the host strike the body", which is why the light march
carries no occlusion test of its own.

What this bounds is the **direct beam**: the shadow cylinder IS the airless
terminator, and no sample inside it sees the host, full stop. Light past that
line is the atmosphere's own doing, and it has two routes — the shell above the
shadow edge, lit out to `acos(1/r)` for a sample at radius r, and § Skylight
onto the ground below. So the *illuminated* terminator is soft and reaches
further than the geometric one; the *lit* one is exact and does not.

## Airlight is applied on both surfaces

- **Disc** (`../planets/planet-mesh.frag.glsl`) — `final = surface·T_view + L_air`.
  The transmittance `T_view` pales/desaturates the surface (Earth's dark ocean
  goes pale blue — this subsumes the old "tint the ocean texture" idea; the
  texture stays a pure albedo) and `L_air` is the in-scattered column in
  front of it.
- **Limb** (`planet-atmosphere.frag.glsl`) — halo for rays that miss the disc
  (impact parameter > R); rays that strike the body are `discard`-ed so the
  disc path owns them (no double-count). The full-chord airlight is the
  physical back-lit ring. The shell composites **premultiplied-over, not
  additive** (`CustomBlending`, `frag alpha = 1 − luminance(T_view)`): it adds
  airlight *and* occludes the background by the chord's opacity, so a dense
  near-limb chord that scatters no light toward the eye (its base in the body's
  own shadow) still extincts the stars behind it. Additive left that base
  transparent — stars leaked through the ring gap, worst on thick-haze Titan.

Both surfaces also write the HDR target's **statistic attachment**, so the
airlight drives the exposure like any other light
(`../../hdr/attachments/README.md`). It did not always: the adaptation
statistic used to walk a per-source model carrying reflected host light
alone, and at `α → 180°` — exactly where the Mie forward peak paints the
Cassini ring this model was built for — the two disagreed by ~11
magnitudes and a backlit Titan blew out. Its coverage claim rides opacity and
`litFrac`, the chord's sunlit share (`../../hdr/attachments/README.md`).

## Skylight — the lit air scattering light back down

The airlight above is what the atmosphere sends toward the **eye**. A separate
term sends it toward the **ground**: without it the lit shell floats over a
black surface, because a night-side fragment's own Lambert term is zero and
nothing else reaches it — and the day side gets its diffuse skylight from the
same term.

Analytic, and view-independent (irradiance must not depend on where you look
from, so the phase-weighted view-ray in-scatter cannot stand in for it). One
model, `stellata_skyIrradiance` / `skyIrradianceFrac`, three derived pieces:

```
E_sky/E_host = F_term · tail(h_shadow) · (1 − μ_s)  +  beam(μ_s)

F_term  = ¼ · τ_s · T̄(τ_ext·Ch) · exp(−τ_a)          (terminator anchor)
tail(h) = exp(−h/H) + B·exp(−h/(K·H))                 (twilight falloff)
beam(μ) = ½ · μ · ω̃ · (1 − exp(−τ_ext/μ)) · exp(−τ_a/μ)   (day side)

h_shadow = 1/cos(Δ) − 1  (0 on the lit side) · Ch = √(π/(2H)), Chapman airmass
of a horizon sun · T̄(x) = (1−e⁻ˣ)/x, the column-mean transmission that sun
reaches the scattering column through · ω̃ = τ_s/τ_ext
```

- **The terminator anchor is a derivation, not a fraction read off a table.**
  ¼ is the hemispheric down-flux of an isotropic in-scatter over the half-dome
  a horizon sun still lights; T̄ self-saturates — thicker air lights its column
  through *less* transmission — which is what lets the same expression hold
  from Mars's thin CO₂ to Titan's τ ≈ 5 haze. On Earth at physical depths it
  lands 1.75× over the measured ~400 lx / ~100 klx; the residual is the
  un-modelled ozone Chappuis absorption and up-scatter loss, both of which
  only push down. The factor-2 band is pinned.
- **The tail is two exponentials, because the measured curve is.** The first,
  over the body's own scale height, is the single-scatter reach: the shadow
  edge climbing out of the scattering column. The second is multiple
  scattering — the reason real twilight persists to ~18° — with amplitude
  `TWILIGHT_TAIL_AMP` = 1.459e-4 and reach `TWILIGHT_TAIL_REACH` = 8.95 scale
  heights, the closed-form fit through measured Earth horizontal illuminance
  at 12° and 18° of solar depression (0.008 lx / 0.0006 lx, Allen's
  Astrophysical Quantities). The test re-derives both from the table; civil
  twilight at 6° falls out within 1.5×. Both terms scale with the body's own
  `H`, so Venus / Mars / Titan follow with **no per-body constant** — Titan's
  band is ~10× Earth's angular width because its scale height is.
- **The day side is beam interception, anchored at noon.** Of the direct flux
  crossing a horizontal surface (`μ_s`), the column scatters out
  `ω̃·(1−e^(−τ_ext/μ))`; half of that reaches the ground as diffuse skylight,
  less what the absorbing species eat on the way down. On Earth it gives
  diffuse/direct ≈ 8 % at noon against the measured clear-sky 10–15 % (the
  gap is ground-albedo bounce and aerosol multiple scattering).
- **The two are a partition, not a sum.** `beam` is the same photons as
  `F_term` seen at the other end of the elevation range — a lit column
  redirecting sunlight downward — so the anchor carries a `(1 − μ_s)` weight
  and the beam its `μ_s`, handing over across the terminator instead of
  stacking. Added flat, as the anchor first was, it puts a horizon-sun floor
  under local noon: 9 % of Earth's day-side skylight, and it is the same
  "flat across the lit hemisphere" defect the single-exponential model had.
  In the optically thin limit the partition reads exactly ½·τ_s at noon and
  ¼·τ_s at the terminator, which is what the test pins.

**The band is a constant-width annulus, and that is correct.** The variable is
solar depression angle δ, and on a sphere δ **is** the great-circle arc past
the terminator (`sunCos = cos θ` from the subsolar point, δ = θ − 90°), so the
twilight zone is a ~18°-wide, constant-area zone wherever it sits. Iso-`sunCos`
contours are evenly spaced circles about the subsolar point and never spread
out; nothing about an oblique crossing reaches further.

What varies, and falls out of the same parameterisation with no obliquity term:
**duration** (a high-latitude point near solstice crawls along the annulus, so
polar twilight runs for weeks) · **shape in latitude** (the annulus cuts across
parallels obliquely, and near equinox it encloses the pole outright — subsolar
latitude −10° puts the north pole at 10° depression, in nautical twilight) ·
**projected width on screen**, foreshortened by the local emission angle. So
the band reads much wider near a pole without being wider, and there is no
obliquity term to add.

`τ_s` is the vertical scattering optical depth
(`stellata_verticalScatterTau`, absorption excluded), which gives the skylight
the air's own hue — though at physical depths the T̄ saturation nearly
flattens Earth's twilight channels (the strong zenith-blue of real twilight is
ozone, which this model does not carry). `τ_a` is the absorption column
(`uBetaAbsorb · uScaleHeightM`), and it is what makes Titan's ground light
orange: sky + direct at local noon comes out 0.28 of incident against the 0.49
a conservative-scattering model of the same τ_ext would claim.

**Where the model is over.** Earth's terminator anchor runs 1.75× (above) and
Titan's noon ground light **2.8× the ~10 % of incident Huygens/DISR measured**
(Tomasko et al. 2008). Same direction, same cause: the isotropic-redistribution
½ and ¼ stop being upper bounds once τ ≫ 1, and nothing here loses photons back
to space. Titan's is invisible in the render — its own haze extincts its ground
to nothing (⟨μ·T_view⟩ = 0.006, § Flux bookkeeping) — but it is the number to
beat if this term ever gets the two-stream treatment τ ≈ 5 wants. Note too that
`TWILIGHT_TAIL_AMP` is an Earth fit carried unchanged: the *reach* is in scale
heights and transfers, the amplitude is the multiple-scatter share at Earth's
τ, and multiple scattering grows with τ.

It rides `uSurfaceLuminance`, not `uAirlightLuminance` — this is light
*reflected off the ground*, so it needs the albedo-bearing scalar, and the
p/π relation above means it needs no extra factor. The twilight band reads
when the adaptation follows a night-side-dominated frame; the day-side term
is a ~9 % lift under the direct sun. `Planet.terminatorSoftness` is the older
by-eye widening of the Lambert edge and is deliberately untouched here
(`../planets/README.md` § Lighting).

**Flux bookkeeping.** `uSurfaceLuminance` divides out the disc mean of
everything the shader multiplies on top so the disc integrates to the body's
true flux (`../planets/emission/mesh-surface-pure.ts`). At physical depths the
atmosphere is not a small correction to that mean, so all three of the things
it does to the disc are measured — `atmoDiscMeans`, one full-phase quadrature
running the **same march the shader runs**, not an analytic stand-in:

| | ⟨μ·T_view⟩ | ⟨E_sky·T_view⟩ | π/p·⟨airlight⟩ |
|---|---|---|---|
| Venus | 0.553 | 0.047 | 0.082 |
| Earth | 0.566 | 0.054 | 0.220 |
| Mars | 0.485 | 0.058 | 0.453 |
| Titan | 0.006 | 0.002 | **1.137** |

- **The view path DIMS the surface**, so `⟨μ·T_view⟩` *replaces* the Lambert
  2/3 rather than adding to it — it is 2/3 only in the transparent limit
  (pinned), and lower for every real row.
- **The skylight is ADDED inside the same product**, so it joins that divisor.
- **The airlight is added OUTSIDE it**, on `uAirlightLuminance`, where no
  surface scalar can reach it. It takes its share of the body's flux off the
  top — `π/p·⟨airlight⟩`, a fifth of Earth's disc and near half of Mars's —
  and the reflected terms get the remainder. Geometric albedo already counts
  the light a body's air scatters, so leaving that share in the surface term
  draws it twice: before this, Earth's disc ran +7 % over its Mallama flux,
  Mars +18 %, Titan +15 %.

**Titan is over its measured flux and the clamp says so.** Its share is 1.137
— the haze model alone is 14 % brighter than the measured body, and its
⟨μ·T_view⟩ = 0.006 means the ground supplies nothing to trade against it. The
surface scalar clamps to zero and the residual stands: that is a per-body
optical-depth error (τ_Mie 2.5 sits mid-range in the measured 2–5), not
something to absorb into a gain on a calibrated airlight.

The fold is a luma scalar at full phase, so per-channel hue and phase-angle
residuals remain, each bounded by its own term's size. The disc means follow
the debug panel's multipliers (`setAtmosphereTuning` refreshes them), or the
flux would drift off the row every time a slider moved.

**The texture carries the disc; the atmosphere is an overlay.** Each body's
surface texture is its visible disc — including the *cloud-top* map for Venus.
The atmosphere therefore stays **optically thin** over it: a limb/airlight
overlay, never a second scattering layer thick enough to extinguish the texture
(`T_view → 0`) and replace it with a featureless ball — that double-counts the
clouds the texture already shows. Keep the per-body optical depths low enough
that `T_view` stays high across the lit disc.

**Titan is the deliberate exception.** Its tholin haze is optically thick in
*visible* light (the surface — and our near-IR texture — is genuinely invisible
from space), so Titan's row alone runs a dense Mie + heavy-blue-absorption
atmosphere that hides its texture and reads as a featureless orange ball. Every
atmosphere is an independent per-body `PlanetAtmosphere` row, so this is a local
choice, not a global one; the debug sliders are global multipliers on top.

**Multiple-scattering fill.** An isotropic term = fraction scattered (not
absorbed) × opacity (1 − T) × sunlit-fraction, weighted by `MS_STRENGTH`, adds
day-side ambient so the terminator doesn't fall to pure single-scatter black. It
stands in for a term the march genuinely does not compute, and it carries **no
phase function and no directionality** — a veil, not a structured glow, which is
why its *share* of the airlight is the thing to watch: too much of it and the
surface texture greys out.

`MS_STRENGTH = 1/(4π)` is derived, not judged: treat the light the sunlit
column has scattered as an isotropic source function — the scattered
irradiance spread over 4π sr — and the radiance a view path collects from a
uniform source is source × emergent opacity, which is exactly this term's
shape with weight 1/(4π). It is the same isotropic-redistribution
approximation the skylight terminator anchor's ¼ comes from (¼ = π·(1/4π),
the hemispheric down-flux of that source), so § Skylight and this fill are one
model pointed at the ground and at the eye. The eye-approved slider value was
0.0667 — 19 % under the derivation, which is how close the by-eye pass had
already landed.

**It is not the small correction the name suggests.** The fill's share of total
airlight, on a chord at the mid-shell impact parameter with the sun
perpendicular to the view: **Earth 57 %, Venus 57 %, Mars 83 %, Titan 83 %**,
falling to 40 / 27 / 5 / 18 % back-lit where the Mie forward peak takes over.
So the fill leads except in back-lit geometry, and how far it falls there is set
by the body's own `mieG` — Titan's 0.80 peak is sharper than the 0.76 default.
`msFill` is broken out of `ScatterResult` and the test owns the geometry, so
these are measured rather than re-derived from the formula in prose.

**Airlight rides host irradiance, and there is no gain on it.** Both the disc
block and the shell multiply `uAirlightLuminance`
(`../planets/emission/mesh-surface-pure.ts:hostIrradianceLuminance`) — the
host's irradiance at the body in the scene-wide HDR unit, carrying no surface
albedo, because scattered sunlight doesn't depend on the ground's
reflectance. The surface multiplies a *different* scalar that does
(`uSurfaceLuminance`), and in the transparent limit the two sit **exactly p/π
apart** (`mesh-surface-pure.test.ts`); at real depths the surface scalar also
carries the flux share the airlight has taken (§ Flux bookkeeping), which is
the general form of the same statement. That is what closes the calibration:
the integrator's `∫β_s·P·T dl` is already a dimensionless fraction of incident
irradiance, so the product IS the physical airlight radiance and the only
correct overall gain is 1. The `AIRLIGHT_GAIN = 3` that used to scale it was
read off the slider back when both terms shared one display-compressed scalar
pinned at ≈1 for Earth; after the split it was a 1.2-mag fudge on a calibrated
quantity, and it is gone. A body whose limb reads wrong against its disc is a
per-body optical-depth question, not a global one.

## Anti-banding

Three sources, three fixes.

1. *Geometric* — the analytic march must not read the mesh tessellation as a
   lat/long grid, so both shaders reconstruct the ray direction from the
   **renormalized interpolated normal** (a smooth sphere direction), never the
   faceted interpolated position.
2. *Sample-count* — the few-sample march (`ATMO_N_VIEW` × `ATMO_N_LIGHT`)
   jitters its sample lattice per fragment by an interleaved-gradient-noise
   offset (`stellata_atmoJitter(gl_FragCoord)`), and the light march offsets by
   a further golden-ratio stride per view sample (`LIGHT_JITTER_STRIDE`) so the
   view and light lattices stay **decorrelated** — otherwise the two beat into a
   moiré rather than dissolving into fine grain. The CPU mirror uses the
   midpoint (0.5), so vitest pins deterministic quadrature while the shader
   decorrelates.
3. *Terminator* — a lit/unlit test **per sample** steps the multiscatter
   lit-fraction (`litSum / ATMO_N_VIEW`) and the single-scatter edge in
   `1/ATMO_N_VIEW` increments, drawing ~`ATMO_N_VIEW` brightness contours across
   the terminator that beat against the jitter into the dominant moiré. The
   analytic shadow span (§ The model) removes them at the root: coverage
   weights make `litSum` **continuous in the ray's geometry**, so there is no
   quantum to contour. This replaced a fixed `SHADOW_SOFT = 0.15` planet-radius
   smoothing of the shadow edge — 956 km on Earth, 120 scale heights, which hid
   the contours by lighting the densest layers **32° past the terminator** and
   painting an airglow arc that wide. Blur the shadow to fix banding and the
   geometry pays; solve it and neither does.

The ad-hoc surface **limb-darkening** is dropped for atmospheric bodies (the
scattering governs the limb; keeping it double-darkened the disc edge into a
black rim).

## Calibrating per-body values — anchor to physics, not a photo

Every real image (Blue Marble included) is exposure- and
white-balance-processed, so pixel-matching is a trap. Instead:

- The drawn *disc* renders at the Mallama-correct apparent magnitude — surface,
  skylight and airlight together, § Flux bookkeeping — so absolute brightness is
  anchored and the optical depths only move *hue*, limb behaviour, and how the
  flux splits between ground and air. Titan is the exception: its airlight
  alone overshoots, so raising its τ raises its total brightness.
- **Relative brightness** follows geometric albedo (`Planet.albedo`: Venus 0.69
  > Earth 0.43 > Titan 0.22 ≈ Mars 0.17) — Venus should read brightest.
- **Rayleigh `rayleighCoeff`** is the body's TRUE molecular vertical optical
  depth at the shader's (650, 550, 450) nm channels — sourced, never read off
  a slider (per-body citations: `docs/science-solar-system.md` § Atmosphere
  optical depths). Limb reddening at these depths is sunset physics, not an
  error: a real Earth limb runs warm at its base and blue above.
- **`absorbCoeff`** is blue-heaviest for the coloured hazes (Titan, Mars dust,
  Venus) — it removes blue from airlight and transmittance. Do not invert.
- Target appearance: Earth = blue limb with a warm base, dark oceans, white
  clouds; Venus = featureless pale yellow; Mars = butterscotch; Titan =
  featureless orange. Near-raw full-disc references: DSCOVR/EPIC daily Earth
  images.

### No global knobs

There is **no debug slider on any of this**, and adding one is a regression.
Four global multipliers (density, Rayleigh↔Mie balance, scale height, sun
intensity) existed while the depths were by-eye, when the workflow was "read a
good value off the slider and bake it into the table". With every row a
published measurement that inverts: a value disagreeing with the render is a
question for the source or the row, never for a global multiplier over all four
bodies. They were also a hazard — § Flux bookkeeping normalises what the shader
emits, so a slider silently moved the calibration it was meant to test.
Generally: **perceptual knobs get sliders, derived physics doesn't.** Star-disc
sizing is legitimately by eye; τ_R at 450 nm is not.

## Shell extents

Shell heights are TRUE scattering extents (Earth 100 km ≈ Kármán, Venus 90 km
haze tops, Mars 60 km dust haze, Titan 300 km detached haze), never
exaggerated: at the planet focus park (30 %-fill framing) Earth's shell reads
≈ 3 px — deliberately subtle, per the camera-anywhere honesty rule.

**Flattening is not negligible against the shell, only against the radius**, and
both shaders now handle it. Earth's f = 0.0034 is **21 % of its 0.0157-radius
shell**, Mars's 0.0059 is **33 % of its 0.0177**. Treating it as zero showed as
a dark seam between disc and halo — widest at the poles, gone at the equator,
because both mechanisms scale with f:

- the shell discarded rays striking a body of radius **1** while the mesh drew
  a spheroid of polar radius **1 − f**, leaving a band the shell suppressed and
  the mesh never covered;
- the mesh read its airlight surface point as `uRadiusPc · normal` — a point on
  the equatorial-radius *sphere*, up to f·R outside the spheroid fragment it was
  shading, which at the limb collapsed the chord to nothing.

Both are one fix: each shader scales the ray's polar component by
`1/uPolarRadiusR` (`stellata_scalePolar`, with `uPoleView` from the mesh's local
+Y — the axis `mesh.scale` flattens) **before** any of the geometry above runs.
In that frame the body IS the unit sphere the march assumes, so shell entry,
body-strike, the shadow cylinder and `h = |p| − 1` all describe the body
actually drawn — and the atmosphere becomes a spheroidal shell of near-constant
thickness, which is what an atmosphere does. (Near: polar thickness comes out
`uPolarRadiusR ×` equatorial, so 0.34 % thinner on Earth — three orders below
the 21 % error being fixed here.) The map is linear about the centre,
so ray parameters are unchanged and only directions need renormalising. **The
sun direction has to be deflattened too** or the shadow cylinder tilts against
the body casting it; **`sunCos` for § Skylight must not be**, since solar
depression is measured against the true local horizontal.

The shell MESH stays a real-space sphere: it equals the deflattened shell at the
equator and over-covers toward the poles, so nothing is uncovered and the excess
discards on shell entry.

**`1 − f` has exactly one source: `../planets/spheroid-pure.ts:polarRadiusRatio`.**
The mesh's `scale.y / scale.x`, the ring shader's `uPolarRadiusPc` and
`uPolarRadiusR` here must be the same number — the shell discards ray-strikes
against the spheroid its ratio defines while the mesh draws the one its scale
defines, so any disagreement re-opens the seam above. Deriving `1 - flattening`
inline at a fourth site is how that happens; don't.

**Gas giants deliberately carry no shell**: their fuzzy
limb is already carried by the solidity-soft billboard edge at distance
and the cloud-deck maps up close, and none has a detached haze layer distinct
from the cloud deck at render scale.
