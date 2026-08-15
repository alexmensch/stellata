import { describe, it, expect } from 'vitest';

import { parseGspcTsv } from './gspc-parse';

describe('gspc-parse / parseGspcTsv', () => {
  const GSPC = [
    'source_id\tb_jkc_mag\tb_jkc_flux\tb_jkc_flux_error\tb_jkc_flag\tv_jkc_mag\tv_jkc_flux\tv_jkc_flux_error\tv_jkc_flag',
    // in the validated range, both bands
    '36747057287093632\t11.890008\t1.0e-16\t3.7e-18\t1\t11.224282\t2.0e-16\t2.7e-18\t1',
    // outside it, both bands — the shape almost every row of this catalogue takes
    '4472832130942575872\t11.249152\t1.0e-16\t1.7e-17\t0\t9.555117\t2.0e-16\t2.8e-17\t0',
    // B absent: no colour, so no entry at all
    '10625474212633728\t\t\t\t0\t11.702773\t2.0e-16\t1.4e-17\t1',
    // one band flagged in range, the other not
    '99999999999999999\t8.000000\t1.0e-16\t1.0e-18\t1\t7.000000\t2.0e-16\t1.0e-18\t0',
  ].join('\n');

  it('keys by the source_id string and carries B − V', () => {
    const m = parseGspcTsv(GSPC);
    // The ids exceed Number.MAX_SAFE_INTEGER, so the key must stay a string.
    expect(m.get('4472832130942575872')?.bMinusV).toBeCloseTo(1.694035, 6);
    expect(m.get('36747057287093632')?.bMinusV).toBeCloseTo(0.665726, 6);
  });

  it('skips a row missing either band rather than entering a partial colour', () => {
    expect(parseGspcTsv(GSPC).has('10625474212633728')).toBe(false);
    expect(parseGspcTsv(GSPC).size).toBe(3);
  });

  it('calls a row in range only when BOTH bands are flagged 1', () => {
    const m = parseGspcTsv(GSPC);
    expect(m.get('36747057287093632')?.inValidatedRange).toBe(true);
    expect(m.get('4472832130942575872')?.inValidatedRange).toBe(false);
    expect(m.get('99999999999999999')?.inValidatedRange).toBe(false);
  });

  it('throws on an empty file rather than silently zeroing the tier', () => {
    expect(() => parseGspcTsv('')).toThrow(/missing required columns/);
  });
});
