import { describe, expect, it } from 'vitest';
import { sortIndicesByKeyWords } from './radix-sort';

function comparatorSort(words: readonly Uint32Array[], first: number, end: number): number[] {
  return Array.from({ length: end - first }, (_, i) => first + i).sort((a, b) => {
    for (let w = words.length - 1; w >= 0; w--) {
      if (words[w][a] !== words[w][b]) return words[w][a] - words[w][b];
    }
    return a - b;
  });
}

describe('sortIndicesByKeyWords', () => {
  it('orders a window exactly as a stable comparator sort over two words', () => {
    const count = 6000;
    const lo = new Uint32Array(count);
    const hi = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
      lo[i] = (Math.imul(i, 2654435761) >>> 0) % (i % 3 === 0 ? 7 : 0x1_0000_0000);
      hi[i] = (i * 7919) % 41;
    }
    expect(Array.from(sortIndicesByKeyWords([lo, hi], 13, count)))
      .toEqual(comparatorSort([lo, hi], 13, count));
  });

  it('orders float32 bit patterns of non-negative values as the values, Infinity last', () => {
    const dist = new Float32Array(3000);
    for (let i = 0; i < dist.length; i++) {
      dist[i] = i % 97 === 0 ? Infinity : ((i * 7919) % 613) * 1.37e-3 + (i % 5 === 0 ? 0 : 1e4);
    }
    const sorted = sortIndicesByKeyWords(
      [new Uint32Array(dist.buffer)], 0, dist.length,
    );
    const expected = Array.from({ length: dist.length }, (_, i) => i)
      .sort((a, b) => dist[a] - dist[b] || a - b);
    expect(Array.from(sorted)).toEqual(expected);
  });

  it('breaks ties by record index', () => {
    const key = Uint32Array.from([4, 2, 4, 2, 0]);
    expect(Array.from(sortIndicesByKeyWords([key], 0, 5))).toEqual([4, 1, 3, 0, 2]);
  });

  it('keeps index order when every key shares a digit, and when all keys are equal', () => {
    const key = Uint32Array.from([0x0500_0003, 0x0500_0001, 0x0500_0002]);
    expect(Array.from(sortIndicesByKeyWords([key], 0, 3))).toEqual([1, 2, 0]);
    expect(Array.from(sortIndicesByKeyWords([new Uint32Array(4)], 0, 4))).toEqual([0, 1, 2, 3]);
  });

  it('returns an empty order for an empty window', () => {
    expect(sortIndicesByKeyWords([new Uint32Array(3)], 3, 3)).toHaveLength(0);
  });
});
