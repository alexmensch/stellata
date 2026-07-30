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
                                  the analytic shadow span, and the twilight
                                  term. Vitest-pinned. The TS sample-count
                                  constants seed the GLSL #defines.
  atmosphere-glsl-drift.test.ts   Pins the GLSL literals against their TS
                                  constants, and the expression shapes the
                                  shadow-span / twilight fixes turn on —
                                  no GL context under vitest.
```

Per-body params live in `../planet-system.ts` as `PlanetAtmosphere`
rows: scale heights + **vertical optical depths** (`rayleighCoeff`,
`mieCoeff`, `absorbCoeff`). The mesh layer divides by H/R to get the
surface extinction the integrator wants.

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
shadow edge, lit out to `acos(1/r)` for a sample at radius r, and § Twilight
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
(`../../hdr/statistic/README.md`). It did not always: the adaptation
statistic used to walk a per-source model carrying reflected host light
alone, and at `α → 180°` — exactly where the Mie forward peak paints the
Cassini ring this model was built for — the two disagreed by ~11
magnitudes and a backlit Titan blew out.

## Twilight — the lit air scattering light back down

The airlight above is what the atmosphere sends toward the **eye**. A separate
term sends it toward the **ground**: without it the lit shell floats over a
black surface, because a night-side fragment's own Lambert term is zero and
nothing else reaches it.

Analytic, and view-independent (irradiance must not depend on where you look
from, so the phase-weighted view-ray in-scatter cannot stand in for it):

```
E_sky/E_host = TWILIGHT_SCATTER_FRAC · τ_scatter · exp(−h_shadow/H)
h_shadow = 1/cos(Δ) − 1        (0 on the lit side)
```

`h_shadow` is the altitude of the shadow's upper edge directly overhead, so
only the column above it still sees the host — and **the body's own scale
height is therefore what sets the angular reach**: a few degrees on Earth,
~10° on Titan, no global constant involved.

The variable is **solar depression angle, not distance along the ground**, and
that is what makes the *projected* twilight band widen wherever the terminator
crosses the surface obliquely — high latitude near solstice, where iso-`sunCos`
contours spread out and polar twilight runs for weeks. It falls out of the
parameterisation; there is no obliquity term and there should not be one.

`τ_scatter` is the vertical scattering optical depth
(`stellata_verticalScatterTau`, absorption excluded), which also gives the
twilight the air's own hue — blue on Earth — for free.

`TWILIGHT_SCATTER_FRAC` = 0.055 is ¼ (hemispheric average of an isotropic
in-scatter) × the ≈0.22 slant transmission a horizon sun reaches the column
through, **calibrated against Earth**: 4e-3 of full sun at the geometric
terminator (~400 lx against ~100 klx), decaying to 1.2 % of that by 6° of solar
depression, where civil twilight measures ~4 lx. Both are pinned.

It rides `uSurfaceLuminance`, not `uAirlightLuminance` — this is light
*reflected off the ground*, so it needs the albedo-bearing scalar, and the
p/π relation above means it needs no extra factor. Being ~6 stops below full
sun it is subtle at a day-side exposure: it reads when the adaptation follows a
night-side-dominated frame. `Planet.terminatorSoftness` is the older by-eye
widening of the Lambert edge and is deliberately untouched here
(`../planets/README.md` § Lighting).

### Where this model is wrong — `stellata-2f6.38`

Two calibration anchors is two, and the form fails outside them. Both failures
are the same missing physics (multiple scattering), and both are that bead:

- **The tail collapses.** Against measured Earth horizontal illuminance the
  single exponential holds at the terminator and at 6° (5.0 lx modelled against
  ~4 lx civil), then falls off a cliff: **1000× too dark at 12°** (7.6e-6 lx
  against 0.008 lx nautical) and hopeless by 18°. Real twilight persists to ~18°
  because the light has bounced; this term is a single scatter out of a lit
  column and has no route to it. Visually the band ends 7–8° past the terminator
  instead of fading over ~18 — a crescent where there should be a gradient, and
  ~9 % of the disc radius on Earth. The measured curve is not one exponential
  either: the effective scale height grows from ~2H between 6° and 12° to ~9H
  between 12° and 18°.
- **The day side is a floor, not a derivation.** `h_shadow` is 0 for any
  `sunCos ≥ 0`, so the whole lit hemisphere receives the *terminator's*
  skylight, flat. Real skylight is strongest at local noon — ~10–15 % of direct
  sun on Earth against this model's 0.6 %, so ~20× under across the day side.
  Invisible next to direct sun, which is why it stands for now, but it is not
  what the parameterisation claims.

**Flux bookkeeping.** `uSurfaceLuminance` divides out the disc mean of
everything the shader multiplies on top so the disc integrates to the body's
true flux (`../planets/emission/mesh-surface-pure.ts`), and this term is added
inside that product without being in the divisor. The day-side value is flat
`0.055·τ_scatter`, so the overshoot is Earth +0.6 %, Venus +1.0 %, Mars +0.5 %
of the direct term — and **Titan +21 %**, its τ_Mie being 2.5. Titan's surface
sits behind τ ≈ 2.5 of haze so little of it reaches the image, and the airlight
has always been additive over a flux-correct disc, so this is bounded rather
than fixed. Anything that raises τ (`stellata-2f6.37`) raises it too.

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

**It is not the small correction the name suggests.** Measured through the CPU
mirror on a limb chord (`atmosphere-scattering-pure.ts`), the fill's share of
total airlight is **53 % on Earth, 61 % on Venus, 83 % on Mars** with the sun at
90°, falling to 36 / 8 / 4 % back-lit where the Mie forward peak takes over. So
single scatter leads only in back-lit geometry.

`MS_STRENGTH = 0.0667` is `0.2/3`, and the `/3` is the interesting part: the 0.2
was read off the slider while single scatter still carried the 3× gain that
§ Airlight rides host irradiance describes deleting. Carried through unchanged
it would have tripled the shares above (77 / 82 / 94 %) and washed the textures
out. Rescaling preserves the ratio the eye had approved — it does **not** derive
it. This weight and the per-body optical depths are both still by eye:
`stellata-2f6.38` replaces this term with the physics it stands in for (and the
twilight tail below, which is the same missing physics), `stellata-2f6.37`
anchors the depths.

**Airlight rides host irradiance, and there is no gain on it.** Both the disc
block and the shell multiply `uAirlightLuminance`
(`../planets/emission/mesh-surface-pure.ts:hostIrradianceLuminance`) — the
host's irradiance at the body in the scene-wide HDR unit, carrying no surface
albedo, because scattered sunlight doesn't depend on the ground's
reflectance. The surface multiplies a *different* scalar that does
(`uSurfaceLuminance`), and the two sit **exactly p/π apart**
(`mesh-surface-pure.test.ts`). That is what closes the calibration: the
integrator's `∫β_s·P·T dl` is already a dimensionless fraction of incident
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

- The mesh *surface* already renders at the Mallama-correct apparent magnitude,
  so absolute brightness is anchored; the atmosphere only supplies *hue* + limb
  behaviour + (for thick hazes) the multiscatter disc.
- **Relative brightness** follows geometric albedo (`Planet.albedo`: Venus 0.69
  > Earth 0.43 > Titan 0.22 ≈ Mars 0.17) — Venus should read brightest.
- **Rayleigh `rayleighCoeff`** keeps the 1/λ⁴ (blue-heavy) shape; its magnitude
  is the molecular optical depth (near-zero on dust-dominated Mars). Lower it
  to keep Earth's limb *blue* — too high and the long limb path reddens it
  (sunset physics).
- **`absorbCoeff`** is blue-heaviest for the coloured hazes (Titan, Mars dust,
  Venus) — it removes blue from airlight and transmittance. Do not invert.
- Target appearance: Earth = blue limb, dark oceans, white clouds; Venus =
  featureless pale yellow; Mars = butterscotch; Titan = featureless orange.
  Near-raw full-disc references: DSCOVR/EPIC daily Earth images.

A dev **'Atmosphere' debug panel** (`../../debug/atmosphere-tuning.ts`)
exposes four global multipliers applied on top of the per-body base —
density (the 'dial Titan down' knob), Rayleigh↔Mie balance, scale
height, and sun intensity — for live calibration; read a good value off
the slider and bake it into the per-body table.

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
the body casting it; **`sunCos` for § Twilight must not be**, since solar
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
