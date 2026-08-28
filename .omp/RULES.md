# Stellata working rules

Restates rules `AGENTS.md` carries in full. Nothing here may be the only copy
of a rule: a user-level `~/.omp/agent/RULES.md` would shadow this file outright
rather than concatenate with it. See `.omp/README.md`.

## Git

- Never commit or push to `main` / `master`, or to a branch this session did
  not create. Diff size is never a justification.
- Work in a fresh worktree: `git worktree add .claude/worktrees/<name> -b worktree-<name>`.
- Merging needs explicit per-PR approval. Open the PR and stop.

## Before touching a folder

Read that folder's `README.md` first. Every folder under `src/`, `scripts/`,
`data/`, `docs/` has one, and it carries the invariants the code cannot state.
Update it in the same commit when the change invalidates a claim.

## Code comments

Default to none. A comment earns its keep only when removing it would cause a
wrong call and the reasoning is absent from the code. Never write bead IDs, PR
numbers, `[[memory-key]]` wikilinks, or decomposition history into one.

## Enforcement

`scripts/hooks/omp-bridge.ts` enforces the git and folder-README rules as
`tool_call` blocks. It cannot see every route to the filesystem — see
`scripts/hooks/README.md` § What the omp bridge cannot reach.
