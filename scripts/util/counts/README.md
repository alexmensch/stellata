# Counts — the one tally and the staged count snapshot

How a build step counts its outcomes, and the shape its committed count
and rates snapshots take. The modules are pure: the tally and the staged
snapshot import nothing, the rates snapshot only the staged one. The
snapshot check that reads the files is the parent folder's
`snapshot-check.ts` ([Util](../README.md)); the count comparator is
`../../catalog/build-counts.ts`'s `compareCountSnapshot`.

```
tally-pure.ts (+ test)          fold and its zero case, emptyTallyPartition;
                                prefixed, a tally's keys as snapshot keys;
                                sumOf, a prefixed subset's total;
                                share, a rate that throws on an empty whole.
count-stages-pure.ts (+ test)   The staged snapshot: nestByStage,
                                flattenStages, isStaged, stageOfCounts.
rate-snapshot-pure.ts (+ test)  The staged rates snapshot: rateEntries,
                                refreshedRates, compareRateSnapshot.
```

## The tally

`fold(variants, items, key)` is the one tally: how many items fall under
each declared variant, zeros included, typed `Record<variant, number>` so a
snapshot keyed on a wider union fails to compile; an item outside the
variants throws. Its zero case, `emptyTallyPartition(values)`, is the record
the routing cascades still increment by hand (direction, velocity, V,
distance). Both derive their buckets from the string-literal tuple that
DEFINES the set, so a new variant cannot tally onto an absent key —
`undefined + 1` is NaN, which reaches the pinned count snapshot as a hole
instead of a drift failure. A lineage stage folds its lines through it
([Counts fold from lineage](../../catalog/lineage/README.md#counts-fold-from-lineage)).
`tally-pure.test.ts` pins the fold and all four cascades' key coverage.

## The staged snapshot

`{"stages": {<stage>: {<count>: …}}}`. `nestByStage(flat, {order, of})`
groups a flat count record under each key's stage, stages in the declared
pipeline order and a stage no key reaches left out; `flattenStages` drops
the stage level again — a key two stages share throws — and hands any other
JSON back as it is, so every reader takes both shapes.

A count is addressed by its name alone (`build-catalog/recordCount`), never
its stage: the comparator (`compareCountSnapshot`), `committedBuildCounts`,
the doc figures' snapshot load and `../../site/site-metrics.ts` all flatten
first. The stage still counts as drift: when both sides are staged, a count
filed under another stage than the snapshot's is `moved`
(`stageOfCounts`), in that comparator and the rates one.

## The rates snapshot

A rate is a share, so it drifts by a tolerance, not exactly: each entry is
`{value, tolerance}`, and a build's rate matches when
`|actual − value| / max(|value|, 1e-9) ≤ tolerance`, the committed entry's
tolerance. The compare reads the unrounded rate; a refresh
(`refreshedRates`, `snapshotCheck`'s `refreshTransform`) writes each value
rounded to `RATE_SNAPSHOT_DECIMALS` and keeps each committed tolerance, so a
hand-edited one survives, a new rate taking `DEFAULT_RATE_TOLERANCE`. The
rows are the count compare's: a rate either side lacks drifts, and so does
one filed under another stage. `build:binaries` is the one rates snapshot
([Stage 7](../../binaries/counts/README.md)).
