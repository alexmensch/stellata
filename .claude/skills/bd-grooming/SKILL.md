---
name: bd-grooming
description: >
  Groom what loads into every session — prune and re-place bd memories, and
  triage the open bead graph. Covers the three axes: what is stale, what does
  not earn its always-loaded slot (and where it should go instead — a skill,
  a folder README, AGENTS.md, the user-level CLAUDE.md, or a bead), and what
  is merely verbose. Use on any request to prune or groom memories, groom or
  triage beads, check what is worth retiring, or cut what every session pays
  for. Report before executing is a hard gate in here.
---

Memories and open beads are the two stores that cost something in every
session — memories load via `bd prime`, open issues drive `bd ready`. Bloat in
either degrades bd silently, because nothing ever fails.

# The gate — survey, report, wait

**Never edit a memory or a bead before showing a report and getting an
explicit go.** The survey is the deliverable; the edits are mechanical once
approved. Present findings as [The report](#the-report) below, then execute in batches.

This holds even when a verdict looks obvious. A memory is something the user
chose to write; dropping one without showing the reasoning removes context they
may be relying on for work you cannot see.

# Measure before judging

Token cost is the whole reason this pass exists, so open with the number:

```bash
bd memories --json | python3 -c "
import json,sys
d=json.load(sys.stdin); tot=0; rows=[]
for k,c in d.items():
    if not isinstance(c,str): continue
    rows.append((len(c),k)); tot+=len(c)
rows.sort(reverse=True)
for n,k in rows: print(f'{n:6d}  ~{n//4:5d}tok  {k}')
print(f'TOTAL {tot} chars ~{tot//4} tokens across {len(rows)} memories')
"
```

Set it against the rest of the always-loaded floor — `AGENTS.md`, the
user-level `~/.claude/CLAUDE.md`, and the `bd prime` scaffolding — so the share
that is actually movable is visible.

# Axis 1 — stale

**Verify; do not read and judge.** A stale memory reads exactly like a live
one, so staleness is only ever found by checking its claims against the repo.
Check every one it makes:

- **Bead and epic IDs** — `bd show <id>`. A memory routing to a *closed* or
  *deferred* epic sends the next session to finished work. Closed beads often
  hold the knowledge in their close reason, which is what makes the memory
  droppable rather than merely wrong.
- **Paths** — every file, test, script and doc named still exists.
- **Claims about how the app behaves** — which backend, which default, what a
  flag does. `grep` for the mechanism, not for the sentence. The dangerous
  ones instruct an *action*: a memory telling you to ask the user which
  renderer they are on, when only one exists, spends a question on nothing.
- **Duplication** — is the rule already carried, in full, by a skill,
  `AGENTS.md`, a folder README, a deny-hook or a CI test? A duplicate is a
  drop, not a trim. Read the suspected carrier before deciding; near-identical
  wording in two places is the tell that one was written without checking the
  other.

Report each finding with the evidence that established it, not as an assertion.

# Axis 2 — placement

The test is not "is this true" or "is this useful". It is:

> **Does this have to be known *before* you would know to look it up — in
> *every* session?**

Yes → memory. No → it belongs wherever its trigger already fires. Almost
everything fails this test, which is the point: memory is for the narrow class
where discovering the rule too late has already cost you something (a hook
denial that mangled the index, a destructive flag, a prohibition whose damage
is silent).

| What it is | Home |
| --- | --- |
| Creation-time obligation when filing a bead | `stellata-beads` skill |
| Fires on a nameable task trigger (measuring, reviewing, merging) | the skill whose description matches that trigger |
| A procedure you would naturally go and look up | the owning folder README, or `docs/` |
| Specific to one piece of work | the bead — description, notes, or close reason |
| Project-wide and genuinely every-session | `AGENTS.md` — **check the cap first** |
| A universal preference, true in any repo | user-level `~/.claude/CLAUDE.md` |

**The AGENTS.md cap is a real constraint, not a formality.**
`tests/agents-md-size.test.ts` holds it at 360 lines / 17.5 KB and it runs
close to full. Check the headroom before proposing anything land there; a bump
is the user's decision, so surface it as a question rather than trimming
something else to make room.

**Dropping without leaving a hook** is safe only when retrieval is already
covered by something that fires on the same trigger. A skill *description*
counts — descriptions are listed every session, so a well-worded one is the
retrieval mechanism. So does `AGENTS.md` text, a `PreToolUse` hook that denies
with the rule in its message, or a CI test that fails on the violation. Nothing
else does: a doc with no pointer is not retrieved.

Where a hook is still needed, it must carry enough detail to be recognisable
**from the symptom**, not from the solution — the session that needs it does
not yet know what it is looking for.

# Axis 3 — wording

Keep **rule + why + how-to-apply**. Cut everything that is a record of how the
rule was learned:

- Incident narrative, dates, PR numbers, quoted conversation. The rule is the
  content; the incident belongs in the commit message that changed the memory.
- Enumerations of instances — keep one representative, not the full list.
- `file:line` references, which rot on the next refactor.
- Anything the destination doc or skill already states. A memory that has been
  reduced to a hook should not also summarise what it points at.

A memory that grew to several hundred tokens is almost always a rule wrapped in
its own case history. Write the rule that catches the **class**.

# Categories to sort into

**Drop** — content lives elsewhere (search bd first), or a time-bound note that
has aged out. **Trim** — rule + why + how-to-apply survive, history goes.
**Consolidate** — two memories that cross-reference each other in every
paragraph are one memory. **Move** — long procedure out to the owning doc or
skill, memory shrinks to a routing hook (or disappears, if a skill description
already covers retrieval). **Keep** — passes Axis 2 as written.

# Bead grooming

Survey via `bd list --status=open --limit=0 --json`; tree output paginates
poorly, so script the grouping in python (parent/child via
`dependencies[].type` of `parent` or `parent-child`).

1. **Duplicates** — `bd close <id> --reason='duplicate of <other>'`.
2. **Strays** — reparent with `bd update <id> --parent <epic>`. Every non-epic
   bead should have an epic ancestor, so a parentless task or feature *is* the
   signal. A feature that has acquired children is a stray too — promote it
   with `--type=epic` rather than reparenting. `--parent` refuses to overwrite
   an existing `related` edge to the same id; `bd dep remove <a> <b>` first.
3. **New epics** — when 3+ coupled beads should land together. Create it and
   name the design-gate child in its description.
4. **Orphaned children of closed epics** — reparent to the surviving parent.
5. **Re-prioritisation** against `stellata-beads` [Prioritisation](/.claude/skills/stellata-beads/SKILL.md#prioritisation). Research
   and "investigate" tasks at P1 go to P2; code-quality children default to P3
   unless coupled to in-flight P1/P2 work.
6. **Defer candidates** — `bd defer <ids...>`. Recurring: the mobile epic and
   its children, public site / FAQ, far-out layers, parametric-on-focal-star
   epics, non-critical chart polish, "someday" UX decisions.

Confirm before executing: research-stage P1 → P2 moves, whether cleanup tasks
are still live, and whether to defer a whole epic or only its children.

`bd orphans` is a different sense of the word and its list is mostly false
positives here — the `beads` skill's "`bd orphans`" section means the other sense of orphan
before going near it, and never `--fix`.

# The report

Lead with the budget table, then the staleness findings with their evidence,
then one verdict row per memory with before and after token counts, then the
totals as `N memories / X tok → M memories / Y tok`. State the savings per
session — that is the number the decision turns on.

Flag separately anything that needs the user's call rather than yours: a cap
bump, a destination that would grow a skill substantially, a rule you think is
wrong rather than merely misplaced.

# Executing, once approved

Memory writes are `bd remember "<content>" --key <slug>`, which updates in
place, and `bd forget <key>`. There is no file flag — content must be an inline
string, so single-quote it and keep apostrophes out of the text.

Do the file edits (skills, docs, READMEs) **before** the memory rewrites, so a
hook never points at a destination that does not exist yet.

**Sweep for references whenever a key is dropped or renamed** — `[[wikilinks]]`
in the surviving memories, and mentions in docs and skills. Note that
`tests/doc-pointer-resolution.test.ts` scans `.claude/skills` for
`<path>.md#<slug>` pointers, so a section you delete from a doc fails CI
if a skill still cites it. That is the safety net for doc moves; it does not
cover memories, which nothing checks.

Run the full `pnpm test` before pushing — the README-size pins move when docs
move. Verify with `bd memories` and `bd ready` afterwards:
both should be meaningfully shorter and reflect actual scope.

Memory writes persist to local Dolt immediately but reach the remote via
`bd dolt push`, which the pre-push git hook runs. A grooming pass that only
touches memories, with no `git push` after it, needs that command by hand.
