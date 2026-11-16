# Lineage storage — format, cost and budgets

How a stage's lineage is stored and what it costs: the file format, each
stage's measured size and write-time budget, and how every stage's lines are
held as strings, spilling to disk while another stage's are held. The row
contract they store is [../README.md](../README.md#row-contract).

```
scripts/catalog/lineage/storage/
  line-spill.ts (+ test)   LineSpill: a stage's lines in a temporary file
                           while another's are held (#holding-lines).
```

`LineageBudget` and the timed window it bounds live in `../stage-lineage.ts`.

## Format and budgets

`build/lineage/<stage>.tsv.gz`: gzip level 1, sorted by key, every record at
every stage, no reduced-detail mode.

A design-time probe on 1M synthetic rows (2026-10-21) chose the format: the
bulk is Gaia ids, which no format compresses much, and Parquet with zstd
came out about 15% smaller at five to nine times the write cost and the
loss of `zgrep`. Its per-stage size is not a sizing figure: plan a new
stage from the measured budgets below, and every build prints its own
(`<stage> lineage: N bytes gzipped`). With `build/lineage.previous/` a
checkout holds about twice the current build, and each new worktree copies
one build's worth in.

The real stages' write time and disk are pinned as a budget: each stage
passes `stageLineage` (`../stage-lineage.ts`) a `LineageBudget`, and a run over
it fails its emission. Membership, measured 2026-11-12 on the full tree:
1,651,103 rows (165 MB plain, 17.4 MB gzipped) plus 975,840 identity rows
(22.3 MB gzipped), 39.6 MB together, 1.4 MB under its budget: a change that
adds a row to every record raises the budget with it. The timed window is everything lineage
adds to the build — the baseline headers' file re-hash, the base's input
re-hash each verdict asks for, producing the lines (`lines`, a function the
window calls: a spill reads back there), the diff, rendering,
gzip and invariants: about 8.2 s with a diff
against a full baseline. The merge-base input re-hash measured 116 ms for
membership on a branch where 34 of its 167 inputs differ (2026-11-15,
`inputHashesAt` over `inputHashes(stepInputPaths('build:membership'))`); a
changed 204 MB LFS input adds its own hash of the local object. The header's input map is not in it: a stage hands
`stageLineage` the input hashes the runner took for its step's stamp before
starting it (`stepInputHashes`, `../../../util/step-input-hashes.ts`), so no
step hashes its own input set. `build:catalog` does hash membership's inputs
from disk, once per build (`upstreamLineage`), to judge membership's header
against the base: 153 paths in 275–352 ms (2026-11-05,
`onDiskHashes(stepInputPaths('build:membership'), {})`), inside the first
catalogue stage's timed window.
A spine derivation's row carries only its winner, route and component
letters; the binding-review columns ride the rows the queue lists — a
contested or collision verdict and a disposition — since the candidates and
refusals are rows of their own. `MEMBERSHIP_LINEAGE_BUDGET` pins 41 MB and
20 s: a CI run that diffs against a restored merge-base baseline took
11.2 s (2026-11-06), against 6.8 s with no diff. Every other stage's
measured budget sits beside its contract: [component-binding's](/scripts/binaries/resolve/README.md#binding-lineage),
[resolve's](/scripts/binaries/resolve/README.md#resolve-lineage),
[astrometry's](/scripts/binaries/astrometry/README.md#astrometry-lineage),
[orbits'](/scripts/binaries/orbits/README.md#orbits-lineage),
[pairs'](/scripts/binaries/README.md#pairs-lineage),
[runtime-pairs'](/scripts/binaries/README.md#runtime-pairs-lineage),
[classic-ids'](../../classic-ids/README.md#classic-id-lineage),
[allocation's](/scripts/sid/README.md#sid-events),
[promotion's](../../companions/promotion-lineage/README.md#promotion-lineage),
[overlap's](../../overlap/README.md#overlap-lineage),
[placement's](../../distance/README.md#placement-lineage),
[brightness-colour's](../../photometry/README.md#brightness-colour-lineage),
[size's](../../spectral/README.md#size-lineage),
[coherence's](../../multiplicity/README.md#coherence-lineage) and
[naming's](../../naming/README.md#naming-lineage). Placement's 349 MB plain outruns
V8's longest string, so stage files and diffs are written and read as UTF-8
bytes in chunks, and the diff walks the baseline a key at a time
(`streamLineage`) rather than holding it.

## Holding lines

A stage that size cannot hold its rows as objects either: 3.9 million
`LineageRow`s, beside the `Placement`s they came from, are about 1.7 GB of
heap. So a stage hands `stageLineage` lines, never rows, and placement,
brightness-colour and size serialise each record to their lines inside the
walk, keeping only the strings; the diff reads the baseline as lines too,
and only a reader that needs fields (trace, a ledger view) decodes them.
Even as strings the three stages' 8.8 million lines (placement 3.9M,
brightness-colour 4.0M, size 0.96M) overrun the heap budget together, so
brightness-colour's and size's go to a `LineSpill` each during the walk and
are read back one stage at a time, once placement's lines are released.
