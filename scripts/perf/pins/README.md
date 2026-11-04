# Perf pins — one committed summary per GPU

`<adapter-slug>.json` (schema `stellata-perf/pin-3`) is the whole frame at
the canon vantages on one GPU, taken cold: what every render-path PR diffs
against and re-takes. Operator rules — when a PR must run it, what a mark
means, how the pin advances — are [Perf pin](/RELEASING.md#perf-pin); the flags are
[Invocation](../README.md#invocation). Runs stay under `.perf-runs/` (tracked;
`../../../.perf-runs/README.md`) and the pin cites the file it came from by
its repo-relative path.

```
scripts/perf/pins/
  <adapter-slug>.json       The committed pin, one per GPU.
  pin-pure.ts (+ test)      adapterSlug, pinFromRuns, compareToPin, the
                            gated statistic per stream, the ceiling and the
                            band-over-floor note.
  provenance/               Which run and which tree a row came from, and
                            the drift above it. Own README.
```

## Taking one

`pnpm run perf -- --mode dwell --scenario all --cooldown-ms 120000
--frames 960 --json .perf-runs/<date>/pin.json --pin scripts/perf/pins/<slug>.json`

Per `scenario|backend` the pin holds wall p50 / p90 / iqr / n /
vsyncClamped, the GPU-stream p50 where it was sound and the compute-stream
p50 beside it ([The compute row](#the-compute-row)), plus the state-guard verdict, buffer, catalogue record count, the context's
position in the run, the exposure readback rate the row was taken at,
whether its frame drew two classes, its dwell length and pacing
([Pacing](../dwell/README.md#pacing)), its throughput and main-thread
clocks ([CPU and GPU, apart](../dwell/README.md#cpu-and-gpu-apart)),
cadence, adapter probe, commit pair,
package version and the run file the row came from. **Any refused row
refuses the whole pin** — failed,
tainted, not dwell, not `raf-delta`, trending at a *gated* vantage, a round
trip, a headed run, no record count, no position, or **taken under a setup
lever** ([Setup levers](#setup-levers)) — because a pin missing a
row narrows the gate silently, and for the same reason `--pin` refuses a
command line short of `--scenario all`, or one naming the whole canon in
another order ([Run position](#run-position)).

A row at no canon position is left out rather than pinned
([Run position](#run-position)).

`--accept <scenario>|<backend>[|compute]:<bead>` records an accepted mark
as provenance for the value now pinned; it never filters a verdict. The
compute row is its own key, so accepting a context's frame never accepts
its compute pass with it.

## From saved runs

A refused row does not cost a second arm. The run file is first-hand data
already — the arm protected the machine's idleness, which is spent — so
the pin is written from it offline:

```
pnpm run perf:pin -- <run.json>... [--pin scripts/perf/pins/<slug>.json]
                     [--accept <scenario>|<backend>:<bead>]... [--dry-run]
```

**Rows merge across runs of ONE commit.** Every run named must carry the
same `git.commit`, the same adapter slug and a headless browser, and — where
more than one is named — a clean tree, since two dirty runs at one hash need
not be one tree. Each canon row is taken from the **newest** run in which it
is sound — by the run's own `finishedAt`, so the order they are named in
changes nothing; a row sound in no run refuses the pin, naming every run's
reason. Reading freshness off the argument list instead made the rule a
convention the caller could invert in silence: the same two runs named the
other way round moved eight of ten rows to the older run while `takenAt`
stayed the newer run's, so the file claimed a take time eight of its own
rows predated.
Merging narrows nothing: the whole-pin refusal exists so a partial pin
cannot silently drop a row, and two cold runs of identical code supply the
same row. A Tier 1 `--against-pin` run of the same commit is a run file too,
and fills its two rows. Every row records `sourceRun`, the pin lists
`sourceRuns`, and a row taken at a position the pin run does not take it at
is refused — a check run that visited `sol` first would otherwise pin
`sol|webgpu` at position 1, where nothing later compares it. `sourceRuns`
lists the runs oldest first whatever order they were named in. On 2026-09-13
this would have written the compaction pin after its second run instead of
its third, and the cull pin after its second run and a check instead of a
fourth arm.

**The accept gate is the same one `--pin` applies in a live run.** Where a
pin already sits at the destination it is compared against, its provenance
lines print, and a `✗` no `--accept` covers refuses the write. A file there
that is not a readable pin — another schema, after a bump — is named and
passed over: it can gate nothing, and replacing it is what the writer is
for. `--dry-run` prints the rows, the run each came from, every run that
refused one, and the verdicts, and writes nothing. Exit 1 is a refusal,
2 a bad flag or an unreadable run.

## Run position

The run visits its five contexts in the canon order — mw120, sol, earth,
mw50, lg — and every row records where it sat. **A row
compares only against one taken at the same position**, in `--against-pin`
and `--baseline` alike: the GPU's load history before a context moves its
frame time on unchanged code, and the state guard cannot see it because
each run's own quarters stay flat. mw120|webgpu read 21.950 ms as 8th of
10 behind 120 s cool-downs and 21.464 as 1st of 2 cold — 0.486 ms, twice
the floor — while two runs of the same shape agreed to 0.019. A cool-down
does not reset it: sol at 2nd of 10 behind 120 s idle matched sol at 2nd
of 2 with none to 2e-6 ms (stellata-8cg.49.27).

The order is chosen so the pin run's first two contexts are exactly the
Tier 1 run's — `--scenario mw120,sol --backend webgpu` — in the same
order, which is what lets Tier 1 read `--against-pin` directly instead of
hunting for a recent run of its own shape ([Perf pin](/RELEASING.md#perf-pin)).
`TIER1_SCENARIOS` in `../scenarios.ts` is the prefix and a test holds the
canon to it; reordering either constant re-takes the pin. `--pin` enforces
the order rather than the membership for the same reason — a permuted run
covers all five contexts and pins every one of them where nothing later
looks.

**A row at no canon position is left out rather than pinned.** An archive
taken before the WebGPU cutover carries one row per retired backend; such a
row compares with nothing, every comparison being at equal position, so
pinning it would put a value in the file that no later run can be judged
against.

## The compute row

Every WebGPU context prints two rows: `mw120|webgpu` for the frame's
render passes and `mw120|webgpu|compute` for its compute passes, each
from its own timestamp pool and each banded on its own pinned value, the
compute row on its own floor below and both on the same ceiling and vantage
stand-down ([Reading `--against-pin`](#reading---against-pin)).
The two are never summed: `gpu.frame` has meant the render passes in
every pin row ever taken, and a compute pass that read as no change was
the instrument blind where the programme aims — every cheaper-per-frame
candidate on this backend is a compute dispatch, so a 40 ms kernel landed
as `~` on the frame row. A compute row on neither side
— prints nothing; one side alone prints `·` ungated with a note naming
the side that lacks it, which is what a pin taken before the compute pool
was resolved reads as until it is re-taken. The side with no reading prints
**empty**, not zero: a fabricated zero makes `delta` restate `current`, and
a whole column of untaken rows reads as a column of moves. A context refused
for its frame carries no compute row: the refusals are facts about the run.

**The row is gated on its p10, not its median, because the stream holds two
modes and the median is a statistic of their share.** Every WebGPU compute
stream carries one population near a floor value and a dearer one about
0.22 ms above it at earth, interleaved at a scale of one to three frames.
A dear sample sits on a frame whose render time is unchanged — 13.06 ms
against 12.68 at earth, the cheap frames split by their own sample's mode —
so it is not the GPU downclocking, and it is uncorrelated with the readback
class. The share of the dear mode runs **0 % to 58 % across runs of identical
code**, and the median follows it: on the M4, earth's p50 spanned 0.169 ms
over the gate's own comparable population while its p10 spanned 0.057. On the
M6 the order reverses at earth and sol (p50 0.025 / 0.044, p10 0.359 / 0.396)
and holds at mw120 (0.137 / 0.019); the row keeps one statistic for every
vantage.

Nothing inside a run separates them. Every one of those runs reads
`stateGuard: steady`, and the quarter medians of the 58 % run are flat
(0.557 / 0.568 / 0.580 / 0.535) because every quarter holds both modes. A
longer dwell does not settle it either: the interleave is already at frame
scale and the level is flat across the dwell's deciles, so what varies is the
share **between** runs, which no dwell length reaches.

**The floor is this row's own, one number per vantage**, with its
derivation and the cap that binds at sol: [The compute floor](../floors/README.md#the-compute-floor).

**The dear mode is printed, never gated.** `spread` is `p90 − p10` on the same
stream, and its delta sits beside every dwell row in both tables. A pass that
genuinely costs more on some frames than others — work deliberately spread
across frames, as the extinction refill is — lifts that column and leaves the
p10, which is a reading worth having rather than scatter to divide out. What
the gate refuses to do is mark on it, because a coincidence of timing moves
the same number.

Two of the three guards stay inert at this magnitude: `PIN_CEILING_MS` is
81× mw120's compute value on the M6 pin, and `STATE_GUARD_TREND_MS` (1 ms)
is at least every canon compute median (lg's, the largest, reads 1.001), so a
compute row's own `stateGuard` could read `trending` only on a quarter-to-
quarter swing the size of the whole row, and nothing consults it — the frame row's verdict is what refuses
the context.

**The frame rows are deliberately NOT re-floored**
([The whole-frame floor](../floors/README.md#the-whole-frame-floor)).

**A split-frame frame row is read on its plain class, and both classes are
recorded.** Where a vantage draws two pass classes — `earth` alone in the
canon — the GPU stream holds two populations, ordinary frames near 12 ms and
readback frames near 75. The mixture's median is a statistic of their share
and its middle-half spread straddles both, so the standard error built from
that spread is a cliff on what fraction of the *resolved* samples are the
dear ones: under a quarter the 75th percentile sits at the boundary between
the classes, past a quarter inside the upper one. Two cold shipped-path runs,
identical scene, `readbackPerFrame` 0.25 on both:

```
            resolved   dear   share     p75      IQR   mixture band
ce361e6f     850/960    210   24.7 %   14.47     2.73           0.25
83439653     515/960    195   37.9 %   73.95    61.22           5.01
```

The dear frames resolve either way — 210 and 195 of the ~240 the cadence
asks for. What moved is the cheap frames' resolve rate, 0.89 to 0.44, which
is the instrument's and not the tree's. So the pinned side alone could open
the band to 38 % of the frame it gated, and no later run narrowed it: the
band is `max(2σ, floor)` over the pair, and one side's σ was already past
every floor. `readbackPerFrame` does not catch it either, being a share of
all frames rather than of resolved ones, so it matched on both sides and the
readback guard stayed silent.

Taken from the class the median sits in, that spread runs **0.036 to 0.104 ms**
over the same population against **0.128 to 5.013** for the mixture — always
under the floor, exactly as every unsplit vantage's is. So the row's metric is
`gpu-plain-p50` and its band is the floor again. The median barely moves with
it (mixture span 1.448 ms, plain class 1.524), which is what says this is a
spread fix and not a change of what is measured.

`gpuClasses` on the row carries **both** classes — cut, median, `iqrMs` and
sample count each — so the readback frame keeps a reading of its own where the
mixture median gave it none. Read it as summed pass occupancy rather than
frame time ([Where the frame has two classes](../dwell/README.md#where-the-frame-has-two-classes-the-gpu-stream-median-follows-the)).

**The counters decide that there are two classes; the gap only says where to
cut.** `splitFrameClasses` reads `renderPasses` min against max, and the class
cut is taken only where that says two. Without it a vantage that merely
wanders takes a cut of its own — `lg`'s stream spans as far inside one dwell
as it does between runs, and read `gpu-plain-p50` on every archived dwell when
the widest gap alone decided. Both sides must yield classes, or the row falls
back to the mixture on both: a plain-class median against a mixture one is two
statistics.

**A band far past its floor is named on the row.** `BAND_OVER_FLOOR_FACTOR`
(4×) puts a note on any row whose own two-sigma term, not its floor, is what
sets the band — the shape that wrote a 5.01 ms gate on a 13.31 ms frame with
nothing looking. A note and not a refusal, because any refused row refuses the
whole pin.

## Setup levers

A pin holds no `params` of its own: it is taken with every setup lever at its
default, and an absent precondition already reads as that default
([The refusals](../diff/README.md#the-refusals)). So the empty record IS the pin's
preconditions, and `preconditionRefusal` against it is the whole test — one
implementation, so `--pin` and `--against-pin` refuse the same run for the
same reason.

**`--force-recompute` is the lever this catches**, being the only
precondition a **dwell** carries (its pacing is a row field, compared like
its length); the rest are differential-only and a pin is dwell-mode, so
they could never differ here. A dwell taken under it marches every star every
frame, which lands on the compute row ([The compute row](#the-compute-row)) against a pinned
value that is the compaction alone. Read against the pin, that is a large `✗`
attributed to whatever code is under review; **written** as the pin, it
carries the lever's cost in every later run's verdict — the ratchet
[Perf pin](/RELEASING.md#perf-pin) exists to stop. Any future lever a dwell can carry
inherits the same refusal without another edit.


## State guard

What `trending` means, which clock the verdict is read off, and why it is the
quarters' spread rather than a rise through them: [The state guard](../dwell/README.md#the-state-guard),
beside `stateGuardVerdict` itself.

Here it decides two things. A trending row at a **gated** vantage refuses the
pin and refuses a comparison; at an ungated one it does neither
([Reading `--against-pin`](#reading---against-pin)). And **`--baseline` goes on refusing it either
way, which is the rule rather than an oversight**: the two gates share one
implementation of every refusal that is a fact about the run, but this one is
a fact about the vantage, and `--baseline` bands lg like any other row it
holds. A gate stands down only where it does not mark. `--cooldown-ms` idles
between contexts so each one starts cold; tune it until every gated context in
a pin run reads `steady`.

## Reading `--against-pin`

- **Metric.** On a GPU-paced row, throughput, with a `|cpu` row beside it
  and a CPU-bound context refused — in the run, and when the pin is
  written, so no pinned row is CPU-bound
  ([CPU and GPU, apart](../dwell/README.md#cpu-and-gpu-apart)). On an
  rAF-paced row, the GPU-stream p50 alone — the one continuous whole-frame
  reading the pin holds. Two cold pins on identical code put four of the
  five canon vantages inside 0.18 %. Wall time is quantised to the
  display's refresh interval, so it is recorded and never marked: a row
  with no GPU stream on either side reads
  `·` ungated with its wall p50 shown as context. The `metric` column
  names which statistic the row was judged on, and it is not the same at
  every row: `gpu-plain-p50` where the vantage draws two pass classes and
  `compute-p10` on a compute row ([The compute row](#the-compute-row)).
- <a id="ungated-vantages"></a>**Ungated vantages, and `lg` is one under rAF pacing.** `RAF_UNGATED_SCENARIOS`
  maps a vantage the band never marks on an rAF-paced row to the reason,
  which the row's note prints; `ungatedBecause` is the one reading of it, by
  vantage and recorded pacing. **A GPU-paced lg row is gated like any other.**
  Under rAF pacing `lg`'s GPU duration **wanders as much inside a single dwell as it
  does between runs**, so its median is not a stable estimator there and
  there is no level to hold it to. Measured over every dwell ever taken at
  the pin buffer: lg's within-dwell quarter span runs 0.090–1.775 ms, median
  0.626, against 0.005–0.501 ms and a median near 0.02 at the other four
  vantages — and its spread across runs, 1.608 ms, is the same size as that
  within-dwell wander rather than 30× it as the others' is. 4 of 14 lg
  dwells trip the state guard; 0 of 56 elsewhere do. Reproduced at 9.216 Mpx
  (where the frame clears the refresh interval), at run positions 1, 5 and
  10, cold and warm, across a dozen commits — so it is a property of the
  vantage and **not** waiting on a fix — under rAF pacing, where all of
  that was measured. GPU-paced on the M6, lg's throughput reads 4.037 /
  4.063 / 4.037 ms over three cold runs, every quarter inside 0.08 ms of its
  run's others and every run steady (`8cg-49-42-gpu-all-{3,4}.json`,
  `.perf-runs/2026-11-04/8cg-49-38-m6-pin.json`) — the stability the other
  four vantages show, so the stand-down does not reach it. On an rAF-paced row the band
  stands down, and so does the **state guard**: a trending lg is that same wander read across the quarters,
  not a verdict on the run, and since any refused row refuses the whole pin,
  leaving the refusal in force killed roughly one pin re-take in three on the
  one row the gate never acts on — a full held-idle sweep each.
  **On an rAF-paced row the stand-down is keyed on the vantage**, so it covers an lg row whose
  adapter resolved no GPU stream and is therefore gated on wall. Such a row
  earns the exemption on the other ground: its wall median sits on the
  refresh interval, so its quarters swing by a whole interval however idle
  the machine is, exactly as mw50's do ([State guard](#state-guard)) — and refusing there
  spends a re-take to protect a verdict nothing reads, the row carrying no
  band and no ceiling either. Everything else still reaches the row: the
  ceiling below still marks lg, and a failed, tainted, resized or
  mis-positioned lg still refuses, those being facts about the run rather
  than about lg. **`lg` is
  the only canon vantage that sees the Local Group**, so against an
  rAF-paced pin a `src/client/local-group/` render change has no row that
  prices it short of the ceiling: price one there with a per-pass
  differential at lg. A GPU-paced pin's lg row prices it.
- **Band.** On a frame row the pair's two-sigma standard error floored at
  `max(DWELL_FLOOR_MS 0.25 ms, DWELL_FLOOR_FRACTION 1 % × pinned)`; on a
  compute row the vantage's own constant and nothing else ([The compute
  row](#the-compute-row)); on a `|cpu` row the pair's two-sigma term floored
  at the vantage's own uncapped constant ([The CPU floor](../floors/README.md#the-cpu-floor)). A `✗` is past it; `~` is not resolved, never "no change".
  Which of the frame floor's two terms binds: [The whole-frame floor](../floors/README.md#the-whole-frame-floor). A band the two-sigma term rather than the floor set is named on the
  row (`BAND_OVER_FLOOR_FACTOR`), which is what catches a spread that belongs
  to the instrument. Both floors live in `../floors/`, shared with
  `--baseline` ([Band floors](../floors/README.md)). **A frame row's `✗` is not
  final on one run** — its band sits under its own repeat scatter, and what
  covers that is the re-run rule in [What a mark means](/RELEASING.md#what-a-mark-means), not a
  wider floor.
- **Floor.** Each GPU row also records its 10th-percentile frame off the raw
  samples, and the table prints how far that p10 moved beside `delta`. A cost
  every frame pays lifts the floor as far as the median (across 111 archived
  cross-commit moves, ×1.07); a wander lifts the upper half alone and leaves
  it (the two 2026-09-13 false marks: median +0.47 / +0.43, p10 −0.08 /
  +0.01). A `✗` whose floor moved under `FLOOR_FOLLOWS_FRACTION` (a quarter)
  of the median's says so in its note. Never marked on a frame row: the
  floor's own repeat scatter is wider than the median's at earth and sol, so
  it is the discriminator, not the gate. The p10 and not the single fastest
  frame, which is noisier again — repeat-pair |Δ| tails of 1.473 ms against
  1.353. Blank on a compute row, where the p10 *is* the metric and the column
  would restate `delta`, and on throughput and CPU rows, which keep no
  per-frame floor. `frameFloor` lives in `../dwell/dwell-pure.ts`
  because `--baseline` prints the same column off the same statistic
  ([Comparing against a baseline](../README.md#comparing-against-a-baseline)), and a reader asking "cost
  or wander?" must not have to ask it differently of the two tables.
- **Spread.** `p90 − p10` on the same stream, and how far it moved. Never
  marked, on any row: it is the reading that says some frames got dearer
  while the rest did not — a pass deliberately spread across frames, or a
  class of frame that costs more — which the gated statistic is chosen not to
  follow.
- **Ceiling.** A row's gated value — GPU-stream p50, throughput mean or CPU
  p50 — over `PIN_CEILING_MS` (33.4 ms, two 60 Hz
  intervals of hardware time) is `✗` whatever the band says — and on an
  ungated vantage too, which is where it earns its keep: those rows have
  nothing else watching them.
- **Refusals.** Another adapter slug or a headed run refuses the whole
  comparison; a failed, tainted or resized (> 1 % buffer) row refuses that
  row, a trending one does where the vantage is gated, and so does a
  **record count** more than 1 % apart or absent, a **run position** that
  differs or is absent ([Run position](#run-position)), a **readback duty cycle** over
  `READBACK_TOLERANCE` (25 %) from the pinned rate where the frame draws two
  pass classes (`../dwell/README.md` — `earth` is the one canon vantage that
  does), or a row the run measured that the pin does not hold. **Two pass
  classes on EITHER side turns that guard on**: the pin carries no counters,
  so it records the row's own verdict as `splitFrame`, and the run's counters
  alone cannot answer it — a duty cycle approaching 1 makes every frame a
  readback frame and the counters read flat. The readback
  guard declines where either side holds no rate rather than refusing the
  row: it narrows an already-gated comparison, where the others answer what
  a row cannot be read without, and refusing every row until a cold re-take
  is spent would cost an idle machine to protect what the rest already hold.
  A refused comparison is not a pass: either kind exits 1,
  since a run whose rows were all refused prints a table with no `✗` in
  it. **Pin rows the run did not visit are listed, not refused** — the table
  walks the run's rows, so a Tier 1 run answers for its two and prints the
  other three as `not measured in this run`.
- <a id="record-count"></a>**Record count.** `recordCount` is the star records the page loaded, off
  the catalogue binary's header. It moves how many instanced quads every
  star pass draws — the most direct frame-cost change the repo can make. A
  pin taken at 329,657 records went on being compared against after
  membership reached 384,115, and the next render-path PR read the whole
  step as its own regression (stellata-8cg.53). `--baseline` refuses on it
  too.

  **The bound is 1 %** (`RECORD_COUNT_TOLERANCE`), the same the buffer
  gets: past it the row is refused, under it it compares. 1 % of the
  present catalogue is ~3,900 records, and the measured step for 54,458 was
  0.39–0.59 ms of GPU frame, so pro rata ~0.03–0.04 ms against a floor of
  `max(0.25 ms, 1 %)` — an order of magnitude under the smallest delta a
  row can be marked for. It is also the bound `perf-section-check.sh`
  requires a re-take past, and it has to be the same number: a membership
  change that owes no `## Perf` section ships without re-taking the pin, so
  a stricter refusal here would leave that pin refusing every row for the
  next render-path PR. An **absent** count still refuses whatever its size
  would have been — nothing places the row on a scene at all.
- **Writing while comparing.** `--pin` alongside `--against-pin` refuses
  to write while any `✗` lacks an `--accept <row>:<bead>`, so an
  unexamined regression cannot quietly become the pinned value.

The slug is the chip plus the WebGPU architecture from the adapter probe
(`apple-m6-metal-3`); two machines with the same silicon share a pin, which
is the same rule `--baseline` applies to its adapter string.
