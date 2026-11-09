import { describe, expect, it } from 'vitest';

import { formatExponent, formatFixed, roundEach, roundHalfEven } from './round-pure';

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

describe('formatExponent', () => {
  it('writes what Python f"{x:.Ne}" writes', () => {
    const xs = [1.275713e-14, 0, -0, 1.5, -2.5, 1e-5, 123456789, 9.9999995e-3, 1e100, 5e-324];
    expect(xs.map((x) => formatExponent(x, 6))).toEqual([
      '1.275713e-14', '0.000000e+00', '-0.000000e+00', '1.500000e+00', '-2.500000e+00', '1.000000e-05',
      '1.234568e+08', '1.000000e-02', '1.000000e+100', '4.940656e-324',
    ]);
  });

  it('rounds an exact tie to even and a near-tie by the exact value', () => {
    expect([1.5, 2.5, 3.5, -0.5].map((x) => formatExponent(x, 0))).toEqual(['2e+00', '2e+00', '4e+00', '-5e-01']);
    expect([1.125, 1.135, 9.995, 0.0001125].map((x) => formatExponent(x, 2))).toEqual(['1.12e+00', '1.14e+00', '9.99e+00', '1.12e-04']);
  });
});

describe('roundEach', () => {
  it('rounds every element half to even and keeps the tuple', () => {
    const rounded: [number, number, number] = roundEach([0.125, 2.675, -0.125] as const, 2);
    expect(rounded).toEqual([0.12, 2.67, -0.12]);
  });
});
