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
`src/client/milkyway/README.md` for the calibrated values, that
conversion, and the full coordinate-handling chain.

### The luminosity solve, and the constraint it cannot satisfy

Both components' `density0` is **solved**, not authored: each proxy
volume integrates to its share of the Galaxy's published integrated
luminosity, through the same `ρ₀ = d²·F/G` the Local Group build solves
per object, at d = 10 pc because the anchor is an absolute magnitude.
Inputs are BHG16 Table 2's M_V = −21.37 and Licquia & Newman 2015's
B/T = 0.150 — the latter measured in stellar *mass*, so it is an upper
bound on the V-band value (the bulge's older population carries a higher
Υ\*_V). There is no free parameter left.

**The model cannot also satisfy the sightline it used to be anchored on,
and no shape parameter bridges the gap.** The earlier calibration pinned
the north galactic pole to Leinert's total starlight there *minus* the
catalogue stars Stellata draws itself — a defensible target that removes
56 % of the pole's light but only 0.2 % of the Galaxy's, because the
catalogue is a local sample and the pole column is almost entirely local.
A single emissivity field anchored on the subtracted pole therefore runs
a factor of three low everywhere else, and the shipped solve is 1.59 mag
brighter than that residual at the pole and 0.94 mag brighter than
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
moved their ratio by 0.09 mag. `src/client/milkyway/README.md`
§ Calibration carries the numbers and the pins.

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

**Volumetric Milky Way dust.** Analytical-only, no voxel sampling.
Profile is `norm × exp(-(R-R₀)/3500pc) × exp(-|z|/125pc)` —
Drimmel & Spergel-style thin-disc dust. Per step, opacity converts to
per-channel optical depth via CCM-derived reddening multipliers
`(0.76, 1.0, 1.35)` — red transmits most, blue extincts away — applied
with Beer-Lambert running attenuation including a half-step
self-shielding term. Default global strength = 1.0.

`norm` is derived from a declarative rate: 1.0 mag/kpc of V extinction
at (R₀, z = 0), the top of the range commonly adopted for the
solar-neighbourhood plane. At the 125 pc scale height that also puts the
perpendicular column to the pole at A_V = 0.125, inside the SFD polar
spread — two independent constraints meeting at one normalisation.

The Edenhofer voxel grid is **deliberately not used** for the Milky Way
band — voxel structure (~5 pc native) aliases into visible streaks
along long camera→fragment rays (8–15 kpc) regardless of step
distribution. Voxels stay in use for short per-star sightlines.

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

