import { describe, it, expect } from 'vitest';
import { planStack } from './poi-card-stack-pure';

describe('poi/planStack', () => {
  it('displays the newest pin on top', () => {
    const plan = planStack([], [3, 7, 11]);
    expect(plan.order).toEqual([11, 7, 3]);
  });

  it('plans creation only for new pins', () => {
    const plan = planStack([3, 7], [3, 7, 11]);
    expect(plan.added).toEqual([11]);
    expect(plan.removed).toEqual([]);
  });

  it('plans removal for unpinned entries', () => {
    const plan = planStack([3, 7, 11], [3, 11]);
    expect(plan.added).toEqual([]);
    expect(plan.removed).toEqual([7]);
    expect(plan.order).toEqual([11, 3]);
  });

  it('handles a full replacement (URL-state restore)', () => {
    const plan = planStack([3, 7], [8, 5, 7]);
    expect(plan.added).toEqual([8, 5]);
    expect(plan.removed).toEqual([3]);
    expect(plan.order).toEqual([7, 5, 8]);
  });

  it('is a no-op plan when nothing changed', () => {
    const plan = planStack([3, 7], [3, 7]);
    expect(plan.added).toEqual([]);
    expect(plan.removed).toEqual([]);
    expect(plan.order).toEqual([7, 3]);
  });
});
