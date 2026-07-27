# Milky Way volumetric disc

`milkyway.ts` + `milkyway.{vert,frag}.glsl` render the integrated
surface brightness of unresolved Galactic stars by raymarching through
**two proxy meshes** anchored at the galactic centre — a flattened
disc (30 × 30 × 1.2 kpc envelope) and an oblate bulge (10 × 10 × 6 kpc
envelope), both rotated so their short axes align with NGP. Each
fragment ray-sphere-intersects its mesh in mesh-local frame, then
raymarches log-distributed steps from front-face entry (or the camera
position, if the camera is inside the mesh) to the back-face fragment,
accumulating emission with running dust extinction. The two meshes'
contributions add via additive blending. Default-on; URL `mw=0`
disables. Hidden in chart mode.

## Files

- `milkyway.ts` — volumetric disc + bulge renderer. Composes the two
  proxy meshes; owns the `setIsobar` chart-mode handoff (currently
  hides the meshes when chart engages).
- `milkyway.vert.glsl`, `milkyway.frag.glsl` — ray-sphere intersect +
  log-distributed raymarch, additive-blended.
- `milkyway-tuning.ts` — Milky Way section of the debug panel
  (surface-brightness anchor, density, extinction, reddening RGB
  sliders).
- `milkyway.test.ts` — HDR-seam uniform wiring + the surface-brightness
  calibration pins.

`galactic-coords.ts` (`GAL_TO_ICRS`, `GALACTIC_CENTRE_PC`) lives in
`../galactic/` and is imported here for the GC-anchored mesh
placement.

## Why a volumetric mesh, not a skybox

An earlier version (rev 1) put the integration in a 50 kpc
camera-anchored skybox sphere and marched camera→back-surface.
Mathematically defensible, but visually it was a "theatre backdrop":
the geometry doing the work was a 2D sphere enclosing the camera, so
flying past the bulge produced no parallax — the band reoriented in
odd ways and the disc never read as an actual 3D shape from outside.
The volumetric-mesh approach replaces the enclosing sphere with the
*actual disc shape*, so standard 3D rasterisation handles parallax by
construction. From outside, you see a flattened glowing lens; from
inside, the path length through the volume varies naturally with view
direction (long along the plane, short toward NGP) producing the right
band geometry.

## Density profiles

Constants baked into `milkyway.ts`; no runtime data loads.

- **Disc**: `density0 × exp(-(R-R₀)/3000pc) × exp(-|z|/300pc)` — single
  double-exponential thin-disc-like profile. The originally-planned
  Jurić thin/thick/halo decomposition was simplified out during
  iteration; the smooth single component reads convincingly enough
  that the extra components weren't worth the calibration cost.
- **Bulge**: `density0 × exp(-r'/1000pc)` where
  `r' = sqrt(R² + (z/q)²)` is the oblate-spheroid radius with q = 0.6.
  Simple exponential rather than McMillan's power-law-times-Gaussian
  — the latter produced too-tight a "ball" that read as point-source-
  like in iteration.

Each component multiplies a population colour pre-integration, so the
band's hue varies by line of sight. Defaults are visually calibrated:

- `DISC_COLOR` pale-lavender (171,168,223), `DENSITY0 = 1.5`
- `BULGE_COLOR` near-white-warm (255,246,237), `DENSITY0 = 18`

## Surface-brightness emission

The band emits into the scene-wide HDR unit (`../hdr/README.md` § Unit).
`colorAccum` is the raymarch's emission column in "density × pc ×
colour" units; `uGlowMagOffset` states the **V surface brightness a unit
column carries**, so the sightline's surface brightness and the flux
magnitude inside one pixel are

```
S    = uGlowMagOffset - 2.5·log10(column)      // mag/arcsec²
m_px = S - 2.5·log10(uOmegaPxArcsec2)
```

Feeding `m_px` back through `L = uExposure · 10^(−0.4·m_px)` collapses
the log round-trip to a **single scalar gain**
(`stellataSurfaceBrightnessLuminance`), applied to all three channels —
which is why the line-of-sight hue the raymarch built survives untouched.
`column` is the luminance-weighted `dot(colorAccum, LUMA_WEIGHTS)`, so
the magnitude means the same thing it does for a star.

**Surface brightness is the invariant, not per-pixel luminance.**
Zooming in shrinks `uOmegaPxArcsec2` quadratically, so the band dims
per pixel — the magnification loss a real aperture gain has to pay for,
and exactly how a resolved stellar disc behaves under the point-source
peak rule. `HdrPipeline.setPixelSolidAngle` owns the uniform; the shell
drives it from FOV changes and resize.

`uMaxAppMag` still arrives by reference from the star pipeline's shared
uniform map, but **only the chart-mode isobar reads it** — the band's
brightness is photometric now, so the magnitude slider reaches it
through `uExposure` (which H6 wires; until then it is pinned to the
naked-eye base epoch and the slider does not move the band).

### Calibration

`GLOW_MAG_OFFSET = 31.3` is **provisional**. It is anchored so the
Galactic-centre sightline (l = 0, b = 0), whose luminance-weighted
column integrates to `GC_SIGHTLINE_COLUMN = 2.85e4` at the shipped
densities and 0.45 dust strength, lands on S ≈ 20.2 mag/arcsec² — the
band-pixel reference in `docs/science-hdr-pipeline.md` § 1. The same
constant puts the anticentre plane near 22.8 and the NGP near 25.3,
i.e. the model's latitude gradient is steeper than the real sky's.
H7 re-derives it per sightline against published V photometry and tunes
`DR_MAG` (`../hdr/README.md` § Operator), which is the lever that lifts
the band and the star field **together**.

At strict physicality the band is faint: the GC sightline resolves to
~0.035 of full scale at the base epoch and a 50° / 900 px viewport,
against 0.15 for a threshold star. That is the design gate's predicted
"real suburban-sky band", not a regression.

The Local Group emission layer keeps the old gate + `1 − exp(−x)` scheme
until it is unshelved (`../local-group/README.md` § Emission layer).

## Coordinate handling

The mesh-local unit sphere has +X/+Y aligned with the galactic disc
plane, +Z toward NGP. `mesh.scale` extends to galactocentric pc per
axis (disc 15000×15000×600; bulge 5000×5000×3000). `mesh.quaternion =
GAL_TO_ICRS` rotates galactic axes into ICRS world axes. The shader
transforms `cameraPosition` (renderer-local) → galactocentric ICRS
(subtract `uGalCenter`) → galactocentric galactic (rotate by
`uIcrsToGal`) → mesh-local (divide by `uMeshScalePc`): that's
`camLocal`. Ray-sphere intersection in this frame yields entry t
(clamped ≥ 0 if camera is inside) and exit t = 1 (back-face fragment
is on the unit sphere by construction). 32 log-distributed steps run
from tEnter to 1, with `|vWorldPos - cameraPosition|` converting back
to world parsec step size for dust optical-depth maths.

## Analytical-only dust (no voxel sampling here)

Profile is `norm × exp(-(R-R₀)/3500pc) × exp(-|z|/125pc)` — Drimmel &
Spergel-style thin-disc dust. Per step, opacity converts to per-channel
optical depth via CCM-derived reddening multipliers `(0.76, 1.0, 1.35)`
— red transmits most, blue extincts away — applied with Beer-Lambert
running attenuation including a half-step self-shielding term.
`setExtinctionStrength(x)` scales the dust globally; default 0.45.

The Edenhofer dust voxel grid is **intentionally not sampled here**.
Voxels have ~5 pc native structure designed for short per-star
sightlines. Sampling at coarse step intervals along long camera →
fragment rays (8-15 kpc) aliases into visible parallel streaks
regardless of step distribution. Voxels stay in use for per-star
extinction in the star pipeline; molecular cloud ellipsoids carry the
discrete near-cloud detail in front of the band.

## Render path

Two meshes, both `THREE.BackSide`, additive blending, `depthTest =
true` (so close-range star cores can occlude this layer), `depthWrite
= false` (the glow never occludes anything later), `frustumCulled =
false` (the local bounding sphere is at origin but world position is
`GALACTIC_CENTRE_PC - worldOffset`). `renderOrder = -3` for both
meshes.

Both meshes draw into the HDR target, and both apply the operator
themselves when it isn't bound (`uHdrTarget = 0` — the shipped path while
the ship gate is false, `../hdr/README.md` § Fallback). They use the
**undithered** variant: the two components overlap on every band pixel
and the dither is a function of `fragCoord` alone, so it would land
twice.

The meshes are NOT camera-anchored — they sit at the galactic centre.
`update()` rebases each mesh's position to
`GALACTIC_CENTRE_PC - worldOffset` per frame so under the floating-
origin recentering both project correctly into the renderer-local
frame. The `vWorldPos - cameraPosition` subtraction in the shader is
float-stable for the same reason the star pipeline is: both operands
are renderer-local with small magnitudes.

## Chart mode + warp

Chart mode swaps the volumetric raymarch for a single-line **isobar
contour** along the magnitude limit (a thin ink line tracking "where
the integrated MW would equal the visible magnitude limit" reads as a
paper-atlas equivalent of the volumetric band). The contour rendering
is handled by chart-mode wiring; this layer's `setIsobar(true)` simply
hides the meshes. The band↔isobar swap is driven by the `milkyWayIsobar`
detail bind (chart floor), not chart-mode.ts directly — the group stays
enabled in chart because `applyMilkywayEnabled` permits either the band
or the isobar (`../scene/README.md` § Chart-content wiring).

Warp keeps the layer visible in dark mode — the band reorienting as
the camera flies past the GC is the realism payoff.

No FPS gate. Toggle via the panel checkbox or `mw=0` URL.

## Dev levers

`milkyway-tuning.ts` registers the Milky Way section of the debug
panel: linear sliders for `glowMagOffset` / `discDensity` /
`bulgeDensity` / `extinctionStrength` + colour pickers for disc + bulge
palette + three linear sliders for the reddening RGB multipliers.

The same setters are individually callable under
`stellata.milkywayLayer.*`:

- `setGlowMagOffset(x)` — surface-brightness anchor, mag/arcsec²
  (raise → dimmer). A calibration constant, not a user knob
- `setDiscDensity(x)` / `setBulgeDensity(x)` — per-component emission
- `setDiscColor(r,g,b)` / `setBulgeColor(r,g,b)` — pre-extinction
  palette
- `setExtinctionStrength(x)` — analytical dust τ multiplier
- `setReddeningRGB(r,g,b)` — per-channel τ multiplier (CCM-derived)
