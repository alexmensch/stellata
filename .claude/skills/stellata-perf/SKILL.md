---
name: stellata-perf
description: Take a GPU frame-cost measurement with the human-armed headless perf runner (`pnpm run perf`) — the arm protocol, the flags, how to read a row, how to tell a real regression from a warm machine or a two-valued frame, where results go. Use when asked to measure, price, baseline or compare render cost, when reading an archived run or a pin verdict, when a perf number looks wrong or a row was refused, and before stating any perf number in a PR body or a bead. Also covers § Recording for the other instrument that writes into `.perf-runs/` — `pnpm run survivors`, the non-clock survivor-count read — so load it before running that or citing its output too.
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

**Which run a PR owes is its tier** (`RELEASING.md` § Perf pin owns the
table). Tier 0 — the diff reaches no per-frame code — runs nothing and
argues reachability in prose; do not arm for it. Tier 1 — per-frame code
touched, draw counts and pass structure unchanged — is `--mode dwell
--scenario mw120,sol --backend webgpu --against-pin scripts/perf/pins/<slug>.json`,
two contexts and ~4 min, read against the committed pin (whose run opens
with those two contexts, so the rows compare at equal position; the eight
pin rows it does not visit print as not measured and fail nothing). Tier
2 — passes, buffers, draw counts, the catalogue
or the instrument — is the full cold pin below. Arming for a sweep the
diff cannot justify is the cost this tiering exists to stop: it spends
Alex's arm and 25 minutes to re-read a number the pin already holds.

## Never

- **Appearance, layout, UX.** The runner reads clocks only — GPU timestamps
  and rAF wall-clock deltas — and never a pixel. Looks are checked by Alex in
  the browser.
- **Starting a dev server, or hunting for one.** Do not probe ports, read
  `lsof`, or curl candidate URLs to discover where the app is served. Name the
  worktree the run must measure and assume `--url http://localhost:5173`
  serves it; Alex starts that server and says so only when the port differs.
  Asking for a port he has not volunteered buys a round trip and nothing else.
- **Naming `.perf-go` in any tool call.** The guard denies every Bash command
  containing the string and every Write/Edit of the marker, whether or not the
  same call launches anything. Need it in a commit message or a PR body? Use
  `git commit -F <file>` / `gh pr create --body-file <file>`; need to search
  for it? Use the Grep tool. The guard's deny reason IS the protocol; do not
  work around the hook.

## Protocol — announce → arm → run, one run per arm

1. Say what you want to measure and why, with the exact command you will
   run, and name the worktree whose dev server the run needs — assuming
   port 5173 unless Alex has named another.
2. Start `bash scripts/perf/arming/await-go.sh` in the background (Bash
   `run_in_background`). It polls every 15 s for up to an hour and prints one
   line when a fresh marker exists. The poll and the runner both resolve the
   marker at the top level of the checkout they are launched from — from a
   worktree, the worktree root, not the main checkout — so the announcement
   names which root to arm.
3. When it reports ARMED, **launch the runner as a background process too —
   Bash `run_in_background`, always, whatever the mode.** A foreground Bash
   call is capped at 10 minutes and the harness kills it there; every mode
   worth arming for outlives that (a pin run is 15–25 min, a `--scenario all`
   differential 18–21), so a foreground launch dies partway through. It costs
   the arm, not just the run: the runner deletes the marker *before* the browser
   starts, so the launch is spent whatever happens after. Poll the output
   file for progress and read it when the process exits.
4. The runner deletes the marker before launching the browser — one arm
   authorises one launch, success or not. A second run means a second
   announce. Never re-run on a killed or failed launch without re-arming.
5. Say in the announcement that the machine has to stay idle for the run
   (~2 min at the defaults). Foreground work on the same GPU widens `iqrMs`
   tenfold and walks the baseline; such a run is discarded, not read. Ask
   whether anything heavy is running — a background data pull counts — rather
   than assuming idle.

## Flags

`scripts/perf/README.md` § Invocation is the reference. The shapes:

- `pnpm run perf -- --scenario sol --passes localDepth,reduction --budget-ms 90000`
- `pnpm run perf -- --scenario all --backend webgpu`
- `pnpm run perf -- --mode probe` — adapter strings, timer-query presence and
  the rAF period, no sweep.
- `pnpm run perf -- --mode dwell --scenario mw120 --frames 240` — the whole
  frame rather than per-pass prices. Cheap; the one to reach for when the
  question is "did the frame get slower". A WebGPU dwell prints three
  clocks — `raf-delta` wall, `gpu-timestamp` (the render passes,
  `gpu.frame`) and `gpu-compute` (the compute passes: compaction every
  frame, the extinction prepass on recompute frames) — never summed, and
  the counts of submits / command buffers / render passes / compute passes
  per frame. A compute dispatch's price is read off the compute row, not
  off a differential; at a camera-idle canon vantage that row is the
  compaction alone.
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
- `pnpm run perf -- --mode dwell --scenario all --backend both --cooldown-ms 120000 --json <run> --pin scripts/perf/pins/<slug>.json`
  — take the perf pin, cold: one launch, idle between contexts, every
  context state-guarded. `--against-pin <path>` prints the verdicts a
  render-path PR pastes into its `## Perf` section. Only the GPU-stream p50
  is marked on the frame row, and the compute-stream p50 on the
  `<scenario>|webgpu|compute` row beside it; every WebGL2 row reads `·`
  ungated. A `✗` exits 1, and so does a refused row — a run whose rows were
  all refused shows a table with no `✗` in it. Taking the pin in the same
  run as `--against-pin` needs `--accept <row>:<bead>` for each `✗` — the
  compute row under its own key — or nothing is written.
  Rules: `RELEASING.md` § Perf pin; mechanics: `scripts/perf/pins/README.md`.
- `pnpm run perf:pin -- <run.json>... [--pin <path>] [--accept <row>:<bead>]... [--dry-run]`
  — the pin from saved run files, offline: no browser, no arm. **A pin run
  refused for one row is never re-armed.** Name every saved run of the same
  commit, in any order; each row comes from the newest run that held it
  steady, and only a row steady in no run refuses. A refused `--pin` run,
  a Tier 1 `--against-pin` run of the same commit, or a mark you have
  decided to accept all become a keystroke here. `--dry-run` first: it
  prints the rows, their runs and the verdicts against the pin being
  replaced. `scripts/perf/pins/README.md` § From saved runs.
- `--headed` for a headed control run. Headed and headless never compare.

A branch predating PR 469 has no `scripts/perf` at all, so measuring it means
rebasing onto main first. The fallback for such a branch, or for a Safari
sweep, is the in-browser `debug.priceFrame()` with the debug panel **closed**.

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

Per mode (`scripts/perf/dwell/README.md`, `scripts/perf/README.md` § Sweep
mode, `scripts/perf/diff/README.md` § Reading the table):

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

## Three things that look exactly like a regression

A mark in the verdict table, a refused row, and a tripled frame each have a
benign cause that presents identically. Separate them from the run's **own
samples** before accepting a number or fixing anything. Read `dwell.gpuMs` from
the run JSON — min, p10, and the quarter medians — before writing a word about
cause; `gpuStats.p50` alone cannot tell any of these apart.

**The discriminators, in order of strength:**

- **Throughput arithmetic, before any theorising.** 240 frames × 52.8 ms is
  12.7 s of GPU work inside a 4.0 s dwell whose wall p50 was 16.6 with no
  dropped frames — impossible, therefore not per-frame work. One
  multiplication.
- **The shape of the quarters.** Monotone settle = warm machine. Alternating =
  a genuinely two-valued frame. Flat = trust the number.
- **The floor.** Per-frame code costs every frame and lifts the whole
  distribution, so a real regression moves `min` and `p10`. A warm run has an
  unmoved floor with only the top raised. A bimodal frame has *two* floors — a
  `min` with `p10` a thousandth above it is a population, not an outlier.
- **`min`/`max`, never the p50, on a bimodal counter.** Across 25 archived
  `earth` dwells `renderPasses` min/max is 4/10 and submits 4/12, identical;
  only the median moved. "Six extra render passes" was a duty cycle crossing
  50%.
- **The `emptyPass` control row, read before any other row.** It is the noise
  floor; a ±9 ms one makes every sub-10 ms row in that run meaningless.
- **IQR against the pin's.** Both contexts noisy says instrument; one context
  noisy plus a mechanism that predicts two costs says bimodal.

**Warm machine.** Never run the test suite in the minutes before arming. Rule
out the scene first, it is cheap: exposure limitMag, recordCount, pass counts
and `bufferMpx` must all match the pin, which is what leaves instrument state
as the only candidate. A cold re-arm settles it.

**Bimodal frame.** Fix with **more frames**, not a re-arm at the same count —
enough that several full adaptation-park cycles land in each quarter. `--no-park`
is not the lever: it is refused outside `--mode differential` and changes the
setup the pin was taken in.

**A large GPU-stream move — cross-check on `--method raf-delta`.** The two
clocks can disagree in *sign*, and the wall clock is the one that cannot
straddle frames. Where the reduction chain draws under the exposure pin the
frame has two classes, and the GPU stream samples only the readback frames, so
its median follows the readback duty cycle rather than the work: pinned across
seven cadences at `earth`, the median steps 13.20 ms to 56.19 as the share of
readback frames crosses a half, wall p50 flat at 16.70 throughout.

`--baseline` and `--against-pin` now **refuse** a pair whose readback rates
moved on a split frame, so this mostly arrives as a refusal rather than as a
number you have to disbelieve — `scripts/perf/dwell/README.md` § Dwell mode
carries the bound and why it is gated on the frame being split. Two gaps the
guard leaves: a pin carries no counters of its own, and a rate approaching 1
erases its own evidence as every frame becomes a readback frame. So a large
GPU-stream move still earns the wall-clock cross-check. A wall-clock
differential near one refresh interval is blind to a 2 ms move but cannot miss
a 30 ms one; get the positive control from the same run rather than arguing
for it.

`stateGuard` cuts neither way: `steady` is not evidence a run is sound (it does
not catch a within-dwell ramp), and `trending` is not evidence of a defect.
Read the quarters.

**Two habits that save an arm.** The archived `.perf-runs` JSON in the main
checkout is first-hand data and answers most of this with no arm at all — read
it first, and check which render path it measured before reading its absolute
numbers as a level: the contribution gating landed 2026-09-13 and moved `sol`,
`earth` and `lg` by 9.90, 3.37 and 0.41 ms, so archives either side of it are
not each other's comparison. And where the mechanism could be your own
feedback loop oscillating,
rule that out in a **test**, offline, not in prose: closing the loop against a
statistic that follows it proves a fixed point in seconds.

Arming costs Alex an idle machine, so protect it: do nothing heavy first, and
say in the announcement what has run recently.

## Recording

Two commands write here, and this section governs both: `pnpm run perf`, and
`pnpm run survivors` — the non-clock survivor-count read, which needs no arm
(`scripts/perf/README.md` § Survivor counts).

Write every run under the `.perf-runs/<date>/` of **the checkout you will
commit from** — the `--json` path. Never the
home directory, never `/tmp`, and never another checkout's `.perf-runs/`: a
run written into the main checkout while you work in a worktree is invisible
to that worktree's `git status`, so nothing will ever prompt you for it.

A `tee` of the console alongside it is a local convenience only: `*.log` is
ignored repo-wide, so `git add` refuses it and the archive holds none. The
`.json` carries the raw per-frame samples the console merely summarised.

**Then `git add` it, in the PR that cites it.** This is a step, not a
property — the folder being tracked commits nothing by itself, and the run
dies with the worktree if you skip it. Do it in the same commit as the work
the run justifies, or its own; `.perf-runs/README.md` carries what a run file
is and is not.

**Before you quote a `.perf-runs/<date>/<file>` path anywhere** — a bead note,
a PR body, a commit message — confirm it is tracked:

```
git ls-files --error-unmatch .perf-runs/<date>/<file>
```

A non-zero exit means the path resolves on your machine and nobody else's, and
every citation you are about to write is already broken.

Results go to the bead's notes with the `.perf-runs/<date>/<file>`
path, never into a README. Paste the table and the adapter block, and say which
vantage, backend, method, headless flag and buffer size the run used.
