# Choosing the baseline — the stage header and its verdict

Which earlier build a stage's run-to-run diff reads, and when it refuses one
([Run-to-run diff](../README.md#run-to-run-diff) carries the rotation and the diff itself).

## Files in this area

```
scripts/catalog/lineage/baseline/
  lineage-header-pure.ts         StageHeader and its parse; planBaseline and
    (+ test)                     judgeBaseline, the verdict over a header and
                                 a base; baseAt, which base a checkout
                                 compares with; acceptedFiles, an upstream
                                 stage's files at a commit.
```

Its readers and writers live one folder up: `../lineage-io.ts` writes and
reads the header, `../stage-lineage.ts` builds the base (`baselineContext`)
and asks the verdict.

## The header

A fresh worktree is seeded with the main checkout's last `build/lineage/`
(`.worktreeinclude`), which may come from an older commit. So each stage
writes a header beside its files, `<stage>.header.json`, recording the
build version, the commit, **the input map the stage read** — path → hash,
the runner's pre-run map handed to the step (`stepInputHashes`,
`../../../util/step-input-hashes.ts`), in the build stamp's shape — and the
sha1 of each stage file it was written with. A header per stage is what lets
one stage rotate without rewriting another's.

The header's map is what the step read, not what its stamp records: a step
that rewrites an input (`build:membership` the manifest, `build:catalog` the
SID ledger) stamps that input's post-run hash (`stampedInputMap`), and a
baseline judged on the post-run hash would be accepted after a SID mint it
did not read.

## The verdict — one map comparison

`judgeBaseline` accepts a baseline exactly when its header's input map equals
the **base's** map over the compared paths, and a refusal names each path
that differs. Two refusals come first: a header that does not read, and one
whose stage files on disk are not the bytes it recorded (`readStageHeader`
re-hashes the stage spec's files, so one the header does not name is a
mismatch too) — the seed copies files one at a time, so a worktree created
while `build:seed` rotates a stage can pair one build's header with another's
files. A path the header does not name matches one the base does not hold
(`differingInputs`): neither build read it.

The base (`Base`, chosen by `baseAt`):

- **On a branch** (`fixed`) — the merge-base with `origin/main`, over the
  header's paths, the branch's input paths and every path the branch deleted
  since the merge-base that sat beside a code input (`deletedSiblingsSince`,
  `../../../util/input-hashes-at.ts`, the sibling rule that makes a non-code
  file beside a closure module an input). So a build from any commit is
  accepted when it read what the merge-base holds, whichever commit it names,
  and a build over uncommitted edits is refused exactly when an edit touched
  an input. A branch that adds an input the older build did not read differs
  from it, and so does one that deletes a sibling file the merge-base gained
  after the older build.
- **On main** (`recorded`) — see [On main](#on-main).

The base's map is `inputHashesAt` over the compared paths
(`../../../util/input-hashes-at.ts`): each path git reports changed since the
base commit is re-hashed from the base's copy, the rest taken from the
runner's handed map or hashed from disk (`onDiskHashes`). Each `(commit,
paths)` is hashed once per stage (`inputsAtFrom`, `../stage-lineage.ts`). The
map is `unknown`, and the baseline refused, where an input has no copy at the
base to hash:

- A git-ignored build output. The catalogue's stages read `build/lineage/`'s
  membership files, so `build:catalog` names membership as their `upstream`:
  when membership's previous or current header's input map is the base
  commit's (`acceptedFiles`, the same comparison over membership's own
  recorded map, with the current header's paths as the branch's), its
  `files` map is those files' hash at the base, the same bytes sha1 the input
  map holds. Any other ignored input stays `unknown`.
- An LFS input whose base content is not in the local LFS store; it is never
  fetched.

A pinned merge-base copy in `lineage.previous/` is held to the same check.
`--any-baseline` accepts a refused baseline anyway, and `--against <dir>`
diffs against that directory instead. A refused diff fails nothing: the
stage's lineage still lands, no diff is written, and a stale one is deleted,
so a missing report is visible rather than out of date.

## On main

A checkout is **on main** when it is on the `main` branch
(`onMainBranch`, `../../../util/git-provenance.ts`) and HEAD is its
merge-base with `origin/main` (`baseAt`). A fresh branch worktree, whose
HEAD is the merge-base until its first commit, is not: its seeded baseline is
main's last build, often from an older commit, and a diff against it would
report other PRs' landings as the branch's change. A detached HEAD, as on
CI, is not on main either.

On main the base is **the header's own commit**, when that commit is HEAD or
an ancestor of it (`inHeadHistory`, `git merge-base --is-ancestor`), over the
header's own paths: the comparison then proves the baseline is a build of
that main commit, so `build:seed` after a landing diffs against the previous
main build and reports what the landing changed. A header from outside
HEAD's history, one whose map is not its commit's (a build over local
edits), or one beside files it did not record is refused. Nothing is pinned
in `lineage.previous/` on main: the stage rotates every time, so each
landing diffs against the one before it.
