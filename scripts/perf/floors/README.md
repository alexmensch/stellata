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
baseline)`, under every frame row — the GPU stream, wall, throughput — and
the main-thread `|cpu` row. Two sigma of the medians' own scatter describes
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

## The compute floor

**The compute row's floor is its own, one number per vantage** —
`COMPUTE_SCATTER_FLOOR_MS`, keyed on the vantage the way
`PIN_UNGATED_SCENARIOS` keys lg's stand-down, and applied by both gates
through `computeFloorMs`. Why that row gates on its p10 rather than its
median: [The compute row](../pins/README.md#the-compute-row).

```
        p10 span   FLOOR       p50 span
mw120     0.023     0.05         0.032
mw50      0.008     0.05         0.017
earth     0.057     0.10         0.169
sol       0.087     0.15         0.284
lg        0.267     0.25         0.303   ungated, capped
```

The span is of the whole comparable population, which bounds the noise from
above by containing any real change as well. That population is every row a
gate would actually compare — 960 frames, canon position, one catalogue, no
setup lever, **and its frame row steady**, the last because a trending
context is refused rather than banded ([State guard](../pins/README.md#state-guard)). Each constant is
1.5× the p10 span rounded up to 0.05 — so `COMPUTE_SCATTER_FLOOR_MS` holds
0.45 at lg, and the FLOOR column is what `computeFloorMs` applies after
**capping at `DWELL_FLOOR_MS`**. The cap is what makes a re-derivation only
ever tighten a row, and lg is the one vantage it binds at: **the pin stands
lg down by vantage, but `--baseline` does not** ([State guard](../pins/README.md#state-guard)), so lg's
compute row is banded there at 0.25 under its own measured scatter of 0.267
and a repeat pair can mark it on nothing. That is the cost of the cap, and
`--baseline` is the gate that pays it; lifting lg to its derived 0.45 would
buy it back and is the alternative on the table. A name outside these five —
no canon vantage is one today — takes `DWELL_FLOOR_MS` rather than banding
the row on a `NaN`.

lg's 1.5× lands at 0.4005, within a thousandth of the 0.40 rung, so a
re-derivation off a population differing by one run reads 0.40 rather than
0.45. Both cap to the same 0.25; do not chase the rung.

The p10 keeps the sensitivity the median had and adds some. A real per-frame
cost lifts it: earth's compute reads 0.351 plain and 3.100 under
`--force-recompute`, and the extinction-refill pair moved it 0.081 — a change
the median missed against earth's own floor while reading 0.117.

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
