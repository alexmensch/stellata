import { describe, expect, it } from 'vitest';

import { cutEdges, sliceConditions, sliceCounts } from './slices-pure';

describe('sliceConditions', () => {
  it('partitions the key into half-open ranges, open at both ends', () => {
    expect(sliceConditions('source_id', [10n, 20n])).toEqual([
      'source_id < 10',
      'source_id >= 10 AND source_id < 20',
      'source_id >= 20',
    ]);
  });

  it('writes an edge past 2^53 exactly', () => {
    expect(sliceConditions('source_id', [6360853029303982592n])).toEqual([
      'source_id < 6360853029303982592',
      'source_id >= 6360853029303982592',
    ]);
  });

  it('refuses edges that do not strictly increase', () => {
    expect(() => sliceConditions('k', [5n, 5n])).toThrow(/strictly increase: 5 then 5/);
  });

  it('writes a decimal key\'s edges as their shortest text', () => {
    expect(sliceConditions('g.phot_g_mean_mag', [6.5, 10.999999])).toEqual([
      'g.phot_g_mean_mag < 6.5',
      'g.phot_g_mean_mag >= 6.5 AND g.phot_g_mean_mag < 10.999999',
      'g.phot_g_mean_mag >= 10.999999',
    ]);
  });

  it('refuses a decimal edge that is not finite', () => {
    expect(() => sliceConditions('k', [1, Number.NaN])).toThrow(/must be finite: NaN/);
  });
});

describe('sliceCounts', () => {
  it('counts each key into the slice its conditions put it in, an edge into the slice above', () => {
    expect(sliceCounts([1n, 10n, 15n, 19n, 20n, 99n], [10n, 20n])).toEqual([1, 3, 2]);
  });
});

describe('cutEdges', () => {
  it('cuts ascending keys into slices of at most sliceRows', () => {
    const keys = [1n, 2n, 3n, 4n, 5n, 6n, 7n];
    const edges = cutEdges(keys, 3);
    expect(edges).toEqual([4n, 7n]);
    expect(sliceCounts(keys, edges)).toEqual([3, 3, 1]);
  });

  it('never splits equal keys across an edge', () => {
    const keys = [1n, 2n, 3n, 3n, 4n, 5n];
    const edges = cutEdges(keys, 3);
    expect(edges).toEqual([3n, 5n]);
    expect(sliceCounts(keys, edges)).toEqual([2, 3, 1]);
  });

  it('needs no edge for a table that fits one slice', () => {
    expect(cutEdges([1n, 2n], 3)).toEqual([]);
  });

  it('cuts a decimal key the same way', () => {
    const keys = [1.5, 2.25, 2.25, 3.125, 4];
    const edges = cutEdges(keys, 2);
    expect(edges).toEqual([2.25, 3.125]);
    expect(sliceCounts(keys, edges)).toEqual([1, 2, 2]);
  });

  it('refuses a key shared by more rows than a slice holds', () => {
    expect(() => cutEdges([1n, 1n, 1n, 1n, 2n], 3)).toThrow(/share the key 1/);
  });
});
