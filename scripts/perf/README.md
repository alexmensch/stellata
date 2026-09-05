# Perf runner — human-armed, Chrome only, clocks only

`pnpm run perf` boots the app in Playwright's full Chromium build, calls the
in-app `debug.priceFrame()` differential (`src/client/debug/frame-cost/`) at
a canon vantage through `page.evaluate`, and prints the table `console.table`
shows in the browser. It reads GPU timestamps and rAF wall-clock deltas and
nothing else — never a screenshot, never a pixel readback — so it is a cost
instrument and is never used for appearance or UX decisions. The
interpretation authority is `docs/render-rules.md` § Measurement canon; the
agent-facing procedure is the `stellata-perf` skill.

## Files

```
scripts/perf/
  run.ts                    The runner: preflight (flags → URL reachable →
                            marker consumed), launch, per-scenario loop,
                            exit codes. The only Playwright value import in
                            the tree; never imported by a test.
  args.ts (+ test)          Flags → RunArgs (node:util parseArgs), plus the
                            mode-compatibility check over the flags actually
                            typed.
  run-pure.ts (+ test)      The decisions around a launch: which clock a
                            backend request gets, which adapters disqualify a
                            run, how the probe reads, whether a marker arms.
                            Here rather than in run.ts so a test can import
                            them without launching a browser.
  scenarios.ts (+ test)     The five canon vantages as share blobs, and
                            scenarioUrl().
  page-protocol.ts          Every page.evaluate: boot, gate snapshot, adapter
                            probe, rAF probe, drawing-buffer read, the
                            priceFrame call, the dwell loop.
  measure.ts (+ test)       What each mode does to a settled page.
  schema.ts (+ test)        The on-disk record types, PERF_SCHEMA, and
                            assertPerfFile. Owns the adapter/scenario/mode
                            shapes the runner, the tables and the diff share.
  settle-pure.ts (+ test)   settleVerdict over one render-gate snapshot.
  dwell-pure.ts (+ test)    One dwell's percentiles and the vsync-clamp flag.
  sweep-pure.ts (+ test)    Measurement order, the log-log fit, fill/vertex
                            classification, the sweep bracket.
  diff-pure.ts (+ test)     Two runs differenced: bands, verdicts, and the
                            refusals that stop an invalid comparison.
  pin-pure.ts (+ test)      The perf pin: adapter slug, pinFromRun,
                            compareToPin and its floor, cadence and ceiling
                            rules. pins/<slug>.json is the committed pin.
  table-pure.ts (+ test)    Every text table. formatTable is the shared
                            width/alignment pass.
  await-go.sh (+ test)      The arm poller the agent runs in the background.
  perf-section-check.sh     The perf-section-guard workflow's check: a
    (+ test)                render-path diff needs a `## Perf` section with
                            every ✗ accepted. RELEASING.md § Perf pin.
  perf-go-lib.sh (+ test)   Marker name, path and freshness — the single
                            source, sourced by await-go.sh and
                            scripts/hooks/perf-guard.sh.
  perf-go-lib.ts            The same two scalars parsed out of the .sh for
                            run.ts and the tests, so no second copy of the
                            marker name or the hour can drift from the hook.
```

## Invocation

```
pnpm run perf -- [--scenario sol,earth,mw50,mw120,lg | all] [--backend webgl2|webgpu|both]
                 [--mode differential|probe|dwell|sweep] [--passes a,b]
                 [--method timer-query|timestamp|raf-delta]
                 [--budget-ms N] [--dwell-frames N] [--warmup-frames N] [--settle-frames N] [--no-interleave]
                 [--empty-passes N]
                 [--frames 240] [--roundtrip <pass>|idle] [--scales 0.5,1,1.5,2]
                 [--headed] [--width 1280] [--height 800] [--dpr 2] [--quiet-ms 5000]
                 [--json <path>] [--baseline <path>] [--cooldown-ms 0]
                 [--pin <path> [--accept <scenario>|<backend>:<bead>]...] [--against-pin <path>]
                 [--url http://localhost:5173] [--chrome-arg=<switch>]...
```

Defaults: Sol, WebGL2, differential, every present pass, the backend's best
clock, 1280×800 at dpr 2 (4.096 Mpx), headless. The priceFrame knobs
(`--dwell-frames`, `--warmup-frames`, `--settle-frames`, `--budget-ms`) pass
straight through; unset ones take priceFrame's own defaults. `--mode probe`
boots, settles and prints the adapter block and the idle rAF period without
a sweep.

`--empty-passes` is the `emptyPass` row's own knob: how many empty render
passes it adds while "disabled". One pass often falls under `bracketMs` and
the row does not resolve; raising the count tightens the bound on that many
boundaries together. Quote the total, not `savedMs` over the count — dividing
assumes the clears add, and consecutive clears with nothing drawn between them
are what a driver would coalesce (`src/client/debug/frame-cost/README.md`
§ Priced passes, `docs/render-rules.md` § 8).

`--frames` sizes a dwell (dwell and sweep modes); `--scales` is the sweep's
viewport set. `--warmup-frames` is shared: it is priceFrame's own warmup in
differential mode and the dwell's in the other two, defaulting to the same
`WARMUP_FRAMES` either way, since it exists to absorb the same clock ramp.

**`--backend both` runs each scenario twice, in separate contexts, and pins
`--method raf-delta`.** The two backends' best clocks are different
instruments — WebGL2's timer query against WebGPU's timestamp resolve — so
taking each one's best builds exactly the mixed-method table that must never
be compared. rAF wall time is the one clock both supply. An explicit
`--method` overrides the pin, and the run says it did.

**A flag the chosen mode does not read is an error, not a no-op.**
`--mode dwell --method timer-query` is refused rather than quietly stamping
the table `raf-delta`, and the same goes for `--passes`, `--budget-ms`,
`--dwell-frames`, `--settle-frames` and `--no-interleave` outside
`differential`, `--frames` outside dwell and sweep, `--roundtrip` outside
dwell, and `--scales` outside sweep. Only flags actually typed are checked,
so a default never trips it,
and `--warmup-frames` is exempt because every mode absorbs the same ramp.
The in-app instrument takes the same posture on a pin it cannot honour
(`src/client/debug/frame-cost/README.md` § Preconditions); a typed command
line is no improvement if the honoured-pin illusion survives it.

Exit codes: **0** ok · **1** a scenario failed, was tainted, priceFrame
refused, the adapter was software, or the JSON could not be written · **2**
bad flags, an unreachable URL, or an unusable `--json` / `--baseline` path
(marker untouched) · **3** not armed (marker absent or stale).

**Both output paths are proved usable before the marker is consumed.** A
`--json` directory that does not exist, or a `--baseline` that is missing,
malformed or a foreign schema, would otherwise surface as an exception
thrown over the finished samples — discarding minutes of measurement and
costing a fresh human arm to redo. So they are flag errors like any other:
exit 2, nothing launched, marker untouched. The baseline is read once, at
that point, and the parsed file is what the diff runs against.

**A tainted scenario exits 1 even though its rows printed.** A page error
inside the sweep means the numbers describe a broken page, and the exit code
is the only part of a run a caller reads without parsing.

One-time setup: `pnpm exec playwright install chromium` — the runner uses
`channel: 'chromium'`, the full build with a GPU process, not the headless
shell.

## Human-armed

A marker file `.perf-go` at the repo root (gitignored) authorises exactly one
launch. **Only Alex creates it.** `scripts/hooks/perf-guard.sh`, a PreToolUse
hook on Bash / Write / Edit / NotebookEdit, enforces that as **two
independent gates**:

1. **The marker gate.** Any tool call that so much as names `.perf-go` is
   denied — a Bash command containing the string, or a Write/Edit whose
   target is the marker. Unconditional, and deliberately blunt: it does not
   ask whether the same call also launches.
2. **The launch gate.** A recognised launch — `pnpm|npm|yarn|bun [run] perf`
   with flags anywhere, `tsx|node|npx|bun|deno … scripts/perf/run[.ts]`,
   `./scripts/perf/run.ts`, `pnpm exec|dlx` forms — is denied while the
   marker is absent or older than an hour.

**Independence is the point.** As one condition — deny a command that both
arms and launches — the whole gate rested on recognising the launch, and a
spelling it missed (`npm run perf`, or a launch on its own line in a
multi-line command) took the self-arm through with it. Split, a missed launch
spelling degrades to the runner's own exit 3, because there is no route to a
marker for it to pair with. `cd scripts/perf && tsx run.ts` is the known
residual: matching a bare `run.ts` would deny unrelated commands, and
over-denying a launch is worse than deferring to exit 3.

Newlines are flattened to `;`, not to spaces, so a line boundary stays a
command boundary. The cost is a false positive: a multi-line commit message
quoting a launch spelling at the start of a line reads as a launch. Take the
same route the marker gate names for that — `git commit -F <file>`.

**Legitimately naming the marker** — a commit message, a PR body, a search —
goes around the Bash gate rather than through it: `git commit -F <file>` and
`gh pr create --body-file <file>` (the route a worktree session already
needs, since the worktree guard rejects `$( )` and heredoc bodies), and the
Grep tool for searching. The deny reason carries both.

**The hook fails closed.** An unhandled error would exit non-zero, which the
harness reads as a broken hook and lets the call through — so an `ERR` trap
denies, an unreadable marker age denies, and a missing `jq` falls back to a
bare exit 2 (the harness's other blocking spelling) rather than to silence.
That is the opposite posture from `prime-guard`, which fails open on purpose:
a missing memory is survivable, an unasked-for GPU run is not.

Reading `run.ts`, running the pure tests, `await-go.sh`, and
`perf-go-lib.sh` all pass through.

The agent's protocol, which the deny reason carries verbatim:

1. Announce what is to be measured and why, with the exact command.
2. Start `bash scripts/perf/await-go.sh` in the background. It polls every
   `PERF_GO_POLL_S` (15) s for up to `PERF_GO_TIMEOUT_S` (3600) s, prints
   one line when a fresh marker exists (exit 0), or exits 1 on timeout.
3. Proceed only when it reports the marker.
4. Never create the marker.

`run.ts` consumes the marker before the browser launches: absent → exit 3;
stale → deleted, exit 3; fresh → deleted, then launch. One arm is one launch
attempt, whatever happens after.

The runner never starts a dev server either. Alex always has one running;
`--url` targets it, and a worktree's server sits on another port. An
unreachable URL exits 2 before the marker is touched.

## What a run does

Per scenario, in its own browser context at the requested viewport and
device pixel ratio, with `localStorage['stellata.info-dismissed']` and
`sessionStorage['stellata.mobile-advisory-dismissed']` seeded to `'1'` so
neither modal ever shows:

1. **Boot** `<url>/v/<blob>/`, plus `#renderer=webgpu` for a WebGPU boot —
   the fragment is the only boot flag the URL carries
   (`src/client/webgpu/README.md` § The flag). Wait for `window.debug`,
   `window.stellata` and `#loading` gone; a `#loading-status` starting
   `Error:` is a `BootError`. Then check `stellata.webgpu` against the
   request: **a WebGPU request that booted WebGL2 fails the scenario.** A
   silent fallback is never mislabelled as a measurement.
2. **Adapter probe.** WebGL renderer/vendor via `WEBGL_debug_renderer_info`
   and `EXT_disjoint_timer_query_webgl2` presence (the live context on a
   WebGL2 boot, a throwaway one otherwise — dropped via `WEBGL_lose_context`
   before the sweep, so the instrument leaves no second GPU context alive in
   the page it is about to price); WebGPU `requestAdapter().info`,
   the fallback flag, and `stellata.webgpu.timestampsAvailable`. A software
   renderer (`/swiftshader|llvmpipe|software/i`, or a fallback adapter)
   **aborts the whole run** — nothing measured on it counts.
3. **Settle.** Poll `stellata.renderGate.debugState` every 250 ms until no
   hold is live, no camera transition is in flight, and the gate has been
   idle for `max(SETTLE_MS, --quiet-ms)`. The timeout error names the stuck
   predicate and the last wake reason (dust chunks wake as `dust-chunk`).
4. **rAF probe**, after settle so the gate is idle and the deltas are the
   compositor's cadence rather than frame cost. Headless Chromium's virtual
   display and a headed 60/120 Hz panel are different clocks — headed and
   headless numbers never compare, and the run header stamps which this is.
5. **Drawing buffer** from the canvas backing store, printed as Mpx.
6. **Differential**: `debug.priceFrame(options)`. An empty result is a
   refusal (panel open, no clock, pinned method unavailable) and is recorded
   with the last console line as the reason.

Page console is forwarded as `[page:<type>]` except `table` (the rows come
back as data). A `pageerror` during boot fails the scenario; during the sweep
it marks the scenario tainted, which exits 1 too. A crash aborts the run.
Any failure exits 1.

## Dwell mode

`--mode dwell` measures the whole frame instead of pricing passes: one rAF
loop under a render-gate hold, with the simulation clock stopped and the
exposure pinned where the warmup left it. Those are the differential's own
three preconditions
(`src/client/debug/frame-cost/README.md` § Preconditions) and they hold here
for the same reasons — a running clock re-arms the binary orbit upload inside
the timed scope, and an unpinned exposure lets the dwell drift onto a
different star population.

**rAF wall-clock deltas are the metric.** On a WebGPU boot the frame-sample
stream is subscribed alongside where `gpuFrameSamplesAreSound()` says the
adapter resolves believable durations, and reported as a second row. The two
are different instruments: read them side by side, never differenced. Where
the stream is absent the `gpu stream:` line says which reason applied.

`p50 / p90 / p99` are nearest-rank, so every number printed is a frame that
happened. **`vsyncClamped` invalidates the dwell rather than annotating it**:
a p50 sitting on a whole number of the display's period, inside a spread
tighter than the tolerance, is the compositor's cadence, not the frame's
cost — the frame finished early and the panel supplied the rest. Any whole
number, because a frame that overran one interval is held to the next: 12 ms
of work on a 120 Hz panel reads 16.67, still the display's number. A clamped
dwell is refused by `--baseline` and makes a sweep inconclusive.

**The period is the one the run measured, not 60 Hz assumed.** The rAF probe
taken after settle (step 4) is the display's cadence with the gate idle, and
the clamp test is judged against it: 16.67 ms on a 60 Hz panel, 8.33 on a
120 Hz one. Headless Chromium's virtual display idles at 16.70 ms (59.9 Hz),
measured on every canon vantage on both backends (stellata-8cg.49.13's
notes) — the same cadence as a 60 Hz panel, though headed and headless still
never compare. The tolerance is `VSYNC_CLAMP_TOLERANCE` (6 %) of the measured
interval — 1 ms at 60 Hz, 0.5 ms at 120 — never a fixed millisecond, which on
a small interval sits within reach of some multiple whatever the frame cost.
The console line says which cadence the verdict was judged against. **The GPU
row is never clamped**: a resolved timestamp is a span the hardware reports,
and no compositor can pad it.

**Every summary carries a state guard.** The dwell is read in four
consecutive quarters (`quarterMedians`); a monotonic run of their medians
wider than `STATE_GUARD_TREND_MS` (1 ms) end to end reads `trending` — the
machine changed state under the dwell (the sustained-load GPU power step,
stellata-0it.38) — and `--baseline` and `--against-pin` refuse the row, since
frames either side of that transition never compare. `--cooldown-ms` idles
between contexts so each one starts cold.

**A WebGPU dwell also counts what the frame submits.** For the timed frames
it wraps `GPUQueue.submit` and `GPUCommandEncoder.beginRenderPass` /
`beginComputePass` on their prototypes and records, per rAF interval, the
submits, the command buffers they carried, and the render and compute
passes encoded — then puts the originals back in the same `finally` as the
clock and the hold. The table prints min / p50 / max per counter, since a
count is small and quantised: a readback frame carries the reduction
chain's extra passes, so the distribution is bimodal and the extremes are
the two modes. It is an API-surface count, not a GPU cost — the per-pass
floor is still a differential (`docs/render-rules.md` § 8). A WebGL2 dwell
has no queue to count on and records null.

**The counters sit inside the timed frames, and only on WebGPU.** Each
wrapped call adds one JavaScript frame: at the counts a canon vantage
actually reads (2–4 submits and 2–4 render passes per frame, up to 12 on a
readback frame), that is under twenty extra calls against a 16.7 ms
interval. Stated rather than assumed, because it is the instrument sitting
inside its own measurement — and it is one more reason never to difference
a WebGL2 dwell against a WebGPU one.

**`--roundtrip <pass>` asks whether a toggle leaves the frame where it found
it.** Dwell; then, under the differential's own conditions (gate held, clock
stopped, exposure pinned), apply the pass's own priceFrame toggle, render
`--frames` frames with it off, restore it, render `SETTLE_FRAMES` more; then
dwell again. Both dwells print, plus one line with the second against the
first as a ratio on each clock and the limit-mag / dm pair as the check that
both priced the same population. `--roundtrip idle` renders the same frames
with nothing toggled — the time-matched control, because the GPU's
sustained-load ramp also moves the frame between two dwells and only the
control separates the toggle from the clock. The toggle is reached through
the frame-cost module over the dev server (`FRAME_COST_MODULE_URL`), never a
second spelling of it; a pass not active at the vantage fails the scenario
rather than round-tripping nothing under the pass's name.

**Four checks, each able to fail.** A hold already live when the dwell starts
fails it — settle requires an unheld gate, and the debug panel takes one,
whose per-tick DOM writes would sit inside a wall-clock dwell. A clock that
was not still stopped at the end of the timed frames fails it: the frames
priced a moving scene. Then the rate and the hold count are read back
**from outside the page function that restored them** — a value re-read
inside the same block that just wrote it could only ever fail if `setRate`
itself refused, which is not the question worth asking. The hold check is
differential against the count seen before the dwell, so a hold the page
already owned is named as such instead of read as a leak. Any of the four
fails the scenario, because each would leave every later scenario in the run
measuring a different machine.

## Sweep mode

`--mode sweep` answers what the frame is bound by, rather than what a pass
costs: dwell at each viewport scale, fit log(frame time) against log(backing
-store pixels), and report the exponent.

Scale 1 is measured **first and last**, with the requested scales ascending
in between (`--scales 0.5,1,1.5,2` → `1, 0.5, 1.5, 2, 1`). The spread of
those two scale-1 medians is `bracketMs`, and it is the floor any slope claim
sits on for the same reason the differential brackets each row: an instrument
that ramped its clocks across the sweep produces a dependence on elapsed time
that fits as a dependence on area.

The viewport moves; **dpr does not**. Scaling both would confound area with
the per-pixel work dpr also multiplies.

Reading the slope: `≥ 0.8` fill-bound, `≤ 0.3` vertex- or CPU-bound, between
them mixed. In the JSON the fit is its own block — `sweep.fit.slope`, `.r2`,
`.bound`, and `.fitted`, the number of points the line was drawn through, so
named because `sweep.points` one level up is the points themselves. **Any vsync-clamped point makes the whole fit inconclusive**, not
merely noisier — that point measured the panel, so it flattens the line and a
fill-bound frame reads as vertex-bound. The first point pays a full warmup;
later scales pay `SWEEP_RESIZE_WARMUP_FRAMES` (60), enough to absorb the HDR
target rebuild the resize forces, since the clock ramp was already paid.

## JSON output

`--json <path>` writes the whole run as schema `stellata-perf/1`:
`run` (timestamps, url, argv, git commit and dirty flag, browser and its
switches, the adapter probe, host) plus one record per scenario × backend
(backend requested and actual, viewport, buffer and Mpx, mode, method,
params, settle time, the mode's own block, forwarded console, page errors,
`tainted` and `failed`).

**Raw samples are always retained** — every rAF delta and every GPU sample,
not just the summary. A re-analysis with a different estimator has to be
possible from the file alone, and a summary cannot be un-summarised.

`assertPerfFile` checks the schema string by equality before reading
anything else, and it is the only place the suffix is judged — a `--baseline`
carrying another one is refused in the preflight, so the diff never sees a
file it would have to reason about. Removing a field or changing what one MEANS bumps the suffix;
adding one does not. A bump abandons every recorded baseline, because
`--baseline` refuses across two suffixes rather than mapping between them.

## Comparing against a baseline

`--baseline <path>` differences this run against a saved one and prints
`✓` cheaper · `✗` dearer · `~` inside the band, keyed
`scenario|backend|pass` (or `|dwell`).

A row counts as moved only past **two sigma of the pair's own uncertainty**.
Differential rows combine the two `noiseMs` floors, then take the larger of
that and the two `bracketMs` values — the bracket is instrument drift, which
no amount of sampling reduces. Dwell rows use the median's standard error,
`1.2533·(iqr/1.349)/√n`, on both sides.

**`savedMs` is the trap.** It names what disabling the pass saved, i.e. the
pass's own price — so a row whose `savedMs` went UP got *dearer*, not better.
Dwell `p50` reads the same direction for the obvious reason. Both print `✗`.

**The refusals matter as much as the rows.** Two runs on different clocks,
buffers or adapters produce a table that looks like a comparison and is not,
so an incomparable pair is named and skipped rather than dropped silently:
a differing adapter string refuses the whole run (a differing schema never
reaches the diff — see § JSON output); a differing method or mode, a buffer
more than 1 % apart, a failed or tainted scenario, a vsync-clamped dwell, or a
row missing from one side refuses just that key. The key carries the backend,
so a vantage the other run measured on the *other* backend says exactly that
rather than reporting itself absent.
Sweeps are never diffed — a slope is not a cost.

## Pinning

`--mode dwell --json <run> --pin pins/<slug>.json` summarises a run as the
committed perf pin; `--against-pin <path>` prints the verdicts and exits 1
on any `✗`. The file, the floor, the cadence and ceiling rules and the
refusals: `pins/README.md`. When a PR must run it and what a mark means:
`RELEASING.md` § Perf pin.

## Traps

- **The machine must be idle for the whole run.** Foreground work on the
  same GPU shows up as a wide `iqrMs` (20 ms against 1–2 ms idle), a
  baseline that walks upward across the sweep, and rows that fall under
  their brackets — measured on the parity spike, where the one run taken
  during other work was the one that looked like a headless defect.
- Everything in `docs/render-rules.md` § Measurement canon and
  `src/client/debug/frame-cost/README.md` § Reading a row: a `savedMs` under
  `noiseMs` or `bracketMs` did not resolve; the limit-mag columns must
  agree; never compare across `method`, `bufferMpx`, headed/headless, or
  browsers; never sum the column.
- A page function (anything handed to `page.evaluate` / `waitForFunction`
  / `addInitScript`) must hold no inner named helper — no
  `const f = () => …` — because tsx wraps those in a `__name(...)` call
  that does not exist once Playwright serialises the body into the page.
  The symptom is `ReferenceError: __name is not defined` from inside the
  page.
- **`stat` cannot be probed by failure.** `perf_go_age_s` asks GNU first
  (`stat -c %Y`) because that spelling *fails* on BSD, while BSD's `stat -f`
  is GNU's `--file-system` and **succeeds** on Linux — printing a filesystem
  block where a mtime was expected. Ordered the other way, the marker's age
  came back as prose, the arithmetic tripped `set -u`, the hook exited
  non-zero, and a PreToolUse hook that errors lets the call through: the
  consent gate was absent on every Linux checkout while the macOS suite
  stayed green. Each spelling also assigns separately — one shared
  `$( a || b )` capture concatenates both outputs. Pinned by
  `perf-go-lib.test.ts`, which asserts bare seconds rather than a
  non-zero exit.
- The default viewport is 1280×800 @ dpr 2 = 4.096 Mpx. The hand-run tables
  in the frame-cost README were taken at 6.774 Mpx (a 2560×2646 buffer);
  they are not comparable to a default-viewport run.

## Recording

`--json` output and the run's log go under `.perf-runs/<date>/` in the
**main checkout** (gitignored; never a worktree, the home directory or
`/tmp`). A worktree is deleted with its PR and would take the runs with it;
the main checkout persists. From a worktree, `git rev-parse
--path-format=absolute --git-common-dir` prints `<main checkout>/.git`, and
its parent is the directory to pass. Results go to the bead's notes with the
`.perf-runs/<date>/<file>` path, never into this README. Say which vantage,
backend, method, headless flag and buffer size the run used.
