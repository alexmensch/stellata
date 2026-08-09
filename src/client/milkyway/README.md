# Milky Way volumetric disc

`milkyway.ts` + `milkyway.{vert,frag}.glsl` render the integrated surface
brightness of unresolved Galactic stars by raymarching **two proxy meshes**
anchored at the galactic centre — a flattened disc (30 × 30 × 3.6 kpc
envelope) and an oblate bulge (10 × 10 × 6 kpc), both rotated so their short
axes align with NGP. Each fragment ray-sphere-intersects its mesh in
mesh-local frame, then marches log-distributed steps from front-face entry
(or the camera, if it is inside) to the back-face fragment, accumulating
emission with running dust extinction; the two meshes add via additive
blending. Default-on, no FPS gate; URL `mw=0` or the panel checkbox
disables. Hidden in chart mode.

## Files

- `milkyway.ts` — volumetric disc + bulge renderer. Composes the two proxy
  meshes; owns the `setIsobar` chart-mode handoff (which hides them).
- `milkyway.{vert,frag}.glsl` — ray-sphere intersect + log-distributed
  raymarch, additive-blended.
- `milkyway-column-pure.ts` — the density / dust profile constants the shader
  receives as uniforms, plus a CPU mirror of its raymarch. Owns the ρ₀ solve
  (`calibration/README.md`); the shader's step counts are pinned against the
  mirror.
- `calibration/` — the published photometry the solve runs on (M_V, B/T),
  the light ratio derived from it, and the two sightline checks it is
  graded against. Its own README.
- `milkyway-tuning.ts` — Milky Way section of the debug panel
  (surface-brightness anchor, density, extinction, reddening RGB
  sliders).
- `milkyway.test.ts` — HDR-seam wiring, calibration pins, GLSL↔TS drift.
- `milkyway-column-pure.test.ts` — quadrature convergence, dust blast radius.

`GAL_TO_ICRS` / `GALACTIC_CENTRE_PC` live in `../galactic/galactic-coords.ts`,
imported here for the GC-anchored mesh placement.

## Why a volumetric mesh, not a skybox

A rejected rev 1 integrated through a 50 kpc camera-anchored skybox sphere:
the geometry doing the work enclosed the camera, so flying past the bulge
produced no parallax and the disc never read as a 3D shape from outside.
Marching the *actual disc shape* hands parallax to standard rasterisation,
and the path length varies with view direction on its own.

## Density profiles

Constants baked into `milkyway.ts`; no runtime data loads.

- **Disc**: `density0 × exp(-(R-R₀)/3000pc) × (exp(-|z|/300pc) +
  0.04·exp(-|z|/900pc))` — thin plus thick, Bland-Hawthorn & Gerhard
  2016 § 5.1 (z_T = 900 ± 180 pc carrying f_ρ = 4 ± 2 % of the local
  density). It is for the **external** view — edge-on from the LMC or a
  few hundred kpc out, a galaxy without one reads as a hard-edged lens —
  and is **not** a high-latitude fix: it brightens the pole.

  Both components share a radial scale length, the one place this departs
  from the literature (`docs/science-galactic-structure.md` § Milky Way
  density profiles).

  `DISC_HALF_THICKNESS_PC` = 1800 is **two thick scale heights**, the
  same rule 600 pc followed against the thin one, and it clips 0.0183 mag
  of the vertical column where 600 clipped 0.158. `../galactic/` imports
  it for the disc wireframe, so the thickness rings move with the
  envelope.
- **Bulge**: `density0 × exp(-r'/1000pc)` where
  `r' = sqrt(R² + (z/q)²)` is the oblate-spheroid radius with q = 0.6.
  Simple exponential rather than McMillan's power-law-times-Gaussian
  — the latter produced too-tight a "ball" that read as point-source-
  like in iteration.

Each component multiplies a population colour pre-integration, so the
band's hue varies by line of sight — pale-lavender (171,168,223) for the
disc, near-white-warm (255,246,237) for the bulge. Neither carries flux,
and neither component has a hand-set weight any more: both `density0`
values are solved (`calibration/README.md`).

### Population tints carry hue, never flux

`DISC_COLOR_RGB` / `BULGE_COLOR_RGB` are the **authored palette**;
`DISC_TINT_RGB` / `BULGE_TINT_RGB` are what the shader and the CPU mirror
actually multiply, and they are the palette divided by its own relative
luminance (`lumaNormalisedTint`, `../hdr/emission/emission-pure.ts`).

The reason is that `stellataSurfaceBrightnessLuminance` is a *scalar* gain
applied per channel, so a tint whose relative luminance isn't 1 rescales
its own component's emission. The authored palette's two hues differ in
relative luminance by 1.433× — the bulge rode **0.390 mag brighter than
the disc purely because its hue is nearer white**, which moved the
bulge/disc flux split without touching either density. The solve now sets
that share outright at 0.0775 (`calibration/README.md`), so what it buys
is that a hue edit cannot move it back.

Two consequences a future session needs:

- **`setDiscColor` / `setBulgeColor` normalise their argument.** A colour
  picker cannot move flux. `getValues()` returns the *authored* colour, not
  the tint, because the tint's channels exceed 1 (the disc's blue sits at
  1.29) and an `<input type="color">` cannot round-trip that.
- **The Local Group layer seeds its family tints from the authored
  constants here** (`../local-group/local-group-emission-pure.ts`) and
  normalises them itself, so editing this palette moves both layers' hue.

The hues themselves are still **eyeballed, not photometric** — deriving
them from published population colour indices through the star pipeline's
Ballesteros → Planck → CIE path is open work. Because the tints are
normalised, that change cannot move any flux.

## Surface-brightness emission

The band emits into the scene-wide HDR unit (`../hdr/emission/README.md` § Unit).
`colorAccum` is the raymarch's emission column in "density × pc ×
colour" units; `uGlowMagOffset` carries `SB_ZERO_POINT`, the **V surface
brightness a unit column carries**, so the sightline reads

```
S    = uGlowMagOffset - 2.5·log10(column)      // mag/arcsec²
m    = S - 2.5·log10(Ω)
```

Feeding `m` back through `L = uExposure · 10^(−0.4·m)` collapses the log
round-trip to a **single scalar gain**
(`stellataSurfaceBrightnessLuminance`), applied to all three channels —
which is why the line-of-sight hue the raymarch built survives untouched.
`column` is the luminance-weighted `dot(colorAccum, LUMA_WEIGHTS)`, so
the magnitude means the same thing it does for a star.

**`Ω` is the eye's rod summation area, not the pixel's**
(`uOmegaSummationArcsec2`; `../hdr/emission/README.md` § Extended sources). An
extended source's threshold is a surface brightness, and the summation
area is fixed in angle — so the band holds its display level at every FOV
and viewport, where the pixel solid angle would have dimmed it
quadratically. The statistic attachment still takes `uOmegaPxArcsec2`: the
concession is a display anchor, not light.

**The gained value goes to attachment 2, and the resolve averages it over the
summation patch before compositing** (`../hdr/summation/README.md`). From Sol
that average is an identity — the band's structure scale is degrees and the
kernel is normalised — so the table below survives by construction, not to a
tolerance. It happens for the Local Group, whose objects are *not* uniform
over the patch; one shared anchor is what makes the Galaxy from outside
comparable with anything beside it.

`uLimitMag` still arrives by reference from the star pipeline's shared
uniform map, but **only the chart-mode isobar reads it** — the band's
brightness is photometric now, so the exposure model reaches it through
`uExposure` instead (`../hdr/exposure/README.md`). The band therefore
brightens and dims in lockstep with the star field: a deeper instrument,
the automatic adaptation cut and the manual EV trim all move it and the
stars together, by construction.

**The photometric calibration has its own folder and README**
(`calibration/`): what `density0` is solved against, how the V-band light
B/T is derived from a published mass ratio, the two Leinert checks the
result is graded by, and the sightline table those produce.

## Coordinate handling

The mesh-local unit sphere has +X/+Y in the disc plane and +Z toward NGP;
`mesh.scale` extends it to galactocentric pc per axis (disc
15000×15000×1800, bulge 5000×5000×3000) and `mesh.quaternion = GAL_TO_ICRS`
rotates galactic axes into ICRS world axes. The shader chains
`cameraPosition` (renderer-local) → subtract `uGalCenter` → rotate by
`uIcrsToGal` → divide by `uMeshScalePc` to reach `camLocal`,
ray-sphere-intersects there (entry t clamped ≥ 0 when inside, exit t = 1 by
construction), and marches 32 log-distributed steps —
`|vWorldPos - cameraPosition|` gives the world parsec step size the
optical-depth maths needs.

## Analytical-only dust (no voxel sampling here)

Profile is `norm × exp(-(R-R₀)/3500pc) × exp(-|z|/125pc)` — Drimmel &
Spergel-style thin-disc dust. Per step, opacity converts to per-channel
optical depth via CCM-derived reddening multipliers `(0.76, 1.0, 1.35)` —
red transmits most, blue extincts away — applied with Beer-Lambert
running attenuation including a half-step self-shielding term.

**`norm` is derived from a declarative rate**, the same pattern the
emissivity uses: `LOCAL_DUST_RATE_MAG_PER_KPC = 1.0` is the V-band
extinction the slab produces per kpc at (R₀, z = 0), and
`ANALYTICAL_DUST_NORM_PER_PC` is whatever realises it. Argue with the
rate, not the norm.

1.0 mag/kpc is the top of the range commonly adopted for the
solar-neighbourhood plane (0.7–1.0; the historical low-|b| figure runs to
1.8). Two independent constraints meet at that value: the 125 pc scale
height ties the plane rate to the perpendicular column, and 1.0 mag/kpc
puts the pole at A_V = 0.125, inside the SFD polar spread (~0.03–0.15).

**What this replaced was wrong by an order of magnitude and mis-cited** —
0.0679 mag/kpc attributed to SFD 1998, a 2D E(B−V) map publishing no
per-kpc rate at all. That under-extinction, not the density profile, is
why the plane read ~3 mag too bright against the poles.
`setExtinctionStrength(x)` defaults to **1.0** and is a dev lever, not a
calibration term: anything else contradicts that anchor.

**Overlap with the molecular-cloud layer is known and quantified.** The
clouds (`../molecular-clouds/README.md`) multiply the same band pixels and
this slab carries a total rate, not a diffuse-only one, so the two
double-count wherever a rendered cloud sits: the clouds cover 15.4 % of the
sky and add 0.309 mag A_V there against 0.031 from this slab inside their
own 2.5 kpc volume, costing ~0.006 mag sky-mean and ~0.05 mag toward the
GC. Deliberately **not** partitioned by a molecular-fraction factor — the
clouds are local while this slab spans the Galaxy, so scaling it down
globally would under-extinct the far disc where nothing is rendered to
make up the difference: a ~3 mag error to avoid a ~0.05 mag one.

### Foreground dust — τ starts at the camera, not at the mesh

Each mesh's *emission* integration begins at its own front face, but the
dust slab does not. For the disc from Sol this costs nothing (the camera
is inside it, so the march starts 1 pc out), but the camera sits **3122 pc
outside the bulge proxy**, along the sightline where most of the
extinction toward the Galactic centre lives — so seeding `tauAccum` at the
bulge boundary emitted the bulge through no foreground extinction at
all.

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
(anticentre, NGP) are bit-identical. The GC sightline dims 0.013 mag,
tapering to 0.011 mag by l = 30° (pinned).

The Edenhofer dust voxel grid is **intentionally not sampled here**: its
~5 pc native structure is designed for short per-star sightlines, and
sampling at coarse step intervals along 8–15 kpc camera→fragment rays
aliases into visible parallel streaks whatever the step distribution.
Voxels stay in use for per-star extinction in the star pipeline;
molecular-cloud ellipsoids carry the discrete near-cloud detail in front
of the band.

## Render path

Two meshes, both `THREE.BackSide`, additive blending, `depthTest =
true` (so close-range star cores can occlude this layer), `depthWrite
= false` (the glow never occludes anything later), `frustumCulled =
false` (the local bounding sphere is at origin but world position is
`GALACTIC_CENTRE_PC - worldOffset`). `renderOrder = -3` for both
meshes.

Both meshes draw into the HDR target's **diffuse** attachment, and into the
statistic attachment where the band's surface brightness is both the flux and
the peak channel (`../hdr/attachments/README.md`). Neither writes attachment 0
on-target: the resolve owns that pixel once it has averaged the diffuse
attachment over the summation patch. Off-target both apply the operator
themselves over the pixel solid angle (`uHdrTarget = 0`, the float-RT
fallback and the A/B — `../hdr/README.md` § Fallback), in the **undithered**
variant: the two components overlap on every band pixel and the dither is a
function of `fragCoord` alone, so it would land twice.

The meshes are NOT camera-anchored — they sit at the galactic centre.
`update()` rebases each mesh's position to
`GALACTIC_CENTRE_PC - worldOffset` per frame so under the floating-
origin recentering both project correctly into the renderer-local
frame. The `vWorldPos - cameraPosition` subtraction in the shader is
float-stable for the same reason the star pipeline is: both operands
are renderer-local with small magnitudes.

## Chart mode + warp

**Chart mode currently renders no Milky Way at all.** `setIsobar(true)`
sets `uChartIsobar = 1`, switches both materials to `NormalBlending`, and
then hides both meshes — so the fragment shader's `fwidth`-normalised
contour branch is unreachable. The branch is written and the uniforms are
plumbed; only the draw is suppressed, pending the treatment.

**Its physics is settled.** The contour is evaluated on **surface
brightness `S`** — no Ω_px term, so the line is FOV- and
viewport-invariant, which is what a chart wants — against the
extended-source threshold `stellataExtendedThresholdSb` recovers from
`uOmegaSummationArcsec2` (22.0 mag/arcsec² at the shipped instrument).
The chart-mode treatment and un-hiding the meshes are still open work.

The band↔isobar swap is driven by the `milkyWayIsobar` detail bind (chart
floor), not chart-mode.ts directly — the group stays enabled in chart
because `applyMilkywayEnabled` permits either the band or the isobar
(`../scene/README.md` § Chart-content wiring).

Warp keeps the layer visible in dark mode — the band reorienting as the
camera flies past the GC is the realism payoff.

## Dev levers

`milkyway-tuning.ts` registers the panel section — sliders for
`glowMagOffset`, `discDensity`, `bulgeDensity`, `extinctionStrength` and the
three reddening RGB multipliers, plus both palette colour pickers. Every one
is also callable as `stellata.milkyway.set<Name>(...)`.

Two are not knobs despite the slider: `setGlowMagOffset` desynchronises the
band from the Local Group layer (both read the one zero point), and
`setExtinctionStrength` at anything but 1.0 contradicts the dust anchor
(§ Analytical-only dust). The colour setters luma-normalise on write, so a
hue edit cannot move flux (§ Population tints carry hue, never flux).
