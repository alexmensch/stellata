# Stellar physics, perception & colour modelling

Covers per-star physical radius, the
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
`public/catalog.bin` by `scripts/catalog/validate/known-stars.test.ts`
(`primary_radius_rsun` / `primary_ci` corpus columns).

Implementation: `physicalRadius` / `resolveApsisTeff` in
`scripts/catalog/spectral/physical-radius.ts`, wired in `stars-parse.ts`; see
`scripts/catalog/spectral/README.md` § The resolver and the radius chain for
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

**Where m_lim comes from.** It is the *instrument's* limiting magnitude,
derived from aperture — not a user-set data filter. The unaided eye is
7 mm (the same dark-adapted pupil σ is derived at) giving m_lim = 7.8:
Bortle-1 best case, in vacuum, fully night-adapted. Deeper instruments
derive theirs from aperture the same way; the record shape and the
retired `exposureMul` / `angularMag` multipliers are
`docs/science-hdr-pipeline.md` § 3.4.

**Exaggeration K — two factors, and only one of them is physics.**
Literal physics at 50° vertical FOV / 1080 px puts the threshold disc at
~0.25 px and Sirius (Δm = 8) at ~1 px, both invisible. K scales σ up so
the threshold disc lands on a readable pixel size. It is a
sub-pixel-visibility hack, so it must retire as it stops being needed —
which is exactly what stating it as *the factor that hits a target pixel
size* accomplishes:

```
arcsec_per_px = FOV_deg × 3600 / viewport_height_css_px
K = K_density(instrument) × max(1, TARGET_PX × arcsec_per_px / σ)
```

- **The plate-scale factor** is the one that earns its keep. Since
  `sizeMinArcsec = σ·K`, the rendered size is
  `σ·K / arcsec_per_px = TARGET_PX` identically — **star pixel size is
  invariant in both FOV and viewport size**, until K floors at 1 (the
  true PSF, at 3.47° FOV on a 1080-px viewport at `TARGET_PX` 2.592) and
  the disc begins *growing* as the 30″ PSF resolves and real physics
  takes over. What narrowing the FOV buys is
  therefore *separation, not size*: a close pair that merged into one
  blob at 50° resolves at 10°, because the exaggeration inflating both has
  shrunk. The merged blob was never physics — it was K.
- **`K_density`** is the instrument's half. The retired per-preset values
  (12 / 9 / 5) conflated the two factors: a deeper limit needs a smaller
  footprint or a dense field washes into a solid sheet. `K_density` = 1
  for the unaided eye; it is a per-instrument calibration for anything
  deeper.
- **`TARGET_PX`** is the calibration this introduces, and **2.592
  shipped** — set by eye against the observer's own experience of the real
  sky, which is the only authority a perceptual exaggeration has. The
  candidates it was chosen over were both derived rather than observed:
  2.16 preserved the retired `K = 12`'s *angular* exaggeration at 50° on
  1080 px, and 3.84 preserved its rendered pixel size on a 1920×1080
  desktop. 2.16 read slightly too small and 3.84 clearly too large; 2.592
  is 1.2× the former, i.e. the old model's `K = 14.4`.

  **Calibrate it through `TARGET_PX`, never through the multiplier or
  `K_density`.** Both of those multiply the *floored* plate-scale term, so
  a non-unit default would leave K above 1 at every zoom level and stars
  permanently larger than the true PSF — the honest-angular-size end of
  the curve would become unreachable. `TARGET_PX` moves only the
  unfloored term, so the floor stays exactly 1 and the crossover simply
  shifts (3.47° at 2.592 on a 1080-px viewport, against 4.17° at 2.16).

Critically, the √Δm shape is preserved between stars at any K, so
*ratios* — including against the volumetric Milky Way bulge, rendered at
its real angular size — stay correct. That is what makes rescaling the
absolute mapping legitimate while the physical relationships hold.

**Soft taper.** Real stars near the detection threshold fade across
~0.5 mag rather than popping at the limit. The shader extends
visibility to `m_lim + 0.5` and fades glow intensity via a smoothstep
across that band; the disc pass keeps the hard limit since resolved
discs at threshold would render as a sub-pixel speck.

**Viewport calibration.** Sizes are stored in arcsec internally and
converted to pixels per frame against the viewport **height**, because
three.js's `camera.fov` is the *vertical* FOV — that is the axis the
angle actually maps to, and the axis `physSize` and the HDR unit's `Ω_px`
already project through.

The earlier convention divided by `max(viewport_w, viewport_h)` to keep
absolute pixel sizes consistent across portrait and landscape. It bought
that at the cost of two defects: widening a desktop window *grew the
stars*, when a fixed vertical FOV should simply reveal more sky (≈ 2.9 px
at 1440 wide against ≈ 6.9 px at 3440), and the secondary axis lost
angular fidelity outright. The K derivation above subsumes the problem
`max(w, h)` was solving — a coarser plate scale raises K, so a threshold
star still lands on `TARGET_PX` even at a 390-px landscape-mobile
height — so the compromise retires rather than being re-tuned.

Implementation: `src/client/star-pipeline/star.{vert,frag}.glsl` (`sqrt`
brightness curve + smoothstep taper) and `src/client/filters/`
(`filter-state.ts` for the angular targets and `starPxSizes`,
`filter-controller.ts` for every mutation path). Live tuning via
`debug.panel()` in the browser console.

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
   parseable class, `spectralClassCi`
   (`scripts/catalog/spectral/physical-radius.ts`)
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

## Variable-star pulsation

GCVS provides a period and a V-band magnitude amplitude per matched
star. Pulsation runs on the model clock (`getT()`) at real GCVS periods,
anchored to `φ = 0 = maximum light` (cos convention, composing with the
M0 epoch anchoring). Three modulations share that phase:

- **Brightness.** `magMod = −(A_V / 2)·cos 2πφ` adjusts `appMag` — the
  full GCVS V-band amplitude, driving point-glow size at distance (a
  Mira still fades toward invisibility near minimum, as it should).
- **Radius.** `radiusFactor = ρ^(−0.5·cos 2πφ)` scales the resolved-disc
  radius, spanning `[ρ^−0.5, ρ^+0.5]` over a cycle. ρ is a **per-type
  peak-to-peak physical-radius ratio**, not derived from the V-band
  amplitude.
- **Colour.** the LUT-input B−V is shifted by `−(ΔB−V / 2)·cos 2πφ`, so
  the disc runs bluer/hotter at maximum light and reddens toward minimum.

### Why radius and temperature split (not radius alone)

The earlier model put the whole V-band amplitude on radius (`R ∝ √L` at
constant T). For high-amplitude pulsators that is more than an order of
magnitude wrong, in two ways:

1. **Magnitude.** A Mira's V-band amplitude (8–11 mag) is dominated by a
   *temperature* swing — cooling drives TiO band opacity up and shifts
   the Planck peak out of V — so its bolometric amplitude is only ~1 mag.
   Ascribing all of `L_V` to radius implied a modelled disc swing of
   ~25–150× (before display compression) versus the ~1.1–1.5× the
   physical radius actually varies (Woodruff et al. 2008 ApJ 673 418 /
   2009 ApJ 691 1328; Ireland et al. 2004 MNRAS 352 318; Wittkowski et
   al. 2016). χ Cyg's interferometric disc varies by up to ~40 %
   (Lacour et al. 2009 ApJ 707 632).
2. **Sign.** Interferometry places the **minimum** diameter near
   **maximum** light (Lacour 2009: minimum at φ ≈ 0.94; diameter
   anti-correlates with flux). The constant-T model had maximum radius
   at maximum light — inverted. The negative exponent on `ρ^(…)` fixes
   this: the disc is smallest at φ = 0.

Cepheids and RR Lyrae swing radius more (ΔR/R ~10–20 %, Baade–Wesselink)
with a moderate colour shift; DSCT-class low-amplitude pulsators barely
move on any axis.

### Per-type table

One code path, parameterised by variability family. `classifyGcvsVarType`
(`scripts/catalog/catalog-pure.ts`) refines the GCVS type into a subtype
code (byte 37); `buildPulsationParams`
(`src/client/star-pipeline/pulsation/pulsation-params-pure.ts`) maps each code to
`{ρ, ΔB−V}`:

| Family (code)            | ρ    | ΔB−V | GCVS prefixes |
| ------------------------ | ---- | ---- | ------------- |
| Mira (4)                 | 1.4  | 0.35 | M |
| Semiregular (5)          | 1.2  | 0.2  | SR, L |
| Cepheid (6)              | 1.15 | 0.3  | DCEP, CEP, CW, WVIR |
| RR Lyrae (7)             | 1.1  | 0.25 | RR |
| DSCT-class low-amp (8)   | 1.02 | 0.05 | DSCT, GDOR, SXPHE, ROAP, SPB, PVTEL, ACYG, BCEP, ZZ |
| generic / other (1, 3)   | 1.1  | 0.1  | RV, OTHER-with-period |

Values are physically motivated to the archetype and tuned at smoke;
they are not per-star fits. Eclipsing binaries (code 2) suppress
pulsation entirely (`iSuppressPulsation`) — their photometric signal is
the geometric-occlusion field, not intrinsic pulsation.

GCVS rows without a parseable period, or with zero amplitude, are
skipped at build time — that excludes constant stars, supernovae, and
irregular variables. Typical match rate: ~4.1k of ~390k catalog stars.

Implementation: `src/client/star-pipeline/star.vert.glsl` (the `iPuls`
attribute) and `src/client/camera/controls/star-physics.ts` (CPU-side
`renderedSizePx` mirror); see `src/client/star-pipeline/README.md`
§Variable star rendering, and `scripts/catalog/parse/README.md` §GCVS
variability cross-match for the build-time matching rules.

