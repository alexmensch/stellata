# Distance refinement and de-extinction

Direction resolution, build-time de-extinction, and the multi-layer
distance-override stack that refines AT-HYG's parallax-inverted distances.
The authoring discipline for adding an override layer is the load-bearing
part of this file — read it before touching the stack.

Three subfolders carry their own cascade and their own README: `parallax/`,
which owns the measured parallax every distance inverts and is where this
stack's input comes from, plus the space-motion velocity's two fall-backs,
`radial-velocity/` and `pm-rescue/`. This one owns the assembly, and the
proper motion each direction tier supplies alongside its own position.

## Files in this area

```
scripts/catalog/distance/
  direction-cascade.ts (+ test)   Per-row sky-direction resolution cascade
                                  (which position source wins, and the
                                  precision each carries) plus the
                                  space-motion velocity assembly.
  gaia-distrust.ts (+ test)       `gaiaHas5pSolution`, `gaiaRowIs2p` and
                                  `isGaiaCatalogueBibcode` — one predicate per
                                  way this build refuses a Gaia value on a
                                  blended row. Both terms of the velocity
                                  import them, so the radial and the tangential
                                  distrust a row for the same reason and a DR4
                                  release is one edit. `gaiaRowIs2p` is the
                                  condition both skip rules gate on, and reads
                                  a record with no Gaia row as NOT 2p — there
                                  is no fit behind it to distrust.
  parallax/                       The measured parallax every distance inverts
                                  — the cascade, its two precision constants,
                                  the bound-sibling index, and the two ledgers
                                  the build commits (§ 6.1 parked rows and the
                                  SIMBAD-sourced exclusion list). Its own
                                  README; this file's override stack sits above
                                  it.
  pm-rescue/                      The proper motion for a row whose direction
                                  tier carries none, carrying both the velocity
                                  and that tier's epoch advance. Its own README.
  radial-velocity/                The radial-velocity cascade and the
                                  Gaia-bibcode skip rule, with its own
                                  README.
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

`direction-cascade.ts` resolves every row's sky direction on ICRS axes at
the J2016.0 scene epoch — every tier propagates its own solution there, so
the epoch of the output is the scene's, never the source's — through the
same trust cascade the binaries pipeline implements in
`scripts/binaries/stage3_astrometry.py`, sharing its thresholds
(RUWE > 1.4, ipd_frac_multi_peak > 2%, |ΔPM| > 50 mas/yr):

| Route | Gate | Rows |
| --- | --- | --- |
| `gaia_5p` | Default: the row resolves to a source_id with a 5p row (`data/gaia/gaia_dr3_astrometry_catalog.tsv`, J2016.0) and non-null parallax. Also the fall-through for 2p position-only rows with no HIP2 cover. | ~300.5k |
| `gaia_nss_systemic` | Source has an NSS two-body orbit AND the 5p fit is flagged unreliable (RUWE / ipd). Same Gaia row values — DR3 refits `gaia_source` to the centre of mass for NSS sources — the tag carries provenance parity with Stage 3. | ~10.0k |
| `hip2_saturated` | No usable Gaia parallax (no source_id, no 5p row, or parallax NULL) and HIP2 covers the HIP. The Gaia-saturated bright set: Sirius, Vega, α Cen, Capella, … (J1991.25). | ~2.5k |
| `hip2_pm_discrepant` | Gaia 5p present but Gaia-vs-HIP2 PM disagrees by > 50 mas/yr on either axis — orbit-corrupted 5p PM; HIP2's long baseline is closer to systemic. Unlike Stage 3 there is no ρ ≤ 5″ companion gate (no per-row WDS context at catalog build); the PM discrepancy alone routes. | ~138 |
| `tycho2` | No Gaia astrometry row AND no HIP2 row, but the record carries a TYC. Tycho-2's **mean** position (`ra_mdeg`/`de_mdeg`), which the catalogue states at J2000. | 41 |
| `cns5` | The above, with no TYC but a `gl` CNS5 carries. CNS5's own coordinates, advanced from the row's own `pos_epoch`. | 4 |
| `simbad` | The bottom tier: SIMBAD's bibcoded J2000 coordinates advanced 16 yr on its own bibcoded PM. Gl 863.1A is the corpus exemplar, and the tier's worst mover at 1372 mas/yr. | 13 |
| `curated` | Sol alone — it carries no identifier any tier above can key on. The vector is arbitrary and unobservable: Sol's distance is zero, so the walk multiplies it to the origin whatever it points at. | 1 |

Epoch propagation advances the measured unit vector to the
`CATALOG_SCENE_EPOCH` (J2016.0) linearly along the local east/north
tangent basis and renormalises — exact in cos δ, stable
through the poles, <0.002″ error at Barnard's-scale PM over the 24.75-yr
HIP2 J1991.25→J2016 interval. Gaia rows are native J2016.0 → a zero-Δt
no-op. Radial velocity (perspective acceleration) is deliberately
omitted; the full tuple belongs to future current-epoch propagation.
μ_α* inputs are the cos δ-applied rates straight from the tier — never
divide by cos δ.

**Every tier states its own epoch, and it is measured rather than assumed.**
The two Tycho-2 cells were the trap: `ra_mdeg` is stated at J2000 while
`ep_ra`/`ep_de` date the OBSERVATIONS behind it, and `ra_icrs` is the observed
position at J1991.25 — so reading either epoch off the column beside it is
wrong, in opposite directions. `data/tycho2/README.md` § Which position to
propagate from carries the measurement; `directionAtEpoch` is the single form
every tier reaches through `directionOnPm`.

**`resolveDirection` selects a solution; it does not advance one.**
`DirectionSolution` carries the tier's position, its own epoch and its own PM,
and **`directionOnPm`** is the single call that advances it — once, in
`readStars`, on whichever proper motion the row ends up carrying, its tier's or
the rescue cascade's. Only the caller knows which won, so a cascade that
returned a direction would be returning one advanced on a motion the row may
not keep. That single call site is what keeps the position and the velocity
reading one motion (§ The proper-motion rescue cascade).

| Tier | Epoch of the position it reads |
|---|---|
| `gaia_5p` / `gaia_nss_systemic` | J2016.0 — a zero-Δt no-op |
| `hip2_*` | J1991.25 |
| `tycho2` | J2000 — **measured**: over the 1,145 mean-solution rows with a Gaia-grade SIMBAD place above 100 mas/yr, propagating from J2000 lands a median 0.061″ from it against 1.817″ propagating from `ep_ra`/`ep_de`, whose 1967.77–1991.74 spread is the size of the error that buys |
| `tycho2`, `pflag='X'` rows | J1991.25 — no mean solution exists, so the observed `ra_icrs` is the only position the row has. Their PM comes from `pm-rescue/` instead, and advances this position like any other. 3 of the 41, pinned `directionTycho2FromIcrs` |
| `cns5` | the row's own `pos_epoch` (2016.0 on 5,244 rows, 2000.0 on 406, 1991.25 on 138, 2015.5 on 36, 2016.55 on 3) |
| `simbad` | J2000.0 — **measured, not assumed**: over the 673 catalogue rows carrying both a SIMBAD position and a Gaia PM above 500 mas/yr, SIMBAD's position matches the Gaia one back-propagated to J2000 to a median 0.000″, and not one row is closer to J2016 |

Retiring the printed cell is what bought this: the tier it replaced held
AT-HYG's ra/dec unpropagated, and the worst case in the cohort (Gl 863.1A)
was **49.2″** from the star's J2016 place — 27.3″ because the printed cell
was not really J2000 to begin with, plus 22.0″ of genuine propagation.

Missing source files degrade tiers gracefully (empty map → cascade
falls through), and the per-route build-counts pins
(`directionGaia5p` … `directionCurated`) flag the drift.

The sky-position regression corpus (`sky-position-corpus.tsv` +
`sky-position.test.ts`) pins the canonical high-PM set (Barnard's,
Kapteyn's, Groombridge 1830, 61 Cyg A/B, Keid) plus one row per non-Gaia
tier — Sirius + Vega for hip2_saturated, **Gl 863.1A** (HIP 111293, no
Gaia source and absent from HIP2) for simbad, which ξ UMa vacated when
its backfilled source_id reached a Gaia row. Every position is now the
**J2016.0** one: the corpus no longer carries an unpropagated row, and
Gl 863.1A's was re-pinned 49.2″ when its tier changed. At J2016.0 the
Gaia tier is a zero-Δt no-op, so those rows are a placement /
tier-routing pin — a wrong source or xyz-assembly sign shows up as tens
of arcsec. The propagation formula itself (PM sign / cos δ /
Δt-direction) is exercised by the 24.75-yr HIP2 tier and pinned
independently against SIMBAD J2000 in `direction-cascade.test.ts`.

**§ 5's validation-independence rule has nothing to exclude here.** It
bites where a SIMBAD tier and a SIMBAD-based validator meet the same
field, and no validator reads a position: `simbad_sample.tsv` carries
`ra` / `dec` / `pmra` / `pmdec` columns, but `validate-simbad-sample.ts`
compares distance alone and the build-time regression check compares a
parallax-derived distance. So the 13 simbad-tier rows verify themselves
against nothing. That changes when the distance cascade takes its own
SIMBAD tier, under validators that do check distance.

**Two of the 41 tycho2 rows are a photocentre, not a star.** `pflag='P'`
means Tycho-2's mean solution is the blended light-centre of a double it
never split, so the position is the pair's, and `directionTycho2Photocentre`
pins the count. It is counted rather than gated for the same reason the V
tier's out-of-range colour is: nothing sits below this tier for a TYC-keyed
row, so refusing the position would cost the record rather than improve it.
The same row's V is marked a system blend
(`../photometry/README.md` § Which tiers give a system blend).

**The tycho2 tier's corpus row is HD 14039**, reached through the `hd:` ref
kind — its records are by construction the ones Gaia and HIP2 both miss, and not
one of the 41 carries a HIP, a Gaia source_id or a proper name, so the other
three ref kinds cannot name one. It is the tier's highest-PM member, which is
what makes it the row that pins the epoch.

## The proper-motion rescue cascade

The direction cascade leaves **39** rows without a PM — 36 on a Gaia 2p
(position-only) solution with no HIP2 cover, 3 on a Tycho-2 row with no mean
solution. `pm-rescue/` re-keys those on the record's own designations rather
than shipping them static. Its README carries the routing, why an owned PM on a
blend is admissible at all, and the Gaia-bibcode skip rule's 13-row cost.

**The rescued motion advances the position as well as the velocity**, through
the same `directionOnPm` every tier's own PM goes through, so no row tracks a
rate from a place its tier left stale. Only the 3 Tycho-2 rows move (2.337″ /
0.149″ / 0.109″); the 36 Gaia rows are native J2016.0 and the advance is a
zero-Δt no-op. `pm-rescue/README.md` § The rescued motion advances the position
too carries the check that says it lands right, and § Whether the rescuing
source should supply the position too records why it does not.

`velocityVia` credits the catalogue rather than the route to it, so
`velocityTycho2Pm` **43** counts this cascade's 5 rows alongside the
direction tier's 38.

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
1000 / resolveParallax(...)          the § 5 parallax cascade — parallax/
   │                                   README.md. No owned parallax parks the
   │                                   row: it builds no record at all.
   ▼
[ Layer 1: Bailer-Jones DR3 override ]   only where the cascade resolved
   │                                       gaia_dr3_inversion (its posterior
   │                                       treats that measurement)
   │                                       AND bjMap has the source_id
   ▼
[ Layer 2: LMC kinematic override    ]   only inside 15° LMC cone
   │                                       AND |Δμ_α*|, |Δμ_δ| ≤ 0.5 mas/yr
   ▼
[ Layer 3: MAX_DIST_PC = 50,000 gate ]   drops anything still beyond LMC
   │
   ▼
dist × cascade direction (§ Direction resolution) → `public/catalog.bin` xyz
```

**The stack's input is a parallax this build pulled, not a printed cell.**
The spine's `dist` / `dist_src` columns survive only as the build-time
diagnostic the regression check below measures drift against. Layer 1's gate
moved with it: it used to read `dist_src ∈ {G_R3, G_R2}`, which let an AT-HYG
editorial value decide whether a record was regressed onto B-J's
Galactic-density prior. It now reads the record's own resolved tier, which is
something this build knows first-hand.

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
  Bailer-Jones override: 310124 / 310299 Gaia-inverse-distance stars (99.9%)
    by dist_src: G_R3=310110, G_R2=13, HIP=1, GJ=0, N=0, OTHER=0, UNRECOGNISED=0
```

Those buckets are no longer the layer's *gate*, only its outcome — the gate
reads the resolved tier — which is why HIP is now 1 rather than pinned at 0:
a record AT-HYG marked `HIP` whose own Gaia 5p parallax the cascade took is
exactly the case the re-key exists to serve.

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
2. During `readStars`, every row with a non-empty `gaia` source_id
   whose parallax cascade resolved `gaia_dr3_inversion` is looked up
   in the map. The eligibility predicate `isBailerJonesEligible` is
   the single gate, and it reads the **resolved tier** — a record
   whose distance rests on Hipparcos, CNS5, Gliese, SIMBAD or a bound
   sibling is excluded deliberately, since B-J publishes a posterior
   over a *Gaia* parallax and applying it elsewhere discards a
   measurement for one computed from a different, worse one (the
   Galactic prior tail, ~10–40 kpc). It used to gate on the spine's
   `dist_src` cell instead — an AT-HYG editorial value standing in for
   the question — which is what § Multi-layer distance refinement
   means by the gate having moved with the printed cell.
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
