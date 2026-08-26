# Local Group volumetric emission

Every catalogued object glowing at its physically correct apparent V
magnitude from any camera position — the Milky Way band's volumetric
scheme (`../../milkyway/README.md`) generalised to N instances. The
wireframe overlay, the label engine, the loader and the kind module stay
in the parent (`../README.md`); this folder is the light.

Live and unconditional: the lg module's `attach` always constructs the
layer beside the wireframes. `showLgEmission` (through the module's
`setEmissionEnabled` leg) and URL bit 22 are the only gates, and there
are no Deep-field emission knobs (§ Zero free parameters).

## Files

- `local-group-emission.ts` — `LocalGroupEmission`: the two instanced
  passes, their materials and the per-frame rebase.
- `local-group-emission-pure.ts` — emission-block → component
  decomposition, the population tints (§ Population tints), instance
  packing, the flux ↔ magnitude inverse, and a CPU mirror of the GLSL
  raymarch. Keep the mirror in lockstep with the shader.
- `local-group-emission.{vert,frag}.glsl` — one shader pair for both
  families; the disc material defines `FAMILY_DISC`.
- `lg-emission-materials.ts` (+ test) — the material seam: the neutral
  `LgEmissionMaterials` contract and the WebGL2 implementation
  (§ The material seam).
- `local-group-emission.test.ts` — wiring, instance packing, the shader
  mirror, the tint derivation.
- `local-group-emission-calibration.test.ts` — the epic's acceptance
  test (§ Zero free parameters).

## The two passes

Each object decomposes into one or two **components**
(`emissionComponents`): a Sérsic block is one spheroid; a disc block is a
disc plus, for M31, a separate spheroidal bulge instance in the Sérsic
pass (own u ≤ uMax sphere, spheroid population tint — the two volumes
overlap and additive blending sums them, preserving the solved B/T flux
split while the bulge reads as a bulge from edge-on viewpoints).

- **Sérsic pass** (spheroids + disc bulges) — mesh axes are
  `uMax × R_e`, so the ellipsoidal profile radius is just
  `uMax × |pLocal|`; per-instance `(density0, 1/n, bn, pn)` + `uMax`
  ride instanced attributes into flat varyings.
- **Disc pass** (LMC, M31, M33) — mesh is the `(rEnv, rEnv, zEnv)`
  envelope; density `ρ₀·exp(−R/R_d − |z|/z_d)`.

The solved luminosity model each pass renders is the loader's `emission`
block (`docs/science-local-group.md` § Local Group luminosity model;
solver contract in `scripts/local-group/README.md`).

The camera transforms into each instance's unit-ball frame in the
vertex shader (quaternion conjugate + axis divide); the fragment
shader runs milkyway's exact entry/exit logic — front-face root
clamped ≥ 0 handles camera-inside, BackSide keeps fragments alive from
inside, log-distributed steps to the back-face fragment (32 for
spheroids, 64 for discs — grazing disc rays run tens of kpc against a
~10² pc vertical scale height). Each pixel's in-step sample position
is jittered by a screen-space hash: coherent midpoint sampling of the
thin-disc profile bands on grazing rays, and the jitter trades the
bands for fine noise while preserving the expected column (the CPU
mirror keeps deterministic midpoints).

Instance centres are absolute ICRS in float32 attributes; the vertex
shader subtracts the per-frame `uWorldOffset` (≤ ~0.25 pc cancellation
error at 2 Mpc — invisible at galaxy scale). renderOrder −3 beside the
MW volume; additive, no depth write, `frustumCulled = false` (unit-ball
bounding sphere vs 2 Mpc instance spread).

Visibility: default-on; `?v=` blob bit 22 (`showLgEmission=false`,
zero-byte presence field) disables; chart mode hides the layer
entirely (wireframes carry the chart aesthetic); **stays visible
during warp** — unlike the wireframe overlay, the glow is light, not
reference chrome. No Sol-distance fade for the same reason. Hover /
pick is untouched — the wireframe's visibility-gated pick remains the
only pick path.

## The material seam

Both passes take their material from an `LgEmissionMaterials` factory
rather than building a `ShaderMaterial` inline, so a WebGPU boot swaps
shaders without a second copy of the instance packing, the per-frame
rebase or the enable / chart gates. Both geometries cross unchanged — six
buffers for the disc family, seven for the Sérsic one, inside WebGPU's
eight. The WebGPU twin is `../../webgpu/local-group/README.md`;
`lg-module.ts` passes `kindCtx.webgpu?.lgEmissionMaterials` and adds the
emission group to `(webgpu?.scene ?? scene)` — the wireframes are Line2
chrome and stay in the shell's scene, which that boot never draws.

**Every uniform these shaders read is shared**, so the TSL side exposes no
slot record at all: the six HDR emitter slots and `uWorldOffset` are in
the uniform-node mirror. The layer's own `uWorldOffset` object is
therefore inert on that backend — `FloatingOrigin`'s write to the shared
map is what reaches the shader instead.

## Zero free parameters — the emission scale is derived

The layer emits into the scene-wide HDR unit
(`../../hdr/emission/README.md` § Unit), exactly as the Milky Way band
does. **The zero point is derived, not tuned.** The solver normalises
`density0` against zero-point-free flux `F = 10^(−0.4·m_V)`, and
Φ = ∫∫ρ/s² dV = ∫(∫ρ ds) dΩ — so a raymarched column *is* flux per
steradian, and the only conversion left is the solid angle of one
arcsec²:

```
S    = SB_ZERO_POINT − 2.5·log10(column)        // 26.5721 mag/arcsec²
m_px = S − 2.5·log10(Ω_px)
```

Feeding `m_px` back through `L = uExposure · 10^(−0.4·m_px)` collapses to
one scalar gain (`stellataSurfaceBrightnessLuminance`), so the
population tint rides through untouched. `SB_ZERO_POINT` lives in
`../../hdr/emission/emission-pure.ts` — it is the emission unit's
constant, not this layer's, and the Milky Way band takes the same one
(`../../milkyway/calibration/README.md`). The TypeScript constant and the
shader's `SB_ZERO_POINT` are pinned against each other in
`local-group-emission.test.ts` — nothing at compile time ties them.

**The same extended-source anchor the band takes, and it took a convolution
to earn it.** Both layers gain by `uOmegaSummationArcsec2` — the eye's rod
summation area — into the HDR target's **attachment 2**, which the resolve
averages over that patch before compositing
(`../../hdr/summation/README.md`). Averaging first is what makes "uniform
over the patch" true by construction, so the per-layer opt-out this layer
used to carry (the pixel solid angle passed to both of
`stellataEmitExtendedSource`'s solid-angle arguments) is gone, along with the
**2.695 mag** it cost the envelope and the **3.95 mag** over-lift at M31's
nucleus it was avoiding. Both figures, the 3.6′ crossover between them, the
rejected `fwidth(S)` cap and the residuals the shipped pass leaves are all
pinned in `local-group-emission-calibration.test.ts` § against
convolve-then-gain.

**Two consequences worth having before touching the raymarch.** The
convolution can only average what the rasteriser sampled, so the profile is
smoothed over one pixel's transverse footprint as it is marched
(`../../hdr/emission/README.md` § Footprint) — without that the Sérsic cusp
survives the convolution intact, which is the whole 3.95 mag. And M31 is now
**FOV-invariant** like the band: its display level carries no plate scale at
all, where it used to dim quadratically while the band held. The nucleus
lands 0.03–0.18 mag *faint* of ideal across the whole 10°–120° range and the
envelope within 0.08 mag.

**There is no brightness knob, globally or per object.** `density0` is
solved per object (never scale it here — the flux ratios are physical),
the zero point is a constant of the unit system, and `uExposure` is the
only thing that moves the layer. That is what makes the glow
brightness-comparable to the band and the star field by construction
rather than by knob-matching. It also means the layer holds **no**
star-pipeline uniform: `uLimitMag` / `uSizeSpan` are gone, and
`uSizeSpan` is a footprint-only uniform again (`../../filters/README.md`).

**Both passes write the statistic attachment**
(`../../hdr/attachments/README.md`): an extended source's emission is
already true surface brightness, so its flux and peak channels are the same
quantity, and both stay on `Ω_px` and unconvolved. Off-target
(`uHdrTarget = 0`) there is no diffuse attachment and no convolution, so each
pass applies the operator itself over the pixel solid angle, undithered —
M31's disc and bulge overlap, and the dither is a function of `fragCoord`
alone, so it would land twice.

## Population tints — two family seeds, both derived

**The tint is luma-normalised** (`lumaNormalisedTint`,
`../../hdr/emission/emission-pure.ts`) so it carries hue only. The shader
multiplies the scalar column per channel while the solver normalised that
column against total flux — an un-normalised tint dims the object by its
own relative luminance, 0.23 mag for the spheroid seed and 0.18 for the
disc. Harmless while a global gain absorbed it; a flux error the moment
the unit is physical. **The CPU mirror is colourless** — it integrates the
scalar column — so it agrees with the shader only while that holds; the
normalisation is an invariant, not a style choice.

Each seed is a (B−V) through the star field's own colour chain
(`../../milkyway/calibration/README.md` § Population colours), no longer
the Milky Way's palette by import:

| family | (B−V) | source |
| --- | --- | --- |
| spheroid | 0.9574 | old metal-rich SSP, BC03 Z = 0.02 / 10 Gyr |
| disc | 0.8189 | **solved** from M31 |

M31 is the only LG disc with a published dereddened integrated colour —
(B−V)₀ = 0.86, Tempel et al. 2011 Table 2 — and it is solved against the
**same** B/T = 0.31 the flux split uses (`data/local-group/overrides.tsv`,
pinned), so M31's own integrated colour and its bulge/disc contrast are
both right by construction. That is what the two-tint scheme can do; here
is what it cannot:

- **The other two discs are bluer than their seed.** de Vaucouleurs 1960
  (*ApJ* 131, 574) gives the LMC (B−V) = 0.51 ± 0.02 against M31's 0.86.
- **The ~120 dwarf spheroids are metal-poor**, [Fe/H] ≈ −1.5 to −2, so an
  old *metal-rich* SSP renders them far too red. `data/bc03/` carries no
  table under Z = 0.008, so fixing this needs a re-pull as well as
  per-object plumbing.

Both want a per-object colour index rather than a family seed —
`emission.color` already exists as the per-object hook, and LVDB carries
age and metallicity per dwarf but **no colour column at all**. Deferred,
with the bead naming the two.

## Sub-pixel proxies expand rather than lose flux

Below a pixel, fragment coverage quantises and drops the flux the solver
guaranteed. The vertex stage scales axes and profile scale lengths by `k`
and `density0` by `1/k³`, where `k` lifts the mesh's **largest semi-axis**
to `MIN_PROJECTED_RADIUS_PX` (1 CSS px — the resolution floor
`stellataPointSourcePeak` applies to a star). Largest, not the
orientation-dependent projected radius: over-expanding a mesh the viewer
can already resolve would move a visible silhouette, and everything near
the floor reads near-isotropic anyway. The triple is flux-exact: the
column picks up `k` from the path and `k⁻³` from the density while the
solid angle picks up `k²`. `k → 1` continuously at the floor, so there is
no cutover and nothing to add hysteresis against. Pixels-per-radian comes
from `uOmegaPxArcsec2` through `stellataPxPerRadian` rather than a second
uniform, so the floor and the gain cannot disagree about the viewport.

**Which viewpoints it is for.** Not the ones near Sol: dSphs are degrees
across, so at a 50° / 900 px viewport only **11 of the 123** objects sit
under a pixel from Sol (median mesh radius 3.4 px), and zooming to 5°
leaves none. The floor earns its keep from the far half of the envelope —
59 of 123 at 1 Mpc out and **82 at the 2 Mpc camera limit**, which is
also where an object losing its flux would be least recoverable. All
three counts are pinned in `local-group-emission-calibration.test.ts`,
alongside the flux-invariance check that integrates the expanded profile
through the same raymarch rather than restating the algebra
(`expandComponent` is the vertex stage's CPU twin — keep them in
lockstep). Worst measured deviation across 5 objects × k ∈ {1.5, 4, 20}:
8e-6 mag.

## What a viewer actually reads

**The intra-object range.** Bulge centre to disc envelope spans ~8.7 mag
for M31, which fits the operator's range (`DR_MAG` 7.5) rather than
fighting it. Through the summation patch, at the base epoch and a
50° / 900 px viewport, the profile reads **120 / 64 / 28 / 1** of 255 at
0 / 10 / 20 / 40 arcmin — a threshold star is 38.25, so M31 stays brighter
than one out to ~15 arcmin, and the operator's faint-end toe
(`../../hdr/tonemap/README.md` § Operator) takes the sub-threshold outer envelope
to the dither floor. A bright core trailing off over most of a degree,
which is what the naked eye gets, and pinned.

The patch average is what makes that distribution: it dilutes the Sérsic cusp
and lifts the smooth envelope, where the retired per-pixel path ran 173 at
the core and 0.8 at 40 arcmin — a bright nucleus on a black disc. The earlier
worry that a scalar gain would blow the core out never survived the
arithmetic either: extended Reinhard plus the sRGB encode already supply the
log compression the old magnitude-domain gate was hand-rolling.

**The acceptance test pins the integral.** Flux integrated over solid angle
from mirrored per-ray columns summed over components (CI has no GPU, so no
framebuffer read-back — same integral, same discretization) matches the
physical prediction to ±0.1 mag across 6 camera positions × 5 objects,
far-field pairs against the catalog 1/d² law and near/inside pairs against
a converged dense march; the worst deviation is pinned (0.017 mag).

**A second block pins the distribution**, which is the half a viewer reads:
M31's face-on disc central surface brightness at 21.45 mag/arcsec² against
Freeman's 21.65 ± 0.30, the 1.0857 mag-per-scale-length gradient, and
R_d / R_e / n / distance against Courteau et al. 2011. Because the solver
fixes total flux while every structural input is published, the profile has
no free parameter left — those pins are closed-form consequences, not fits.
M31 is the only LG object with photometry detailed enough to check a profile
against, and it generalises because the machinery is shared: two profile
families and one solver serve all 123 objects.
