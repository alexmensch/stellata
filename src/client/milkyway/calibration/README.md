# Milky Way photometric calibration

The published numbers the band's emissivity is solved against, the light
ratio derived from them, and the two sightline checks the result is graded
by. The solve itself — `DISC_DENSITY0` / `BULGE_DENSITY0` — lives in
`../milkyway-column-pure.ts` beside the shape integrals it divides by, and
its pins live in `../milkyway.test.ts`; everything about *what goes in* and
*how well it comes out* is here.

## Files

- `diffuse-reference.ts` — `GALAXY_TOTAL_ABSMAG_V`, the mass-to-light
  inputs, `bulgeToTotalLight` and the `BULGE_TO_TOTAL_LIGHT_V` it derives,
  the Leinert totals, the resolved-catalogue subtraction, and
  `diffuseResidualMagArcsec2`.
- `diffuse-reference.test.ts` — the residual arithmetic and the light-ratio
  derivation, reading all three `data/bc03/` tables back: the shipped Υ\*_V
  off `m62` and the metallicity brackets off `m52` / `m72`.

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
13.7 % of the b = 5 one; every sightline row below moves under 0.09 mag.
Where it shows is the face-on external view, which the camera can reach
(`CLAUDE.md` § Camera-anywhere perception): the centre pixel goes from
48 % bulge to **31 %**, and the integrated bulge/disc luminance ratio from
0.176 to **0.0840**. That contrast is what makes the model read as an Sbc
rather than an S0, and it is pinned in `../milkyway.test.ts` alongside the
edge-on case — where the bulge sits behind the full midplane dust column
and carries 4.6e−5 of the centre pixel, exactly as a real edge-on spiral
does in V.

## Two checks, and both disagree by the same sign and order

Neither is an anchor. Both are pinned in `../milkyway.test.ts`.

| check | published | model | model is |
| --- | --- | --- | --- |
| NGP diffuse residual | 24.99 | 23.31 | **1.676 mag brighter** |
| Galactic centre, Leinert total | 22.92 | 21.90 | **1.024 mag brighter** |

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
| l = 0, b = 5 | 20.77 | **1.23 OVER** — the maximum | 68.4 |
| l = 0, b = 0 (GC) | 21.90 | 0.10 over | 40.3 |
| anticentre | 22.07 | 0.08 under | 36.6 |
| b = 30 | 22.52 | 0.52 under | 21.9 |
| NGP | 23.40 | 1.40 under | 0.8 |

Plane-to-pole contrast **1.51 mag** photometrically. **The midplane is
not the maximum** — b ≈ 5° is, because the in-plane sightline eats the
most dust. The real band behaves the same way; the dark rift is dust,
not a gap in the stars.

**Sub-threshold rows carry the operator's faint-end toe**
(`../../hdr/README.md` § Operator): over-threshold levels are untouched,
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
(`../../local-group/README.md` § Zero free parameters) and now the same
solve. The two layers are one unit system: same zero point, same
`stellataSurfaceBrightnessLuminance` gain, same `ρ₀ = d²·F/G`, both
mag/arcsec² in one exposure. All that differs is which magnitude goes in
— LG a catalogue *apparent* one at each object's own distance, the band a
published *absolute* one at 10 pc.
