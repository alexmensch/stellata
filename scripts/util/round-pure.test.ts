import { describe, expect, it } from 'vitest';

import { roundEach, roundHalfEven } from './round-pure';

describe('roundHalfEven', () => {
  it('rounds an exact binary tie to even, as Python round() does', () => {
    expect(roundHalfEven(0.125, 2)).toBe(0.12);
    expect(roundHalfEven(0.375, 2)).toBe(0.38);
    expect(roundHalfEven(-0.125, 2)).toBe(-0.12);
    expect(roundHalfEven(2.5, 0)).toBe(2);
  });

  it('rounds a near-tie by the exact value of the double', () => {
    expect(roundHalfEven(2.675, 2)).toBe(2.67);
    expect(roundHalfEven(1.005, 2)).toBe(1);
    expect(roundHalfEven(240.9626700838767, 2)).toBe(240.96);
  });
});

describe('roundEach', () => {
  it('rounds every element half to even and keeps the tuple', () => {
    const rounded: [number, number, number] = roundEach([0.125, 2.675, -0.125] as const, 2);
    expect(rounded).toEqual([0.12, 2.67, -0.12]);
  });
});
