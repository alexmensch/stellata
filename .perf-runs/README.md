# Archived perf runs

Every `pnpm run perf` invocation worth citing, as the runner wrote it: the
`--json` record, under `<date>/`. Written here by the protocol in
[Recording,](../scripts/perf/README.md#recording) which also says the part the tracked
folder does not do for you: the file reaches main only if the PR that cites
it adds it.

**The console log is not archived.** `*.log` is ignored repo-wide, so a `tee`
of the run is a local convenience for the session that took it and nothing
more — `git add` refuses it rather than silently keeping it. Everything a
later reader needs is in the `.json`: the envelope, the verdict inputs and
the raw per-frame samples the console only ever summarised.

`pnpm run survivors` writes here too — the survivor-count read, which is not
a cost instrument and takes no clock. Its file is schema
`stellata-survivors/1`: a `run` block carrying the same provenance the
runner's does, plus the viewport and device pixel ratio every vantage was
visited at, and one row per vantage. **Survivor counts move with viewport and
field of view** (the frustum test is what produces them) and with the commit
whenever the tiering or the cull changes, so `run.viewport` and
`run.git.commit` are what decide whether two survivors files are each other's
comparison.

`2026-09-18/8cg574-survivors-canon.json` predates that block and is `{url,
rows}`; its envelope is recorded in `stellata-8cg.57.4`'s notes, and the
archive being write-once is why it stays that way.

## Evidence, not canon

**A run file has no authority.** It is one measurement on one machine at one
commit. The artifact with teeth is the pin, `../scripts/perf/pins/<slug>.json`,
and the rules that give it teeth are [Perf pin](../RELEASING.md#perf-pin). A row here
that disagrees with the pin is a row to explain, never a pin to replace —
re-pinning is `pnpm run perf:pin`, a deliberate act with its own acceptance.

Nothing reads this folder at build or test time. It exists so a session can
answer a cost question without spending an arm, which
`.claude/skills/stellata-perf/SKILL.md` tells every session to try first.

## Reading one without being misled

Absolute numbers are comparable only within the envelope the run recorded —
`method`, `bufferMpx`, headed vs headless, browser, backend, and a dev server
against a production build. The record carries all of them; check them before
differencing two files.

Two traps the archive is full of, both documented at
`../scripts/perf/dwell/README.md`:

- **`vsyncClamped: true` invalidates a dwell's wall clock.** It measured the
  display's cadence, not the frame.
- **On a split frame the GPU-stream median follows the readback duty cycle.**
  Two files whose `readbackPerFrame` differ are not each other's comparison.

A run also measures whichever render path existed at its commit, and the path
has moved repeatedly — `run.git.commit` in the file is what says which.

## Names

`<date>/<slug>.json`, the slug naming the bead or question the run
answers (`8cg-58-2-dwell-on`, `cns-m11-recompute-all`). Files are
write-once: a re-measurement is a new file, never an edit, so the archive is
append-only and a path quoted in a bead note stays valid.

That last clause is a promise about a **committed** path. An uncommitted file
resolves on one machine, and every note quoting it is already broken; check
with `git ls-files --error-unmatch <path>` before you quote one.
