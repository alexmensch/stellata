# Stage 5 — physical or optical, in TypeScript

The TypeScript Stage 5 of the binaries pipeline: every `DecomposedPair` Stage 3
returned (`../astrometry/`) classified physical or optical, tagged with the tier
that decided, keyed by its pair. `../build-binaries.ts` calls it; until the
switch, `build:binaries` runs `../build-binaries.py` and only tests call this
([Porting to TypeScript](../README.md#porting-to-typescript--one-stack-one-switch)).
What each tier decides, its thresholds and why, is the parent README's
([Stage 5](../README.md#stage-5--optical-pair-filter-cascade)).

## Files in this area

```
scripts/binaries/optical/
  optical-tiers-pure.ts (+ test)  OPTICAL_VIA_PROPERTIES (each tag, in
                                  cascade order, and whether it keeps the
                                  pair); the tier thresholds; each tier's
                                  test; classifyPairOptical, the cascade
                                  for one pair.
  pm-budget-pure.ts               orbitalPmBudgetKmS: the orbital motion a
                                  pair's components carry from the tighter
                                  sub-pairs of their system.
  attach-optical.ts (+ test)      attachStage5 (every pair's context, then
                                  the cascade), Stage5Result, opticalTally,
                                  stage5Counts, stage5Rates.
  stage5-report-pure.ts           The build-log lines, read off the result.
```

## The shape of a result

`Stage5Result.optical` maps each pair to one `OpticalVia` tag. Whether the pair
is kept is the tag's `physical` property in `OPTICAL_VIA_PROPERTIES`, never a
second field, so a verdict and its tag cannot disagree; Stage 6 drops the
pairs whose tag is not physical.

## What each pair is classified on

`attachStage5` gathers, per pair: its Stage 4 orbit route, its Stage 3
astrometry (the CPM tier reads the primary's proper motion and the
secondary's route), its system's parallax and proper-motion anchors
([System anchors](../astrometry/README.md#system-anchors)), its total mass,
and its orbital-PM budget. The masses are an input, computed once before the
stage (`../masses/`).

The parallax tiers (separation limit, both-Gaia, asymmetric) read each side's
own Gaia 5p row and HIP2 row from the identifier indices, not the route Stage
3 picked. Stage 3's HIP2 substitution for an orbit-perturbed Gaia proper
motion therefore does not reach the escape-velocity gate; whether it should is
`stellata-hhaw.45.17.13`, open.

## Counts

`stage5Counts` returns the twelve `optical_*` keys, one per tag, folded
through the one tally helper; `stage5Rates` derives `optical_rejected_rate`,
the rejecting tags over every classified pair, through `share`. The parent
folder's `build-binaries.test.ts` holds both to the committed snapshots, as it
does Stage 4's ([Counts](../orbits/README.md#counts)).

## Byte identity with the Python stage

- **Constants come from `src/astro-core/`**: `AU_PER_PC` at full precision,
  where the Python truncates it to 206,264.806, and `KM_S_PER_AU_YR` derived
  from the AU and the Julian year, where the Python writes 4.740470446. Every
  count still matches the snapshot.
- **The budget walks the system's pairs in pair order**, summing as the
  Python does.
