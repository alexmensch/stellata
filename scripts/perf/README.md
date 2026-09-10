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
                            run, how the probe reads, whether a marker arms,
                            why a boot produced no page. Here rather than in
                            run.ts so a test can import them without
                            launching a browser.
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
  sweep-pure.ts (+ test)    Measurement order, the log-log fit, fill/vertex
                            classification, the sweep bracket.
  diff-pure.ts (+ test)     Two runs differenced: bands, verdicts, and the
                            refusals that stop an invalid comparison.
  pin-pure.ts (+ test)      The perf pin: adapter slug, pinFromRun,
                            compareToPin and its floor, cadence and ceiling
                            rules. pins/<slug>.json is the committed pin.
  table-pure.ts (+ test)    Every text table. formatTable is the shared
                            width/alignment pass.
  perf-section-check.sh     perf-section-guard's check: a render-path diff,
    (+ test)                or a catalogue-membership move over 1 %, needs a
                            `## Perf` section, every ✗ accepted.
  arming/                   The consent gate: marker name and freshness, the
                            arm poller, the protocol. Own README.
  dwell/                    Dwell mode: the whole-frame statistics, the
                            state guard, the gating clock. Own README.
  pins/                     The committed per-GPU pin. Own README.
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
                 [--url http://localhost:5173] [--chrome-arg=<switch>]... [--hash <fragment>]
```

Defaults: Sol, WebGL2, differential, every present pass, the backend's best
clock, 1280×800 at dpr 2 (4.096 Mpx), headless. The priceFrame knobs
(`--dwell-frames`, `--warmup-frames`, `--settle-frames`, `--budget-ms`) pass
straight through; unset ones take priceFrame's own defaults. `--mode probe`
boots, settles and prints the adapter block and the idle rAF period, no sweep.

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

`--hash <fragment>` appends the app's own URL-fragment switches to every
boot — `--hash webgpu-gate=force` shows the requires-WebGPU page on a
browser that supports it, the one way to exercise the gate's `BootError`
end to end. It composes with the `#renderer=webgl2` a WebGL2 boot already
carries (`&`-joined; the app reads every switch off one hash). `--url`
cannot carry it: the base is prefixed with `/v/<blob>/`, so a fragment
there lands mid-path.

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
so a default never trips it, and `--warmup-frames` is exempt because every
mode absorbs the same ramp. The in-app instrument takes the same posture on a
pin it cannot honour (`src/client/debug/frame-cost/README.md`
§ Preconditions); a typed command line is no improvement if the honoured-pin
illusion survives it.

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

The runner never launches on the agent's own initiative: a marker file
`.perf-go` at the repo root authorises exactly one launch, and only Alex
creates it. `run.ts` consumes it before the browser starts — absent → exit 3;
stale → deleted, exit 3; fresh → deleted, then launch — so one arm is one
launch attempt whatever happens after. The gate, the poller, the arm protocol
and the marker's single source: `arming/README.md`.

The runner never starts a dev server either. Alex always has one running;
`--url` targets it, and a worktree's server sits on another port. An
unreachable URL exits 2 before the marker is touched.

## What a run does

Per scenario, in its own browser context at the requested viewport and
device pixel ratio, with `localStorage['stellata.info-dismissed']` and
`sessionStorage['stellata.mobile-advisory-dismissed']` seeded to `'1'` so
neither modal ever shows:

1. **Boot** `<url>/v/<blob>/`, plus `#renderer=webgl2` for the escape
   hatch — WebGPU is the default (`src/client/webgpu/README.md`
   § The renderer is WebGPU). Wait for `window.debug`,
   `window.stellata` and `#loading` gone; a `#loading-status` starting
   `Error:` is a `BootError`. The requires-WebGPU gate is read *before*
   those, because it hides the boot's elements rather than removing them
   (`src/client/webgpu/gate/README.md`): `#loading` survives with
   `display:none` and `window.stellata` is never set, so every predicate
   stays false and the wait would spend its whole timeout to say nothing.
   A mounted gate is a `BootError` naming its `data-verdict` instead.
   Then check `stellata.webgpu` against the request: **a boot on the
   other backend fails the scenario** rather than yielding a mislabelled
   measurement.
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

`--mode dwell` measures the whole frame at a vantage instead of pricing its
passes, and is what the pin and both gates read. Its metric, the GPU-stream
row beside it, the vsync clamp, the state guard, the pass counters and
`--roundtrip`: `dwell/README.md`.

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

`--json <path>` writes the whole run as schema `stellata-perf/2`:
`run` (timestamps, url, argv, the commit pair and dirty flag, browser and its
switches, the adapter probe, host) plus one record per scenario × backend
(backend requested and actual, viewport, buffer and Mpx, catalogue record
count, mode, method, params, settle time, the mode's own block, forwarded
console, page errors, `tainted` and `failed`).

**Raw samples are always retained** — every rAF delta and every GPU sample,
not just the summary. A re-analysis with a different estimator has to be
possible from the file alone, and a summary cannot be un-summarised.

`assertPerfFile` checks the schema string by equality before reading
anything else, and it is the only place the suffix is judged — a `--baseline`
carrying another one is refused in the preflight, so the diff never sees a
file it would have to reason about. What bumps the suffix, and why a bump
abandons every recorded baseline: `schema.ts`, on `PERF_SCHEMA`.

## Comparing against a baseline

`--baseline <path>` differences this run against a saved one and prints
`✓` cheaper · `✗` dearer · `~` inside the band, keyed
`scenario|backend|pass` (or `|dwell`).

A row counts as moved only past **two sigma of the pair's own uncertainty**.
Differential rows combine the two `noiseMs` floors, then take the larger of
that and the two `bracketMs` values — the bracket is instrument drift, which
no amount of sampling reduces. Dwell rows use the median's standard error,
`1.2533·(iqr/1.349)/√n`, on both sides, floored at the same
`max(0.25 ms, 1 %)` the pin uses (`pins/README.md` § Reading
`--against-pin`). **The floor is shared deliberately.** Two sigma of the
medians' own scatter describes sampling and nothing else, and a dwell's run
conditions move it further: at 240 frames on a steady vantage that band
draws around 0.02 ms, while moving a context's position within its run
moved one by 0.49 (stellata-8cg.49.27). An unfloored band would also leave
Tier 1 gating tighter than the Tier 2 it feeds, and the tighter of two
gates is the one that decides.

**`savedMs` is the trap.** It names what disabling the pass saved, i.e. the
pass's own price — so a row whose `savedMs` went UP got *dearer*, not better.
A dwell `p50` reads the same direction for the obvious reason. Both print `✗`.

**A dwell row is judged on the clock `gatingClock` names** — the GPU stream
where both runs resolved one, wall only where neither did — and the metric
column says which, `gpu-p50` or `wall-p50`, exactly as the pin's does. Every
test on the row reads that same clock: the clamp, the state guard and the
band. That is the whole of the rule, and the half worth stating is what it
frees. Wall deltas are quantised to the refresh interval, so at a vantage
whose frame exceeds one the medians alternate between one and two however
idle the machine is — which read the row's own clamp and state guard as a
verdict on the machine and refused mw120 and sol outright. Off the GPU
stream both tests are about the hardware: a resolved timestamp is a span no
compositor can pad. Where the GPU stream gates, the wall numbers stay in the
JSON and out of the table, as `pins/README.md` § State guard records them.

**Where NEITHER run resolved a stream the row still marks, on wall — and
that is where this table parts company with the pin**, which prints such a
pair `ungated` and never marks it. Every WebGL2 row is one, WebGL2 supplying
no stream anywhere, so refusing here would leave `--baseline --mode dwell
--backend webgl2` with nothing to print at all; the pin can decline the row
because it has ten of them across two backends. Read such a row knowing
what it is: the one case in the table where a whole-interval delta may be
the clock rather than the frame. In practice most are refused before they
print, a WebGL2 frame inside one interval tripping the clamp first.

**A GPU stream on one side and none on the other refuses the row**, the
same refusal a differing `method` gets and for the same reason — a
timestamp median against a wall median is two instruments. The pin prints
that pair as an ungated row instead, because a committed table shows every
vantage; here there is a refusal list to say it in.

**The refusals matter as much as the rows.** Two runs on different clocks,
buffers or adapters produce a table that looks like a comparison and is not,
so an incomparable pair is named and skipped rather than dropped silently:
a differing adapter string refuses the whole run (a differing schema never
reaches the diff — see § JSON output); a differing method or mode, a buffer
more than 1 % apart, a **record count** more than 1 % apart or absent on
either side (a row priced against a different catalogue is not a
comparison), a failed or tainted scenario, a dwell clamped or trending on
its gating clock, a mismatched GPU stream, a `cadenceBound` row (either
side), or a row missing from one side refuses that key.

The key carries the backend, so a vantage the other run measured on the
*other* backend says exactly that rather than reporting itself absent.
Sweeps are never diffed — a slope is not a cost.

## Pinning

`--mode dwell --json <run> --pin pins/<slug>.json` summarises a run as the
committed perf pin; `--against-pin <path>` prints the verdicts and exits 1 on
a `✗` or a refused row. Metric, floor, ceiling, refusals: `pins/README.md`.
When a PR must run it and what a mark means: `RELEASING.md` § Perf pin.

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
- **A larger buffer comes from `--width`/`--height`, never `--dpr` above 2.**
  The app caps its pixel ratio at 2 (`stellata.ts`, `setPixelRatio`): a higher
  `--dpr` draws at 2 while the header claims more, so the runner aborts (exit
  1) when the buffer comes back under viewport × dpr, naming the effective
  ratio. The frame-cost README's hand-run tables (6.774 Mpx) never compare.

## Recording

`--json` output and the run's log go under `.perf-runs/<date>/` in the
**main checkout** (gitignored; never a worktree, the home directory or
`/tmp`). A worktree is deleted with its PR and would take the runs with it;
the main checkout persists. From a worktree, `git rev-parse
--path-format=absolute --git-common-dir` prints `<main checkout>/.git`, and
its parent is the directory to pass. Results go to the bead's notes with the
`.perf-runs/<date>/<file>` path, never into this README. Say which vantage,
backend, method, headless flag and buffer size the run used.
