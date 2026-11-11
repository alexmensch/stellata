# Milky Way photometric calibration

The published numbers the band's emissivity is solved against, the light
ratio and the two population colours derived from them, and the two
sightline checks the result is graded by. The solve itself —
`DISC_DENSITY0` / `BULGE_DENSITY0` — lives in `../column/milkyway-column-pure.ts`
beside the shape integrals it divides by, and its pins live in
`../../../../tests/integration/milkyway.test.ts`; everything about *what goes in* and *how well it
comes out* is here.

## Files

- `diffuse-reference.ts` — `GALAXY_TOTAL_ABSMAG_V`, the mass-to-light
  inputs, `bulgeToTotalLight` and the `BULGE_TO_TOTAL_LIGHT_V` it derives,
  `GALAXY_TOTAL_COLOUR_INDEX_BV` and the two component indices, the
  [Leinert 1998](/data/papers/index.md#leinert1998) totals, the resolved-catalogue subtraction, and
  `diffuseResidualMagArcsec2`.
- `diffuse-reference.test.ts` — the residual arithmetic, the light-ratio
  derivation and the colour solve, reading all three `data/bc03/` tables
  back: the shipped Υ\*_V and (B−V) off `m62` and the metallicity
  brackets off `m52` / `m72`.
- `resolved-hole-table.ts` — **generated** by
  `scripts/milkyway-calibration/` off the built catalogue: the two cap
  rows and the resolution-hole table ([The resolution hole](#the-resolution-hole--the-band-marches-the-model-minus-the-drawn-stars)). Never edited by hand.
- `resolved-fraction-pure.ts` (+ test) — the table's layout constants, the
  rule the table is sampled with, the cube it is resampled onto, the
  CPU mirror of the trilinear fetch both shaders make.
- The `Data3DTexture` those voxels go into is the viewer's:
  `/src/client/milkyway/resolved-hole-texture.ts`.

## The zero point is not the band's own — it is the emission unit's

`SB_ZERO_POINT` (`../../emission/emission-pure.ts`) = 26.5721
mag/arcsec², shared verbatim with the Local Group layer. A raymarched
column is flux per steradian once `density0` sits in zero-point-free flux
units, so nothing about the conversion is free.

What the layer derives is each component's `density0`, through the same
`ρ₀ = d²·F/G` the Local Group solves per object
([Solving ρ₀](../../emission/README.md#solving-ρ--a-published-magnitude-into-an-emitters-density)) — here with **d = 10 pc**,
because the anchor is an *absolute* magnitude:

```
DISC_DENSITY0  = 100·10^(−0.4·M_V)·(1 − B/T) / ∫ discShape  dV ≈ 6.133e−2
BULGE_DENSITY0 = 100·10^(−0.4·M_V)·     B/T  / ∫ bulgeShape dV ≈ 2.074e−1
```

`GALAXY_TOTAL_ABSMAG_V` = **−21.37** ([Bland-Hawthorn 2016](/data/papers/index.md#blandhawthorn2016) Table 2). **Zero free
parameters, and no march feeds the calibration.**

Three properties a change here must keep:

- **The shape integrals may not reach a `density0`.** `discShape` /
  `bulgeShape` are the profiles at unit ρ₀ — the integrals march *those*,
  the density functions multiply the solved constant on top. ρ₀ is a scale,
  **not** a point emissivity: the disc's vertical term is 1.04 at the
  midplane, so `DISC_DENSITY0` sits 4 % above (R₀, 0).
- **The scalar volume integral is the LUMINANCE integral**, because both
  tints are luma-normalised ([Population tints](../column/README.md#population-tints-carry-hue-never-flux)). That is
  what lets one flux total be split between two hues without either moving
  light.
- **Truncation compensation is inherent.** G is over the ACTUAL proxy
  volume, so the **0.076 mag** the disc envelope clips against all space is
  redistributed inward — a tighter envelope *brightens* what remains. Mostly
  radial, against 0.018 mag vertical ([Density profiles](../column/README.md#density-profiles)),
  and one ellipsoid does not separate into the two — the pin is the
  all-space closed form.

**Solved dust-free, and that is the point.** An earlier design derived the
zero point *through* the shipped extinction, so the photometric scale swung
2.7 mag across the dust knob — including at the poles, where there is no
dust. Emissivity is intrinsic and `GALAXY_TOTAL_ABSMAG_V` is itself
internal-extinction-corrected; `../../../../tests/integration/milkyway.test.ts` pins the independence.

## The light ratio — B/T in the solve is not the published number

**B/T splits the solved flux, so it has to be a LIGHT ratio, and nobody
publishes one for the Galaxy.** What is published is a stellar **mass**
ratio, and an old metal-rich bulge carries a higher Υ\*_V than a
star-forming disc, so the same mass share buys materially less V light.
`BULGE_TO_TOTAL_LIGHT_V` = **0.0775** is therefore derived rather than
cited:

```
B/T_light = 1 / (1 + ((1 − f_M)/f_M) · (Υ_b/Υ_d))
```

| term | value | source |
| --- | --- | --- |
| `BULGE_TO_TOTAL_MASS` | 0.150 | [Licquia 2015a](/data/papers/index.md#licquia2015), stellar **mass**, Kroupa IMF |
| `BULGE_ML_V` | 3.15 | [Bruzual 2003](/data/papers/index.md#bruzual2003) Chabrier SSP, Z = 0.02, 10 Gyr (`data/bc03/`) |
| `DISC_ML_V` | 1.5 | [Flynn 2006](/data/papers/index.md#flynn2006), **measured** local disc column |

**Only the RATIO Υ_b/Υ_d survives the algebra**, which is what makes a
measured disc value and a modelled bulge one commensurable: the IMF
normalisation cancels and what is left is the population difference the
whole correction is about. A mass share used as a light share — what
shipped until this was fixed — put a factor 1.94 too much V flux in the
bulge, and the README of the day said so while doing it.

Three things a change here has to know:

- **The bulge Υ\*_V is read back out of the committed model table**
  (`diffuse-reference.test.ts` against `data/bc03/`), so hand-editing the
  constant, or swapping the file for a different IMF or track set, fails
  rather than silently re-scaling the flux split.
- **Metallicity, not age, is what the answer turns on.** The bulge's
  metallicity distribution is broad and centred near solar; the Z = 0.008
  and Z = 0.05 brackets in `data/bc03/` put B/T_light at 0.098 and 0.056
  against the shipped 0.0775 — read out of those two tables and pinned,
  not quoted. Ages from 8 to 13 Gyr move it far less. Both brackets stay
  under the mass ratio, so the MDF moves the size of the correction and
  never its sign.
- **The disc value has an independent check.** The same [Bruzual 2003](/data/papers/index.md#bruzual2003) grid
  composited over an exponentially declining SFH (τ ≈ 8 Gyr, solar Z)
  returns Υ\*_V = 1.34 against [Flynn 2006](/data/papers/index.md#flynn2006)'s measured 1.5 ± 0.2 — two routes,
  one measured and one modelled, agreeing inside the measurement's error.

**From Sol this correction is nearly invisible and that is the trap.** The
bulge sits behind 4.6 τ_V from here, so it is <!-- count:milkyway-sightlines/bulgeShareGcColumnPct d2 -->0.04<!-- /count --> % of the GC column
and <!-- count:milkyway-sightlines/bulgeShareB5ColumnPct d1 -->16.4<!-- /count --> % of the b = 5 one, and trading the mass ratio for the light
ratio moved no sightline row below by as much as a tenth of a magnitude.
Where it shows is the face-on external view, which the camera can reach
([Camera-anywhere, any-epoch](/AGENTS.md#camera-anywhere-any-epoch--a-mental-model-rule)): the centre pixel is
**<!-- count:milkyway-sightlines/faceOnCentreBulgePct sig2 -->31<!-- /count --> %** bulge, and the integrated bulge/disc luminance ratio
**<!-- count:milkyway-sightlines/bulgeToDiscLight d4 -->0.0840<!-- /count -->**. That contrast is what makes the model read as an Sbc
rather than an S0, and it is pinned in `../../../../tests/integration/milkyway.test.ts` alongside the
edge-on case — where the bulge sits behind the full midplane dust column
and carries well under a thousandth of the centre pixel, exactly as a real
edge-on spiral does in V.

## Population colours — the disc's is solved, not cited

Same shape of problem as the light ratio: **nobody publishes the Galaxy's
colour split by component**, only its integrated index. The shared solve
([Population colours](../../emission/README.md#population-colours--one-equation-two-unknowns-one-citation)) takes the bulge off
the SSP grid and returns the disc:

| term | value | source |
| --- | --- | --- |
| `GALAXY_TOTAL_COLOUR_INDEX_BV` | 0.73 | [Bland-Hawthorn 2016](/data/papers/index.md#blandhawthorn2016) Table 2 |
| `BULGE_COLOUR_INDEX_BV` | 0.9574 | [Bruzual 2003](/data/papers/index.md#bruzual2003) Chabrier SSP, Z = 0.02, 10 Gyr |
| `BULGE_TO_TOTAL_LIGHT_V` | 0.0775 | [The light ratio](#the-light-ratio--bt-in-the-solve-is-not-the-published-number), above |
| `DISC_COLOUR_INDEX_BV` | **0.7129** | solved |

Both then go through the star field's own chain — [Ballesteros 2012](/data/papers/index.md#ballesteros2012) → Planck →
CIE 1931 → linear sRGB (`scripts/colour/README.md`), unquantised — so a
component's hue and a single star's are the same function of B−V. A
stellar population is not a blackbody; what survives the chain is the
colour index, not the SED.

**The decision this encodes: [Bland-Hawthorn 2016](/data/papers/index.md#blandhawthorn2016)'s integrated colour wins over a
physically-plausible disc/bulge contrast.** 0.7129 makes the disc only
0.24 mag bluer than the bulge, which is a weaker contrast than a textbook
Sbc shows, and the same [Bruzual 2003](/data/papers/index.md#bruzual2003) grid over a τ ≈ 8 Gyr declining SFH at solar
Z returns 0.54 for a disc-like population. Four reasons the published
total still wins:

- **The layer's photometry is already one system.** `GALAXY_TOTAL_ABSMAG_V`
  and the 0.73 are the same [Bland-Hawthorn 2016](/data/papers/index.md#blandhawthorn2016) table and the same MW-analogue analysis
  behind it ([Licquia 2015b](/data/papers/index.md#licquia2015b)). Solving preserves that
  colour by construction; an independent pair puts the rendered Galaxy at
  **0.567** — 0.163 mag bluer than published, which is *larger* than both
  the ~0.1 mag typical calibration error of [Bland-Hawthorn 2016](/data/papers/index.md#blandhawthorn2016) Table 2 (note a)
  and the magnitude-vs-colour inconsistency its note b flags (B − V from
  the table's own magnitudes 0.67, tabulated 0.73), so it cannot be absorbed as either.
- **The disc carries 92 % of the V light, so the composite colour IS
  essentially the disc colour** — and the composite is what the camera
  reads from outside, the one directly checkable observable. Handing it to
  a synthesised SFH would make a modelling choice (τ, Z) the dominant
  visible quantity.
- **"Too red for an Sbc" measures against the wrong reference.** LNB15
  place the Milky Way in the **green valley** — a bright but relatively red
  spiral for its mass. A red disc is the published result, not an artefact
  of the solve.
- **The bulge barely matters.** Moving it across the whole `data/bc03/`
  metallicity bracket — with f moving with it, as it must — puts the disc
  at 0.7163 (Z = 0.008) and 0.7130 (Z = 0.05), under 0.004 mag. So the only
  load-bearing input is the 0.73; the SSP choice is not in play. Pinned,
  not asserted.

**A mass B/T here would have biased the disc BLUE** (0.6944), which is the
direction the eyeballed pale-lavender palette already leaned — using it
would have quietly ratified the thing this replaces.

**Deriving the palette moved the sightline table, and that is not a bug in
the "hue never moves flux" invariant.** It holds at emission —
`relativeLuminance(TINT) = 1`, and every dust-free column is
bit-identical — but `REDDENING_RGB` attenuates per channel inside the same
march, so a redder population transmits more of its own light. The plane
gained 0.026 mag at b = 5 and 0.023 mag toward the centre; the poles did
not move. Every row below is post-derivation.

## The resolution hole — the band marches the model minus the drawn stars

`GALAXY_TOTAL_ABSMAG_V` is the light of every star, and the star field
draws the resolved ones itself, so a band marching the whole emissivity
counts them twice. The two shaders and the CPU mirror therefore multiply
the emissivity at each step by **one minus the catalogue's share of the
model's light at that point**, read out of `resolved-hole-table.ts`:

- **32 distance shells from Sol**, a tenth of a dex wide from 10 pc to
  15.8 kpc, **× 8 equal-|sin b| bands** — equal solid angle each, |sin b|
  from Sol being |z| over the distance since Sol sits in the plane.
- Each cell is the catalogue's intrinsic luminosity inside it
  (`100·10^(−0.4·M_V)` per record) over the model's
  (`ρ₀ × shape` integrated on the same cell), clamped to [0, 1]. A cell the
  catalogue outshines is wholly resolved; the band cannot emit negative
  light for the rest. A cell under 500 stars takes its shell's all-sky
  share ([How a cell is measured](/scripts/milkyway-calibration/README.md#how-a-cell-is-measured)).
- Sampled **bilinearly in (log d, |sin b|)** over the cell centres and
  clamped to the edge cells beyond them, so the first shell's value holds
  inside 10 pc and the last shell's past 15.8 kpc. That is the rule the
  cube is resampled with (`sampleTexelCentres`), not what the shader does:
  it computes one `vec3` into the cube and takes a trilinear fetch
  ([The table is a 3D grid, not a uniform array](#the-table-is-a-3d-grid-not-a-uniform-array)), importing the layout
  constants by name.
- Applied **before the dust**, so the resolved stars and what the band
  still draws see the same column — the catalogue's stars are rendered
  through the per-star extinction prepass, the band's remainder through its
  march.

**Measured on the V ≤ 11 catalogue (<!-- count:build-catalog/recordCount -->979,634<!-- /count --> records), not authored.**
Within 200 pc the catalogue carries the whole of the model's light — the
model's emissivity at Sol is right to a few percent, which is the one
sightline-free check the solve has. From there the share falls with
distance, sooner toward the pole, whose population is thinner, and is near
nothing a few kiloparsecs out; the table carries the values. Over the whole
model the hole removes **<!-- count:milkyway-sightlines/holeShareOfModelPct d2 -->0.35<!-- /count --> %** of the band's light —
<!-- count:milkyway-sightlines/holeDimsBandFromM31 d3 -->0.004<!-- /count --> mag from M31, so the ordering below stands — and about the
catalogue's own light over the tabulated volume, the shell average being
blind to structure in longitude.

**The pole's hole column is the acceptance, and only the pole's.**
Dust-free from Sol, the light the hole removes toward the pole reads
<!-- count:milkyway-sightlines/holeColumnNgp d2 -->24.01<!-- /count --> against the catalogue's <!-- count:milkyway-sightlines/capNgp d2 -->24.11<!-- /count --> cap. The same column toward the
centre reads <!-- count:milkyway-sightlines/holeColumnGc d2 -->21.48<!-- /count --> against <!-- count:milkyway-sightlines/capGc d2 -->22.19<!-- /count -->, and that gap is not a finding:
dust-free, the hole dims the GC's column by only <!-- count:milkyway-sightlines/gcDustFreeHoleDims d2 -->0.02<!-- /count --> mag, so the light
it removes is the small difference of two near-equal columns and any error
in the hole is amplified many times over on the way out. Read the centre row as a
sanity check that the sign and order are right, never as a tolerance.
A single ray against a 10° cap is the other reason it cannot be one. **What it does on screen is a fainter
diffuse band with the same stars in it**: the dusty column toward the
centre is the nearest two kiloparsecs, so it dims <!-- count:milkyway-sightlines/holeDimsGc d2 -->0.65<!-- /count --> mag; the
anticentre <!-- count:milkyway-sightlines/holeDimsAnticentre d2 -->0.63<!-- /count -->, b = 30 <!-- count:milkyway-sightlines/holeDimsB30 d2 -->0.58<!-- /count -->, the pole <!-- count:milkyway-sightlines/holeDimsNgp d2 -->0.83<!-- /count -->, b = 5 —
where the column reaches through the plane — <!-- count:milkyway-sightlines/holeDimsB5 d2 -->0.19<!-- /count -->.

**From Sol, at any epoch the clock reaches, the sky's total does not
move**: its light shifts from the smooth march into the points, and the
two columns above are that check measured. The epoch is free because
5,000 yr of proper motion is sub-parsec for the whole catalogue against a
tenth-dex shell, so no star changes cell. **From outside the Galaxy the
claim is not yet measured.** What is pinned there is the band alone,
<!-- count:milkyway-sightlines/holeDimsBandFromM31 d3 -->0.004<!-- /count --> mag fainter ([Two checks](#two-checks-and-both-disagree-by-the-same-sign-and-order)). Giving it back needs the star field to
carry the whole of what came out, and the display-floor collapse does
preserve a star's flux integral ([§ 4](/docs/render-rules.md#4-invisible-is-not-free)) while the
magnitude cull above it does not — so the like-for-like total from
1 Mpc is the band plus the catalogue's own patch sum, which is
`stellata-xypg.43`.

## The table is a 3D grid, not a uniform array

The measured table in `resolved-hole-table.ts` is still what the calibration
ships against; the cube is that table resampled at load, and the CPU mirror
samples the same cube, so mirror and GPU agree exactly.

A 64-cube `Data3DTexture`, `RedFormat` + `HalfFloatType`, **linear/linear
and clamp-to-edge on all three axes**, 0.5 MB — every one of those
load-bearing. The shader's whole coordinate is `fromSol / 8000 + 0.5`, one
multiply-add, where the 2D fetch cost a `dot`, a `max`, a `log`, an
`inversesqrt` and an `abs`. Clamp-to-edge is the outside-the-cube rule and
needs no branch, because the edge cells are already ~0: a corner sits
6.9 kpc from Sol, past where the catalogue resolves anything.

**Why a cube and not a finer 1D re-binning.** The hole is a resolved
fraction under a magnitude limit, so it is intrinsically a sigmoid in
log d, and log spacing is its natural parameterisation. Re-binning linear in
d² to kill the `log` does not converge: the first cell spans
0 → dMax/√(2N), still 177 pc at 512 cells, and the high-latitude columns are
made of exactly that near field, so doubling the cells barely moves the
worst sightline. A uniform cube has no degenerate cell at the origin and
does converge as its cells shrink.

**Resampling the table onto the 64-cube is the price**, measured against the
shipped table over the 32-step log march, emissivity-weighted and dust-free,
worst of eight sightlines and concentrated at the poles: far above the
half-float loss (<!-- count:milkyway-sightlines/halfFloatLossMag d5 -->0.00047<!-- /count --> mag worst, pinned) and far under what a single
scalar rescale of the hole would cost. It is a field in galactocentric
space, so it is right from every vantage, not just Sol's.

**The voxels are `1 − strength·hole`, not the hole**, which is what the
march multiplies by anyway. The scaling is affine, so interpolating these
IS one minus the interpolated hole; what it buys is that half-float's error
is *relative*, and the multiplier is smallest exactly where the hole is
largest. Storing the hole would have put a ~1e-3 absolute floor under a
residual that goes to zero in the inner cells.

**The hole cube is sampled once per process and every consumer rescales
from it** (`shippedHoleVoxels`). Evaluating the 262,144 voxels costs ~50 ms
— a `hypot`, a `log10` and a bilinear table read each — and no strength
moves any of it, so a strength change is one multiply per voxel. The
shipped grid is a function rather than a module-scope constant for the same
reason: a boot that draws no band must not pay the build.

**The shader fetches level 0 explicitly** — `.level(int(0))`, pinned in
`../../../client/webgpu/milkyway/milkyway-band-tsl-drift.test.ts`. A `Data3DTexture` carries
no mip chain, so an implicit LOD selects nothing; what it does buy is the
sampler's screen-space derivatives, computed inside the march's `Break`
where they are non-uniform, on a layer that is pure fill.

Half rather than single: `r16float` is core-filterable, where `r32float`
needs the optional `float32-filterable` device feature.

Regenerate the underlying table with `pnpm run measure:band-resolved` on a
floor-on build when the build stops on it: the bake's record holds the
catalogue columns it measured, so a membership or photometry change
stales it ([Band calibration measurements](/scripts/milkyway-calibration/README.md)). `MilkyWay.setResolvedHoleStrength(0)` — the `resolvedHole`
slider in the debug panel — switches the hole off for an A/B, rebuilding the
cube, at which point the band draws the resolved stars' light a second time.
The one writer clamps it to [0, 1] rather than the slider doing it: past 1
the hole outruns the model, the column goes negative and its `−2.5·log10`
is NaN.

## Two checks, and both disagree by the same sign and order

Neither is an anchor. Both are pinned in `../../../../tests/integration/milkyway.test.ts`, with the
hole in the model column.

| check | published | model | model is |
| --- | --- | --- | --- |
| NGP diffuse residual | <!-- count:milkyway-sightlines/ngpResidual d2 -->25.44<!-- /count --> | <!-- count:milkyway-sightlines/ngpDustFreeModel d2 -->24.13<!-- /count --> | **<!-- count:milkyway-sightlines/ngpResidualOverModel d3 -->1.307<!-- /count --> mag brighter** |
| Galactic centre vs [Leinert 1998](/data/papers/index.md#leinert1998)'s b = 30° total | 22.92 | <!-- count:milkyway-sightlines/sbGc d2 -->22.53<!-- /count --> | **<!-- count:milkyway-sightlines/gcUnderLeinertTotal d3 -->0.390<!-- /count --> mag brighter** |

The second row grades a b = 0 sightline against a b = 30° value, not like
for like; what to grade it against is an open decision (`stellata-uadc.69.10`).

The 25.44 is *not* published; `diffuse-reference.ts` builds it:

| | mag/arcsec² |
| --- | --- |
| [Leinert 1998](/data/papers/index.md#leinert1998) Table 24, NGP — **total** starlight | 23.83 |
| The <!-- count:build-catalog/recordCount -->979,634<!-- /count --> catalogue stars Stellata draws at V ≤ 11 | <!-- count:milkyway-sightlines/capNgp d3 -->24.111<!-- /count --> |
| Residual left for the diffuse band | **<!-- count:milkyway-sightlines/ngpResidual d2 -->25.44<!-- /count -->** |

**The catalogue rows are measured by the `measure:band-resolved` bake, into
`resolved-hole-table.ts` beside the hole** (`scripts/milkyway-calibration/`), and the residual moves
with them. At V ≤ 11 the pole cap reads <!-- count:milkyway-sightlines/capNgp d3 -->24.111<!-- /count --> and the centre's <!-- count:milkyway-sightlines/capGc d3 -->22.191<!-- /count -->, so
the star field carries **<!-- count:milkyway-sightlines/catalogueShareOfPoleTotalPct sig2 -->77<!-- /count --> %** of [Leinert 1998](/data/papers/index.md#leinert1998)'s pole total. **A record
has to land INSIDE a 10° cap to move a row**, so a re-run the build demands
can leave both rows where they were; when to re-run is the build's stop, not
the caps.

[Leinert 1998](/data/papers/index.md#leinert1998)'s table is a sky model ([Wainscoat 1992](/data/papers/index.md#wainscoat1992)) for *all* stars,
resolved or not, so pinning the published figure would double-count the
star field — the retired `GC_BAND_REFERENCE_MAG_ARCSEC2 = 20.0` anchor's
exact defect. The GC row is graded against the total rather than a
residual because the catalogue's GC entry is de-extincted while the real
column is ~30 mag: `diffuseResidualMagArcsec2` returns `null` for that
pair deliberately, and folding it in would only widen the gap.

**The two constraints cannot both be met, and no shape parameter bridges
them** — the argument is [The luminosity solve](/docs/science-galactic-structure.md#the-luminosity-solve-and-the-constraint-it-cannot-satisfy).
The total wins because it is what the camera sees from
outside: the Galaxy from M31 reads <!-- count:milkyway-sightlines/galaxyFromM31 d2 -->3.08<!-- /count --> against M31 from Sol at <!-- count:milkyway-sightlines/m31FromSol d2 -->3.44<!-- /count -->,
ordered correctly, where the sightline anchor had it *fainter* than M31 —
and the residual anchor re-run at V ≤ 11 would put it fainter still. What
the deeper catalogue changed is the size of the disagreement, not its sign:
**band plus catalogue at the pole reads <!-- count:milkyway-sightlines/poleBandPlusCatalogue d2 -->23.42<!-- /count --> against
[Leinert 1998](/data/papers/index.md#leinert1998)'s 23.83**, <!-- count:milkyway-sightlines/poleBandPlusCatalogueOverTotal d2 -->0.41<!-- /count --> mag over, where band-without-hole plus
catalogue read <!-- count:milkyway-sightlines/poleDoubleCountedOverTotal d2 -->0.88<!-- /count --> over — the double count was the other <!-- count:milkyway-sightlines/poleDoubleCount d2 -->0.47<!-- /count -->.
That <!-- count:milkyway-sightlines/poleBandPlusCatalogueOverTotal d2 -->0.41<!-- /count --> is the scale disagreement proper. eso0932a sides with the total but
confirms a pole-side excess independently ([§ 8](/docs/science-hdr-pipeline.md#8-validation-contract-h7),
graded on the pre-hole table).

## The gradient this produces, and what it reads on screen

Levels are of 255 at the base epoch, no EV trim, no viewport — the
summation area is fixed in angle. A threshold star also lands on <!-- count:milkyway-sightlines/levelThreshold d2 -->38.25<!-- /count -->, so
`/255` doubles as "against a just-visible star". All pinned in
`../../../../tests/integration/milkyway.test.ts`.

**`Δ` is `S − S_lim`** against the 22.0 extended threshold, a plain
subtraction; negative is over threshold. Don't restate it as a ratio of the levels: those are
tone-mapped and encoded, so `2.5·log10` of one reads ~0.5 mag shy at the
pole.

| sightline | mag/arcsec² | Δ vs S_lim | /255 |
| --- | --- | --- | --- |
| l = 0, b = 5 | <!-- count:milkyway-sightlines/sbB5 d2 -->20.93<!-- /count --> | **<!-- count:milkyway-sightlines/gapB5 d2 -->-1.07<!-- /count -->** — the maximum | <!-- count:milkyway-sightlines/levelB5 d1 -->63.7<!-- /count --> |
| l = 0, b = 0 (GC) | <!-- count:milkyway-sightlines/sbGc d2 -->22.53<!-- /count --> | <!-- count:milkyway-sightlines/gapGc d2 -->0.53<!-- /count --> | <!-- count:milkyway-sightlines/levelGc d1 -->21.7<!-- /count --> |
| anticentre | <!-- count:milkyway-sightlines/sbAnticentre d2 -->22.69<!-- /count --> | <!-- count:milkyway-sightlines/gapAnticentre d2 -->0.69<!-- /count --> | <!-- count:milkyway-sightlines/levelAnticentre d1 -->15.7<!-- /count --> |
| b = 30 | <!-- count:milkyway-sightlines/sbB30 d2 -->23.10<!-- /count --> | <!-- count:milkyway-sightlines/gapB30 d2 -->1.10<!-- /count --> | <!-- count:milkyway-sightlines/levelB30 d1 -->3.6<!-- /count --> |
| NGP | <!-- count:milkyway-sightlines/sbNgp d2 -->24.23<!-- /count --> | <!-- count:milkyway-sightlines/gapNgp d2 -->2.23<!-- /count --> | <!-- count:milkyway-sightlines/levelNgp d1 -->0.0<!-- /count --> |

Plane-to-pole contrast **<!-- count:milkyway-sightlines/planeToPoleContrast d2 -->1.70<!-- /count --> mag** photometrically. **The midplane is
not the maximum** — b ≈ 5° is, because the in-plane sightline eats the
most dust. The real band behaves the same way; the dark rift is dust,
not a gap in the stars. Every row is the band alone — the resolved stars
the hole took out of it are drawn as points on top ([The resolution
hole](#the-resolution-hole--the-band-marches-the-model-minus-the-drawn-stars)), and b = 5 is the one row the hole barely touches, because that
column reaches through the plane past where the catalogue resolves.

**Sub-threshold rows carry the operator's faint-end toe**
([Operator](../../tonemap/README.md#operator)): over-threshold levels are untouched,
and 1.5 mag under threshold is black by construction, which is where the
NGP row's level sits: on the dither floor. Nothing pins the band to the threshold.

**Every row here is dust-attenuated, so the dust cascade moves them and the
solve does not.** [The dust stack](/docs/science-galactic-structure.md#the-dust-stack--sources-domains-and-the-partition) fixes
which is which: the solve, its inputs and the dust-free NGP residual are
anchors carrying no slack; this table, the plane-to-pole contrast and the
[Leinert 1998](/data/papers/index.md#leinert1998) GC check are outcomes that move when the measured tiers land
([How the decision grades](/docs/science-galactic-structure.md#how-the-decision-grades-and-what-it-does-not-fix)
carries the cascade's rows). Re-pin them there; do not treat a moved row as
a calibration error.

**The 32-step in-volume march under-counts the GC column by <!-- count:milkyway-sightlines/gcMarchUnderCountPct d1 -->2.7<!-- /count --> %**
against a converged march (pinned). Deliberately left: `STEPS` is a visual + perf decision, and it
cannot bias the calibration at all — the solve is a volume integral, so no
march feeds it.

**The convolution and the footprint softening both leave this table where it
is** — the first is an identity on a uniform field, the second is metres
against a 300 pc scale height from inside the disc. No row moves more than
<!-- count:milkyway-sightlines/footprintWorstMag d4 -->0.0042<!-- /count --> mag at either FOV extreme (pinned). Neither is inert from *outside* the
Galaxy, which is where they were needed.

**Do not raise or lower the emissivity if the band still reads wrong** —
it is solved against a published luminosity and carries no slack.
`DR_MAG` cannot do it either: it lifts the band and the star field
together, so it has no term for a point-vs-extended ratio. The lever is
the extended-source threshold itself, which is the instrument's
`skyBackgroundMagArcsec2` ([Extended sources](../../emission/README.md#extended-sources--two-solid-angles-one-write-tail)).

The Local Group emission layer runs the same mapping, the same constant
([Zero free parameters](../../../client/local-group/emission/README.md#zero-free-parameters--the-emission-scale-is-derived)) and now the same
solve. The two layers are one unit system: same zero point, same
`stellataSurfaceBrightnessLuminance` gain, same `ρ₀ = d²·F/G`, both
mag/arcsec² in one exposure. All that differs is which magnitude goes in
— LG a catalogue *apparent* one at each object's own distance, the band a
published *absolute* one at 10 pc.
