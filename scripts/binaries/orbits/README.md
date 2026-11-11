# Stage 4 — orbital elements, in TypeScript

The TypeScript Stage 4 of the binaries pipeline: one orbit per
`DecomposedPair` Stage 3 returned (`../astrometry/`), from ORB6, Gaia DR3 NSS
or the MSC, keyed by its pair. The NSS conversion here is also what Stage 3's
NSS inner-pair synthesis gates on. `../build-binaries.ts` calls it; until the
switch, `build:binaries` runs `../build-binaries.py` and only tests call this
([Porting to TypeScript](../README.md#porting-to-typescript--one-stack-one-switch)).
What each route's gate decides, what each NSS solution type constrains, the
Thiele-Innes algebra and why the photocentre's a0 is never the relative orbit's
a, is the parent README's
([Stage 4](../README.md#stage-4--orbital-element-selection-per-pair)).

## Files in this area

```
scripts/binaries/orbits/
  nss-elements-pure.ts (+ test)  OrbitElements; NSS_SOLUTION_KINDS, one
                                 table naming what each solution type's
                                 columns constrain; thieleInnesToCampbell;
                                 nssToCanonicalElements; nssInRegime, the
                                 detectability regime (P < 3 yr or a0 < 1″).
  nss-fixture.ts                 Test-only: tiFromCampbell (the forward
                                 transform) and NSS row builders.
  catalog-elements-pure.ts       ORB6 and MSC rows as OrbitElements (the
    (+ test)                     unit codes, the T0 readings), and
                                 pickBestOrb6 / pickBestMsc among one
                                 pair's rows.
  select-orbit-pure.ts (+ test)  PairOrbit; selectOrbit, the cascade for
                                 one pair; nssSeparationConsistent and
                                 keplerSemimajorAxisAu.
  attach-orbits.ts               attachStage4 (every pair's candidates,
                                 then selectOrbit), Stage4Result,
                                 orbitTally, stage4Counts, stage4Rates.
  stage4-report-pure.ts          The build-log line, read off the result.
```

## The shape of a result

`PairOrbit` is `none`, carrying nothing, or a route of `OrbitViaOnFile` with
its `OrbitElements` — a route with elements never coexists with a null
orbit. The routes, their order and what each carries (`hasElements`, the
legacy `regime`, whether Stage 6 estimates its missing q / ω / a) are one
table in the codec, `ORBIT_VIA_PROPERTIES` (`../multiples-tsv.ts`);
`selectOrbit` walks `ORBIT_VIA_ON_FILE` in that order with one route function
per member, the first to return elements winning. A route whose best row
converts to nothing (an unreadable period) falls through to the next.

`attachStage4` gathers each pair's candidates: its ORB6 rows by (WDS id,
components field), its MSC rows by its tokens with the secondary's WDS
truncation re-anchored (`canonicalCompLetter`), and its system's parallax
([System anchors](../astrometry/README.md#system-anchors)), which the NSS
separation gate reads when neither side measured one. An emitted periastron
epoch outside the plausible window (`../epochs-pure.ts`'s `isPlausibleT0Jd`,
1700–2600) throws in `selectOrbit`. The year and MSC readings refuse one, but
ORB6's `d` / `m` epochs and NSS's `t_periastron` are taken as stated, so a
refresh carrying one outside the window stops the build at Stage 4.

## Counts

`stage4Counts` returns the `orbit_*` keys, one per route, folded through the
one tally helper; `stage4Rates` derives `nss_orbit_rate`, the NSS share of
the pairs with elements. `../build-binaries.test.ts` holds both to the
committed snapshots, as it does Stage 3's
([Counts](../astrometry/README.md#counts)).


## Conventions the port keeps

- **Ω is folded into [0, π)**, ω turned by π with it: the algebra cannot tell
  the ascending node from the descending one, and the fold picks one
  orientation. ω then wraps into [0, 2π) as Python's `%` does (`floorMod`).
- **`t_periastron` counts days from J2016.0**, `GAIA_DR3_REF_EPOCH_JD`,
  derived from `../../catalog/distance/`'s `GAIA_DR3_REF_EPOCH`.
- **`aAu` is always null** for an NSS solution: Stage 6 estimates it from
  Kepler's third law.
- **A solution type the table does not name converts to null**, and a row
  stating neither a period nor a Thiele-Innes quartet is outside the regime.
- **Ties keep Python's winner**: among one grade band, the most recent ref
  year and then the first row (`min`); among MSC rows, the most complete and
  then the last (`>=`).
