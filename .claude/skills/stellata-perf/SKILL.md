---
name: stellata-perf
description: Take a GPU frame-cost measurement with the human-armed headless perf runner (`pnpm run perf`) — the arm protocol, the flags, how to read a row, where results go. Use when asked to measure, price, baseline or compare render cost, and before stating any perf number in a PR body or a bead.
---

# Measuring frame cost with the perf runner

`pnpm run perf` boots the app in Playwright's full Chromium build, calls the
in-app `debug.priceFrame()` differential at a canon vantage, and prints the
table. Reference: `scripts/perf/README.md`. Interpretation authority:
`docs/render-rules.md` § Measurement canon.

## When

- Pricing a pass or a feature — before and after a renderer-touching change.
- Recording a baseline at the canon vantages.
- Any perf claim in a PR body. An unmeasured perf claim is a hypothesis and
  has to be called one.

## Never

- **Appearance, layout, UX.** The runner reads clocks only — GPU timestamps
  and rAF wall-clock deltas — and never a pixel. Looks are checked by Alex in
  the browser.
- **Starting a dev server.** Alex always has one running; `--url` targets it
  (a worktree server sits on another port).
- **Naming `.perf-go` in any tool call.** The guard denies every Bash command
  containing the string and every Write/Edit of the marker, whether or not the
  same call launches anything. Need it in a commit message or a PR body? Use
  `git commit -F <file>` / `gh pr create --body-file <file>`; need to search
  for it? Use the Grep tool. The guard's deny reason IS the protocol; do not
  work around the hook.

## Protocol — announce → arm → run, one run per arm

1. Say what you want to measure and why, with the exact command you will run.
2. Start `bash scripts/perf/await-go.sh` in the background (Bash
   `run_in_background`). It polls every 15 s for up to an hour and prints one
   line when a fresh marker exists.
3. When it reports ARMED, run the command. The runner deletes the marker
   before launching the browser — one arm authorises one launch, success or
   not. A second run means a second announce.
4. Say in the announcement that the machine has to stay idle for the run
   (~2 min at the defaults). Foreground work on the same GPU widens `iqrMs`
   tenfold and walks the baseline; such a run is discarded, not read.

## Flags

`scripts/perf/README.md` § Invocation is the reference. The shapes:

- `pnpm run perf -- --scenario sol --passes localDepth,reduction --budget-ms 90000`
- `pnpm run perf -- --scenario all --backend webgpu`
- `pnpm run perf -- --mode probe` — adapter strings, timer-query presence and
  the rAF period, no sweep.
- `pnpm run perf -- --mode dwell --scenario mw120 --frames 240` — the whole
  frame rather than per-pass prices. Cheap; the one to reach for when the
  question is "did the frame get slower". A WebGPU dwell also prints
  submits / command buffers / render passes / compute passes per frame.
- `pnpm run perf -- --mode dwell --scenario earth --backend webgpu --roundtrip localDepth`
  — dwell, hold the pass off for `--frames`, restore it, dwell again; prints
  the second against the first as a ratio. Pair it with `--roundtrip idle`,
  the time-matched control, in the same session.
- `pnpm run perf -- --mode sweep --scenario sol --scales 0.5,1,1.5,2` — what
  the frame is bound by (fill vs vertex/CPU), from the log-log slope.
- `pnpm run perf -- --backend both --scenario earth --mode dwell` — both
  backends, on the one clock they share. Pins `--method raf-delta` itself.
- `--json <path>` to save the run, `--baseline <path>` to diff against a
  saved one. Always `--json` a run worth citing: the table in your scrollback
  is not a record, and the raw samples are only in the file.
- `--headed` for a headed control run. Headed and headless never compare.

A flag the chosen mode does not read is **refused**, not ignored — `--method`,
`--passes` and the priceFrame knobs belong to `--mode differential`, `--frames`
to dwell and sweep, `--roundtrip` to dwell, `--scales` to sweep. Fix the
command rather than working
around it. `--json` and `--baseline` paths are checked before the marker is
consumed, so a typo costs no arm.

## Interpretation traps

**A non-zero exit means do not read the rows** — a tainted sweep still prints
its table, and exit 1 is the part that says the page threw inside the
measurement.

`docs/render-rules.md` § Measurement canon and
`src/client/debug/frame-cost/README.md` § Reading a row. The short form: a
`savedMs` under `noiseMs` or `bracketMs` did not resolve; `baselineLimitMag`
and `disabledLimitMag` must agree or the row priced a different scene; never
compare across `method`, `bufferMpx`, headed/headless, browsers, or a dev
server against a production build; never sum the column.

Per mode (`scripts/perf/README.md` § Dwell mode, § Sweep mode, § Comparing
against a baseline):

- **`vsyncClamped` true throws the dwell away.** A p50 sitting on any whole
  number of the display period the run measured, inside a spread tighter than
  6 % of that period (1 ms at 60 Hz), measured the panel rather than the
  frame — a frame that overran one interval and was held to the next is still
  the panel's number. Do not quote it; re-measure at a heavier vantage. The
  console line names the cadence the verdict was judged against (headless
  Chromium idles at 60 Hz, like a 60 Hz panel), and the GPU row is never
  clamped — no compositor pads a hardware timestamp.
- **A sweep with any clamped point reads `bound inconclusive`** — say
  inconclusive, don't quote the slope.
- **`savedMs` going UP is a regression**, not an improvement: the field is
  the pass's own price. `--baseline` prints `✗` for it; believe the mark
  over the field name.
- **A `~` is not "no change" — it is "not resolved".** The band is two sigma
  of the pair, so a real move smaller than the band reads the same as none.
- Rows `--baseline` refuses are not passes; they are comparisons that would
  have been invalid. Report the refusal, don't work around it.

## Recording

Write every run under `.perf-runs/<date>/` in the **main checkout** — the
`--json` path and a `tee` of the console log — never inside a worktree, the
home directory or `/tmp`. The worktree goes when its PR lands and the runs
would go with it; the main checkout persists and the folder is gitignored
there. From a worktree, run `git rev-parse --path-format=absolute
--git-common-dir` first (it prints `<main checkout>/.git`) and pass its parent
spelled out — the worktree guard rejects `$( )` in a command. Results go to
the bead's notes with the `.perf-runs/<date>/<file>` path, never into a
README. Paste the table and the adapter block, and say which vantage,
backend, method, headless flag and buffer size the run used.
