import { describe, expect, it } from 'vitest';
import { mergeSortedByDistance, sortIndicesByDistance } from './star-frame-pure';
import { sortedDistRange } from '../../camera/controls/star-geometry';

/** The three arrays as `StarFrame` allocates them, with `count` records of
 *  which the first `loaded` have distances. */
function index(dists: number[], count: number) {
  const dist = new Float32Array(count).fill(Infinity);
  for (let i = 0; i < dists.length; i++) dist[i] = dists[i];
  return {
    dist,
    idx: new Uint32Array(count),
    key: new Float32Array(count).fill(Infinity),
  };
}

describe('mergeSortedByDistance', () => {
  it('orders one whole-catalogue window', () => {
    const { dist, idx, key } = index([9, 1, 5], 3);
    mergeSortedByDistance(dist, idx, key, 0, 3);
    expect(Array.from(idx)).toEqual([1, 2, 0]);
    expect(Array.from(key)).toEqual([1, 5, 9]);
  });

  it('merges a later window into an ordered prefix', () => {
    const { dist, idx, key } = index([9, 1, 5, 7, 0, 3], 6);
    mergeSortedByDistance(dist, idx, key, 0, 3);
    mergeSortedByDistance(dist, idx, key, 3, 6);
    expect(Array.from(idx)).toEqual([4, 1, 5, 2, 3, 0]);
    expect(Array.from(key)).toEqual([0, 1, 3, 5, 7, 9]);
  });

  it('matches a full re-sort across an arbitrary chunk ramp', () => {
    const n = 500;
    const dists = Array.from({ length: n }, (_, i) => ((i * 7919) % 1000) / 3);
    const { dist, idx, key } = index(dists, n);
    for (const [first, end] of [[0, 11], [11, 33], [33, 97], [97, 260], [260, n]]) {
      mergeSortedByDistance(dist, idx, key, first, end);
    }
    const expected = dists
      .map((d, i) => [d, i] as const)
      .sort((a, b) => a[0] - b[0]);
    expect(Array.from(key)).toEqual(expected.map(([d]) => Math.fround(d)));
    expect(Array.from(idx).map((i) => dist[i])).toEqual(expected.map(([d]) => Math.fround(d)));
  });

  it('leaves Infinity past the decoded prefix, so the window search stops there', () => {
    // ./README.md § Absorbing a chunk, the distSol/sortedDistFromSol pair.
    const count = 1000;
    const loaded = 40;
    const { dist, idx, key } = index(
      Array.from({ length: loaded }, (_, i) => i + 1), count,
    );
    mergeSortedByDistance(dist, idx, key, 0, loaded);

    expect(key[loaded]).toBe(Infinity);
    expect(key[count - 1]).toBe(Infinity);
    // The Picker's own band, and a far-from-Sol core-mask bracket.
    expect(sortedDistRange(key, 0, 50_000)).toEqual({ start: 0, end: loaded });
    expect(sortedDistRange(key, 995, 1005)).toEqual({ start: loaded, end: loaded });
  });

  it('rewrites the key only from the lowest slot the merge moved', () => {
    const { dist, idx, key } = index([1, 2, 3, 9, 8], 5);
    mergeSortedByDistance(dist, idx, key, 0, 3);
    key[0] = -1;
    mergeSortedByDistance(dist, idx, key, 3, 5);
    expect(Array.from(key)).toEqual([-1, 2, 3, 8, 9]);
  });

  it('is a no-op on an empty window', () => {
    const { dist, idx, key } = index([2, 4], 2);
    mergeSortedByDistance(dist, idx, key, 0, 2);
    const before = Array.from(idx);
    mergeSortedByDistance(dist, idx, key, 2, 2);
    expect(Array.from(idx)).toEqual(before);
  });
});

describe('sortIndicesByDistance', () => {
  it('orders a window exactly as a stable comparator sort, ties and Infinity included', () => {
    const n = 5000;
    const offset = 7;
    const dist = new Float32Array(n + offset).fill(-1);
    for (let i = 0; i < n; i++) {
      dist[i + offset] = i % 97 === 0
        ? Infinity
        : ((i * 7919) % 613) * 1.37e-3 + (i % 5 === 0 ? 0 : 1e4);
    }
    const expected = Array.from({ length: n }, (_, i) => i + offset)
      .sort((a, b) => dist[a] - dist[b] || a - b);
    expect(Array.from(sortIndicesByDistance(dist, offset, n + offset))).toEqual(expected);
  });

  it('breaks ties by record index', () => {
    const dist = new Float32Array([4, 2, 4, 2, 0]);
    expect(Array.from(sortIndicesByDistance(dist, 0, 5))).toEqual([4, 1, 3, 0, 2]);
  });
});
