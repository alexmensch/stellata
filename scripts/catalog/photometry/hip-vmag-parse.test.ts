import { describe, it, expect } from 'vitest';

import { parseHipVmagTsv } from './hip-vmag-parse';

describe('hip-vmag-parse / parseHipVmagTsv', () => {
  const HIP_VMAG = [
    'hip\tvmag',
    '32349\t-1.440',
    '71681\t1.330',
    '99999\t',
    '0\t4.000',
  ].join('\n');

  it('maps HIP to printed V, dropping null-V and non-positive HIP rows', () => {
    const m = parseHipVmagTsv(HIP_VMAG);
    expect(m.get(32349)).toBe(-1.44);
    expect(m.get(71681)).toBe(1.33);
    expect(m.has(99999)).toBe(false);
    expect(m.has(0)).toBe(false);
    expect(m.size).toBe(2);
  });

  it('throws on an empty file rather than yielding an empty gate', () => {
    // An empty map would silently disable the binding gate, which is the
    // failure this parser exists to make loud.
    expect(() => parseHipVmagTsv('')).toThrow(/missing required columns/);
  });
});
