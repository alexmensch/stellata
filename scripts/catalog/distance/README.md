# Distance refinement and de-extinction

Direction resolution, the radial-velocity cascade, build-time
de-extinction, and the multi-layer distance-override stack that refines
AT-HYG's parallax-inverted distances. The authoring discipline for adding
an override layer is the load-bearing part of this file — read it before
touching the stack.

## Files in this area

```
scripts/catalog/distance/
  direction-cascade.ts (+ test)   Per-row sky-direction resolution cascade
                                  (which position source wins, and the
                                  precision each carries), the radial-
                                  velocity cascade, and the space-motion
                                  velocity assembly that consumes both.
  astrometry-fixture.ts           Test-only GaiaAstrometryCatalogRow
                                  builder. A module, not an export from a
                                  test file: three suites across two
                                  folders build these rows, and the point
                                  is that a column added to the interface
                                  lands in one place.
  dust-deextinction.ts (+ test)   Build-time de-extinction against the
    (+ -pure, + pure test)        Edenhofer dust grid; the pure half is
                                  shared with ../companions/.
  distance-regression-check.ts    Post-build check that no override layer
    (+ test)                      moved a star further than its budget,
                                  pinned by
                                  build-distance-outliers-expected.json.
```

## Direction resolution

`direction-cascade.ts` resolves every row's J2000.0 sky direction
through the same trust cascade the binaries pipeline implements in
`scripts/binaries/stage3_astrometry.py`, sharing its thresholds
(RUWE > 1.4, ipd_frac_multi_peak > 2%, |ΔPM| > 50 mas/yr):

| Route | Gate | Rows |
| --- | --- | --- |
| `gaia_5p` | Default: the row resolves to a source_id with a 5p row (`data/gaia/gaia_dr3_astrometry_catalog.tsv`, J2016.0) and non-null parallax. Also the fall-through for 2p position-only rows with no HIP2 cover. | ~300.5k |
| `gaia_nss_systemic` | Source has an NSS two-body orbit AND the 5p fit is flagged unreliable (RUWE / ipd). Same Gaia row values — DR3 refits `gaia_source` to the centre of mass for NSS sources — the tag carries provenance parity with Stage 3. | ~10.0k |
| `hip2_saturated` | No usable Gaia parallax (no source_id, no 5p row, or parallax NULL) and HIP2 covers the HIP. The Gaia-saturated bright set: Sirius, Vega, α Cen, Capella, … (J1991.25). | ~2.5k |
| `hip2_pm_discrepant` | Gaia 5p present but Gaia-vs-HIP2 PM disagrees by > 50 mas/yr on either axis — orbit-corrupted 5p PM; HIP2's long baseline is closer to systemic. Unlike Stage 3 there is no ρ ≤ 5″ companion gate (no per-row WDS context at catalog build); the PM discrepancy alone routes. | ~138 |
| `athyg_printed` | Residual: no Gaia astrometry row AND no HIP2 row. AT-HYG's printed ra/dec as-is, unpropagated — so a high-PM row here is stale by PM × 16 yr against the scene epoch. Sol lands here; Gl 863.1A is the corpus exemplar, and the worst case in the tier at 1372 mas/yr (~27″ stale). ξ UMa used to be the canonical case and no longer is: the spine's backfilled source_id put it on a Gaia 2p anchor, 11″ closer to its true J2016 place. | 61 |

Epoch propagation (`directionAtEpoch`) advances the measured unit
vector to the `CATALOG_SCENE_EPOCH` (J2016.0) linearly along the local
east/north tangent basis and renormalises — exact in cos δ, stable
through the poles, <0.002″ error at Barnard's-scale PM over the 24.75-yr
HIP2 J1991.25→J2016 interval. Gaia rows are native J2016.0 → a zero-Δt
no-op. Radial velocity (perspective acceleration) is deliberately
omitted; the full tuple belongs to future current-epoch propagation.
μ_α* inputs are the cos δ-applied rates straight from Gaia/HIP2 — never
divide by cos δ.

Missing source files degrade tiers gracefully (empty map → cascade
falls through), and the per-route build-counts pins
(`directionGaia5p` … `directionAthygPrinted`) flag the drift.

The sky-position regression corpus (`sky-position-corpus.tsv` +
`sky-position.test.ts`) pins the canonical high-PM set (Barnard's,
Kapteyn's, Groombridge 1830, 61 Cyg A/B, Keid) plus one row per non-Gaia
tier — Sirius + Vega for hip2_saturated, **Gl 863.1A** (HIP 111293, no
Gaia source and absent from HIP2) for athyg_printed, which ξ UMa vacated
when its backfilled source_id reached a Gaia row. Positions are the
**J2016.0** ones (the scene epoch), except the athyg_printed row, whose
whole point is that the tier does not propagate: it pins the printed
~J2000 cell, ~27″ from the star's current place at 1372 mas/yr.
At J2016.0 the Gaia tier is a zero-Δt no-op, so those rows are a
placement / tier-routing pin — a wrong source or xyz-assembly sign
shows up as tens of arcsec. The propagation formula itself (PM sign /
cos δ / Δt-direction) is exercised by the 24.75-yr HIP2 tier and pinned
independently against SIMBAD J2000 in `direction-cascade.test.ts`.

## Radial velocity

`resolveRadialVelocity` supplies the radial term of the space-motion
velocity (`../parse/README.md` § Space-motion velocity), through two tiers:

```
Gaia DR3 radial_velocity   the RVS median, on a 5p row with
                           radial_velocity_error ≤ 20 km/s
  → spine printed `rv`     the catalogue's own cell
```

**The Gaia tier needs a 5p solution, not merely an `rv` cell.** RVS measures the
same window the astrometric fit does, so a 2p row — parallax and PM both
unfitted — is one whose spectrum is a blend of the components, and its median RV
is not the primary's. ξ UMa is the case that fixed the bound: source
756853643638639104 is 2p with `ipd_frac_multi_peak` 24 on a ~2″ pair, and its
`radial_velocity` is −26.78 km/s against the printed −15.9. `gaiaHas5pSolution`
is the same predicate the direction cascade's tier-1 branch turns on, so the
radial term and the tangential term distrust a row for one reason.

**A 5p row is still refused past `GAIA_RV_ERROR_MAX_KM_S` = 20** — the case the
2p condition cannot see (RUWE and `ipd_frac_multi_peak` flag a contaminated
astrometric fit without saying whether the RV survived it; the row's own stated
uncertainty does). A null error passes rather than refuses, the binding gate's
missing-evidence convention; the published catalogue never pairs an rv with a
null error, so the branch is defensive only.

### Where the rv-error bound comes from

Measured over the 259,945 5p rows carrying both a Gaia rv and a printed cell.
The bulk (~258k) has `rv_src = G_R3` — the printed cell IS the Gaia value, so
only the independent remainder can score the disagreement. |Δrv| (km/s) against
the independent printed cell per `radial_velocity_error` bin:

| rv_error | n | p50 | p90 | p99 |
|---|---|---|---|---|
| 0 – 0.5 | 1,061 | 1.9 | 10.5 | 63.8 |
| 0.5 – 1 | 404 | 2.8 | 15.4 | 46.9 |
| 1 – 2 | 283 | 3.8 | 11.6 | 29.0 |
| 2 – 3 | 109 | 4.4 | 14.4 | 30.4 |
| 3 – 5 | 51 | 5.1 | 19.5 | 88.4 |
| 5 – 7 | 25 | 6.7 | 29.4 | 181.1 |
| 7 – 10 | 13 | 11.5 | 26.8 | 28.0 |
| 10 – 15 | 18 | 10.9 | 45.7 | 45.9 |
| 15 – 20 | 7 | 23.9 | 52.2 | 52.2 |
| > 20 | 9 | 4.9 | 155.3 | 155.3 |

Two readings fix the bound:

- **The quoted error is honest.** The median disagreement tracks the stated
  uncertainty roughly 1:1 from ~1 km/s up through the 10–15 bin (the floor at
  ~2–3 km/s in the lowest bins is the printed side's own precision, not the
  transform's — the same shape as the V cascade's faint-end rise).
- **Past ~15–20 the measurement stops informing.** The median disagreement
  (~24 km/s) reaches the local radial-velocity dispersion, so the value no
  longer distinguishes the star from the population prior — and the
  fall-through for a row with no printed cell is a zero radial term, which a
  measurement that noisy does not beat. DR3's own publication ceiling is 40
  (no pulled row exceeds it); there is no published downstream bound to defer
  to, so the measured knee is what applies.

The bound moves 1,340 rows off the Gaia tier: 1,324 fall to a printed cell
that is itself Gaia RVS (identical value — a provenance relabel), 9 to a
genuinely independent printed value, and 7 with no printed cell take the zero
radial term.

**The fall-through is not a degraded copy of the tier above it.** RVS is
magnitude-limited to G_RVS ≲ 14, so it reaches roughly a third of Gaia
sources; the printed cell is the only velocity most of the catalogue has.
The two also largely agree where both exist — the spine's `rv_src` is
already `G_R3` on ~258k rows — so the tier that changes anything is the
catalogued one, which carries the pre-Gaia velocities.

A genuine zero is a velocity, not an absence: the cascade routes on
null-vs-present, never on truthiness, or every star with no measured
line-of-sight motion would fall to the next tier.

Per-tier counts are pinned as `rvGaiaDr3` **264,788** / `rvCatalogued`
**8,459** / `rvNone` **40,010**, the same discipline the direction cascade
pins `directionVia` under. `velocityRvApplied` is **273,237**: the Gaia tier
reaches ~6,300 records whose printed cell was blank. The two reliability
gates hold 1,694 records back from it — the 5p condition 354, the error bound
1,340 — most falling to the printed cell, 181 taking a zero radial term, the
same fall-through as the 40,010 rows RVS never reached.

**The sanity ceiling did not move.** `velocityClamped` stays at **8** and
`velocityAboveEscape` at **45** across the swap — a changed radial term feeds
straight into `v = v_r·û + …`, so a Gaia RV disagreeing wildly with the
printed cell would surface here first. It doesn't, which is the evidence that
the new tier is sane rather than merely present. Note what that pair does NOT
cover: both are ceilings, so they see a 1500 km/s artifact and not the ~11 km/s
error a blended RVS median carries. That is the gate's job, not theirs.

## Build-time de-extinction

AT-HYG `absmag` is `mag − 5·log₁₀(d/10)` with no de-extinction, so it
embeds the real Sol→star extinction A_V; the ~15% of stars without an
Apsis Teff carry the observed (reddened) B−V in `ci` too. The runtime
shader (`star.vert.glsl`) then raymarches the camera→star A_V and adds
it on top — so with the camera at Sol a dusty-sightline star used to
render ≈2·A_V too faint (and tier-3 colours double-reddened): extinction
counted once in the data and once in the raymarch.

The fix de-extincts at build time against **the same encoded dust the
shader raymarches**: `absmag' = absmag − A_map(Sol→star)` and
`ci' = ci − A_map/R_V`, where `A_map` is a converged Sol→star integral
through the Edenhofer voxel grid. Because the source is the same model
the runtime re-adds, at camera=Sol the build subtraction and the runtime
addition cancel identically for every star — map calibration, cube
truncation at 1.25 kpc, and the `avPerDensityPerPc` conversion all cancel
by construction — so rendered `appMag` reproduces the AT-HYG observed
magnitude (the only at-Sol residual is the shader's 48-step quadrature vs
the build's converged integral). Camera-anywhere: from within the cube,
vantages get physically consistent re-lighting.

- `dust-deextinction-pure.ts` — the pure integral + trilinear sampler
  mirroring the GPU decode (`sampleDensityAt`, `avSolToStar`) and the
  shared `R_V`. `dust-deextinction.ts` — `loadDustGrid` assembles
  `data/dust/` (manifest + 64 chunks) into one flat grid; decode
  constants come from the manifest, never redefined.
- Runs inside `readStars` after the distance overrides settle final xyz,
  **before** `physicalRadius` (radii size off the de-extincted, brighter
  absmag — hence the count re-pin) and before companion promotion.
- Promoted companions de-extinct along their own sightline in
  `companion-promotion.ts`, except where the value is already intrinsic:
  a spectral-derived absmag (class→M_V) and a derived ci (Ballesteros /
  solar fallback) are left untouched; observed-photometry absmag and the
  row's own observed ci get the subtraction.
- **Dust data absent at build → HARD FAIL** (`loadDustGrid` throws). The
  Bailer-Jones soft-continue precedent does not apply: a soft-continue
  would ship extincted absmags into a runtime that assumes de-extincted,
  silently reintroducing the double-count.
- Beyond the 1.25 kpc cube the runtime raymarch adds ≈0, so distant
  dusty sightlines stay single-counted (extinction embedded in absmag,
  still exact from Sol) until the raymarch stack is extended.

**Invariant:** the build-time de-extinction integral and the runtime
extinction stack must model the same dust (same maps + slab). Any
runtime-stack change ships with the mirrored build-side integral
extension + a catalog rebuild in the same release. Apsis `azero_gspphot`
(offset 64–67) is a validation cross-check only, never the de-extinction
source — a different estimator than the raymarch would leave a Sol
residual.

## Multi-layer distance refinement

Every star's final distance is the output of an ordered three-layer
stack run inside `readStars` (`scripts/catalog/parse/stars-parse.ts`). The
order is non-commutative — see `docs/science-catalog-ingestion.md`
§ Multi-layer distance refinement for the physical rationale; the
diagram below is the build-side view:

```
AT-HYG `dist` column  (whatever dist_src carries)
   │
   ▼
[ Layer 1: Bailer-Jones DR3 override ]   only for dist_src ∈ {G_R3, G_R2}
   │                                       AND gaia_source_id resolved
   │                                       AND bjMap has the source_id
   ▼
[ HIP2 full-precision re-derivation  ]   only for dist_src = HIP, and only
   │                                       when 1000/plx reproduces AT-HYG's
   │                                       printed dist (± 1e-3 pc) — same
   │                                       value, 4-dp truncation dropped
   ▼
[ Layer 2: LMC kinematic override    ]   only inside 15° LMC cone
   │                                       AND |Δμ_α*|, |Δμ_δ| ≤ 0.5 mas/yr
   ▼
[ Layer 3: MAX_DIST_PC = 50,000 gate ]   drops anything still beyond LMC
   │
   ▼
dist × cascade direction (§ Direction resolution) → `public/catalog.bin` xyz
```

Each override layer returns a `DistanceOverride` (`dist`, `absmag`) —
the absmag recompute matters because skipping it places the star at
the new distance but lights it at the old one, breaking the disc/glow
size chain in the renderer. Position is assembled afterwards as
`direction × dist` (§ Direction resolution), so the overrides carry
no xyz. Both override helpers (`applyBailerJonesOverride`,
`applyLmcKinematicOverride`) live in `catalog-pure.ts` so the algebra
is testable in isolation (`catalog-pure.test.ts`).

**Every `apply*Override` evaluates its own full eligibility.** B-J
self-gates on its map lookup; the LMC layer checks its own sky cone as
well as the PM window. A caller cannot produce an override by forgetting
a gate, so the next layer can be written to either sibling's shape
without inheriting a footgun. Predicates a build-counter also needs
(`isInLmcCone`) stay separately exported — the counter evaluates once per
row, the override re-checks on the handful of rows that reach it.

### Override-layer authoring discipline

An override layer fires on a population keyed by one column and is
*gated* by others. The failure mode is a partition nobody enumerated:
a set of rows the transform reroutes onto a prior whose semantics were
never validated for them. That is how the B-J override shipped without
a `dist_src` filter and moved ~11 stars carrying a canonical HIP / GJ
distance onto B-J's Galactic-density prior tail (~10–40 kpc at
mid-latitudes).

Any new or changed override layer states, **in the PR description**, an
outcome for every `dist_src` bucket in `DIST_SRC_BUCKETS` — overridden /
preserved / dropped — with the per-bucket count from a dry run. The
build prints exactly that line per layer:

```
  Bailer-Jones override: 310157 / 310849 Gaia-inverse-distance stars (99.8%)
    by dist_src: G_R3=310110, G_R2=47, HIP=0, GJ=0, N=0, OTHER=0, UNRECOGNISED=0
```

The matching assertion lands in the same PR: a `DistSrcPartition` field
on `BuildCounts` (`bjOverriddenByDistSrc`, `lmcOverriddenByDistSrc`),
refreshed into `build-catalog-expected.json`. Buckets the layer's gate is
supposed to exclude are pinned at **0** — that is the assertion with
teeth, because it reads as a stated invariant rather than whatever the
last build produced. `UNRECOGNISED` is pinned at 0 on every layer: a
`dist_src` value AT-HYG has never carried must not slip in under the
literal `OTHER` bucket, where no layer has reasoned about it.

`dist_src` is the partition that has bitten us. It is not necessarily
the only one a given layer needs — a layer keyed on proper motion or
cross-match coverage enumerates that dimension too. The rule is to name
the dimensions the gate depends on and count them, not to stop at
`dist_src`.

`distance-regression-check.ts` (§ Post-build distance-regression check)
is the after-the-fact detector for the same class of bug; this section is
the write-time complement.

### Layer 1 — Bailer-Jones (DR3) override

`scripts/catalog/build-catalog.ts` swaps AT-HYG's naive `1 / π`
distances for the Bayesian posteriors published by Bailer-Jones et
al. 2021 (CDS I/352). The pipeline:

1. Load `data/bailer-jones/bailer-jones-dr3.tsv` via
   `parseBailerJonesTsv` into a `Map<source_id, distance_pc>` keyed
   by Gaia DR3 `source_id`. The key is kept as a **string** — Gaia
   source_ids regularly exceed `Number.MAX_SAFE_INTEGER`, so any
   numeric parse would silently corrupt the join. Photogeometric
   `r_med_photogeo` is preferred; `r_med_geo` is the fallback when
   photogeo is absent.
2. During `readStars`, every AT-HYG row with a non-empty `gaia`
   source_id AND `dist_src ∈ {G_R3, G_R2}` is looked up in the map.
   The eligibility predicate `isBailerJonesEligible` is the single
   gate; rows with `dist_src ∈ {HIP, GJ, N, OTHER}` are excluded
   deliberately (their distances are non-Gaia parallaxes B-J would
   silently regress onto its Galactic prior tail).
3. On a hit, `applyBailerJonesOverride` returns
   `{ dist, absmag }` with `absmag = mag − 5·log₁₀(dist / 10)`.
4. The override fires for ~99.5% of Gaia-DR3-bearing AT-HYG rows.
   The residual ~0.5% are source_ids absent from the Bailer-Jones
   publication and keep their AT-HYG values unchanged.
5. The build also rescues ~15 stars previously dropped at Layer 3:
   catastrophic-parallax-inversion supergiants whose Bayesian
   distance falls below the cap.

If `data/bailer-jones/bailer-jones-dr3.tsv` is absent (fresh clone
without LFS pulled), the build logs and continues — every star keeps
its naive AT-HYG distance. Data refresh: `pnpm run refresh:bailer-jones`.

### Layer 2 — LMC kinematic override

Bailer-Jones's Galactic-density prior doesn't cover the LMC, so the
~60 AT-HYG LMC supergiants (HDE 268xxx range) land somewhere
intermediate (5–20 kpc) after Layer 1 instead of the LMC's true
~50 kpc. Layer 2 identifies these stars by sky-cone + bulk proper
motion and snaps their distance to the eclipsing-binary anchor in
Pietrzyński et al. 2019 (49.594 kpc).

Constants in `catalog-pure.ts`:

| Constant | Value | Meaning |
|---|---|---|
| `LMC_DISTANCE_PC` | 49,594 | Pietrzyński 2019 LMC centre-of-mass distance. |
| `LMC_CENTRE_RA_HOURS` | 5.25067 (= 78.76°) | LMC PM dynamical centre RA (vdM&K 2014). |
| `LMC_CENTRE_DEC_DEG` | −69.19 | LMC PM dynamical centre Dec (vdM&K 2014). |
| `LMC_CONE_HALF_ANGLE_DEG` | 15 | Sky-cone half-angle. |
| `LMC_PM_RA_CENTRE` | 1.85 mas/yr | PM gate centre μ_α* (≈ vdM&K 2014 COM 1.910). |
| `LMC_PM_DEC_CENTRE` | 0.20 mas/yr | PM gate centre μ_δ (≈ vdM&K 2014 COM 0.229). |
| `LMC_PM_TOLERANCE` | 0.5 mas/yr | Per-axis tolerance around the gate centre. |

`isInLmcCone(raHours, decDegrees)` evaluates the cone independently
of the PM gate so `readStars` can count cone-membership candidates
(`lmcCandidates` in `build-catalog-expected.json`) separately from
PM-passing overrides (`lmcOverridden`). The override fires for ~54
of ~60 candidates each build; the residual ~6 fail the PM tolerance
(MW halo / runaway stars whose PMs sit far from the LMC bulk
centroid).

The override **must** run after Layer 1: LMC supergiants typically
carry Gaia source_ids that B-J's map covers, so Layer 1 fires on
them first with a mis-anchored intermediate distance. If Layer 2 ran
first, Layer 1 would clobber its snap back to that intermediate
value. The codepath in `readStars` enforces this by sequencing the
calls; the regression test `catalog-pure.test.ts` pins the LMC
constants and the override math.

### Layer 3 — MAX_DIST_PC bounded-scope cutoff

`MAX_DIST_PC = 50_000` (exported from `stars-parse.ts`) drops any row
whose final distance still exceeds 50 kpc after Layers 1 and 2. This
is **not** a noise filter — it's a statement about which populations
the model currently represents (Sol out to and including the LMC).
The cutoff bumps in sync with each new modelled population the
renderer takes responsibility for (future SMC, Sgr dSph, M31
supergiant layers would extend it). See `docs/science-catalog-ingestion.md`
§ Stellar catalog ingestion for the framing rationale.

Every kinematic-override target distance must satisfy
`dist < MAX_DIST_PC` or its entire population is silently dropped at
this cut; `catalog-pure.test.ts` pins `LMC_DISTANCE_PC < MAX_DIST_PC`
(406 pc of margin today). A future SMC layer (~62 kpc) must raise the
cutoff in the same change.

### Post-build distance-regression check

After the binary is written, `scripts/catalog/distance/distance-regression-check.ts`
sweeps the catalogue and emits two snapshot sections into
`scripts/catalog/distance/build-distance-outliers-expected.json`:

- **Self-consistency outliers** — stars whose final distance has
  drifted from their AT-HYG input beyond per-`dist_src` thresholds
  (`HIP`/`GJ`/`N`: 3× ratio; `G_R3`/`G_R2`: 30× ratio since B-J
  legitimately re-anchors low-S/N Gaia parallaxes).
- **SIMBAD-anchored outliers** — stars whose final distance disagrees
  with SIMBAD's parallax-derived distance by more than 5× on the
  random 10k stratified sample in `data/simbad/simbad_sample.tsv`.

Both sections carry hand-edited `reason` strings ("LMC kinematic snap
legitimate", "ρ Cas yellow hypergiant — SIMBAD's 1/π is the noisy
Hipparcos value") that survive `UPDATE_DISTANCE_OUTLIERS=1` refreshes
via `mergeReasonsFromSnapshot`. A new outlier fails the build until
the snapshot is refreshed and a rationale is filled in; a removed or
changed outlier likewise.
