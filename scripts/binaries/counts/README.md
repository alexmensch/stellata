# Stage 7 — the count snapshot

Every count `build:binaries` pins, composed from the stages' own count
functions and filed under the stage of `../build-binaries-expected.json`
that holds it. The shell hands it to `emitArtifacts` as a snapshot check
(`compareCountSnapshot`, exact), so a count that drifts writes nothing
([Pipeline at a glance](../README.md#pipeline-at-a-glance)). The per-strategy
rates (`stage3Rates`, `stage4Rates`, `stage5Rates`) are ratios of these
counts, so a rate can move only if a count does; each stage's report logs
them and nothing pins them.

## Files in this area

```
scripts/binaries/counts/
  binaries-counts.ts   binariesCounts, over the shell's StageResults.
```

The real-data case is the parent folder's `build-binaries.test.ts`: the
snapshot as a refresh would write it, byte for byte.

## Composition, not counting

Stage 7 counts nothing itself. Each stage's `stageNCounts` returns the keys
its code produces, folded through the one tally helper
([The tally](../../util/counts/README.md#the-tally)). A snapshot stage is not
a code stage: `subdivide` holds Stage 1's ORB6 orphan and MSC inner-pair
counts and Stage 3's NSS inner pairs; `ingest` holds Stage 3's
`wds_pairs_total`, which its inner pairs add to. `binariesCounts` places each
key by name, in the snapshot's order, and hands each snapshot stage to
`nestByStage` as a counted block in `BINARIES_STAGES` order
([The staged snapshot](../../util/counts/README.md#the-staged-snapshot)), so
a refresh rewrites the file unchanged. Every input is required, so no block is
ever `absent`. `filed` takes
the stages with a second argument that is `true` only when they are exactly
`BINARIES_STAGES` and hold each key the six `stageNCounts` return exactly
once, so a key left out, invented or filed twice, or a stage outside the list,
fails to compile, naming it.

A rate with an empty denominator is `no-denominator`, never 0
(`../../util/counts/tally-pure.ts`'s `share`), and its report line prints
`n/a`, so the build reaches the snapshot check, whose diff names every count
that moved. `pnpm run build:binaries --update-snapshots` refreshes the
snapshot.
