# Where a pin's numbers came from

A pin is a table of medians with no scene attached. What makes a later mark
attributable is the provenance beside them: which run file each row was
summarised from, which commit that run measured, and how far main's own
render path moved above the tree the pin was taken on. This folder holds that
half. The rows, bands and verdicts are `../README.md`; the operator rules are
`RELEASING.md` § Perf pin.

```
scripts/perf/pins/provenance/
  provenance-pure.ts (+ test)   citeRunPath, the commit-state reading,
                                the render-path drift parse, and the header
                                lines `--against-pin` prints before any row.
```

`../../checkout.ts` runs the git commands and hands the answers here; nothing
in this folder shells out, which is what lets a test import it.

## What the commit fields hold

`git.commit` is HEAD at take time and `git.mainCommit` is its merge base with
`origin/main`. Both, because a pin is always taken on a branch and a squash
merge lands that tree under a hash the branch tip never had — so the tip alone
cannot answer "how far has main moved since?". The merge base can, and
survives the squash. `git.mainReachable` records whether the tip was on main
when taken, which for most runs is simply `false`.

`--against-pin` re-asks the ancestry at comparison time rather than trusting
`mainReachable`, since a tip unlanded when the pin was taken may have landed
since. A tip that never lands is **reported, not refused** — taking a pin on a
branch is the normal case, and refusing would leave no usable pin at the
moment one is most wanted. The header then prints main's own
`git diff --shortstat` under `src/client` between the two bases, because a
mark is only the PR's if nothing else moved the frame in between: one pin sat
at an unlanded tip and charged four consecutive PRs — one with no per-frame
code at all — for ~1,600 insertions of main's own render-path work
(stellata-8cg.49.24).

The line **names both bases and reads the counts in that direction** rather
than saying main moved since the pin. A branch cut before the pin was taken
holds the older of the two, and the insertions and deletions are then the
other way up; naming both ends also makes the line a `git diff` command a
reader can re-run.

`pinProvenanceLines` takes the git block rather than the whole pin, so nothing
here imports the row types it would otherwise have to keep up with.

**Only exit 1 is an answer.** `git merge-base --is-ancestor` replies in exit
codes, and every other non-zero status is the question having failed — an
unknown object, no `origin/main`, a broken repository. Reading those as
`unlanded` would print a confident "pre-squash branch tip" line about a commit
git never resolved, so they read `unknown` and the header says the drift is
unbounded instead.

An **empty** `--shortstat` line is git saying the two trees are identical under
the pathspec, which is a drift of zero rather than a failure to measure one —
the difference decides whether the header stays silent or says the drift could
not be read. Either count is absent when it is zero, so a deletion-only diff
carries no insertions clause at all.

## `sourceRun` is relative to the checkout the run was written in

Not to the main checkout. A pin is normally taken on a branch and a branch
normally lives in a worktree, where runs are filed under that worktree's own
`.perf-runs/` (`../../README.md` § Recording) — so resolving against the main
checkout writes `.claude/worktrees/<name>/.perf-runs/…`, a path that stops
resolving the moment the worktree is removed, which is to say shortly after
the PR merges. `citeRunPath` takes the writing checkout's root for that
reason, and a run stored outside any checkout keeps its basename and loses its
location.

## A deferred measurement cites a run file, never the pin

A bead that asks for a measurement later names the baseline **run** —
`.perf-runs/<date>/<file>.json` — and not "compare against the pin".

Retrieval is not what makes a late comparison fail. Every pin is committed, so
any historical one comes back without checking anything out:

```
git show <commit>:scripts/perf/pins/<slug>.json > /tmp/pin.json
pnpm run perf -- … --against-pin /tmp/pin.json
```

What fails is the **drift above**, which only grows while the bead waits, and
which no amount of recovering old pins repairs — the thing being priced is
today's code, and the older the pin the more of main's own render-path work
sits between the two bases and lands on this diff's row. A run file cannot
drift: it is one tree's numbers, immutable, and it stays a usable baseline
long after the pin that was current beside it has moved on.

So the order of preference is **take the run while the context that wants it
is loaded**; failing that, record the baseline run file and what flags it
used, since a comparison is only valid against a run whose flags match
(`../README.md` § Setup levers — a `--force-recompute` or `--readback-every`
mismatch is not a comparison).
