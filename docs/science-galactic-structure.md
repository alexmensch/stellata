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

- **Disc**: `density0 × exp(-(R-R₀)/3000pc) × exp(-|z|/300pc)` — single
  double-exponential thin-disc-like profile in galactocentric cylindrical
  coordinates. The originally-planned Jurić thin/thick/halo decomposition
  was simplified out during iteration; the smooth single component reads
  convincingly enough that the extra components weren't worth the
  calibration cost.
- **Bulge**: `density0 × exp(-r'/1000pc)` where
  `r' = sqrt(R² + (z/q)²)` is the oblate-spheroid radius with q = 0.6.
  Simple exponential rather than McMillan's power-law-times-Gaussian —
  the latter produced too-tight a "ball" that read as point-source-like
  in iteration.

Each component multiplies a population colour pre-integration so the
band's hue varies by line of sight. Densities and palette are visually
calibrated — but the palette is **luma-normalised**, so it carries hue and
cannot scale either component's flux; before that it moved the bulge/disc
split by 0.39 mag on its own. The emission column then converts to a V surface brightness
and, through the scene-wide HDR unit, to per-pixel luminance — the same
exposure the discrete star catalog emits against. See
`src/client/milkyway/README.md` for the calibrated values, that
conversion, and the full coordinate-handling chain.

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
self-shielding term. Default global strength = 0.45.

The Edenhofer voxel grid is **deliberately not used** for the Milky Way
band — voxel structure (~5 pc native) aliases into visible streaks
along long camera→fragment rays (8–15 kpc) regardless of step
distribution. Voxels stay in use for short per-star sightlines.

Implementation: `src/client/star-pipeline/star.vert.glsl` (per-star) and
`src/client/milkyway/milkyway.frag.glsl` (volumetric); see
`src/client/star-pipeline/extinction/README.md` + the shelved particle layer and
`src/client/milkyway/README.md`.

Sources for the volumetric path: **Drimmel & Spergel 2001**, *ApJ* 556, 181
(DOI 10.1086/321556) for the thin-disc dust distribution; **Schlegel,
Finkbeiner & Davis 1998**, *ApJ* 500, 525 (DOI 10.1086/305772) for the
0.15 mag/kpc local rate the normalisation is anchored to; **Cardelli,
Clayton & Mathis 1989**, *ApJ* 345, 245 (DOI 10.1086/167900) for the
per-channel reddening multipliers. The shipped 0.45 global strength takes
the effective rate to 0.068 mag/kpc, 2.2x below that anchor, and is the one
un-derived number left in this chain — `stellata-xypg.29` owns it.


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

