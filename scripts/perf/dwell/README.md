# Dwell mode — the whole frame at one vantage

`pnpm run perf -- --mode dwell` is the runner's whole-frame mode, and the
pin (`../pins/README.md`) is a dwell run summarised. The runner's lifecycle,
flags and the other modes: `../README.md`.

## Files

```
scripts/perf/dwell/
  dwell-pure.ts (+ test)    One dwell's percentiles, the vsync-clamp flag,
                            the state guard (quarter medians), the gating
                            clock a row is judged on, and the per-frame
                            WebGPU pass-count summary.
```

The dwell loop itself is a page function in `../page-protocol.ts`
(`runDwell`), driven from `../measure.ts`.

## What a dwell measures

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
taken after settle (`../README.md` § What a run does, step 4) is the
display's cadence with the gate idle, and
the clamp test is judged against it: 16.67 ms on a 60 Hz panel, 8.33 on a
120 Hz one. Headless Chromium's virtual display idles at 16.70 ms (59.9 Hz),
measured on every canon vantage on both backends (stellata-8cg.49.13's
notes) — the same cadence as a 60 Hz panel, though headed and headless still
never compare. The tolerance is `CADENCE_TOLERANCE` (6 %) of the measured
interval, and `isVsyncClamped` is shared with the differential's own
`cadenceBound` rule — both live in `frame-cost-pure.ts`.
The console line says which cadence the verdict was judged against. **The GPU
row is never clamped**: a resolved timestamp is a span the hardware reports,
and no compositor can pad it.

**Every summary carries a state guard** (`quarterMedians`, `stateGuard`):
a dwell that trended is refused by `--baseline`, and by `--against-pin`
where the vantage is one the band gates — `../pins/README.md` § State guard.

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
the pass-roster module over the dev server (`PASS_TOGGLES_MODULE_URL`), never
a second spelling of it; a pass not active at the vantage fails the scenario
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

