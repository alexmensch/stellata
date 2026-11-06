import { describe, it, expect } from 'vitest';

import { FLAG_IS_SOL } from '../../../src/catalog-format/record/catalog-pure';
import { solRecordIndex } from './record-order-pure';

describe('solRecordIndex', () => {
  it('finds the one record flagged Sol, and throws on none or several', () => {
    const flags = (...f: number[]) => f.map((x) => ({ flags: x }));
    expect(solRecordIndex(flags(0, FLAG_IS_SOL, 0))).toBe(1);
    expect(() => solRecordIndex(flags(0, 0))).toThrow('found 0');
    expect(() => solRecordIndex(flags(FLAG_IS_SOL, FLAG_IS_SOL))).toThrow('found 2');
  });
});
