# Choosing the baseline — the stage header and its verdict

Which earlier build a stage's run-to-run diff reads, and when it refuses one
([Run-to-run diff](../README.md#run-to-run-diff) carries the rotation and the diff itself).

## Files in this area

```
scripts/catalog/lineage/baseline/
  lineage-header-pure.ts         StageHeader and its parse; planBaseline and
    (+ test)                     judgeBaseline, the verdict over a header and
                                 the merge-base; checkoutAt, whether the
                                 checkout is on main.
```

Its readers and writers live one folder up: `../lineage-io.ts` writes and
reads the header, `../stage-lineage.ts` asks the verdict.

## The header and the refusal

A fresh worktree is seeded with the main checkout's last `build/lineage/`
(`.worktreeinclude`), which may come from an older commit. So each stage
writes a header beside its files, `<stage>.header.json`, recording the
build version, the commit, whether the tree had uncommitted edits, and the
content hash of the inputs the stage was built from (the runner's pre-run hashes, `stepInputHashes`, `../../../util/step-input-hashes.ts`),
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
`lineage.previous/` is held to the same check. The refusal names the
baseline's commit and how to get a matching one; `--any-baseline` accepts it
anyway, and `--against <dir>` diffs against that directory instead. A
refused diff fails nothing: the stage's lineage still lands, no diff is
written, and a stale one is deleted, so a missing report is visible rather
than out of date.

A clean, intact header from **another commit** is accepted when its input
hash equals the hash of the stage's inputs as the merge-base holds them
(`merge-base-inputs`): `build:seed` skips a stage whose content stamp is
fresh and writes nothing for it, so after a landing that left membership's
inputs alone the seeded header still names the last commit that rebuilt it.
`inputHashesAt` (`../../../util/input-hashes-at.ts`) takes the step's own
input map and re-hashes, from the merge-base's copy, each path git reports
changed since it; it runs only when a header from another commit reaches the
verdict, once per stage.

The hash is `unknown`, and such a header refused, where an input has no
merge-base copy to hash:

- A git-ignored build output. The catalogue's stages read `build/lineage/`'s
  membership files, so `build:catalog` names membership as their `upstream`
  (`UpstreamLineage`): when membership's previous or current header stands
  for the merge-base (`acceptedFiles`, judged against membership's own
  inputs, as its build stamp records them), its `files` map is those files' hash at the merge-base, the same
  bytes sha1 the input map holds. Any other ignored input stays `unknown`.
- An LFS input whose merge-base content is not in the local LFS store; it is
  never fetched.

The comparison runs over this branch's input set, not the merge-base's
closure: a merge-base input outside that set is never compared. So a branch
that adds a file to the stage's import closure, or drops one the older
build read, usually differs from it and is refused until the stage is built
at the merge-base; and a branch that drops a file the merge-base gained
after the older build can match it although the merge-base build read that
file.

## On main

A checkout is **on main** when it is on the `main` branch
(`onMainBranch`, `../../../util/git-provenance.ts`) and HEAD is its
merge-base with `origin/main` (`checkoutAt`). A fresh branch worktree, whose
HEAD is the merge-base until its first commit, is not: its seeded baseline is
main's last build, often from an older commit, and a diff against it would
report other PRs' landings as the branch's change. A detached HEAD, as on
CI, is not on main either. There, the one rule is that a clean, intact
header from HEAD or an earlier commit in its history (`inHeadHistory`,
`git merge-base --is-ancestor`) is accepted whatever its inputs
(`main-build`), so `build:seed` after a landing diffs against the previous
main build and reports what the landing changed. The merge-base's input
hash is never asked, so neither membership's upstream re-hash nor
`inputHashesAt` runs. Nothing is pinned in `lineage.previous/` on main, a
build from the inputs HEAD holds included: the stage rotates every time, so
each landing diffs against the one before it. A header from outside HEAD's
history, a dirty one, or one beside files it did not record is refused. Every other checkout keeps the merge-base rule
above unchanged.
