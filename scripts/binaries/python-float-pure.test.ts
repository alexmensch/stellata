import { describe, expect, it } from 'vitest';

import { pySum } from './python-float-pure';

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
