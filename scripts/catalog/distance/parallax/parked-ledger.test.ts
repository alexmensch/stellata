import { describe, it, expect } from 'vitest';

import {
  PARKED_REASONS,
  formatParkedRecordsTsv,
  parkedSpineKey,
  parseParkedRecordsTsv,
  type ParkedRecord,
} from './parked-ledger';

const SIGMA_ORI: ParkedRecord = {
  tyc: '4771-1188-1', hip: 26549, hd: 37468, gl: null,
  gaiaSourceId: '3216486443742786048',
  reason: 'refused_no_defensible_parallax',
};
const NO_IDS: ParkedRecord = {
  tyc: null, hip: null, hd: null, gl: null, gaiaSourceId: null,
  reason: 'no_parallax_published',
};

describe('parked-ledger', () => {
  it('round-trips a written ledger back to the keys the parity gate matches on', () => {
    const rows = parseParkedRecordsTsv(formatParkedRecordsTsv([SIGMA_ORI, NO_IDS]));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.reason).sort()).toEqual([...PARKED_REASONS].sort());
    expect(rows.map((r) => r.spineKey)).toContain(parkedSpineKey({
      tyc: '4771-1188-1', hip: '26549', hd: '37468', gl: '',
      gaia_source_id: '3216486443742786048',
    }));
  });

  it('keys a row carrying no identifier at all — the ledger still has to name '
    + 'it, and an empty tuple is that name', () => {
    const [row] = parseParkedRecordsTsv(formatParkedRecordsTsv([NO_IDS]));
    expect(row.spineKey).toBe(parkedSpineKey({
      tyc: '', hip: '', hd: '', gl: '', gaia_source_id: '',
    }));
  });

  it('refuses a file whose columns moved rather than reading the wrong cells', () => {
    expect(() => parseParkedRecordsTsv('hip\treason\n1\tx\n')).toThrow(/unexpected header/);
  });
});
