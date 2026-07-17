# Stellar physics, perception & colour modelling

Split out of `SCIENCE.md`. Covers per-star physical radius, the
render-time brightness/size perception model, colour temperature
routing and calibration, and variable-star pulsation. Spans
`src/client/star-pipeline/`, `scripts/colour/`, and the GCVS
cross-match in `scripts/catalog/`.

## Stellar physics

**Physical radius.** Each star's `physicalRadius` (in solar radii) is
computed at build time via Stefan–Boltzmann, given the absolute
magnitude and an effective temperature:

```
T       = Apsis Teff (gspphot → gspspec) when measured,
          else interp(T_TABLE[classIdx], subclass)
BC      = interp(BC_TABLE[classIdx], subclass)
Mbol    = absmag + BC
L/L☉    = 10^((4.74 − Mbol) / 2.5)
R/R☉    = sqrt(L/L☉) × (T_sun/T)²
```

The measured Gaia DR3 Apsis Teff (see `docs/science-catalog-ingestion.md`
§ Astrophysical parameters from Gaia DR3 Apsis) is preferred wherever a solution exists inside the
2 000–60 000 K sanity window — R ∝ T⁻², so a GSP-Spec-tier star whose
letter-only class defaulted to subclass 5 (a real K0 sized as K5) was
otherwise misized by ~36%, and an unknown-class star riding the
neutral 5 000 K row by up to ~2×. BC stays class-table: class-table BC
against a measured T is still strictly better than class-table both.
The class-table T and BC are main-sequence values — cooler for
giants/supergiants in reality — but the Mbol side of the equation
absorbs the luminosity-class difference, so the end result lands close
to published radii (Sol 1.03 vs canonical 1.0, Vega 2.69 vs ~2.7,
Rigel 77 vs ~74, all within ~10%; Sirius runs 1.92 vs interferometric
1.71 — the class-table BC for its Am composite overshoots ~12% — and
the extreme supergiants land low where the de-extincted AT-HYG mean
magnitude sits under the literature mean, Betelgeuse 577 vs 764⁺¹¹⁶).
The bright Gaia-saturated set has no Apsis row, so these ride the
class table. Clamped to `[0.08, 2500]` so pathological catalog rows
don't produce absurd sizes. White dwarfs are special-cased to 0.013 R☉ (absmag
doesn't translate reliably for them) and Wolf-Rayets to their own
Teff/BC ramps — gspphot models neither atmosphere, so a published
Apsis value there is the companion's light or a misfit and is ignored.
The famous-star radius and colour claims are pinned end-to-end against
`public/catalog.bin` by `scripts/catalog/known-stars.test.ts`
(`primary_radius_rsun` / `primary_ci` corpus columns).

Implementation: `physicalRadius` / `resolveApsisTeff` in
`scripts/catalog/catalog-pure.ts`, wired in `stars-parse.ts`; see
`scripts/catalog/README.md` § Physical radius and spectral parsing for
the spectral-string parser and the surrounding pipeline.

## Stellar perception model

Distant stars (the brightness-driven `appSize` term) are rendered with
a Gaussian-PSF detection-threshold model rather than a literal angular
mapping. A real star is geometrically a point; what an observer
perceives as the star's "disc" is its PSF on the retina out to where
the intensity drops below the detection threshold. For a Gaussian PSF
of width σ this gives:

```
r_perceived(Δm) = σ × √(2 ln(10) / 2.5 × Δm) ≈ σ × √(1.84 × Δm)
```

where Δm = m_lim − m is the magnitudes by which a star sits above the
detection threshold.

**σ value.** We use σ = 30″ for the unaided eye (set by ocular
aberrations + diffraction at a 7 mm dark-adapted pupil). No atmospheric
seeing, no spike-rendering — the camera is in space and we model a
clean PSF.

**Magnitude limits per preset.** `naked-eye` = 6.5 (Bortle-1 dark sky);
`binoculars` = 10.5 (typical 7×50 dark sky, derived from
m_lim_eye + 5·log₁₀(50/7) ≈ +4.3 mag aperture gain); `all` = 15
(matches the catalog/UI slider ceiling, no physical motivation).

**Exaggeration K.** Literal physics at 50° vertical FOV / 1080 px
puts the threshold disc at ~0.25 px and Sirius (Δm = 8) at ~1 px —
both invisible. `starExaggerationK` scales σ up so the threshold disc
lands at a readable 1–2 px. K is per-preset because the population
mix changes with the magnitude limit: defaults are `naked-eye` 12,
`binoculars` 9, `all` 5 — wider catalogs use a smaller K so the dense
star population doesn't wash the field out. Critically, the √Δm shape
is preserved between stars within a preset, so *ratios* against the
volumetric Milky Way bulge (rendered at its real angular size) stay
correct.

**Soft taper.** Real stars near the detection threshold fade across
~0.5 mag rather than popping at the limit. The shader extends
visibility to `m_lim + 0.5` and fades glow intensity via a smoothstep
across that band; the disc pass keeps the hard limit since resolved
discs at threshold would render as a sub-pixel speck.

**Viewport calibration.** Sizes are stored in arcsec internally and
converted to pixels per-frame via
`arcsec_per_px = (FOV × 3600) / max(viewport_w, viewport_h)`. Using
the larger viewport dimension as the reference gives consistent
absolute pixel sizes across portrait/landscape orientations, at the
cost of strict angular fidelity in the secondary axis. Three.js's
`camera.fov` is the *vertical* FOV; horizontal arcsec/px would be
identical only for square viewports.

Implementation: `src/client/star-pipeline/star.{vert,frag}.glsl` (`sqrt`
brightness curve + smoothstep taper) and `src/client/stellata.ts`
(`MAG_PRESETS`, `applyMagnitudePreset`, `computePresetPxSizes`).
Live tuning via `debug.panel()` in the browser console.

## Star colour calibration

Per-star chromaticity is sampled from a 256-entry blackbody → sRGB
lookup table indexed by B-V. The table is precomputed at build time
(`scripts/colour/blackbody-lut.ts` → `src/client/star-pipeline/blackbody-lut-data.ts`)
and bound to the star shader as a 256×1 `DataTexture`. Each entry
folds three physically-grounded steps:

1. **B-V → effective temperature** via the Ballesteros (2012) empirical
   relation,
   `T_eff = 4600 × (1/(0.92(B-V) + 1.7) + 1/(0.92(B-V) + 0.62))`,
   calibrated against stars with both indices measured independently.
   Accurate across A–K main-sequence, with reasonable extrapolation
   into M and hot B.
2. **Planck × CIE 1931** — the Planck spectrum at T_eff is integrated
   against the CIE 1931 2° standard-observer colour-matching functions,
   using the analytical multi-Gaussian fits in Wyman, Sloan & Shirley
   (2013). The fits reproduce the tabulated CMFs to ~1%, well below
   the chromaticity threshold relevant for star rendering.
3. **XYZ → sRGB D65** — the standard linear sRGB transform (IEC
   61966-2-1), peak-normalised per entry to preserve chroma, then
   gamma-encoded via the sRGB piecewise transfer function. Out-of-gamut
   negative components (hot O-stars whose Planckian chromaticity falls
   outside sRGB) clip to zero before normalisation.

### Per-star intrinsic Teff routing

The six logical tiers below split across two stages: the shader resolves
the top Apsis tier at runtime, and the lower four are **baked into the
catalog `ci` field at build time**. The shipped shader routing
(`star.vert.glsl`) is two-tier:

    iTeffApsis > 0 ? Ballesteros(iTeffApsis) : iCi

where `iTeffApsis` is the best Apsis Teff (`bestApsisTeff`, gspphot over
gspspec) and `iCi` is the build-time-baked intrinsic B−V. Full priority,
first match wins:

1. **Gaia DR3 Apsis `teff_gspphot`** — primary, ~62% of catalog records.
   Shader tier (via `iTeffApsis`).
2. **Gaia DR3 Apsis `teff_gspspec`** — covers some gspphot gaps;
   combined Apsis coverage (gspphot ∪ gspspec) ≈ 84.6% of records.
   Shader tier (via `iTeffApsis`).
3. **Observed AT-HYG B-V** — the row's own `ci` cell (de-reddened at
   build), baked into `iCi`.
4. **Spectral-class T_TABLE** — when a no-Apsis star has no B-V but a
   parseable class, `spectralClassCi` (`scripts/catalog/catalog-pure.ts`)
   bakes `Ballesteros(tempKelvin(class))` into `iCi` — the intrinsic
   class colour, so a class star renders its true hue rather than
   solar-yellow. Counted `ciSpectralDerived`.
5. **White-dwarf Sion Teff** — `50400 / wd_subclass`, baked into `iCi`
   through the same `spectralClassCi` path.
6. **Solar fallback** — `SOLAR_BV_FALLBACK` (0.65 ≈ 5778 K) baked into
   `iCi` when nothing else resolves.

Tiers 3–6 are shared by the main-catalog read (`stars-parse.ts`) and
companion promotion (`imputeCompanionCi`) through `spectralClassCi`.
Where Apsis Teff is used (tiers 1–2), the shader recovers the LUT-input
B-V via the analytic Ballesteros inverse so the LUT (keyed on B-V)
samples the chromaticity expected for that Teff. Apsis Teff is the
**intrinsic** parameter (Apsis fits include line-of-sight extinction
`A0` explicitly), so the camera-position-dependent dust reddening
composes downstream without double-counting extinction. The baked `iCi`
tiers are likewise intrinsic — the spectral-class / solar colours are
never de-reddened at build, only observed B-V is.

Dust reddening composes upstream of the LUT: the shader integrates A_V
along the camera-to-star sightline via the Edenhofer 3D dust map and
shifts the LUT-input B-V by `E(B-V) = A_V / 3.1`. The LUT input is
therefore the **observed** (dust-reddened) B-V from the camera's
vantage, not the intrinsic value, so colour drifts physically as the
camera traverses dust between observer and star (the Mu Cephei
"Garnet Star ↔ Peach Star" case study in
`research/star-spectral-rendition/README.md`).

The LUT spans B-V ∈ [-0.4, +2.0] in 256 entries; values are clamped
to the endpoints before sampling. Hotter / cooler tails saturate at
the endpoint colour, which is fine for the catalog's working range
(intrinsic OB stars bottom out around -0.3; the reddest M-supergiants
reach B-V ≈ +2.0–2.5 only after substantial line-of-sight extinction).

Sources:

- Ballesteros, F.J. (2012). New insights into black bodies.
  *Europhysics Letters* 97, 34008.
  https://doi.org/10.1209/0295-5075/97/34008
- Wyman, C., Sloan, P.-P., Shirley, P. (2013). Simple analytic
  approximations to the CIE XYZ color matching functions. *Journal of
  Computer Graphics Techniques* 2(2), 1–11.
  https://doi.org/10.5281/zenodo.10049479
- IEC 61966-2-1:1999. Multimedia systems and equipment — Colour
  measurement and management — Part 2-1: Colour management — Default
  RGB colour space — sRGB.
- Cross-check reference: Mitchell Charity's tabulated blackbody RGBs
  at http://www.vendian.org/mncharity/dir3/blackbody/ (agreement
  ΔE ≤ 5 across 3000–30000 K).

Implementation: `scripts/colour/blackbody-lut.ts` (LUT generator + pure
helpers), `src/client/star-pipeline/blackbody-lut.ts` (generated artifact),
`src/client/star-pipeline/star.vert.glsl` (`ciToColor` sampler), and
`src/client/stellata.ts::makeColorLutTexture`.

## Variable-star modelling

GCVS provides a period and a magnitude amplitude per matched star.
The shader applies a sinusoidal magnitude modulation plus a matching
radius factor to the physical-size term:

- `magMod = 0.5 × ampEff × sin(2π × t / period)` adjusts `appMag`
  (affects point-glow size for distant stars).
- `radiusFactor = 10^(-magMod / 5)` applies to `physSize` (affects
  resolved-disc radius for close stars). This is Stefan–Boltzmann-derived:
  `R ∝ √L` at constant T, which is the defensible single-model assumption
  even though real variables also swing temperature.

GCVS rows without a parseable period, or with zero amplitude, are
skipped at build time — that excludes constant stars, supernovae, and
irregular variables. Typical match rate: ~3.7k of 313k catalog stars.

Implementation: `src/client/star-pipeline/star.vert.glsl` and
`src/client/camera/controls/star-physics.ts` (CPU-side `renderedSizePx`
mirror); see `src/client/star-pipeline/README.md` §Variable star rendering, and
`scripts/catalog/README.md` §GCVS variability cross-match for the
build-time matching rules.

