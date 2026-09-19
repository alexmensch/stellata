# Perf pins — one committed summary per GPU

`<adapter-slug>.json` (schema `stellata-perf/pin-3`) is the whole frame at
the canon vantages on one GPU, taken cold: what every render-path PR diffs
against and re-takes. Operator rules — when a PR must run it, what a mark
means, how the pin advances — are `RELEASING.md` § Perf pin; the code is
`../pin-pure.ts`, the flags `../README.md` § Invocation. Runs stay under
`.perf-runs/` (tracked; `../../../.perf-runs/README.md`) and the pin cites the
file it came from by its repo-relative path.

## Taking one

`pnpm run perf -- --mode dwell --scenario all --backend both --cooldown-ms 120000
--json .perf-runs/<date>/pin.json --pin scripts/perf/pins/<slug>.json`

Per `scenario|backend` the pin holds wall p50 / p90 / iqr / n /
vsyncClamped, the GPU-stream p50 where it was sound and the compute-stream
p50 beside it (§ The compute row), plus the state-guard verdict, buffer, catalogue record count, the context's
position in the run, the exposure readback rate the row was taken at and
whether its frame drew two classes, cadence, adapter probe, commit pair,
package version and the run file the row came from. **Any refused row
refuses the whole pin** — failed,
tainted, not dwell, not `raf-delta`, trending at a *gated* vantage, a round
trip, a headed run, no record count, no position, or **taken under a setup
lever** (§ Setup levers) — because a pin missing a
row narrows the gate silently, and for the same reason `--pin` refuses a
command line short of `--scenario all --backend both`, or one naming the
whole canon in another order (§ Run position).
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

The run visits its ten contexts backend-major in the canon order —
mw120|webgpu, sol|webgpu, earth|webgpu, mw50|webgpu, lg|webgpu, then the
five WebGL2 contexts — and every row records where it sat. **A row
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
hunting for a recent run of its own shape (`RELEASING.md` § Perf pin).
`TIER1_SCENARIOS` in `../scenarios.ts` is the prefix and a test holds the
canon to it; reordering either constant re-takes the pin. `--pin` enforces
the order rather than the membership for the same reason — a permuted run
covers all ten contexts and pins every one of them where nothing later
looks.

## The compute row

Every WebGPU context prints two rows: `mw120|webgpu` for the frame's
render passes and `mw120|webgpu|compute` for its compute passes, each
from its own timestamp pool and each banded on its own pinned value with
the same floor, ceiling and vantage stand-down (§ Reading `--against-pin`).
The two are never summed: `gpu.frame` has meant the render passes in
every pin row ever taken, and a compute pass that read as no change was
the instrument blind where the programme aims — every cheaper-per-frame
candidate on this backend is a compute dispatch, so a 40 ms kernel landed
as `~` on the frame row. A compute row on neither side — every WebGL2 row
— prints nothing; one side alone prints `·` ungated with a note naming
the side that lacks it, which is what a pin taken before the compute pool
was resolved reads as until it is re-taken. The side with no reading prints
**empty**, not zero: a fabricated zero makes `delta` restate `current`, and
a whole column of untaken rows reads as a column of moves. A context refused
for its frame carries no compute row: the refusals are facts about the run.

**The floor is inherited, not calibrated here, and it is most of the
quantity it gates.** `max(0.25 ms, 1 % × pinned)` was derived from how far
two cold whole-frame dwells of one tree disagree — a 10–30 ms reading. The
compute values it now bands are 0.299 / 0.394 / 0.410 / 0.311 / 0.626 ms, so
the millisecond term runs **40–84 % of the pinned value**, while the pair's
own sampling error is 0.003–0.021 ms, one to two orders under it. In
absolute terms the row still catches what it exists for — a dispatch that
adds or moves more than 0.25 ms of GPU work, the ceiling above catching a
kernel that runs away entirely. What it cannot see is the existing
compaction getting most of the way to twice as dear. Two of the three
guards are inert at this magnitude for the same reason: `PIN_CEILING_MS` is
112× mw120's compute value, and `STATE_GUARD_TREND_MS` (1 ms) exceeds every
compute median, so a compute row's own `stateGuard` cannot read anything but
`steady` and nothing consults it — the frame row's verdict is what refuses
the context. Calibrating a compute floor needs the repeat scatter of two
cold runs and there has only ever been one: `stellata-8cg.74` owns it.

## Setup levers

A pin holds no `params` of its own: it is taken with every setup lever at its
default, and an absent precondition already reads as that default
(`../diff/README.md` § The refusals). So the empty record IS the pin's
preconditions, and `preconditionRefusal` against it is the whole test — one
implementation, so `--pin` and `--against-pin` refuse the same run for the
same reason.

**`--force-recompute` is the lever this catches**, being the only one a
**dwell** carries; the rest are differential-only and a pin is dwell-mode, so
they could never differ here. A dwell taken under it marches every star every
frame, which lands on the compute row (§ The compute row) against a pinned
value that is the compaction alone. Read against the pin, that is a large `✗`
attributed to whatever code is under review; **written** as the pin, it
carries the lever's cost in every later run's verdict — the ratchet
`RELEASING.md` § Perf pin exists to stop. Any future lever a dwell can carry
inherits the same refusal without another edit.

## What the commit fields hold

`git.commit` is HEAD at take time and `git.mainCommit` is its merge base
with `origin/main`. Both, because a pin is always taken on a branch and a
squash merge lands that tree under a hash the branch tip never had — so the
tip alone cannot answer "how far has main moved since?". The merge base can,
and survives the squash. `git.mainReachable` records whether the tip was on
main when taken, which for most runs is simply `false`.

`--against-pin` re-asks the ancestry at comparison time rather than trusting
`mainReachable`, since a tip unlanded when the pin was taken may have landed
since. A tip that never lands is **reported, not refused** — taking a pin on
a branch is the normal case, and refusing would leave no usable pin at the
moment one is most wanted. The header then prints main's own
`git diff --shortstat` under `src/client` between the two bases, because a
mark is only the PR's if nothing else moved the frame in between: one pin sat
at an unlanded tip and charged four consecutive PRs — one with no per-frame
code at all — for ~1,600 insertions of main's own render-path work
(stellata-8cg.49.24).

The line **names both bases and reads the counts in that direction** rather
than saying main moved since the pin. A branch cut before the pin was taken
holds the older of the two, and the insertions and deletions are then the
other way up; naming both ends also makes the line a `git diff` command a
reader can re-run.

### A deferred measurement cites a run file, never the pin

A bead that asks for a measurement later names the baseline **run** —
`.perf-runs/<date>/<file>.json` — and not "compare against the pin".

Retrieval is not what makes a late comparison fail. Every pin is committed,
so any historical one comes back without checking anything out:

```
git show <commit>:scripts/perf/pins/<slug>.json > /tmp/pin.json
pnpm run perf -- … --against-pin /tmp/pin.json
```

What fails is the **drift above**, which only grows while the bead waits, and
which no amount of recovering old pins repairs — the thing being priced is
today's code, and the older the pin the more of main's own render-path work
sits between the two bases and lands on this diff's row. A run file cannot
drift: it is one tree's numbers, immutable, and it stays a usable baseline
long after the pin that was current beside it has moved on.

So the order of preference is **take the run while the context that wants it
is loaded**; failing that, record the baseline run file and what flags it
used, since a comparison is only valid against a run whose flags match
(§ Setup levers — a `--force-recompute` or `--readback-every` mismatch is not
a comparison).

## State guard

Every dwell summary is read in four consecutive quarters
(`quarterMedians`); their medians spanning more than
`STATE_GUARD_TREND_MS` (1 ms) reads `trending`: the machine changed state
under the dwell — the sustained-load GPU power step (stellata-0it.38),
entered after roughly 2–2.5 min of continuous frames and re-entered
inside one row when warm. **The test is the spread, not a rise through
the quarters**: that power step is a step, so it lands as
`[16.9, 16.9, 21.8, 21.8]`, flat and then flat higher, which a
strictly-rising test reads as steady. Frames either side of the
transition never compare, so a trending row at a gated vantage refuses the
pin and refuses a comparison — at an ungated one it does neither
(§ Reading `--against-pin`). **`--baseline` goes on refusing it either way,
and that divergence is the rule rather than an oversight**: the two gates
share one implementation of every refusal that is a fact about the run, but
this one is a fact about the vantage, and `--baseline` bands lg like any
other row it holds. A gate stands down only where it does not mark.
`--cooldown-ms` idles between contexts so each one starts cold; tune it
until every gated context in a pin run reads `steady`.

**The verdict is read off the clock the band gates** — the GPU stream where
the row has one, wall only where it does not (`gatingClock`, every WebGL2
row). Wall deltas are quantised to the refresh interval, so at a vantage
whose frame exceeds one interval they alternate between one and two and the
quarter medians swing by a whole interval however idle the machine is: mw50
split 240 deltas 120/120 and 117/123 on two cold runs whose GPU quarters
spanned 0.017 ms. Read off wall, that verdict is a coin flip decided per
quarter by which side of 50 % it landed — and since any refused row refuses
the whole pin, it blocked the pin for *every* render-path PR at random. Wall
`stateGuard` is still recorded, unmarked, exactly as wall p50 is.

## Reading `--against-pin`

- **Metric.** The GPU-stream p50 alone — the one continuous whole-frame
  reading the pin holds. Two cold pins on identical code put four of the
  five canon vantages inside 0.18 %. Wall time is quantised to the
  display's refresh interval, so it is recorded and never marked: a row
  with no GPU stream on either side, every WebGL2 row among them, reads
  `·` ungated with its wall p50 shown as context.
- **Ungated vantages, and `lg` is permanently one.** `PIN_UNGATED_SCENARIOS`
  maps a vantage the band never marks to the reason, which the row's note
  prints. `lg`'s GPU duration **wanders as much inside a single dwell as it
  does between runs**, so its median is not a stable estimator there and
  there is no level to hold it to. Measured over every dwell ever taken at
  the pin buffer: lg's within-dwell quarter span runs 0.090–1.775 ms, median
  0.626, against 0.005–0.501 ms and a median near 0.02 at the other four
  vantages — and its spread across runs, 1.608 ms, is the same size as that
  within-dwell wander rather than 30× it as the others' is. 4 of 14 lg
  dwells trip the state guard; 0 of 56 elsewhere do. Reproduced at 9.216 Mpx
  (where the frame clears the refresh interval), at run positions 1, 5 and
  10, cold and warm, across a dozen commits — so it is a property of the
  vantage and **not** waiting on a fix. The band stands down, and so does the
  **state guard**: a trending lg is that same wander read across the quarters,
  not a verdict on the run, and since any refused row refuses the whole pin,
  leaving the refusal in force killed roughly one pin re-take in three on the
  one row the gate never acts on — ~25 min of held-idle machine each.
  **The stand-down is keyed on the vantage, so it takes `lg|webgl2` with
  it**, where the gating clock is the wall clock and not the GPU stream every
  figure above is measured on. That row earns the exemption on the other
  ground: its wall median sits on the refresh interval, so its quarters swing
  by a whole interval however idle the machine is, exactly as mw50's do
  (§ State guard) — and refusing there spends a re-take to protect a verdict
  nothing reads, a WebGL2 row carrying no band and no ceiling either.
  Everything else still reaches the row: the ceiling below still marks a
  WebGPU lg, and a failed, tainted, resized or mis-positioned lg still
  refuses, those being facts about the run rather than about lg. **`lg` is
  the only canon vantage that sees the Local Group**, so a
  `src/client/local-group/` render change has no pin row that prices it short
  of the ceiling: price one with a per-pass differential at lg instead, never
  with its pin row.
- **Band.** The pair's two-sigma standard error, floored at
  `max(DWELL_FLOOR_MS 0.25 ms, DWELL_FLOOR_FRACTION 1 % × pinned)` — about
  8× the largest cold-to-cold move those four rows showed. A `✗` is past
  both; `~` is not resolved, never "no change". The millisecond term is
  the larger of the two at every canon row but mw50, so it is what sets
  sensitivity in practice. The floor lives in `../diff/diff-pure.ts` beside
  `band` because `--baseline` applies the same one: the tighter of two
  gates is the one that decides, so a Tier 1 band under this one would
  mark a move Tier 2 calls unresolved (`RELEASING.md` § Perf pin).
- **Floor.** Each GPU row also records its 10th-percentile frame off the raw
  samples, and the table prints how far that p10 moved beside `delta`. A cost
  every frame pays lifts the floor as far as the median (across 111 archived
  cross-commit moves, ×1.07); a wander lifts the upper half alone and leaves
  it (the two 2026-09-13 false marks: median +0.47 / +0.43, p10 −0.08 /
  +0.01). A `✗` whose floor moved under `FLOOR_FOLLOWS_FRACTION` (a quarter)
  of the median's says so in its note. Never marked: the floor's own repeat
  scatter is wider than the median's at earth and sol, so it is the
  discriminator, not the gate. The p10 and not the single fastest frame,
  which is noisier again — repeat-pair |Δ| tails of 1.473 ms against 1.353.
  `frameFloor` lives in `../dwell/dwell-pure.ts` because `--baseline` prints
  the same column off the same statistic (`../README.md` § Comparing against
  a baseline), and a reader asking "cost or wander?" must not have to ask it
  differently of the two tables.
- **Ceiling.** A GPU-stream p50 over `PIN_CEILING_MS` (33.4 ms, two 60 Hz
  intervals of hardware time) is `✗` whatever the band says — and on an
  ungated vantage too, which is where it earns its keep: those rows have
  nothing else watching them.
- **Refusals.** Another adapter slug or a headed run refuses the whole
  comparison; a failed, tainted or resized (> 1 % buffer) row refuses that
  row, a trending one does where the vantage is gated, and so does a
  **record count** more than 1 % apart or absent, a **run position** that
  differs or is absent (§ Run position), a **readback duty cycle** over
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
  other eight as `not measured in this run`.
- **Record count.** `recordCount` is the star records the page loaded, off
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
(`apple-m4-metal-3`); two machines with the same silicon share a pin, which
is the same rule `--baseline` applies to its adapter string.
