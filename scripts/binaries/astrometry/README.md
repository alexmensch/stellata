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
  routes-pure.ts (+ test)      ComponentAstrometry, ROUTED_VIA,
                               routeAstrometry (the Gaia / HIP2 cascade
                               for one component), minRhoPerSource, and
                               routePairs: the cascade over every pair,
                               then the AT-HYG position fallback.
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
guard's refusals come back as `siblingClaimed`.

## Byte identity with the Python stage

- **`minRhoPerSource` reads `findOwningPair`'s row**, the first of the
  discoverer's rows naming the letter on that side, as Stage 2 does
  ([Byte identity](../resolve/README.md#byte-identity-with-the-python-stage)).
- **The fallback's matches are all found before any is applied.** Each
  component's skip reads only its own route, so this equals the Python's
  apply-as-you-go walk.
