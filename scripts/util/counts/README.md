# Counts — the one tally and the staged count snapshot

How a build step counts its outcomes, and the shape its committed count
snapshot takes. Both modules are pure leaves: they import nothing. The
snapshot checks that read the files are the parent folder's
`snapshot-check.ts` and `snapshot_assert.py`
([Util](../README.md)); the comparator is
`../../catalog/build-counts.ts`'s `compareCountSnapshot`.

```
tally-pure.ts (+ test)          fold and its zero case, emptyTallyPartition;
                                prefixed, a tally's keys as snapshot keys.
count-stages-pure.ts (+ test)   The staged snapshot: nestByStage,
                                flattenStages, isStaged, stageOfCounts.
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
(`stageOfCounts`), in that comparator and in `../snapshot_assert.py`'s,
whose `flatten_stages` is this module's Python twin.
