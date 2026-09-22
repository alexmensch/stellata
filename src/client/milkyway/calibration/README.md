# Milky Way photometric calibration

The published numbers the band's emissivity is solved against, the light
ratio and the two population colours derived from them, and the two
sightline checks the result is graded by. The solve itself —
`DISC_DENSITY0` / `BULGE_DENSITY0` — lives in `../milkyway-column-pure.ts`
beside the shape integrals it divides by, and its pins live in
`../milkyway.test.ts`; everything about *what goes in* and *how well it
comes out* is here.

## Files

- `diffuse-reference.ts` — `GALAXY_TOTAL_ABSMAG_V`, the mass-to-light
  inputs, `bulgeToTotalLight` and the `BULGE_TO_TOTAL_LIGHT_V` it derives,
  `GALAXY_TOTAL_COLOUR_INDEX_BV` and the two component indices, the
  Leinert totals, the resolved-catalogue subtraction, and
  `diffuseResidualMagArcsec2`.
- `diffuse-reference.test.ts` — the residual arithmetic, the light-ratio
  derivation and the colour solve, reading all three `data/bc03/` tables
  back: the shipped Υ\*_V and (B−V) off `m62` and the metallicity
  brackets off `m52` / `m72`.
- `resolved-hole-table.ts` — **generated** by
  `scripts/milkyway-calibration/` off the built catalogue: the two cap
  rows, the record count they were measured on, and the resolution-hole
  table (§ The resolution hole). Never edited by hand.
- `resolved-fraction-pure.ts` (+ test) — the table's layout constants, the
  rule the table is sampled with, the cube it is resampled onto, the
  CPU mirror of the trilinear fetch both shaders make, and
  `resolvedHoleCatalogueMismatch`: the table subtracts the light of the
  catalogue it was measured on, so `MilkyWay` checks the loaded record count
  against `RESOLVED_HOLE_CATALOGUE_RECORDS` once and warns. A warning, never
  a throw — a shallower local build is legitimate and the band still renders.
- `resolved-hole-texture.ts` (+ test) — the `Data3DTexture` those voxels go
  into and its filter pair.

## The zero point is not the band's own — it is the emission unit's

`SB_ZERO_POINT` (`../../hdr/emission/emission-pure.ts`) = 26.5721
mag/arcsec², shared verbatim with the Local Group layer. A raymarched
column is flux per steradian once `density0` sits in zero-point-free flux
units, so nothing about the conversion is free.

What the layer derives is each component's `density0`, through the same
`ρ₀ = d²·F/G` the Local Group solves per object
(`../../hdr/emission/README.md` § Solving ρ₀) — here with **d = 10 pc**,
because the anchor is an *absolute* magnitude:

```
DISC_DENSITY0  = 100·10^(−0.4·M_V)·(1 − B/T) / ∫ discShape  dV ≈ 6.133e−2
BULGE_DENSITY0 = 100·10^(−0.4·M_V)·     B/T  / ∫ bulgeShape dV ≈ 2.074e−1
```

`GALAXY_TOTAL_ABSMAG_V` = **−21.37** (BHG16 Table 2). **Zero free
parameters, and no march feeds the calibration.**

Three properties a change here must keep:

- **The shape integrals may not reach a `density0`.** `discShape` /
  `bulgeShape` are the profiles at unit ρ₀ — the integrals march *those*,
  the density functions multiply the solved constant on top. ρ₀ is a scale,
  **not** a point emissivity: the disc's vertical term is 1.04 at the
  midplane, so `DISC_DENSITY0` sits 4 % above (R₀, 0).
- **The scalar volume integral is the LUMINANCE integral**, because both
  tints are luma-normalised (`../README.md` § Population tints). That is
  what lets one flux total be split between two hues without either moving
  light.
- **Truncation compensation is inherent.** G is over the ACTUAL proxy
  volume, so the **0.076 mag** the disc envelope clips against all space is
  redistributed inward — a tighter envelope *brightens* what remains. Mostly
  radial, against 0.018 mag vertical (`../README.md` § Density profiles),
  and one ellipsoid does not separate into the two — the pin is the
  all-space closed form.

**Solved dust-free, and that is the point.** An earlier design derived the
zero point *through* the shipped extinction, so the photometric scale swung
2.7 mag across the dust knob — including at the poles, where there is no
dust. Emissivity is intrinsic and `GALAXY_TOTAL_ABSMAG_V` is itself
internal-extinction-corrected; `../milkyway.test.ts` pins the independence.

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
| `BULGE_TO_TOTAL_MASS` | 0.150 | Licquia & Newman 2015, stellar **mass** |
| `BULGE_ML_V` | 3.15 | BC03 Chabrier SSP, Z = 0.02, 10 Gyr (`data/bc03/`) |
| `DISC_ML_V` | 1.5 | Flynn et al. 2006, **measured** local disc column |

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
- **The disc value has an independent check.** The same BC03 grid
  composited over an exponentially declining SFH (τ ≈ 8 Gyr, solar Z)
  returns Υ\*_V = 1.34 against Flynn's measured 1.5 ± 0.2 — two routes,
  one measured and one modelled, agreeing inside the measurement's error.

**From Sol this correction is nearly invisible and that is the trap.** The
bulge sits behind 4.6 τ_V from here, so it is 0.02 % of the GC column and
13.9 % of the b = 5 one; every sightline row below moves under 0.09 mag.
Where it shows is the face-on external view, which the camera can reach
(`AGENTS.md` § Camera-anywhere, any-epoch): the centre pixel goes from
48 % bulge to **31 %**, and the integrated bulge/disc luminance ratio from
0.176 to **0.0840**. That contrast is what makes the model read as an Sbc
rather than an S0, and it is pinned in `../milkyway.test.ts` alongside the
edge-on case — where the bulge sits behind the full midplane dust column
and carries 5.0e−5 of the centre pixel, exactly as a real edge-on spiral
does in V.

## Population colours — the disc's is solved, not cited

Same shape of problem as the light ratio: **nobody publishes the Galaxy's
colour split by component**, only its integrated index. The shared solve
(`../../hdr/emission/README.md` § Population colours) takes the bulge off
the SSP grid and returns the disc:

| term | value | source |
| --- | --- | --- |
| `GALAXY_TOTAL_COLOUR_INDEX_BV` | 0.73 | BHG16 Table 2 |
| `BULGE_COLOUR_INDEX_BV` | 0.9574 | BC03 Chabrier SSP, Z = 0.02, 10 Gyr |
| `BULGE_TO_TOTAL_LIGHT_V` | 0.0775 | § The light ratio, above |
| `DISC_COLOUR_INDEX_BV` | **0.7129** | solved |

Both then go through the star field's own chain — Ballesteros → Planck →
CIE 1931 → linear sRGB (`scripts/colour/README.md`), unquantised — so a
component's hue and a single star's are the same function of B−V. A
stellar population is not a blackbody; what survives the chain is the
colour index, not the SED.

**The decision this encodes: BHG16's integrated colour wins over a
physically-plausible disc/bulge contrast.** 0.7129 makes the disc only
0.24 mag bluer than the bulge, which is a weaker contrast than a textbook
Sbc shows, and the same BC03 grid over a τ ≈ 8 Gyr declining SFH at solar
Z returns 0.54 for a disc-like population. Four reasons the published
total still wins:

- **The layer's photometry is already one system.** `GALAXY_TOTAL_ABSMAG_V`
  and the 0.73 are the same BHG16 table and the same MW-analogue analysis
  behind it (Licquia, Newman & Brinchmann 2015). Solving preserves that
  colour by construction; an independent pair puts the rendered Galaxy at
  **0.567** — 0.163 mag bluer than published, which is *larger* than the
  ~0.1 mag magnitude-vs-colour inconsistency BHG16 flags in itself, so it
  cannot be absorbed as that.
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
  share (`scripts/milkyway-calibration/README.md` § How a cell is measured).
- Sampled **bilinearly in (log d, |sin b|)** over the cell centres and
  clamped to the edge cells beyond them, so the first shell's value holds
  inside 10 pc and the last shell's past 15.8 kpc. That is the rule the
  cube is resampled with (`sampleTexelCentres`), not what the shader does:
  it computes one `vec3` into the cube and takes a trilinear fetch
  (§ The table is a 3D grid, not a uniform array), importing the layout
  constants by name.
- Applied **before the dust**, so the resolved stars and what the band
  still draws see the same column — the catalogue's stars are rendered
  through the per-star extinction prepass, the band's remainder through its
  march.

**Measured on the V ≤ 11 catalogue (983,068 records), not authored.**
Within 200 pc the catalogue carries the whole of the model's light — the
model's emissivity at Sol is right to a few percent, which is the one
sightline-free check the solve has. From there the share falls: half the
plane's light is resolved at 500 pc, a third at 1 kpc, under 2 % past
3 kpc; the pole's population is thinner and its share is 44 % at 250 pc.
Over the whole model the hole removes **0.35 %** of the band's light —
0.004 mag from M31, so the ordering below stands — and 1.03× the
catalogue's own light over the tabulated volume, the shell average being
blind to structure in longitude.

**The pole's hole column is the acceptance, and only the pole's.**
Dust-free from Sol, the light the hole removes toward the pole reads 24.01
against the catalogue's 24.11 cap. The same column toward the centre reads
21.48 against 22.19, and that gap is not a finding: dust-free, the GC's
total and unresolved columns differ by about a hundredth of a magnitude, so
their difference is under a percent of either and any error in the hole is
amplified some fiftyfold on the way out. Read the centre row as a
sanity check that the sign and order are right, never as a tolerance.
A single ray against a 10° cap is the other reason it cannot be one. **What it does on screen is a fainter
diffuse band with the same stars in it**: the dusty column toward the
centre is the nearest two kiloparsecs, so it dims 0.66 mag; the anticentre
0.63, b = 30 0.58, the pole 0.83, b = 5 — where the column reaches through
the plane — 0.19.

**From Sol, at any epoch the clock reaches, the sky's total does not
move**: its light shifts from the smooth march into the points, and the
two columns above are that check measured. The epoch is free because
5,000 yr of proper motion is sub-parsec for the whole catalogue against a
tenth-dex shell, so no star changes cell. **From outside the Galaxy the
claim is not yet measured.** What is pinned there is the band alone,
0.004 mag fainter (§ Two checks). Giving it back needs the star field to
carry the whole of what came out, and the display-floor collapse does
preserve a star's flux integral (`docs/render-rules.md` § 4) while the
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
made of exactly that near field — measured worst error 0.113 mag at 8 KB
against 0.115 at 4 KB. A uniform cube has no degenerate cell at the origin
and does converge: 250 pc cells give 0.103 mag, 125 pc give **0.044**, 63 pc
give 0.009.

**0.044 mag is the price of the 64-cube**, measured against the shipped
table over the 32-step log march, emissivity-weighted and dust-free, worst
of eight sightlines and concentrated at the poles. Against the 4.4e-4 mag
half-float budget that is four hundred times larger; against the 0.378 mag a
single scalar rescale would cost, nine times smaller. It is a field in
galactocentric space, so it is right from every vantage, not just Sol's.

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
`../../webgpu/milkyway/milkyway-band-tsl-drift.test.ts`. A `Data3DTexture` carries
no mip chain, so an implicit LOD selects nothing; what it does buy is the
sampler's screen-space derivatives, computed inside the march's `Break`
where they are non-uniform, on a layer that is pure fill.

Half rather than single: `r16float` is core-filterable, where `r32float`
needs the optional `float32-filterable` device feature.

Regenerate the underlying table with `pnpm run measure:band-resolved` on a
floor-on build whenever the catalogue's membership or photometry moves
inside 15 kpc; the script refuses a shallower catalogue than the table was
measured on. `MilkyWay.setResolvedHoleStrength(0)` — the `resolvedHole`
slider in the debug panel — switches the hole off for an A/B, rebuilding the
cube, at which point the band draws the resolved stars' light a second time.
The one writer clamps it to [0, 1] rather than the slider doing it: past 1
the hole outruns the model, the column goes negative and its `−2.5·log10`
is NaN.

## Two checks, and both disagree by the same sign and order

Neither is an anchor. Both are pinned in `../milkyway.test.ts`, with the
hole in the model column.

| check | published | model | model is |
| --- | --- | --- | --- |
| NGP diffuse residual | 25.44 | 24.13 | **1.308 mag brighter** |
| Galactic centre, Leinert total | 22.92 | 22.54 | **0.385 mag brighter** |

The 25.44 is *not* published; `diffuse-reference.ts` builds it:

| | mag/arcsec² |
| --- | --- |
| Leinert et al. 1998 Table 24, NGP — **total** starlight | 23.83 |
| The 983,068 catalogue stars Stellata draws at V ≤ 11 | 24.111 |
| Residual left for the diffuse band | **25.44** |

**The catalogue rows are measured per build, into `resolved-hole-table.ts`
beside the hole** (`scripts/milkyway-calibration/`), and the residual moves
with them. The 388k catalogue before the floor read 24.271 at the pole over
1,155 stars and 22.368 toward the centre over 11,776; V ≤ 11 takes the pole
to 24.110 over 2,763 and the centre to 22.187 over 16,960, so the star field's
share of Leinert's pole total goes from two thirds to **77 %**. **A record
has to land INSIDE a 10° cap to move a row**, so `recordCount` can move
without moving either: re-derive when a record lands within 10° of a centre,
not whenever the count changes.

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
than M31 — and the residual anchor re-run at V ≤ 11 would put it a
magnitude fainter still. What the deeper catalogue changed is the size of
the disagreement, not its sign: **band plus catalogue at the pole reads
23.42 against Leinert's 23.83**, 0.41 mag over, where band-without-hole
plus catalogue read 0.88 over — the double count was the other 0.47. That
0.41 is the scale disagreement proper. eso0932a sides with the total but
confirms a pole-side excess independently (`docs/science-hdr-pipeline.md`
§ 8, graded on the pre-hole table).

## The gradient this produces, and what it reads on screen

Levels are of 255 at the base epoch, no EV trim, no viewport — the
summation area is fixed in angle. A threshold star also lands on 38.25, so
`/255` doubles as "against a just-visible star". All pinned in
`../milkyway.test.ts`.

**`Δ` is `S − S_lim`** against the 22.0 extended threshold, a plain
subtraction. Don't restate it as a ratio of the levels: those are
tone-mapped and encoded, so `2.5·log10` of one reads ~0.5 mag shy at the
pole.

| sightline | mag/arcsec² | Δ vs S_lim | /255 |
| --- | --- | --- | --- |
| l = 0, b = 5 | 20.93 | **1.07 OVER** — the maximum | 63.6 |
| l = 0, b = 0 (GC) | 22.54 | 0.54 under | 21.5 |
| anticentre | 22.69 | 0.69 under | 15.5 |
| b = 30 | 23.10 | 1.10 under | 3.6 |
| NGP | 24.24 | 2.24 under | 0.0 |

Plane-to-pole contrast **1.70 mag** photometrically. **The midplane is
not the maximum** — b ≈ 5° is, because the in-plane sightline eats the
most dust. The real band behaves the same way; the dark rift is dust,
not a gap in the stars. Every row is the band alone — the resolved stars
the hole took out of it are drawn as points on top (§ The resolution
hole), and b = 5 is the one row the hole barely touches, because that
column reaches through the plane past where the catalogue resolves.

**Sub-threshold rows carry the operator's faint-end toe**
(`../../hdr/tonemap/README.md` § Operator): over-threshold levels are untouched,
and 1.5 mag under threshold is black by construction — the NGP at 2.24
under sits on the dither floor. Nothing pins the band to the threshold.

**Every row here is dust-attenuated, so the dust cascade moves them and the
solve does not.** `docs/science-galactic-structure.md` § The dust stack fixes
which is which: the solve, its inputs and the dust-free NGP residual are
anchors carrying no slack; this table, the plane-to-pole contrast and the
Leinert GC check are outcomes that move when the measured tiers land, to
21.09 / 21.91 / 21.91 / 22.83 / 23.33 and a 1.42 contrast on the measured
cascade. Re-pin them there; do not treat a moved row as a calibration error.

**The 32-step in-volume march under-counts the GC column by 3.1 %**
against a converged march (pinned; 1.6 % without the hole, which turns the
emissivity over inside the first kiloparsec where the log march spends six
steps). Deliberately left: `STEPS` is a visual + perf decision, and it
cannot bias the calibration at all — the solve is a volume integral, so no
march feeds it.

**The convolution and the footprint softening both leave this table where it
is** — the first is an identity on a uniform field, the second is metres
against a 300 pc scale height from inside the disc. Every row moves under
0.005 mag at both FOV extremes (pinned). Neither is inert from *outside* the
Galaxy, which is where they were needed.

**Do not raise or lower the emissivity if the band still reads wrong** —
it is solved against a published luminosity and carries no slack.
`DR_MAG` cannot do it either: it lifts the band and the star field
together, so it has no term for a point-vs-extended ratio. The lever is
the extended-source threshold itself, which is the instrument's
`skyBackgroundMagArcsec2` (`../../hdr/emission/README.md` § Extended
sources).

The Local Group emission layer runs the same mapping, the same constant
(`../../local-group/emission/README.md` § Zero free parameters) and now the same
solve. The two layers are one unit system: same zero point, same
`stellataSurfaceBrightnessLuminance` gain, same `ρ₀ = d²·F/G`, both
mag/arcsec² in one exposure. All that differs is which magnitude goes in
— LG a catalogue *apparent* one at each object's own distance, the band a
published *absolute* one at 10 pc.
