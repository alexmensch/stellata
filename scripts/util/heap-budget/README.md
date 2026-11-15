# CI heap budget

A heavy build step runs with its V8 heap capped at its share of the CI
runner's heap limit, so a step that would run out of heap on the runner runs
out on every machine.

- `heap-budget-pure.ts` (+ test) — `CI_HEAP_LIMIT_MIB`, `CI_HEAP_HEADROOM`,
  `HEAP_BUDGET_MIB` (their product, floored), `heapCappedEnv` (the cap as
  `NODE_OPTIONS`), `heapRuntimeVerdict` (the Node major against `.nvmrc`'s),
  `HEAP_CAP_NOTE` (what the runner appends to a capped step's failure) and
  `nodeMajor`.
- `heap-budget.ts` (+ test) — `nodeRuntime()`, this process's Node major and
  the pinned one. The test runs real `tsx` processes holding a known live
  heap: one above a small cap fails, one below passes.

The runner (`../../pipeline/runner.ts`) applies it to every build step whose
table entry carries `heap: 'ci-budget'` — `build:catalog`, `build:membership`,
`build:classic-ids` and `build:astrometry-request` today
([Step table](../../pipeline/step-table/README.md#the-step-table--stepsts)).
The cap is a V8 start-up flag, so it is set where the step's process starts,
never inside the step.

## Why the runner, not the machine

A workstation build is no evidence that CI can run the same step: the
catalogue job's `ubuntu-latest` runner gives Node a V8 heap of about 4 GiB,
and a step whose live data nears that fails there with `JavaScript heap out
of memory` while passing locally. `CI_HEAP_LIMIT_MIB` is the runner's
old-space limit, V8's 4,096 MiB default there (a Node 24 out-of-memory log
reports 4,104.1 MiB committed, as "MB"); `CI_HEAP_HEADROOM` (0.85) is the
share a step may use, so a step that grows between builds still fits on the
runner. Figures are MiB, the unit V8's own log uses.

## Completing is the measurement

The cap is the check: a capped step that completes fits the budget, and one
that runs out of heap fails with V8's `JavaScript heap out of memory`, which
the runner reports as the step failing under the cap. Nothing it would have
emitted lands. No figure is sampled. V8 records live heap only at full
collections, which are sparse under a roomy heap, so a sample misses the
peak between them (it read 815–894 MiB for a pull replay that needs
1,313 MiB), while the heap in use at any other moment counts garbage.

**The runtime is part of the measurement.** The same `build:catalog` holds
about 45% more live heap under Node 24 than under Node 26 (measured
2026-10-30: 4,042 MiB against 2,782 MiB), so a pass under one major says
nothing about another. `.nvmrc` is the one place the Node version is named:
every workflow's `setup-node` reads it (`node-version-file`), and the runner
fails a capped step without running it under a different major. Run heavy
steps locally under the pinned Node.

When a step is legitimately bigger, shrink what it holds first — the
placement lineage keeps lines, not objects
([Storage and cost](../../catalog/lineage/README.md#storage-and-cost)). Raising
the runner's heap (`--max-old-space-size` in CI) is the owner's call, and
moves `CI_HEAP_LIMIT_MIB` with it.

## Measured need

How close a step runs to the budget is read by bisecting the smallest
`--max-old-space-size` it completes in, as
[How big a table may be](../../refresh/pull/README.md#how-big-a-table-may-be)
did.

### build:catalog

`build:catalog` completes at `--max-old-space-size=2925` and runs out of
heap at 2,900 (Node 26.7, 2026-11-15, the step run with `--any-baseline` so
all three record-walk lineage diffs ran, each against a baseline from the same
inputs). That is 16% under the 3,481 MiB budget (0.85 × 4,096). The peak
is placement lineage's sort and diff inside `walkManifest`, while the
reference tables are still held; `preAllocationStages` releases them before SID allocation,
whose working set otherwise pushed the step past the budget. A diff against
a baseline that differs by many keys holds its changed lines briefly on top
([Run-to-run diff](../../catalog/lineage/README.md#run-to-run-diff)), which
this figure does not include.

The runner refuses `--any-baseline`, so the step runs under `node` directly,
handed the input map a prior `pnpm run build:catalog` stamped; bisect `<N>`:

```bash
node -e "process.stdout.write(JSON.stringify(require('./build/stamps/build-catalog.json').inputs))" > build/catalog-inputs.json
PIPELINE_STEP_INPUTS=build/catalog-inputs.json PIPELINE_STEP=build:catalog \
  node --max-old-space-size=<N> --import tsx scripts/util/launch.ts scripts/catalog/build-catalog.ts --any-baseline
```
