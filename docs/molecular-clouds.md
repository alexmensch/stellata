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
the shelved cloud presence layer in `src/client/molecular-clouds/`.

## 1. Architecture

Four decisions, settled with the user (2026-07-03), that revise or
refine the epic's original scoping:

1. **Edenhofer stays the extinction baseline; Zucker is a floor, not
   a replacement.** The Edenhofer volume is a reconstruction of real
   dust and already contains every in-grid cloud. Only the 12
   Zucker 2021 clouds carry density information (fitted Plummer
   profiles + masses + peak A_K); the other 84 Zucker 2020 entries
   are bare centroid+radius spheres. The bake is therefore
   `voxel = max(edenhofer, cloudModel)` for the 12 profiled clouds
   (§ 4), and **no density change** for the 84 spheres — they are
   already present in Edenhofer at better fidelity than a uniform
   sphere. The spheres contribute identity only: name, taxonomy,
   embedded stars, presence-pass geometry. This supersedes the
   epic's "Zucker replaces Edenhofer in overlap regions" — the
   `max()` still guarantees the per-star raymarch is the single
   source of truth for absorption, which was that decision's intent.
2. **Out-of-grid clouds are presence-only.** 18 of 96 clouds extend
   beyond the ±1250 pc voxel cube (Carina 2.5 kpc, IC 2944, L379,
   Maddalena, W3/W4/W5, Gem OB1, M16, M17, Rosette, …). They render
   in the presence pass with the full analytic model but contribute
   no per-star extinction — consistent with stars beyond the cube
   receiving no extinction today. The extinction gap is owned by
   `stellata-ju3` (galactic-arm dust / grid extension); its scoping
   bead carries the hand-off context (Edenhofer's
   `less_data_but_2kpc` flavor covers 14 of the 18).
3. **Coarse noise octaves bake into the voxels; fine octaves render
   in-shader.** The substructure noise ladder (§ 5) splits at the
   voxel Nyquist scale (~10 pc): wavelengths ≥ 10 pc are baked
   mass-conservingly into the extinction field, so stars behind
   large-scale density enhancements genuinely dim more; wavelengths
   below that render only in the presence-pass shader, where the
   grid could never represent them anyway. Same noise function and
   frequency ladder on both sides so the two agree at shared scales.
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
0.38 → **A_V ≈ 1.6 – 3.3 through the densest cores**. That is the
calibration target for the *smooth* baked field. The baked coarse
noise (§ 5) then pushes voxel-to-voxel variance so unlucky sightlines
reach ~2–3× that (≈ 5–9 mag) — physically justified by the log-normal
column-density PDF — and the presence pass's fine octaves convey the
darker sub-beam cores visually. Per-star extinction deliberately does
**not** reach 25 mag: no 4.9 pc-averaged column does.

### 2.2 Encoding ceiling — DENSITY_MAX must rise

Current manifest: `densityMax = 5.33×10⁻³` E_ZGR/pc → max
0.0146 A_V mag/pc → even a 30 pc path of saturated voxels yields only
0.44 mag. The calibrated Taurus core needs peak voxel rates around
0.3 mag/pc (ρ_ZGR ≈ 0.11), ~20× the current ceiling. A.2 raises
`DENSITY_MAX` to **0.15 E_ZGR/pc** (headroom over the computed peak
across all 12 clouds + noise; recompute at bake and assert). Cost:
the 255-step log window widens from 4.73 to 6.18 decades →
quantisation step grows from 4.4 %/step to 5.7 %/step — invisible
against everything downstream. The shader decodes from manifest
constants, so no client change beyond the regenerated data.

Stale-comment sweep for A.2: `star.vert.glsl`'s `DUST_AV_HEADROOM`
comment claims clouds peak at A_V ~1–2 mag; after the bake the
correct statement is ~3–8 mag through the profiled cores. The
prefilter logic itself stays correct (extinction only dims; the
headroom only controls which too-faint stars still pay for the
raymarch) but re-derive whether 1.5 mag is still the right
cost/correctness trade once real columns exist, and rewrite the
comment.

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

## 4. Per-cloud density model

### 4.1 The 12 profiled clouds (Zucker 2021)

Plummer-like profile, parameters from Table 2 (`n0`, `rflat`, `p` —
Plummer columns, not the Gaussian fits):

```
n(x) = n0_cal · (1 + (r_eff(x)/rflat)²)^(−p/2) · envelope(u)
envelope(u) = 1 − smoothstep(0.85, 1.0, u)        # soft edge at bbox
```

`n0_cal` is the calibrated amplitude (§ 4.2), NOT Table 2's `n0`.
Fitted values for reference (Table 2): Taurus n0 = 72.8 cm⁻³,
rflat = 1.2 pc, p = 1.2; Perseus 47.8 / 6.1 / 2.4; Orion B 50.3 /
8.1 / 3.0; etc. Note p ≤ 2 profiles have slowly-converging columns —
all column integrals are taken numerically with the envelope cutoff,
never analytically to infinity.

Baked voxel value (A.2):

```
voxel = max( edenhofer(x), ρ_ZGR(n(x)) · noise_coarse(x) · cavity(x) )
```

`max()` (not `+`) is the double-counting guard: where Edenhofer
already recovered the cloud, the model only fills in what the
reconstruction under-recovers (Edenhofer's posterior mean is biased
low in the densest, most poorly-constrained cores).

### 4.2 Calibration procedure (A.2, per cloud)

1. Compute the model column through the centroid along the shortest
   axis: `N_A_V = ∫ 1.65×10⁻³ · n(l) dl` (numeric, envelope-bounded).
2. Solve `n0_cal` so `N_A_V = max_ak_leike / 0.117` (Table 3).
   Leike-scale values are the resolution-matched truth for a 3D
   grid; NICEST 2D values are sub-beam and would over-darken every
   sightline (§ 2.1).
3. Mass sanity check: `M_model = μ m_H ∫ n dV` with μ = 1.37 per H
   nucleon. Assert `M_model` within a factor of 2 of Table 3
   `mass_leike`. (Expect agreement well inside that — same
   underlying map. `mass_nicest`/`mass_leike` ratios up to 13.7×
   for Orion λ show how resolution moves these numbers; we stay
   internally consistent with Leike/Edenhofer-class resolution.)
4. Assert the peak baked density (including coarse noise) fits under
   the new `DENSITY_MAX` with ≥ 20 % headroom.

Pin all 12 calibrated `n0_cal` values in a vitest snapshot
(`toBe`-style, per the write-time test discipline) so catalog or
constant drift is caught.

### 4.3 The 84 sphere clouds (Zucker 2020)

No density data → **no bake contribution** (Edenhofer already
carries them). The analytic model still needs an amplitude for the
presence pass and for out-of-grid extinction context, so assign a
class-based default column and derive the amplitude from the sphere
radius R:

```
A_V_target(class):  dark 2.0, sf 3.0, hii 4.0   (mag, through centre)
n0_cal = A_V_target / (2R · 1.65×10⁻³)          (uniform-core equivalent)
profile: Plummer with rflat = 0.25 R, p = 2.0   (generic centrally-
                                                 condensed shape)
```

These defaults are presence-pass cosmetics, not extinction truth —
they only shape silhouettes.

## 5. Substructure noise

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
ρ(x) → ρ(x) · exp( σ_s · g(x) − σ_s²/2 )
```

`g` is unit-variance fBm; the `−σ_s²/2` offset makes the field
mean-preserving in expectation. A.2 additionally renormalises each
baked cloud numerically so total mass is *exactly* conserved after
noise + cavities (the log-normal correction is exact only for
infinite samples).

The octave ladder is one geometric sequence (lacunarity 2,
persistence ≈ 0.55, base wavelength = the cloud's major diameter),
**split by rendering surface**:

- **Baked (A.2):** octaves with wavelength ≥ 10 pc (≈ 2 voxels).
  Carries σ_s,coarse — the fraction of total σ_s² in those octaves.
- **Shader (A.4/A.6):** the continuation of the same ladder from
  10 pc down to ~0.3 pc (≈ 5 octaves), carrying the remaining
  variance. Evaluated per-sample in the presence-pass raymarch.

Seeded per cloud (`seed` in the schema, § 8) with world-space
(cloud-local-frame) coordinates so bake and shader sample the same
field where their scales overlap and the structure is static.

### 5.3 Filamentary anisotropy

Real substructure is filaments (~0.1 pc characteristic width,
Arzoumanian et al. 2011/2019), not isotropic blobs. Two cheap
shaping terms, both in cloud-local frame:

1. **Domain stretch**: scale the noise domain by 2.5× along the
   major axis before sampling — structures elongate along the cloud.
2. **Ridged transform** on the two finest baked octaves and all
   shader octaves: `g_r = 1 − |2g − 1|` sharpened by one squaring —
   turns smooth blobs into ridge/lane structure. For sf/hii classes,
   raise the ridged octaves to the 1.5 power to emulate the
   power-law tail's contrasty cores; dark clouds keep the plain
   ridged form.

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
effect is present. A.3 is therefore **verify + pin + one physics
upgrade**, not new plumbing:

1. Regression-pin the existing behaviour: synthetic single-cloud
   fixture → assert A_V and the B−V shift to `toBe` precision.
2. **Density-dependent R_V (the upgrade).** Dense cores have
   R_V ≈ 5.5 from grain growth (Weingartner & Draine 2001; Chapman
   et al. 2009) — same A_V, ~44 % less reddening. Implement as a
   second accumulator in the existing 48-step loop:

   ```
   E(B−V) = Σ  (dA_V/dl) / R_V(ρ)  · dl
   R_V(ρ) = 3.1 + 2.4 · smoothstep(ρ₁, ρ₂, ρ)
   ρ₁ = 0.01, ρ₂ = 0.08 E_ZGR/pc   (diffuse → core transition)
   ```

   Cost: one extra multiply-add per step; no new texture reads.
   Gate on a visual smoke: if the RV = 3.1-everywhere rendering
   already reads correctly through Taurus (no over-red cores), ship
   the constant law and file the upgrade as a follow-up instead —
   the doc records the equation either way.

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
`build-clouds.py` handles (a) out-of-grid famous HII regions whose
ionising stars may be missing/too-faint in the catalog (Carina, W3,
W4, W5, M16, M17, Rosette, IC 2944, NGC 6604, Gem OB1), (b) IC 443
(a supernova remnant — treat as `hii` for tinting; one-line note in
the table), (c) any misclassification found during smoke.

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

Density modulation (applied in both the bake and the presence
shader):

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

`version: 2`. Existing fields unchanged (`name`, `id`, `center`,
`axes`, `quat`, `source`, `distance`). New per-cloud fields, all
baked by `build-clouds.py`:

```
class        "dark" | "sf" | "hii"
n0Cal        calibrated peak density, cm⁻³            (§ 4.2 / § 4.3)
rflat        Plummer flattening radius, pc
p            Plummer index
sigmaS       total log-normal σ_s                      (§ 5.1)
massMsun     Zucker Table 3 mass_leike, null for spheres
akPeak       Zucker Table 3 max_ak_leike, null for spheres
inGrid       true if the ellipsoid lies fully inside ±1250 pc
seed         uint32 noise seed (hash of id)
embedded[]   { name, xyz [pc, ICRS], sptype, logQH, rCavPc }  ≤ 4
```

The loader (`cloud-loader.ts`) versions on `version`; the presence
renderer consumes everything; the A.2 bake consumes the 12 profiled
entries + cavities.

## 9. Presence pass (A.6) — supersedes the warm glow

Decision: the shelved `cloud.frag.glsl` warm-glow shader is
**replaced**, not re-framed. The renderer machinery around it — the
shared ellipsoid mesh, per-instance scaling, premultiplied-alpha
material invariant, GLSL3 constraints, picking / focus / warp /
search integration — is all preserved as documented in
`src/client/molecular-clouds/README.md`.

Physical grounding: in the optical, a molecular cloud seen from
outside is (a) a *dark patch* occluding the diffuse background (the
Milky Way band, the galactic glow) and (b) a very faint
surface-brightness glow from scattered interstellar radiation (real
clouds sit at ~21–23 mag/arcsec²). Two components, one density
integral:

- **Absorption (alpha-over):** per-fragment short raymarch (12–16
  steps) through the ellipsoid segment, sampling the analytic model
  (Plummer × fine-octave noise × cavities). Opacity
  `α = 1 − exp(−0.921 · A_V_ray)`, capped at 0.95. Because the
  cloud mesh renders in the background group — after the Milky Way
  band but before the star passes — the alpha-over correctly dims
  the MW band / galactic glow / grid behind the cloud while leaving
  stars untouched (their dimming comes from the per-star raymarch;
  no double counting). This is the mechanism by which clouds
  extinct the volumetric Milky Way, which deliberately does not
  sample the voxel grid.
- **Scattered-light presence (additive, whisper-level):** the same
  integral drives a faint emissive term so cloud shape reads
  against empty black sky — the epic's "very subtle stylised
  presence". Peak intensity target ≈ 0.05–0.15 of a
  threshold-visible star's glow; must lose to any physical signal.
  Class tinting: dark → neutral warm grey-brown; sf → slightly
  warmer; hii → faint Hα red bias near cavity rims + faint blue
  reflection bias within ~2 pc of B stars. Actual HII emission
  overlays are `stellata-c7u.5.2`'s scope, driven by the same
  cavity list.

Chart mode keeps the existing mono treatment (soft grey, normal
alpha) fed by the new density integral. All intensity constants land
as named uniforms with dev-console levers, mirroring the existing
`stellata.cloudLayer.*` pattern.

### 9.1 Sampling and anti-aliasing — banding is the known failure mode

Precedent: the volumetric Milky Way deliberately does not sample the
Edenhofer voxels because fixed-step marches alias into visible
streaks (`docs/science-galactic-structure.md` § Interstellar dust
extinction; the standing spiral-arm non-goal exists for the same
reason). The presence
raymarch has the same shape — 12–16 steps give step lengths of
1.5–5 pc across typical chords, far past Nyquist for the 0.3 pc
finest octave — plus a second hazard the MW case didn't have: the
noise field is heavy-tailed (log-normal, σ_s up to ~1.9, ridged
fine octaves), so a few jittered samples of the full field have
enormous estimator variance, amplified by the nonlinear
`α = 1 − exp(−0.921 A_V)` output. Naive marching bands; naive
jittered marching shimmers. Five rules, all mandatory in A.6:

1. **Band-limited integral (the role split).** Only octaves with
   wavelength ≥ 2 × step length may contribute *inside* the
   integral — in practice the analytic envelope + the coarse
   (≥ 10 pc) octaves, which are smooth at 16 steps by construction.
   Octave amplitudes fade via `smoothstep` on λ/(2Δ), never a hard
   cut. The column that drives absorption α and glow amplitude is
   therefore always well-sampled.
2. **Fine octaves as bounded texture, not density.** The sub-10 pc
   octaves apply as a single post-integral multiplicative factor
   (evaluated at the densest sample along the ray), clamped to
   [0.6, 1.4]. They add filamentary texture without adding column
   variance — consistent with their § 5.3 status as a look model.
   Octaves below the world-space pixel footprint
   (`d · uFovYRad / viewport.y`) fade out of the texture term too
   (screen-space Nyquist; the detail-floor principle applied
   per-pixel).
3. **Static per-pixel ray jitter.** Offset each ray's start by one
   step length scaled by interleaved gradient noise of
   `gl_FragCoord.xy` — cheap, no texture. Do NOT reseed per frame:
   with no temporal accumulation pass, animated jitter reads as
   shimmer; static jitter is stable and camera motion decorrelates
   it naturally.
4. **Output dither.** The whisper glow at 0.05–0.15 intensity spans
   only ~13–38 levels of an 8-bit framebuffer — quantisation
   banding is guaranteed even with a perfect integral. Add
   ±0.5-LSB gradient-noise dither to the final rgb and α.
5. **Render-order contract for extinctable layers.** The alpha-over
   dimming reaches only layers drawn *before* the presence mesh.
   Every diffuse background the clouds should extinct — the MW
   band, the galactic disc glow, any future HiPS / sky-imagery
   layer — must render earlier in the background group; a layer
   added after the mesh silently escapes extinction. Point sources
   are exempt (per-star raymarch owns them). Record this constraint
   in `src/client/molecular-clouds/README.md` when A.6 lands.

Step count, jitter scale, and the texture-clamp bounds are
dev-console levers; the structure above is not tunable away.

## 10. Inside-the-cloud experience (A.7)

The mental model is confirmed physics: an observer at the centre of
Taurus sees background stars along cloud-crossing sightlines dimmed
and reddened (many to invisibility), near-peripheral sightlines
barely affected, and an extremely dark ambient sky — dark nebulae
are darker than the airglow-limited night sky on Earth.

Everything falls out of the two mechanisms already specified:

- **Stars:** the per-star raymarch handles camera-inside-cloud
  automatically (the camera→star segment starts inside the dense
  region). Bake fidelity (§ 4) is what makes this real.
- **Diffuse background:** the presence mesh is `DoubleSide`; with
  the camera inside, each fragment integrates the *outward* column
  in its direction, so the MW band dims anisotropically — darkest
  toward the core, brightest toward the nearest edge. This is the
  correct first-order model of sitting inside an extinction shell.

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
the shader framework A.4's fine noise and A.5's tints plug into).

| Phase | Bead | Scope from this design | Key acceptance |
| --- | --- | --- | --- |
| A.2 | c7u.2 | Bake `max(edenhofer, model)` for the 12 profiled clouds; coarse noise; cavities (needs A.5's cross-match output *or* ship first pass without cavities and rebake in A.5); raise `DENSITY_MAX` → 0.15; calibration + mass asserts; `DUST_AV_HEADROOM` comment sweep | 12 pinned `n0Cal`; Taurus core column A_V ≈ 3.2 ± 0.3 at bake resolution; masses within 2× `mass_leike`; idempotent |
| A.3 | c7u.3 | Pin existing A_V + B−V-shift behaviour; density-dependent R_V two-accumulator upgrade (visual-gated) | Synthetic-cloud fixture pins; Taurus-core star visibly less over-red with R_V(ρ) if shipped |
| A.4 | c7u.4 | Fine-octave ladder (10 → 0.3 pc) + ridged/anisotropic shaping in the presence shader; shares § 5 constants with the bake via one exported table | Bake and shader agree at 10 pc scale (fixture comparing baked voxel vs shader-evaluated coarse octaves) |
| A.5 | c7u.5.x | Generic-reader cross-match; taxonomy + overrides; cavity list into `clouds.json` v2; rebake with cavities; HII/reflection tints (5.2) | λ Ori renders as a ring; Orion A carves around the Trapezium; Taurus stays `dark` with zero cavities |
| A.6 | c7u.6 | Replace `cloud.frag.glsl` with absorption + whisper-glow model; § 9.1 sampling rules (band-limit, texture role split, static jitter, output dither, render-order contract); `clouds.json` v2 loader; re-enable the layer | MW band visibly occluded behind Taurus with no banding/shimmer against the galactic-core gradient; empty-sky silhouette barely perceptible; chart mode unchanged in spirit |
| A.7 | c7u.7 | Fly-through verification + tuning (§ 10) | § 10 acceptance list |

Cross-phase invariant: § 5's noise constants (ladder, persistence,
stretch, ridged shaping) live in **one** source-of-truth table
consumed by both `build-clouds.py`/`build-dust.py` and the shader
uniform setup — the sibling-symmetry rule applies to the bake/shader
pair.

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
