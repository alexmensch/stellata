import { describe, it, expect } from 'vitest';
import {
  AVG_AMBER_MS,
  MS_PER_FRAME_60,
  colourForAvg,
  fmtMs,
  insertSorted,
  summarize,
  type RingStats,
  type RowDatum,
} from './perf-hud-pure';

function makeRing(values: number[], size: number, idx: number, count: number): RingStats {
  const ring = new Float32Array(size);
  for (let i = 0; i < values.length; i++) ring[i] = values[i];
  return { ring, idx, count };
}

describe('perf-hud-pure / summarize', () => {
  it('returns {0, 0} for empty count', () => {
    expect(summarize(makeRing([], 60, 0, 0))).toEqual({ avg: 0, max: 0 });
  });

  it('averages over count, not ring length', () => {
    // count<RING_SIZE must average over count not RING_SIZE — a regression
    // here would silently halve early-frame averages.
    const s = makeRing([10, 20, 30], 60, 3, 3);
    expect(summarize(s)).toEqual({ avg: 20, max: 30 });
  });

  it('handles single sample', () => {
    expect(summarize(makeRing([5], 60, 1, 1))).toEqual({ avg: 5, max: 5 });
  });

  it('reads first `count` slots irrespective of idx position', () => {
    // The ring buffer's write order is idx-modulated but summarize reads
    // slots [0, count). After full wraparound (count = ring length),
    // every slot has been written, so reading from 0 is correct.
    const ring = new Float32Array(4);
    ring[0] = 2; ring[1] = 4; ring[2] = 6; ring[3] = 8;
    expect(summarize({ ring, idx: 0, count: 4 })).toEqual({ avg: 5, max: 8 });
  });
});

describe('perf-hud-pure / fmtMs', () => {
  it('formats <10 with 2 decimals, >=10 with 1', () => {
    expect(fmtMs(9.99)).toBe('9.99');
    expect(fmtMs(10.0)).toBe('10.0');
    expect(fmtMs(16.71)).toBe('16.7');
  });

  it('zero passes through', () => {
    expect(fmtMs(0)).toBe('0.00');
  });
});

describe('perf-hud-pure / colourForAvg', () => {
  it('cool below amber threshold', () => {
    expect(colourForAvg(0)).toBe('#cfe');
    expect(colourForAvg(AVG_AMBER_MS)).toBe('#cfe'); // strictly > threshold
    expect(colourForAvg(AVG_AMBER_MS - 0.001)).toBe('#cfe');
  });

  it('amber between AVG_AMBER_MS and 60Hz budget', () => {
    expect(colourForAvg(AVG_AMBER_MS + 0.001)).toBe('#fc8');
    expect(colourForAvg(MS_PER_FRAME_60)).toBe('#fc8'); // exactly at budget still amber
  });

  it('red past the 60Hz budget', () => {
    expect(colourForAvg(MS_PER_FRAME_60 + 0.001)).toBe('#f88');
    expect(colourForAvg(20)).toBe('#f88');
  });
});

describe('perf-hud-pure / insertSorted', () => {
  const CAP = 3;
  const row = (label: string, avg: number): RowDatum => ({ label, avg, max: avg });

  it('inserts in descending order by avg', () => {
    const arr: RowDatum[] = [];
    insertSorted(arr, row('a', 5), CAP);
    insertSorted(arr, row('b', 9), CAP);
    insertSorted(arr, row('c', 1), CAP);
    expect(arr.map((r) => r.avg)).toEqual([9, 5, 1]);
  });

  it('drops the smallest entry on insert past cap', () => {
    const arr: RowDatum[] = [];
    for (const v of [1, 2, 3, 4, 5]) insertSorted(arr, row('x', v), CAP);
    expect(arr.length).toBe(CAP);
    expect(arr.map((r) => r.avg)).toEqual([5, 4, 3]);
  });

  it('no-op when at cap and incoming is smaller than smallest', () => {
    const arr: RowDatum[] = [row('a', 9), row('b', 5), row('c', 3)];
    insertSorted(arr, row('d', 1), CAP);
    expect(arr.length).toBe(CAP);
    expect(arr.map((r) => r.avg)).toEqual([9, 5, 3]);
  });

  it('tie inserts after existing tied row (preserves stable display order)', () => {
    const arr: RowDatum[] = [];
    insertSorted(arr, row('a', 5), CAP);
    insertSorted(arr, row('b', 5), CAP);
    expect(arr[0].label).toBe('a');
    expect(arr[1].label).toBe('b');
  });
});
