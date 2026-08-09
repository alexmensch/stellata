# Galactic structure — coordinates, density, dust, constellations

Split out of `SCIENCE.md`. Covers the shared galactic coordinate
frame, Milky Way stellar density profiles, interstellar dust
extinction, and constellation stick-figure geometry. Spans
`src/client/galactic/galactic-coords.ts`, `src/client/milkyway/`,
`src/client/dust/`, `scripts/dust/`, `src/client/overlays/`.

## Galactic coordinate system

The shared module `src/client/galactic/galactic-coords.ts` exports two constants
used wherever the code needs to anchor in galactic geometry:

- `GAL_TO_ICRS` — a `Matrix4` rotation built from the J2000 IAU
  galactic-pole and galactic-centre angles, with explicit
  re-orthogonalisation to suppress float drift.
- `GALACTIC_CENTRE_PC` — a `Vector3` placing Sgr A* at R₀ = 8.122 kpc
  along the galactic +X axis (then rotated into ICRS by `GAL_TO_ICRS`).

These are reused by:

- The galactic disc-outline reference layer.
- The galactic coordinate sphere (b/l grid).
- The Sol/GC SVG arrow overlay.
- The volumetric Milky Way disc + bulge layer.

Implementation details: see `src/client/galactic/README.md`.

## Milky Way density profiles

Integrated properties and the thin/thick/halo structural parameters come
from **Bland-Hawthorn & Gerhard 2016**, *ARA&A* 54, 529
(DOI 10.1146/annurev-astro-081915-023441); the sightline surface
brightnesses the model is checked against come from **Leinert et al. 1998**,
*A&AS* 127, 1 (DOI 10.1051/aas:1998105) Table 24. See `SCIENCE.md`
§ Data sources for the values and their caveats.

The volumetric Milky Way layer raymarches through two proxy meshes —
a disc and a bulge — and accumulates emission along the camera→fragment
ray. The density at each step is:

- **Disc**: `density0 × exp(-(R-R₀)/3000pc) × (exp(-|z|/300pc) +
  0.04·exp(-|z|/900pc))` — thin plus thick in galactocentric cylindrical
  coordinates, the thick term at BHG16 § 5.1's z_T = 900 ± 180 pc and
  f_ρ = 4 ± 2 %. It exists for the **external** view: edge-on from the LMC
  or a few hundred kpc out, a galaxy with no thick disc reads as a
  hard-edged lens. Both components share one radial scale length, which
  puts the thick/thin luminosity ratio at 0.12 against Mosenkov et al.
  2021's 0.71 ± 0.45 (unWISE 3.4 µm, DOI 10.1093/mnras/stab2445) — whose
  thick disc is radially longer as well as thicker. The halo is still
  absent; the Jurić decomposition's third component was never worth its
  calibration cost.
- **Bulge**: `density0 × exp(-r'/1000pc)` where
  `r' = sqrt(R² + (z/q)²)` is the oblate-spheroid radius with q = 0.6.
  Simple exponential rather than McMillan's power-law-times-Gaussian —
  the latter produced too-tight a "ball" that read as point-source-like
  in iteration.

Each component multiplies a population colour pre-integration so the
band's hue varies by line of sight. The palette is visually chosen but
**luma-normalised**, so it carries hue and cannot scale either
component's flux; before that it moved the bulge/disc split by 0.39 mag
on its own, and it is what makes the scalar volume integral below the
luminance integral. The emission column then converts to a V surface brightness
and, through the scene-wide HDR unit, to per-pixel luminance — the same
exposure the discrete star catalog emits against. See
`src/client/milkyway/calibration/README.md` for the calibrated values and
that conversion, and `src/client/milkyway/README.md` for the full
coordinate-handling chain.

### The luminosity solve, and the constraint it cannot satisfy

Both components' `density0` is **solved**, not authored: each proxy
volume integrates to its share of the Galaxy's published integrated
luminosity, through the same `ρ₀ = d²·F/G` the Local Group build solves
per object, at d = 10 pc because the anchor is an absolute magnitude.
Inputs are BHG16 Table 2's M_V = −21.37 and a V-band **light**
B/T = 0.0775. No publication gives that second number for the Milky Way,
so it is derived: Licquia & Newman 2015's B/T = 0.150 is measured in
stellar *mass*, and the bulge's older, more metal-rich population carries
a higher Υ\*_V than the disc's, so the same mass share buys less V light.
Dividing through leaves only the RATIO of the two Υ\*_V — 3.15 from a
BC03 Chabrier SSP at Z = 0.02, 10 Gyr, against Flynn et al. 2006's
measured 1.5 for the local disc column. There is no free parameter left;
`src/client/milkyway/calibration/README.md` § The light ratio carries the
closed form and the metallicity brackets.

**The model cannot also satisfy the sightline it used to be anchored on,
and no shape parameter bridges the gap.** The earlier calibration pinned
the north galactic pole to Leinert's total starlight there *minus* the
catalogue stars Stellata draws itself — a defensible target that removes
56 % of the pole's light but only 0.2 % of the Galaxy's, because the
catalogue is a local sample and the pole column is almost entirely local.
A single emissivity field anchored on the subtracted pole therefore runs
a factor of three low everywhere else, and the shipped solve is 1.68 mag
brighter than that residual at the pole and 1.02 mag brighter than
Leinert's total toward the Galactic centre.

Two things make that a scale disagreement between published sources
rather than a shape error in the model. The two checks have the **same
sign and the same order**, which a wrong profile would not produce; and
0.5–0.9 mag is the real spread across M_V determinations, which BHG16's
own figure carries — its value comes from Milky Way analogues rather than
direct integration, and it flags an internal SDSS-vs-colour-index
inconsistency.

The total wins because it is what the camera sees from outside: the
Galaxy viewed from M31 has to be at least as bright as M31 viewed from
here, and under the sightline anchor it was 1.11 mag fainter. A
vertical-profile change cannot substitute — the pole column and the
integrated total are both vertical integrals, and adding the thick disc
moved their ratio by 0.09 mag. `src/client/milkyway/calibration/README.md`
§ Two checks carries the numbers and the pins.

## Interstellar dust extinction

Two distinct dust paths exist in the renderer:

**Per-star extinction.** `star.vert.glsl` raymarches the Edenhofer 2023
voxel grid camera→star and applies:

- `A_V` to `appMag` (dimming).
- `E(B−V) = A_V / 3.1` to `iCi` (reddening of the colour index).

Default strength = 1 (physical realism). Source units are E_ZGR per
parsec; the conversion `A_V / E_ZGR ≈ 2.742` at V band is baked in.

Catalog `absmag` and `ci` are stored **intrinsic** — the build subtracts
the Sol→star integral through this same voxel grid at write time (see
`scripts/catalog/distance/README.md` § Build-time de-extinction), so this
raymarch *restores* the observer-relative extinction instead of adding
it a second time. Because both sides integrate the same model, at
camera=Sol the build subtraction and the runtime addition cancel and a
dusty-sightline star renders at its catalogued observed magnitude — the V
the cascade resolved (`scripts/catalog/photometry/README.md`), which for
99% of stars is Gaia's `G` transformed, not AT-HYG's printed cell. This is
what makes the "no double-counting" statements below true across **all**
tiers (previously the magnitude channel was double-counted in every tier
and the colour channel in the ~15% tier-3 stars that read `iCi`
directly). Invariant: any change to this runtime stack ships with the
mirrored build-side integral + catalog rebuild in the same release.

**Volumetric Milky Way dust.** The analytic profile is
`norm × exp(-(R-R₀)/3500pc) × exp(-|z|/125pc)` — Drimmel & Spergel-style
thin-disc dust. Per step, opacity converts to per-channel optical depth via
CCM-derived reddening multipliers `(0.76, 1.0, 1.35)` — red transmits most,
blue extincts away — applied with Beer-Lambert running attenuation including
a half-step self-shielding term. Default global strength = 1.0.

`norm` is derived from a declarative rate: 1.0 mag/kpc of V extinction
at (R₀, z = 0), the top of the range commonly adopted for the
solar-neighbourhood plane. At the 125 pc scale height that also puts the
perpendicular column to the pole at A_V = 0.125, inside the SFD polar
spread — two independent constraints meeting at one normalisation.

**That analytic profile is the fallback tier, not the whole band column.**
What composes with it, over which volumes, and why the slab is not rescaled
to make room is § The dust stack below.

Implementation: `src/client/star-pipeline/star.vert.glsl` (per-star) and
`src/client/milkyway/milkyway.frag.glsl` (volumetric); see
`src/client/star-pipeline/extinction/README.md` + the shelved particle layer and
`src/client/milkyway/README.md`.

Sources for the volumetric path: **Drimmel & Spergel 2001**, *ApJ* 556, 181
(DOI 10.1086/321556) for the thin-disc dust distribution; **Cardelli,
Clayton & Mathis 1989**, *ApJ* 345, 245 (DOI 10.1086/167900) for the
per-channel reddening multipliers; **Schlegel, Finkbeiner & Davis 1998**,
*ApJ* 500, 525 (DOI 10.1086/305772) for the polar A_V spread the
perpendicular column is checked against.

SFD used to be cited for something it does not publish: a "0.15 mag/kpc
local rate", under a shipped 0.45 multiplier that took the effective rate
to 0.068 mag/kpc. Both parts were wrong. SFD is a 2D full-sky E(B−V) map
and gives no per-kpc rate at all — only the polar spread above — and 0.068
mag/kpc is 10–25× below the measured solar-neighbourhood plane rate. The
under-extinction, not the density profile, was why the band's plane read
~3 mag too bright against its poles.

## The dust stack — sources, domains, and the partition

Design gate output (stellata-36y.3). Several sources want to write dust into
the band's raymarch: the shared analytic function, its spiral-arm term, its
procedural turbulence, the Edenhofer voxel grid, and a measured mid-shell.
They cannot be layered — the analytic slab is normalised to a **total**
extinction rate, so anything measured added inside its volume double-counts.
This section settles the composition once, so each of those lands against a
decided contract rather than renegotiating it.

### The cascade

At every point along a ray, the dust comes from **the highest-resolution
source that covers that point**, and from that one only:

| tier | source | scale | domain |
| --- | --- | --- | --- |
| 1 | per-cloud traced density brick | 0.5–4.1 pc | inside a rendered cloud whose brick out-resolves the grid |
| 2 | Edenhofer voxel grid | 4.88 pc | ≤ 1.25 kpc of Sol, minus tier 1 |
| 3 | a cloud's own absorption model | brick or envelope | rendered clouds beyond grid coverage |
| 4 | analytic slab + arms + turbulence | ~kpc | beyond all measured coverage |

This is the cascade the per-star raymarch already follows, adopted whole
rather than truncated: the band is the one surface that shows all of it. A
measured mid-shell slots between tiers 2 and 3 when it lands, without
changing anything else — the analytic term takes "coverage ended at t₀" as
its input, so the stack composes without tier 4 knowing which tier ended it.

### The partition is by volume, not by fraction

Inside a measured source's coverage, that source is the **only** dust; the
slab contributes zero there. Beyond all coverage, the slab is the only dust.
Nothing is rescaled anywhere, and `LOCAL_DUST_RATE_MAG_PER_KPC` keeps both
its meaning — total V extinction per kpc at (R₀, z = 0) — and its value, 1.0.
It becomes the *fallback* total rather than the whole-model total; its anchor
point now sits inside measured coverage, so it is a normalisation statement
about a value the runtime never evaluates there, and the pin stands unchanged.

**The standing argument against rescaling survives, correctly scoped.** It
rules out a *global* molecular-fraction scale-down of the slab: the clouds are
local while the slab spans the Galaxy, so scaling it down everywhere
under-extincts the far disc — a ~3 mag error to avoid a ~0.05 mag one. That
says nothing about a domain-local partition, which is what the cascade is.

**Measurement confirms the handoff needs no renormalisation.** Integrated over
the same 0–1250 pc volume, all-sky, the two sources agree to 5 %:

| | sky-mean A_V | median | p90 |
| --- | --- | --- | --- |
| Edenhofer grid | 0.377 | 0.160 | 1.074 |
| analytic slab | 0.359 | 0.245 | 0.792 |

(5° grid, solid-angle weighted throughout.)

Only 27.6 % of the sky has more measured dust than the slab predicts. The
handoff is close to flux-neutral on the mean and **redistributes** — windows
and lanes replacing a smooth field at nearly the same total, which is the
entire point. Both of the slab's independent constraints also survive: the
plane-rate anchor is untouched, and the polar constraint transfers from model
to measurement, the grid's NGP column reading **0.049 mag** against the slab's
0.125, both inside the SFD polar spread (0.03–0.15).

### Which clouds are carved, and which are folded in

Tiers 1 and 2 are the same switch seen from opposite sides — the cloud's dust
is present either way, and only the mechanism changes. Tier 1 removes the
**grid's** contribution over the cloud volume and lets the cloud's absorption
draw supply it; tier 2 removes the **draw** and lets the grid supply it. A
cloud takes tier 1 when both hold: its own model out-resolves the grid, and
the grid resolves it across enough voxels to carry shape at all.

Of 96 rendered clouds, 63 are traced from per-cloud density bricks and 33 fall
back to an analytic Plummer ellipsoid. 74 sit inside grid coverage, splitting
**52 tier 1 / 22 tier 2**; the remaining 22 are tier 3. The 22 tier-2 clouds
are the 21 fallback ellipsoids inside coverage plus Cygnus X, whose brick is
15.2 pc at 1163 pc — three times coarser than the grid it sits in. They keep
dimming the band, as part of the continuous measured field rather than as
discrete objects: the ellipsoid-shaped shadow stops, the true-shaped one
continues. Their rim shells, outlines, labels and picking are annotation and
are untouched.

**The prefilter never binds inside coverage.** One 4.88 pc voxel subtends the
13.0′ rod summation patch only at 1291 pc, past the coverage sphere; across
the 21 fallback clouds it subtends 15–97′. The grid's own voxel size sets the
edge, so routing those clouds through the band's prefiltered read softens
nothing.

**The second criterion is why that is a test and not a roster.** For the
nearest and smallest of the 21 the grid barely resolves them — Musca spans
2.23° against a 1.62° voxel, Ara 0.53° against 0.27°, L1293 0.26° against
0.26° — so the grid carries no more *shape* than the ellipsoid does, only
better truth about position and column. Those return to tier 1, because a
one-voxel blob is worse than a calibrated ellipsoid. Raising the grid's
near-Sol resolution moves them back, which is a second consumer for that work
beyond the per-star march it was filed for.

**What the partition buys and what it costs.** The accepted slab ↔ cloud
double-count goes to zero inside coverage: the slab is not evaluated there,
tier-1 volumes are carved, and tiers 2–3 are mutually exclusive. 14.3 % of
the measured sky column falls inside rendered-cloud envelopes, so that is the
share the carve-out hands back to the cloud bricks. What remains is the 22
clouds beyond coverage, which sit in the analytic zone where the slab *is*
evaluated and the mesh also multiplies: slab column through each such cloud's
own extent is a median 0.110 mag, worst 0.475 (L379), against those clouds'
own 1–3 mag columns and over their own projected discs only. Left uncarved
deliberately — testing 96 envelopes per analytic step is not worth 2 % of a
far cloud's column.

### Sampling the measured grid in the band march

The grid is sampled here, and the earlier "aliasing rules this out" position
is superseded. The aliasing is real but it is a sampling-rate-versus-bandwidth
problem, and the standard fix applies — with one correction that decides the
mechanism.

**An isotropic prefilter is the wrong one.** The march is log-distributed, so
about 24 of its 32 steps fall inside 1.25 kpc, and the step length at the
coverage edge is ~440 pc while a pixel's transverse footprint there is ~1 pc.
A Cartesian mip pyramid blurs both axes equally, so at that step it
over-blurs across the ray by a factor of a few hundred and would smear the
rift edge over ~20°. The prefilter has to be **anisotropic — extent along the
ray equal to the march step, extent across it equal to the pixel or summation
footprint.** Four requirements follow: transverse resolution finer than the
13.0′ summation patch the resolve already convolves the band over; along-ray
resolution equal to the local step; rebuild bounded by a camera-displacement
epsilon, as the per-star extinction prepass already is; and correct handling
of a camera *outside* coverage, which needs an entry as well as an exit
distance.

Two of those four were written before anything was measured and the
measurement overrode them — § Against the four requirements says which and
why.

The per-star march remains a separate structure either way: it cannot take a
prefiltered input at all without breaking the de-extinction cancellation
invariant.

### The prefilter mechanism — a view-frustum froxel grid

Decided by measurement (stellata-ty4.4). Both candidates the gate named are the
**same structure** under different parameterisations: a froxel grid holding the
measured A_V column per (sky cell × log-distance slice), which the march reads
as the difference between two slices. They differ only in what indexes the sky
cells — a camera-anchored all-sky map, or the view frustum. **The frustum wins**,
on a ratio that is just the solid angle each has to cover.

Storing the **column, not the density**, is what makes the along-ray extent of
the filter equal to the march step by construction: linear interpolation in log
distance *is* a uniform density inside each slice, the total column telescopes
exactly whatever the slice count, and the filtering runs linear in A_V — which
point-sampling the u8-log-encoded grid can never be.

#### Cost

Pin: **13.0′ cells × 32 log slices, one ray per cell, 2 bytes per texel, the
fill marching each ray at half a voxel (2.44 pc, 512 samples to the coverage
edge).** The cell angle is not a round number chosen for the table — it is one
summation-patch diameter, derived from `DEFAULT_SUMMATION_ARCSEC2`, so an
instrument change moves it. Fetches are counted against the shipped per-star
extinction prepass — 313k stars × 48 steps = **15.0M fetches per rebuild**,
which recomputes every frame during a warp — because that is a shipped GPU
workload doing the same fetch against the same texture. Wall-clock GPU timings
are not measured here.

**A screen-space grid is uniform in tan θ, not in solid angle**, and the cost
table has to be read in those terms: `dθ/dx = cos²θ`, so the on-axis cell is
the *coarsest*, every off-axis cell is finer, and holding the coarsest at 13.0′
costs the tan-space area rather than Ω/cell² — 1.42× more cells at 50°, 5.51×
at 120°. The accuracy below is measured at the coarsest cell, so it bounds the
whole frustum.

| grid | cells | memory | fill per rebuild | rebuilt on |
| --- | --- | --- | --- | --- |
| all-sky, camera-anchored | 877k | 53.5 MiB | 449M (29.9× the prepass) | translation > ε |
| frustum, 10° FOV | 3.8k | 0.2 MiB | 1.9M (0.1×) | any camera change |
| **frustum, 50° FOV (default)** | **108k** | **6.6 MiB** | **55M (3.7×)** | any camera change |
| frustum, 120° FOV | 1.5M | 90.9 MiB | 763M (50.8×) | any camera change |

The **read** is identical either way and is the larger per-frame term: one fetch
per march step per band pixel, 166M/frame at 1920 × 1080 @dpr1 (32 disc steps +
48 bulge steps-plus-pre-march), 664M at dpr 2. It *replaces* the same count of
analytic evaluations rather than adding to them.

The frustum wins on fill by **8.1×** at the default FOV, and the reason is
almost all solid angle: a fill touches every voxel inside the angle it covers,
and 4π sr against the ~1.09 sr a 50° frustum subtends is 11.5× of it, given
back to 8.1× by the tan-space cell count. The all-sky map's one real advantage
is that its cells are fixed in the sky, so rotation costs nothing; that does not
pay for 8.1×, because stellata's camera translates on orbit drag and on every
warp, leaving only a parked camera panning — the regime where the frustum grid's
55M is affordable anyway. A hybrid (sky-fixed cells, filled only over the
visible cone, per-cell staleness) would take both, at the cost of the all-sky
memory footprint and a residency map; it is recorded here as the upgrade path,
not adopted.

**Capping each shell's angular resolution at the source's own** is the one
optimisation priced but not pinned: the grid carries no structure finer than a
voxel, so inner shells need fewer cells, which takes the 50° fill to 21M (1.4×)
on 0.5 MiB and the 120° corner to 293M. Arithmetic only — the accuracy sweep
measured a single resolution across all slices, so ty4.5 would have to re-measure
before adopting it.

#### Accuracy

Measured against a direct march at ¼-voxel steps, **after** the 13.0′ flat-disc
summation the resolve convolves the band over — the display carries no finer
structure than that, so the honest comparison is between two convolved profiles,
not two pointwise ones. Worst case over 241 sightlines across the Rift (l = 0,
b = −30…30 at 0.25°), camera at Sol, at the pinned 13.0′ cell, and worst over
**five grid poses** — a screen grid meets a given sightline at an arbitrary
sub-cell offset and an arbitrary roll, so every figure here is the worst of both.

| read | worst ΔS | p99 | worst column | Rift-edge shift |
| --- | --- | --- | --- | --- |
| point sample, no prefilter | 1.269 mag | 1.064 | 7.69 mag | 640′ |
| 16 sub-samples per step | 0.060 | 0.059 | 0.026 | 56.6′ |
| 64 sub-samples per step | 0.004 | 0.004 | 0.002 | 2.9′ |
| froxel, 24 slices | 0.034 | 0.023 | 0.041 | 17.0′ |
| **froxel, 32 slices** | **0.023** | **0.019** | **0.042** | **11.2′** |
| froxel, 64 slices | 0.024 | 0.021 | 0.038 | 8.4′ |

A 600-sightline all-sky set tracks it, worst ΔS 0.057 / 0.030 / 0.019 mag at
24 / 32 / 64 slices. The edge shift is the mag error divided by the local
gradient of the true profile — how far the Rift's edge actually moves, which is
the angular error the requirement asks for. At the pin it is **11.2′, inside the
13.0′ patch the band is displayed through** — inside, but by 14 %, which is the
margin ty4.5's agreement pin should be written against. Four findings the
numbers force:

- **The binding axis is along-ray, not transverse.** 32 slices is the knee for
  ΔS: 24 leaves a 17.0′ edge shift, and 64 takes the shift to 8.4′ without
  moving ΔS or the column error at all, because past 32 the residual is the
  angular interpolation and the fill's own step.
- **64 slices is the standing upgrade**, and cheap in the only currency that
  moves: slices are a memory knob, not a fill knob, so 8.4′ costs 13.2 MiB
  instead of 6.6 at 50° and nothing per frame. Pinned at 32 because that is
  where ΔS stops improving; take 64 if the 14 % margin above proves tight in
  practice.
- **No transverse supersampling.** One ray per cell is enough — 2 × 2 rays per
  cell moved the worst case by ≤ 0.007 mag at 13′, as often the wrong way as the
  right one (it does damp shimmer, 0.008 → 0.006 mag, which is not worth 4× the
  fill). The grid's own voxel subtends **13.43′ at the coverage edge and more
  everywhere nearer**, so a 13′ cell already sits at the source's finest angular
  scale and there is nothing left to average. This is what makes the frustum
  grid cheap: the word "prefilter" implies a 4× supersampling cost the source's
  own resolution does not justify.
- **Shimmer does not condemn the frustum grid.** Its cells slide *and rotate*
  across the sky as the camera turns, so one direction is read at a different
  pose each frame; that spread is **0.008 mag** at 13′ cells against 0.065 mag
  at 26′. The all-sky map's exact zero is not worth buying.

#### Against the four requirements

The gate's four (§ Sampling the measured grid in the band march) were written
before anything was measured. Two hold as written, and two the measurement
overrode:

- **Along-ray extent equal to the march step — held, by construction.** Storing
  the column rather than the density is what makes it exact rather than
  approximate, whatever the slice count.
- **Camera outside coverage — held.** § Camera outside coverage.
- **Transverse resolution *finer* than the 13.0′ patch — overridden.** The pin
  is exactly one patch diameter, because the source itself carries nothing finer
  (13.43′ per voxel at the coverage edge) and 2 × 2 supersampling inside a cell
  measurably buys nothing. A finer cell would cost quadratically for structure
  neither the source nor the display holds.
- **Rebuild bounded by a camera-displacement ε — given up, knowingly.** A
  view-parameterised grid is stale the moment the camera *rotates*, so it
  rebuilds on any camera change; the ε predicate the per-star prepass uses has
  no analogue here. That is the trade the 8.1× fill advantage pays for, and it
  is why the fill's absolute cost (3.7× the prepass, every frame the camera
  moves) is the number ty4.7 has to land rather than a per-frame average.

#### What is not measured, and what to turn if it is too slow

The costs above are exact fetch and texel counts anchored to a shipped GPU
workload. **They are not frame times, and none of this has run on a GPU.**

**Spike the fill pass on its own before ty4.5 builds the read**
(stellata-ty4.7). The fill alone, behind a timer query and an A/B toggle
mirroring `setExtinctionPrepassEnabled`, priced at the default 50° and at the
**120° FOV × dpr 2** corner — which is the worst case at 763M fetches/frame and
is reached by zooming out on a retina display, not by an exotic configuration.
Doing this after ty4.5 means discovering the answer at the end of a PR that also
carves 52 clouds and re-pins every sightline row.

The fill is linear in cell count and so quadratic in cell angle, and linear in
the rate each ray marches at — which is what makes the fallbacks priced rather
than guessed. Rows are the Rift strip at 32 slices and 50° FOV, so they read
against the accuracy table above:

| lever | fill | worst ΔS | shimmer | column | edge |
| --- | --- | --- | --- | --- | --- |
| **13′ cells, fill 2/voxel — the pin** | 55M/frame | 0.023 | 0.008 | 0.042 | 11.2′ |
| 18′ cells | 0.5× | between the rows | | | |
| 26′ cells | 0.25× (14M) | 0.094 | 0.065 | 0.150 | 23.8′ |
| fill 1/voxel | 0.5× (28M) | 0.037 | 0.014 | 0.057 | 27.7′ |
| fill 4/voxel | 2× (111M) | 0.024 | 0.007 | 0.038 | 10.0′ |
| 24 slices | unchanged | 0.034 | 0.007 | 0.041 | 17.0′ |
| refill a fraction of the cells per frame | spike → smear | none | | | |

At 26′ the fill sits **below** the star prepass and is still an order off the
1.27 mag that point-sampling costs, so there is a lot of room between correct
and unshippable — but note that it costs the *angular* requirement more than the
photometric one: 23.8′ is nearly twice the display patch. Slices are a **memory**
knob, not a fill knob; the fill rate is a fill knob and not a memory one.

**Halving the fill rate is the trap.** One-voxel sampling looks like a free 2×
— it costs 0.037 mag and a **27.7′ edge shift**, worse than doubling the cell
angle, because the along-ray axis is the binding one at this cell size.
Quarter-voxel sampling buys 1.2′ for 2× the fill, which is why the pin sits at
half a voxel: it is the knee, not a guess. `pnpm run analyse:prefilter` sweeps
all three (`FroxelConfig.fillStepsPerVoxel`).

#### Camera outside coverage

The distance axis spans [entry, exit] from a ray-sphere test rather than
[0, exit], which is the whole of requirement 4. Measured 3 kpc off-Sol along
l = 180° (197 of 209 sightlines crossing the sphere): worst **ΔS 0.007 mag**.
The measured column itself is misread by up to 0.71 mag there — a 4.88 pc voxel
subtends 5.6′ at 3 kpc, finer than the cell — but that shell is a small share of
a 3 kpc emission column and does not reach the band. The cell size is matched to
the *display*, and no vantage can show structure finer than 13′. The fill is
gated on the same ray-sphere test, so from 3 kpc it drops to the 4.5 % of
sightlines that cross coverage at all.

#### What this settles for the source-side warp

stellata-c7u.8 was asked to agree with the band's prefilter on a warp. A frustum
grid has no world-space warp to agree about — it is parameterised by the view,
not by the sky — so c7u.8 picks its warp on the source's terms alone, and there
is one warp rather than two.

### Continuity, and what is shared with the per-star path

**Hard switch at each coverage boundary, no crossfade.** Extinction is an
integral, so the column is continuous across a density discontinuity by
construction and only dκ/ds jumps, which is not visible. A crossfade would
blend a modelled value with a measured one *inside* measured coverage, which
the cascade forbids outright. The continuity check is the sky-mean agreement
above rather than a pointwise match at the boundary shell.

The band and the per-star raymarch share the **analytic function** and the
**cascade contract**, not the sampling mechanism — their budgets differ by
orders of magnitude, and one of them carries the de-extinction invariant. What
keeps them from disagreeing about what dust is where is that both integrate
the same fields in the same order, and the band's prefiltered read is a
projection of exactly what the per-star march integrates.

### How the decision grades, and what it does not fix

Graded against ESO eso0932a (`docs/science-hdr-pipeline.md` § 8), at l = 0,
medians over 15.5° × 1.4° strips, floor-subtracted and inverted through the
shipped operator. The panorama reads **2.60 mag** brighter at b = −3 than at
b = +3 — the Great Rift above the plane, the Large Sagittarius Star Cloud
below it. The shipped axisymmetric slab reads **0.00** by construction, in
either sign. The measured grid alone carries 3.03 mag of asymmetry there
(A_V 3.86 at b = +4 against 0.83 at b = −4, where the slab gives 1.06 at
both), and marching the cascade recovers **+2.03 mag** of the observed 2.60.

The cost is modest and the direction is right:

| sightline | slab | cascade | vs panorama |
| --- | --- | --- | --- |
| l = 0, b = +5 | 20.77 | 21.09 | — |
| l = 0, b = 0 | 21.90 | 21.91 | — |
| anticentre | 22.07 | 21.91 | — |
| b = +30 | 22.52 | 22.83 | 0.44 → 0.13 mag bright |
| NGP | 23.40 | 23.33 | — |

Plane-to-pole contrast moves 1.51 → 1.42. RMS |ΔS| over the whole −30…+30
profile is flat (1.15 → 1.16); at |b| ≥ 10 it improves 0.72 → 0.67, and the
northern rows b = +15…+30 go from 0.4–1.0 mag bright to mostly under 0.3 —
the same high-|b| excess § 8 records, partly explained by dust the smooth slab
was missing.

**The below-plane half of the motivating case is not a dust problem and is not
fixed here.** At l = 0, b = −3 the panorama is still 3.08 mag brighter than
the cascade, because the Large Sagittarius Star Cloud is inner-disc and bulge
light seen through a low-extinction window while our emissivity is smooth and
axisymmetric — the bulge sits behind 4.6 τ_V and carries a negligible share of
the GC column. That belongs to the far-field emissivity grid, not to this
stack. The low-|b| rows also carry resolved-star light the app draws
separately, so the plane-row residuals bound the disagreement from below only.

**Camera-anywhere: this is a Sol-neighbourhood improvement.** Grid coverage is
a 1.25 kpc sphere around Sol, so from 3 kpc off-Sol only 4.5 % of sightlines
intersect it, from the Galactic centre 0.6 %, and from the LMC none. From
every off-Sol vantage the band's dust structure comes entirely from the
analytic tier — which makes the spiral-arm and turbulence terms the *only*
structure available there, not a second-order correction on top of measured
data.

### Reproducing the measurements

Panorama: `https://cdn.eso.org/images/screen/eso0932a.jpg`, 1280 × 640 plate
carrée in galactic coordinates, GC centred, l increasing leftward; medians
over 15.5° in l × 1.4° in b; 8/255 floor subtracted in linear display space;
inverted through the shipped toe → extended-Reinhard → sRGB chain at the base
epoch with no EV trim. Grid columns: `data/dust/` at 1 pc steps to 1250 pc,
nearest-voxel decode, `A_V = 2.742 · ∫E dl`. Slab columns: the profile above at
the shipped normalisation. Cascade march: the CPU mirror in
`milkyway-column-pure.ts`, per-channel, with the measured field replacing the
slab inside coverage and sub-sampled at ≤ 10 pc within each log step; it
reproduces every pinned row in `milkyway.test.ts` to under 0.001 mag before
the source is swapped. Cloud geometry and brick steps: `public/clouds.json`
and `data/molecular-clouds/cloud-surfaces.bin`.

Prefilter sweep: `scripts/dust/prefilter/` (its own README), a Node harness
over the same CPU mirror — pinned bit-exact against it with dust off —
emulating one froxel grid parameterised by cell angle, slice count, grid pose,
rays per cell and fill rate, which covers both candidates since they differ only
in what indexes the cells. Grid geometry and the u8-log decode come from
`data/dust/manifest.json`, so a re-encode cannot silently invalidate the
numbers. Reference is a ¼-voxel (1.22 pc) march; the grid is sampled
trilinearly on decoded density, where the GPU filters the u8 log codes (a
geometric mean, which under-reads a gradient — the prefilter's own storage is
linear in A_V and does not inherit it). Every number is the read and the
reference both convolved over a 32-point flat disc of 13.0′ diameter, the
resolve's summation patch, and every error figure is the worst over five grid
poses. Costs are exact texel and fetch counts over the pinned geometry, not
timings.

## Constellation stick figures

Classical asterism lines come from Stellarium's modern sky culture
(MIT-licensed, HIP-indexed). Each Stellarium polyline references stars
by HIP number, which is resolved against AT-HYG's `hip` column at build
time. Any unresolved HIP is a hard build error unless explicitly listed
(with rationale) in `KNOWN_MISSING_HIPS` — currently α Phe (HIP 5165)
and μ Sgr (HIP 89341), both stars Stellarium references that have empty
position columns in the AT-HYG CSV.

Implementation: `scripts/catalog/build-catalog.ts`; see
`scripts/catalog/parse/README.md` § Stick figures from Stellarium for
the pipeline + missing-HIP policy.

