import { describe, expect, it } from 'vitest';

import { formatFixed, roundHalfEven } from './round-pure';

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

describe('formatFixed', () => {
  it('writes what Python f"{x:.Nf}" writes', () => {
    const python3 = ['0.062', '0.125', '2.675', '-0.000', '-0.000', '0.000', '-1.000', '123456.000'];
    expect([0.0625, 0.125, 2.675, -0.0001, -0, 1e-7, -1.0005, 123456.0005].map((x) => formatFixed(x, 3))).toEqual(python3);
    expect([0.125, 0.375, -0.125].map((x) => formatFixed(x, 2))).toEqual(['0.12', '0.38', '-0.12']);
  });
});
