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
  end.
- **Clock paused — done for you.** The sweep pauses the `VirtualClock`
  and restores its exact rate (not `play()`, which would lose a rewind)
  in the same `finally` that restores the passes. A running clock re-arms
  the binary orbit field's full per-frame upload and moves every
  ephemeris body, both inside the timed scope. `{ pauseClock: false }`
  prices the live path instead.
- **A timer query.** Without one (Safari) it falls back to rAF-delta wall
  time, where differentials under the vsync quantum read as zero unless
  the frame is already over budget. `method` labels every row; never
  compare the two methods' numbers.

## Priced passes

`buildPassToggles`: the local depth pass (`localDepthPass.enabled`), MW
band (`milkyway.setEnabled`), LG volumetric emission, molecular-cloud
absorption (`setAbsorptionEnabled`), the HDR chain, the luminance
reduction (`reduction.enabled`), the star core depth-mask
(`setCoreMaskEnabled`), and the extinction prepass A/B. A pass inactive
at the current view/state is skipped, not measured as zero.

Three rows are not what they look like:

- **`hdrChain`** disables via `hdr.setChartMode(true)` — the whole-target
  park, which also stops the statistic attachment and flips emitters to
  inline tone-mapping. Its row prices target-chain-vs-direct-to-canvas,
  not the resolve draw alone.
- **`extinctionPrepass`** ADDS the in-vertex raymarch when disabled, so
  its `savedMs` is normally negative: the row is what the cache saves.
- **`reduction`** keeps its readback fence while disabled and drops only
  the chain draws. Dropping the fence too priced the loss of the frame's
  only ANGLE submission barrier — see
  `../../hdr/exposure/reduction/README.md`.

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
