// A build step's peak live heap against the CI runner's V8 heap limit, as an emitArtifacts check. See README.md#ci-heap-budget.

import type { Check } from './emit-artifacts';

export const CI_HEAP_LIMIT_BYTES = 4096 * 2 ** 20;

export const CI_HEAP_HEADROOM = 0.85;

export interface GcSample {
  readonly gcType: string;
  readonly afterGC: { readonly heapStatistics: { readonly usedHeapSize: number } };
}

const FULL_GC = 'MarkSweepCompact';

export function peakLiveHeap(samples: readonly GcSample[], usedNow: number): number {
  let peak = usedNow;
  for (const s of samples) {
    if (s.gcType === FULL_GC) peak = Math.max(peak, s.afterGC.heapStatistics.usedHeapSize);
  }
  return peak;
}

const mib = (bytes: number): string => `${(bytes / 2 ** 20).toFixed(0)} MiB`;

export function heapBudgetCheck(step: string, peak: number): Check {
  const budget = CI_HEAP_LIMIT_BYTES * CI_HEAP_HEADROOM;
  const measured = `${step} peak live heap: ${mib(peak)}, budget ${mib(budget)} (${CI_HEAP_HEADROOM} of the CI runner's ${mib(CI_HEAP_LIMIT_BYTES)})`;
  return peak > budget
    ? { kind: 'fail', message: `${measured}: CI would run out of heap. See /scripts/util/README.md#ci-heap-budget.` }
    : { kind: 'pass', report: measured };
}
