---
name: stellata-beads
description: >
  How beads works in stellata specifically — Dolt persistence and when a manual
  `bd dolt push` is required, the concurrent-session ownership rule, recovering
  a field a bad write wiped, the P0–P4 prioritisation framework, and the
  grooming protocol. Use when running `bd` in this repo: filing or closing
  beads, setting a priority, triaging, picking up work, pruning memories, or
  closing out a session. Generic `bd` command syntax lives in the `beads` skill.
---

Stellata-specific beads operation. The `beads` skill carries CLI syntax; this
carries what is true about *this* repo.

## Persistence

- bd state is shared across all git worktrees; writes from
  `.claude/worktrees/*` are immediately visible elsewhere. Trust the exit
  code — success means persisted to the local Dolt database
  (`.beads/embeddeddolt`, the source of truth).
- **bd state is not in git.** It syncs to the Dolt remote over `refs/dolt/*`
  automatically: the pre-push git hook runs `bd dolt push` on every
  `git push`. No manual sync at session close, no separate bd-sync PR.
- **Run `bd dolt push` by hand only when you change bd state with no `git
  push` following it** — closing beads after the final push of a session is
  the usual case.
- JSONL export is disabled. `.beads/issues.jsonl` is normally absent and
  gitignored — never stage, commit, or revert it. For an on-disk copy:
  `bd export -o .beads/issues.jsonl`, then delete it.

## Concurrent sessions

`in_progress` is the canonical "someone else has this" signal — branch
ownership alone is not. An `in_progress` bead with matching uncommitted edits
in a worktree usually means another live session owns it: do **not** pick it
up, run gates against it, commit, push, or close it without confirming first.

## Recovering a wiped field

bd auto-commits every write to Dolt, so a blanked description is recoverable:

```bash
cd .beads/embeddeddolt/stellata
dolt log --oneline
dolt sql -q "select description from issues as of '<hash>' where id='<id>'" -r csv
```

Read the result back through a CSV parser, not by eye — the `bd show` render
re-wraps lines.

## Prioritisation

Tie-break order when choosing what to work on:

1. Bug fixes
2. Physical reality fixes — the model needs to look real
3. UX issues
4. Quick wins
5. More layers, closest to Sol outwards
6. Mobile experience — desktop comes first

Mapping to P0–P4:

- **P0** — production blocker. Reserve.
- **P1** — drop everything: open user-reported bugs; the core physical-reality
  rewrite and its in-flight sub-tasks; visible UX latency or jank on a hot user
  path; the single dominant perf cost on a hot path.
- **P2** — actively in scope: physical refinements, non-blocking UX work, quick
  wins, perf that is not the dominant cost, and the next layer out from Sol
  plus its gating design-doc / data-ingest task.
- **P3** — backlog: layer-implementation children behind their parent's design
  gate, far-out layers, the mobile epic, public site / FAQ / user docs, code
  refactors and dev tooling, bugs blocked on external data or resolved as a
  side effect of P1/P2 work, chart-mode polish off the critical path.
- **P4** — long-tail research notes.

Gotchas: perf tasks are bug-like but reach P1 only as the dominant cost on a
hot path or when they cause visible jank, otherwise P2 · a layer epic's
design-doc / data-ingest sub-task takes the parent's priority while its
implementation children sit at P3 until that gate clears · code-quality
refactors default to P3 unless signalled as blocking · "around any focal star"
epics are P3, not P2 · mobile always sits below desktop.

When in doubt: **P2** if the work is being scoped in real time, **P3** if it is
filed for later. Never sit a parent at P2 when it depends on something at P3 —
let the dependency graph do the work.

## Grooming — memories and beads

**Trigger:** a request to prune memories, groom beads, or check what is worth
retiring.

Survey first, present a categorised plan, wait for approval, then execute
mechanically in batches. Full procedure — the drop / trim / consolidate / move
categories for memories, and the six bead categories — in
`docs/bd-workflow.md` § Grooming.

Decision rule governing both passes: **if it is not relevant to every session,
it does not belong in memory.** Skills, beads and docs are the home for
area-specific content. Dropping a memory without leaving a hook is safe only
when retrieval is already covered by something that loads every session — a
CLAUDE.md rule, a skill description, the readme-guard hook, or a CI test that
fails on violations.

When a memory key is dropped or renamed, sweep the surviving memories, docs and
skills for references to it.

## Authoring conventions

- Prefer formal `bd dep` links over prose cross-references whenever the
  relationship affects planning or ordering — planning happens from the
  dependency graph, and "see issue X" prose never surfaces there. Avoid
  epic-level blocks when task-level deps express the same constraint.
- Structured info (PR numbers, URLs, source tags) goes in labels / metadata /
  external-ref, never title prose. Conventions in `docs/bd-workflow.md`
  § Tagging.

## Keep this skill current — do this without being asked

If something here is wrong, stale, or contradicted by real behaviour, or you
had to work out a stellata-specific bd fact that is not written down, **edit
this file in the same session.** Do not ask permission. Verify against the
running CLI or the repo before writing, keep the register terse, and do not
duplicate the `beads` skill or `bd prime` output. Say in one line what changed.
