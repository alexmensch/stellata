# Stage 3 — per-component astrometry

The TypeScript Stage 3 of the binaries pipeline: each side of every
`DecomposedPair` Stage 2 bound (`../resolve/`) gets the most trustworthy
astrometric measurement on file, keyed by its pair. `../build-binaries.ts`
calls it; until the switch, `build:binaries` runs `../build-binaries.py` and
only tests call this
([Porting to TypeScript](../README.md#porting-to-typescript--one-stack-one-switch)).
What each route's gate decides, and why, is the parent README's
([Stage 3](../README.md#stage-3--per-component-astrometry-routing)).

## Files in this area

```
scripts/binaries/astrometry/
  attach-astrometry.ts         attachStage3 (routePairs, then the NSS
                               inner pairs), Stage3Result, stage3Counts,
                               stage3Rates, and the tallies both they and
                               the report read.
  stage3-report-pure.ts        The build-log lines, read off the result.
  routes-pure.ts (+ test)      ComponentAstrometry, ROUTED_VIA,
                               routeAstrometry (the Gaia / HIP2 cascade
                               for one component), minRhoPerSource, and
                               routePairs: the cascade over every pair,
                               then the AT-HYG position fallback.
  nss-inner-pairs-pure.ts      synthesizeNssInnerPairs: a component whose
    (+ test)                   own source carries an NSS orbit while its
                               partner is a different source hosts that
                               orbit on a new sub-pair, one outcome per
                               carrier.
  system-anchors-pure.ts       Each WDS system's first measured parallax,
    (+ test)                   parallax with its error, and proper motion.
```

## The shape of a result

`ComponentAstrometry` is either `unresolved`, carrying nothing, or a
`MeasuredAstrometry`: a position, the measuring catalogue's own epoch
(Gaia J2016.0, HIP2 and AT-HYG J1991.25), and the parallax and proper motion
it states, each null where it states none. A position-only Gaia row with no
HIP2 cover stays `gaia_5p` with a null parallax, so Stage 6 keeps its
position. `routePairs` returns the pairs and a map from each to its
`PairAstrometry`; the map's keys are the returned pairs, not Stage 2's.

## The gates are the catalogue's

The RUWE and ipd_frac_multi_peak indicators (`gaia5pUnreliable`) and the
50 mas/yr PM comparison (`hip2PmDisagrees`) are imported from
`../../catalog/distance/`, so a star both pipelines route goes the same way
in each. Only the 5″ companion gate is Stage 3's own: the catalogue has no
pair to measure ρ on.

## The AT-HYG position fallback

A component the cascade leaves `unresolved` is position-matched against
AT-HYG through Stage 2's `pairAthygMatches`
([The AT-HYG position match](../resolve/README.md#the-at-hyg-position-match)),
with blend inheritance: a secondary whose own predicted match misses takes its
primary's row. The matched row becomes the component's `athygRow` when it had
none, so `routePairs` returns new pairs; a row with no positive distance is
no parallax, and the component stays `unresolved`. The sibling-identity
guard's refusals come back as `siblingClaimed`, each naming the returned
pair's component and the HIP another letter binds; `attachStage3` freezes the
pairs in place, so those references, and the astrometry map's keys, stay the
result's own.

## The NSS inner pairs

What the pass decides, and its gates, is the parent README's
([Sub-pair synthesis](../README.md#sub-pair-synthesis-subdividepy)); the NSS
conversion and regime it gates on are `../orbits/`'s. Each new
`DecomposedPair` is sub-resolution, named one hierarchy level below the
carrier (`A` → `Aa,Ab`, `Aa` → `Aa1,Aa2`), placed at the carrier's position
(none when the carrier has no astrometry), and both its sides take the
carrier's identifiers and its `ComponentAstrometry`. A pair synthesized for
one carrier counts as existing for the next, so two carriers never mint the
same children.

## System anchors

A pair whose own two sides measured nothing still has a distance: its
system's. `systemParallaxes`, `systemParallaxAnchors` and `systemPmAnchors`
each walk the pairs in order and keep, per WDS id, the first side — primary,
then secondary — that measures the quantity, so a later all-unresolved row
reads an earlier row's value. Each quantity picks independently, so a
system's parallax and its proper motion can come from different components.
Stage 4's NSS separation gate reads the parallax
([Stage 4](../README.md#stage-4--orbital-element-selection-per-pair)); Stage 5's
separation-limit and common-proper-motion tests read the other two.

## Counts

`stage3Counts` returns the count-snapshot keys this stage completes, each
folded from the result through the one tally helper: the `astrometry_*`
routes and `synthesized_nss_inner_pairs`, which are its own, and the totals
its NSS inner pairs and AT-HYG fallback add to — `wds_pairs_total`,
`decomposing_pairs`, `components_total`, the `resolution_*` tiers (an inner
pair's children inherit their carrier's tier) and
`athyg_match_sibling_claimed_rejected` (Stage 2's position tier plus this
fallback), typed `Stage3Counts` so a key read is a key returned.
`stage3Rates` derives `gaia_resolve_rate`, over the tiers the codec's
`RESOLVE_VIA_ANCHORS_SOURCE_ID` marks, and `hip2_fallback_rate`. The parent folder's `build-binaries.test.ts`
holds each key to the committed snapshot exactly, and each rate, rounded to
the snapshot's `RATE_SNAPSHOT_DECIMALS`, to its committed value: every input
to a rate is already pinned, so the build's tolerance band would only hide a
formula error.

## Byte identity with the Python stage

- **`minRhoPerSource` reads `findOwningPair`'s row**, the first of the
  discoverer's rows naming the letter on that side, as Stage 2 does
  ([Byte identity](../resolve/README.md#byte-identity-with-the-python-stage)).
- **The fallback's matches are all found before any is applied.** Each
  component's skip reads only its own route, so this equals the Python's
  apply-as-you-go walk.
- **NSS carriers are taken in pair order, primary then secondary**, the
  first of equal depth kept, then synthesized in (WDS id, numeric source_id)
  order.
