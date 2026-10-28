import { describe, it, expect } from 'vitest';

import { parseHipPhotometryTsv, printedByHip } from './hip-photometry-parse';

const FROM = { file: 'fixture.tsv', hint: 'h' };

describe('hip-photometry-parse / parseHipPhotometryTsv', () => {
  const HIP_PHOTOMETRY = [
    'hip\tvmag\tbv\thd',
    '32349\t-1.440\t0.009\t48915',
    '71681\t1.330\t0.900\t',
    '99999\t\t1.100\t',
    '88888\t7.200\t\t',
    '0\t4.000\t0.500\t',
  ].join('\n');

  it('maps HIP to printed V, dropping null-V and non-positive HIP rows', () => {
    const { vmag } = parseHipPhotometryTsv(HIP_PHOTOMETRY, FROM);
    expect(vmag.get(32349)).toBe(-1.44);
    expect(vmag.get(71681)).toBe(1.33);
    expect(vmag.has(99999)).toBe(false);
    expect(vmag.has(0)).toBe(false);
    expect(vmag.size).toBe(3);
  });

  it('maps HIP to printed B−V independently of V', () => {
    const { bv } = parseHipPhotometryTsv(HIP_PHOTOMETRY, FROM);
    expect(bv.get(32349)).toBe(0.009);
    // A row with no V still contributes its colour, and vice versa — the
    // 1,281 null-B−V rows must not cost the V map an entry.
    expect(bv.get(99999)).toBe(1.1);
    expect(bv.has(88888)).toBe(false);
    expect(bv.has(0)).toBe(false);
    expect(bv.size).toBe(3);
  });

  it('reads a value for a record HIP, and null for both kinds of miss', () => {
    const { bv } = parseHipPhotometryTsv(HIP_PHOTOMETRY, FROM);
    expect(printedByHip(bv, 32349)).toBe(0.009);
    expect(printedByHip(bv, 88888)).toBeNull();
    expect(printedByHip(bv, null)).toBeNull();
  });

  it('lists every published HIP and HD, and pairs them where a row carries both', () => {
    const { hips, hds, hdByHip } = parseHipPhotometryTsv(HIP_PHOTOMETRY, FROM);
    expect([...hips].sort((a, b) => a - b)).toEqual([0, 32349, 71681, 88888, 99999]);
    expect([...hds]).toEqual([48915]);
    expect([...hdByHip]).toEqual([[32349, 48915]]);
  });

  it('throws on an empty file rather than yielding an empty gate', () => {
    // An empty map would silently disable the binding gate, which is the
    // failure this parser exists to make loud.
    expect(() => parseHipPhotometryTsv('', FROM)).toThrow(/has no header row/);
  });
});
