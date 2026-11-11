# Stage 7 — the count and rates snapshots

Every count and rate `build:binaries` pins, composed from the stages' own
count functions and filed under the stage of the snapshot that holds it:
`../build-binaries-expected.json` (counts, exact) and
`../build-binaries-rates-expected.json` (rates, within a tolerance;
[The rates snapshot](../../util/counts/README.md#the-rates-snapshot)). The
shell hands both to `emitArtifacts` as snapshot checks, so a count or rate
that drifts writes nothing ([Pipeline at a glance](../README.md#pipeline-at-a-glance)).

## Files in this area

```
scripts/binaries/counts/
  binaries-counts.ts   binariesCounts and binariesRates, over the shell's
                       StageResults.
```

The real-data cases are the parent folder's `build-binaries.test.ts`: each
snapshot as a refresh would write it, byte for byte, and every key a stage
counts filed exactly once.

## Composition, not counting

Stage 7 counts nothing itself. Each stage's `stageNCounts` returns the keys
its code produces, folded through the one tally helper
([The tally](../../util/counts/README.md#the-tally)), and each `stageNRates`
the shares over them. A snapshot stage is not a code stage: `subdivide` holds
Stage 1's ORB6 orphan and MSC inner-pair counts and Stage 3's NSS inner
pairs; `ingest` holds Stage 3's `wds_pairs_total`, which its inner pairs add
to. `binariesCounts` places each key by name, in the snapshot's order, so a
refresh rewrites the file unchanged; a key a stage returns that it does not
place fails the real-data case.

A rate's denominator is never empty on real data; `share` throws if it is
(`stellata-hhaw.45.17.19`). `pnpm run build:binaries --update-snapshots`
refreshes both snapshots.
