# Dwell mode — the whole frame at one vantage

`pnpm run perf -- --mode dwell` is the runner's whole-frame mode, and the
pin (`../pins/README.md`) is a dwell run summarised. The runner's lifecycle,
flags and the other modes: `../README.md`.

## Files

```
scripts/perf/dwell/
  dwell-pure.ts (+ test)    One dwell's percentiles, the vsync-clamp flag,
                            the state guard (quarter medians), the gating
                            clock a row is judged on, the two pass classes a
                            split frame draws, the per-frame WebGPU
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
([Preconditions](/src/client/debug/frame-cost/README.md#preconditions)) and they hold here
for the same reasons — a running clock re-arms the binary orbit upload inside
the timed scope, and an unpinned exposure lets the dwell drift onto a
different star population.

**A dwell pins a fourth input the differential leaves alone: the readback
duty cycle.** `--readback-every` (default `DWELL_READBACK_EVERY_FRAMES`, 4)
holds the statistic readback at one request per that many rendered frames
from before the warmup until the restore, through
`reduction.readbackCadence` ([Latency](/src/client/hdr/exposure/reduction/README.md#latency)).
Emergent, the rate is whatever the readback's round trip leaves
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
the cool-down ([Run position](../pins/README.md#run-position)), so a span rising across
ascending cadences is a trend and that drift wearing the same shape. The two
readings at the first cadence bound the second. What the probe is for is
`stellata-8cg.67.2`.

**rAF wall-clock deltas are the metric.** On a WebGPU boot the frame-sample
stream is subscribed alongside where `gpuFrameSamplesAreSound()` says the
adapter resolves believable durations, and reported as a second row
(`gpu-timestamp`, the render passes) — and the compute stream from the same
resolve cycle as a third (`gpu-compute`: the star compaction every frame,
plus the extinction prepass on the frames it recomputes;
[An exact frame total, and no per-pass rows at all](/src/client/debug/gpu-timing/README.md#an-exact-frame-total-and-no-per-pass-rows-at-all)). The three are different
instruments: read them side by side, never differenced, and never sum the
two GPU rows into a frame total — `gpu.frame` means the render passes in
every pin row and every archived dwell. Each stream is subscribed on its own
soundness verdict, so one can be recorded while the other is refused, and
the `gpu stream:` line names whichever side dropped out and why. A canon vantage is
camera-idle, so its compute row is the compaction alone; the recompute's
own price needs the forced-recompute lever (`stellata-8cg.64`) before a
dwell can see it.

`p50 / p90 / p99` are nearest-rank, so every number printed is a frame that
happened. **`vsyncClamped` invalidates the dwell rather than annotating it**:
a p50 sitting on a whole number of the display's period, inside a spread
tighter than the tolerance, is the compositor's cadence, not the frame's
cost — the frame finished early and the panel supplied the rest. Any whole
number, because a frame that overran one interval is held to the next: 12 ms
of work on a 120 Hz panel reads 16.67, still the display's number. A clamped
dwell is refused by `--baseline` and makes a sweep inconclusive.

**The period is the one the run measured, not 60 Hz assumed.** The rAF probe
taken after settle ([What a run does,](../README.md#what-a-run-does) step 4) is the
display's cadence with the gate idle, and
the clamp test is judged against it: 16.67 ms on a 60 Hz panel, 8.33 on a
120 Hz one. Headless Chromium's virtual display idles at 16.70 ms (59.9 Hz),
measured on every canon vantage (stellata-8cg.49.13's
notes) — the same cadence as a 60 Hz panel, though headed and headless still
never compare. The tolerance is `CADENCE_TOLERANCE` (6 %) of the measured
interval, and `isVsyncClamped` is shared with the differential's own
`cadenceBound` rule — both live in `frame-cost-pure.ts`.
The console line says which cadence the verdict was judged against. **The GPU
row is never clamped**: a resolved timestamp is a span the hardware reports,
and no compositor can pad it.

## The state guard

Every dwell summary is read in four consecutive quarters (`quarterMedians`);
their medians spanning more than `STATE_GUARD_TREND_MS` (1 ms) reads
`trending`: the machine changed state under the dwell — the sustained-load GPU
power step (stellata-0it.38), entered after roughly 2–2.5 min of continuous
frames and re-entered inside one row when warm. **The test is the spread, not
a rise through the quarters**: that power step is a step, so it lands as
`[16.9, 16.9, 21.8, 21.8]`, flat and then flat higher, which a strictly-rising
test reads as steady. Frames either side of the transition never compare.

**The verdict is read off the clock the band gates** — the GPU stream where
the row has one, wall only where it does not (`gatingClock`; an adapter
that refuses the query set resolves none). Wall deltas are quantised to the refresh interval, so at a vantage whose
frame exceeds one interval they alternate between one and two and the quarter
medians swing by a whole interval however idle the machine is: mw50 split 240
deltas 120/120 and 117/123 on two cold runs whose GPU quarters spanned
0.017 ms. Read off wall, that verdict is a coin flip decided per quarter by
which side of 50 % it landed — and since any refused row refuses the whole
pin, it blocked the pin for *every* render-path PR at random. Wall
`stateGuard` is still recorded, unmarked, exactly as wall p50 is.

Which gate acts on the verdict, and where it stands down:
[State guard](../pins/README.md#state-guard).

**A dwell also counts what the frame submits.** For the timed frames
it wraps `GPUQueue.submit` and `GPUCommandEncoder.beginRenderPass` /
`beginComputePass` on their prototypes and records, per rAF interval, the
submits, the command buffers they carried, and the render and compute
passes encoded — then puts the originals back in the same `finally` as the
clock and the hold. The table prints min / p50 / max per counter, since a
count is small and quantised: a readback frame carries the reduction
chain's extra passes, so the distribution is bimodal and the extremes are
the two modes. It is an API-surface count, not a GPU cost — the per-pass
floor is still a differential ([§ 8](/docs/render-rules.md#8-submits-and-passes-are-costs)). A dwell with no
queue to count on records null.

<a id="where-the-frame-has-two-classes-the-gpu-stream-median-follows-the"></a>**Where the frame has two classes, the GPU-stream median follows the
readback duty cycle, and a pair whose rates differ is refused.** Only the
`earth` vantage draws two shapes: the exposure measurement resolves under the
dwell's pinned cut there, so `renderPasses` reads 4 or 10 in one dwell
(bimodal in all 23 archived WebGPU dwells carrying counters, against none of
the other 109). The stream samples a little over half the rendered frames, so
the sampled mix is the frame population's mix and the median lands in
whichever class holds the majority.

**It samples the two shapes evenly at one-in-two and sparser, and lopsidedly
at one-in-one.** Over the seven contexts below, the fraction of readback
frames sampled against the fraction of plain ones runs 0.55/0.58, 0.57/0.55,
0.60/0.56, 0.56/0.57 and — at the two one-in-four contexts, which bracket the
run — 0.67/0.47 and 0.49/0.60. At one-in-one it is **0.89 against 0.12**, so
the share reads 0.894 at a rate of 0.539 rather than tracking it. Why the
sampler skews where readbacks go out on every frame it can is not established;
what the guard needs is that the share rises with the rate, which holds
throughout. Do not read share and rate as the same number near one.

**The two classes cost what they cost; only their SHARE moves.** Measured
directly by pinning the cadence from one-in-one to one-in-eight over seven
cold contexts of 1200 frames (`.perf-runs/2026-09-13/`, 4.096 Mpx headless):
the low class reads 11.9–14.1 ms and the high 51.1–58.6 at every duty cycle,
while the share of samples in the high one runs 0.118 at 0.125 readbacks per
frame to 0.894 at 0.539 — rising with the rate, though not equal to it at the
top end. The median crosses when that
share crosses a half, 13.20 ms against 56.19, a **4.3× step from a frame
whose wall p50 never leaves 16.70 ms**. The 3.17× first seen between two
archived runs was the same crossing, caught part-way.

**The high class is not a duration, and the arithmetic says so.** At 0.539 the
median implies 67.4 s of GPU work inside a 20.0 s dwell (3.37×); every other
cadence reads 0.79–0.93×. three allocates a timestamp pair per render pass and
sums them, so a 10-pass readback frame counts overlapping spans twice over
where a 4-pass frame has little to overlap. Read the GPU row at a two-class
vantage as summed pass occupancy, never as frame time.

**So the gate reads the classes apart, and records both.** `sampleClasses`
cuts the stream at the widest gap between consecutive samples, taken only
where that gap exceeds the median of everything below it — earth's classes sit
about four times apart and separate on every archived dwell, while a stream
holding one population, or two modes that merely overlap, correctly finds
nothing. **The widest gap is sought only among those leaving
`CLASS_MIN_SHARE` of the samples on each side**, because a class is a
population the frame draws repeatedly and one sample is never one: earth's
classes stand 51.8 ms apart, so a single 133 ms frame outranks that
separation on width alone, and the cut then lands above both classes with the
lower one holding the whole mixture — the mixture median reported under the
`gpu-plain-p50` label, which is the one reading this whole section exists to
stop. The **counters** are what says there are two classes to find:
`renderPasses` min against max. Without that gate a vantage that merely
wanders takes a cut of its own, `lg` on every dwell it has ever recorded.
What the pin then holds, and what the band is built from:
[The compute row,](../pins/README.md#the-compute-row) last.

`READBACK_TOLERANCE` (25 %) bounds the rate drift, clear of the 7 % spread
`earth` holds across 25 cold runs. **The guard is gated on the frame being
split**, because the same drift elsewhere is sound: `sol` moved 0.25 to 0.59
across the runs that measured its 9.33 ms saving and `mw120` to 0.51 with its
median flat, and refusing those would discard real readings.

**The sample count tracks `readbackPerFrame × frames` only while the cadence
is EMERGENT.** Across the 148 archived dwells it never exceeded that product
and ran 88–100 % of it, which read as "the stream samples only readback
frames" — but those runs all let the two readbacks contend. Pin the statistic
readback and the timestamp resolve runs at its own rate: 627–696 samples per
1200 frames in all seven contexts above, against a product as low as 150. The
bound describes the coupling, not the sampler.

**The split is read from both sides, because the duty cycle erases its own
evidence.** As the rate approaches 1 every frame becomes a readback frame and
the counters read flat — the archive already holds rates up to 0.975 — so a
gate turning on the current run's counters alone would stand down on the
largest move it exists to catch. `--baseline` has both runs' counters; the pin
has none of its own, so it records the verdict per row (`splitFrame`) and the
comparison ors the two. A dwell written before the counters existed carries no
field at all, which reads as one class, as an unrecorded rate declines the
guard. `../diff/diff-pure.ts` carries the rule.

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
inside its own measurement.

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

