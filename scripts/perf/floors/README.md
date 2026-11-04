# Band floors — the least a dwell row must move to count

Every dwell row in both gates is banded at the pair's two-sigma standard
error, floored at a constant this folder owns. How the band itself is built
and read: [Reading the table](../diff/README.md#reading-the-table) and
[Reading `--against-pin`](../pins/README.md#reading---against-pin).

```
scripts/perf/floors/
  floors.ts (+ test)    DWELL_FLOOR_MS / DWELL_FLOOR_FRACTION, the
                        per-vantage COMPUTE_SCATTER_FLOOR_MS and
                        CPU_SCATTER_FLOOR_MS, CPU_CLOCK_STEP_MS, and the
                        three functions both gates band through
                        (dwellFloorMs, computeFloorMs, cpuFloorMs). The test
                        derives both per-vantage tables from the archived
                        runs.
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
from the cold-to-cold spread of two pins on identical code. On the GPU-paced
M6 pin the millisecond term is the larger at every canon frame row — the
dearest, mw50, reads 13.147 ms, where 1 % is 0.131; the 1 % term binds only on
a frame past 25 ms.

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
`performance.now()` resolution, `CPU_CLOCK_STEP_MS`), so each constant is
1.5× the cpu-p50 span of the comparable population rounded up to a whole
step, and never under one step. **`cpuFloorMs` applies it half a step
wider.** Every median is itself a whole number of steps, stored as float32, so
a move of exactly the constant would land on the band edge and the rounding
would pick its verdict — sol 1.3→1.6 marked where mw50 3.2→3.5 did not. Half a
step puts the edge between two moves the clock can show: up to the constant
reads `~`, one step more marks, wherever the median started.

```
        cpu-p50 runs                        span   FLOOR
mw120   1.6 / 2.6 / 2.6 / 2.6 / 2.7 / 2.3   1.1    1.7
sol     1.3 / 1.4 / 1.4 / 1.4 / 1.5 / 1.4   0.2    0.3
earth   1.4 / 1.4 / 1.5 / 1.4               0.1    0.2
mw50    3.2 / 3.4 / 3.4 / 3.3               0.2    0.3
lg      1.1 / 1.1 / 1.1 / 1.1               0.0    0.1
```

The population is every GPU-paced M6 dwell a gate would compare — 960
frames, 4.096 Mpx, canon position, throughput steady — and
`floors.test.ts` derives both tables' constants from the files themselves:
`.perf-runs/2026-11-03/8cg-49-42-gpu-all-{3,4}.json` (02cf403f, a dirty
tree) and `.perf-runs/2026-11-04/8cg-49-38-{m6-pin,tier1-1,tier1-2,m6-check}.json`
(1b0a6a68 to feb31d8e, clean; no frame-path code moves across that range),
the two Tier 1 runs visiting mw120 and sol alone. A run added to the
population is added to that test's list.

**mw120's main thread holds two modes, near 1.4 and near 3.0 ms, and the
share between them is set per run.** The pin run held the upper mode on 30 %
of its frames, the other four that carry the split on 61–68 %, every run's quarters flat. So its
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
mw50      0.014     0.05         0.016
earth     0.359     0.25         0.025   capped
sol       0.396     0.25         0.044   capped
lg        0.008     0.05         0.013
```

The span is of the whole comparable population, which bounds the noise from
above by containing any real change as well. That population is every row a
gate would actually compare against the M6 pin — GPU-paced, 960 frames,
4.096 Mpx, canon position, one catalogue, no setup lever, **and its frame row
steady**, the last because a trending context is refused rather than banded
([State guard](../pins/README.md#state-guard)): the six runs
[The CPU floor](#the-cpu-floor) names. Each constant is 1.5× the p10 span
rounded up to 0.05 — so `COMPUTE_SCATTER_FLOOR_MS` holds 0.60 at sol and
0.55 at earth, and
the FLOOR column is what `computeFloorMs` applies after **capping at
`DWELL_FLOOR_MS`**. The cap is what makes a re-derivation only ever tighten a
row, and it binds at sol and earth: each is banded at 0.25 under its own
measured scatter — 0.396 at sol (p10 0.437–0.833 over six runs of one frame
path), 0.359 at earth (0.456–0.815) — so a repeat pair can mark either on
nothing. That is the
cost of the cap; lifting sol to its derived 0.60 would buy it back and is the
alternative on the table. Both tables key on every canon vantage and on
nothing else: `assertPerfFile` and `assertPinFile` refuse a file naming any
other scenario, so no lookup here meets one.

**On the M6 the p10 is not the quieter statistic at every vantage.** At earth
and sol the p50 spans an order of magnitude less than the p10; at mw120 the
reverse. The row gates on the p10 everywhere, one statistic for every
vantage, so that column is a reading, not the gate.

The p10 keeps the sensitivity the median had and adds some. A real per-frame
cost lifts it: earth's compute reads 0.351 plain and 3.100 under
`--force-recompute`, and the extinction-refill pair moved it 0.081 — a change
the median missed against earth's M4 floor of 0.10 while reading 0.117. Under
the M6 floor of 0.25 (capped from 0.55) that move reads `~` as well.

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
