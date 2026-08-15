import { describe, it, expect } from 'vitest';
import { wrapAngle, wrapDegrees } from './angles';

describe('wrapAngle', () => {
  it('reduces angles to (-π, π]', () => {
    expect(wrapAngle(0)).toBeCloseTo(0, 15);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 15);
    expect(wrapAngle(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 12);
    expect(wrapAngle(-Math.PI - 0.1)).toBeCloseTo(Math.PI - 0.1, 12);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(Math.PI, 12);
  });
});

describe('wrapDegrees', () => {
  it('reduces angles to (-180, 180]', () => {
    expect(wrapDegrees(0)).toBe(0);
    expect(wrapDegrees(180)).toBe(180);
    expect(wrapDegrees(-180)).toBe(180);
    expect(wrapDegrees(180.5)).toBeCloseTo(-179.5, 12);
    expect(wrapDegrees(-180.5)).toBeCloseTo(179.5, 12);
    expect(wrapDegrees(359)).toBeCloseTo(-1, 12);
    expect(wrapDegrees(361)).toBeCloseTo(1, 12);
  });

  it('handles the many-turn residuals a deep-time epoch produces', () => {
    // Earth's spin accumulates ~6.6e8 degrees at the clock's bounds, so a
    // while-loop wrap would iterate millions of times to reduce it.
    for (const turns of [1e3, 1e6, -1e6]) {
      expect(wrapDegrees(37 + 360 * turns)).toBeCloseTo(37, 6);
    }
  });

  it('agrees with wrapAngle', () => {
    for (const d of [-540, -200, -37, 0, 37, 200, 540, 1234]) {
      expect(wrapDegrees(d) * (Math.PI / 180))
        .toBeCloseTo(wrapAngle(d * (Math.PI / 180)), 12);
    }
  });
});
