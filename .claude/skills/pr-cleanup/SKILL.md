---
name: pr-cleanup
description: Land a stellata PR and finish every follow-up — rebase onto main if needed (force-with-lease pre-authorised), watch for the merge, close the PR's beads, remove its worktree, and fast-forward local main. Use when asked to merge, land, or clean up after a PR ("merge PR 123 and clean up", "land this one", "/pr-cleanup 123").
---

# Landing a stellata PR

The five steps Alex asks for every time. Run them in order; stop and ask the
moment anything leaves the happy path (§ Deviations).

## What this skill authorises — and only this

For **the PR named at invocation**, and nothing else:

- **Merge it.** Squash only — the ruleset allows no other method.
- **Force-push it, with `--force-with-lease`, and only when a rebase onto
  main requires it.** A force-push with no rebase behind it is not
  authorised; neither is `--force`.
- **Close its beads, remove its worktree, fast-forward local main.**

Still never: push or commit to `main`, merge a PR the user did not name,
merge anything with a failing check, or `git push --delete` a remote branch
(auto-delete-on-merge already does it — `stellata-gh-repo-settings`).

The authorisation is per-invocation. It does not carry to the next PR.

## 1. Ground truth first

```bash
gh pr view <N> --json number,title,state,headRefName,mergeable,mergeStateStatus,autoMergeRequest,isDraft
git worktree list                      # which worktree holds headRefName
git fetch origin
```

**Check `state` before anything else — it may already be merged.** Auto-merge
can fire between two of your own commands. If `MERGED`, skip to step 4.

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
git rev-list --count HEAD..origin/main     # 0 → already current, skip to step 3
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
failure in `ci-ruleset-required-contexts` and is a different cause.

```bash
git log --format='%h %G? %s' origin/main..HEAD
```

Every commit must show `G`. An `N` means unsigned. **The cause is almost
always a history rewrite done with plumbing** — `git commit-tree` does not
honour `commit.gpgsign`, so rebuilding a chain to reword one commit silently
unsigns every commit it touches, including ones you did not write.

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

## 4. Arm the merge — never sit on CI

Alex's standing rule is that CI-side verification is yours and you never poll
it (`Never wait on PR CI checks`). So do not wait for green; arm and move on.

```bash
gh pr merge <N> --squash          # checks already green and MERGEABLE
gh pr merge <N> --squash --auto   # checks pending — merges itself when they pass
```

Never pass `--delete-branch`: the remote side auto-deletes on merge, and the
local side fails while the worktree still holds the branch.

Then start the watch. **The script must exit on every terminal state** —
a monitor that only matches success is silent through a failure, and silence
looks identical to "still running":

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
    -q '.[] | select(.bucket=="fail") | .name' 2>/dev/null | tr '\n' ' ' || true)
  if [ -n "$fails" ]; then echo "PR $PR CHECKS FAILED: $fails"; break; fi
  if [ "$auto" != "true" ]; then echo "PR $PR auto-merge NOT ARMED"; break; fi
  sleep 30
done
```

Run it through `Monitor` with `persistent: true` — the loop's own exit ends
the watch, so no timeout should pre-empt it. Only the `MERGED` line continues
to step 5; every other exit is a § Deviation.

## 5. Close the beads

Only on a `MERGED` event.

```bash
bd close <id> [<id>...] --reason="Shipped in PR #<N> (squash merged)."
bd dolt push
```

`bd dolt push` is required here. The pre-push git hook syncs bd state on
`git push`, and there is no `git push` left after this point —
`stellata-bd-operations`.

Leave a bead open when the PR only advanced it. Say which, and why.

## 6. Worktree, branches, main

Order matters. `git worktree remove` fails from inside the worktree.

```bash
cd <main checkout>                                   # leave the worktree first
git worktree remove .claude/worktrees/<name>
git fetch --prune                                    # confirms the remote branch is gone
git branch -D <headRefName>
git pull --ff-only                                   # main checkout, main branch
pnpm run typecheck                                   # sanity-check what actually landed
```

**Tell Alex the worktree is gone.** He runs a dev server against each branch's
worktree (`worktree-per-pr`), so removing it kills whatever that server was
serving.

Never remove a worktree the PR did not own, and never touch a `locked` one —
another live session owns it.

## Deviations — stop and ask

Do not improvise past any of these. Say what you found, what you would do, and
wait.

**Blocked with no failing check.** Two known causes, in the order to check
them: unsigned commits (§ 3), then an orphaned required-status context —
gating lives in ruleset `15843287`, not branch protection, and a renamed job
`name:` strands the old context forever (`ci-ruleset-required-contexts`,
`RELEASING.md` § Merge gating). Compare required against reported:

```bash
gh api repos/alexmensch/stellata/rulesets/15843287 \
  -q '.rules[] | select(.type=="required_status_checks")
      | .parameters.required_status_checks[].context' | sort
gh pr view <N> --json statusCheckRollup -q '.statusCheckRollup[]? | (.name // .context)' | sort
```

Report the cause; changing a ruleset is Alex's call, never yours.

**Anything else off the path:**

- PR is a draft, has requested changes, or unresolved review threads.
- A check actually failed, or the monitor exited `CLOSED` / not-armed.
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
