# Two runs differenced — bands, verdicts, and the refusals

`--baseline <path>` differences a run against a saved one. What counts as a
move, what refuses a pair outright, and which of those refusals the pin
applies too. The flags are [Invocation](../README.md#invocation); the pin's own table
is `../pins/README.md`.

```
scripts/perf/diff/
  diff-pure.ts (+ test)   diffRuns, the band and its two floors, and every
                          refusal that stops an invalid comparison. The
                          buffer, record-count, position, readback and
                          precondition refusals are exported because
                          `--against-pin` applies the same ones.
```

## Reading the table

`--baseline <path>` prints `✓` cheaper · `✗` dearer · `~` inside the band,
keyed `scenario|backend|pass` (or `|dwell`).

A row counts as moved only past **two sigma of the pair's own uncertainty**.
Differential rows combine the two `noiseMs` floors, then take the larger of
that and the two `bracketMs` values — the bracket is instrument drift, which
no amount of sampling reduces. Dwell rows use the median's standard error,
`1.2533·(iqr/1.349)/√n`, on both sides, floored at the same figure the pin
uses — `max(0.25 ms, 1 %)` on a frame row, the vantage's own constant on a
compute row ([Reading](../pins/README.md#reading---against-pin) `--against-pin`, § The compute
row). **The floors are shared deliberately.** Two sigma of the
medians' own scatter describes sampling and nothing else, and a dwell's run
conditions move it further: at 240 frames on a steady vantage that band
draws around 0.02 ms, while moving a context's position within its run
moved one by 0.49 (stellata-8cg.49.27). An unfloored band would also leave
Tier 1 gating tighter than the Tier 2 it feeds, and the tighter of two
gates is the one that decides.

**`savedMs` is the trap.** It names what disabling the pass saved, i.e. the
pass's own price — so a row whose `savedMs` went UP got *dearer*, not better.
A dwell `p50` reads the same direction for the obvious reason. Both print `✗`.

**The `floor` column is the wander-or-cost discriminator, and never marks.**
Beside `delta` on a dwell row the GPU stream gates, it prints how far the
10th-percentile frame moved: a cost every frame pays lifts the floor with the
median, a wander lifts the upper half alone and leaves it. The same column
off the same statistic as the pin's — `frameFloor` is in
`../dwell/dwell-pure.ts` so both read one implementation, because a reader
asking "cost or wander?" must not have to ask it differently of the two
tables. Blank on a differential row, on a wall-gated dwell where the p10 is
quantised to the refresh interval exactly as the median is, and on a compute
row where the p10 is the metric and the column would restate `delta`.

**The `spread` column is `p90 − p10`, and never marks either.** It is the
reading the gated statistic is chosen not to follow: some frames got dearer
while the rest did not. A pass spread deliberately across frames moves it and
leaves `delta`; so does a coincidence of timing, which is why no verdict
rests on it. What the two tables do differently is only the note: the pin
calls out a `✗` whose floor did not follow ([Reading](../pins/README.md#reading---against-pin)
`--against-pin`), and this table has no note column to say it in.

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
JSON and out of the table, as [State guard](../pins/README.md#state-guard) records them.

**Where NEITHER run resolved a stream the row still marks, on wall — and
that is where this table parts company with the pin**, which prints such a
pair `ungated` and never marks it. An adapter that grants the timestamp
feature and then refuses the query set resolves no stream at all, so
refusing here would leave a baseline taken on one with nothing to print;
the pin can decline the row because it has five to fall back on. Read such
a row knowing what it is: the one case in the table where a whole-interval
delta may be the clock rather than the frame. In practice most are refused
before they print, a frame inside one interval tripping the clamp first.

**A GPU stream on one side and none on the other refuses the row**, the
same refusal a differing `method` gets and for the same reason — a
timestamp median against a wall median is two instruments. The pin prints
that pair as an ungated row instead, because a committed table shows every
vantage; here there is a refusal list to say it in.

<a id="the-compute-passes-are-a-second-dwell-row-keyed-compute"></a>**The compute passes are a second dwell row, keyed `|compute`.** Where both
runs carry the compute stream ([The compute row](../pins/README.md#the-compute-row)) it is
judged on `compute-p10` and banded on **that vantage's own floor** and nothing
else — the stream holds two overlapping modes whose share varies between runs
of identical code, so its median is a statistic of that share, while the p10
is not. The whole-frame constant would run 15× the row's noise at mw50 and
about 1× it at sol, a factor of 18 across the five. One side alone refuses the
row and leaves the frame row standing — an archive written before the compute
pool was resolved carries no stream, and a run since does; neither side
prints no compute row at all. A frame row that is refused takes its compute
row with it.

**A frame row at a vantage drawing two pass classes is judged on the plain
class**, `gpu-plain-p50`, for the same reason one field over: the mixture's
median follows the classes' share and its middle-half spread straddles them,
so the band built from that spread turns on how many samples resolved in each.
One run splitting and the other not refuses the row — a plain-class median
against a mixture median is two statistics. Where the cut comes from, and what
says there are two classes at all: `../dwell/README.md`.

## The refusals

**They matter as much as the rows.** Two runs on different clocks,
buffers or adapters produce a table that looks like a comparison and is not,
so an incomparable pair is named and skipped rather than dropped silently:
a differing adapter string refuses the whole run (a differing schema never
reaches the diff — [JSON output](../README.md#json-output)); a differing method or
mode, a buffer more than 1 % apart, a **record count** more than 1 % apart or
absent on either side (a row priced against a different catalogue is not a
comparison), a **run position** that differs or is absent on either side
(below), a **dwell length** that differs (below), a **sweep precondition**
that differs (below), a failed or tainted
scenario, a dwell clamped or trending on its gating clock, a **readback duty
cycle** over 25 % apart where the frame has two pass classes
(`../dwell/README.md`), a mismatched GPU stream, a `cadenceBound` row (either
side), or a row missing from one side refuses that key. The buffer, record
count, position, readback and precondition refusals are one implementation in
`diff-pure.ts`, applied by `--against-pin` too: the two gates must refuse the
same pair for the same reason, or the looser one certifies what the tighter
one rejects.

**Dwell length: two dwells compare only over the same number of timed
frames.** A median converges with dwell length rather than merely getting
quieter — at the runner's default 240 the `mw120` GPU median has not settled,
eight archived rows spanning 0.725 ms against a 0.25 ms band. So the two are
different statistics and the verdict between them means nothing. 960 frames
makes them comparable without making either quiet: a same-tree repeat pair
there still reaches 1.272 ms at `mw120`, which is the re-run rule in
[What a mark means,](/RELEASING.md#what-a-mark-means) not this refusal. Nothing else catches
the length mismatch itself: the state
guard compares quarters within one dwell and both read steady, and the band is
computed from the pair and widens with neither, so a pin re-taken at the wrong
length replaces a good one silently. Read off `params.frames`, where the
runner stamps the `--frames` it honoured, and carried on every pin row.
**Absent on either side declines the guard rather than refusing**, the posture
`readbackPerFrame` takes and the opposite of the record count's — a pin
written before the field existed stays usable, and only a known mismatch
refuses. [Perf pin](/RELEASING.md#perf-pin) states the Tier 2 command that has to carry
it.

**Sweep preconditions: the state a differential was SET UP in refuses the
pair.** `--pre-disable`, `--no-park` and `--force-recompute` change what the
frame contained before the roster was touched at all, and `--no-interleave`
changes how every row is differenced — a non-interleaved sweep differences
every row against the leading baseline alone rather than against the pair
either side of it, so the two sides estimate the same cost with different
estimators ([Reading a row](/src/client/debug/frame-cost/README.md#reading-a-row)). All
four are recorded in `params` and compared there. `--force-recompute` is the one of them a **dwell** carries
too — a dwell taken under it runs the extinction kernel on every frame — so
that refusal is what stops such a run being read against the pin, and what
stops one being written as the pin ([Setup levers](../pins/README.md#setup-levers)).
Pre-disabled keys compare as sets, so the order they were typed in is not a
difference. `--empty-passes` refuses at the **row** level instead — it reaches
the `emptyPass` row alone, and refusing a whole scenario for it would drop
twelve sound rows to protect one. This is what stops the subtraction those
flags exist for ([The roster](/src/client/debug/frame-cost/passes/README.md#the-roster))
being read off a row-against-row verdict: it is a bound taken across two runs
by hand, and the two runs are not comparable in the sense this table means.

**An absent precondition reads as the flag's own default, not as unknown** —
the opposite of the record count's rule, and worth stating because of it. A
run written before these flags existed pre-disabled nothing, since there was
no way to ask; a run carrying no record count may have priced any scene at
all. So an old baseline still compares.

**Run position: two rows compare only when their contexts sat at the same
place in their runs.** The GPU's load history before a context moves its
frame time on unchanged code, and each run's own state guard cannot see
it — the guard compares quarters within one dwell, and both runs read
steady. Measured: mw120|webgpu at 21.950 ms as 8th of 10 behind 120 s
cool-downs against 21.464 as 1st of 2 cold, 0.486 ms and twice the floor,
while two runs of the same shape agreed to 0.019 ms. A cool-down does not
reset it: sol at 2nd of 10 behind 120 s idle matched sol at 2nd of 2 with
none to 2e-6 ms, so position is the variable and idle time is not. Every
record carries `position`, and a file written before the field existed
refuses as an absent record count does. The same refusal applies against
the pin ([Run position](../pins/README.md#run-position)), which is why the canon order
opens with the Tier 1 vantages ([Invocation](../README.md#invocation)).

The key carries the backend, so a vantage the other run measured on the
*other* backend says exactly that rather than reporting itself absent.
Sweeps are never diffed — a slope is not a cost.
