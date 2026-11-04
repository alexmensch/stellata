# Choosing the baseline — the stage header and its verdict

Which earlier build a stage's run-to-run diff reads, and when it refuses one
([Run-to-run diff](../README.md#run-to-run-diff) carries the rotation and the diff itself).

## Files in this area

```
scripts/catalog/lineage/baseline/
  lineage-header-pure.ts         StageHeader and its parse; planBaseline and
    (+ test)                     judgeBaseline, the verdict over a header and
                                 the merge-base.
```

Its readers and writers live one folder up: `../lineage-io.ts` writes and
reads the header, `../stage-lineage.ts` asks the verdict.

## The header and the refusal

A fresh worktree is seeded with the main checkout's last `build/lineage/`
(`.worktreeinclude`), which may come from an older commit. So each stage
writes a header beside its files, `<stage>.header.json`, recording the
build version, the commit, whether the tree had uncommitted edits, and the
content hash of the inputs the stage was built from (`stepInputPaths`, `../../../util/step-inputs.ts`),
and the sha1 of each stage file it was written with; a header per
stage is what lets one stage rotate without rewriting another's. The diff
refuses a baseline whose commit is not the branch's merge-base with main, or
that was built over uncommitted edits — its commit then names code it was
not built from — or whose files on disk are not the bytes its header
recorded (`readStageHeader` re-hashes the stage spec's files, so one the
header does not name is a mismatch too): the seed copies files one at a
time, so a worktree created while `build:seed` rotates a stage can pair one
build's header with another's files
(`judgeBaseline`). A pinned merge-base copy in
`lineage.previous/` is held to the same check.

A clean, intact header from **another commit** is accepted when its input
hash equals the hash of the stage's inputs as the merge-base holds them
(`merge-base-inputs`): `build:seed` skips a stage whose content stamp is
fresh and writes nothing for it, so after a landing that left membership's
inputs alone the seeded header still names the last commit that rebuilt it.
`inputHashesAt` (`../../../util/input-hashes-at.ts`) takes the step's own
input map and re-hashes, from the merge-base's copy, each path git reports
changed since it; it runs only when a header from another commit reaches the
verdict, once per stage. Two limits follow from computing over this
branch's input set rather than the merge-base's closure:

- An input git does not hold — a git-ignored build output — has no
  merge-base copy, so the hash is `unknown` and the header from another
  commit is refused. The catalogue's stages read `build/lineage/`'s
  membership files, so placement, promotion and allocation still need a
  build at the merge-base.
- A branch that adds or drops a file in the stage's import closure has a
  different input set from any merge-base build, so its hash never matches;
  the refusal stands until the stage is built at the merge-base. An LFS
  input whose merge-base content is not in the local LFS store is `unknown`
  too. The refusal names the
baseline's commit and how to get a matching one; `--any-baseline` accepts it
anyway, and `--against <dir>` diffs against that directory instead. A
refused diff fails nothing: the stage's lineage still lands, no diff is
written, and a stale one is deleted, so a missing report is visible rather
than out of date.
