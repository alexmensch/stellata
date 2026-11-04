# Archived perf runs

Every `pnpm run perf` invocation worth citing, as the runner wrote it: the
`--json` record, under `<date>/`. Written here by the protocol in
[Recording](../scripts/perf/README.md#recording), which also says the part the tracked
folder does not do for you: the file reaches main only if the PR that cites
it adds it.

**The console log is not archived.** `*.log` is ignored repo-wide, so a `tee`
of the run is a local convenience for the session that took it and nothing
more — `git add` refuses it rather than silently keeping it. Everything a
later reader needs is in the run file: the envelope, the verdict inputs and
the raw per-frame samples the console only ever summarised.

**Every run file is gzipped JSON, `<slug>.json.gz`.** `--json` refuses any
other path, and the tooling that reads a run takes it as it is
([JSON output](../scripts/perf/README.md#json-output)). By hand:
`gzcat <path> | jq …`; from a script, `readJsonFile` in
`../scripts/perf/run-file.ts`.

`pnpm run survivors` writes here too — the survivor-count read, which is not
a cost instrument and takes no clock. Its file is schema
`stellata-survivors/1`: a `run` block carrying the same provenance the
runner's does, plus the viewport and device pixel ratio every vantage was
visited at, and one row per vantage. **Survivor counts move with viewport and
field of view** (the frustum test is what produces them) and with the commit
whenever the tiering or the cull changes, so `run.viewport` and
`run.git.commit` are what decide whether two survivors files are each other's
comparison.

`2026-09-18/8cg574-survivors-canon.json.gz` predates that block and is `{url,
rows}`; its envelope is recorded in `stellata-8cg.57.4`'s notes, and the
archive being write-once is why it stays that way.

## Evidence, not canon

**A run file has no authority.** It is one measurement on one machine at one
commit. The artifact with teeth is the pin, `../scripts/perf/pins/<slug>.json`,
and the rules that give it teeth are [Perf pin](../RELEASING.md#perf-pin). A row here
that disagrees with the pin is a row to explain, never a pin to replace —
re-pinning is `pnpm run perf:pin`, a deliberate act with its own acceptance.

Nothing reads this folder at build time, and one test does:
`../scripts/perf/floors/floors.test.ts` derives the band floors from named
runs here ([The CPU floor](../scripts/perf/floors/README.md#the-cpu-floor)). The
folder exists so a session can answer a cost question without spending an
arm, which
`.claude/skills/stellata-perf/SKILL.md` tells every session to try first.

## Reading one without being misled

Absolute numbers are comparable only within the envelope the run recorded —
`method`, `bufferMpx`, headed vs headless, browser, backend, `params.pacing`
(absent reads `raf`), and a dev server against a production build. The record
carries all of them; check them before differencing two files.

Traps the archive is full of, all documented at
`../scripts/perf/dwell/README.md`:

- **`vsyncClamped: true` invalidates a dwell's wall clock.** It measured the
  display's cadence, not the frame.
- **On a split frame the GPU-stream median follows the readback duty cycle.**
  Two files whose `readbackPerFrame` differ are not each other's comparison.
- **Two pacings never compare.** A GPU-paced dwell holds the GPU clock at
  max; an rAF-paced one lets it idle down.
- **Under GPU pacing the GPU stream over-reads.** With two frames in flight
  the summed pass spans read 1.25–1.69× throughput; the throughput mean is
  the frame's GPU cost, and the wall median follows the burst pattern.

A run also measures whichever render path existed at its commit, and the path
has moved repeatedly — `run.git.commit` in the file is what says which.

## Names

`<date>/<slug>.json.gz`, the slug naming the bead or question the run
answers (`8cg-58-2-dwell-on`, `cns-m11-recompute-all`). Files are
write-once: a re-measurement is a new file, never an edit, so the archive is
append-only and a path quoted in a bead note stays valid. **A
`<date>/<slug>.json` quoted in a bead note or a PR body lives at the same
path plus `.gz`.**

That last clause is a promise about a **committed** path. An uncommitted file
resolves on one machine, and every note quoting it is already broken; check
with `git ls-files --error-unmatch <path>` before you quote one.

## Clock logs

`<date>/<slug>.powermetrics.txt.gz` is the GPU clock beside a run: `sudo
powermetrics --samplers gpu_power -i 100`, taken by Alex for the length of
one or more runs, one sample per 100 ms of active frequency, per-state
residency, idle share and power. It answers what no run file can — whether
the governor held the clock, and at what busy share — which is the evidence
GPU pacing rests on ([Pacing](../scripts/perf/dwell/README.md#pacing)). The
timestamps have second resolution, so a run is placed by its busy blocks:
contiguous samples under 50 % idle, each matched to a context by order and
by the run file's `startedAt` / `finishedAt`.

**Commit it trimmed and gzipped.** Keep the log's header and every sample
inside the span of a run it covers, `startedAt` − 5 s to `finishedAt` + 5 s
off that run's file (powermetrics stamps in the same UTC); the rest is the
machine idling between arms. The text is mostly repeated headers and
gzips about 48×. Read one with `gzcat <path> | less`. Nothing in the tree
parses these; the runs that cite them say which busy block is which.
