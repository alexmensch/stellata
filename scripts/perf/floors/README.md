# Band floors — the least a dwell row must move to count

Every dwell row in both gates is banded at the pair's two-sigma standard
error, floored at a constant this folder owns. How the band itself is built
and read: [Reading the table](../diff/README.md#reading-the-table) and
[Reading `--against-pin`](../pins/README.md#reading---against-pin).

```
scripts/perf/floors/
  floors.ts (+ test)    DWELL_FLOOR_MS / DWELL_FLOOR_FRACTION, the
                        per-vantage COMPUTE_SCATTER_FLOOR_MS, and the two
                        functions both gates band through.
```

**One module for both gates.** `--baseline` (`../diff/`) and
`--against-pin` (`../pins/`) must floor the same row the same way: the
tighter of two gates is the one that decides, so a Tier 1 band under the
Tier 2 one it feeds would mark a move Tier 2 calls unresolved
([Perf pin](/RELEASING.md#perf-pin)).

## The whole-frame floor

`dwellFloorMs` is `max(DWELL_FLOOR_MS 0.25 ms, DWELL_FLOOR_FRACTION 1 % ×
baseline)`, under every frame row — the GPU stream, wall, throughput. Two sigma of the medians' own scatter describes
sampling alone, and a dwell's run conditions move it further than that: the
same vantage read 21.950 and 21.464 ms across two runs of identical code,
differing only in where the context sat in its run. Both forms were derived
from the cold-to-cold spread of two pins on identical code. The millisecond
term is the larger at every canon frame row but mw50.

**The frame rows are deliberately NOT re-floored, and the asymmetry is the
finding.** Their repeat scatter runs *past* the 0.25 they are gated on: of
the same-tree pairs on disk, 4 of 9 at mw120, 6 of 11 at sol and 3 of 5 at
earth land outside the band, the worst 1.272 ms at mw120 — 7 % of the frame,
so a floor sized for it ends the gate rather than tightening it. What
covers that instead is an operator rule, [What a mark means](/RELEASING.md#what-a-mark-means):
a frame-row `✗` does not stand until a second cold run reproduces it.
`stellata-8cg.74` carries both measurements and the decision. Those pairs
are rAF-paced GPU-stream rows; a GPU-paced throughput row's own repeat
scatter is measured separately
([CPU and GPU, apart](../dwell/README.md#cpu-and-gpu-apart)).

## The CPU floor

**The `|cpu` row's floor is its own, one number per vantage, and uncapped** —
`CPU_SCATTER_FLOOR_MS`, applied by both gates through `cpuFloorMs` from
`CPU_JUDGEMENT`. The row reads 1.1–3.4 ms in 0.1 ms steps (Chrome's
`performance.now()` resolution), so each constant is 1.5× the cpu-p50 span
of the comparable population rounded up to a whole step, and never under
one step.

```
        cpu-p50 runs                  span   FLOOR
mw120   1.6 / 2.6 / 2.6 / 2.6 / 2.7   1.1    1.7
sol     1.3 / 1.4 / 1.4 / 1.4 / 1.5   0.2    0.3
earth   1.4 / 1.4 / 1.5               0.1    0.2
mw50    3.2 / 3.4 / 3.4               0.2    0.3
lg      1.1 / 1.1 / 1.1               0.0    0.1
```

The population is every GPU-paced M6 dwell a gate would compare — 960
frames, 4.096 Mpx, canon position, throughput steady:
`.perf-runs/2026-11-03/8cg-49-42-gpu-all-{3,4}.json` and
`.perf-runs/2026-11-04/8cg-49-38-{m6-pin,tier1-1,tier1-2}.json`, the last
two visiting mw120 and sol alone.

**mw120's main thread holds two modes, near 1.4 and near 3.0 ms, and the
share between them is set per run.** The pin run held the upper mode on 30 %
of its frames, the other four on 61–68 %, every run's quarters flat. So its
median, its p10 and its mean all step together with the share, and no
statistic of that stream holds still across runs of identical code. The
floor covers the step rather than refusing the row, so mw120's CPU row is
blind to a move under 1.7 ms — about two-thirds of its CPU time — while the
other four keep a band at or under the whole-frame floor. **Uncapped, unlike
the compute floor**, because capping at 0.25 marks every Tier 1 run on
unchanged code whenever the pin and the run caught different shares.

## The compute floor

**The compute row's floor is its own, one number per vantage** —
`COMPUTE_SCATTER_FLOOR_MS`, keyed on the vantage the way
`RAF_UNGATED_SCENARIOS` keys lg's stand-down, and applied by both gates
through `computeFloorMs`. Why that row gates on its p10 rather than its
median: [The compute row](../pins/README.md#the-compute-row).

```
        p10 span   FLOOR       p50 span
mw120     0.019     0.05         0.137
mw50      0.015     0.05         0.003
earth     0.152     0.25         0.022
sol       0.396     0.25         0.044   capped
lg        0.008     0.05         0.013
```

The span is of the whole comparable population, which bounds the noise from
above by containing any real change as well. That population is every row a
gate would actually compare against the M6 pin — GPU-paced, 960 frames,
4.096 Mpx, canon position, one catalogue, no setup lever, **and its frame row
steady**, the last because a trending context is refused rather than banded
([State guard](../pins/README.md#state-guard)): the five runs
[The CPU floor](#the-cpu-floor) names. Each constant is 1.5× the p10 span
rounded up to 0.05 — so `COMPUTE_SCATTER_FLOOR_MS` holds 0.60 at sol, and
the FLOOR column is what `computeFloorMs` applies after **capping at
`DWELL_FLOOR_MS`**. The cap is what makes a re-derivation only ever tighten a
row, and sol is the one vantage it binds at: sol's compute row is banded at
0.25 under its own measured scatter of 0.396 (p10 0.437–0.833 across five
runs of identical code), so a repeat pair can mark it on nothing. That is the
cost of the cap; lifting sol to its derived 0.60 would buy it back and is the
alternative on the table. A name outside these five — no canon vantage is one
today — takes `DWELL_FLOOR_MS` rather than banding the row on a `NaN`.

**On the M6 the p10 is not the quieter statistic at every vantage.** At earth
and sol the p50 spans an order of magnitude less than the p10; at mw120 the
reverse. The row gates on the p10 everywhere, one statistic for every
vantage, so that column is a reading, not the gate.

The p10 keeps the sensitivity the median had and adds some. A real per-frame
cost lifts it: earth's compute reads 0.351 plain and 3.100 under
`--force-recompute`, and the extinction-refill pair moved it 0.081 — a change
the median missed against earth's M4 floor of 0.10 while reading 0.117. Under
the M6 floor of 0.25 that move reads `~` as well.

**The floor IS the whole band on this row.** The p10's own sampling term runs
an order of magnitude under every constant above, and the constants are
measured repeat scatter, which contains it; so the two-sigma term would change
no verdict and is not taken. The 1 % term survives for a row that has run
away — under `--force-recompute` mw120's compute reads 13.17 ms, where 1 % is
0.132 and the vantage floor is not what binds.

The whole-frame `max(0.25 ms, 1 % × pinned)` does not transfer to this row:
it was drawn from how far two cold **whole-frame** dwells of one tree
disagree — a 10–30 ms reading — and reads as 15× the noise at mw50 and
about 1× it at sol, a factor of 18 across the five under one constant. At
mw120 the compaction could have got most of the way to twice as dear and
printed `~`, which is the row's whole purpose missed.
