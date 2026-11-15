import { describe, expect, it } from 'vitest';
import { wdsPair } from '../wds/wds-fixture';
import { DROPPED_PAIR_AUDIT_SAMPLE, droppedPairSample, pairLabel } from './build-log-pure';

const dropped = (wdsId: string) => ({ pair: wdsPair({ wdsId }) });

describe('pairLabel', () => {
  it('joins the WDS id and the components field', () => {
    expect(pairLabel(dropped('00057+4549'))).toBe('00057+4549AB');
  });
});

describe('droppedPairSample', () => {
  it('prints nothing when nothing dropped', () => {
    expect(droppedPairSample('gate', [])).toEqual([]);
  });

  it('lists every pair up to the cap, then marks the rest elided', () => {
    expect(droppedPairSample('gate', [dropped('a'), dropped('b')])).toEqual(['gate: 2 pairs (sample: aAB, bAB)']);
    const many = Array.from({ length: DROPPED_PAIR_AUDIT_SAMPLE + 1 }, (_, i) => dropped(`p${i}`));
    const [line] = droppedPairSample('gate', many);
    expect(line.startsWith(`gate: ${many.length} pairs (sample: p0AB, `)).toBe(true);
    expect(line.endsWith(`p${DROPPED_PAIR_AUDIT_SAMPLE - 1}AB, …)`)).toBe(true);
  });
});
