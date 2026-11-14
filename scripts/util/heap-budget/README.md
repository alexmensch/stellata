# CI heap budget

A heavy build step's peak live heap, judged against the CI runner's V8 heap
limit as an `emitArtifacts` check (`../emit-artifacts.ts`).

- `heap-budget.ts` — `watchHeap(step)`, started first thing in a step's
  `main`, and its `check()`, the step's peak live heap against the CI
  runner's. `build:catalog`, `build:membership`, `build:classic-ids` and
  `build:astrometry-request` carry it.
- `heap-budget-pure.ts` (+ test) — `CI_HEAP_LIMIT_BYTES`,
  `CI_HEAP_HEADROOM`, `peakLiveHeap` and `heapBudgetCheck`, the verdict.

## Why the runner, not the machine

A workstation build is no evidence that CI can run the same step: the
catalogue job's `ubuntu-latest` runner gives Node a V8 heap of about 4 GiB,
and a step whose live data nears that fails there with `JavaScript heap out
of memory` while passing locally. So a heavy step judges itself against the
runner, not the machine it runs on. `CI_HEAP_LIMIT_BYTES`
(`heap-budget-pure.ts`) is the runner's limit, V8's 4,096 MiB old-space
default there (a Node 24 OOM log reports 4,104.1 MiB committed, as "MB");
`CI_HEAP_HEADROOM` is the share a step may use. Figures print in MiB, the
unit V8's own log uses.

**The runtime is part of the measurement.** The same `build:catalog` holds
about 45% more live heap under Node 24 than under Node 26 (measured
2026-10-30: 4,042 MiB against 2,782 MiB), so a reading taken under one
major says nothing about another. `.nvmrc` is the one place the Node
version is named: every workflow's `setup-node` reads it
(`node-version-file`), and the check fails, without judging the heap, when
the step runs under a different major. Run heavy steps locally under the
pinned Node.

The measure is **live** heap — what a full (mark-compact) collection leaves
— because that is what runs out: garbage a roomier machine has not yet
collected is not. V8's `GCProfiler` records the heap after every collection
from `watchHeap` on, and `peakLiveHeap` takes the largest a full collection
left, or the heap in use at the check if that is larger. It samples only at
full collections, which is what the headroom covers. Over budget, the check
fails the emission like any other, so nothing lands; the build log prints
the peak beside the budget either way.

When the step is legitimately bigger, shrink what it holds first — the
placement lineage keeps lines, not objects
([Storage and cost](../../catalog/lineage/README.md#storage-and-cost)). Raising
the runner's heap (`--max-old-space-size`) is the owner's call, and moves
`CI_HEAP_LIMIT_BYTES` with it.
