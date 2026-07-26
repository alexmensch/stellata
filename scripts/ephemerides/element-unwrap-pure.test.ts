import { describe, it, expect } from 'vitest';

import { unwrapMeanLongitude } from './element-unwrap-pure';

/** Mercury's mean motion, deg/day — the case the mean-motion hint exists for:
 *  at the shipped 50-day cadence one step covers 4.09·50 = 205°, more than
 *  half an orbit. */
const MERCURY_N = 4.09233;

describe('unwrapMeanLongitude', () => {
  it('keeps the first sample as given', () => {
    expect(unwrapMeanLongitude([12.5], [MERCURY_N], 50)).toEqual([12.5]);
  });

  it('accumulates a step that stays inside one revolution', () => {
    const out = unwrapMeanLongitude([350, 10], [1, 1], 20);
    expect(out[1]).toBeCloseTo(370, 9);
  });

  it('recovers a step longer than half a revolution from the mean motion', () => {
    // λ advances 204.6° over the interval, which Horizons reports as a
    // −155.4° change in [0, 360). A shortest-arc unwrap takes the −155.4°
    // and runs the planet backwards.
    const advance = MERCURY_N * 50;
    const wrapped = [10, (10 + advance) % 360];
    const out = unwrapMeanLongitude(wrapped, [MERCURY_N, MERCURY_N], 50);
    expect(out[1] - out[0]).toBeCloseTo(advance, 6);
  });

  it('stays monotone across many revolutions', () => {
    const n = 40;
    const wrapped: number[] = [];
    for (let i = 0; i < n; i++) wrapped.push((MERCURY_N * 50 * i) % 360);
    const out = unwrapMeanLongitude(wrapped, Array(n).fill(MERCURY_N), 50);
    for (let i = 1; i < n; i++) expect(out[i]).toBeGreaterThan(out[i - 1]);
    expect(out[n - 1]).toBeCloseTo(MERCURY_N * 50 * (n - 1), 6);
  });

  it('rejects a mean motion that disagrees with the samples by a revolution', () => {
    expect(() => unwrapMeanLongitude([10, 260], [0.4, 0.4], 50)).toThrow(/steps back/);
  });

  it('rejects mismatched column lengths', () => {
    expect(() => unwrapMeanLongitude([1, 2], [1], 50)).toThrow(/against/);
  });
});
