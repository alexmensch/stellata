# Frame pricing — `debug.priceFrame()`

The automated form of "disable it and difference `gpu.frame`": from
wherever the camera sits, dwell on the whole-frame GPU scope, re-dwell
with ONE pass disabled, difference the medians. Which passes, what each
one's toggle actually changes, and the measured history of the rows whose
number is not what their name suggests: `passes/README.md`. This page is
the sweep around them — its preconditions, its drift bracketing, its
budget, and how to read a row.

**Differentials survive the WebGPU port, for a different reason.** On
WebGL2 they are the only honest per-pass price because the per-pass timer
scopes over-attribute on ANGLE/Metal. On WebGPU nothing over-attributes —
three times every render pass truly — but those per-pass durations are
keyed by an internal `timestampUID` and are not public API, so there are
no per-pass rows to read. Either way the differential is the measurement,
and on WebGPU its input is *better*: `gpu.frame` there is a sum of real
per-pass timestamps rather than one derived elapsed span.
`../gpu-timing/README.md` owns both halves.

## Files

```
src/client/debug/frame-cost/
  frame-cost.ts               runPriceFrame / runPriceFrameRepeat, the
                              sweep's options and defaults, the dwell loop.
  frame-cost-pure.ts (+ test) Dwell statistics, the noise floor, and the
                              differential rows. Owns GpuFrameMethod,
                              WARMUP_FRAMES, RAF_PROBE_FRAMES, the median
                              standard error, the interquartile spread,
                              round3 and the cadence rules
                              (CADENCE_TOLERANCE,
                              isVsyncClamped, isCadenceBound), which the
                              headless runner imports rather than
                              re-deriving — its dwell clamp and this
                              folder's cadenceBound are one predicate pair
                              (`scripts/perf/README.md`).
  gpu-frame-source.ts         Which sample source a sweep gets, per
    (+ test)                  backend, and the method label it stamps.
  passes/                     buildPassToggles and PRICED_PASS_KEYS: what
                              each row of the table disables, and what its
                              number is therefore worth. Own README.
```

## Preconditions

- **Debug panel CLOSED — on WebGL2 only.** There the run borrows the
  swappable perf hooks via `acquireGpuFrameSampler` (`../perf-hud.ts`) — a
  single-scope timer that samples `gpu.frame` EVERY frame, because
  WebGL2's one-query-per-context limit is not shared with any rotating
  scope. Panel open → the call warns and returns `[]`. Panel opened
  mid-run → samples dry up and the run aborts rather than reporting zeros.
  **On WebGPU there is no such requirement**: wherever the boot probe left
  timestamps live the render loop resolves them every frame whatever is
  listening, and the sweep just subscribes alongside the HUD.
  **A pinned `raf-delta` sweep escapes that refusal on every backend** — it
  never calls `acquireGpuFrameSampler`, so nothing consults the panel. It is
  also the one mode where an open panel corrupts the number rather than
  merely holding the slot: rAF deltas are wall time, so the panel's per-tick
  ring fills and DOM writes sit inside the measurement. They largely cancel
  in a differential and surface as a wider spread; an absolute frame time is
  biased outright. That corruption belongs to `raf-delta` however it was
  reached — pinned, or fallen back to where no GPU clock exists — and a
  panel opened mid-run keeps the samples flowing rather than drying them up
  as it does on `timer-query`, so the sweep checks at both ends: acquire
  warns, and release warns again if the panel is open when the sweep ends.
  Closing it is still on you.
- **Camera stationary.** The pose is snapshotted and a move warns at the
  end. The run holds the render gate for its duration — a still camera
  over a paused clock would otherwise be exactly the state the gate
  skips (`../../render-gate/README.md`).
- **Clock paused — done for you.** The sweep pauses the `VirtualClock`
  and restores its exact rate (not `play()`, which would lose a rewind)
  in the same `finally` that restores the passes. A running clock re-arms
  the binary orbit field's full per-frame upload and moves every
  ephemeris body, both inside the timed scope. `{ pauseClock: false }`
  prices the live path instead.
- **Exposure pinned — done for you.** After the warmup, the sweep freezes
  the adaptation cut where it converged and releases it in the same
  `finally` as the passes. **Every pass that writes the statistic
  attachment is an input to the exposure**, so toggling one moves the cut
  and the row would price a different star population instead of the
  pass — the local depth pass swings the effective limit 1.51 → 7.8 mag
  unpinned, which is six magnitudes of extra stars. `{ pinExposure:
  false }` prices the live path. `baselineLimitMag` / `disabledLimitMag`
  stay in the output as the check that it held.
- **A GPU clock.** `timestamp` on WebGPU where the adapter granted
  `timestamp-query`, `timer-query` on WebGL2 with the extension, and
  `raf-delta` wall time otherwise — WebGL2 Safari, any adapter that
  withheld the timestamp feature, and any backend that granted it but
  resolves durations no frame can have, which is Chrome today
  (`../gpu-timing/README.md` § WebGPU, § A granted feature can still
  resolve garbage).
  Under `raf-delta` a differential below the vsync quantum reads as zero
  unless the frame is already over budget *and* not itself pinned to a
  higher multiple of the refresh — so every row whose dwells the display
  decided is stamped `cadenceBound: true` (§ Reading a row). The cadence is
  the sweep's own idle rAF probe, taken after the clock stops and before the
  render gate is held, which is the one window where nothing redraws and the
  deltas are the panel rather than the frame; `{ cadenceMs }` supplies it
  instead, as the headless runner does with the period it measured after
  settle. A sweep over a *running* clock cannot probe and its rows carry no
  verdict — the console says which of the two applied.
  `method` labels every row; never
  compare numbers across two methods. The sweep picks the source itself and
  says which on the console — it never claims a clock the backend does not
  have, since that would spend the whole warmup before aborting with no
  rows. **That preference order picks each backend's BEST clock, not a
  comparable one** — the four browser × backend combinations land on three
  different methods — so a cross-backend table has to pin the method by
  hand: `debug.priceFrame({ method: 'raf-delta' })`, the one clock all of
  them share. A pinned method the backend cannot supply refuses the sweep
  outright rather than silently switching clocks, and so does a name that is
  not one of the three — the console is untyped, so a typo would otherwise
  read as an honoured pin.

## The readback cadence — measured, and NOT the confound

The reduction's `gl.flush()` is the frame's only ANGLE submission
barrier, and the rate it fires at is emergent rather than pinned — the
fence clears only when the GPU drains. The obvious worry follows:
disabling a pass makes the frame cheaper, the fence lands sooner, the
barrier fires more often, and the row prices batching depth instead of
the pass.

**Measured, it does not happen.** `baselineReadback` /
`disabledReadback` report readbacks per frame per state, and at the
default Sol view every dwell of every row read **0.25 exactly** — one
readback per four frames, identical in both states, across frames
ranging 31 ms (HDR parked) to 112 ms. The latency is constant in
*frames*, not in wall time, which is pipeline-depth buffering rather
than GPU-drain latency: it does not care what the frame costs. Keep the
columns as a standing check, but the hypothesis is refuted at this
viewpoint.

Both remain gates worth reading — **equal rates mean the row is clean on
this axis** — and a viewpoint that does move them would invalidate the
rows that moved.

## The instrument drifts, so the baseline is bracketed

An Apple-silicon GPU ramps its clocks under sustained load: a sweep
started cold walks its whole-frame time down for tens of seconds. At an
LG viewpoint the baseline fell 57 → 47 → 42 ms across three
back-to-back runs.

A single leading baseline charges all of that to whichever passes
happened to be measured late. **The tell is a run where several
unrelated passes all "cost" about the same amount** — six rows at ~10 ms
is one drifting baseline, not six coincidences.

So each disabled dwell is bracketed by baselines either side and
differenced against their mean, and the trailing baseline becomes the
next row's leading one: 2N+1 dwells for N passes. A long `warmupFrames`
(180) runs first. `{ interleave: false }` restores the fast
single-baseline sweep when the instrument is known to be settled.

## Reading a row

- **`noiseMs`** — the first gate: the combined standard error of the
  medians, from a robust σ (IQR/1.349) so one hitched frame cannot
  inflate it. A `savedMs` under it did not resolve.
- **`bracketMs`** — the second gate, and usually the binding one: how far
  the instrument moved between this row's two baselines. Bracketing
  cancels drift linear across the pair; a `savedMs` under `bracketMs` is
  drift the cancellation did not catch, whatever `noiseMs` says.
- **`iqrMs`** — the widest dwell's spread, context only. Never a gate,
  and max−min emphatically is not one either: over 120 frames a single
  outlier sets it at tens of times the real uncertainty.
- **`baselineLag1` / `disabledLag1`** — what that spread actually is,
  since `iqrMs` cannot tell three different things apart. Negative is
  frame-to-frame alternation, which is structure rather than
  uncertainty: the reduction chain only does GPU work on a frame whose
  predecessor's readback landed, so cheap and expensive frames interleave
  by construction. Near zero is the independent scatter `noiseMs`
  assumes. Positive is drift inside the dwell. **`noiseMs` is only an
  honest standard error in the middle case** — under alternation it is
  conservative, so a row that read as zero because `savedMs` fell under
  the floor may not be zero. Computed on ranks, so a hitched frame moves
  it by one sample rather than by its magnitude.
- **`baselineReadback` / `disabledReadback`** — equal is clean; diverging
  means the row priced a change in submission-barrier rate on top of the
  pass (§ The readback cadence).
- **`bufferMpx`** — the drawing buffer the sweep ran at. Run metadata, not
  a statistic, and stamped on every row so a pasted table stays
  self-describing. **Only compare tables at the same buffer size**: the
  frame is fill-bound, so halving the window area moved the whole frame
  ~3x and moved `mwBand` ~7x.
- **`cadenceBound`** — `raf-delta` rows with a known cadence only: true when
  the display's refresh interval set the median of ANY of the row's dwells,
  so the row could not have shown a sub-interval delta whatever `savedMs`
  and `noiseMs` read. Two ways in, and the second is the one a single-interval
  test misses: **at or under one interval whatever the spread** (the frame
  made every deadline with room over), or **on a higher multiple with a
  spread tighter than the 6 % tolerance** — `isVsyncClamped`, the dwell
  mode's own rule, because a frame that overran one interval is held to the
  next and 33.4 ms on a 60 Hz panel is still the display's number. Every
  dwell is tested, not their mean: a bracketed row's leading baseline can be
  pinned to the refresh while the trailing one runs long. Such a row is an
  expectation at best, never a result; `--baseline` refuses it, and one side
  carrying the flag is enough.
- **`baselineLimitMag` / `disabledLimitMag`** — the gate that invalidates
  a row outright rather than widening it. The faintest magnitude each
  state rendered: **if these differ, the toggle changed what the frame
  DREW**, and `savedMs` is the price of a different scene, not of the
  pass. A toggle that resets or freezes the exposure statistic is the way
  this happens.
- **A saving that vanishes while the frame time holds was never a cost.**
  The limit-mag gate misses a draw the backend dropped — same star
  population in both states, only one drawing it. Compare `disabledMs`
  across backends: a WebGPU `mrtAttachments` read 61 % at Sol on a
  `disabledMs` of 35 against an honest 78 (`../../webgpu/hdr/README.md`
  § The gate becomes the output struct).
- Across runs, `debug.priceFrameRepeat(n)`'s per-pass range is the final
  word; it prints one line per pass.

**Never sum the column.** Each row is a marginal cost against the same
baseline, and passes share bandwidth — disabling `hdrChain` also makes
`mwBand` cheaper, so both rows count some of the same milliseconds. The
column will happily "explain" more than 100% of a frame.

## Budget — dwells are sized to fit, not truncated

`budgetMs` caps a sweep at 180 s by default. Bracketing a slow viewpoint
blows straight through that: 2N+1 dwells of 150 frames at ~120 ms is
~5 minutes, and the naive response — stop at the ceiling — silently
drops whichever passes sit at the end of the roster.

So the first dwell is timed, and the rest are **shortened to fit** the
remaining budget, with a log line saying by how much. Every pass gets
priced; the cost lands in `noiseMs`, where it is visible, instead of in
a truncation nobody reads. Only a sweep that cannot fit even at
`MIN_DWELL_FRAMES` (30) truncates, and that path warns up front rather
than at the ceiling.

Full-length dwells at a slow viewpoint: raise `{ budgetMs }`. Or split
the roster with `{ passes: [...] }` — each split run re-measures its own
baselines, which is a free consistency check.

## Restore transients

A toggle that resets the exposure statistic leaves the frame recovering
after it is restored, and the trailing baseline is sampled during that
recovery. The chart-mode park behind `hdrChain` does exactly this: at
`settleFrames` 12 it showed as an 8–14 ms `bracketMs` on the `hdrChain`
and `reduction` rows while every other row sat under 4.5, with those two
rows' baselines depressed 5–7 ms below the sweep's others — so both
costs read slightly LOW. `settleFrames` defaults to 30 to cover several
`ADAPT_SLEW_TAU_S`. A large `bracketMs` on one row when its neighbours
are small is this effect, not drift.
