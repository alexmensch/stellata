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
    (+ test)                      calibration constants + phase functions.
                                  Vitest-pinned. The TS sample-count
                                  constants seed the GLSL #defines.
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

The night/day terminator falls out of the geometry: a sample inside the
planet's shadow cylinder is dark and contributes no in-scatter (a soft-edged
`stellata_sunLit` weight, not an ad-hoc day gate — see § Anti-banding for why
the edge is softened).

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

**Multiple-scattering fill.** A small isotropic term = fraction scattered (not
absorbed) × opacity (1 − T) × sunlit-fraction, weighted by `MS_STRENGTH`, adds
day-side ambient so the terminator doesn't fall to pure single-scatter black.
Kept low precisely so it doesn't grey-wash the surface texture. `AIRLIGHT_GAIN`
scales the single-scatter term so the neutral slider (sun intensity = 1) is
roughly calibrated.

**Airlight rides host irradiance, not the surface scalar.** Both the disc
block and the shell multiply `uAirlightLuminance`
(`../planets/mesh-surface-pure.ts:hostIrradianceLuminance`) — the host's
irradiance at the body in the scene-wide HDR unit, carrying no surface
albedo, because scattered sunlight doesn't depend on the ground's
reflectance. The surface multiplies a *different* scalar that does
(`uSurfaceLuminance`), so the airlight-to-surface ratio is now set by
physics rather than by `AIRLIGHT_GAIN` having been read off the slider
back when both terms shared one display-compressed scalar pinned at ≈1
for Earth. The ratio therefore **shifted** at the HDR conversion by the
albedo normalisation; `AIRLIGHT_GAIN` is still the knob if a body's limb
reads wrong against its disc, but check it against the disc rather than
in isolation.

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
3. *Terminator* — a hard lit/unlit sun test steps the multiscatter lit-fraction
   (`litSum / ATMO_N_VIEW`) and the single-scatter edge in `1/ATMO_N_VIEW`
   increments, drawing ~`ATMO_N_VIEW` brightness contours across the terminator
   that beat against the jitter into the dominant moiré. `stellata_sunLit`
   replaces the boolean with a **soft shadow** — lit unless a sample is both
   anti-sunward of the terminator plane and inside the shadow cylinder, smoothed
   over `SHADOW_SOFT` — so the lit-fraction is continuous and the contours are
   gone.

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
≈ 3 px — deliberately subtle, per the camera-anywhere honesty rule. The shell
is spherical even on oblate bodies (flattening ≤ 0.6 % for these four, far
below shell thickness). **Gas giants deliberately carry no shell**: their
fuzzy limb is already carried by the solidity-soft billboard edge at distance
and the cloud-deck maps up close, and none has a detached haze layer distinct
from the cloud deck at render scale.
