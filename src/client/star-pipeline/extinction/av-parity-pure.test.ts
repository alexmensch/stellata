import { describe, expect, it } from 'vitest';
import { compareAvBuffers, formatAvParity } from './av-parity-pure';

describe('compareAvBuffers', () => {
  it('reports bit-identical arrays as such', () => {
    const a = new Float32Array([0, 0.5, 1.25, NaN]);
    const r = compareAvBuffers(a, Float32Array.from(a), 4);
    expect(r).toEqual({ compared: 4, mismatched: 0, maxAbsDiff: 0, first: null });
    expect(formatAvParity(r)).toBe('A_V parity: 4 stars, bit-identical');
  });

  it('counts every differing star, keeps the first, and the largest gap', () => {
    const computed = new Float32Array([1, 2, 3, 4]);
    const reference = new Float32Array([1, 2.5, 3, 6]);
    const r = compareAvBuffers(computed, reference, 4);
    expect(r.mismatched).toBe(2);
    expect(r.maxAbsDiff).toBe(2);
    expect(r.first).toEqual({ idx: 1, computed: 2, reference: 2.5 });
    expect(formatAvParity(r)).toBe(
      'A_V parity: 2 of 4 stars differ, max |Δ| 2 (first: star 1 compute 2 vs reference 2.5)');
  });

  it('reads star i from texel i of a multi-component reference', () => {
    const computed = new Float32Array([7, 8]);
    const reference = new Float32Array([7, 0, 0, 1, 8, 0, 0, 1]);
    expect(compareAvBuffers(computed, reference, 2, 4).mismatched).toBe(0);
  });

  it('compares bits, so -0 against +0 is a mismatch of zero magnitude', () => {
    const r = compareAvBuffers(new Float32Array([-0]), new Float32Array([0]), 1);
    expect(r.mismatched).toBe(1);
    expect(r.maxAbsDiff).toBe(0);
  });

  it('compares only the first `count` stars of a padded reference', () => {
    const r = compareAvBuffers(new Float32Array([1, 2]), new Float32Array([1, 2, 99]), 2);
    expect(r.mismatched).toBe(0);
  });
});
