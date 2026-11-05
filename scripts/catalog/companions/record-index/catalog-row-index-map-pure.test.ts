import { describe, expect, it } from 'vitest';

import { resolveMultiplesIdx, synthSlotIdx, type CatalogRowIndexMap } from './catalog-row-index-map-pure';

const MAP: CatalogRowIndexMap = {
  byGaia: { 1: 100, 2: 200 },
  byHip: { 14576: 300 },
  bySynth: { 'synth-03082+4057-Ab': 400 },
};
const SYNTH = 'synth-03082+4057-Ab';

describe('resolveMultiplesIdx', () => {
  it('walks gaia, then hip, then synth', () => {
    expect(resolveMultiplesIdx('1', 999, SYNTH, MAP)).toBe(100);
    expect(resolveMultiplesIdx(null, 14576, SYNTH, MAP)).toBe(300);
    expect(resolveMultiplesIdx('999', null, SYNTH, MAP)).toBe(400);
  });

  it('is null when no section holds a key', () => {
    expect(resolveMultiplesIdx(null, null, 'synth-99999+9999-Z', MAP)).toBeNull();
    expect(resolveMultiplesIdx(null, null, null, MAP)).toBeNull();
  });
});

describe('synthSlotIdx', () => {
  it('is the synth record unless it is the excluded one', () => {
    expect(synthSlotIdx(SYNTH, MAP)).toBe(400);
    expect(synthSlotIdx(SYNTH, MAP, 400)).toBeNull();
    expect(synthSlotIdx(null, MAP)).toBeNull();
  });
});
