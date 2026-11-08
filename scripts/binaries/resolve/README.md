# Stage 2 — WDS components resolved to Gaia DR3 and HIP

The TypeScript Stage 2 of the binaries pipeline: every decomposing pair row
of `../load/`'s `ReferenceCatalogs` split into its two components, each bound
to a Gaia DR3 source and / or a HIP by the cascade, the identity propagations
and the binding-integrity audit, returned as frozen `DecomposedPair`s for
Stage 3. `../build-binaries.ts` calls it; until the switch, `build:binaries`
runs `../build-binaries.py` and only tests call this
([Porting to TypeScript](../README.md#porting-to-typescript--one-stack-one-switch)).
What each tier decides, and why, is the parent README's
([Stage 2](../README.md#stage-2--wds-component--gaia-dr3-source_id),
[Binding-integrity audit](../README.md#binding-integrity-audit-enforced)).

## Files in this area

```
scripts/binaries/resolve/
  resolve-pairs.ts             resolveStage2 (the passes in order) and
                               resolveCascade (the tiers and propagations
                               alone), Stage2Result, astrometryRequestIds,
                               stage2Counts.
  components-pure.ts           ResolvedComponent, DecomposedPair and
                               toDecomposedPairs, the pair walk
                               (decomposingPairs), findOwningPair,
                               RESOLVE_VIA_PRIORITY.
  cascade-pure.ts              The tiers: resolveComponent (ORB6 HIP,
                               AT-HYG-native), resolveViaSimbad,
                               resolveViaCcdm, resolveViaPosition; the
                               sibling-identity rejections they record.
  athyg-match-pure.ts          The AT-HYG position match Stage 3 reuses:
                               the 1° grid, the nearest-row search,
                               pairAthygMatches.
  sibling-identity-pure.ts     HipClaims and the disjoint-letter test the
                               CCDM and position tiers both apply.
  propagate-pure.ts            propagateWithinSystem,
                               propagateBlendIdentity,
                               seedSynthesizedComponentBindings,
                               inheritDownwardParentBindings.
  binding-audit-pure.ts        auditBindingIntegrity (the verdicts) and
                               enforceBindingVerdicts (applying them),
                               bindingIntegrityCounts, addNewestEdge (the
                               pair-geometry graph Stage 6's anchor offsets
                               build too).
  binding-verdicts-tsv.ts      BINDING_VERDICTS_TSV, the codec for
                               build/binding-integrity-verdicts.tsv, and
                               bindingVerdictRow.
  stage2-report-pure.ts        The build-log lines, read off the result.
  spot-check-pure.ts (+ test)  The spot-check's ground-truth rows and its
                               check (#the-spot-check).
  spot-check-source.ts         SPOT_CHECK_GROUND_TRUTH
                               (data/binaries/spot_check_ground_truth.tsv).
  resolve-fixture.ts           Test-only builders: components, indices,
                               the audit's one-system fixtures.
```

Each `*-pure.ts` but `sibling-identity-pure.ts` and `stage2-report-pure.ts`,
and `resolve-pairs.ts` and `binding-verdicts-tsv.ts`, has a co-located
`.test.ts` over fixtures. The real-data cases and the spot-check are the
parent folder's `build-binaries.test.ts`.

## The order of the passes

`resolveStage2` runs them in the Python shell's order, each reading the one
before; every pass takes the components and returns new ones:

1. `resolveComponent` per pair side, pairs in `ReferenceCatalogs.pairs`
   order, primary then secondary.
2. `resolveViaSimbad`, `resolveViaCcdm`, `resolveViaPosition`.
3. `propagateWithinSystem`; `propagateBlendIdentity`, and
   `propagateWithinSystem` again only when that seeded anything.
4. `seedSynthesizedComponentBindings` over the ORB6 orphan and MSC inner
   pairs.
5. `auditBindingIntegrity` over the seeded components, then
   `enforceBindingVerdicts`, which re-runs the propagations over the systems
   it touched.

The components are two per decomposing pair, in pair order, until
`toDecomposedPairs` joins each pair row to its two; `decomposingPairs` throws
if the two ever fall out of step.

## Byte identity with the Python stage

The switch proves `multiples.tsv` byte-identical, so the port keeps the
Python stage's choices where a cleaner one would move a row:

- **`findOwningPair` reads the first matching row**, not the row that produced
  the component: a discoverer's `AB` and `AC` rows both answer for primary
  `A`. The CCDM, position and seeding passes look pairs up this way.
- **Gaia source_ids sort numerically** (`compareSourceIds`) wherever the
  Python sorted them as integers: the audit's source order, a contested
  label, the request file.
- **A rebind keeps the instance's tier.** An instance an earlier verdict
  unbound, which a later verdict rebinds, ends bound with `resolve_via`
  `unresolved` — one component today (05371+2655 A), `stellata-hhaw.45.17.9`.
- **The audit's verdicts are all computed before any is applied.** Every
  verdict reads the per-system context built before enforcement, never a
  component, so this equals the Python's audit-then-apply per system; the
  winner's HIPs are read as enforcement has left them.

## Counts

`stage2Counts` returns the count-snapshot keys this stage's code alone
produces — `ccdm_sibling_owned_rejected` and the seven binding-integrity keys
— folded from the sibling rejections and the verdicts. The snapshot's other
`resolve` keys also count Stage 3's work: `decomposing_pairs` and
`components_total` include the NSS inner pairs Stage 3 appends,
`resolution_*` their inherited tiers, and
`athyg_match_sibling_claimed_rejected` Stage 3's AT-HYG fallback. The
real-data case holds the pair and component totals to the snapshot less the
NSS inner pairs; the rest wait for Stage 3's slice.

`astrometryRequestIds` is the Gaia astrometry request's id set; the
real-data case holds `serialiseSourceIdRequest` of it to the committed
`data/gaia/gaia_astrometry_source_id_request.tsv` byte for byte.

## The spot-check

`data/binaries/spot_check_ground_truth.tsv` names, per curated
`(wds_id, component)`, the tier and Gaia source Stage 2 must reach — or
`absent`, no component at all. The real-data case holds the strongest-tier
instance of each key to it and lists every row it misses, tier and source
separately. A row whose note starts `known_bug:` still has to pass: the note
explains the expectation, it does not excuse a miss.

## The AT-HYG position match

`matchAthygEitherEpoch` tries each candidate PM-propagated from AT-HYG's
J1991.25 to the WDS coordinate epoch first, then as stored: AT-HYG's HIP rows
sit at J1991.25, its GJ rows at J2000 (ξ UMa drifts ~5″ under propagation).
With propagation the grid search widens a cell each way so a high-PM star
stored in a neighbouring cell is still a candidate. Stage 2 calls
`pairAthygMatches` without blend inheritance; Stage 3 calls it with.

## The binding-integrity audit

`auditBindingIntegrity` answers and `enforceBindingVerdicts` acts: the
verdicts are data (counts, the review TSV, the request's audit candidates),
and enforcement is a separate pass over the components. Each verdict carries
its `unbind` targets and, for a decisive letter→sources verdict or an
identity refutation, a `rebind`.
