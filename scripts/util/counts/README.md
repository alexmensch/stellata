# Counts — the one tally and the staged count snapshot

How a build step counts its outcomes, the shape its committed count
snapshot takes, and how a build's counts are compared with it. Every module
is pure and imports nothing outside this folder. The snapshot check that
reads the files is the parent folder's `snapshot-check.ts`
([Util](../README.md)), whose `countSnapshotCheck` compares every count
snapshot through `compareCountSnapshot`.

```
tally-pure.ts (+ test)          fold and its zero case, emptyTallyPartition;
                                prefixed and renamed, a tally's keys as
                                snapshot keys;
                                sumOf, a prefixed subset's total;
                                share, a rate or `no-denominator` on an
                                empty whole, never 0; formatShare, its
                                one-decimal percentage, `n/a` when absent;
                                percentOf, the two composed for a log line;
                                formatPartition, a partition's one-line
                                `bucket=n` rundown.
count-stages-pure.ts (+ test)   The staged snapshot: CountBlock and
                                StageBlock, nestByStage, flattenStages,
                                isStaged, stageOfCounts, absentStages.
compare-counts-pure.ts (+ test) The comparator: compareBuildCounts, its
                                CountDiff rows, formatCountDiff, and
                                compareCountSnapshot, the `compare` every
                                count snapshot passes to snapshotCheck.
```

Every build's count check imports the comparator from here, never from a
build's own folder: a build's step inputs take in each non-code file
beside a module it imports (the `*-expected.json` snapshots among them),
so a comparator in another build's folder would make that build's
snapshot an input of this one.

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

`{"stages": {<stage>: {<count>: …}}}`. A stage reaches it as a **count
block** (`CountBlock`), its own typed record — a lineage stage's is its fold
over its live codes
([Counts fold from lineage](../../catalog/lineage/README.md#counts-fold-from-lineage)) —
handed over as a `StageBlock`, so a key's stage is the block that returns
it. `nestByStage(order, blocks)` lays the blocks out in the declared
pipeline order, a stage no block reaches left out, and throws on a block
for an undeclared stage or a stage composed twice.

- **Derived counts** — a stage's counts with no per-row decision (relational
  across records, a post-pass tally) — are a block of their own under
  `<stage>-derived` (`derivedStage`), laid out right after their stage, so
  they keep their names and a key moving between the two is `moved`.
- **An absent input** is a state, never zeros: a block is `counted` or
  `absent`, and an absent one is written as the stage's marker,
  `"<stage>": "absent"` (`ABSENT_STAGE`). It flattens to no key, and the
  comparator reports a stage absent on one side and counted on the other as
  one `absent-input` row rather than a row per count it held.

`flattenStages` drops the stage level again — a key two stages share
throws — and hands any other JSON back as it is, so every reader takes both
shapes.

A count is addressed by its name alone (`build-catalog/recordCount`), never
its stage: the comparator (`compareCountSnapshot`), `committedBuildCounts`,
the doc figures' snapshot load and `../../site/site-metrics.ts` all flatten
first. The stage still counts as drift: when both sides are staged, a count
filed under another stage than the snapshot's is `moved`
(`stageOfCounts`), in that comparator.

## Comparing counts

`compareBuildCounts(expected, actual)` walks the union of both sides' rows:
a count the build stopped producing is as much drift as one the snapshot
never had. A partition-valued count (a `Record<tier, number>`) expands to
one `parent.bucket` row each, so a single drifting bucket names itself.
Rows come in the actual object's order, then the snapshot-only ones. It is
generic over the count record: each value need only be a number or a flat
number partition. `formatCountDiff` lists only the drifted rows, so a fatal
exit keeps the actionable ones on screen.
