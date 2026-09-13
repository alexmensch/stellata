# Dwell mode — the whole frame at one vantage

`pnpm run perf -- --mode dwell` is the runner's whole-frame mode, and the
pin (`../pins/README.md`) is a dwell run summarised. The runner's lifecycle,
flags and the other modes: `../README.md`.

## Files

```
scripts/perf/dwell/
  dwell-pure.ts (+ test)    One dwell's percentiles, the vsync-clamp flag,
                            the state guard (quarter medians), the gating
                            clock a row is judged on, the per-frame WebGPU
                            pass-count summary, and the pinned readback
                            cadence with the bound that says it held.
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

**A dwell pins a fourth input the differential leaves alone: the readback
duty cycle.** `--readback-every` (default `DWELL_READBACK_EVERY_FRAMES`, 4)
holds the statistic readback at one request per that many rendered frames
from before the warmup until the restore, through
`reduction.readbackCadence` (`src/client/hdr/exposure/reduction/README.md`
§ Latency). Emergent, the rate is whatever the readback's round trip leaves
it at — 0.25 to 0.975 across the archive — and § Where the frame has two
classes below is what that costs a median. Four is the rate every clean
`earth` dwell ran at and the app's own at the Sol default view, so the pin
holds the frame the archive measured rather than inventing one. It is a cap,
never a floor: a vantage whose round trip outruns the cadence requests less
often, which is sound and recorded. A rate ABOVE the cap cannot happen if
the lever took, so one is read as the lever not having taken and fails the
scenario (§ Five checks below).

**Several cadences make the run a PROBE, not a comparison.**
`--readback-every 4,1,2` visits the scenario once per value, and since every
one of those contexts is the same `scenario|backend` they share a diff key
and none is another's comparison — so `--pin`, `--against-pin` and
`--baseline` all refuse a list. The first cadence is repeated LAST, the same
bracket `../sweep/README.md` puts around a set of scales and for the same
reason: the GPU's sustained-load ramp moves frame time across a run whatever
the cool-down (`../pins/README.md` § Run position), so a span rising across
ascending cadences is a trend and that drift wearing the same shape. The two
readings at the first cadence bound the second. What the probe is for is
`stellata-8cg.67.2`.

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

**Where the frame has two classes, the GPU-stream median follows the
readback duty cycle, and a pair whose rates differ is refused.** The stream
samples only readback frames: across the 148 archived dwells that resolved
one, its sample count never exceeds `readbackPerFrame × frames` and runs
88–100 % of it (median 97 %, the shortfall being the readbacks still in
flight when the dwell ends). That costs nothing while every frame is the same
shape, and decides what the median measures once they are not. Only
the `earth` vantage draws two shapes: the exposure measurement resolves under
the dwell's pinned cut there, so `renderPasses` reads 4 or 10 in one dwell
(bimodal in all 23 archived WebGPU dwells carrying counters, against none of
the other 109). Measured: 17.157 ms at 0.25 readbacks per frame against
52.854 at 0.579, a 3.17× span whose wall p50 never left 16.70 ms and whose
pass-count extremes never moved off 4/10 — only the median did, as the duty
cycle crossed 50 %. `READBACK_TOLERANCE` (25 %) bounds it, clear of the 7 %
spread `earth` holds across 25 cold runs. **The guard is gated on the frame
being split**, because the same drift elsewhere is sound: `sol` moved 0.25 to
0.59 across the runs that measured its 9.33 ms saving and `mw120` to 0.51
with its median flat, and refusing those would discard real readings.

**The split is read from both sides, because the duty cycle erases its own
evidence.** As the rate approaches 1 every frame becomes a readback frame and
the counters read flat — the archive already holds rates up to 0.975 — so a
gate turning on the current run's counters alone would stand down on the
largest move it exists to catch. `--baseline` has both runs' counters; the pin
has none of its own, so it records the verdict per row (`splitFrame`) and the
comparison ors the two. A dwell written before the counters existed carries no
field at all, which reads as one class, as an unrecorded rate declines the
guard. What sets the multiple is not established — `../diff-pure.ts` carries
the rule, and the mechanism is `stellata-8cg.67.2`.

**The pinned cadence removes the drift; the guard stays because the pin is
not the only pair it judges.** Two dwells taken at the same
`--readback-every` cannot differ here at all, which is the point of pinning
it. What can still differ is a run from the archive, taken before the lever
existed, or one deliberately taken at another cadence — and the rate a row
records is the evidence either way, which is why the guard turns on the
measured rate rather than on the knob that was typed.

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

**Five checks, each able to fail.** A hold already live when the dwell starts
fails it — settle requires an unheld gate, and the debug panel takes one,
whose per-tick DOM writes would sit inside a wall-clock dwell. A clock that
was not still stopped at the end of the timed frames fails it: the frames
priced a moving scene. A readback rate over the cap the cadence
pins fails it: the lever did not take, so the duty cycle is an input again.
Then the clock rate and the hold count are read back
**from outside the page function that restored them** — a value re-read
inside the same block that just wrote it could only ever fail if `setRate`
itself refused, which is not the question worth asking. The hold check is
differential against the count seen before the dwell, so a hold the page
already owned is named as such instead of read as a leak. Any of the five
fails the scenario, because each would leave every later scenario in the run
measuring a different machine or a different frame.

