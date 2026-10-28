# Multi-layer distance refinement

The override stack that refines the parallax cascade's inverted distance
(`../parallax/`), and the post-build check on it. The authoring discipline
below is the load-bearing part of this file — read it before touching the
stack.

## Files in this area

```
scripts/catalog/distance/refinement/
  bailer-jones-source.ts (+ test) BAILER_JONES, Layer 1's posteriors
                                  declared (../../../util/sources/), with
                                  their parse.
  distance-regression-check.ts    Post-build check that no override layer
    (+ test)                      moved a star further than its budget,
                                  pinned by
                                  build-distance-outliers-expected.json.
```

Layers 2 and 3 have no module here: their helpers and constants live in
`../../record/catalog-pure.ts` and `../../parse/stars-parse.ts`, and this
README is their authority.

Every star's final distance is the output of an ordered three-layer
stack run inside `readStars` (`scripts/catalog/parse/stars-parse.ts`). The
order is non-commutative — see [Multi-layer distance refinement](/docs/science-catalog-ingestion.md#multi-layer-distance-refinement)
for the physical rationale; the
diagram below is the build-side view:

```
1000 / resolveParallax(...)          the /docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers parallax cascade — ../parallax/
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
   │                                       AND own parallax ≤ 10σ above LMC's
   ▼
[ Layer 3: MAX_DIST_PC = 50,000 gate ]   drops anything still beyond LMC
   │
   ▼
dist × cascade direction (../README.md#direction-resolution) → `public/catalog.bin` xyz
```

**The stack's input is a parallax this build pulled, and so is its gate.**
Layer 1 fires on the record's own resolved tier (`plxVia`), something this
build knows first-hand; the build-time `plxDistPc` / `plxVia` diagnostics the
regression check below measures drift against are that same cascade's own
output, captured pre-override.

Each override layer returns only a distance — B-J a `number | null`, the
LMC layer an `LmcKinematicVerdict` — and absmag is recomputed from the
settled distance afterwards, because skipping that places the star at
the new distance but lights it at the old one, breaking the disc/glow
size chain in the renderer. Position is assembled afterwards as
`direction × dist` ([Direction resolution](../README.md#direction-resolution)), so the overrides carry
no xyz. Both override helpers (`applyBailerJonesOverride`,
`applyLmcKinematicOverride`) live in `../../record/catalog-pure.ts` so the algebra
is testable in isolation (`../../record/catalog-pure.test.ts`).

**Every `apply*Override` evaluates its own full eligibility.** B-J
self-gates on its map lookup; the LMC layer checks its own sky cone as
well as the PM window. A caller cannot produce an override by forgetting
a gate, so the next layer can be written to either sibling's shape
without inheriting a footgun. Predicates a build-counter also needs
(`isInLmcCone`) stay separately exported — the counter evaluates once per
row, the override re-checks on the handful of rows that reach it.

## Override-layer authoring discipline

An override layer fires on a population keyed by one column and is
*gated* by others. The failure mode is a partition nobody enumerated:
a set of rows the transform reroutes onto a prior whose semantics were
never validated for them. That is how the B-J override once shipped without
a distance-provenance filter and moved ~11 stars carrying a canonical HIP / GJ
distance onto B-J's Galactic-density prior tail (~10–40 kpc at
mid-latitudes).

Any new or changed override layer states, **in the PR description**, an
outcome for every tier in `DIST_VIA_VALUES` — overridden / preserved /
dropped — with the per-tier count from a dry run. The build prints exactly
that line per layer:

```
  LMC kinematic override: <overridden> / <candidates> LMC-cone stars (<pct>%)
    displacing: gaia_dr3_inversion=…, bailer_jones=…, hip2_parallax=…, …
```

The matching assertion lands in the same PR: a per-tier partition field on
`BuildCounts` (`lmcOverriddenByDistVia` is the built example), refreshed into
`build-catalog-expected.json`. Tiers the layer's gate is supposed to exclude
are pinned at **0** — that is the assertion with teeth, because it reads as a
stated invariant rather than whatever the last build produced. The partition's
buckets come from the tuple that DEFINES the tier set (`emptyTallyPartition`,
`../../../util/README.md`), so a tier added later cannot tally onto an absent key
and slip past a layer that never reasoned about it.

Distance provenance is the partition that has bitten us. It is not necessarily
the only one a given layer needs — a layer keyed on proper motion or
cross-match coverage enumerates that dimension too. The rule is to name
the dimensions the gate depends on and count them.

`distance-regression-check.ts` ([Post-build distance-regression check](#post-build-distance-regression-check))
is the after-the-fact detector for the same class of bug; this section is
the write-time complement.

## Layer 1 — Bailer-Jones (DR3) override

`scripts/catalog/build-catalog.ts` swaps the cascade's naive `1 / π`
inversion for the Bayesian posteriors published by
[Bailer-Jones 2021](/data/papers/index.md#bailerjones2021) (CDS I/352).
The pipeline:

1. Load `data/bailer-jones/bailer-jones-dr3.tsv` through `BAILER_JONES`
   (`bailer-jones-source.ts`) into a `Map<source_id, distance_pc>` keyed
   by Gaia DR3 `source_id`, kept as a **string** for the reason
   `data/bailer-jones/README.md` gives. Photogeometric
   `r_med_photogeo` is preferred; `r_med_geo` is the fallback when
   photogeo is absent.
2. During `readStars`, every row with a non-empty `gaia` source_id
   whose parallax cascade resolved `gaia_dr3_inversion` is looked up
   in the map. `isBailerJonesEligible` is the single gate and it reads
   the **resolved tier**, so a record placed by Hipparcos, CNS5,
   Gliese, SIMBAD or a bound sibling is excluded — why, and what the
   prior's ~10–40 kpc tail would cost it: [Consumed by](/data/bailer-jones/README.md#consumed-by).
3. On a hit, `applyBailerJonesOverride` returns
   `{ dist, absmag }` with `absmag = mag − 5·log₁₀(dist / 10)`.
4. Coverage is `bjOverridden / bjEligible`, printed per build and pinned
   in `../../build-catalog-expected.json`, and the **shortfall between the two
   is pinned at zero** as `bjEligibleNotPulled` — [Scope-derived pulls](#scope-derived-pulls--why-the-zero-pin-is-here)
   below.
5. The override also rescues stars the Layer 3 cap would otherwise drop:
   catastrophic-parallax-inversion supergiants whose Bayesian
   distance falls below it.

The posteriors are a required input like every other table. Data refresh:
`pnpm run refresh:bailer-jones`.

## Scope-derived pulls — why the zero pin is here

**An eligible row cannot legitimately lack a posterior.** Eligibility is
`gaia_dr3_inversion`, so the row has its own DR3 parallax and the publication
covers every DR3 source that has one. An absence is this pull's scope — every
source at `G ≤ 11`, plus the exported catalog request below that floor
([The deep population](/scripts/refresh/magnitude/README.md#the-deep-population--a-bounded-leg-plus-a-request-leg)) — having moved, not a gap
upstream.

It slips in the worst direction: the row keeps a naive `1/π`, and rows that
newly gain a binding are disproportionately saturated bright stars with poor
fits — the population the prior exists to moderate. HIP 23617 is the shape,
parallax 1.25 ± 0.83 mas and `RUWE` (Gaia's goodness-of-fit ratio, ~1 being
a clean single-star fit) 19.7, inverting to 800 pc against Hipparcos-2's 171.

The rule, the other gated pulls, and why a forced rebuild cannot substitute:
[The staleness gate](/scripts/refresh/README.md#the-staleness-gate--pin-the-shortfall-never-the-numerator).

## Layer 2 — LMC kinematic override

The [Bailer-Jones 2021](/data/papers/index.md#bailerjones2021)
Galactic-density prior doesn't cover the LMC, so the
LMC supergiants in the catalogue (HDE 268xxx range) land somewhere
intermediate (5–20 kpc) after Layer 1 instead of the LMC's true
~50 kpc. Layer 2 identifies these stars by sky-cone + bulk proper
motion and snaps their distance to the eclipsing-binary anchor in
[Pietrzyński 2019](/data/papers/index.md#pietrzynski2019) (49.59 kpc, shipped as 49.594; the extra digit has
no recorded source, an open decision, `stellata-uadc.69.32`).

Constants in `../../record/catalog-pure.ts`:

| Constant | Value | Meaning |
|---|---|---|
| `LMC_DISTANCE_PC` | 49,594 | LMC centre distance; [Pietrzyński 2019](/data/papers/index.md#pietrzynski2019) print 49.59 kpc. |
| `LMC_CENTRE_RA_HOURS` | 5.25067 (= 78.76°) | LMC PM dynamical centre RA ([van der Marel 2014](/data/papers/index.md#vandermarel2014)). |
| `LMC_CENTRE_DEC_DEG` | −69.19 | LMC PM dynamical centre Dec ([van der Marel 2014](/data/papers/index.md#vandermarel2014)). |
| `LMC_CONE_HALF_ANGLE_DEG` | 15 | Sky-cone half-angle. |
| `LMC_PM_RA_CENTRE` | 1.85 mas/yr | PM gate centre μ_α* (≈ [van der Marel 2014](/data/papers/index.md#vandermarel2014) COM 1.910). |
| `LMC_PM_DEC_CENTRE` | 0.20 mas/yr | PM gate centre μ_δ (≈ [van der Marel 2014](/data/papers/index.md#vandermarel2014) COM 0.229). |
| `LMC_PM_TOLERANCE` | 0.5 mas/yr | Per-axis tolerance around the gate centre. |
| `LMC_PARALLAX_MAS` | 1000 / `LMC_DISTANCE_PC` ≈ 0.0202 mas | The LMC's own parallax, the zero the consistency test measures from. |
| `LMC_PARALLAX_CONSISTENCY_SIGMA` | 10 | Errors above `LMC_PARALLAX_MAS` past which a row's own parallax refuses the snap. |

`isInLmcCone(raHours, decDegrees)` evaluates the cone independently
of the PM gate so `readStars` can count cone-membership candidates
(`lmcCandidates` in `build-catalog-expected.json`) separately from
PM-passing overrides (`lmcOverridden`). At `V ≤ 11` it fires for **<!-- count:build-catalog/lmcOverridden -->111<!-- /count -->
of <!-- count:build-catalog/lmcCandidates -->14,552<!-- /count -->** cone candidates; most of the rest fail the PM tolerance (MW
halo / runaway stars whose PMs sit far from the LMC bulk centroid).

**The PM gate is not a membership test, and the cone is crowded**, so
the snap also asks the record's own resolved parallax (the cascade's
`parallax`, whichever tier supplied it). A row sitting
more than `LMC_PARALLAX_CONSISTENCY_SIGMA` (10) of its own errors above
`LMC_PARALLAX_MAS` (1000 / 49,594 ≈ 0.0202 mas) is a foreground star
sharing the Cloud's apparent motion, and keeps its own distance —
`lmcParallaxRefusedByDistVia`, **<!-- count:build-catalog/lmcParallaxRefusedByDistVia.bailer_jones -->11<!-- /count -->** today, all keeping `bailer_jones` and
every other tier pinned at 0. A parallax with no stated error
cannot contradict, so it snaps.

The threshold sits in a measured gap over every row the cone + PM gate
admits: the <!-- count:build-catalog/lmcOverridden -->111<!-- /count --> genuine members all lie within **3.2σ**, the <!-- count:build-catalog/lmcParallaxRefusedByDistVia.bailer_jones -->11<!-- /count -->
captures at **44.7σ to 338σ** (274 pc to 1,419 pc, every RUWE but one
≤ 1.25). The members' side includes 24 rows whose Gaia DR3 parallax is
negative — consistent with the LMC, but unusable for inversion — so the
cascade resolved them on HIP2 or SIMBAD instead, e.g. HIP 23527 at
4.01 ± 2.34 mas (1.7σ), which inverts to 249 pc — a value whose error
bar, not its inversion, is what the gate reads.

The override **must** run after Layer 1: LMC supergiants typically
carry Gaia source_ids that B-J's map covers, so Layer 1 fires on
them first with a mis-anchored intermediate distance. If Layer 2 ran
first, Layer 1 would clobber its snap back to that intermediate
value. The codepath in `readStars` enforces this by sequencing the
calls; the regression test `../../record/catalog-pure.test.ts` pins the LMC
constants and the override math.

## Layer 3 — MAX_DIST_PC bounded-scope cutoff

`MAX_DIST_PC = 50_000` (exported from `stars-parse.ts`) drops any row
whose final distance still exceeds 50 kpc after Layers 1 and 2. This
is **not** a noise filter — it's a statement about which populations
the model currently represents (Sol out to and including the LMC).
The cutoff bumps in sync with each new modelled population the
renderer takes responsibility for (future SMC, Sgr dSph, M31
supergiant layers would extend it). See [Stellar catalog ingestion](/docs/science-catalog-ingestion.md#stellar-catalog-ingestion)
for the framing rationale.

Every kinematic-override target distance must satisfy
`dist < MAX_DIST_PC` or its entire population is silently dropped at
this cut; `../../record/catalog-pure.test.ts` pins `LMC_DISTANCE_PC <
MAX_DIST_PC` (406 pc of margin today). A future SMC layer (~62 kpc) must raise the
cutoff in the same change.

## Post-build distance-regression check

After the binary is written, `distance-regression-check.ts`
sweeps the catalogue and emits two snapshot sections into
`build-distance-outliers-expected.json` beside it:

- **Self-consistency outliers** — stars whose final distance has drifted from
  their own pre-override inversion (`plxDistPc`) beyond a threshold keyed on
  the tier that supplied it (`SELF_CONSISTENCY_THRESHOLDS` on `plxVia`):
  30× for `gaia_dr3_inversion`, since B-J legitimately re-anchors the low-S/N
  Gaia tail; 3× for every other measured tier, which is parallax-anchored
  ground truth where a shift that large signals an override misfire. The
  curated and `none` tiers and the two override layers themselves are not
  checked — there is no independent input to measure them against.
- **SIMBAD-anchored outliers** — stars whose final distance disagrees
  with SIMBAD's parallax-derived distance by more than 5× on the
  random 10k stratified sample in `data/simbad/simbad_sample.tsv`.

Both sections carry hand-edited `reason` strings ("LMC kinematic snap
legitimate", "ρ Cas yellow hypergiant — SIMBAD's 1/π is the noisy
Hipparcos value") that survive `UPDATE_DISTANCE_OUTLIERS=1` refreshes
via `mergeReasonsFromSnapshot`. A new outlier fails the build until
the snapshot is refreshed and a rationale is filled in; a removed or
changed outlier likewise.
