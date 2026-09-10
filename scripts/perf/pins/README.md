# Perf pins — one committed summary per GPU

`<adapter-slug>.json` (schema `stellata-perf/pin-2`) is the whole frame at
the canon vantages on one GPU, taken cold: what every render-path PR diffs
against and re-takes. Operator rules — when a PR must run it, what a mark
means, how the pin advances — are `RELEASING.md` § Perf pin; the code is
`../pin-pure.ts`, the flags `../README.md` § Invocation. Runs stay under
`.perf-runs/` in the main checkout; the pin cites the file it came from by
its path relative to that checkout, since this file ships in a public repo.

## Taking one

`pnpm run perf -- --mode dwell --scenario all --backend both --cooldown-ms 120000
--json <main checkout>/.perf-runs/<date>/pin.json --pin scripts/perf/pins/<slug>.json`

Per `scenario|backend` the pin holds wall p50 / p90 / iqr / n /
vsyncClamped and the GPU-stream p50 where it was sound, plus the
state-guard verdict, buffer, catalogue record count, the context's
position in the run, cadence, adapter probe, commit pair, package version
and the run file. **Any refused row refuses the whole pin** — failed,
tainted, not dwell, not `raf-delta`, trending, a round trip, a headed run,
no record count, no position — because a pin missing a row narrows the
gate silently, and for the same reason `--pin` refuses a command line short
of `--scenario all --backend both`. `--accept <scenario>|<backend>:<bead>`
records an accepted mark as provenance for the value now pinned; it never
filters a verdict.

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
canon to it; reordering either constant re-takes the pin.

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
transition never compare, so a trending row refuses the pin and refuses a
comparison. `--cooldown-ms` idles between contexts so each one starts
cold; tune it until every context in a pin run reads `steady`.

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
- **Ungated vantages.** `PIN_UNGATED_SCENARIOS` maps a vantage the band
  never marks to the reason, which the row's note prints. `lg` is there
  because it does not reproduce cold-to-cold — 11.891 → 13.360 ms between
  those two pins, a level shift *between* runs while each run's own
  quarters stay flat, so the state guard cannot see it and no cool-down
  suppresses it (stellata-8cg.49.18). Only the *band* stands down: the
  ceiling below still marks the row, and the refusals below still refuse
  it, since a trending or resized lg indicts the run's state rather than
  lg's own reproducibility. **`lg` is the only canon vantage that sees the
  Local Group**, so while it is ungated a `src/client/local-group/` render
  change has no row that prices it short of the ceiling — the gap
  stellata-8cg.49.18 closes.
- **Band.** The pair's two-sigma standard error, floored at
  `max(DWELL_FLOOR_MS 0.25 ms, DWELL_FLOOR_FRACTION 1 % × pinned)` — about
  8× the largest cold-to-cold move those four rows showed. A `✗` is past
  both; `~` is not resolved, never "no change". The millisecond term is
  the larger of the two at every canon row but mw50, so it is what sets
  sensitivity in practice. The floor lives in `../diff-pure.ts` beside
  `band` because `--baseline` applies the same one: the tighter of two
  gates is the one that decides, so a Tier 1 band under this one would
  mark a move Tier 2 calls unresolved (`RELEASING.md` § Perf pin).
- **Ceiling.** A GPU-stream p50 over `PIN_CEILING_MS` (33.4 ms, two 60 Hz
  intervals of hardware time) is `✗` whatever the band says — and on an
  ungated vantage too, which is where it earns its keep: those rows have
  nothing else watching them.
- **Refusals.** Another adapter slug or a headed run refuses the whole
  comparison; a failed, tainted, resized (> 1 % buffer) or trending row
  refuses that row, and so does a **record count** more than 1 % apart or
  absent, a **run position** that differs or is absent (§ Run position),
  or a row the run measured that the pin does not hold. A refused
  comparison is not a pass: either kind exits 1, since a run whose rows
  were all refused prints a table with no `✗` in it. **Pin rows the run
  did not visit are listed, not refused** — the table walks the run's
  rows, so a Tier 1 run answers for its two and prints the other eight
  as `not measured in this run`.
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
