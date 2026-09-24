---
name: stellata-beads
description: >
  How beads works in stellata specifically — Dolt persistence and when a manual
  `bd dolt push` is required, the concurrent-session ownership rule, recovering
  a field a bad write wiped, the P0–P4 prioritisation framework, and the two
  things every `bd create` must carry (parent epic, priority). Use when running `bd` in this repo: filing or closing beads, setting
  a priority, picking up work, or closing out a session — including a bead
  filed mid-task for a bug found in review or smoke, or for follow-up work.
  Load the `beads` skill alongside this one: it carries the never-orphan filing
  law and dependency argument order, not just CLI syntax. Pruning memories or
  triaging the open graph is the `bd-grooming` skill instead.
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

**A claim is that session's lock, and clearing one interrupts it.** So never
write `--status` or `--assignee` on a bead you did not claim yourself — not to
tidy a field, and above all not to undo something you take for your own side
effect. `bd update --claim` is the only thing that claims; a plain
`--body-file` / `--title` / `--notes` write does not, so a bead that is
`in_progress` after your edit was already claimed by someone else.

The trap is a **stale read**: `bd show` output from earlier in the session says
nothing about now, and a bead can be claimed between your read and your write.
Re-read immediately before writing, and where a field's history decides it,
read Dolt (§ Recovering a wiped field) rather than inferring from what you
remember seeing.

## Recovering a wiped field

bd auto-commits every write to Dolt, so a blanked description is recoverable:

```bash
cd .beads/embeddeddolt/stellata
dolt log --oneline
dolt sql -q "select description from issues as of '<hash>' where id='<id>'" -r csv
```

Read the result back through a CSV parser, not by eye — the `bd show` render
re-wraps lines.

## `bd create` carries two arguments, not one

Both are set **at creation**, and getting either wrong is silent — nothing
prompts you, the bead just looks filed:

- `--parent <epic-id>` — § Choosing the parent epic below, and `beads` skill
  § Never create a bead outside an epic for the escalation path when none fits.
- `--priority` — § Prioritisation below.

Audit: `bd list --status=open --no-parent --exclude-type=epic`.

### Choosing the parent epic

The parent is a claim about **when the work must happen**, not which folder the
code sits in:

- **A defect reachable by a user on the shipped path** → `stellata-uadc`.
- **A defect that only reproduces on a path still being migrated** → the epic
  doing that migration, with the cutover bead taking a `bd dep add` on it, so
  the graph says "this blocks cutover" instead of leaving a loose bug.

So establish which backend, renderer or vantage a report came from *before*
picking — usually one question to the reporter.

### Filing a defect bead — check it still reproduces

Before implementing one, confirm the defect still reproduces on main. A bug
filed mid-PR is often fixed by that same PR and the bead never hears about it.
Reproduce in the smallest harness and read the target file first; a comment in
the code naming the bug's own mechanism is the tell that someone got there
already, and `git log -S` on the fix string dates it against the bead.

What remains is then the **acceptance, not the mechanism** — the test that pins
the fix so it cannot be removed. Prove it load-bearing by reverting the fix and
watching it fail, then restore. Say in the close reason and the PR that the
mechanism landed elsewhere, naming the PR; a close implying you built it
misleads the next audit.

## Where the detail lives — read the doc, don't guess

`docs/bd-workflow.md` carries the bug-sweep handoff format and the label /
metadata / external-ref conventions. Grooming memories or the bead graph is the
`bd-grooming` skill. When a bd question is not answered in either, read rather
than reconstructing the answer from sibling beads.

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

## Authoring conventions

- Prefer formal `bd dep` links over prose cross-references whenever the
  relationship affects planning or ordering — planning happens from the
  dependency graph, and "see issue X" prose never surfaces there. Avoid
  epic-level blocks when task-level deps express the same constraint.
- Structured info (PR numbers, URLs, source tags) goes in labels / metadata /
  external-ref, never title prose. Conventions in [Tagging](/docs/bd-workflow.md#tagging--labels-metadata-external-ref).

## Keep this skill current — do this without being asked

**Edit this file in the same session, without asking**, whenever something
here is wrong or stale, you had to work out an undocumented stellata-specific
bd fact, or — the trigger that gets skipped — **the user corrected a bd action
of yours.** A correction is a defect in this file until proven otherwise: fix
the bead, then ask what let you file it wrong. If a rule was written down and
still got violated, the pickup point is what failed.

Write the rule that catches the **class**, not a note about the incident; the
incident belongs in the commit message. Often the right fix is a pointer or
different trigger wording somewhere else, and "this file is missing a
paragraph" is the least likely answer.

Default to a pointer. Restate only what you must know *before* you know to
look it up — a creation-time obligation qualifies, because nothing prompts
you. Anything you would naturally go and look up is a pointer, always.

Verify against the running CLI or the repo before writing, keep the register
terse, do not duplicate `docs/bd-workflow.md`, the `beads` skill or `bd prime`
output, and say in one line what changed.
