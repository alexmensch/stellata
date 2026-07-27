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
- `milkyway-column-pure.ts` — the density / dust profile constants the
  shader receives as uniforms, plus a CPU mirror of its raymarch. The
  calibration constants below are *derived* from this mirror rather than
  hand-tuned, and the shader's step counts are pinned against it.
- `milkyway-tuning.ts` — Milky Way section of the debug panel
  (surface-brightness anchor, density, extinction, reddening RGB
  sliders).
- `milkyway.test.ts` — HDR-seam uniform wiring, the surface-brightness
  calibration pins, and the GLSL↔TS raymarch-parameter drift guard.
- `milkyway-column-pure.test.ts` — quadrature convergence against dense
  reference marches, and the blast radius of the foreground dust column.

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

`GLOW_MAG_OFFSET` is **derived, not tuned**. The anchor is declarative —
`GC_BAND_REFERENCE_MAG_ARCSEC2 = 20.0`, the band-pixel reference in
`docs/science-hdr-pipeline.md` § 1 — and the offset is whatever puts the
Galactic-centre sightline (l = 0, b = 0) there:

```
GC_SIGHTLINE_COLUMN = sightlineColumn(Sol, l=0, b=0)   ≈ 2.640e4
GLOW_MAG_OFFSET     = 20.0 + 2.5·log10(column)         ≈ 31.054
```

`GC_SIGHTLINE_COLUMN` comes from the CPU mirror at the shipped densities
and 0.45 dust strength, so a profile edit moves both numbers together
instead of leaving a hand-pinned pair to disagree. Both are pinned in
`milkyway.test.ts`. **Change the anchor, not the offset** — H7 replaces
the single-point anchor with per-sightline published V photometry.

The gradient this implies: GC 20.0, anticentre plane 22.55, NGP 25.08.
Steeper than the real sky (NGP integrated starlight is ~23.5–24), and no
offset fixes that — it is a density-profile question (the disc's 300 pc
scale height, the single-component simplification). H7 also tunes
`DR_MAG` (`../hdr/README.md` § Operator), the lever that lifts the band
and the star field **together**.

Two facts worth having before touching the calibration:

- **The disc, not the bulge, dominates toward the Galactic centre** —
  ~77 % of the luminance-weighted column. The disc's
  `exp(−(R−R₀)/3000)` rise over a 23 kpc path to its back face outweighs
  the bulge's `density0 = 18` concentration over 10 kpc.
- **The 32-step in-volume march under-counts the GC column by 1.7 %**
  against a converged march (pinned). Deliberately left: `STEPS` is a
  visual + perf decision, and it biases the anchor H7 re-derives anyway.

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
Spergel-style thin-disc dust, `norm` set so `density × av_factor` at
(R₀, z = 0) is ≈ 0.15 mag/kpc, the canonical local extinction rate
(Schlegel/Finkbeiner/Davis 1998). Per step, opacity converts to
per-channel optical depth via CCM-derived reddening multipliers
`(0.76, 1.0, 1.35)` — red transmits most, blue extincts away — applied
with Beer-Lambert running attenuation including a half-step
self-shielding term. `setExtinctionStrength(x)` scales the dust
globally; default 0.45.

### Foreground dust — τ starts at the camera, not at the mesh

Each mesh's *emission* integration begins at its own front face, but the
dust slab does not begin there. For the disc from Sol this costs nothing
(the camera is inside it, so the march starts 1 pc out), but the camera
sits **outside the bulge proxy** — 3122 pc outside, along the sightline
where most of the extinction toward the Galactic centre lives. Seeding
`tauAccum` at the bulge boundary therefore emitted the bulge through no
foreground extinction at all.

`foregroundDustTau` pre-marches that span and seeds the accumulator.
It is **linear-midpoint, 16 steps**, not log-distributed like the
in-volume march: this integrand rises monotonically toward the *far* end
(the boundary), so log spacing would spend its samples at the wrong end
— 8 log steps under-count the in-plane column by 6 %, 16 linear steps by
0.01 %. Both that case and a grazing slab crossing outside the proxy are
pinned against dense reference marches in
`milkyway-column-pure.test.ts`.

Blast radius is narrow by construction: only a component the camera is
outside of pays anything, so sightlines that miss the bulge proxy
(anticentre, NGP) are bit-identical. The GC sightline dims 0.083 mag,
tapering to 0.017 mag by l = 30°.

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
