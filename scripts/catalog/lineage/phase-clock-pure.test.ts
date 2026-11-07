import { describe, expect, it } from 'vitest';

import { phaseClock } from './phase-clock-pure';

function steppingClock(steps: readonly number[]): () => number {
  let i = 0;
  return () => steps[i++];
}

describe('phaseClock', () => {
  it('charges each lap to its phase, adds a repeated phase, and keeps first-lap order', () => {
    const clock = phaseClock(steppingClock([0, 1, 4, 4, 14.4, 20, 22.6, 30]));
    expect(clock.lap('sort', () => 'sorted')).toBe('sorted');
    clock.lap('diff', () => undefined);
    clock.lap('sort', () => undefined);
    expect(clock.report()).toBe('sort 6, diff 10');
    expect(clock.totalMs()).toBe(30);
  });

  it('charges a lap that throws', () => {
    const clock = phaseClock(steppingClock([0, 2, 7]));
    expect(() => clock.lap('diff', () => { throw new Error('unordered'); })).toThrow('unordered');
    expect(clock.report()).toBe('diff 5');
  });
});
