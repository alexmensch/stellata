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

  it('passes at the budget and fails above it, naming the step', () => {
    expect(heapBudgetCheck('build:demo', budget).kind).toBe('pass');
    const over = heapBudgetCheck('build:demo', budget + 1);
    expect(over.kind).toBe('fail');
    expect(over.kind === 'fail' && over.message).toMatch(/^build:demo peak live heap: .* CI would run out of heap/);
  });
});
