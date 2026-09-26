# Milky Way volumetric disc

`milkyway.ts` renders the integrated surface brightness of unresolved Galactic stars by raymarching **two proxy meshes**
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
- `band-materials.ts` (+ test, + mock) — the material seam: the neutral
  `BandMaterials` contract, the `BandSharedSlots` group both components
  hold by reference, and the seeder that starts it ([The material seam](#the-material-seam)).
  The graph is `../webgpu/milkyway/milkyway-band-tsl.ts`.
- `column/` — the density / dust profiles and population tints the shader
  receives as uniforms, plus a CPU mirror of its raymarch. Its own README.
- `band-peak-pure.ts` (+ test) — the brightest sightline the band renders
  from a camera position, as a bound ([The brightest rendered sightline](#the-brightest-rendered-sightline)).
- `calibration/` — the published photometry the solve runs on (M_V, B/T,
  the two components' B−V), the light ratio and the disc colour derived
  from it, the resolution hole the march multiplies the emissivity by, and
  the two sightline checks it is graded against. Its own README.
- `milkyway-tuning.ts` — Milky Way section of the debug panel
  (surface-brightness anchor, density, extinction, reddening RGB
  sliders).
- `milkyway.test.ts` — the component specs the layer states, the
  calibration pins and the brightness verdict.

`GAL_TO_ICRS` / `GALACTIC_CENTRE_PC` live in `../galactic/galactic-coords.ts`,
imported here for the GC-anchored mesh placement.

## The material seam

Both components take their material from a `BandMaterials` factory rather
than building one inline: the layer owns the mesh placement, the per-frame
galactic-centre rebase, the debug levers and the chart handoff, and never
sees the graph. The factory is `../webgpu/milkyway/README.md`;
`stellata.ts` passes `webgpu.bandMaterials` and adds the group to
`scene`.

**The shared slots come FROM the factory.** The dust model, the galactic
frame, the surface-brightness anchor and the chart isobar are held by
reference between the disc and the bulge so one write reaches both draws —
and they are TSL nodes, so the layer has to write through the factory's
objects rather than its own. `MilkyWay.shared` is that handle.

**`seedBandSharedSlots` is the single writer of the authored defaults**,
and the factory calls it on the record it just built — a TSL `uniform()`
node starts on a declared literal, so without it the band marches a
placeholder dust model. The layer therefore holds no copy of the
constants. Add a slot to `BandSharedSlots` and `band-materials.test.ts`
fails until it is seeded.

Which component a material is for is a **builder** flag, not a uniform:
the disc and the bulge are two graphs.

## Why a volumetric mesh, not a skybox

A rejected rev 1 integrated through a 50 kpc camera-anchored skybox sphere:
the geometry doing the work enclosed the camera, so flying past the bulge
produced no parallax and the disc never read as a 3D shape from outside.
Marching the *actual disc shape* hands parallax to standard rasterisation,
and the path length varies with view direction on its own.

## Density, tints and dust

The disc and bulge profiles, their population tints and the analytic dust
slab live with the column model: `column/README.md`.

## Surface-brightness emission

The band emits into the scene-wide HDR unit ([Unit](../hdr/emission/README.md#unit--what-an-emitting-layer-writes)).
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
(`uOmegaSummationArcsec2`; [Extended sources](../hdr/emission/README.md#extended-sources--two-solid-angles-one-write-tail)). An
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
uniform map, but **nothing the band draws reads it**: its only consumer is
the chart-mode isobar branch, which has never rendered ([Chart mode +
warp](#chart-mode--warp)). The band's brightness is photometric, so the exposure model reaches
it through `uExposure` instead (`../hdr/exposure/README.md`). The band therefore
brightens and dims in lockstep with the star field: a deeper instrument,
the automatic adaptation cut and the manual EV trim all move it and the
stars together, by construction.

**The photometric calibration has its own folder and README**
(`calibration/`): what `density0` is solved against, how the V-band light
B/T is derived from a published mass ratio, how the two population colours
are derived from a published integrated one, the two [Leinert 1998](/data/papers/index.md#leinert1998) checks the
result is graded by, and the sightline table those produce.

## The brightest rendered sightline

`MilkyWay.peakSurfaceBrightnessBound(cameraAbsPc)` answers, in mag/arcsec²,
"how bright can the band's brightest pixel be from here" — an upper bound
the brightness skip compares against the live extended threshold
([§ 3.5](/docs/science-hdr-pipeline.md#35-skipping-a-diffuse-emitter-the-display-cannot-show--the-share-bound)). Two tiers, both off the CPU mirror:

- `MW_PEAK_SB_DUST_FREE` (17.11) — the dust-free full central chord,
  marched dense. Brighter than any vantage can render, so it settles the
  deep cuts (planet approaches) with no per-frame work.
- `bandPeakFan(cameraGalPc)` — the dusty peak from the live camera: a polar
  fan around the Galactic-centre direction out to the cone that still meets
  the disc proxy (24 rings × 36 azimuths, then three 7×7 refinements at a
  third of the spacing each) — 976 marched sightlines, **11.8 ms** per
  recompute on a 2024 M-series laptop under node, three quarters of it the
  resolution-hole lookup at every step, and CPU work on the frame
  thread, which is why the brightness skip takes it as a thunk and calls it
  only past the refusals that do not need it
  ([Skipping an emitter the display cannot show](../hdr/exposure/visibility/README.md#skipping-an-emitter-the-display-cannot-show)).
  Centring on the centre is what keeps
  it scale-free — from a megaparsec the Galaxy spans two degrees and an
  absolute (l, b) grid would miss it, which is the sampling error
  [§ 3.5](/docs/science-hdr-pipeline.md#35-skipping-a-diffuse-emitter-the-display-cannot-show--the-share-bound)'s probe table carried at 1 Mpc.
  `BAND_PEAK_MARGIN_MAG` (0.05) covers
  the fan's worst shortfall against a dense sweep over an eight-vantage grid
  (0.038, pinned); `BAND_PEAK_STALENESS_MAG` (0.07) covers the peak's drift
  over the cache's recompute radius — vertical
  travel near the plane moves it 0.006 mag/pc, the brightest sightline
  skimming the 125 pc dust layer.

**The recompute radius is not one distance.** `bandPeakRecomputeRadiusPc` is
`BAND_PEAK_RECOMPUTE_PC` (10 pc) inside R₀ and grows in proportion outside,
reaching 2.5 kpc at the camera's 2 Mpc limit — 246× the travel for the same
staleness, and that is exactly where the camera crosses ground fastest. Two
unrelated things move the peak: inside the dust, the camera's own travel
changes the foreground column, which is the 0.006 mag/pc above and has
nothing to do with how far the centre is; outside it, surface brightness is
distance-invariant and only the Galaxy's shrinking angular size is left.
Galactocentric distance is therefore a conservative *envelope*, never a
drift model — the rate 3 kpc above Sol is **65× lower** than at Sol for the
same galactocentric distance. What the suite pins is the product: the
staleness each vantage's own radius actually buys, with Sol the worst at
0.060 mag.

From Sol the dusty peak is 20.69 at |b| = 6.4° toward the centre (the two
signs tie; the model is z-symmetric), 3.5 mag under the default view's
threshold where the ceiling alone misses by 0.10. `BandPeakCache` is keyed
on camera position only — never on exposure — and holds the radius of the
position it took the bound at, since that is the travel the allowance
covers. `dispose` resets it.

`MilkyWay.contributionSkip` is what the band's registry entry declares
`contribution: { kind: 'gated' }` on ([The brightness reason](../scene/contribution/README.md#the-brightness-reason)):
the ceiling first, and the fan **only** where the
ceiling cannot decide, which is what keeps a 2–6 ms march off the deep
cuts that need no help. `setContributing` is a term of the group's
visibility alongside the user's `mw=0` toggle, never a bare
`group.visible` write — the band holds no dirty-track state, so that is
the whole reset.

**A band already switched off refuses above both tiers.** `mw=0` — and any
detail level whose floor drops the band — leaves the layer drawing nothing
and out of `L̄`, so no verdict it could reach would change the frame, while
a fan marched for it is milliseconds spent on a layer that is not there.
That refusal is also what keeps the `contributing` flag handed to
`brightnessSkip` equal to `group.visible`: the predicate documents it as
"is this emitter's light in the last landed statistic", and the registry's
own transition flag alone is not that. The `mwBand` frame-cost lever
(`../debug/frame-cost/passes/README.md`) depends on it too — without the
refusal its A/B pays the march on both sides and prices nothing.

`MilkyWay.isDrawn` is that same conjunction read back **plus the chart gate**,
and it is what the lever's `present()` asks: a band the brightness gate has
skipped is enabled and not drawing, so the toggle alone would admit a row whose
A/B disables a pass already gone. Chart mode is the second such state, and it
is the one that does NOT reach `group.visible` — `setIsobar` hides the two
meshes and leaves the group visible to carry the isobar treatment ([Chart mode
+ warp](#chart-mode--warp)). So `isDrawn` reads the group and the isobar flag together, where the
LG glow's own accessor can read its group alone
(`../local-group/emission/README.md`).

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

## Render path

Two meshes, both `THREE.BackSide`, additive blending, `depthTest =
true` (so close-range star cores can occlude this layer), `depthWrite
= false` (the glow never occludes anything later), `frustumCulled =
false` (the local bounding sphere is at origin but world position is
`GALACTIC_CENTRE_PC - worldOffset`). `renderOrder = -3` for both
meshes.

Both meshes draw into the HDR target's **diffuse** attachment, and into the
statistic attachment's flux channel — claiming **no lit-surface coverage**,
so a band filling the frame can never reach the exposure's resolved-surface
pin (`../hdr/attachments/README.md`). Neither writes attachment 0
on-target: the resolve owns that pixel once it has averaged the diffuse
attachment over the summation patch. Off-target both apply the operator
themselves over the pixel solid angle (`uHdrTarget = 0`, chart mode's
path — [The inline operator](../hdr/README.md#the-inline-operator--chart-modes-path)), in the **undithered**
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

**Chart mode renders no Milky Way at all, and the isobar contour has
NEVER been drawn — not in any release.** Read that
before believing anything else here or in `../webgpu/milkyway/README.md`
about it: the branch reads as shipped behaviour in both shaders and in
several uniform tables, and session after session has taken it for a live
feature. It is not one, and never has been.

`setIsobar(true)` sets `uChartIsobar = 1`, switches both materials to
`NormalBlending`, and then **hides both meshes** — so the fragment
shader's `fwidth`-normalised contour branch is unreachable by
construction. The branch is written and the uniforms are plumbed; no draw
survives to reach them. Drawing it is intended work, not deferred work
that once ran.

**Its physics is settled.** The contour is evaluated on **surface
brightness `S`** — no Ω_px term, so the line is FOV- and
viewport-invariant, which is what a chart wants — against the
extended-source threshold `stellataExtendedThresholdSb` recovers from
`uOmegaSummationArcsec2` (22.0 mag/arcsec² at the shipped instrument).
The chart-mode treatment and un-hiding the meshes are still open work.

The band↔isobar swap is driven by the `milkyWayIsobar` declutter push
(chart floor), not chart-mode.ts directly — the group stays enabled in
chart because `SceneDeclutter` enables it while either the band or the
isobar is permitted ([Chart-content wiring](../scene/declutter/README.md#chart-content-wiring)).

Warp keeps the layer visible in dark mode — the band reorienting as the
camera flies past the GC is the realism payoff.

## Dev levers

`milkyway-tuning.ts` registers the panel section — sliders for
`glowMagOffset`, `discDensity`, `bulgeDensity`, `extinctionStrength`,
`resolvedHole` and the three reddening RGB multipliers, plus both palette
colour pickers. Every one is also callable as
`stellata.milkyway.set<Name>(...)`. `resolvedHole` scales the hole table
in place through its one writer: 0 is the A/B against a band that draws
the resolved stars' light twice, 1 the shipped table.

Two are not knobs despite the slider: `setGlowMagOffset` desynchronises the
band from the Local Group layer (both read the one zero point), and
`setExtinctionStrength` at anything but 1.0 contradicts the dust anchor
([Dust](column/README.md#dust--the-analytic-tier-and-what-composes-with-it)). A third is now a *third* kind of thing: the colour pickers
luma-normalise on write, so a hue edit cannot move flux at emission — but
both shipped hues are solved from published photometry, and an edit still
moves the extincted plane ([Population tints carry hue, never flux](column/README.md#population-tints-carry-hue-never-flux)).
