# Perf runner — human-armed, Chrome only, clocks only

`pnpm run perf` boots the app in Playwright's full Chromium build, calls the
in-app `debug.priceFrame()` differential (`src/client/debug/frame-cost/`) at
a canon vantage through `page.evaluate`, and prints the table `console.table`
shows in the browser. It reads GPU timestamps and rAF wall-clock deltas and
nothing else — never a screenshot, never a pixel readback — so it is a cost
instrument and is never used for appearance or UX decisions. The
interpretation authority is [Measurement canon](/docs/render-rules.md#9-measurement-canon); the
agent-facing procedure is the `stellata-perf` skill.

## Files

```
scripts/perf/
  run.ts                    The runner: preflight (flags → URL reachable →
                            marker consumed), launch, per-scenario loop,
                            exit codes. One of the tree's two Playwright
                            value imports; never imported by a test.
  pin.ts                    `pnpm run perf:pin`: the pin from saved run
                            files, offline — no browser, no arm.
                            pins/README.md#from-saved-runs.
  survivors.ts              `pnpm run survivors`: debug.survivors() at the
                            canon vantages. Reads no clock and is not a cost
                            instrument (README.md#survivor-counts--the-one-entry-point-here-that-is-not-a-cost-instrument). The other
                            Playwright value import; not imported by a test.
  checkout.ts               What run.ts and pin.ts share about the checkout:
                            root, main checkout, git provenance, the pin's
                            read / compare / write.
  args.ts (+ test)          Flags → RunArgs, PinArgs and SurvivorsArgs
                            (node:util parseArgs), plus the mode-compatibility
                            check over the flags actually typed. All three
                            parsers here, including the survivors one, because
                            survivors.ts cannot be imported by a test.
  run-pure.ts (+ test)      The decisions around a launch: the order contexts
                            run in, which adapters disqualify a run, how the
                            probe reads, whether a marker arms,
                            why a boot produced no page. Also the Chromium
                            channel both launches pass and the `run` block
                            both instruments write, assembled in one place so
                            two files cannot disagree about what they record.
                            Here rather than in run.ts so a test can import
                            them without launching a browser.
  scenarios.ts (+ test)     The five canon vantages as share blobs, and
                            scenarioUrl().
  page-protocol.ts          Every page.evaluate: boot, gate snapshot, adapter
                            probe, rAF probe, drawing-buffer read, the
                            priceFrame call, the dwell loop.
  measure.ts (+ test)       What each mode does to a settled page.
  schema.ts (+ test)        The on-disk record types, PERF_SCHEMA,
                            SURVIVORS_SCHEMA and assertPerfFile. Owns the
                            adapter/scenario/mode shapes the runner, the
                            tables and the diff share, and the run
                            provenance both instruments write.
  settle-pure.ts (+ test)   settleVerdict over one render-gate snapshot.
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
  pins/                     The committed per-GPU pin: adapterSlug,
                            pinFromRuns, compareToPin, the gated statistic
                            per stream, the ceiling. Own README.
```

## Survivor counts — the one entry point here that is not a cost instrument

`pnpm run survivors` boots each canon vantage on WebGPU, waits for the same
render-gate settle the runner waits for, and prints what the compaction
kernel listed: glow-tier and disc-tier instance counts against the
catalogue record count, the count passing the dust-independent
prefilter with the drawn share of it
([Reading the counts back](/src/client/webgpu/star/compaction/README.md#reading-the-counts-back)),
and the count the extinction refill's frustum test admits — the
population that pays the cache gate's reads
([Counting the in-frame population](/src/client/webgpu/extinction/refill/README.md#counting-the-in-frame-population)).
It reuses `scenarios.ts` and `page-protocol.ts` so its vantages and its
boot are the runner's, byte for byte.

**It reads no clock**, which is why it lives beside the runner without
inheriting the arm. The consent gate exists to protect an idle machine for a
*timing* measurement; a buffer readback of six integers needs neither an idle
machine nor Alex's attention, and `readRecordCount` is the precedent — the
runner already reads non-clock scene state to guard its rows. Do not run it
while a perf run is armed: two headless Chromiums contend for the GPU, and
that would taint the run rather than this.

**The settle is load-bearing, not tidiness.** The counts come off the *last*
compaction dispatch, so a read issued before the gate goes quiet belongs to a
camera still arriving.

```
pnpm run survivors -- [--url http://localhost:5173] [--json <path>]
```

It visits every canon vantage on WebGPU at the runner's own default viewport
and device pixel ratio, so there is nothing to select. An unknown flag is a
usage error, exit 2 — `parseArgs` runs `strict` here for the same reason the
runner's does. Exit 1 is a boot that came up without the seam.

**`--json` writes schema `stellata-survivors/1`**: the `run` provenance block
a perf file carries — timestamps, argv, the commit pair and dirty flag,
browser and switches, the adapter probe, host — plus the `viewport` the whole
run used, and one row per vantage with its counts and its settle. A separate
suffix rather than a mode of `stellata-perf/2`, because `assertPerfFile`
judges the suffix by equality and a bump there abandons every recorded
baseline (`schema.ts`, on `SURVIVORS_SCHEMA`). The viewport is in the block
because the frustum test produces these counts: they move with viewport and
field of view the way a frame time moves with Mpx, so two files at different
viewports are not each other's comparison. The adapter probe is taken
*after* the counts are read — its WebGL branch opens a throwaway context in
the page they came off.

## Invocation

```
pnpm run perf -- [--scenario mw120,sol,earth,mw50,lg | all] [--backend webgpu]
                 [--mode differential|probe|dwell|sweep] [--passes a,b]
                 [--pre-disable a,b] [--no-park] [--force-recompute]
                 [--method timestamp|raf-delta]
                 [--budget-ms N] [--dwell-frames N] [--warmup-frames N] [--settle-frames N] [--no-interleave]
                 [--empty-passes N]
                 [--frames 240] [--readback-every 4|4,1,2] [--roundtrip <pass>|idle] [--scales 0.5,1,1.5,2]
                 [--headed] [--width 1280] [--height 800] [--dpr 2] [--quiet-ms 5000]
                 [--json <path>] [--baseline <path>] [--cooldown-ms 0]
                 [--pin <path> [--accept <scenario>|<backend>[|compute]:<bead>]...] [--against-pin <path>]
                 [--url http://localhost:5173] [--chrome-arg=<switch>]... [--hash <fragment>]
```

Defaults: Sol, differential, every present pass, the adapter's best clock,
1280×800 at dpr 2 (4.096 Mpx), headless. The priceFrame knobs
(`--dwell-frames`, `--warmup-frames`, `--settle-frames`, `--budget-ms`) pass
straight through; unset ones take priceFrame's own defaults. `--mode probe`
boots, settles and prints the adapter block and the idle rAF period, no sweep.

`--empty-passes` is the `emptyPass` row's own knob: how many empty render
passes it adds while "disabled". One pass often falls under `bracketMs` and
the row does not resolve; raising the count tightens the bound on that many
boundaries together. Quote the total, not `savedMs` over the count — dividing
assumes the clears add, and consecutive clears with nothing drawn between them
are what a driver would coalesce
([The roster,](/src/client/debug/frame-cost/passes/README.md#the-roster)
[§ 8](/docs/render-rules.md#8-submits-and-passes-are-costs)).

**`--pre-disable <keys>` and `--no-park` set up the frame a differential
prices, and are read by that mode alone.** The named roster passes are
switched off before the sweep — through their own `buildPassToggles`
toggles, so there is no second spelling of any pass — and restored in a
`finally` outside priceFrame's own; a pass not active at the vantage
throws rather than pricing a frame it was never in. `--no-park` holds the
adaptation measurement unparked; why that is needed at all, and why it is a
lever rather than a state, is [The lever](/src/client/hdr/exposure/park/README.md#the-lever).
Both land in the record's `params`, and a run differing in
either refuses to compare ([The refusals](diff/README.md#the-refusals)). The case they
exist for is the `statisticWrites` row at the Sol default view
([The roster](/src/client/debug/frame-cost/passes/README.md#the-roster)).

**`--pre-disable` is only sound where the applied cut does not depend on the
frame, and Sol's floor regime is that case.** The flag acts *before*
priceFrame, which pins the exposure only after its own warmup
([Preconditions](/src/client/debug/frame-cost/README.md#preconditions)) — so the warmup
converges on the reduced scene and the sweep then pins a cut the plain run
never had. Where the eye branch or the resolved-surface pin governs, that is
a different star population in the two runs and the rows are not each
other's complement; [The compression probe](/src/client/debug/frame-cost/passes/README.md#the-compression-probe--does-the-reductions-cost-track-content) on the passes page is the same
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
([The refusals](diff/README.md#the-refusals)) — including the pin, which such a run can
neither be read against nor written as ([Setup levers](pins/README.md#setup-levers)).
What the row means, why the scene is
identical on both sides, and which vantages to take it at:
[The extinction rows](/src/client/debug/frame-cost/passes/README.md#the-extinction-rows).

`--frames` sizes a dwell (dwell and sweep modes); `--scales` is the sweep's
viewport set.

**`--readback-every` pins the dwell's readback duty cycle** — one statistic
readback per that many rendered frames, held from before the warmup to the
restore. The rate is otherwise emergent, and it decides what the GPU-stream
median measures where the frame has two classes, so a dwell holds it as it
already holds the gate, the clock and the exposure. Several values visit the
scenario once per cadence — a probe, refused by `--pin`, `--against-pin` and
`--baseline` ([What a dwell measures](dwell/README.md#what-a-dwell-measures)). `--warmup-frames` is shared: it is priceFrame's own warmup in
differential mode and the dwell's in the other two, defaulting to the same
`WARMUP_FRAMES` either way, since it exists to absorb the same clock ramp.

`--hash <fragment>` appends the app's own URL-fragment switches to every
boot — `--hash webgpu-gate=force` shows the requires-WebGPU page on a
browser that supports it, the one way to exercise the gate's `BootError`
end to end (the app reads every switch off one hash, `&`-joined). `--url`
cannot carry it: the base is prefixed with `/v/<blob>/`, so a fragment
there lands mid-path.

**Contexts run in the scenario order given; `all` is the canon order
mw120, sol, earth, mw50, lg.** So `--scenario all` opens with mw120 then
sol, the two contexts a Tier 1 run visits, in the same order. That is what
lets Tier 1 compare against the pin: [The refusals,](diff/README.md#the-refusals) run
position.

**A dwell's clock is always `raf-delta`, so every pin run is on it.**
`--method` is read by `differential` alone, the pin and both gates read
dwells, and `pinRefusal` rejects any other method outright — every
archived pin and baseline was recorded on it, and a table mixing clocks
compares two instruments.

**A flag the chosen mode does not read is an error, not a no-op.**
`--mode dwell --method timestamp` is refused rather than quietly stamping
the table with the clock the mode actually used, and the same goes for `--passes`, `--pre-disable`,
`--no-park`, `--budget-ms`, `--dwell-frames`, `--settle-frames` and
`--no-interleave` outside `differential`, `--force-recompute` outside
`differential` and `dwell`, `--frames` and `--readback-every` outside dwell and
sweep, `--roundtrip` outside dwell, and `--scales` outside sweep. Only flags actually typed are checked,
so a default never trips it, and `--warmup-frames` is exempt because every
mode absorbs the same ramp. The in-app instrument takes the same posture on a
pin it cannot honour ([Preconditions](/src/client/debug/frame-cost/README.md#preconditions));
a typed command line is no improvement if the honoured-pin
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

1. **Boot** `<url>/v/<blob>/` ([The renderer is WebGPU](/src/client/webgpu/README.md#the-renderer-is-webgpu)).
   Wait for `window.debug`,
   `window.stellata` and `#loading` gone; a `#loading-status` starting
   `Error:` is a `BootError`. The requires-WebGPU gate is read *before*
   those, because it hides the boot's elements rather than removing them
   (`src/client/webgpu/gate/README.md`): `#loading` survives with
   `display:none` and `window.stellata` is never set, so every predicate
   stays false and the wait would spend its whole timeout to say nothing.
   A mounted gate is a `BootError` naming its `data-verdict` instead.
   Then check `stellata.webgpu`: **a page that came up without the seam
   fails the scenario** rather than yielding a mislabelled measurement.
2. **Adapter probe.** WebGL renderer/vendor via `WEBGL_debug_renderer_info`,
   off a throwaway context dropped via `WEBGL_lose_context` before the sweep
   so the instrument leaves no second GPU context alive in the page it is
   about to price. Nothing measures on it: the unmasked renderer string is
   what `adapterSlug` names the committed pin file by. Then WebGPU
   `requestAdapter().info`, the fallback flag, and
   `stellata.webgpu.timestampsAvailable`. A software
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
   leading baseline alone ([Reading a row](/src/client/debug/frame-cost/README.md#reading-a-row)).

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
`scenario|backend|pass` (or `|dwell`). The band and its two shared floors —
one constant under a frame row, one per vantage under a compute row — the
`floor` column, which clock a dwell row is judged on, and every refusal that
stops an invalid comparison — most of them applied by `--against-pin`
too: `diff/README.md`.

## Pinning

`--pin pins/<slug>.json` summarises a whole-canon dwell run
as the committed perf pin; `--against-pin <path>` prints the verdicts for
the rows this run measured, lists the pin rows it did not, and exits 1 on
a `✗` or a refused row. A run refused for one row is not re-armed:
`pnpm run perf:pin` writes the pin from saved run files of one commit.
What the pin holds, what refuses it, the merge rule, the metric, floor and
ceiling: `pins/README.md`. When a PR must run it and what a mark means:
[Perf pin](/RELEASING.md#perf-pin).

## Traps

- **The machine must be idle for the whole run.** Foreground work on the
  same GPU shows up as a wide `iqrMs` (20 ms against 1–2 ms idle), a
  baseline that walks upward across the sweep, and rows that fall under
  their brackets — measured on the parity spike, where the one run taken
  during other work was the one that looked like a headless defect.
- Everything in [Measurement canon](/docs/render-rules.md#9-measurement-canon) and
  [Reading a row](/src/client/debug/frame-cost/README.md#reading-a-row): a `savedMs` under
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

`--json` output and the run's log go under the `.perf-runs/<date>/` of **the
checkout you will commit from** — the worktree holding the branch, not the main
checkout and not `/tmp` or the home directory. A run written into another
checkout never appears in this branch's `git status`, so nothing will prompt
you for it and the PR ships a citation to a file no one else has.

**`git add` the run file in the PR that cites it — the folder being tracked
does not commit anything.** A bead note, a PR body or a README quoting
`.perf-runs/<date>/<file>` is a promise that the path resolves for the next
reader; [Names](../../.perf-runs/README.md#names) is where that promise is written
down. Until the file is in a commit it resolves on one machine only, and a
`git clean` ends it.

Results go to the bead's notes with the `.perf-runs/<date>/<file>` path, never
into this README. Say which vantage, backend, method, headless flag and buffer
size the run used.
