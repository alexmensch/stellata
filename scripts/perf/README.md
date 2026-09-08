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
  pin.ts                    `pnpm run perf:pin`: the pin from saved run
                            files, offline — no browser, no arm.
                            pins/README.md § From saved runs.
  checkout.ts               What run.ts and pin.ts share about the checkout:
                            root, main checkout, git provenance, the pin's
                            read / compare / write.
  args.ts (+ test)          Flags → RunArgs and PinArgs (node:util
                            parseArgs), plus the mode-compatibility check
                            over the flags actually typed.
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
  pin-pure.ts (+ test)      The perf pin: adapter slug, pinFromRuns,
                            compareToPin and its floor, cadence and ceiling
                            rules. pins/<slug>.json is the committed pin.
  table-pure.ts (+ test)    Every text table. formatTable is the shared
                            width/alignment pass.
  perf-section-check.sh     perf-section-guard's check: a render-path diff,
    (+ test)                or a catalogue-membership move over 1 %, needs a
                            `## Perf` section, every ✗ accepted.
  arming/                   The consent gate: marker name and freshness, the
                            arm poller, the protocol. Own README.
  diff/                     Two runs differenced: the band and its floor, the
                            verdicts, and the refusals both gates share.
                            Own README.
  dwell/                    Dwell mode: the whole-frame statistics, the
                            state guard, the gating clock, the frame floor
                            both tables print. Own README.
  sweep/                    Sweep mode: measurement order, the log-log fit,
                            the bracket. Own README.
  pins/                     The committed per-GPU pin. Own README.
```

## Invocation

```
pnpm run perf -- [--scenario mw120,sol,earth,mw50,lg | all] [--backend webgpu|webgl2|both]
                 [--mode differential|probe|dwell|sweep] [--passes a,b]
                 [--pre-disable a,b] [--no-park] [--force-recompute]
                 [--method timer-query|timestamp|raf-delta]
                 [--budget-ms N] [--dwell-frames N] [--warmup-frames N] [--settle-frames N] [--no-interleave]
                 [--empty-passes N]
                 [--frames 240] [--readback-every 4|4,1,2] [--roundtrip <pass>|idle] [--scales 0.5,1,1.5,2]
                 [--headed] [--width 1280] [--height 800] [--dpr 2] [--quiet-ms 5000]
                 [--json <path>] [--baseline <path>] [--cooldown-ms 0]
                 [--pin <path> [--accept <scenario>|<backend>[|compute]:<bead>]...] [--against-pin <path>]
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
are what a driver would coalesce
(`src/client/debug/frame-cost/passes/README.md` § The roster,
`docs/render-rules.md` § 8).

**`--pre-disable <keys>` and `--no-park` set up the frame a differential
prices, and are read by that mode alone.** The named roster passes are
switched off before the sweep — through their own `buildPassToggles`
toggles, so there is no second spelling of any pass — and restored in a
`finally` outside priceFrame's own; a pass not active at the vantage
throws rather than pricing a frame it was never in. `--no-park` holds the
adaptation measurement unparked; why that is needed at all, and why it is a
lever rather than a state, is `src/client/hdr/exposure/park/README.md`
§ The lever. Both land in the record's `params`, and a run differing in
either refuses to compare (`diff/README.md` § The refusals). The case they
exist for is the `statisticWrites` row at the Sol default view
(`src/client/debug/frame-cost/passes/README.md` § The roster).

**`--pre-disable` is only sound where the applied cut does not depend on the
frame, and Sol's floor regime is that case.** The flag acts *before*
priceFrame, which pins the exposure only after its own warmup
(`src/client/debug/frame-cost/README.md` § Preconditions) — so the warmup
converges on the reduced scene and the sweep then pins a cut the plain run
never had. Where the eye branch or the resolved-surface pin governs, that is
a different star population in the two runs and the rows are not each
other's complement; § The compression probe on the passes page is the same
trap caught the hard way. At the Sol default view the display floor governs
and the cut reads `Lw` and the anchor and nothing from the frame, so holding
the band and the glow off cannot move it. **The `limitMag` columns are the
tell either way** — equal across both runs, or the subtraction is between
two different scenes.

**`--force-recompute` is the one setup lever that switches something ON.**
The per-star extinction cache is refilled only when the camera has moved
more than 1 pc since the last fill, and every canon vantage is camera-idle —
so the kernel is absent from every dwell a canon run takes. The flag arms the
shell's forced-recompute lever before the measurement and restores it after,
which makes the `extinctionRecompute` row present in `differential` and puts
the compute pass into a `dwell`'s `computePasses` counts. It is read by those
two modes only; the sweep's exponent relates frame time to pixels, and a cost
that marches every star whatever is on screen would flatten it. Lands in the
record's `params` and refuses to compare against a run without it
(`diff/README.md` § The refusals) — including the pin, which such a run can
neither be read against nor written as (`pins/README.md` § Setup levers).
What the row means, why the scene is
identical on both sides, and which vantages to take it at:
`src/client/debug/frame-cost/passes/README.md` § The extinction rows.

`--frames` sizes a dwell (dwell and sweep modes); `--scales` is the sweep's
viewport set.

**`--readback-every` pins the dwell's readback duty cycle** — one statistic
readback per that many rendered frames, held from before the warmup to the
restore. The rate is otherwise emergent, and it decides what the GPU-stream
median measures where the frame has two classes, so a dwell holds it as it
already holds the gate, the clock and the exposure. Several values visit the
scenario once per cadence — a probe, refused by `--pin`, `--against-pin` and
`--baseline` (`dwell/README.md` § What a dwell measures). `--warmup-frames` is shared: it is priceFrame's own warmup in
differential mode and the dwell's in the other two, defaulting to the same
`WARMUP_FRAMES` either way, since it exists to absorb the same clock ramp.

`--hash <fragment>` appends the app's own URL-fragment switches to every
boot — `--hash webgpu-gate=force` shows the requires-WebGPU page on a
browser that supports it, the one way to exercise the gate's `BootError`
end to end. It composes with the `#renderer=webgl2` a WebGL2 boot already
carries (`&`-joined; the app reads every switch off one hash). `--url`
cannot carry it: the base is prefixed with `/v/<blob>/`, so a fragment
there lands mid-path.

**Contexts run backend-major — every WebGPU context, then every WebGL2
one — with the scenarios in the order given; `all` is the canon order
mw120, sol, earth, mw50, lg.** So `--scenario all --backend both` opens
with mw120|webgpu then sol|webgpu, the two contexts a Tier 1 run visits,
in the same order. That is what lets Tier 1 compare against the pin:
`diff/README.md` § The refusals, run position.

**`--backend both` runs each scenario twice, in separate contexts, and pins
`--method raf-delta`.** The two backends' best clocks are different
instruments — WebGL2's timer query against WebGPU's timestamp resolve — so
taking each one's best builds exactly the mixed-method table that must never
be compared. rAF wall time is the one clock both supply. An explicit
`--method` overrides the pin, and the run says it did.

**A flag the chosen mode does not read is an error, not a no-op.**
`--mode dwell --method timer-query` is refused rather than quietly stamping
the table `raf-delta`, and the same goes for `--passes`, `--pre-disable`,
`--no-park`, `--budget-ms`, `--dwell-frames`, `--settle-frames` and
`--no-interleave` outside `differential`, `--force-recompute` outside
`differential` and `dwell`, `--frames` and `--readback-every` outside dwell and
sweep, `--roundtrip` outside dwell, and `--scales` outside sweep. Only flags actually typed are checked,
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

1. **Boot** `<url>/app/v/<blob>/` (the canonical share path, built by
   `scenarioUrl` from `share-path-pure.ts` rather than spelled here —
   `src/README.md` § Request routing), plus `#renderer=webgl2` for the escape
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
   with the last console line as the reason. Every row carries
   `baselineRising`, one verdict about the whole sweep: the instrument got
   dearer while it measured. On the bracketed default it does not invalidate
   the rows — each is bracketed against its own neighbours — it says not to
   read the run's levels against a settled one's. Under `--no-interleave` it
   does invalidate them, every row there being differenced against the
   leading baseline alone (`src/client/debug/frame-cost/README.md`
   § Reading a row).

Page console is forwarded as `[page:<type>]` except `table` (the rows come
back as data). A `pageerror` during boot fails the scenario; during the sweep
it marks the scenario tainted, which exits 1 too. A crash aborts the run.
Any failure exits 1.

## Dwell mode

`--mode dwell` measures the whole frame at a vantage instead of pricing its
passes, and is what the pin and both gates read. Its metric, the GPU-stream
and compute-stream rows beside it, the vsync clamp, the state guard, the pass counters, the
pinned readback duty cycle and `--roundtrip`: `dwell/README.md`.

## Sweep mode

`--mode sweep` dwells at each viewport scale and fits the exponent relating
frame time to backing-store pixels, which says what the frame is bound by
rather than what a pass costs. The order, the bracket, the dpr rule and how
to read a slope: `sweep/README.md`.

## JSON output

`--json <path>` writes the whole run as schema `stellata-perf/2`:
`run` (timestamps, url, argv, the commit pair and dirty flag, browser and its
switches, the adapter probe, host) plus one record per scenario × backend
(backend requested and actual, viewport, buffer and Mpx, catalogue record
count, the context's 1-based position in the run, mode, method, params,
settle time, the mode's own block, forwarded console, page errors,
`tainted` and `failed`).

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
`scenario|backend|pass` (or `|dwell`). The band and its shared floor, the
`floor` column, which clock a dwell row is judged on, and every refusal that
stops an invalid comparison — most of them applied by `--against-pin`
too: `diff/README.md`.

## Pinning

`--pin pins/<slug>.json` summarises a whole-canon, both-backend dwell run
as the committed perf pin; `--against-pin <path>` prints the verdicts for
the rows this run measured, lists the pin rows it did not, and exits 1 on
a `✗` or a refused row. A run refused for one row is not re-armed:
`pnpm run perf:pin` writes the pin from saved run files of one commit.
What the pin holds, what refuses it, the merge rule, the metric, floor and
ceiling: `pins/README.md`. When a PR must run it and what a mark means:
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
- **A larger buffer comes from `--width`/`--height`, never `--dpr` above 2.**
  The app caps its pixel ratio at 2 (`stellata.ts`, `setPixelRatio`): a higher
  `--dpr` draws at 2 while the header claims more, so the runner aborts (exit
  1) when the buffer comes back under viewport × dpr, naming the effective
  ratio. The hand-run tables in
  `src/client/debug/frame-cost/passes/README.md` (6.774 Mpx) never compare.

## Recording

`--json` output and the run's log go under `.perf-runs/<date>/` in the
**main checkout** (gitignored; never a worktree, the home directory or
`/tmp`). A worktree is deleted with its PR and would take the runs with it;
the main checkout persists. From a worktree, `git rev-parse
--path-format=absolute --git-common-dir` prints `<main checkout>/.git`, and
its parent is the directory to pass. Results go to the bead's notes with the
`.perf-runs/<date>/<file>` path, never into this README. Say which vantage,
backend, method, headless flag and buffer size the run used.
