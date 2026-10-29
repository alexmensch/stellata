---
name: stellata-pr-cleanup
description: Stellata's extension of the user-level `pr-cleanup` skill — bead IDs and closing, the pnpm gates, the package.json version conflict and release notes, the ruleset that gates merges, and rebuilding main's seeded artifacts after landing. `pr-cleanup` loads it for every landing of a stellata PR; load it directly only if `pr-cleanup` is already in context without it.
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

## Bring main in — gates, version, release notes

The gates are `pnpm run typecheck && pnpm test`.

**`package.json` conflicts whenever main shipped a release since this branch
bumped.** Resolve to a patch *above* main's version — never keep the branch's
stale number, never keep main's unchanged. It is the one conflict this skill
gives a rule for; any other is `pr-cleanup`'s deviation.

If the version moved, re-read the PR body's `## Release notes` block: it
ships to the GitHub release page for whatever version this PR lands
([Version policy](/RELEASING.md#version-policy)), and `release-notes-guard`
fails an empty one.

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
without a cold catalogue build, and gives it the merge-base lineage baseline
its membership change report diffs against.

Run it from the main checkout with Bash `run_in_background: true`, after
every `pr-cleanup` step has finished:

```bash
pnpm run build:seed
```

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
- The PR bumps the version but `## Release notes` is empty, or still describes
  the pre-merge version.
