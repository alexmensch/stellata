import { describe, expect, it } from 'vitest';

import { pyMod, pySum } from './python-float-pure';

describe('pyMod', () => {
  it('takes the divisor\'s sign, as Python\'s % does', () => {
    expect(pyMod(-30, 360)).toBe(330);
    expect(pyMod(370, 360)).toBe(10);
    expect(pyMod(-720, 360)).toBe(0);
  });

  it('returns +0 for a zero remainder, −0 included, as Python does', () => {
    expect(pyMod(-0, 2 * Math.PI)).toBe(0);
    expect(pyMod(-4 * Math.PI, 2 * Math.PI)).toBe(0);
  });

  it('rounds a tiny negative up to the divisor, as Python does', () => {
    expect(pyMod(-1e-20, 360)).toBe(360);
  });
});

describe('pySum', () => {
  it('compensates as Python 3.12+ does, where a left fold loses the small terms', () => {
    const values = [1e16, 1.0, -1e16];
    expect(values.reduce((a, b) => a + b, 0)).toBe(0);
    expect(pySum(values)).toBe(1);
  });

  it('is 0 for nothing', () => {
    expect(pySum([])).toBe(0);
  });
});
