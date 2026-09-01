import { describe, it, expect } from 'vitest';

import {
  formatSimbadSourcedDistancesTsv,
  parseSimbadSourcedDistancesTsv,
} from './simbad-sourced-ledger';

describe('simbad-sourced-ledger', () => {
  it('round-trips both join keys, so either match route excludes the record', () => {
    const keys = parseSimbadSourcedDistancesTsv(formatSimbadSourcedDistancesTsv([
      { gaiaSourceId: '4343066192373820800', hip: 78727 },
      { gaiaSourceId: null, hip: 12345 },
      { gaiaSourceId: '1118916397395366656', hip: null },
    ]));
    expect(keys.gaia.has('4343066192373820800')).toBe(true);
    expect(keys.gaia.has('1118916397395366656')).toBe(true);
    expect(keys.hip.has(78727)).toBe(true);
    expect(keys.hip.has(12345)).toBe(true);
    expect(keys.gaia.size).toBe(2);
    expect(keys.hip.size).toBe(2);
  });

  it('reads an empty list as excluding nothing rather than as a parse failure', () => {
    const keys = parseSimbadSourcedDistancesTsv(formatSimbadSourcedDistancesTsv([]));
    expect(keys.gaia.size).toBe(0);
    expect(keys.hip.size).toBe(0);
  });

  it('refuses a file whose columns moved rather than reading the wrong cells', () => {
    expect(() => parseSimbadSourcedDistancesTsv('hip\tgaia_source_id\n1\t2\n'))
      .toThrow(/unexpected header/);
  });
});
