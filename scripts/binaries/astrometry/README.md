# Stage 3 — per-component astrometry

The TypeScript Stage 3 of the binaries pipeline: each side of every
`DecomposedPair` Stage 2 bound (`../resolve/`) gets the most trustworthy
astrometric measurement on file, keyed by its pair; `../build-binaries.ts`
calls it. What each route's gate decides, and why:
[What each route decides](#what-each-route-decides).

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
  system-anchors-pure.ts       Each WDS system's first measured parallax
    (+ test)                   (with its error) and proper motion.
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

What the pass decides, and its gates, is Stage 1's README's
([Sub-pair synthesis](../load/README.md#sub-pair-synthesis)); the NSS
conversion and regime it gates on are `../orbits/`'s. Each new
`DecomposedPair` is sub-resolution, named one hierarchy level below the
carrier (`A` → `Aa,Ab`, `Aa` → `Aa1,Aa2`), placed at the carrier's position
(none when the carrier has no astrometry), and both its sides take the
carrier's identifiers and its `ComponentAstrometry`. A pair synthesized for
one carrier counts as existing for the next, so two carriers never mint the
same children.

## System anchors

A pair whose own two sides measured nothing still has a distance: its
system's. `systemParallaxAnchors` (the parallax with its error) and
`systemPmAnchors` each walk the pairs in order and keep, per WDS id, the first side — primary,
then secondary — that measures the quantity, so a later all-unresolved row
reads an earlier row's value. Each quantity picks independently, so a
system's parallax and its proper motion can come from different components.
Stage 4's NSS separation gate reads the parallax anchor
([What each route decides](../orbits/README.md#what-each-route-decides)); Stage 5's
separation-limit test reads it with its error, its common-proper-motion test
the PM anchor.

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
`RESOLVE_VIA_ANCHORS_SOURCE_ID` marks, and `hip2_fallback_rate`, each through
`share`, which throws on zero components. The parent folder's `build-binaries.test.ts`
holds each key to the committed snapshot exactly, and each rate, rounded as a
refresh writes it ([The rates snapshot](../../util/counts/README.md#the-rates-snapshot)),
to its committed value: every input to a rate is already pinned, so the
build's tolerance band would only hide a formula error.

## Choices the outputs rest on

- **`minRhoPerSource` reads `findOwningPair`'s row**, the first of the
  discoverer's rows naming the letter on that side, as Stage 2 does
  ([Choices the outputs rest on](../resolve/README.md#choices-the-outputs-rest-on)).
- **The fallback's matches are all found before any is applied.** Each
  component's skip reads only its own route, so the order they apply in
  changes nothing.
- **NSS carriers are taken in pair order, primary then secondary**, the
  first of equal depth kept, then synthesized in (WDS id, numeric source_id)
  order.

## What each route decides

Once a component has a Gaia source_id (or a bare HIP), Stage 3
(`routes-pure.ts`) picks the most trustworthy
astrometric measurement for it. Routes in `ROUTED_VIA`:

| Route | Gate |
| --- | --- |
| `gaia_nss_systemic` | The source_id has an `nss_two_body_orbit` row AND its Gaia 5p solution is flagged unreliable (`ruwe > 1.4` OR `ipd_frac_multi_peak > 2%`). Gaia DR3's `gaia_source` table refits these stars to the centre of mass, so the same row's values surface with the NSS provenance tag, telling Stage 4 to prefer NSS orbital elements over ORB6. |
| `hip2_long_baseline` (orbit-corrupted PM) | The system has any pair with min ρ ≤ 5″ AND `|pmRA_gaia − pmRA_hip2| > 50 mas/yr` OR same on Dec. Hipparcos averages a different window of the orbit than Gaia's 2014–2017 mission baseline; for bright close binaries with both available, HIP2 is closer to the systemic motion. |
| `gaia_5p` | Default. The 5p row is clean and no orbit-correction signal fires. |
| `hip2_long_baseline` (Gaia-saturated) | The component has no usable Gaia parallax — either no Gaia source resolved at all (Sirius A, α Cen, Algol, Procyon) or the Gaia row exists with ra/dec but `parallax=NULL` because Gaia couldn't fit a 5p solution (Castor STF1110 AB). HIP is known and HIP2 covers it; HIP2 is the only parallax source available. |
| `athyg_position` | Post-pass after the Gaia / HIP2 cascade. For components still `unresolved`, the WDS precise_coord position-matches an AT-HYG row (dual-epoch: PM-propagated J1991.25→J2000 then unpropagated for GJ-anchored rows that store ra/dec at J2000). Position comes from the row's stored ra/dec; parallax = 1000/dist_pc. Canonical case: ξ UMa — Gaia source absent from `gaia_dr3_astrometry.tsv` (G≈4.3 saturated), HIP 55203 absent from the committed HIP2 TSV, but AT-HYG carries the GJ-anchored distance 10.42 pc. |
| `unresolved` | None of Gaia 5p, HIP2, or the AT-HYG position-match reach the component. |

The HIP2-discrepancy 5″ gate runs against the **minimum** WDS ρ across
every pair row a source_id participates in. A primary that's in both a
tight AB pair and a wide AC pair always takes the tight ρ, so the same
physical star routes through HIP2 consistently across every pair row of
its system, never differently per row.

Stage 3 reports per-route counts in build log order. `astrometry_via` is
also written to every `multiples.tsv` row in Stage 6 (with a Stage-6-owned
extra value, `system_inherited`, for components that inherit a
system-anchor position because their own row resolved to `unresolved`).
The `athyg_position` route also surfaces the matched AT-HYG row reference
on `ResolvedComponent.athygRow`; Stage 6's photometry / proper-name
lookup consults that reference first, ahead of the gaia / HIP indexes,
so AT-HYG-HD-only rows still surface their absmag / spect / proper name.
