import { describe, expect, it } from 'vitest';
import { DROPPED_PAIR_AUDIT_SAMPLE, droppedPairSample } from './build-log-pure';

describe('droppedPairSample', () => {
  it('prints nothing when nothing dropped', () => {
    expect(droppedPairSample('gate', [])).toEqual([]);
  });

  it('lists every pair up to the cap, then marks the rest elided', () => {
    expect(droppedPairSample('gate', ['a', 'b'])).toEqual(['gate: 2 pairs (sample: a, b)']);
    const many = Array.from({ length: DROPPED_PAIR_AUDIT_SAMPLE + 1 }, (_, i) => `p${i}`);
    const [line] = droppedPairSample('gate', many);
    expect(line.startsWith(`gate: ${many.length} pairs (sample: p0, `)).toBe(true);
    expect(line.endsWith(`p${DROPPED_PAIR_AUDIT_SAMPLE - 1}, …)`)).toBe(true);
  });
});
