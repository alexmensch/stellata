# Molecular cloud rendering — physics model and implementation design

Design record for epic `stellata-c7u` (phases A.2–A.7). Everything an
implementer needs: the density model, calibration procedure, noise
spec, cavity/taxonomy model, per-cloud parameter schema, and per-phase
specs with acceptance criteria. No code lands from this document
itself.

Data inputs: Zucker 2020 Table A1 + Zucker 2021 Tables 1–3
(`data/molecular-clouds/`), the Edenhofer dust voxel volume
(`scripts/dust/build-dust.py` → `public/dust/`), and the star catalog
(embedded-star cross-match). Rendering surfaces: the per-star
extinction raymarch in `src/client/star-pipeline/star.vert.glsl` and
the cloud presence layer in `src/client/molecular-clouds/`.

## 1. Architecture

Four decisions, settled with the user (2026-07-03), that revise or
refine the epic's original scoping:

1. **Edenhofer alone is the extinction field; Zucker calibrates the
   presence model.** The original plan (settled 2026-07-03) baked
   `max(edenhofer, cloudModel)` for the profiled clouds on the belief
   that Edenhofer's posterior mean under-recovers dense cores. A.2's
   measurements overturned the premise: the under-recovery in the app
   was the *encode ceiling's* fault — the 99.95th-percentile
   `DENSITY_MAX` autotune (0.0053 E_ZGR/pc) clipped the raw field 25×,
   crushing peak cloud columns to 0.06–0.6 mag where the raw data
   carries 0.8–2.7 mag. With the ceiling fixed (§ 2.2), peak Edenhofer
   columns reach 0.3–1.0× the Zucker Leike-resolution targets
   (Ophiuchus 1.03×), consistent with 1 pc → 4.9 pc beam dilution —
   i.e. Edenhofer is *not* materially biased at our grid scale. The
   ellipsoid overlay, by contrast, is morphologically wrong: real
   cores sit off-centre in their bboxes (Ophiuchus's centroid chord
   through Edenhofer is 0.09 mag vs 2.7 at the true core), so a
   centroid-anchored `max()` mints a second fake core per cloud and
   corrupts clean sightlines (Antares: 0.84 mag — matching the
   literature 0.6–0.8 — bulldozed to 2.4 by the overlay). Per-star
   extinction therefore reads **pure Edenhofer**; the calibrated
   Zucker model (§ 4) ships in `clouds.json` v2 and drives only the
   presence pass. `build-dust.py` asserts the per-cloud peak-column
   ratios each run (`zucker` block in the dust manifest) so an encode
   regression is caught at build time. The 84 Zucker 2020 spheres
   contribute identity only: name, taxonomy, embedded stars,
   presence-pass geometry.
2. **Out-of-grid clouds are presence-only.** 18 of 96 clouds extend
   beyond the ±1250 pc voxel cube (Carina 2.5 kpc, IC 2944, L379,
   Maddalena, W3/W4/W5, Gem OB1, M16, M17, Rosette, …). They render
   in the presence pass with the full analytic model but contribute
   no per-star extinction — consistent with stars beyond the cube
   receiving no extinction today. The extinction gap is owned by
   `stellata-ju3` (galactic-arm dust / grid extension); its scoping
   bead carries the hand-off context (Edenhofer's
   `less_data_but_2kpc` flavor covers 14 of the 18).
3. **The substructure noise ladder is wholly shader-side.** With no
   synthetic density baked into the voxels (decision 1 — the real
   Edenhofer structure *is* the coarse variance), the noise ladder
   (§ 5) exists only in the presence-pass shader, band-limited per
   § 9.1. Its constants ship as the `noiseModel` block in
   `clouds.json` v2 so A.4/A.6 read one source of truth.
   *Revised at the A.6 rework (2026-07-21, with the user):* the
   shader-side ladder is retired entirely — cloud shape now comes from
   **real data**, per-cloud isosurface meshes traced from the
   Edenhofer field at build time (§ 9; `scripts/cloud-surfaces/`).
   The `noiseModel` block stays in `clouds.json` v2 as the build-side
   single source of truth for a future volumetric-substructure
   upgrade, but no client code reads it.
4. **Embedded stars come from an in-catalog cross-match, behind a
   generic reader interface.** Build-time point-in-ellipsoid test of
   catalog stars with O/early-B spectral types against cloud
   volumes. The cross-match consumes a generic star record
   (position, spectral type / T_eff, absolute magnitude) — not
   AT-HYG column names — so the planned catalog upgrades (2M-star
   AT-HYG extension, Gaia-native sampling) slot in without touching
   the cloud pipeline.

## 2. Extinction physics and the units chain

Optical depth along a sightline: `τ_V = ∫ κ_V ρ dl`, and
`A_V = 1.086 τ_V`. We never handle κ and ρ separately — every layer
works in **extinction rate** (A_V magnitudes per parsec), which is
what the Edenhofer field natively encodes.

The units chain, end to end:

| Quantity | Value | Source |
| --- | --- | --- |
| Voxel unit | E_ZGR pc⁻¹ (ZGR23 extinction density) | Edenhofer et al. 2024 |
| A_V per E_ZGR | 2.742 | manifest `avPerDensityPerPc`, already shipped |
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

The epic asks for "realistic A_V (~5–25 mag)" through dense cores.
That range applies to sub-0.1 pc pencil beams (2D NICEST-style maps:
Taurus max A_K 0.90 → A_V ≈ 7.7; Ophiuchus 1.99 → ≈ 17). At the
4.88 pc voxel scale the correct, area-averaged columns are what the
Leike-resolution 3D values give: Zucker Table 3 `max_ak_leike` 0.19 –
0.38 → **A_V ≈ 1.6 – 3.3 through the densest cores** — and those
values are themselves 1 pc-beam peaks, so the 4.9 pc grid's peak
columns legitimately land below them (measured 0.3–1.0×, § 1
decision 1). The presence pass's fine octaves convey the darker
sub-beam cores visually. Per-star extinction deliberately does
**not** reach 25 mag: no 4.9 pc-averaged column does.

### 2.2 Encoding ceiling — the fixed DENSITY_MAX

The pre-A.2 manifest autotuned `densityMax` to the 99.95th percentile
of nonzero voxels: 5.33×10⁻³ E_ZGR/pc → max 0.0146 A_V mag/pc → even
a 30 pc path of saturated voxels yielded only 0.44 mag, while the raw
Edenhofer field peaks at 0.135 E_ZGR/pc (the ρ Oph core) — a silent
25× clip of every dense core. A.2 replaced the autotune with a fixed
`DENSITY_MAX_REAL = 0.2` (raw grid max × 1.2 headroom, asserted at
every build). Cost: the 255-step log window widens from 4.73 to 6.30
decades → quantisation step grows from 4.4 %/step to 5.9 %/step —
invisible against everything downstream. The shader decodes from
manifest constants, so no client change beyond the regenerated data.

The de-extinction invariant (`scripts/catalog/README.md` § Build-time
de-extinction) means the catalog rebuild ships with the re-encoded
grid: intrinsic absmags of stars behind dense dust brightened by up
to ~1.8 mag (the corpus pins for Antares moved by the Ophiuchus-edge
sightline's restored 0.43 mag).

A.2's `DUST_AV_HEADROOM` sweep in `star.vert.glsl` re-derived the
prefilter and **removed** the headroom term: extinction only dims
(A_V ≥ 0), so a star whose unextincted appMag exceeds the soft-taper
bound can never become visible — the prefilter is exact with zero
headroom, and the 1.5 mag term only made too-faint stars pay for the
raymarch.

## 3. Cloud geometry model

Every cloud is an ellipsoid: centroid `c`, semi-axes `s = (s₁,s₂,s₃)`
(descending), orientation quaternion `q` (already in
`public/clouds.json`). The density model works in the ellipsoid's
local frame with the **ellipsoidal radius**

```
u(x) = sqrt( Σᵢ (xᵢ_local / sᵢ)² )        u = 1 on the envelope
r_eff(x) = u(x) · s_min
```

Scaling `u` by the *smallest* semi-axis maps the fitted radial
profile onto the cloud's narrow dimension: Zucker 2021 fitted the
volume-density profile perpendicular to each cloud's filamentary
spine, and the ellipsoid's short axis is our best available proxy for
"distance from the spine". (We do not have the spine skeletons — the
bboxes are what Table 1 publishes. The noise anisotropy in § 5.3
restores the elongated look.)

## 4. Per-cloud density model — the presence-pass field

The analytic model below drives the presence pass (A.6) and the
embedded-star/cavity work (A.5). It does **not** modify the voxel
extinction field (§ 1 decision 1). Shared implementation:
`scripts/clouds/cloud_model.py`, consumed by `build-clouds.py`
(clouds.json v2 fields) and `build-dust.py` (the column check).

### 4.1 The 11 profiled clouds (Zucker 2021)

Plummer-like profile, parameters from Table 2 (`n0`, `rflat`, `p` —
Plummer columns, not the Gaussian fits). Corona Australis has a
Table 1 bbox but **no Table 2/3 rows** — it takes the § 4.3 class
defaults, so 11 of the 12 ellipsoids are profiled. Semi-axes floor at
3 pc per axis (matching the renderer; Musca's fitted bbox is 0.5 pc
thin).

```
n(x) = n0_cal · (1 + (r_eff(x)/rflat)²)^(−p/2) · envelope(u, u_env)
envelope(u, u_env) = 1 − smoothstep(0.85·u_env, u_env, u)
```

`n0_cal` is the calibrated amplitude (§ 4.2), NOT Table 2's `n0`;
`u_env ≤ 1` is the mass-budget envelope tightening (§ 4.2).
Fitted values for reference (Table 2): Taurus n0 = 72.8 cm⁻³,
rflat = 1.2 pc, p = 1.2; Perseus 47.8 / 6.1 / 2.4; Orion B 50.3 /
8.1 / 3.0; etc. Note p ≤ 2 profiles have slowly-converging columns —
all column integrals are taken numerically with the envelope cutoff,
never analytically to infinity.

### 4.2 Calibration procedure (per cloud)

1. Compute the model column through the centroid along the shortest
   axis: `N_A_V = ∫ 1.65×10⁻³ · n(l) dl` (numeric, envelope-bounded).
2. Solve `n0_cal` so `N_A_V = max_ak_leike / 0.117` (Table 3).
   Leike-scale values are the resolution-matched truth for a 3D
   grid; NICEST 2D values are sub-beam and would over-darken every
   sightline (§ 2.1).
3. Mass budget: `M_model = μ m_H ∫ n dV` with μ = 1.37 per H
   nucleon. A filled ellipsoid at the observed peak column
   over-masses elongated / flat-profile clouds (a real cloud is a
   filament inside its bbox): where `M_model` exceeds
   2 × `mass_leike`, the envelope tightens (`u_env < 1`, bisected
   jointly with the re-solved `n0_cal`) until the budget holds.
   Measured u_env: 1.0 for Taurus/Ophiuchus/Perseus/Orion A/B;
   0.49 Pipe; 0.72 Cepheus; 0.22 Orion λ — the ring morphology the
   centrally-peaked model cannot represent (A.5's 30 pc cavity carve
   owns it).

All 11 calibrated `n0_cal` + `u_env` values are pinned in
`scripts/clouds/clouds-json.test.ts` (`toBe`, per the write-time test
discipline) so table or constant drift is caught.

### 4.3 The sphere clouds (Zucker 2020) + Corona Australis

No density data → class-based default column, amplitude derived from
the sphere radius R (Coraus: its floored shortest semi-axis):

```
A_V_target(class):  dark 2.0, sf 3.0, hii 4.0   (mag, through centre)
n0_cal = A_V_target / (2R · 1.65×10⁻³)          (uniform-core equivalent)
profile: Plummer with rflat = 0.25 R, p = 2.0   (generic centrally-
                                                 condensed shape)
```

These defaults are presence-pass cosmetics, not extinction truth —
they only shape silhouettes.

## 5. Substructure noise

> **Status (2026-07-21, A.6 rework):** the client-side octave ladder
> below was superseded before shipping — cloud substructure now comes
> from the data itself, per-cloud isosurface meshes traced from the
> Edenhofer field (§ 9, `scripts/cloud-surfaces/README.md`), and the
> presence shader carries no noise. The model below remains the
> build-side spec: `cloud_model.py` still emits the `noiseModel` block
> (§ 8) so a future volumetric-substructure upgrade (`stellata-5nh`)
> has one calibrated source of truth to pick up.

### 5.1 Physical basis

Supersonic turbulence gives a log-normal volume-density PDF
(Vazquez-Semadeni 1994; Padoan, Nordlund & Jones 1997):
`s = ln(ρ/ρ̄)` is Gaussian with

```
σ_s² = ln(1 + b² M²)        b ≈ 0.4 (mixed forcing; Federrath+ 2010)
```

Class-based Mach numbers (§ 7): dark M ≈ 5 → σ_s ≈ 1.3; sf M ≈ 8 →
σ_s ≈ 1.7; hii M ≈ 10 → σ_s ≈ 1.9. Actively star-forming clouds
additionally develop a high-density power-law tail (Federrath &
Klessen 2013; Kainulainen et al. 2009) — represented in the fine
octaves' ridged shaping, not as a separate PDF term.

### 5.2 The multiplicative field

```
ρ(x) → ρ(x) · exp( σ_s · g(x) − σ_s²/2 )        g clamped to ±2.5σ
```

`g` is a unit-variance octave sum; the `−σ_s²/2` offset makes the
field mean-preserving in expectation, and the clamp bounds the
log-normal tail (the presence integral must stay finite and
band-limited, § 9.1).

The octave ladder is one geometric sequence (lacunarity 2, base
wavelength = the cloud's major diameter, down to ~0.3 pc), evaluated
wholly in the presence-pass shader (§ 1 decision 3). Per-octave
variance follows a turbulence power-law — ratio 2^(3−β) per octave
toward finer scales with β ≈ 2 (supersonic-turbulence density
spectra are shallower than Kolmogorov), so variance concentrates at
small scales. All ladder constants ship in the `noiseModel` block of
`clouds.json` v2 (single source of truth for A.4/A.6):
`{lacunarity, betaSpectral, lambdaMinPc, domainStretchMajor,
noiseClampSigma, ridgedFinestCount, ridgedExponent, sigmaS,
hash: pcg3d, interp: quintic}` — the noise function is
quintic-interpolated lattice value noise under a PCG3D hash,
expressible in GLSL ES 3.0 uint arithmetic.

Seeded per cloud (`seed` in the schema, § 8 — FNV-1a of the raw
Zucker table name) with cloud-local-frame coordinates so the
structure is static and per-cloud distinct.

### 5.3 Filamentary anisotropy

Real substructure is filaments (~0.1 pc characteristic width,
Arzoumanian et al. 2011/2019), not isotropic blobs. Two cheap
shaping terms, both in cloud-local frame:

1. **Domain stretch**: scale the noise domain by 2.5× along the
   major axis before sampling — structures elongate along the cloud.
2. **Ridged transform** on the finest octaves (`ridgedFinestCount`):
   `g_r = 1 − |2g − 1|` sharpened by one squaring — turns smooth
   blobs into ridge/lane structure. For sf/hii classes, raise the
   ridged octaves to the 1.5 power (`ridgedExponent` 3 vs 2) to
   emulate the power-law tail's contrasty cores; dark clouds keep
   the plain ridged form.

This is deliberately a *look* model at the fine end — the epic's
decision 2 accepts procedural substructure for v1, and
`stellata-5nh` tracks real per-cloud data products as the future
upgrade.

## 6. Reddening (A.3)

**Already implemented, single global R_V.** `star.vert.glsl`
accumulates A_V and applies `E(B−V) = A_V / 3.1` as a shift of the
LUT-input B−V — the CCM 1989 diffuse-ISM law. The epic's "current
path appears single-channel; confirm" resolves to: the raymarch is
single-channel in *storage* (one A_V accumulator) but the colour
effect is present. A.3 is therefore **verify + pin + resolve the
R_V upgrade analytically**, not new plumbing:

1. Regression-pin the existing behaviour: synthetic single-cloud
   fixture → assert A_V and the B−V shift to `toBe` precision. Shipped
   as `dust-raymarch-pure.ts` + `dust-raymarch-pure.test.ts` (CPU
   mirror of the decode + integration + `E(B−V) = A_V / R_V`).
2. **Density-dependent R_V — resolved analytically, not shipped.**
   The upgrade would raise R_V from 3.1 toward ~5.5 in dense cores
   (grain growth; Weingartner & Draine 2001; Chapman et al. 2009):

   ```
   E(B−V) = Σ  (dA_V/dl) / R_V(ρ)  · dl
   R_V(ρ) = 3.1 + 2.4 · smoothstep(ρ₁, ρ₂, ρ)
   ρ₁ = 0.01, ρ₂ = 0.08 E_ZGR/pc   (diffuse → core transition)
   ```

   But R_V is a *measured observable* with a known column dependence,
   not a look-knob — so "do cores read over-red?" is answered by the
   numbers, not by eye. Chapman et al. 2009 measure R_V ≈ 3.1–3.5 for
   A_V ≲ 4–5, reaching ~5 only at A_V ≳ 10–18. Our per-star columns
   are voxel-averaged and bounded: the pinned peak (dust manifest
   `zucker` block) is Ophiuchus at A_V = 2.73, everything else ≤ 1.75,
   and the grid-max density (0.135 E_ZGR/pc → 0.37 A_V/pc) makes
   A_V ≳ 4 physically unreachable on any realistic chord (a 1–3 pc
   core can't stack the ~27 pc of peak gas A_V = 10 would need). The
   R_V = 5.5 grain-growth regime is exactly the sub-0.1 pc
   pencil-beam column the 4.88 pc grid deliberately does not resolve
   (§ 2.1). At A_V ≤ 2.73 the measured R_V is ≈ 3.1–3.5, so the global
   R_V = 3.1 is correct to ≲ 0.1 mag of B−V even on the densest core;
   the ρ₂ = 0.08 local-density trigger above would over-correct that
   core's *effective* column-integrated R_V to ~4 and slightly
   *under*-redden it. The constant law is therefore the
   physically-grounded choice at our resolution, and the two-accumulator
   plumbing (RG-channel prepass) is not worth its cost. If the star
   catalog ever gains a sub-pc dust field that reaches A_V ≳ 10, the
   honest refinement is to match the measured R_V(A_V) column relation
   directly — not this local-ρ 5.5-ceiling law. The equation is kept
   here for that contingency.

Out of scope (matches the epic's standing non-goals): full
per-channel RGB extinction curves. The B−V-shift-through-LUT path is
the single source of truth for star colour.

## 7. Taxonomy and embedded stars (A.5)

### 7.1 Classes

```
dark   quiescent / low-mass SF    no stars earlier than B2 inside
sf     active star formation      B2–O9 present, or curated
hii    developed HII region(s)    O / early-B (≤ B1) present, or curated
```

Class drives: default A_V_target (§ 4.3), Mach/σ_s (§ 5.1), fine-
octave shaping (§ 5.3), presence tint + emission (§ 9).

### 7.2 Derivation (build time, A.5)

Cross-match catalog stars against cloud ellipsoids
(point-in-ellipsoid in the cloud local frame, u ≤ 1.1). Keep stars
with spectral type O or B0–B1 (cavity carvers + HII sources) and
B2–B9 (reflection-nebula illuminators, class signal only). The
reader interface is a generic record `{position_pc, spectral_type,
abs_mag}` sourced from the built catalog — **no AT-HYG-specific
columns** — so future 2M-star / Gaia-native catalogs feed the same
cross-match unchanged.

Classification rule: any ≤ B1 star → `hii`; else any B2–B9 or a
curated flag → `sf`; else `dark`. A small curated override table in
`cloud_model.py` handles (a) out-of-grid famous HII regions whose
ionising stars may be missing/too-faint in the catalog (Carina, W3,
W4, W5, M16, M17, Rosette, IC 2944, NGC 6604, Gem OB1), (b) IC 443
(a supernova remnant — treat as `hii` for tinting; one-line note in
the table), (c) any misclassification found during smoke. A.2 seeded
that table with curated classes for the 12 Zucker 2021 clouds too
(Taurus/Chamaeleon/Musca/Pipe/Lupus/Cepheus dark; Ophiuchus/Perseus/
Coraus sf; the three Orion clouds hii) — the A.5 cross-match
supersedes those in-grid entries.

### 7.3 Cavities

Each retained ≤ B1 star carves a cavity. Strömgren radius:

```
R_S = ( 3 Q_H / (4π α_B n²) )^(1/3)      α_B = 2.6×10⁻¹³ cm³ s⁻¹
```

`n` = analytic model density at the star's position (floor
10 cm⁻³). Ionising photon rates, log₁₀ Q_H [s⁻¹] (Martins, Schaerer
& Hillier 2005 for O; Sternberg et al. 2003 for B):

```
O5V 49.3 · O6V 48.9 · O7V 48.6 · O8V 48.3 · O9V 48.0 · B0V 47.6 · B1V 45.7
giants/supergiants: use the same class row +0.3 dex
```

Representative scale: an O6V in n = 100 cm⁻³ gives R_S ≈ 2.9 pc; a
B0V ≈ 1.1 pc. Evolved regions are larger than the instantaneous
Strömgren sphere (D-type expansion, stellar winds) — the λ Ori ring
(≈ 30 pc, Dolan & Mathieu 2002) is the canonical local example and a
validation case: carving it out of the Orion λ ellipsoid should
reproduce the observed ring morphology. So:

```
R_cav = max( R_S , R_curated )     R_curated: Orion Nebula 4 pc,
                                   λ Ori 30 pc, else absent
```

Density modulation (applied in the presence shader; the voxel field
already carries the real cavities — Edenhofer resolves the λ Ori
ring):

```
cavity(x) = [ ε + (1−ε) · smoothstep(0.7 R_cav, 1.15 R_cav, r) ]
            · [ 1 + A_rim · exp( −((r − R_cav)/(0.15 R_cav))² ) ]
ε = 0.05 (interior: ionised, dust largely destroyed/evacuated)
A_rim = 1.0 (swept-up shell ≈ 2× ambient at the rim)
```

The ionisation front itself is razor-thin, but the *visual* cavity
edge is the swept-up shell — finite width, hence the 0.15 R_cav
Gaussian rim rather than a step. Cap at 4 cavities per cloud
(uniform-array budget in the presence shader); merge closer pairs by
taking the larger R_cav.

## 8. Per-cloud parameter schema (`clouds.json` v2)

`version: 2`, shipped by A.2. Existing fields unchanged (`name`,
`id`, `center`, `axes`, `quat`, `source`, `distance`, and `mass` —
which stays Table 3 `mass_nicest`, the literature-comparable display
value). A top-level `noiseModel` block carries the § 5.2 ladder
constants (build-side only — the client no longer decodes it; § 5
status note). New per-cloud fields, all emitted by `build-clouds.py`
from `cloud_model.py`:

```
class        "dark" | "sf" | "hii"
n0Cal        calibrated peak density, cm⁻³            (§ 4.2 / § 4.3)
uEnv         mass-budget envelope tightening, ≤ 1      (§ 4.2)
rflat        Plummer flattening radius, pc
p            Plummer index
sigmaS       total log-normal σ_s                      (§ 5.1)
massLeike    Zucker Table 3 mass_leike, null unless profiled
akPeak       Zucker Table 3 max_ak_leike, null unless profiled
inGrid       true if the cloud lies fully inside ±1250 pc
seed         uint32 noise seed (FNV-1a of the raw table name)
embedded[]   { name, xyz [pc, ICRS], sptype, logQH, rCavPc }  ≤ 4
             (empty until A.5)
```

The loader (`cloud-loader.ts`) versions on `version` (A.2 bumped the
gate; field decoding beyond v1's set landed with A.6). Pinned in
`scripts/clouds/clouds-json.test.ts`.

## 9. Presence pass (A.6) — supersedes the warm glow

Decision: the shelved `cloud.frag.glsl` warm-glow shader is
**replaced**, not re-framed. The renderer machinery around it —
per-instance scaling, premultiplied-alpha material invariant, GLSL3
constraints, picking / focus / warp / search integration — is all
preserved as documented in `src/client/molecular-clouds/README.md`.

Physical grounding: in the optical, a molecular cloud seen from
outside is (a) a *dark patch* occluding the diffuse background (the
Milky Way band, the galactic glow) and (b) essentially invisible
otherwise (real clouds sit at ~21–23 mag/arcsec² of scattered light).
Two **decoupled** components (revised 2026-07-21, with the user —
the original one-raymarch-drives-everything design coupled the
annotation to the physics):

- **Absorption (alpha-over, always on):** per-fragment short raymarch
  through the ellipsoid segment. Traced clouds integrate the
  **per-cloud Edenhofer density brick** (a uint8 3D texture shipped in
  `cloud-surfaces.bin` v2 — the exact volume the rim isosurface was
  traced from, so the shadow and the silhouette agree 1:1, and the
  band dimming is the same pure-Edenhofer physics as the per-star
  raymarch, `A_V = 2.742 · ∫E dl`). Fallback clouds integrate the
  analytic model (Plummer × cavities; no noise — the integrand is
  smooth by construction). Opacity `α = 1 − exp(−0.921 · A_V_ray)`,
  capped at 0.95, emitted as an **alpha-only premultiplied over**
  (rgb = 0). Because the mesh
  renders in the background group — after the Milky Way band but
  before the star passes — the alpha-over correctly dims the MW band
  / galactic glow behind the cloud while leaving stars untouched
  (their dimming comes from the per-star raymarch; no double
  counting). This is the mechanism by which clouds extinct the
  volumetric Milky Way, which deliberately does not sample the voxel
  grid — so it is **physics, never declutter-gated**: it stays on at
  every detail level in realistic mode and hides only in chart mode.
- **Rim silhouette (additive, whisper-level, declutter-gated):** the
  Local Bubble's fresnel-rim treatment (`src/client/fresnel-shell/`,
  shared `stellata_fresnel_rim` chunk + `SHELL_RIM_BLUE`) on a
  per-cloud **isosurface mesh traced from the real Edenhofer field**
  at build time (`scripts/cloud-surfaces/README.md`; clouds the field
  can't resolve fall back to their ellipsoid envelope). The layer is
  an orientation aid for objects you can't actually see, so the
  limb-brightened silhouette reads as annotation rather than luminous
  gas — one shared blue, no class tinting — and it is gated at the
  `representational` declutter floor (`molecularCloudEllipsoids`):
  decluttering to `physical` removes it entirely, leaving pure
  physics. FrontSide + outward winding is the fresnel-shell
  hide-when-inside contract (the rim culls with the camera inside the
  cloud; the BackSide absorption keeps working from inside). Rim
  strength is the shared boundary-shell value (`SHELL_RIM_ALPHA_LIMB`,
  the Local Bubble's — user decision 2026-07-21, revising the earlier
  whisper-level target: one annotation vocabulary beats a per-family
  intensity). Per-cloud silhouette name labels ride the shared
  shell-label engine at the `all` declutter level, screen-size gated.
  Actual HII emission overlays are `stellata-c7u.5.2`'s scope, driven
  by the cavity list.

Chart mode renders the rim meshes as **stippled silhouette outlines**
(the SkyAtlas 2000 nebula convention — an fwidth-scaled contour where
n·v → 0, masked by a screen-space dot grid) and hides the absorption.
All intensity constants land as named uniforms with dev-console
levers, mirroring the existing `stellata.cloudLayer.*` pattern.

### 9.1 Sampling and anti-aliasing — banding is the known failure mode

Precedent: the volumetric Milky Way deliberately does not sample the
Edenhofer voxels because fixed-step marches alias into visible
streaks (`docs/science-galactic-structure.md` § Interstellar dust
extinction; the standing spiral-arm non-goal exists for the same
reason). With the noise ladder retired (§ 5 status note) the
absorption integrand is the smooth analytic Plummer profile — the
heavy-tailed-estimator hazard the original five-rule set defended
against is gone, and the band-limit / texture-role rules (old rules
1–2) retired with it. Three rules remain mandatory:

1. **Static per-pixel ray jitter.** Offset each ray's start by one
   step length scaled by interleaved gradient noise of
   `gl_FragCoord.xy` — cheap, no texture. Do NOT reseed per frame:
   with no temporal accumulation pass, animated jitter reads as
   shimmer; static jitter is stable and camera motion decorrelates
   it naturally.
2. **Output dither.** The whisper rim at 0.05–0.15 intensity spans
   only ~13–38 levels of an 8-bit framebuffer — quantisation
   banding is guaranteed even with a perfect integral. Add
   ±0.5-LSB gradient-noise dither to the final output (both the
   absorption alpha and the rim rgb).
3. **Render-order contract for extinctable layers.** The alpha-over
   dimming reaches only layers drawn *before* the absorption mesh
   (`renderOrder −2`). Every diffuse background the clouds should
   extinct — the MW band, the galactic disc glow, any future HiPS /
   sky-imagery layer — must render earlier in the background group;
   a layer added after the mesh silently escapes extinction. Point
   sources are exempt (per-star raymarch owns them). Recorded in
   `src/client/molecular-clouds/README.md` § Absorption render.

Step count is a dev-console lever; the structure above is not
tunable away.

## 10. Inside-the-cloud experience (A.7)

The mental model is confirmed physics: an observer at the centre of
Taurus sees background stars along cloud-crossing sightlines dimmed
and reddened (many to invisibility), near-peripheral sightlines
barely affected, and an extremely dark ambient sky — dark nebulae
are darker than the airglow-limited night sky on Earth.

Everything falls out of the two mechanisms already specified:

- **Stars:** the per-star raymarch handles camera-inside-cloud
  automatically (the camera→star segment starts inside the dense
  region). The un-clipped Edenhofer encode (§ 2.2) is what makes
  this real.
- **Diffuse background:** the absorption mesh is `BackSide` with an
  analytic ray-envelope segment, so it renders from inside too; with
  the camera inside, each fragment integrates the *outward* column
  in its direction, so the MW band dims anisotropically — darkest
  toward the core, brightest toward the nearest edge. This is the
  correct first-order model of sitting inside an extinction shell.
  (The rim glow — not the absorption — is suppressed inside, § 9.)

A.7 is therefore a verification-and-tuning phase, not new machinery:
fly into Taurus, Ophiuchus (dense, nearby), and the λ Ori ring
(cavity from inside); check the anisotropic darkening, check no
near-plane artefacts on the mesh backfaces, tune the scattered-glow
floor so the inside of a dark cloud doesn't read as fog. Acceptance:
Taurus fly-through shows progressive reddening → disappearance of
background stars through the core direction while Sol-ward periphery
stays populated; no hard mesh seams; presence glow ≤ the darkest MW
band pixels; no crawling bands or shimmer in the dimmed MW band
during a slow orbit with the galactic-core gradient behind the cloud
(the § 9.1 rules exist for exactly this shot).

## 11. Phase map and execution order

Recommended order: **A.2 → A.3 → A.6 → A.4 → A.5 → A.7** (A.6 hosts
the shader framework A.5's cavity carve plugs into; A.4 was
superseded by A.6's real-data shapes).

| Phase | Bead | Scope from this design | Key acceptance |
| --- | --- | --- | --- |
| A.2 (shipped) | c7u.2 | Fixed `DENSITY_MAX` → 0.2 (un-clips the real Edenhofer cores; § 2.2); per-star extinction = pure Edenhofer with the measured evidence retiring the `max(edenhofer, model)` overlay (§ 1 decision 1); calibrated analytic model + taxonomy + `noiseModel` into `clouds.json` v2 (§ 4, § 8); catalog rebuild (de-extinction invariant); `DUST_AV_HEADROOM` removal | 11 pinned `n0Cal`/`uEnv` (`clouds-json.test.ts`); per-cloud peak-column check pinned (`dust-manifest.test.ts`; Ophiuchus 1.03×, Taurus 0.50× of Leike targets); masses within 2× `mass_leike`; idempotent |
| A.3 | c7u.3 | Pin existing A_V + B−V-shift behaviour (`dust-raymarch-pure.ts`); density-dependent R_V upgrade resolved analytically as a no-op at our A_V ≤ 2.73 column ceiling (§ 6), not shipped | Synthetic-cloud fixture pins A_V + B−V shift to `toBe`; constant R_V = 3.1 within ≲ 0.1 mag of the measured R_V(A_V) relation |
| A.4 (superseded) | c7u.4 | Retired before shipping: real-data isosurface shapes (§ 9, `scripts/cloud-surfaces/`) replace the § 5 shader ladder; `noiseModel` stays build-side for the `stellata-5nh` upgrade | Structured, filamentary silhouettes — now from the traced meshes |
| A.5 | c7u.5.x | Generic-reader cross-match; taxonomy + overrides; cavity list into `clouds.json` v2; presence-model cavity carve; HII/reflection tints (5.2) | λ Ori's presence silhouette reads as a ring; Orion A carves around the Trapezium; Taurus stays `dark` with zero cavities |
| A.6 (shipped) | c7u.6 | Replace `cloud.frag.glsl` with two decoupled components (§ 9): always-on alpha-only absorption + declutter-gated fresnel rim on Edenhofer-traced isosurface meshes; § 9.1 rules (static jitter, output dither, render-order contract); `clouds.json` v2 field decoding + `cloud-surfaces.bin`; chart-mode stippled outlines | MW band visibly occluded behind Taurus — at every declutter level — with no banding/shimmer against the galactic-core gradient; rim silhouette barely perceptible and gone at `physical`; chart shows dotted outlines |
| A.7 | c7u.7 | Fly-through verification + tuning (§ 10) | § 10 acceptance list |

Cross-phase invariant: the § 4 model parameters live in **one**
source-of-truth chain — `cloud_model.py` → `clouds.json` v2 → shader
uniforms — never redefined shader-side. (§ 5's noise constants stop at
the `clouds.json` block; nothing downstream reads them today.)

## 12. References

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
