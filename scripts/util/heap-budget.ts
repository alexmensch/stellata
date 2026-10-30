// Watches a build step's heap from the call on; `check()` stops and judges it. See README.md#ci-heap-budget.

import { GCProfiler, getHeapStatistics } from 'node:v8';

import type { Check } from './emit-artifacts';
import { heapBudgetCheck, peakLiveHeap } from './heap-budget-pure';

export function watchHeap(step: string): { check(): Check } {
  const profiler = new GCProfiler();
  profiler.start();
  return {
    check() {
      const usedNow = getHeapStatistics().used_heap_size;
      const samples = profiler.stop()?.statistics ?? [];
      return heapBudgetCheck(step, peakLiveHeap(samples, usedNow));
    },
  };
}
