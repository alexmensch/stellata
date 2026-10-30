# Distance refinement and de-extinction

Direction resolution, build-time de-extinction, and the multi-layer
distance-override stack that refines the parallax cascade's inverted
distances.

Five subfolders carry their own topic and their own README: `parallax/`,
which owns the measured parallax every distance inverts; `refinement/`, the
override stack above it and the authoring discipline for adding a layer
(read it before touching the stack); the space-motion velocity's two
fall-backs, `radial-velocity/` and `pm-rescue/`; and `dust/`, the build-time
de-extinction and its cancellation invariant with the runtime march. This
one owns the direction assembly, and the proper motion each direction tier
supplies alongside its own position.

## Files in this area

```
scripts/catalog/distance/
  gaia-astrometry-source.ts       GAIA_ASTROMETRY, GAIA_NSS, HIP2: the
  gaia-nss-source.ts              direction tiers' inputs declared
  hip2-source.ts                  (../../util/sources/), each calling
                                  direction-cascade.ts's parse. HIP2's parse
                                  also lists every HIP the table publishes,
                                  positioned or not, for
                                  ../spine/primaries-tables.ts.
  direction-cascade.ts (+ test)   Per-row sky-direction resolution cascade
                                  (which position source wins, and the
                                  precision each carries) plus the
                                  space-motion velocity assembly. Owns the
                                  one Gaia astrometry row fold: tier 1's own
                                  table reads it whole
                                  (parseGaiaAstrometryCatalogTsv), and the
                                  magnitude term streams its pull through it
                                  with a keep-set (gaiaAstrometryAccumulator,
                                  `../parse/README.md#streaming-a-committed-table`).
  gaia-distrust.ts (+ test)       `gaiaHas5pSolution`, `gaiaRowIs2p` and
                                  `isGaiaCatalogueBibcode` — one predicate per
                                  way this build refuses a Gaia value on a
                                  blended row — and `refusedPublicationCited`, the one skip
                                  rule every courier tier calls (parallax, PM
                                  rescue, rv). Both terms of the velocity
                                  import them, so the radial and the tangential
                                  distrust a row for the same reason and a DR4
                                  release is one edit. `gaiaRowIs2p` is the
                                  condition both skip rules gate on, and reads
                                  a record with no Gaia row as NOT 2p — there
                                  is no fit behind it to distrust. Cascades
                                  hand `gaiaRefusals` the Gaia row itself, so
                                  2p is derived there and nowhere else.
  parallax/                       The measured parallax every distance inverts
                                  — the cascade, its two precision constants,
                                  the bound-sibling index, and the two ledgers
                                  the build commits (/docs/catalog-driver.md#61-record-parity parked rows and the
                                  SIMBAD-sourced exclusion list). Its own
                                  README; refinement/'s override stack sits
                                  above it.
  refinement/                     The override stack — Bailer-Jones, the LMC
                                  kinematic snap, the bounded-scope cutoff —
                                  its authoring discipline, and the
                                  post-build distance-regression check. Its
                                  own README.
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
  placement-lineage-pure.ts       Placement as a lineage stage: its codes,
    (+ test)                      the Placement each manifest row's walk
                                  returns, its one serialiser, and the parked
                                  ledger as a view of its park rows
                                  (../lineage/README.md#the-placement-stage).
  dust/                           Build-time de-extinction against the
                                  dust grid of Edenhofer 2024
                                  (/data/papers/index.md#edenhofer2024), and
                                  the invariant tying it to the runtime
                                  march. Its own README.
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
| `gaia_5p` | Default: the row resolves to a source_id with a 5p row (`data/gaia/gaia_dr3_astrometry_catalog.tsv`, J2016.0) and non-null parallax. | ~<!-- count:build-catalog/directionGaia5p k4 -->930k<!-- /count --> |
| `gaia_2p` | The fall-through for a 2p position-only Gaia row with no HIP2 cover: the Gaia position, no proper motion of its own. | <!-- count:build-catalog/directionGaia2p -->204<!-- /count --> |
| `gaia_nss_systemic` | Source has an NSS two-body orbit AND the 5p fit is flagged unreliable (RUWE / ipd). Same Gaia row values — DR3 refits `gaia_source` to the centre of mass for NSS sources — the tag carries provenance parity with Stage 3. | ~<!-- count:build-catalog/directionGaiaNssSystemic k3 -->32.1k<!-- /count --> |
| `hip2_saturated` | No usable Gaia parallax (no source_id, no 5p row, or parallax NULL) and HIP2 covers the HIP. The Gaia-saturated bright set: Sirius, Vega, α Cen, Capella, … (J1991.25). | ~<!-- count:build-catalog/directionHip2Saturated k2 -->2.3k<!-- /count --> |
| `hip2_pm_discrepant` | Gaia 5p present but Gaia-vs-HIP2 PM disagrees by > 50 mas/yr on either axis — orbit-corrupted 5p PM; HIP2's long baseline is closer to systemic. Unlike Stage 3 there is no ρ ≤ 5″ companion gate (no per-row WDS context at catalog build); the PM discrepancy alone routes. | ~<!-- count:build-catalog/directionHip2PmDiscrepant -->148<!-- /count --> |
| `tycho2` | No Gaia astrometry row AND no HIP2 row, but the record carries a TYC. Tycho-2's **mean** position (`ra_mdeg`/`de_mdeg`), which the catalogue states at J2000. | <!-- count:build-catalog/directionTycho2 -->80<!-- /count --> |
| `cns5` | The above, with no TYC but a `gl` CNS5 carries. CNS5's own coordinates, advanced from the row's own `pos_epoch`. | <!-- count:build-catalog/directionCns5 -->2<!-- /count --> |
| `simbad` | The bottom tier: SIMBAD's bibcoded J2000 coordinates advanced 16 yr on its own bibcoded PM. Gl 863.1A is the corpus exemplar, and the tier's worst mover at 1372 mas/yr. | <!-- count:build-catalog/directionSimbad -->94<!-- /count --> |
| `curated` | Sol alone — it carries no identifier any tier above can key on. The vector is arbitrary and unobservable: Sol's distance is zero, so the walk multiplies it to the origin whatever it points at. | <!-- count:build-catalog/directionCurated -->1<!-- /count --> |

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
wrong, in opposite directions. [Which position to propagate from](/data/tycho2/README.md#which-position-to-propagate-from)
carries the measurement; `directionAtEpoch` is the single form
every tier reaches through `directionOnPm`.

**`resolveDirection` selects a solution; it does not advance one.**
`DirectionSolution` carries the tier's position, its own epoch and its own PM,
and **`directionOnPm`** is the single call that advances it — once, in
`readStars`, on whichever proper motion the row ends up carrying, its tier's or
the rescue cascade's. Only the caller knows which won, so a cascade that
returned a direction would be returning one advanced on a motion the row may
not keep. That single call site is what keeps the position and the velocity
reading one motion ([The proper-motion rescue cascade](#the-proper-motion-rescue-cascade)).

It returns the shared cascade shape (`../cascade-result.ts`): the tier and its
`DirectionSolution`, or `none` — the `no_position` park. A Gaia solution the
cascade passes over is a refusal on the result: `pm_disagrees_with_hip2` on a
`hip2_pm_discrepant` row, `no_5p_solution` on a 2p row HIP2 covers.

| Tier | Epoch of the position it reads |
|---|---|
| `gaia_5p` / `gaia_2p` / `gaia_nss_systemic` | J2016.0 — a zero-Δt no-op |
| `hip2_*` | J1991.25 |
| `tycho2` | J2000 — **measured**: over the 1,145 mean-solution rows with a Gaia-grade SIMBAD place above 100 mas/yr, propagating from J2000 lands a median 0.061″ from it against 1.817″ propagating from `ep_ra`/`ep_de`, whose 1967.77–1991.74 spread is the size of the error that buys |
| `tycho2`, `pflag='X'` rows | J1991.25 — no mean solution exists, so the observed `ra_icrs` is the only position the row has. Their PM comes from `pm-rescue/` instead, and advances this position like any other. <!-- count:build-catalog/directionTycho2FromIcrs -->8<!-- /count --> of the <!-- count:build-catalog/directionTycho2 -->80<!-- /count -->, pinned `directionTycho2FromIcrs` |
| `cns5` | the row's own `pos_epoch` (2016.0 on 5,244 rows, 2000.0 on 406, 1991.25 on 138, 2015.5 on 36, 2016.55 on 3) |
| `simbad` | J2000.0 — **measured, not assumed**: over the 673 catalogue rows carrying both a SIMBAD position and a Gaia PM above 500 mas/yr, SIMBAD's position matches the Gaia one back-propagated to J2000 to a median 0.000″, and not one row is closer to J2016 |

Retiring the printed cell is what bought this: the tier it replaced held
AT-HYG's ra/dec unpropagated, and the worst case in the cohort (Gl 863.1A)
was **49.2″** from the star's J2016 place — 27.3″ because the printed cell
was not really J2000 to begin with, plus 22.0″ of genuine propagation.

Every tier's table is a required input: a missing or unsmudged file fails
the read ([Declaring a source](../../util/sources/README.md#declaring-a-source)),
and the per-route build-counts pins (`directionGaia5p` … `directionCurated`)
hold each tier's share.

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

**[§ 5](/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers)'s validation-independence rule has nothing to exclude here.** It
bites where a SIMBAD tier and a SIMBAD-based validator meet the same
field, and no validator reads a position: `simbad_sample.tsv` carries
`ra` / `dec` / `pmra` / `pmdec` columns, but `validate-simbad-sample.ts`
compares distance alone and the build-time regression check compares a
parallax-derived distance. So the <!-- count:build-catalog/directionSimbad -->94<!-- /count --> simbad-tier rows verify themselves
against nothing. That changes when the distance cascade takes its own
SIMBAD tier, under validators that do check distance.

**Two of the 41 tycho2 rows are a photocentre, not a star.** `pflag='P'`
means Tycho-2's mean solution is the blended light-centre of a double it
never split, so the position is the pair's, and `directionTycho2Photocentre`
pins the count. It is counted rather than gated for the same reason the V
tier's out-of-range colour is: nothing sits below this tier for a TYC-keyed
row, so refusing the position would cost the record rather than improve it.
The same row's V is marked a system blend
([Which tiers give a system blend](../photometry/README.md#which-tiers-give-a-system-blend--vtierissystemblend)).

**The tycho2 tier's corpus row is HD 14039**, reached through the `hd:` ref
kind — its records are by construction the ones Gaia and HIP2 both miss, and not
one of the 41 carries a HIP, a Gaia source_id or a proper name, so the other
three ref kinds cannot name one. It is the tier's highest-PM member, which is
what makes it the row that pins the epoch.

### The escape-speed threshold departs from its source

`GALACTIC_ESCAPE_VELOCITY_KM_S` is 550 against the 533 +54/−41 km/s of
[Piffl 2014](/data/papers/index.md#piffl2014), which is in the Galactic rest frame; the count compares it
against heliocentric space velocities. Nothing records why, and the value
and frame are an open decision (`stellata-uadc.69.13`).

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
zero-Δt no-op. [The rescued motion advances the position too](pm-rescue/README.md#the-rescued-motion-advances-the-position-too)
carries the check that says it lands right, and [Whether the rescuing
source should supply the position too](pm-rescue/README.md#whether-the-rescuing-source-should-supply-the-position-too--no) records why it does not.

`velocityVia` credits the catalogue rather than the route to it, so
`velocityTycho2Pm` **43** counts this cascade's 5 rows alongside the
direction tier's 38.
