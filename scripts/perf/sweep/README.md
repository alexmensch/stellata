# Sweep mode — what the frame is bound by

`pnpm run perf -- --mode sweep` answers what the frame is bound by, rather
than what a pass costs: dwell at each viewport scale, fit log(frame time)
against log(backing-store pixels), and report the exponent. The runner's
lifecycle, flags and the other modes: `../README.md`.

## Files

```
scripts/perf/sweep/
  sweep-pure.ts (+ test)    Measurement order, the log-log fit, fill/vertex
                            classification, and the sweep bracket.
```

The per-scale loop is `measureSweep` in `../measure.ts`, which dwells
(`../dwell/README.md`) at each scale and hands the points here;
`SWEEP_RESIZE_WARMUP_FRAMES` stays there with it, beside the other frame
counts a run is sized by.

## Scale 1 is measured first and last

With the requested scales ascending in between: `--scales 0.5,1,1.5,2` →
`1, 0.5, 1.5, 2, 1`. The spread of those two scale-1 medians is
`bracketMs`, and it is the floor any slope claim sits on, for the same
reason the differential brackets each row — an instrument that ramped its
clocks across the sweep produces a dependence on elapsed time that fits as
a dependence on area.

**The viewport moves; dpr does not.** Scaling both would confound area
with the per-pixel work dpr also multiplies.

## Reading the slope

`≥ 0.8` fill-bound, `≤ 0.3` vertex- or CPU-bound, between them mixed. In
the JSON the fit is its own block — `sweep.fit.slope`, `.r2`, `.bound`,
and `.fitted`, the number of points the line was drawn through, so named
because `sweep.points` one level up is the points themselves.

**Any vsync-clamped point makes the whole fit inconclusive**, not merely
noisier — that point measured the panel, so it flattens the line and a
fill-bound frame reads as vertex-bound.

The first point pays a full warmup; later scales pay
`SWEEP_RESIZE_WARMUP_FRAMES` (60), enough to absorb the HDR target rebuild
the resize forces, since the clock ramp was already paid.

**A sweep is never diffed** — a slope is not a cost
([The refusals](../diff/README.md#the-refusals)).
