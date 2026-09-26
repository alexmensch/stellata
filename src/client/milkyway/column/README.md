# Milky Way column model

`milkyway-column-pure.ts` owns what the band's raymarch integrates: the disc
and bulge density profiles, their population tints, the analytic dust slab,
and a CPU mirror of the march that the shader's step counts, the ρ₀ solve
(`../calibration/README.md`) and the brightness bound
(`../README.md#the-brightest-rendered-sightline`) run on. The constants reach
the shader as uniforms; the renderer is `../milkyway.ts`.

## Files

- `milkyway-column-pure.ts` — the density / dust profile constants the shader
  receives as uniforms, plus a CPU mirror of its raymarch. Owns the ρ₀ solve
  (`../calibration/README.md`); the shader's step counts are pinned against the
  mirror.
- `milkyway-column-pure.test.ts` — quadrature convergence, dust blast radius.

## Density profiles

Constants live in `milkyway-column-pure.ts`; no runtime data loads.

- **Disc**: `density0 × exp(-(R-R₀)/3000pc) × (exp(-|z|/300pc) +
  0.04·exp(-|z|/900pc))` — thin plus thick,
  [Bland-Hawthorn 2016](/data/papers/index.md#blandhawthorn2016) Sect. 5.1 (z_T = 900 ± 180 pc carrying
  f_ρ = 4 ± 2 % of the local density). It is for the **external** view — edge-on from the LMC or a
  few hundred kpc out, a galaxy without one reads as a hard-edged lens —
  and is **not** a high-latitude fix: it brightens the pole.

  Both components share a radial scale length, the one place this departs
  from the literature ([Milky Way density profiles](/docs/science-galactic-structure.md#milky-way-density-profiles)).

  `DISC_HALF_THICKNESS_PC` = 1800 is **two thick scale heights**, the
  same rule 600 pc followed against the thin one, and it clips 0.0183 mag
  of the vertical column where 600 clipped 0.158. `../../galactic/` imports
  it for the disc wireframe, so the thickness rings move with the
  envelope.
- **Bulge**: `density0 × exp(-r'/1000pc)` where
  `r' = sqrt(R² + (z/q)²)` is the oblate-spheroid radius with q = 0.6.
  Simple exponential rather than [McMillan 2017](/data/papers/index.md#mcmillan)'s power-law-times-Gaussian
  — the latter produced too-tight a "ball" that read as point-source-
  like in iteration.

Each component multiplies a population colour pre-integration, so the
band's hue varies by line of sight — warm cream (255,219,196) for the
disc, warmer still (255,198,151) for the bulge, both derived from their
populations' (B−V) rather than authored ([Population colours](../calibration/README.md#population-colours--the-discs-is-solved-not-cited)).
Neither carries flux at emission, and neither
component has a hand-set weight any more: both `density0` values are
solved.

**Both components are multiplied by one minus the resolution hole** — the
star catalogue's measured share of the model's light at each step,
applied ahead of the dust step. It reaches both shaders as one filtered
fetch of the shared `uUnresolvedLight` grid, and the CPU mirror through
`unresolvedBandLightAt` over the same cube
([The resolution hole](../calibration/README.md#the-resolution-hole--the-band-marches-the-model-minus-the-drawn-stars), [The table is a 3D grid](../calibration/README.md#the-table-is-a-3d-grid-not-a-uniform-array)).

### Population tints carry hue, never flux

`DISC_COLOR_RGB` / `BULGE_COLOR_RGB` are the **authored palette**;
`DISC_TINT_RGB` / `BULGE_TINT_RGB` are what the shader and the CPU mirror
actually multiply, and they are the palette divided by its own relative
luminance (`lumaNormalisedTint`, `../hdr/emission/emission-pure.ts`).

The reason is that `stellataSurfaceBrightnessLuminance` is a *scalar* gain
applied per channel, so a tint whose relative luminance isn't 1 rescales
its own component's emission. Unnormalised, the shipped palette would dim
the bulge 0.228 mag and the disc 0.137 mag — and it is the **difference**
that moves the flux split, which the eyeballed palette this replaced
carried at 0.390 mag (its bulge was nearer white, and its disc's blue
channel outran its red). The solve now sets that share outright at 0.0775
(`../calibration/README.md`), so what normalisation buys is that a hue edit
cannot move it back.

**But it does not buy a free palette edit.** `REDDENING_RGB` attenuates
per channel in the same loop ([Dust](#dust--the-analytic-tier-and-what-composes-with-it)), so a redder
component transmits more of its own light: dust-free columns are
bit-identical under any hue, extincted ones are not. Deriving the palette
brightened the plane by 0.026 mag at b = 5 and 0.023 mag at the Galactic
centre while leaving the poles alone — the whole sightline table below is
tint-coupled through the dust and nothing above the dust is
([Unit](../../hdr/emission/README.md#unit--what-an-emitting-layer-writes)).

Two more consequences a future session needs:

- **`setDiscColor` / `setBulgeColor` normalise their argument.** A colour
  picker cannot move flux. `getValues()` returns the *authored* colour, not
  the tint, because the tint's channels exceed 1 (the disc's red sits at
  1.13) and an `<input type="color">` cannot round-trip that.
- **The Local Group layer does not seed from here.** It derives its own
  two family indices ([Population tints](../../local-group/emission/README.md#population-tints--two-family-seeds-both-derived)),
  sharing only the SSP spheroid constant and the solve — so this palette
  is the band's alone.

## Dust — the analytic tier, and what composes with it

Profile is `norm × exp(-(R-R₀)/3500pc) × exp(-|z|/125pc)` — a simplified
exponential thin dust disc with its own parameters. [Drimmel 2001](/data/papers/index.md#drimmel2001)'s
dust disc has h_r = 2.26 kpc and a sech² vertical profile of 134 pc base
scale height, flaring outward, with a central hole and arm components; the
slab keeps none of those, for no recorded reason (open: `stellata-uadc.69.4`).
Per step, opacity converts to per-channel optical depth via reddening
multipliers `(0.76, 1.0, 1.35)` against [Cardelli 1989](/data/papers/index.md#cardelli1989) Table 3's
(0.751, 1.000, 1.337) at R_V = 3.1, also unexplained (open: `stellata-uadc.69.1`) —
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
puts the pole at A_V = 0.125 — inside the older A_V ≈ 0.06–0.15 polar range
[Schlegel 1998](/data/papers/index.md#schlegel1998) review, and 2.7× their own polar measurement (E(B−V) =
0.015 / 0.018 at the NGP / SGP, A_V ≈ 0.05).

**The 0.0679 mag/kpc rate this replaced was this project's own, not from
[Schlegel 1998](/data/papers/index.md#schlegel1998)**, and an order of magnitude low. That under-extinction,
not the density profile, is why the plane read ~3 mag too bright against the
poles.
`setExtinctionStrength(x)` defaults to **1.0** and is a dev lever, not a
calibration term: anything else contradicts that anchor.

**This slab is the cascade's fallback tier, not the whole column.** Inside
measured coverage the measured source is the only dust and this profile
contributes nothing; beyond it, this is the only dust. The partition is by
**volume, never by a rescaled fraction** — scaling the slab down globally to
make room for local clouds would under-extinct the far disc, a ~3 mag error
to avoid a ~0.05 mag one, and that argument still holds against exactly that
move. [The dust stack](/docs/science-galactic-structure.md#the-dust-stack--sources-domains-and-the-partition) is the contract:
the tier table, which clouds are carved out of the grid and which are folded
into it, the froxel-grid prefilter and its measured cost, and the eso0932a
grading.

### Foreground dust — τ starts at the camera, not at the mesh

Each mesh's *emission* integration begins at its own front face, but the
dust slab does not. For the disc from Sol this costs nothing (the camera
is inside it, so the march starts 1 pc out), but the camera sits **3122 pc
outside the bulge proxy**, along the sightline where most of the
extinction toward the Galactic centre lives — so seeding `tauAccum` at the
bulge boundary emitted the bulge through no foreground extinction at
all.

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
(anticentre, NGP) are bit-identical. The GC sightline dims 0.013 mag,
tapering to 0.011 mag by l = 30° (pinned).

The [Edenhofer 2024](/data/papers/index.md#edenhofer2024) voxel grid is **not sampled here yet**, but both the decision and
the mechanism are settled ([The dust stack](/docs/science-galactic-structure.md#the-dust-stack--sources-domains-and-the-partition)).
The read comes from a **view-frustum froxel grid** — measured A_V column
per (screen cell × log-distance slice), 13.0′ cells (one summation patch) × 32
slices, one ray per cell, filled at half a voxel per step, its distance axis
spanning coverage entry to exit. A grid holding the *column* rather than the
density is what makes the filter's along-ray extent the march step by
construction. The all-sky camera-anchored alternative is the same structure over
4π sr instead of the ~1.09 sr the viewer sees, and lost 8.1× on fill. Building
it is stellata-ty4.5, gated on the GPU spike stellata-ty4.7.
