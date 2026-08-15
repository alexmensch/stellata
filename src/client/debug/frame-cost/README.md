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
- **Camera stationary, clock paused.** The pose is snapshotted and a move
  warns at the end. A running clock re-arms the binary orbit field's full
  per-frame upload inside the timed scope.
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
- Across runs, `debug.priceFrameRepeat(n)`'s per-pass range is the final
  word; it prints one line per pass.

**Never sum the column.** Each row is a marginal cost against the same
baseline, and passes share bandwidth — disabling `hdrChain` also makes
`mwBand` cheaper, so both rows count some of the same milliseconds. The
column will happily "explain" more than 100% of a frame.

## Budget

`SWEEP_BUDGET_MS` caps a sweep at 180 s; past it the run stops and the
warning **names the passes it did not price**. Slow viewpoints need
`{ dwellFrames: 40 }` or a split `{ passes: [...] }` run — each split run
re-measures its own baselines, which is a free consistency check.
