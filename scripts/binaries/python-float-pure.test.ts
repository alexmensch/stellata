import { describe, expect, it } from 'vitest';

import { pyMod } from './python-float-pure';

describe('pyMod', () => {
  it('takes the divisor\'s sign, as Python\'s % does', () => {
    expect(pyMod(-30, 360)).toBe(330);
    expect(pyMod(370, 360)).toBe(10);
    expect(pyMod(-720, 360)).toBe(0);
  });

  it('rounds a tiny negative up to the divisor, as Python does', () => {
    expect(pyMod(-1e-20, 360)).toBe(360);
  });
});
