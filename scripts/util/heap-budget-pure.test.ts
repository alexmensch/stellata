import { describe, expect, it } from 'vitest';

import { CI_HEAP_HEADROOM, CI_HEAP_LIMIT_BYTES, heapBudgetCheck, peakLiveHeap } from './heap-budget-pure';

const gc = (gcType: string, usedHeapSize: number) => ({ gcType, afterGC: { heapStatistics: { usedHeapSize } } });

describe('peakLiveHeap', () => {
  it('reads full collections only, and the heap in use now', () => {
    expect(peakLiveHeap([gc('MarkSweepCompact', 300), gc('Scavenge', 900), gc('MarkSweepCompact', 200)], 100))
      .toBe(300);
    expect(peakLiveHeap([gc('Scavenge', 900)], 100)).toBe(100);
  });
});

describe('heapBudgetCheck', () => {
  const budget = CI_HEAP_LIMIT_BYTES * CI_HEAP_HEADROOM;
  const SAME = { running: 26, pinned: 26 };

  it('refuses to judge a heap measured under another Node major than CI pins', () => {
    const other = heapBudgetCheck('build:demo', 0, { running: 24, pinned: 26 });
    expect(other.kind === 'fail' && other.message).toMatch(/^build:demo ran under Node 24, but CI runs Node 26/);
  });

  it('passes at the budget and fails above it, naming the step', () => {
    expect(heapBudgetCheck('build:demo', budget, SAME).kind).toBe('pass');
    const over = heapBudgetCheck('build:demo', budget + 1, SAME);
    expect(over.kind).toBe('fail');
    expect(over.kind === 'fail' && over.message).toBe(
      'build:demo peak live heap: 3482 MiB, budget 3482 MiB (0.85 of the CI runner\'s 4096 MiB): '
      + 'CI would run out of heap. See /scripts/util/README.md#ci-heap-budget.',
    );
  });
});
