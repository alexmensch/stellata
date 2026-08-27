# Hard requirements

Never commit or push to `main`, or to any branch this session did not
create. Diff size is never a justification. One new worktree per PR.

Merging needs explicit per-PR approval, separately from opening the PR.

Read a folder's `README.md` before editing, debugging, or planning
against files in it. Investigation grep counts as a code read.

Default to no code comment. A comment earns its keep only when its
absence would cause a wrong call and the reasoning is absent from the
code rather than restated by it.

Extract a second usage; do not wait for a third.

State the camera vantage and the clock offset behind any claim that
something is negligible or invisible. Without both it is not a claim.

Route wall-clock time mid-animation through `Stellata.getT()`, never
`Date.now()`.

Wire every `bus.on(...)` unsubscribe into dispose, in the same diff.

Use `bd` for task tracking, never the `todo` tool or a markdown list.
