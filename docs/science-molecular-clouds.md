# Molecular clouds — physics model

Physics reference for the molecular-cloud layer: the extinction units
chain, the calibrated Zucker density model, taxonomy and embedded-star
cavities, the isosurface-traced presence pass, and the sampling rules
that keep it band-limited. Implementation and invariants live in the
folder READMEs (`src/client/molecular-clouds/`, `scripts/clouds/`,
`scripts/cloud-surfaces/`, `scripts/dust/`); this file carries the
numbers and the derivations behind them.

## 1. Overview — two independent fields

Molecular clouds touch the render in two decoupled ways, and the split
is load-bearing:

1. **Per-star extinction is pure Edenhofer.** The dust voxel volume
   (`scripts/dust/`) is the single extinction field; stars dim and
   redden by the raymarched Edenhofer column and nothing else. The
   Zucker analytic model does **not** modify it. Measured peak Edenhofer
   columns reach 0.3–1.0× the Zucker Leike-resolution targets
   (Ophiuchus 1.03×), consistent with 1 pc → 4.9 pc beam dilution — the
   field is not materially biased at our grid scale, so a
   centroid-anchored `max(edenhofer, model)` overlay would only mint a
   fake second core (real cores sit off-centre in their bounding boxes:
   Ophiuchus's centroid chord is 0.09 mag vs 2.7 at the true core) and
   corrupt clean sightlines. The 84 Zucker 2020 sphere clouds therefore
   contribute identity only — name, taxonomy, embedded stars,
   presence-pass geometry.

2. **The presence layer is the calibrated Zucker model.** It drives the
   absorption raymarch (dimming diffuse layers behind a cloud) and the
   rim silhouette, shipped in `clouds.json`. Its parameters are the one
   source of truth: `cloud_model.py` → `clouds.json` → shader uniforms,
   never redefined shader-side.

Two consequences:

- **Out-of-grid clouds are presence-only.** Clouds extending beyond the
  ±1250 pc voxel cube (Carina, IC 2944, L379, Maddalena, W3/W4/W5, Gem
  OB1, M16, M17, Rosette, …) render in the presence pass but contribute
  no per-star extinction — consistent with stars beyond the cube
  receiving none. Closing that gap is deferred work (galactic-arm dust /
  grid extension).
- **Substructure comes from real data, not procedural noise.** Cloud
  shape is a per-cloud isosurface mesh traced from the Edenhofer field
  at build time (§ 9, `scripts/cloud-surfaces/`). The log-normal octave
  model (§ 5) is retained only as the build-side spec for a possible
  future volumetric-substructure upgrade; no client code reads the
  `noiseModel` block today.

Embedded-star cavities are a **designed but not-yet-shipped** refinement
(§ 7): a build-time cross-match behind a generic reader interface
(`{position_pc, spectral_type, abs_mag}`, not AT-HYG-specific columns, so
catalog upgrades slot in without touching the cloud pipeline) will carve
presence-model density cavities and drive HII tints. Classes currently
ship as curated seeds.

## 2. Extinction physics and the units chain

Optical depth along a sightline: `τ_V = ∫ κ_V ρ dl`, and
`A_V = 1.086 τ_V`. We never handle κ and ρ separately — every layer
works in **extinction rate** (A_V magnitudes per parsec), which is
what the Edenhofer field natively encodes.

The units chain, end to end:

| Quantity | Value | Source |
| --- | --- | --- |
| Voxel unit | E_ZGR pc⁻¹ (ZGR23 extinction density) | Edenhofer et al. 2024 |
| A_V per E_ZGR | 2.742 | manifest `avPerDensityPerPc` |
| N_H per A_V | 1.87×10²¹ cm⁻² mag⁻¹ | Bohlin, Savage & Drake 1978 (N_H/E(B−V) = 5.8×10²¹, R_V = 3.1) |
| 1 cm⁻³ · pc | 3.086×10¹⁸ cm⁻² | definition |
| A_V rate for n_H [cm⁻³] | 1.65×10⁻³ · n_H mag pc⁻¹ | product of the above |
| ρ_ZGR for n_H [cm⁻³] | 6.02×10⁻⁴ · n_H E_ZGR pc⁻¹ | ÷ 2.742 |
| A_K / A_V | 0.117 | CCM 1989 at R_V = 3.1 |

The Zucker 2021 profile amplitudes (n0 in cm⁻³) convert through this
chain, but their absolute normalisation is **not trusted** — the
species convention (n_H vs n_H₂) and the extinction-to-density
assumptions wash out because we calibrate each cloud's column to its
observed A_K (§ 4.2). Only the profile *shape* (rflat, p) is taken at
face value.

### 2.1 What "realistic A_V" means at our resolution

"Realistic A_V (~5–25 mag)" through dense cores applies to sub-0.1 pc
pencil beams (2D NICEST-style maps: Taurus max A_K 0.90 → A_V ≈ 7.7;
Ophiuchus 1.99 → ≈ 17). At the 4.88 pc voxel scale the correct,
area-averaged columns are what the Leike-resolution 3D values give:
Zucker Table 3 `max_ak_leike` 0.19 – 0.38 → **A_V ≈ 1.6 – 3.3 through
the densest cores** — and those are themselves 1 pc-beam peaks, so the
4.9 pc grid's peak columns legitimately land below them (measured
0.3–1.0×, § 1). The presence pass conveys the darker sub-beam cores
visually. Per-star extinction deliberately does **not** reach 25 mag:
no 4.9 pc-averaged column does.

### 2.2 Encoding ceiling — the fixed DENSITY_MAX

The extinction grid encodes density in a fixed log window with a
**fixed** `DENSITY_MAX = 0.2` E_ZGR/pc (raw grid max 0.135 at the ρ Oph
core × 1.2 headroom, asserted every build). An earlier
99.95th-percentile autotune (5.33×10⁻³ E_ZGR/pc → max 0.0146 A_V mag/pc)
silently clipped every dense core 25×: even a 30 pc saturated path
yielded only 0.44 mag against a field that peaks near 0.135 E_ZGR/pc.
The fixed ceiling widens the 255-step log window from 4.73 to 6.30
decades (quantisation 4.4 %→5.9 %/step, invisible downstream); the
shader decodes from manifest constants, so no client change beyond the
regenerated data. Encoding mechanics: `scripts/dust/README.md`
§ Encoding.

The de-extinction invariant (`scripts/catalog/README.md` § Build-time
de-extinction) means the catalog rebuild ships with the re-encoded
grid: intrinsic absmags of stars behind dense dust brightened by up to
~1.8 mag. Because extinction only dims (A_V ≥ 0), the `star.vert.glsl`
prefilter needs no headroom term — a star whose unextincted appMag
exceeds the soft-taper bound can never become visible.

## 3. Cloud geometry model

Every cloud is an ellipsoid: centroid `c`, semi-axes `s = (s₁,s₂,s₃)`
(descending), orientation quaternion `q` (in `public/clouds.json`). The
density model works in the ellipsoid's local frame with the
**ellipsoidal radius**

```
u(x) = sqrt( Σᵢ (xᵢ_local / sᵢ)² )        u = 1 on the envelope
r_eff(x) = u(x) · s_min
```

Scaling `u` by the *smallest* semi-axis maps the fitted radial profile
onto the cloud's narrow dimension: Zucker 2021 fitted the volume-density
profile perpendicular to each cloud's filamentary spine, and the
ellipsoid's short axis is our best available proxy for "distance from
the spine" (the bboxes are what Table 1 publishes; we do not have the
spine skeletons).

## 4. Per-cloud density model — the presence-pass field

The analytic model drives the presence pass and the embedded-star /
cavity work. It does **not** modify the voxel extinction field (§ 1).
Shared implementation: `scripts/clouds/cloud_model.py`, consumed by
`build-clouds.py` (clouds.json fields) and `build-dust.py` (the column
check).

### 4.1 The 11 profiled clouds (Zucker 2021)

Plummer-like profile, parameters from Table 2 (`n0`, `rflat`, `p` —
Plummer columns, not the Gaussian fits). Corona Australis has a Table 1
bbox but **no Table 2/3 rows** — it takes the § 4.3 class defaults, so
11 of the 12 ellipsoids are profiled. Semi-axes floor at 3 pc per axis
(Musca's fitted bbox is 0.5 pc thin).

```
n(x) = n0_cal · (1 + (r_eff(x)/rflat)²)^(−p/2) · envelope(u, u_env)
envelope(u, u_env) = 1 − smoothstep(0.85·u_env, u_env, u)
```

`n0_cal` is the calibrated amplitude (§ 4.2), NOT Table 2's `n0`;
`u_env ≤ 1` is the mass-budget envelope tightening (§ 4.2). Fitted
values for reference (Table 2): Taurus n0 = 72.8 cm⁻³, rflat = 1.2 pc,
p = 1.2; Perseus 47.8 / 6.1 / 2.4; Orion B 50.3 / 8.1 / 3.0. Note p ≤ 2
profiles have slowly-converging columns — all column integrals are taken
numerically with the envelope cutoff, never analytically to infinity.

### 4.2 Calibration procedure (per cloud)

1. Compute the model column through the centroid along the shortest
   axis: `N_A_V = ∫ 1.65×10⁻³ · n(l) dl` (numeric, envelope-bounded).
2. Solve `n0_cal` so `N_A_V = max_ak_leike / 0.117` (Table 3).
   Leike-scale values are the resolution-matched truth for a 3D grid;
   NICEST 2D values are sub-beam and would over-darken every sightline
   (§ 2.1).
3. Mass budget: `M_model = μ m_H ∫ n dV` with μ = 1.37 per H nucleon. A
   filled ellipsoid at the observed peak column over-masses elongated /
   flat-profile clouds (a real cloud is a filament inside its bbox):
   where `M_model` exceeds 2 × `mass_leike`, the envelope tightens
   (`u_env < 1`, bisected jointly with the re-solved `n0_cal`) until the
   budget holds. Measured u_env: 1.0 for Taurus/Ophiuchus/Perseus/Orion
   A/B; 0.49 Pipe; 0.72 Cepheus; 0.22 Orion λ — the ring morphology the
   centrally-peaked model cannot represent (the cavity carve owns it,
   § 7.3).

All 11 calibrated `n0_cal` + `u_env` values are pinned in
`scripts/clouds/clouds-json.test.ts` (`toBe`) so table or constant
drift is caught.

### 4.3 The sphere clouds (Zucker 2020) + Corona Australis

No density data → class-based default column, amplitude derived from the
sphere radius R (Coraus: its floored shortest semi-axis):

```
A_V_target(class):  dark 2.0, sf 3.0, hii 4.0   (mag, through centre)
n0_cal = A_V_target / (2R · 1.65×10⁻³)          (uniform-core equivalent)
profile: Plummer with rflat = 0.25 R, p = 2.0   (generic centrally-
                                                 condensed shape)
```

These defaults are presence-pass cosmetics, not extinction truth — they
only shape silhouettes.

## 5. Substructure noise (build-side spec)

Cloud substructure ships as real data — per-cloud isosurface meshes
traced from the Edenhofer field (§ 9). The presence shader carries no
noise. The log-normal octave model below is retained as the build-side
spec: `cloud_model.py` still emits the `noiseModel` block (§ 8) so a
future volumetric-substructure upgrade has one calibrated source of
truth to pick up. No client code reads it today.

### 5.1 Physical basis

Supersonic turbulence gives a log-normal volume-density PDF
(Vazquez-Semadeni 1994; Padoan, Nordlund & Jones 1997): `s = ln(ρ/ρ̄)`
is Gaussian with

```
σ_s² = ln(1 + b² M²)        b ≈ 0.4 (mixed forcing; Federrath+ 2010)
```

Class-based Mach numbers (§ 7): dark M ≈ 5 → σ_s ≈ 1.3; sf M ≈ 8 →
σ_s ≈ 1.7; hii M ≈ 10 → σ_s ≈ 1.9. Actively star-forming clouds
additionally develop a high-density power-law tail (Federrath & Klessen
2013; Kainulainen et al. 2009) — represented in the fine octaves'
ridged shaping, not a separate PDF term.

### 5.2 The multiplicative field

```
ρ(x) → ρ(x) · exp( σ_s · g(x) − σ_s²/2 )        g clamped to ±2.5σ
```

`g` is a unit-variance octave sum; the `−σ_s²/2` offset makes the field
mean-preserving in expectation, and the clamp bounds the log-normal tail
(the presence integral must stay finite and band-limited, § 9.1).

The octave ladder is one geometric sequence (lacunarity 2, base
wavelength = the cloud's major diameter, down to ~0.3 pc). Per-octave
variance follows a turbulence power-law — ratio 2^(3−β) per octave
toward finer scales with β ≈ 2 (supersonic-turbulence density spectra
are shallower than Kolmogorov). All ladder constants ship in the
`noiseModel` block of `clouds.json`: `{lacunarity, betaSpectral,
lambdaMinPc, domainStretchMajor, noiseClampSigma, ridgedFinestCount,
ridgedExponent, sigmaS, hash: pcg3d, interp: quintic}` —
quintic-interpolated lattice value noise under a PCG3D hash, expressible
in GLSL ES 3.0 uint arithmetic. Seeded per cloud (`seed` in the schema,
§ 8 — FNV-1a of the raw Zucker table name) in cloud-local coordinates so
the structure is static and per-cloud distinct.

### 5.3 Filamentary anisotropy

Real substructure is filaments (~0.1 pc characteristic width,
Arzoumanian et al. 2011/2019), not isotropic blobs. Two cheap shaping
terms, both in cloud-local frame:

1. **Domain stretch**: scale the noise domain by 2.5× along the major
   axis before sampling — structures elongate along the cloud.
2. **Ridged transform** on the finest octaves (`ridgedFinestCount`):
   `g_r = 1 − |2g − 1|` sharpened by one squaring — turns smooth blobs
   into ridge/lane structure. For sf/hii classes, raise the ridged
   octaves to the 1.5 power (`ridgedExponent` 3 vs 2) to emulate the
   power-law tail's contrasty cores; dark clouds keep the plain form.

## 6. Reddening

`star.vert.glsl` accumulates A_V and applies `E(B−V) = A_V / 3.1` as a
shift of the LUT-input B−V — the CCM 1989 diffuse-ISM law. The raymarch
is single-channel in *storage* (one A_V accumulator); the colour effect
is present. The CPU mirror (decode + integration + `E(B−V) = A_V / R_V`)
is `dust-raymarch-pure.ts`, pinned to `toBe` precision.

**Density-dependent R_V — resolved analytically, not shipped.** The
upgrade would raise R_V from 3.1 toward ~5.5 in dense cores (grain
growth; Weingartner & Draine 2001; Chapman et al. 2009):

```
E(B−V) = Σ  (dA_V/dl) / R_V(ρ)  · dl
R_V(ρ) = 3.1 + 2.4 · smoothstep(ρ₁, ρ₂, ρ)
ρ₁ = 0.01, ρ₂ = 0.08 E_ZGR/pc   (diffuse → core transition)
```

R_V is a *measured observable* with a known column dependence, not a
look-knob. Chapman et al. 2009 measure R_V ≈ 3.1–3.5 for A_V ≲ 4–5,
reaching ~5 only at A_V ≳ 10–18. Our per-star columns are
voxel-averaged and bounded: the pinned peak (dust manifest `zucker`
block) is Ophiuchus at A_V = 2.73, everything else ≤ 1.75, and the
grid-max density (0.135 E_ZGR/pc → 0.37 A_V/pc) makes A_V ≳ 4 physically
unreachable on any realistic chord. The R_V = 5.5 grain-growth regime is
the sub-0.1 pc pencil-beam column the 4.88 pc grid deliberately does not
resolve (§ 2.1). At A_V ≤ 2.73 the measured R_V is ≈ 3.1–3.5, so the
global R_V = 3.1 is correct to ≲ 0.1 mag of B−V even on the densest
core; the ρ₂ = 0.08 trigger above would over-correct and slightly
*under*-redden it. The constant law is the physically-grounded choice at
our resolution; the two-accumulator plumbing isn't worth its cost. If
the star catalog ever gains a sub-pc dust field reaching A_V ≳ 10, the
honest refinement is to match the measured R_V(A_V) column relation
directly — not this local-ρ ceiling law. The equation is kept for that
contingency. Full per-channel RGB extinction curves are out of scope:
the B−V-shift-through-LUT path is the single source of truth for star
colour.

## 7. Taxonomy and embedded stars

### 7.1 Classes

```
dark   quiescent / low-mass SF    no stars earlier than B2 inside
sf     active star formation      B2–O9 present, or curated
hii    developed HII region(s)    O / early-B (≤ B1) present, or curated
```

Class drives: default A_V_target (§ 4.3), Mach/σ_s (§ 5.1), fine-octave
shaping (§ 5.3), presence tint (§ 9).

### 7.2 Derivation (build time — designed, not yet shipped)

Classes currently ship as curated seeds; the cross-match below is the
planned build-time derivation that will supersede them. Cross-match
catalog stars against cloud ellipsoids (point-in-ellipsoid
in the cloud local frame, u ≤ 1.1). Keep stars with spectral type O or
B0–B1 (cavity carvers + HII sources) and B2–B9 (reflection-nebula
illuminators, class signal only). The reader interface is a generic
record `{position_pc, spectral_type, abs_mag}` sourced from the built
catalog — no AT-HYG-specific columns — so future catalogs feed the same
cross-match unchanged.

Classification rule: any ≤ B1 star → `hii`; else any B2–B9 or a curated
flag → `sf`; else `dark`. A small curated override table in
`cloud_model.py` handles (a) out-of-grid famous HII regions whose
ionising stars may be missing/too-faint in the catalog (Carina, W3, W4,
W5, M16, M17, Rosette, IC 2944, NGC 6604, Gem OB1), (b) IC 443 (a
supernova remnant — treated as `hii` for tinting), (c) any
misclassification found during smoke. The 12 Zucker 2021 clouds carry
curated seed classes (Taurus/Chamaeleon/Musca/Pipe/Lupus/Cepheus dark;
Ophiuchus/Perseus/Coraus sf; the three Orion clouds hii) that the
in-grid cross-match supersedes.

### 7.3 Cavities (designed, not yet shipped)

The cavity carve is a planned presence-model refinement — the extinction
voxels already resolve the real cavities (Edenhofer resolves the λ Ori
ring), so it never touches them. Each retained ≤ B1 star carves a cavity.
Strömgren radius:

```
R_S = ( 3 Q_H / (4π α_B n²) )^(1/3)      α_B = 2.6×10⁻¹³ cm³ s⁻¹
```

`n` = analytic model density at the star's position (floor 10 cm⁻³).
Ionising photon rates, log₁₀ Q_H [s⁻¹] (Martins, Schaerer & Hillier 2005
for O; Sternberg et al. 2003 for B):

```
O5V 49.3 · O6V 48.9 · O7V 48.6 · O8V 48.3 · O9V 48.0 · B0V 47.6 · B1V 45.7
giants/supergiants: use the same class row +0.3 dex
```

Representative scale: an O6V in n = 100 cm⁻³ gives R_S ≈ 2.9 pc; a B0V
≈ 1.1 pc. Evolved regions exceed the instantaneous Strömgren sphere
(D-type expansion, stellar winds) — the λ Ori ring (≈ 30 pc, Dolan &
Mathieu 2002) is the canonical local example and a validation case:

```
R_cav = max( R_S , R_curated )     R_curated: Orion Nebula 4 pc,
                                   λ Ori 30 pc, else absent
```

Density modulation (applied in the presence shader; the voxel field
already carries the real cavities — Edenhofer resolves the λ Ori ring):

```
cavity(x) = [ ε + (1−ε) · smoothstep(0.7 R_cav, 1.15 R_cav, r) ]
            · [ 1 + A_rim · exp( −((r − R_cav)/(0.15 R_cav))² ) ]
ε = 0.05 (interior: ionised, dust largely destroyed/evacuated)
A_rim = 1.0 (swept-up shell ≈ 2× ambient at the rim)
```

The ionisation front is razor-thin, but the *visual* cavity edge is the
swept-up shell — finite width, hence the 0.15 R_cav Gaussian rim rather
than a step. Cap at 4 cavities per cloud (uniform-array budget); merge
closer pairs by taking the larger R_cav.

## 8. Per-cloud parameter schema

The emitted `clouds.json` fields (`class`, `n0Cal`, `uEnv`, `rflat`,
`p`, `sigmaS`, `massLeike`, `akPeak`, `inGrid`, `seed`, `embedded[]`,
plus the build-side `noiseModel` block) are documented in
`scripts/clouds/README.md` § Output schema, which is the schema's single
source of truth. Physics behind each field is §§ 4, 5, 7 here.

## 9. Presence pass

Physical grounding: in the optical, a molecular cloud seen from outside
is (a) a *dark patch* occluding the diffuse background (the Milky Way
band, the galactic glow) and (b) essentially invisible otherwise (real
clouds sit at ~21–23 mag/arcsec² of scattered light). Two **decoupled**
components:

- **Absorption (alpha-over, always on):** a per-fragment short raymarch
  through the ellipsoid segment. Traced clouds integrate the **per-cloud
  Edenhofer density brick** (a uint8 3D texture in `cloud-surfaces.bin` —
  the exact volume the rim isosurface was traced from, so shadow and
  silhouette agree 1:1, and the band dimming is the same pure-Edenhofer
  physics as the per-star raymarch, `A_V = 2.742 · ∫E dl`). Fallback
  clouds integrate the analytic model (Plummer × cavities; smooth by
  construction). Opacity `α = 1 − exp(−0.921 · A_V_ray)`, capped at 0.95,
  emitted **alpha-only premultiplied over** (rgb = 0). Because the mesh
  renders in the background group — after the Milky Way band but before
  the star passes — the alpha-over dims the MW band / galactic glow
  behind the cloud while leaving stars untouched (their dimming comes
  from the per-star raymarch; no double counting). This is how clouds
  extinct the volumetric Milky Way, which does not sample the voxel grid
  — so it is **physics, never declutter-gated**: on at every detail
  level in realistic mode, hidden only in chart mode.
- **Rim silhouette (additive, whisper-level, declutter-gated):** the
  Local Bubble's fresnel-rim treatment (`src/client/fresnel-shell/`,
  shared `stellata_fresnel_rim` chunk + `SHELL_RIM_BLUE`) on a per-cloud
  **isosurface mesh traced from the real Edenhofer field** at build time
  (`scripts/cloud-surfaces/README.md`; clouds the field can't resolve
  fall back to their ellipsoid envelope). It is an orientation aid for
  objects you can't actually see, so the limb-brightened silhouette
  reads as annotation, not luminous gas — one shared blue, no class
  tinting — and it is gated at the `representational` declutter floor
  (`molecularCloudEllipsoids`): decluttering to `physical` removes it,
  leaving pure physics. FrontSide + outward winding is the fresnel-shell
  hide-when-inside contract (the rim culls with the camera inside; the
  BackSide absorption keeps working from inside). Rim strength is the
  shared boundary-shell value (`SHELL_RIM_ALPHA_LIMB`). Per-cloud
  silhouette name labels ride the shared shell-label engine at the `all`
  declutter level, screen-size gated. HII emission overlays driven by the
  cavity list are separate, deferred work.

Chart mode renders the rim meshes as **stippled silhouette outlines**
(the SkyAtlas 2000 nebula convention — an fwidth-scaled contour where
n·v → 0, masked by a screen-space dot grid) and hides the absorption.
Intensity constants are named uniforms with dev-console levers
(`stellata.cloudLayer.*`).

### 9.1 Sampling and anti-aliasing — banding is the known failure mode

The volumetric Milky Way deliberately does not sample the Edenhofer
voxels because fixed-step marches alias into visible streaks
(`docs/science-galactic-structure.md` § Interstellar dust extinction;
the standing spiral-arm non-goal exists for the same reason). The
absorption integrand is the smooth analytic Plummer profile or the
traced brick — no heavy-tailed noise estimator. Three rules are
mandatory:

1. **Static per-pixel ray jitter.** Offset each ray's start by one step
   length scaled by interleaved gradient noise of `gl_FragCoord.xy` —
   cheap, no texture. Do NOT reseed per frame: with no temporal
   accumulation pass, animated jitter reads as shimmer; static jitter is
   stable and camera motion decorrelates it naturally.
2. **Output dither.** The whisper rim at 0.05–0.15 intensity spans only
   ~13–38 levels of an 8-bit framebuffer — quantisation banding is
   guaranteed even with a perfect integral. Add ±0.5-LSB gradient-noise
   dither to the final output (both absorption alpha and rim rgb).
3. **Render-order contract for extinctable layers.** The alpha-over
   dimming reaches only layers drawn *before* the absorption mesh
   (`renderOrder −2`). Every diffuse background the clouds should extinct
   — the MW band, the galactic disc glow, any future HiPS / sky-imagery
   layer — must render earlier in the background group; a layer added
   after the mesh silently escapes extinction. Point sources are exempt
   (per-star raymarch owns them). Recorded in
   `src/client/molecular-clouds/README.md` § Absorption render.

Step count is a dev-console lever; the structure above is not tunable
away.

## 10. Inside-the-cloud experience

This is the intended inside-cloud model — it falls out of mechanisms
already shipped; verification and tuning against real fly-throughs is
tracked work. An observer at the centre of Taurus sees background stars
along
cloud-crossing sightlines dimmed and reddened (many to invisibility),
near-peripheral sightlines barely affected, and an extremely dark
ambient sky — dark nebulae are darker than the airglow-limited night sky
on Earth. Everything falls out of the two mechanisms already specified:

- **Stars:** the per-star raymarch handles camera-inside-cloud
  automatically (the camera→star segment starts inside the dense
  region). The un-clipped Edenhofer encode (§ 2.2) is what makes this
  real.
- **Diffuse background:** the absorption mesh is `BackSide` with an
  analytic ray-envelope segment, so it renders from inside too; each
  fragment integrates the *outward* column in its direction, so the MW
  band dims anisotropically — darkest toward the core, brightest toward
  the nearest edge. This is the correct first-order model of sitting
  inside an extinction shell. (The rim glow — not the absorption — is
  suppressed inside, § 9.)

## 11. References

- Cardelli, Clayton & Mathis 1989, ApJ 345, 245 — extinction law, R_V = 3.1.
- Bohlin, Savage & Drake 1978, ApJ 224, 132 — N_H / E(B−V) = 5.8×10²¹ cm⁻² mag⁻¹.
- Zucker et al. 2020, ApJ 900, 196 — cloud distances (Table A1).
- Zucker et al. 2021, ApJ 919, 35 — 3D bboxes, Plummer profile fits, masses, peak A_K (Tables 1–3).
- Edenhofer et al. 2024, A&A 685, A82 — 3D dust map; E_ZGR units.
- Leike, Glatzle & Enßlin 2020, A&A 639, A138 — the 3D map behind `mass_leike` / `max_ak_leike`.
- Vazquez-Semadeni 1994, ApJ 423, 681; Padoan, Nordlund & Jones 1997, MNRAS 288, 145 — log-normal density PDF.
- Federrath et al. 2010, A&A 512, A81 — σ_s² = ln(1 + b²M²), b by forcing.
- Federrath & Klessen 2013, ApJ 763, 51; Kainulainen et al. 2009, A&A 508, L35 — power-law tail in SF clouds.
- Arzoumanian et al. 2011, A&A 529, L6; 2019, A&A 621, A42 — 0.1 pc filament width.
- Strömgren 1939, ApJ 89, 526; Osterbrock & Ferland 2006 — R_S, α_B.
- Martins, Schaerer & Hillier 2005, A&A 436, 1049 — O-star Q_H calibration; Sternberg, Hoffmann & Pauldrach 2003, ApJ 599, 1333 — B stars.
- Weingartner & Draine 2001, ApJ 548, 296; Chapman et al. 2009, ApJ 690, 496 — R_V ≈ 5.5 in dense cores.
- Dolan & Mathieu 2002, AJ 123, 387 — λ Ori ring geometry.
