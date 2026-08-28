---
name: pr-cleanup
description: Land a stellata PR and finish every follow-up — rebase onto main if needed (force-with-lease pre-authorised), merge it (watching only if checks are still pending), close the PR's beads, remove its worktree, and fast-forward local main. Use when asked to merge, land, or clean up after a PR ("merge PR 123 and clean up", "land this one", "/pr-cleanup 123").
---

# Landing a stellata PR

The steps Alex asks for every time. Run them in order; stop and ask the
moment anything leaves the happy path (§ Deviations).

Editing this file, two rules that every bug found in it so far would have
been caught by:

- **Cross-reference sections by name, never by number.** Inserting § The
  signature trap shifted every later number and left § Ground truth pointing
  an already-merged PR at § Merge.
- **Every check here must be able to fail.** State what output means *no*
  before adding one; if there is no such output it is decoration that reads
  like safety. `cat-file -e` (§ Worktree, branches, main) and a `fail`-only
  bucket filter (§ The watch) both shipped because nobody asked.

## What this skill authorises — and only this

For **the PR named at invocation**, and nothing else:

- **Merge it.** Squash only — the ruleset allows no other method.
- **Force-push it, with `--force-with-lease`, and only when a rebase onto
  main requires it.** A force-push with no rebase behind it is not
  authorised; neither is `--force`.
- **Close its beads, remove its worktree, fast-forward local main.**

Still never: push or commit to `main`, merge a PR the user did not name,
merge anything with a failing check, or `git push --delete` a remote branch
(auto-delete-on-merge is enabled on this repo, so it already happened).

The authorisation is per-invocation. It does not carry to the next PR.

### Invoked with no PR number

`/pr-cleanup` on its own is common. Resolve it, do not guess:

```bash
gh pr list --state open --json number,title,headRefName -q '.[] | "#\(.number)  \(.headRefName)  \(.title)"'
```

Take it as **this session's own PR** — the branch this session created, or the
one just discussed — when that is unambiguous, and **say which you picked and
why** so a wrong pick is cheap to correct. Otherwise show the list and ask.

**Never default to a PR another session owns**, however plausible it looks.
Several are usually open at once and the others are someone else's in-flight
work; merging one is not recoverable by an apology.

## 1. Ground truth first

```bash
gh pr view <N> --json number,title,state,headRefName,mergeable,mergeStateStatus,autoMergeRequest,isDraft
git worktree list                      # which worktree holds headRefName
git fetch origin
```

**Check `state` before anything else — it may already be merged.** Auto-merge
can fire between two of your own commands. If `MERGED`, the work left is
§ Close the beads and § Worktree, branches, main — never § Merge.

Collect the beads: bead IDs (`stellata-<slug>` / `stellata-<slug>.<n>`) appear
in the PR title, body, and commit subjects. Gather all three and de-duplicate:

```bash
gh pr view <N> --json title,body,commits \
  -q '.title, .body, (.commits[].messageHeadline)' \
  | grep -oE 'stellata-[a-z0-9]+(\.[0-9]+)*' | sort -u
```

Read each one (`bd show <id>`) rather than trusting the ID: a PR sometimes
*mentions* a bead it does not close.

## 2. Rebase onto main — always check, even when nothing suggests it

```bash
git status --porcelain                     # must be empty — rebase aborts on a dirty tree
git rev-list --count HEAD..origin/main     # 0 → current; skip to § The signature trap
git rebase origin/main
```

**`package.json` conflicts whenever main shipped a release since this branch
bumped.** Resolve to a patch *above* main's version — never keep the branch's
stale number, never keep main's unchanged.

Then check the bump commit's own subject. `Bump version to 3.33.3` that now
bumps to `3.33.5` is a stale claim in permanent history, and the fix is
awkward: `git rebase -i` is unavailable in this environment. Rebuild the
chain with `git commit-tree` instead — and **read § The signature trap
before you do**, because that rewrite is exactly what breaks the merge.

If the version moved, re-read the PR body's `## Release notes` block: it
ships to the GitHub release page for whatever version this PR lands
(`RELEASING.md`), and `release-notes-guard` fails an empty one.

Re-run the gates after any rebase — `pnpm run typecheck && pnpm test` — then:

```bash
git push --force-with-lease origin <headRefName>
```

## 3. The signature trap — check before arming the merge

The ruleset carries `required_signatures`. An unsigned commit blocks the
merge **with every check green**, which reads exactly like the orphaned-context
failure in § Deviations and is a different cause.

```bash
git log --format='%h %G? %s' origin/main..HEAD
```

Every commit must show `G`. An `N` means unsigned. Two causes, and the one
listed second is the one that has actually happened here:

- **A history rewrite done with plumbing.** `git commit-tree` does not honour
  `commit.gpgsign`, so rebuilding a chain to reword one commit silently
  unsigns every commit it touches, including ones you did not write.
- **`-c commit.gpgsign=false` carried onto a real commit.** Four suites under
  `tests/` pass exactly that flag, and are right to — their fixtures are
  throwaway repos where signing fails. A session that has been reading them,
  or driving its own scratch repos, stops seeing the flag as a decision and
  starts treating it as how `git commit` is spelled. Pass no signing flag on
  a branch that will be merged; let the repo's config decide.

The second is invisible at commit time and surfaces four steps later as a
blocked merge with every check green, which reads like the orphaned-context
failure in § Deviations.

Fix, and verify the fix changed nothing but signatures:

```bash
BEFORE=$(git rev-parse HEAD^{tree})
git rebase -f -S origin/main
[ "$BEFORE" = "$(git rev-parse HEAD^{tree})" ] || echo "TREE CHANGED — STOP"
git log --format='%h %G?' origin/main..HEAD      # all G now
git push --force-with-lease origin <headRefName>
```

Do this **before** arming auto-merge. Arming first burns a full CI cycle,
because re-signing rewrites every SHA and every check re-runs.

## 4. Merge — never sit on CI

Alex's standing rule is that CI-side verification is yours and you never poll
it (`Never wait on PR CI checks`). So do not wait for green.

Everything below turns on `mergeStateStatus`, so read it rather than inferring
it from how the checks page looks:

| | |
|---|---|
| `CLEAN` | mergeable, all required checks passed — merge now |
| `BLOCKED` | required checks pending **or** § Deviations' blocked-with-no-failing-check |
| `UNSTABLE` | mergeable, but something is failing — a § Deviation, never merge over it |
| `BEHIND` / `DIRTY` | out of date / conflicting — back to § Rebase onto main |
| `UNKNOWN` | GitHub has not computed it yet; re-run the query, do not act on it |

`UNKNOWN` is ordinary, not a fault: GitHub computes mergeability lazily and
the first query after a push routinely lands before it finishes.

**Checks already green** (`mergeStateStatus: CLEAN`) — merge and go straight
to § Close the beads. The merge is synchronous, so there is nothing to watch:

```bash
gh pr merge <N> --squash
```

**Checks still pending** — arm auto-merge, then watch, because now there IS
an outcome you do not yet know:

```bash
gh pr merge <N> --squash --auto
```

Never pass `--delete-branch`: the remote side auto-deletes on merge, and the
local side fails while the worktree still holds the branch.

### The watch — only for the `--auto` case

**The script must exit on every terminal state.** A monitor that only matches
success is silent through a failure, and silence looks identical to "still
running".

**Write it to a file and run it by path.** Inline is not an option: the loop
needs `$( )`, and a worktree-isolated session's guard rejects any command
containing a substitution (the `beads` skill documents the same constraint
for `bd`). Write `/tmp/pr-watch-<N>.sh`, then hand `Monitor` the
plain command `bash /tmp/pr-watch-<N>.sh`. **Put the PR number in the
filename** — several sessions land PRs at once and a shared path silently
leaves one of them watching the other's PR.

```bash
PR=<N>
while true; do
  info=$(gh pr view $PR --json state,mergedAt,autoMergeRequest \
    -q '"\(.state)|\(.mergedAt // "")|\(.autoMergeRequest != null)"' 2>/dev/null || true)
  [ -z "$info" ] && { sleep 30; continue; }     # transient API failure, keep going
  IFS='|' read -r st merged auto <<< "$info"
  case "$st" in
    MERGED) echo "PR $PR MERGED at $merged"; break ;;
    CLOSED) echo "PR $PR CLOSED WITHOUT MERGING — cleanup not run"; break ;;
  esac
  fails=$(gh pr checks $PR --json name,bucket \
    -q '.[] | select(.bucket=="fail" or .bucket=="cancel") | .name' \
    2>/dev/null | tr '\n' ' ' || true)
  if [ -n "$fails" ]; then echo "PR $PR CHECKS FAILED/CANCELLED: $fails"; break; fi
  if [ "$auto" != "true" ]; then echo "PR $PR auto-merge NOT ARMED"; break; fi
  sleep 30
done
```

`gh pr checks` sorts every check into one of five buckets — `pass`, `fail`,
`pending`, `skipping`, `cancel`. **`cancel` is terminal and is not `fail`.**
A cancelled required check blocks the merge for good while auto-merge stays
armed, so matching only `fail` leaves the loop polling a PR that will never
move, which is indistinguishable from CI still running.

`Monitor` with `persistent: true` — the loop's own exit ends the watch, so no
timeout should pre-empt it. Only the `MERGED` line continues to § Close the
beads; every other exit is a § Deviation.

## 5. Close the beads

Only once the PR is actually `MERGED` — whether the watch reported it or
§ Ground truth found it already merged.

```bash
bd close <id> [<id>...] --reason="Shipped in PR #<N> (squash merged)."
bd dolt push
```

`bd dolt push` is required here. The pre-push git hook syncs bd state on
`git push`, and there is no `git push` left after this point — see the
`stellata-beads` skill.

Leave a bead open when the PR only advanced it. Say which, and why.

**No beads at all is normal, not a deviation.** A tooling, CI, or docs PR
often has none. Say so and move on.

## 6. Worktree, branches, main

Order matters — you cannot remove the worktree from inside it. **How you
leave depends on how you got there.**

- **Session is worktree-*isolated*** (you called `EnterWorktree`, or the PR's
  branch is this session's own): `cd` is not enough — the session's working
  directory is pinned. Use the `ExitWorktree` tool with
  `action: "remove"`.

  **It will refuse after a squash merge.** A squash lands a *new* commit on
  main, so the branch commit is not an ancestor and the tool reads it as
  unmerged work. That refusal is the last thing between the merge and
  `discard_changes: true` deleting commits permanently, so whatever overrides
  it has to be a real check:

  ```bash
  git fetch origin
  git log --oneline -20 origin/main | grep '(#<N>)'    # the squash commit itself
  git show origin/main:<path the PR changed> \
    | grep -q '<a line this PR introduced>'            # its content, on main
  ```

  Either one alone is sufficient; the log line is cheaper and does not depend
  on picking a good grep string.

  **Never test this with `git cat-file -e origin/main:<path>`.** `-e` asks
  only whether the path *exists*, and most PRs modify files that already do —
  it passes identically whether or not the PR merged. A check that cannot
  fail is worse than no check, because it is what you lean on to discard.
  Test for something the PR **introduced**.

  Both commands avoid `$( )` on purpose — § The watch has the reason an
  isolated session cannot run one.

- **Session is not isolated** (the worktree belongs to an earlier session):
  plain `cd` to the main checkout, then `git worktree remove`.

Then, from the main checkout:

```bash
git fetch --prune                                    # drops the auto-deleted remote branch
git branch -D <headRefName>                          # no-op if ExitWorktree took it
git pull --ff-only                                   # main checkout, main branch
pnpm run typecheck                                   # sanity-check what actually landed
```

**Tell Alex the worktree is gone.** He runs a dev server against each branch's
worktree — one per PR — so removing it kills whatever that server was
serving.

Never remove a worktree the PR did not own.

**`locked` does not mean "hands off" on its own.** `EnterWorktree` locks the
worktree it creates, so the PR's own worktree — the very one this step exists
to remove — shows as `locked` whenever a session is working in it, including
this one. What to avoid is a worktree locked by **another** session: it holds
a different branch, and `git worktree list` naming a branch that is not this
PR's `headRefName` is the tell.

## Deviations — stop and ask

Do not improvise past any of these. Say what you found, what you would do, and
wait.

**Blocked with no failing check.** Two known causes, in the order to check
them: unsigned commits (§ The signature trap), then an orphaned
required-status context —
gating lives in ruleset `15843287`, not branch protection, and a renamed job
`name:` strands the old context forever (`RELEASING.md` § Merge gating). Compare required against reported:

```bash
gh api repos/alexmensch/stellata/rulesets/15843287 \
  -q '.rules[] | select(.type=="required_status_checks")
      | .parameters.required_status_checks[].context' | sort
gh pr view <N> --json statusCheckRollup -q '.statusCheckRollup[]? | (.name // .context)' | sort
```

Report the cause; changing a ruleset is Alex's call, never yours.

**Anything else off the path:**

- PR is a draft, has requested changes, or unresolved review threads.
- A check failed or was cancelled, or the monitor exited `CLOSED` / not-armed.
- `mergeStateStatus` is `UNSTABLE` — something is failing even though GitHub
  would let the merge through.
- Rebase conflicts anywhere except the `package.json` version bump.
- Gates fail after the rebase — the rebase changed behaviour; do not push.
- No worktree holds the branch, or the branch is checked out in the **main
  checkout** (never remove that worktree).
- A bead ID resolves to work this PR does not actually close, is already
  closed, or is an epic with open children.
- Local `main` has uncommitted changes, or is ahead of origin — do not pull
  over it.
- The PR bumps the version but `## Release notes` is empty, or still describes
  the pre-rebase version.

When Alex answers, that answer covers that PR only.
