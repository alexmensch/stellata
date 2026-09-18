# Archived perf runs

Every `pnpm run perf` invocation worth citing, as the runner wrote it:
`--json` record plus a `tee` of the console log, under `<date>/`. Written
here by the protocol in `../scripts/perf/README.md` § Recording.

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
answers (`8cg-58-2-dwell-on`, `cns-m11-recompute-all`). Files are write-once:
a re-measurement is a new file, never an edit, so the archive is append-only
and a path quoted in a bead note stays valid.
