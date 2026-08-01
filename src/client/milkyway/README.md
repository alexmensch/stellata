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
- `diffuse-reference.ts` — published integrated-starlight photometry and
  the resolved-star subtraction that turns it into a target for a diffuse
  layer (§ Calibration).
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
  iteration. It is **not** a high-latitude deficit: measured against the
  resolved-star-corrected residual the pole is right to 0.08 mag
  (§ Calibration), so a thick-disc term would make it slightly worse.
  The case for adding one is external-viewpoint realism — an edge-on
  Galaxy with no thick disc reads wrong from outside — and that is
  `stellata-xypg.32`.
- **Bulge**: `density0 × exp(-r'/1000pc)` where
  `r' = sqrt(R² + (z/q)²)` is the oblate-spheroid radius with q = 0.6.
  Simple exponential rather than McMillan's power-law-times-Gaussian
  — the latter produced too-tight a "ball" that read as point-source-
  like in iteration.

Each component multiplies a population colour pre-integration, so the
band's hue varies by line of sight. Defaults are visually calibrated:

- `DISC_COLOR` pale-lavender (171,168,223), `DISC_WEIGHT = 1.5`
- `BULGE_COLOR` near-white-warm (255,246,237), `BULGE_WEIGHT = 18`

The two weights are **relative**; `EMISSIVITY_SCALE` puts them in the
shared flux unit (§ Calibration). Their ratio is the bulge/disc split and
is still visually chosen — Licquia & Newman 2015 give B/T = 0.150
(+0.028/−0.019) in stellar *mass*, which is the closest published anchor
and an upper bound on the V-band value (the bulge's older, more
metal-rich population carries a higher Υ\*_V). `stellata-xypg.29`'s
deferred M_V solve owns replacing it.

### Population tints carry hue, never flux

`DISC_COLOR_RGB` / `BULGE_COLOR_RGB` are the **authored palette**;
`DISC_TINT_RGB` / `BULGE_TINT_RGB` are what the shader and the CPU mirror
actually multiply, and they are the palette divided by its own relative
luminance (`lumaNormalisedTint`, `../hdr/emission-pure.ts`).

The reason is that `stellataSurfaceBrightnessLuminance` is a *scalar* gain
applied per channel, so a tint whose relative luminance isn't 1 rescales
its own component's emission. The authored palette's two hues differ in
relative luminance by 1.433× — the bulge rode **0.390 mag brighter than
the disc purely because its hue is nearer white**, which moved the
bulge/disc flux split without touching either density. Normalising drops
the bulge's share of the luminance-weighted total from 0.361 to 0.283
against a literature ~0.15–0.20; the remainder is the weight ratio, which
the deferred M_V solve owns (§ Calibration).

Two consequences a future session needs:

- **`setDiscColor` / `setBulgeColor` normalise their argument.** A colour
  picker cannot move flux. `getValues()` returns the *authored* colour, not
  the tint, because the tint's channels exceed 1 (the disc's blue sits at
  1.29) and an `<input type="color">` cannot round-trip that.
- **The Local Group layer seeds its family tints from the authored
  constants here** (`../local-group/local-group-emission-pure.ts`) and
  normalises them itself, so editing this palette moves both layers' hue.
  `stellata-gxx.9` owns the per-object LG colours.

The hues themselves are still **eyeballed, not photometric** — deriving
them from published population colour indices through the star pipeline's
Ballesteros → Planck → CIE path is the open half of `stellata-xypg.30`.
Because the tints are normalised, that change cannot move any flux.

## Surface-brightness emission

The band emits into the scene-wide HDR unit (`../hdr/README.md` § Unit).
`colorAccum` is the raymarch's emission column in "density × pc ×
colour" units; `uGlowMagOffset` carries `SB_ZERO_POINT`, the **V surface
brightness a unit column carries**, so the sightline's surface brightness
and the flux magnitude inside one pixel are

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

`uLimitMag` still arrives by reference from the star pipeline's shared
uniform map, but **only the chart-mode isobar reads it** — the band's
brightness is photometric now, so the exposure model reaches it through
`uExposure` instead (`../hdr/exposure/README.md`). The band therefore
brightens and dims in lockstep with the star field: a deeper instrument,
the automatic adaptation cut and the manual EV trim all move it and the
stars together, by construction.

### Calibration

**The zero point is not the band's own — it is the emission unit's.**
`SB_ZERO_POINT` (`../hdr/emission-pure.ts`) = 26.5721 mag/arcsec², the
magnitude of one arcsec², shared verbatim with the Local Group layer. A
raymarched column is flux per steradian once `density0` sits in
zero-point-free flux units, so nothing about the conversion is free.

What the layer derives instead is `EMISSIVITY_SCALE`, the multiplier
taking the two components' **relative weights** (`DISC_WEIGHT = 1.5`,
`BULGE_WEIGHT = 18`) into that unit:

```
EMISSIVITY_SCALE = 10^(−0.4·(NGP_DIFFUSE_RESIDUAL − SB_ZERO_POINT))
                 / sightlineColumn(Sol, b=90, dust-free, scale=1)
DISC_DENSITY0    = DISC_WEIGHT  × EMISSIVITY_SCALE   ≈ 1.759e−2
BULGE_DENSITY0   = BULGE_WEIGHT × EMISSIVITY_SCALE   ≈ 2.111e−1
```

**Marched dust-free, and that is the point.** The previous design derived
the zero point *through* the shipped extinction, so the layer's entire
photometric scale swung 2.7 mag across the dust knob — including at the
poles, where there is essentially no dust. Emissivity is intrinsic;
extinction attenuates it at render time. `milkyway.test.ts` pins the
independence directly.

#### The anchor subtracts the star field

`NGP_DIFFUSE_RESIDUAL_MAG_ARCSEC2` = **24.99**, and it is *not* a
published number. `diffuse-reference.ts` builds it:

| | mag/arcsec² |
| --- | --- |
| Leinert et al. 1998 Table 24, NGP — **total** starlight | 23.83 |
| The 329,656 catalogue stars Stellata already draws | 24.286 |
| Residual left for the diffuse band | **24.99** |

Leinert's table is a sky model (Wainscoat et al. 1992) for *all* stars,
resolved or not. The star pipeline draws two thirds of that light at the
pole as individual quads, so **pinning the published figure would
double-count the star field** — which is exactly what the retired
`GC_BAND_REFERENCE_MAG_ARCSEC2 = 20.0` anchor did, and why the model
looked "1.17 mag too faint at the NGP" when it was in fact correct there.

The NGP is the anchor sightline because it is the only one where the two
inputs are commensurable: pole extinction is ~0.03 mag, so a de-extincted
catalogue sum and an observed sky model agree well inside their own
uncertainties. Toward the Galactic centre the real column is ~30 mag and
the same subtraction is meaningless — `diffuseResidualMagArcsec2` returns
`null` for that pair rather than a plausible-looking number.

**Interim, deliberately.** One sightline still does not constrain a total
luminosity. `stellata-xypg.29` deferred the solve against the Galaxy's
integrated M_V (Bland-Hawthorn & Gerhard 2016 give −21.37, with a real
0.5–0.9 mag spread across older direct-integration values) until the
extinction was right, because solving emissivity against a slab that was
an order of magnitude thin bakes the attenuation error into the
luminosity. The resolved catalogue is only **0.205 %** of the Galaxy's
light (integrated M_V = −14.65), so that solve can ignore the double
count entirely — the two numbers are large and negligible for different
reasons.

#### The gradient this produces

| sightline | mag/arcsec² |
| --- | --- |
| l = 0, b = 0 (GC) | 23.29 |
| l = 0, b = 5 | 22.01 |
| anticentre | 23.47 |
| b = 30 | 24.26 |
| NGP | 25.07 |

Plane-to-pole contrast **1.78 mag**, against 5.00 before. **The midplane
is not the maximum** — b ≈ 5° is, because the in-plane sightline eats the
most dust. The real band behaves the same way; the dark rift is dust, not
a gap in the stars. Pinned in `milkyway.test.ts`.

Two facts worth having before touching this:

- **The bulge is invisible from Sol in V.** It sits behind 4.6 τ_V before
  its own march begins, so the disc carries 99.93 % of the GC column.
  Everything the band shows toward the centre is foreground disc — which
  is what the real sky looks like.
- **The 32-step in-volume march under-counts the GC column by 1.6 %**
  against a converged march (pinned). Deliberately left: `STEPS` is a
  visual + perf decision, and it no longer biases the calibration — the
  anchor is the NGP sightline, where the log distribution converges.

**The band is faint at the base epoch, and more so than before.** The GC
sightline resolves to ~0.0066 of full scale at a 50° / 900 px viewport
against 0.15 for a threshold star — inside the range the resolve's dither
breaks up, but under the 4/255 the old 0.45-strength calibration reached.
`DR_MAG` (`../hdr/README.md` § Operator) is the lever, and it lifts the
band and the star field **together**; `stellata-xypg.7` owns tuning it
against eso0932a. **Do not raise the emissivity to compensate** — that
puts the pole back above its measured residual.

The Local Group emission layer runs the same mapping and now the same
constant (`../local-group/README.md` § Zero free parameters). The two
layers are one unit system: same zero point, same
`stellataSurfaceBrightnessLuminance` gain, both mag/arcsec² in one
exposure. What still differs is how each got its `density0` — LG solves
per object against catalogue total flux, the band against one corrected
sightline.

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

**What this replaced was wrong by an order of magnitude and mis-cited.**
The previous norm gave 0.1508 mag/kpc — 0.0679 after a bare 0.45
multiplier — attributed to Schlegel, Finkbeiner & Davis 1998. SFD is a 2D
full-sky E(B−V) map; it publishes no per-kpc rate at all. The
under-extinction was the single largest error in the layer: it is why the
plane read ~3 mag too bright against the poles, not the density profile.

`setExtinctionStrength(x)` scales the dust globally and **defaults to
1.0**. It is a dev lever, not a calibration term — anything but 1 means
the shipped extinction disagrees with its own stated anchor.

**Overlap with the molecular-cloud layer is known and quantified.** The
clouds (`../molecular-clouds/README.md`) multiply the same band pixels,
and this slab is normalised to a total rate rather than a diffuse-only
one, so the two double-count wherever a rendered cloud sits. Measured:
the clouds cover 15.4 % of the sky and add 0.309 mag A_V there against
0.031 from this slab inside their own 2.5 kpc volume, so the overlap
costs ~0.006 mag sky-mean and ~0.05 mag toward the GC. Deliberately **not**
partitioned by a molecular-fraction factor: the clouds are local while
this slab spans the Galaxy, so scaling it down globally would
under-extinct the far disc, where nothing is rendered to make up the
difference — a ~3 mag error to avoid a ~0.05 mag one.

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

Both meshes draw into the HDR target — into its statistic attachment too,
where the band's surface brightness is both the flux and the peak channel
(`../hdr/statistic/README.md`) — and both apply the operator themselves
when it isn't bound (`uHdrTarget = 0` — the shipped path while
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

**Chart mode currently renders no Milky Way at all.** `setIsobar(true)`
sets `uChartIsobar = 1`, switches both materials to `NormalBlending`, and
then hides both meshes — so the fragment shader's isobar branch
(`milkyway.frag.glsl`, the `fwidth`-normalised contour at
`magPx == uLimitMag`) is unreachable. The branch is written and the
uniforms are plumbed; only the draw is suppressed, pending the contour
treatment.

Two things a future session needs before re-enabling it, both in
`stellata-xypg.22`: the contour must be evaluated on **surface brightness
`S`**, not on the Ω_px-dependent `magPx`, or the line moves when the
camera zooms — wrong for a chart. And the threshold it compares against
is an *extended-source* limit (~21.5–22 mag/arcsec² for a dark-adapted
eye), which is a different quantity from the instrument's point-source
`m_lim`, because rod spatial summation integrates an extended source over
many receptors.

The band↔isobar swap is driven by the `milkyWayIsobar` detail bind (chart
floor), not chart-mode.ts directly — the group stays enabled in chart
because `applyMilkywayEnabled` permits either the band or the isobar
(`../scene/README.md` § Chart-content wiring).

Warp keeps the layer visible in dark mode — the band reorienting as
the camera flies past the GC is the realism payoff.

No FPS gate. Toggle via the panel checkbox or `mw=0` URL.

## Dev levers

`milkyway-tuning.ts` registers the Milky Way section of the debug
panel: linear sliders for `glowMagOffset` / `discDensity` /
`bulgeDensity` / `extinctionStrength` + colour pickers for disc + bulge
palette + three linear sliders for the reddening RGB multipliers.

The same setters are individually callable under
`stellata.milkyway.*`:

- `setGlowMagOffset(x)` — surface-brightness zero point, mag/arcsec²
  (raise → dimmer). A constant of the shared emission unit, not a user
  knob — moving it desynchronises the band from the Local Group layer
- `setDiscDensity(x)` / `setBulgeDensity(x)` — per-component emission
- `setDiscColor(r,g,b)` / `setBulgeColor(r,g,b)` — pre-extinction
  palette. Luma-normalised on write, so a hue edit cannot move flux
  (§ Population tints carry hue, never flux)
- `setExtinctionStrength(x)` — analytical dust τ multiplier; 1.0 is the
  calibrated rate (§ Analytical-only dust)
- `setReddeningRGB(r,g,b)` — per-channel τ multiplier (CCM-derived)
