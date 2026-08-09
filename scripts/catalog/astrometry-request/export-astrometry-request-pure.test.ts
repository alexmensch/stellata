import { describe, it, expect } from 'vitest';
import { sortSourceIdsNumeric } from './export-astrometry-request-pure';

describe('export-astrometry-request-pure / sortSourceIdsNumeric', () => {
  it('orders numerically, not lexicographically, across the 2^53 boundary', () => {
    const ids = ['4472832130942575872', '594595272471808', '999', '1000'];
    expect(sortSourceIdsNumeric(ids)).toEqual([
      '999',
      '1000',
      '594595272471808',
      '4472832130942575872',
    ]);
  });

  it('accepts any iterable (Set) and preserves every element', () => {
    const set = new Set(['30', '2', '100']);
    expect(sortSourceIdsNumeric(set)).toEqual(['2', '30', '100']);
  });

  it('does not collide ids that a Number sort would round together', () => {
    const a = '9223372036854775801';
    const b = '9223372036854775807';
    expect(BigInt(a)).not.toBe(BigInt(b));
    expect(sortSourceIdsNumeric([b, a])).toEqual([a, b]);
  });

  it('returns [] for empty input', () => {
    expect(sortSourceIdsNumeric([])).toEqual([]);
  });
});
