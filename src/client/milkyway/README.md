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
- `milkyway-column-pure.ts` — the density / dust profile constants the
  shader receives as uniforms, plus a CPU mirror of its raymarch. Owns the
  ρ₀ solve (§ Calibration); the shader's step counts are pinned against the
  mirror.
- `diffuse-reference.ts` — the published photometry the solve runs on
  (M_V, B/T) and the two sightline checks it is graded against
  (§ Calibration).
- `milkyway-tuning.ts` — Milky Way section of the debug panel
  (surface-brightness anchor, density, extinction, reddening RGB
  sliders).
- `milkyway.test.ts` — HDR-seam uniform wiring, the surface-brightness
  calibration pins, and the GLSL↔TS raymarch-parameter drift guard.
- `milkyway-column-pure.test.ts` — quadrature convergence against dense
  reference marches, and the blast radius of the foreground dust column.

`galactic-coords.ts` (`GAL_TO_ICRS`, `GALACTIC_CENTRE_PC`) lives in
`../galactic/`, imported here for the GC-anchored mesh placement.

## Why a volumetric mesh, not a skybox

A rejected rev 1 integrated through a 50 kpc camera-anchored skybox sphere.
The geometry doing the work enclosed the camera, so flying past the bulge
produced no parallax and the disc never read as a 3D shape from outside.
Marching the *actual disc shape* hands parallax to standard rasterisation,
and the path length then varies with view direction on its own.

## Density profiles

Constants baked into `milkyway.ts`; no runtime data loads.

- **Disc**: `density0 × exp(-(R-R₀)/3000pc) × (exp(-|z|/300pc) +
  0.04·exp(-|z|/900pc))` — thin plus thick, Bland-Hawthorn & Gerhard
  2016 § 5.1 (z_T = 900 ± 180 pc carrying f_ρ = 4 ± 2 % of the local
  density). It is for the **external** view — edge-on from the LMC or a
  few hundred kpc out, a galaxy without one reads as a hard-edged lens —
  and is **not** a high-latitude fix: it brightens the pole.

  Both components share a radial scale length, which is where the model
  departs from the literature (`docs/science-galactic-structure.md`
  § Milky Way density profiles).

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
values are solved (§ Calibration).

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
bulge/disc flux split without touching either density. Normalising dropped
the bulge's share of the luminance-weighted total from 0.361 to 0.283;
the solve now sets it outright at 0.150 (§ Calibration), so what
normalisation buys is that a hue edit cannot move it back.

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

**The gained value goes to attachment 2, and the resolve averages it over
the summation patch before compositing** (`../hdr/summation/README.md`). From
Sol that average returns the field unchanged — the band's structure scale is
degrees and a normalised kernel is an identity on a uniform field, so the
table below survives by construction, not to a tolerance. It happens for the
Local Group's sake: its objects are *not* uniform over the patch, and
averaging is what lets both layers share one anchor and makes the Galaxy seen
from outside comparable with anything beside it.

`uLimitMag` still arrives by reference from the star pipeline's shared
uniform map, but **only the chart-mode isobar reads it** — the band's
brightness is photometric now, so the exposure model reaches it through
`uExposure` instead (`../hdr/exposure/README.md`). The band therefore
brightens and dims in lockstep with the star field: a deeper instrument,
the automatic adaptation cut and the manual EV trim all move it and the
stars together, by construction.

### Calibration

**The zero point is not the band's own — it is the emission unit's.**
`SB_ZERO_POINT` (`../hdr/emission/emission-pure.ts`) = 26.5721 mag/arcsec²,
shared verbatim with the Local Group layer. A raymarched column is flux per
steradian once `density0` sits in zero-point-free flux units, so nothing
about the conversion is free.

What the layer derives is each component's `density0`, through the same
`ρ₀ = d²·F/G` the Local Group solves per object
(`../hdr/emission/README.md` § Solving ρ₀) — here with **d = 10 pc**,
because the anchor is an *absolute* magnitude:

```
DISC_DENSITY0  = 100·10^(−0.4·M_V)·(1 − B/T) / ∫ discShape  dV ≈ 5.651e−2
BULGE_DENSITY0 = 100·10^(−0.4·M_V)·     B/T  / ∫ bulgeShape dV ≈ 4.013e−1
```

`GALAXY_TOTAL_ABSMAG_V` = **−21.37** (BHG16 Table 2) and
`BULGE_TO_TOTAL_V` = **0.150** (Licquia & Newman 2015, in stellar *mass*
— an upper bound on the V-band value). **Zero free parameters, and no
march feeds the calibration.**

Three properties a change here must keep:

- **The shape integrals may not reach a `density0`.** `discShape` /
  `bulgeShape` are the profiles at unit ρ₀ — the integrals march *those*,
  the density functions multiply the solved constant on top. ρ₀ is a scale,
  **not** a point emissivity: the disc's vertical term is 1.04 at the
  midplane, so `DISC_DENSITY0` sits 4 % above (R₀, 0).
- **The scalar volume integral is the LUMINANCE integral**, because both
  tints are luma-normalised (§ Population tints). That is what lets one
  flux total be split between two hues without either moving light.
- **Truncation compensation is inherent.** G is over the ACTUAL proxy
  volume, so the **0.076 mag** the disc envelope clips against all space is
  redistributed inward — a tighter envelope *brightens* what remains. Mostly
  radial, against 0.018 mag vertical (§ Density profiles), and one ellipsoid
  does not separate into the two — the pin is the all-space closed form.

**Solved dust-free, and that is the point.** An earlier design derived the
zero point *through* the shipped extinction, so the photometric scale swung
2.7 mag across the dust knob — including at the poles, where there is no
dust. Emissivity is intrinsic and `GALAXY_TOTAL_ABSMAG_V` is itself
internal-extinction-corrected; `milkyway.test.ts` pins the independence.

#### Two checks, and both disagree by the same sign and order

Neither is an anchor. Both are pinned in `milkyway.test.ts`.

| check | published | model | model is |
| --- | --- | --- | --- |
| NGP diffuse residual | 24.99 | 23.40 | **1.587 mag brighter** |
| Galactic centre, Leinert total | 22.92 | 21.98 | **0.936 mag brighter** |

The 24.99 is *not* published; `diffuse-reference.ts` builds it:

| | mag/arcsec² |
| --- | --- |
| Leinert et al. 1998 Table 24, NGP — **total** starlight | 23.83 |
| The 329,657 catalogue stars Stellata already draws | 24.286 |
| Residual left for the diffuse band | **24.99** |

Leinert's table is a sky model (Wainscoat et al. 1992) for *all* stars,
resolved or not, so pinning the published figure would double-count the
star field — the retired `GC_BAND_REFERENCE_MAG_ARCSEC2 = 20.0` anchor's
exact defect. The GC row is graded against the total rather than a
residual because the catalogue's GC entry is de-extincted while the real
column is ~30 mag: `diffuseResidualMagArcsec2` returns `null` for that
pair deliberately, and folding it in would only widen the gap.

**The two constraints cannot both be met, and no shape parameter bridges
them** — the argument is `docs/science-galactic-structure.md` § The
luminosity solve. The total wins because it is what the camera sees from
outside: the Galaxy from M31 reads 3.08 against M31 from Sol at 3.44,
ordered correctly, where the sightline anchor had it 1.11 mag *fainter*
than M31 — the cross-layer symptom `stellata-xypg` opened on. The cost is
at the pole: diffuse + catalogue reads 23.07 against Leinert's 23.83.
The eso0932a panorama sides with the total (`docs/science-hdr-pipeline.md` § 8).

#### The gradient this produces, and what it reads on screen

Levels are of 255 at the base epoch, no EV trim, no viewport — the
summation area is fixed in angle. All pinned in `milkyway.test.ts`.

**`Δ` is `S − S_lim`** against the 22.0 extended threshold, a plain
subtraction. Don't restate it as a ratio of the levels: those are
tone-mapped and encoded, so `2.5·log10` of one reads ~0.5 mag shy at the
pole. A threshold star also lands on 38.25, so `/255` doubles as "against
a just-visible star".

| sightline | mag/arcsec² | Δ vs S_lim | /255 |
| --- | --- | --- | --- |
| l = 0, b = 5 | 20.71 | **1.29 OVER** — the maximum | 70.3 |
| l = 0, b = 0 (GC) | 21.98 | 0.02 over | 38.6 |
| anticentre | 22.16 | 0.16 under | 34.4 |
| b = 30 | 22.61 | 0.61 under | 18.5 |
| NGP | 23.49 | 1.49 under | 0.5 |

Plane-to-pole contrast **1.51 mag** photometrically. **The midplane is
not the maximum** — b ≈ 5° is, because the in-plane sightline eats the
most dust. The real band behaves the same way; the dark rift is dust,
not a gap in the stars. Pinned in `milkyway.test.ts`.

**Sub-threshold rows carry the operator's faint-end toe** (`../hdr/README.md`
§ Operator): over-threshold levels are untouched, and 1.5 mag under
threshold is black by construction — the NGP at 1.49 under sits on the
dither floor instead of 15.6/255. Nothing pins the band to the threshold.

Two facts worth having before touching this:

- **The bulge is invisible from Sol in V.** It sits behind 4.6 τ_V before
  its own march begins, so the disc carries 99.96 % of the GC column.
  Everything the band shows toward the centre is foreground disc — which
  is what the real sky looks like.
- **The 32-step in-volume march under-counts the GC column by 1.6 %**
  against a converged march (pinned). Deliberately left: `STEPS` is a
  visual + perf decision, and it cannot bias the calibration at all — the
  solve is a volume integral, so no march feeds it.

Under the sightline anchor the same rows ran 35.95 / 14.76 / 12.85 / 8.66
/ 3.86 — the solve is 1.6 mag brighter everywhere. The retired per-pixel
mapping before that is `docs/science-hdr-pipeline.md` § 1.

**The convolution and the footprint softening both leave this table where it
is** — the first is an identity on a uniform field, the second is metres
against a 300 pc scale height from inside the disc. Every row moves under
0.003 mag at both FOV extremes (pinned). Neither is inert from *outside* the
Galaxy, which is where they were needed.

**Do not raise or lower the emissivity if the band still reads wrong** —
it is solved against a published luminosity and carries no slack.
`DR_MAG` cannot do it either: it lifts the band and the star field
together, so it has no term for a point-vs-extended ratio. The lever is
the extended-source threshold itself, which is the instrument's
`skyBackgroundMagArcsec2` (`../hdr/emission/README.md` § Extended sources).

The Local Group emission layer runs the same mapping, the same constant
(`../local-group/README.md` § Zero free parameters) and now the same
solve. The two layers are one unit system: same zero point, same
`stellataSurfaceBrightnessLuminance` gain, same `ρ₀ = d²·F/G`, both
mag/arcsec² in one exposure. All that differs is which magnitude goes in
— LG a catalogue *apparent* one at each object's own distance, the band a
published *absolute* one at 10 pc.

## Coordinate handling

The mesh-local unit sphere has +X/+Y aligned with the galactic disc
plane, +Z toward NGP. `mesh.scale` extends to galactocentric pc per
axis (disc 15000×15000×1800; bulge 5000×5000×3000). `mesh.quaternion =
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

**What this replaced was wrong by an order of magnitude and mis-cited** —
0.0679 mag/kpc attributed to SFD 1998, a 2D E(B−V) map publishing no
per-kpc rate at all. That under-extinction, not the density profile, is
why the plane read ~3 mag too bright against the poles.

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
(anticentre, NGP) are bit-identical. The GC sightline dims 0.028 mag,
tapering to 0.024 mag by l = 30° (pinned).

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
`stellata-xypg.22` still owns the treatment and un-hiding the meshes.

The band↔isobar swap is driven by the `milkyWayIsobar` detail bind (chart
floor), not chart-mode.ts directly — the group stays enabled in chart
because `applyMilkywayEnabled` permits either the band or the isobar
(`../scene/README.md` § Chart-content wiring).

Warp keeps the layer visible in dark mode — the band reorienting as
the camera flies past the GC is the realism payoff.

## Dev levers

`milkyway-tuning.ts` registers the panel section — sliders for
`glowMagOffset`, `discDensity`, `bulgeDensity`, `extinctionStrength` and the
three reddening RGB multipliers, plus both palette colour pickers. Every one
is also callable as `stellata.milkyway.set<Name>(...)`.

Two of them are not knobs despite the slider. `setGlowMagOffset` moves the
shared emission unit's zero point, so it desynchronises the band from the
Local Group layer; `setExtinctionStrength` at anything but 1.0 means the
shipped extinction disagrees with its own stated anchor
(§ Analytical-only dust). The colour setters luma-normalise on write, so a
hue edit cannot move flux (§ Population tints carry hue, never flux).
