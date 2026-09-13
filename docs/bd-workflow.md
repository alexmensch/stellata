# bd workflow — procedures that fire on a trigger

Long-form bd procedures that apply only when a specific trigger fires, kept out
of bd memory so they don't cost context in every session. The skill that
references each section carries the trigger; this file carries the steps.

Everyday bd facts — persistence, concurrent-session ownership, prioritisation,
recovery, and the obligations that bind at `bd create` time — live in the
`stellata-beads` skill. Generic `bd` command syntax lives in the `beads` skill.
Grooming memories and the open bead graph is the `bd-grooming` skill.

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
