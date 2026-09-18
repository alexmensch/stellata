# Archived perf runs

Every `pnpm run perf` invocation worth citing, as the runner wrote it:
`--json` record plus a `tee` of the console log, under `<date>/`. Written
here by the protocol in `../scripts/perf/README.md` § Recording, which also
says the part the tracked folder does not do for you: the file reaches main
only if the PR that cites it adds it.

`pnpm run survivors` writes here too — the survivor-count read, which is not
a cost instrument and takes no clock. Its file is `{url, rows}` and nothing
else: no `run` provenance block, so the commit, adapter, viewport and device
pixel ratio behind its numbers are not in it. **Survivor counts move with
viewport and field of view** (the frustum test is what produces them), so a
survivors file is readable only alongside the bead note that records the
envelope. Say it there.

## Evidence, not canon

**A run file has no authority.** It is one measurement on one machine at one
commit. The artifact with teeth is the pin, `../scripts/perf/pins/<slug>.json`,
and the rules that give it teeth are `../RELEASING.md` § Perf pin. A row here
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

`<date>/<slug>.json` + `.log`, the slug naming the bead or question the run
answers (`8cg-58-2-dwell-on`, `cns-m11-recompute-all`). A `survivors` file is
the `.json` alone — that command tees no console log worth keeping. Files are
write-once: a re-measurement is a new file, never an edit, so the archive is
append-only and a path quoted in a bead note stays valid.

That last clause is a promise about a **committed** path. An uncommitted file
resolves on one machine, and every note quoting it is already broken; check
with `git ls-files --error-unmatch <path>` before you quote one.
