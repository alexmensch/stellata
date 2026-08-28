---
name: stellata-beads
description: >
  How beads works in stellata specifically — Dolt persistence and when a manual
  `bd dolt push` is required, the concurrent-session ownership rule, recovering
  a field a bad write wiped, the P0–P4 prioritisation framework, and the
  grooming protocol. Use when running `bd` in this repo: filing or closing
  beads, setting a priority, triaging, picking up work, pruning memories, or
  closing out a session — including a bead filed mid-task for a bug found in
  review or smoke, or for follow-up work. Load the `beads` skill alongside
  this one: it carries the never-orphan filing law and dependency argument
  order, not just CLI syntax.
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

## `bd create` carries three arguments, not one

Every one of these is set **at creation**, and getting any of them wrong is
silent — nothing prompts you, the bead just looks filed:

- `--parent <epic-id>` — `beads` skill § Never create a bead outside an
  epic. Includes the escalation path when no epic fits.
- `--priority` — § Prioritisation below.
- **one** of `needs-fable` / `opus5-ok` on any implementation bead —
  `docs/bd-workflow.md` § Model-routing labels for which is which, and for
  the epic rules (never on an epic; strip it when a task becomes one).

Audit: `bd list --status=open --no-parent --exclude-type=epic`.

The stellata-specific judgement is which epic, and `docs/bd-workflow.md`
§ Choosing the parent epic has it — the short version is that the parent is
a claim about *when the work must happen*, so confirm which backend or
vantage a report came from before picking one.

## Where the detail lives — read the doc, don't guess

`docs/bd-workflow.md` is the reference for everything this skill only names:
model-routing labels, choosing the parent epic, label / metadata naming,
tagging conventions, the bug-sweep handoff format, grooming. This file
carries triggers and obligations; that file carries specifics. When a bd
question is not answered in the few lines here, the answer is in there —
go and read it rather than reconstructing it from sibling beads.

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
AGENTS.md rule, a skill description, the readme-guard hook, or a CI test that
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

**Edit this file in the same session, without asking**, whenever:

- something here is wrong, stale, or contradicted by real behaviour;
- you had to work out a stellata-specific bd fact that is not written down; or
- **the user corrected a bd action of yours.** A correction is a defect in
  this file until proven otherwise. Do not just fix the bead — ask why the
  skill let you file it wrong, and fix that. Both known misses landed this
  way: an orphaned bead and a missing model-routing label, each governed by a
  written rule this file never pointed at.

That third trigger is the one that gets skipped, because the rule usually
*does* exist somewhere and the miss reads as carelessness rather than a
documentation gap. If a rule was written down and still got violated, the
pickup point is what failed.

### Fix the principle, not the incident

Write the rule that catches the **class**, not a note about what happened
once. An incident is evidence that a gap exists; it is not a description of
its shape. Ask what general rule the miss is an instance of, and whether the
right fix is a rule change, a pointer, or different trigger wording — often
the fix belongs somewhere else entirely, and "this file is missing a
paragraph" is the least likely answer. A file that accretes one paragraph per
past mistake becomes a changelog nobody reads; the incident itself belongs in
the commit message, not here.

### What to restate here, and what to point at

The default is a pointer. This file is loaded whole every time it triggers,
so every restated line is a permanent context cost plus a second copy that
can drift out of sync with the doc.

**Restate only what you must know before you know to look it up.** A
creation-time obligation qualifies: nothing prompts you, so a session that
has not met the rule will not go looking, and a pointer cannot save it. Name
those in one line and point to the detail. Everything you would naturally go
and look up — how a label is spelled, which of two values applies, a
procedure you know exists — is a pointer, always. Adding a paragraph because
one specific thing went wrong once is how this file stops being read.

Verify against the running CLI or the repo before writing, keep the register
terse, and do not duplicate `docs/bd-workflow.md`, the `beads` skill, or
`bd prime` output. Say in one line what changed.
