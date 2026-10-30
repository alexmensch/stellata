// Watches a build step's heap from the call on; `check()` stops and judges it. See README.md#ci-heap-budget.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GCProfiler, getHeapStatistics } from 'node:v8';

import type { Check } from './emit-artifacts';
import { heapBudgetCheck, peakLiveHeap } from './heap-budget-pure';
import { REPO_ROOT } from './paths';

function nodeMajor(version: string, source: string): number {
  const major = Number(/^v?(\d+)/.exec(version.trim())?.[1]);
  if (!Number.isInteger(major)) throw new Error(`${source}: "${version.trim()}" names no Node major`);
  return major;
}

export function watchHeap(step: string): { check(): Check } {
  const profiler = new GCProfiler();
  profiler.start();
  return {
    check() {
      const usedNow = getHeapStatistics().used_heap_size;
      const profile = profiler.stop();
      if (profile === undefined) throw new Error(`${step}: the heap profiler recorded nothing to judge`);
      return heapBudgetCheck(step, peakLiveHeap(profile.statistics, usedNow), {
        running: nodeMajor(process.version, 'process.version'),
        pinned: nodeMajor(readFileSync(resolve(REPO_ROOT, '.nvmrc'), 'utf8'), '.nvmrc'),
      });
    },
  };
}
