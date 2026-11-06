---
name: stellata-pr-cleanup
description: Stellata's extension of the user-level `pr-cleanup` skill — bead IDs and closing, the pnpm gates, landing through the merge queue with a derived version, the ruleset that gates merges, and rebuilding main's seeded artifacts after landing. `pr-cleanup` loads it for every landing of a stellata PR; load it directly only if `pr-cleanup` is already in context without it.
---

# Landing a stellata PR

Load `pr-cleanup` first if it is not already in context; it carries the
authorisation, the steps and the deviations. This skill adds what is true
only here. Each section below names the `pr-cleanup` section it narrows; it
never replaces it.

## Ground truth first — the tickets are beads

Bead IDs match `stellata-<slug>` / `stellata-<slug>.<n>`:

```bash
gh pr view <N> --json title,body,commits \
  -q '.title, .body, (.commits[].messageHeadline)' \
  | grep -oE 'stellata-[a-z0-9]+(\.[0-9]+)*' | sort -u
```

Read each with `bd show <id>`.

## Bring main in — gates, release level

The gates are `pnpm run typecheck && pnpm test`.

**Bring main in only when the PR conflicts with it.** Landing goes through
the merge queue ([The merge queue](/RELEASING.md#the-merge-queue)), which
tests the PR on main plus every entry ahead, so a PR merely behind main
lands without a sync. No version is ever in conflict: the PR carries a
release level label and the version is derived when it lands
([Version policy](/RELEASING.md#version-policy)). A PR with no level label,
or two, fails `version-guard`; that is `pr-cleanup`'s deviation, not a
label to pick here.

## Squash-merge — through the queue

`pr-cleanup`'s merge command queues the PR rather than merging it:
`gh pr merge <N> --squash --match-head-commit <sha>`. It lands when its
merge group's checks pass. The queue drops an entry whose group fails a
check or no longer merges onto the entries ahead: `gh pr view <N> --json
state,mergeStateStatus` shows it open again. A failed check is a fix on the
branch; a conflict is a sync with main. Either way it is queued again with
the new head.

## Close the tickets — bd

```bash
bd close <id> [<id>...] --reason="Shipped in PR #<N> (squash merged)."
bd dolt push
```

`bd dolt push` is required here. The pre-push git hook syncs bd state on
`git push`, and there is no `git push` left after this point — see the
`stellata-beads` skill.

## Worktree, branches, main — sanity check

After the pull: `pnpm run typecheck`.

## Rebuild main's artifacts — last, in the background

New worktrees are seeded from the main checkout's `public/` and `build/`
artifacts ([Building in a worktree](/scripts/README.md#building-in-a-worktree)); a stamp that
disagrees with the worktree's inputs rebuilds that step. Rebuilding main
right after the pull keeps those stamps matching, so the next worktree starts
without a cold catalogue build. A landing that leaves a lineage stage's
inputs alone skips that stage, and its seeded baseline stays usable while
its inputs match the merge-base's
([The verdict](/scripts/catalog/lineage/baseline/README.md#the-verdict--one-map-comparison)).

Run it from the main checkout with Bash `run_in_background: true`, after
every `pr-cleanup` step has finished:

```bash
pnpm run build:seed
```

Never pipe its output (`| tail` reports `tail`'s exit code, not the build's).
A landing coordinated by `pickup-epic` skips this section: the coordinator
starts it in the background right after the landing instead.

`build:seed` builds only the steps worktrees are seeded from, and
stops a build another landing already started in the main checkout, so
concurrent `/pr-cleanup` runs never build side by side ([Seeding builds](/scripts/README.md#seeding-builds--buildseed)).

Report the landing without waiting on it. When the background task exits,
report its exit status. `superseded by a newer build:seed` with exit 0 is
a newer landing taking over, not a failure. Any other non-zero exit means
main's artifacts are stale or partial, so name the failing step — never retry
it on your own.

## Deviations — stellata additions

- **Blocked with no failing check:** merge gating lives in ruleset
  `15843287`, not branch protection ([Merge gating](/RELEASING.md#merge-gating)).
- A bead that is an epic with open children.
- The PR declares a release level but `## Release notes` is empty.
