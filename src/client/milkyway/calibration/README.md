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

## Two checks, and both disagree by the same sign and order

Neither is an anchor. Both are pinned in `../milkyway.test.ts`.

| check | published | model | model is |
| --- | --- | --- | --- |
| NGP diffuse residual | 25.01 | 23.31 | **1.697 mag brighter** |
| Galactic centre, Leinert total | 22.92 | 21.88 | **1.043 mag brighter** |

The 25.01 is *not* published; `diffuse-reference.ts` builds it:

| | mag/arcsec² |
| --- | --- |
| Leinert et al. 1998 Table 24, NGP — **total** starlight | 23.83 |
| The 384,115 catalogue stars Stellata already draws | 24.275 |
| Residual left for the diffuse band | **25.01** |

**The catalogue row is re-derived per build, and the residual moves with
it.** The manifest-driven catalogue took the pole from 24.286 to 24.275 —
the additions are faint, so the centre does not move at three decimals and
the pole gains 0.011 mag — which widens this check by 0.021 and no more.
Nothing rendered moves: both constants are read by tests alone.

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
than M31 — the cross-layer symptom the HDR epic opened on. The cost is
at the pole: diffuse + catalogue reads 23.00 against Leinert's 23.83.
eso0932a sides with the total but confirms that pole cost independently,
reading 1.40 mag fainter at b = +30 (`docs/science-hdr-pipeline.md` § 8).

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
| l = 0, b = 5 | 20.74 | **1.26 OVER** — the maximum | 69.2 |
| l = 0, b = 0 (GC) | 21.88 | 0.12 over | 40.7 |
| anticentre | 22.06 | 0.06 under | 36.9 |
| b = 30 | 22.52 | 0.52 under | 22.0 |
| NGP | 23.40 | 1.40 under | 0.9 |

Plane-to-pole contrast **1.52 mag** photometrically. **The midplane is
not the maximum** — b ≈ 5° is, because the in-plane sightline eats the
most dust. The real band behaves the same way; the dark rift is dust,
not a gap in the stars.

**Sub-threshold rows carry the operator's faint-end toe**
(`../../hdr/tonemap/README.md` § Operator): over-threshold levels are untouched,
and 1.5 mag under threshold is black by construction — the NGP at 1.40
under sits on the dither floor instead of 16.7/255. Nothing pins the band
to the threshold.

**Every row here is dust-attenuated, so the dust cascade moves them and the
solve does not.** `docs/science-galactic-structure.md` § The dust stack fixes
which is which: the solve, its inputs and the dust-free NGP residual are
anchors carrying no slack; this table, the plane-to-pole contrast and the
Leinert GC check are outcomes that move when the measured tiers land, to
21.09 / 21.91 / 21.91 / 22.83 / 23.33 and a 1.42 contrast on the measured
cascade. Re-pin them there; do not treat a moved row as a calibration error.

**The 32-step in-volume march under-counts the GC column by 1.6 %**
against a converged march (pinned). Deliberately left: `STEPS` is a visual
+ perf decision, and it cannot bias the calibration at all — the solve is
a volume integral, so no march feeds it.

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
`skyBackgroundMagArcsec2` (`../../hdr/emission/README.md` § Extended
sources).

The Local Group emission layer runs the same mapping, the same constant
(`../../local-group/emission/README.md` § Zero free parameters) and now the same
solve. The two layers are one unit system: same zero point, same
`stellataSurfaceBrightnessLuminance` gain, same `ρ₀ = d²·F/G`, both
mag/arcsec² in one exposure. All that differs is which magnitude goes in
— LG a catalogue *apparent* one at each object's own distance, the band a
published *absolute* one at 10 pc.
