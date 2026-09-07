# bd workflow — procedures that fire on a trigger

Long-form bd procedures that apply only when a specific trigger fires,
kept out of bd memory so they don't cost context in every session. The
skill or memory that references each section carries the trigger; this
file carries the steps.

Everyday bd facts — persistence, concurrent-session ownership,
prioritisation, recovery — live in the `stellata-beads` skill; generic
`bd` command syntax lives in the `beads` skill.

## Grooming

**Trigger:** a request to prune memories, groom beads, or "check what's
worth retiring".

Two paired passes. Memories load in every session via `bd prime`; open
issues drive `bd ready`. Bloat in either silently degrades how useful bd
is. Survey first, present a categorised plan, wait for approval, then
execute mechanically in batches.

### Memory pruning

Categorise each memory into drop / trim / consolidate / keep.

- **Drop** when the content lives elsewhere: a relevant bead (search bd
  first), canonical docs (`SCIENCE.md`, `RELEASING.md`, `docs/*`,
  `AGENTS.md`), or a time-bound note that has aged out. Dropping without
  leaving a hook is only safe when retrieval is already covered by
  something that loads every session — AGENTS.md text, the readme-guard
  hook, or a CI test that fails on violations.
- **Trim** by keeping rule + why + how-to-apply. Cut historical incident
  logs, exact dates, sub-task IDs, and `file:line` paths that belong in
  code. For a memory that groups several rules of one shape, keep one
  representative, not the full enumeration.
- **Consolidate** non-overlapping memories covering the same operational
  area into one structured memory with sections. Two memories that
  cross-reference each other in every paragraph are one memory.
- **Move** long procedural content into this file (or the doc that owns
  the topic) and shrink the memory to a routing hook naming the trigger
  and the destination. A doc with no pointer is not retrieved — the hook
  *is* the retrieval mechanism, so it must carry enough detail to make
  the trigger recognisable from the symptom.

Decision rule: if it isn't relevant to every session, it doesn't belong
in memory. Beads and docs are the right home for area-specific content.

When a memory key is dropped or renamed, sweep the surviving memories
for `[[wikilinks]]` pointing at it.

### Bead grooming

Survey via `bd list --status=open --limit=0 --json`; the tree output
paginates poorly, so script the grouping with python (parent/child via
`dependencies[].type` of `parent` or `parent-child`).

Categories:

1. **Duplicates** — `bd close <id> --reason='duplicate of <other>'`.
2. **Strays** — reparent with `bd update <id> --parent <epic>`. Target
   state is that every non-epic bead has an epic ancestor, so a
   parentless task/feature *is* the stray signal. A feature that has
   acquired children is a stray too — promote it with `--type=epic`
   rather than reparenting it. Note that `--parent` refuses to overwrite
   an existing `related` edge to the same id; `bd dep remove <a> <b>`
   first.
3. **New epics** — when 3+ coupled beads should land together. Create
   the epic and call out the design-gate child in its description.
4. **Orphaned children of closed epics** — reparent to the surviving
   parent.
5. **Re-prioritisation** against the priorities in the `stellata-beads`
   skill. Research / "investigate" tasks sitting at P1 go to P2;
   code-quality children default to P3 unless coupled to in-flight
   P1/P2 work.
6. **Defer candidates** — `bd defer <ids...>`. Recurring deferrals: the
   mobile epic and its children, public site / FAQ, far-out layers,
   parametric-on-focal-star epics, non-critical chart polish, "someday"
   UX decisions.

Confirm before executing: research-stage P1 → P2 transitions, whether
cleanup tasks are still live, and whether to defer a whole epic or just
its children.

Verify with `bd ready` afterwards — it should be meaningfully shorter
and reflect actual scope.

## Bug-sweep handoff

**Write the state into the beads first.** `bd prime` plus `bd ready` runs
every session, so a bead is what the next session actually opens. Root
cause and the evidence behind it, candidate fixes, acceptance, `bd dep`
links — and the one most often left out, that a decision is still OPEN,
since a later session reads a provisional field as settled unless a note
says otherwise.

**Trigger:** the end of a bug-fix session leaving state that has no bead
to live in. A queue whose beads are complete needs no prompt, and one
that restates them is a second copy to go stale.

Three things qualify, and they are all a prompt carries:

1. An in-flight PR's review state, with its branch and worktree.
2. The skipping list — what not to re-litigate, where the reason sits in
   a closed bead's close reason or an epic note rather than anywhere
   `bd ready` surfaces.
3. A session-local ordering across several beads.

Code block so it copy-pastes. Name bead IDs and let the next session read
them; never paraphrase a description into it.

## Tagging — labels, metadata, external-ref

**Trigger:** attaching structured information to a bead.

- **Labels** (`--labels`, `bd tag`; remove with `bd label remove
  <ids...> <label>`) are flat multi-valued tags. Filter with `bd list
  --label X`, `--label-any`, `--label-pattern 'pr-*'`, or `bd query
  "label=X"`. Children inherit parent labels.
- **`--external-ref`** (`gh-45`) is a single semantic anchor per issue,
  and is NOT queryable via `bd query`.
- **Metadata** (`--metadata '{...}'`) is typed JSON, filtered via
  `--metadata-field key=value` and `--has-metadata-key`.

Conventions: PR numbers become the label `pr-<num>` (bare digits clash
with bead IDs); URLs, DOIs, and dashboards go in metadata keyed by
source type. Labels are lowercase kebab-case, metadata keys lowercase
snake_case. Check `bd label list-all` before coining a new label.

### Model-routing labels — every implementation bead carries exactly one

`needs-fable` and `opus5-ok` say which model to hand a bead to, and they
are the reason a scoping pass is not finished when the children exist:
filing a roster without them leaves the routing to be re-derived from
sibling usage, which is how two consecutive passes over the WebGPU
migration epic shipped 21 unlabelled children.

- **`needs-fable`** — diagnosis, design gates, and numerics under
  uncertainty. The work is deciding *what* to do: mechanism-hunting a
  perf cost, deriving a precision bound, weighing a tradeoff with no
  written recipe, interpreting a measurement into a go/no-go.
- **`opus5-ok`** — well-specified implementation. The work is *doing* a
  known thing carefully: porting a shader against an established
  pattern, wiring a knob, a mechanical deletion, a UI surface, running a
  measurement someone else already framed.

Split a bead rather than hedging: if the design half needs Fable and the
implementation half does not, that is the decompose-along-a-seam signal
from the bead-sizing rule in the `beads` skill, not a case for both labels.

**Do not put either label on an epic.** Children inherit parent labels
at creation, and a roster is almost always mixed — an epic-level label
silently mislabels every child filed under it afterwards.

**Converting a task to an epic: strip its model label in the same pass**,
before filing any child. The `beads` skill makes `--type=epic` the
trigger once a bead acquires children; the label removal
belongs at that same moment. A labelled *task* is correct right up until
it becomes a parent, at which point every child inherits its label
silently — and an inherited-wrong label is worse than a missing one,
because the roster looks complete and nothing prompts a re-read. Observed:
converting the star-pipeline port to an epic propagated `needs-fable` to
all eight children, half of which are specified implementation.

### Choosing the parent epic

The parent is a claim about **when the work must happen**, not about which
folder the code sits in. Two rules cover almost every case:

- **A defect reachable by a user on the shipped path** goes under
  `stellata-uadc` (Bugs).
- **A defect that only reproduces on a path still being migrated** goes under
  the epic doing that migration, and its cutover bead takes a `bd dep add` on
  it. That is what makes the graph say "this blocks cutover" instead of
  leaving a loose bug that cutover planning has to remember.

So establish which backend, renderer or vantage a report actually came from
**before** picking the parent — "pre-existing bug" and "blocks a cutover" are
different beads with different parents, and the difference is usually one
question to the reporter. Observed: a chart-mode teardown crash was filed
under Bugs on the assumption it was pre-existing, when it was WebGPU-only and
belonged under the migration epic as a cutover blocker.
