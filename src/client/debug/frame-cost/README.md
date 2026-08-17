# Frame pricing — `debug.priceFrame()`

The automated form of "disable it and difference `gpu.frame`": from
wherever the camera sits, dwell on the whole-frame GPU scope, re-dwell
with ONE pass disabled, difference the medians. Differentials are the
only honest per-pass price on ANGLE/Metal — `../README.md` § GPU timing
owns why the per-pass scopes cannot be ratioed or summed.

## Files

```
src/client/debug/frame-cost/
  frame-cost.ts               runPriceFrame / runPriceFrameRepeat, the
                              pass toggles, the dwell loop.
  frame-cost-pure.ts (+ test) Dwell statistics, the noise floor, and the
                              differential rows.
```

## Preconditions

- **Debug panel CLOSED.** The run borrows the swappable perf hooks via
  `acquireGpuFrameSampler` (`../perf-hud.ts`) — a single-scope timer that
  samples `gpu.frame` EVERY frame, because WebGL2's one-query-per-context
  limit is not shared with any rotating scope. Panel open → the call
  warns and returns `[]`. Panel opened mid-run → samples dry up and the
  run aborts rather than reporting zeros.
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
- **A timer query.** Without one (Safari) it falls back to rAF-delta wall
  time, where differentials under the vsync quantum read as zero unless
  the frame is already over budget. `method` labels every row; never
  compare the two methods' numbers.

## Priced passes

`buildPassToggles`: the local depth pass (`localDepthPass.enabled`), MW
band (`milkyway.setEnabled`), LG volumetric emission, molecular-cloud
absorption (`setAbsorptionEnabled`), the HDR chain and its four
decomposition rows (§ Decomposing the HDR chain), the luminance
reduction (`reduction.enabled`), the star core depth-mask
(`setCoreMaskEnabled`), and the extinction prepass A/B. A pass inactive
at the current view/state is skipped, not measured as zero.

Three rows are not what they look like:

- **`hdrChain`** disables via `hdr.setChartMode(true)` — the whole-target
  park, which also stops the statistic attachment and flips emitters to
  inline tone-mapping. Its row prices target-chain-vs-direct-to-canvas,
  not the resolve draw alone. The park also stops `measure()` being
  called at all, so the toggle sets `reduction.fenceWhileParked` for the
  duration: without it the row prices the loss of the frame's only
  submission barrier on top of the chain (§ The readback cadence
  confound).
- **`extinctionPrepass`** ADDS the in-vertex raymarch when disabled, so
  its `savedMs` is normally negative: the row is what the cache saves.
A fourth thing to know before reading rows at a no-cut vantage: the
adaptation park (`../../hdr/exposure/README.md` § Parking the
measurement) stops the reduction draws and the statistic writes wherever
the settled cut is exactly 0, and the exposure pin freezes it there
(collapsing a mid-probe park to parked, so every dwell prices the same
state). At those vantages the `reduction` and `statisticWrites` rows
price an already-parked frame and should read ~0 — the park working, not
the instrument failing. Both rows still price the pass wherever a cut is
live.

Measured over all five canon vantages, 3 runs each, 6.774 Mpx: neither
row resolved at any of the three dm-0 vantages, against canon's resolved
`reduction` of +17.6 % (MW50), +26.3 % (MW120) and +32–45 % (LG). The
decisive row is MW-plane 120° on a settled instrument — a 29.67 ms frame
at a 0.007 ms bracket, `reduction` reading −0.027 ms. Sol is the positive
control: `statisticWrites` still resolves +40.5 to +54.6 % (canon +47.7 /
+50.2), so the park stays off wherever the cut is live.

**These rows price the fully parked frame, not the duty cycle.** The pin
collapses the machine to parked for the whole sweep, so no probe runs
inside a dwell and the differential cannot see one. The steady-state cost
has to be reasoned from the cadence instead: the chain already only ran
on one rendered frame in four (`baselineReadback` 0.25 in every row at
every vantage), and a parked cycle is the probe interval plus the frames
its readback is in flight, so the measurement's GPU work falls by roughly
60 % — not the ~83 % the interval alone suggests. Quoting these ~0 rows
as the real-world saving overstates it.

- **`reduction`** keeps its readback fence while disabled and drops only
  the chain draws. Dropping the fence too priced the loss of the frame's
  only ANGLE submission barrier — see
  `../../hdr/exposure/reduction/README.md`. Keeping it is necessary and
  **still not sufficient** — the row reads solidly negative at the
  default Sol view with the fence held, the readback cadence identical
  in both states, and `bracketMs` at 0.23. Reproduced 2026-08-16 with
  the exposure pinned: −18.2 ms at bracket 15.1 and −52.4 ms at bracket
  0.33, limit mags equal — and at Earth close approach (−10.5 and
  −14.1, brackets 6.6 / 7.0). The sign tracks the vantage: negative at
  both deep-cut views, positive at both dm-0 views, and it flips
  positive when the statistic writes are masked (§ The compression
  probe). Unexplained; check `disabledLimitMag` against
  `baselineLimitMag` before believing any one reading, and expect the
  negative at deep-cut vantages.

## Decomposing the HDR chain

Four rows split the `hdrChain` aggregate. Each is a marginal cost
against the same baseline and they overlap — `mrtAttachments` contains
most of `statisticWrites`, `summation` and `reduction` — so never sum
them; read each against the aggregate.

- **`tonemapOp`** — `hdr.setTonemapEnabled(false)`: the resolve goes
  straight pass-through with the target and attachments untouched. The
  operator's ALU alone.
- **`statisticWrites`** — masks attachment 1 out of every emitter draw;
  the clear keeps writing it, so the reduction runs over an empty
  attachment. Prices the emitters' statistic write bandwidth — NOT the
  attachment's load/store, which only `mrtAttachments` removes.
- **`summation`** — skips the downsample and collapses the resolve's
  kernel to one centre tap: the convolution machinery, with the diffuse
  writes still paid.
- **`mrtAttachments`** — rebuilds the target with attachment 0 alone
  (holding the fence, as `hdrChain` does): attachments 1 and 2 outright —
  writes, load/store, the summation's source and the reduction's. What
  `hdrChain` saves beyond this row plus `tonemapOp` is the single fp16
  target itself against direct-to-canvas.

### The compression probe — does the reduction's cost track content?

The reduction reads 12–23 ms at vantages whose cut is exactly zero and
~zero at Earth close approach, same buffer; the working hypothesis is
lossless framebuffer compression — reducing a nearly-empty attachment is
nearly free. The test, at a vantage where the row is expensive:
`stellata.hdr.setStatisticWritesEnabled(false)`, then
`debug.priceFrame({ passes: ['reduction'] })`. The attachment is
cleared-to-zero, maximally compressible; a reduction row that collapses
to ~zero means the cost tracks the attachment's content, not the chain's
draws. Restore with `setStatisticWritesEnabled(true)`.

Measured 2026-08-16 at MW-plane 50°, exposure pinned, 6.774 Mpx: the row
did **not** collapse — reduction over the cleared attachment read
48.1 ms against 18.4 ms live (brackets 6.4 / 2.1), with the
reduction-off floors matching across the two states. Reducing the
emptiest possible attachment costs 2.6× the full star field, so "nearly
empty compresses well" is refuted. Working hypothesis, unverified: a
cleared-but-never-written surface stays in fast-clear metadata state and
sampling it forces a per-frame resolve, while a surface fully
overwritten by smooth resolved-disc texels samples cheap.

Replicated at the default Sol view: +43.1 ms at bracket 3.2 — the sign
flips from that vantage's live-writes negative, and the ~45 ms cost of
reducing a cleared attachment is vantage-independent. One gotcha the
replication exposed: masking the writes BEFORE the sweep lets the cut
fade to zero during the warmup, so the pin captures the wide-open limit
(7.8) rather than the live one — the differential stays internally
clean, but the scene is not comparable to unmasked runs at the same
vantage. The `limitMag` columns are the tell.

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
- **`baselineLimitMag` / `disabledLimitMag`** — the gate that invalidates
  a row outright rather than widening it. The faintest magnitude each
  state rendered: **if these differ, the toggle changed what the frame
  DREW**, and `savedMs` is the price of a different scene, not of the
  pass. A toggle that resets or freezes the exposure statistic is the way
  this happens.
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
