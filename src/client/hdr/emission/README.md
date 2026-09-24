# The emission unit — magnitude → luminance, and the two solid angles

What an emitting layer writes into the HDR target. `../README.md` owns the
target's lifecycle, pass ordering and the operator; this folder owns the
*value* a fragment carries and the rules that turn a physical magnitude
into it. [§ 1](/docs/science-hdr-pipeline.md#1-the-unit--threshold-anchored-display-luminance) is the design gate.

```
src/client/hdr/emission/
  density0-solver-pure.ts    The ρ₀ solve both volumetric emitters share:
    (+ test)                 flux number, Gauss–Legendre quadrature over a
                             truncated ellipsoid, ρ₀ = d²·F/G
                             (§ Solving ρ₀).
  emission-pure.ts (+ test)  CPU mirror, plus both solid-angle derivations
                             and their inverses, LUMA_CEIL,
                             POINT_SOURCE_FLAT_PEAK_DIAMETER_PX
                             (§ Unit), SB_ZERO_POINT
                             (the zero point both volumetric emitters
                             share) and lumaNormalisedTint, the hue-only
                             tint they multiply.
  population-colour-pure     The old-spheroid SSP colour index both
    (+ test)                 emitters render and the hue it derives to,
                             plus the constrained solve that turns a
                             galaxy's published integrated index into its
                             disc's (§ Population colours).
```

The shipped graphs are `../../webgpu/emission-tsl.ts` (the unit) and
`../../webgpu/extended-emitter-tsl.ts` (the write tail a volumetric
emitter shares). Both import their constants from `emission-pure.ts`, so
neither can drift from the mirror.

## Unit — what an emitting layer writes

`../../webgpu/emission-tsl.ts` is the contract.
`L = uExposure · 10^(−0.4·m)` from a physical V-band apparent magnitude,
clamped at `LUMA_CEIL` (4096) before the write.
`pointSourcePeakTsl` adds the flux-vs-surface-brightness rule for
anything that draws a kernel rather than a surface:

```
peak_L = L(m) / max(1, π · r_phys_px²)
```

`r_phys_px` is the source's **true angular radius in CSS pixels** —
uncapped by any viewport-fraction clamp, and CSS rather than device
pixels so a resolved disc's surface brightness doesn't shift with
`devicePixelRatio`. Below 1 px the whole flux lands on the peak; above
it the emission is true surface brightness.

That saturation has a consumer: `POINT_SOURCE_FLAT_PEAK_DIAMETER_PX`
(2/√π) is the **diameter** at which `max(1, π·r²)` reaches 1, so a
source at or under it carries a peak exactly insensitive to its own
radius — which is what lets the star solve drop the radius entirely past
a distance bound ([Eliding the physical-size branch](../../star-pipeline/perceptual-disc/README.md#eliding-the-physical-size-branch)).

A layer that draws an **extended source** instead of a kernel takes
`surfaceBrightnessLuminanceTsl` — the flux magnitude inside a solid
angle `Ω` is `S − 2.5·log10(Ω)` for a surface brightness `S` in
mag/arcsec², and the log round-trip through `L(m)` collapses to one
scalar gain:

```
L_px = uExposure · 10^(−0.4·S) · Ω
```

Being a single scalar is what lets a layer apply it to a coloured column
without touching chromaticity. It is **unclamped** — the caller clamps the
product against `LUMA_CEIL`, not the factor. **Which `Ω` is § Extended
sources' decision**, and it separates the physical answer from the
displayed one.

**Being a scalar is also why an emitter's tint must carry hue only.** It
multiplies every channel equally while the emissivity it scales was
normalised against a total flux, so a tint whose relative luminance isn't 1
rescales that emitter's flux by that luminance — 0.23 mag on either layer's
spheroid population, 0.14–0.18 mag on their discs. What moves a
*two-component* split is the difference, which the band carried at
0.39 mag under the eyeballed palette that preceded § Population colours.
`lumaNormalisedTint` owns it.

**The separation holds at the emission site and not one step past it.**
The Milky Way's raymarch attenuates per channel inside the same loop
([Dust](../../milkyway/README.md#dust--the-analytic-tier-and-what-composes-with-it)), so a redder component
transmits more of its own light through the same dust: every dust-free
column is bit-identical under any hue, and every extincted one is not.
0.012 mag toward the Galactic centre for a disc 0.3 mag bluer in B−V,
pinned in `../../milkyway/milkyway.test.ts`. Real A_V is nearly
source-independent, so treat the coupling as an artefact of a three-channel
extinction model rather than a physical prediction — it is small, it is in
the right direction, and it means a palette edit is not free.

**A reflecting body uses both rules, and that is what closes the resolve
step.** A planet's glare billboard takes `pointSourcePeakTsl` with
the same `m` the star field would use, while its mesh takes the
surface-brightness rule with the disc's mean `S` — and past 1 px the two
are the *same quantity*, so a body crossing from point to resolved mesh
does not change brightness. The disc-mean derivation and the two
normalisers that make the shaded disc integrate back to `L(m)` are
[Physical-luminance emission](../../solar-system/planets/README.md#physical-luminance-emission).
**The mesh reads `uOmegaPxArcsec2` and, unlike the band, must**: the two
rules agree at 1 px on that solid angle alone, so the summation
substitution below would break the resolve step it exists to close.

## Solving ρ₀ — a published magnitude into an emitter's density

`density0-solver-pure.ts` is the calibration side of the unit: given a
profile shape and the proxy volume it is marched in, what ρ₀ makes the
volume integrate back to a published magnitude.

```
ρ₀ = d² · 10^(−0.4·m) / ∫ shape dV        (solveDensity0)
```

**Truncation compensation is inherent**, because `G` integrates over the
*actual* mesh volume — whatever the envelope clips, ρ₀ makes up, so a tight
envelope brightens what remains rather than losing light. Both consumers
rely on that: the Local Group solves per object against a catalogue
apparent magnitude at its own distance ([Emission solver](/scripts/local-group/README.md#emission-solver--per-object-density0)),
the Milky Way against a published **absolute** one at
d = 10 pc (`../../milkyway/calibration/README.md`). Same function, and
the only difference is which distance goes in.

**The shape must be the luminance shape.** ρ₀ is a scalar and the tint it
multiplies is luma-normalised (§ Unit), so the scalar volume integral *is*
the luminance integral — which is what lets a flux share be split between
two differently-tinted components without either hue moving flux.

`integrateOverEllipsoid` takes `f(r, cosθ)` in unit-ball coordinates, with
cosθ from the +C axis, and requires axisymmetry about local z plus z → −z
symmetry. Every profile solved here has both. **A profile stated in
cylindrical (R, |z|) takes `integrateOverEllipsoidRz` instead** — it owns
the unit-ball → physical mapping, and taking the two semi-axes as scalars
is what makes an axis swap inexpressible rather than merely tested-for.
Only the Sérsic family, whose density depends on the ellipsoidal radius
alone, uses the raw form.

## Population colours — one equation, two unknowns, one citation

`population-colour-pure.ts` is the hue side of the same problem
§ Solving ρ₀ is the flux side: both layers render an old spheroid and a
star-forming disc, and **no publication gives either galaxy its colour
split by component.** What is published is the integrated index. So one
component is modelled and the other is solved:

```
10^(−0.4·(B−V)_tot) = f·10^(−0.4·(B−V)_sph) + (1−f)·10^(−0.4·(B−V)_disc)
```

`OLD_SPHEROID_COLOUR_INDEX_BV` = **0.9574** supplies the spheroid term —
BC03 Chabrier SSP, Z = 0.02, 10 Gyr, the same `data/bc03/` row the band's
Υ\*_V comes off. It is a *population* constant, not either layer's: the
Galactic bulge, M31's bulge and the luminous early-type spheroids are the
same population. It is **not** the metal-poor dwarf spheroids
([Population tints](../../local-group/emission/README.md#population-tints--two-family-seeds-both-derived)).

Its hue, `OLD_SPHEROID_COLOR_RGB`, is derived here for the same reason —
one population, one triplet. `BULGE_COLOR_RGB` and `SPHEROID_COLOR_RGB`
are that constant under each layer's local name, not two derivations of
one index.

Three properties a change here has to keep:

- **`f` is a LIGHT ratio.** The equation mixes V-band luminosities, so a
  mass share carries exactly the error it carries in the flux split.
- **Each layer solves against the `f` its own flux split uses**, so the
  recombined index lands on the published one on the *rendered pixels*
  rather than only on paper. Both are pinned that way.
- **`discColourIndex` throws rather than returning a non-finite hue** when
  the spheroid carries all the V light, or is alone bluer than the total at
  that share — three inputs that are not describing one galaxy. `f = 1`
  divides by zero to `+Infinity` and so needs its own half of the guard.

Why solving beats predicting both components:
[Population colours](../../milkyway/calibration/README.md#population-colours--the-discs-is-solved-not-cited) carries the
argument and the numbers, including what an independent pair would do to
the band's integrated colour.

## Extended sources — two solid angles, one write tail

**A point source at `m_lim` is lifted to `L_THRESH`; an extended source
needs its own anchor or the render inverts the eye's ordering.** Rod
summation makes its threshold a *surface brightness*, so
`rodSummationSolidAngleArcsec2` turns that threshold and `m_lim` into
`uOmegaSummationArcsec2` — 4.7863e5 arcsec², a 13.0′ critical diameter —
which the **display** path substitutes for `Ω_px`. Fixed in angle, so the
level cannot move with FOV. Derivation, the threshold's identity with the
instrument's `skyBackgroundMagArcsec2` (`../../filters/filter-state.ts`
`extendedThresholdSbFor`), and every rejected alternative:
[§ 1](/docs/science-hdr-pipeline.md#1-the-unit--threshold-anchored-display-luminance) (*Extended sources*).

**The substitution is only the flux in the patch for a source uniform
across it, so it does not happen here.** `emitExtendedSourceTsl` writes
the `Ω_sum`-gained value to **attachment 2** and the resolve averages it over
the patch before it reaches the canvas — which makes uniformity true by
construction and lets both volumetric emitters take the same anchor.
`../summation/README.md` owns that pass, and no layer opts out of it.
Statistic: always `Ω_px`, always
unconvolved (`../attachments/README.md`).

Everything after the gain is identical for every volumetric emitter, so
`../../webgpu/extended-emitter-tsl.ts` owns it: both gains, the clamp at
`LUMA_CEIL`, every attachment, and off-target the undithered operator.
`emitNothingTsl` is the miss case. Both return all three members of
`EmitterOutputs`, making "attachments 1 and 2 have no default, so every
branch must write them" one decision rather than one per early return. `../../webgpu/milkyway/milkyway-band-tsl.ts` keeps its own magnitude step
for the chart isobar, which would contour surface brightness against
`extendedThresholdSbTsl`, the inverse of the same pair — so contour
and emission could not disagree about where threshold is. **That contour
has never drawn** ([Chart mode + warp](../../milkyway/README.md#chart-mode--warp)), so the
magnitude step is the branch's cost and nothing else's.

**Off-target there is no attachment 2 and no pass, so the anchor is gone
entirely** and both emitters fall back to `Ω_px`. One rule rather than a
per-layer choice: the concession *is* the pass. That is chart mode
([The inline operator](../README.md#the-inline-operator--chart-modes-path)).

## Footprint — a fragment carries a pixel, not a point

A raymarch evaluates its profile at the **pixel centre**, so a centrally
peaked profile lands over the pixel's own area average — 3.95 mag at M31's
nucleus. `footprintPcTsl` is the radius that fixes it:

```
ε = distancePc / (pxPerRadian · √12)
```

one pixel's span at that distance, matched on the **second moment** of a
square footprint, which is the order `softenRadiusTsl`'s Plummer form
corrects to. No free parameter, and it tracks the exact area average to
0.1 mag across the whole 10°–120° FOV range
(`../../local-group/emission/local-group-emission-calibration.test.ts`).

Two things it must get right, both measured:

- **`sqrt(r² + ε²)` on a spherically symmetric profile is exactly
  transverse smoothing**, because `|p|²` splits into the parallel and
  perpendicular parts of `p` — the ray direction contributes nothing.
- **A separable profile needs the axis projection.**
  `footprintAlongTsl` is why a face-on disc gets *no* vertical
  softening: `z_d` is finer than the footprint at wide FOV, so smoothing
  along the ray would suppress the column rather than average it.

Inert where the plate scale already resolves the profile. From Sol the
band moves under 0.003 mag at both FOV extremes
([The gradient this produces](../../milkyway/calibration/README.md#the-gradient-this-produces-and-what-it-reads-on-screen)),
which is what keeps the shipped display table where it is.
