import { describe, it, expect } from 'vitest';

import { FLAG_IS_SOL } from '../../../src/catalog-format/record/catalog-pure';
import { assertSolFirst } from './record-order-pure';

describe('assertSolFirst', () => {
  it('passes only when the one record flagged Sol is record 0', () => {
    const flags = (...f: number[]) => f.map((x) => ({ flags: x }));
    expect(() => assertSolFirst(flags(FLAG_IS_SOL, 0))).not.toThrow();
    expect(() => assertSolFirst(flags(0, FLAG_IS_SOL, 0))).toThrow('it sorted to record 1');
    expect(() => assertSolFirst(flags(0, 0))).toThrow('found 0');
    expect(() => assertSolFirst(flags(FLAG_IS_SOL, FLAG_IS_SOL))).toThrow('found 2');
  });
});
