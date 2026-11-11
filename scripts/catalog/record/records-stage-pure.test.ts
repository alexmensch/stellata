import { describe, expect, it } from 'vitest';

import { apsisCoverageSummary, recordsCounts, variabilityUnits } from './records-stage-pure';

const record = (gaiaSourceId: string | null, periodDays = 0, amplitudeMag = 0) => ({ gaiaSourceId, periodDays, amplitudeMag });

describe('variabilityUnits', () => {
  it('quantises only a record with both a period and an amplitude', () => {
    expect(variabilityUnits({ periodDays: 332, amplitudeMag: 6.2 })).toEqual({ ampUnits: 124, periodUnits: 3320 });
    expect(variabilityUnits({ periodDays: 332, amplitudeMag: 0 })).toEqual({ ampUnits: 0, periodUnits: 0 });
    expect(variabilityUnits({ periodDays: Number.NaN, amplitudeMag: 1 })).toEqual({ ampUnits: 0, periodUnits: 0 });
  });
});

describe('recordsCounts', () => {
  it('tallies variability, Gaia binding and Apsis / GSPC reach over the records', () => {
    const apsis = new Map([
      ['1', { teffGspphot: 5800, teffGspspec: null }],
      ['2', { teffGspphot: null, teffGspspec: null }],
    ]);
    const counts = recordsCounts(
      [record(null, 1, 1), record('1'), record('2', 10, 0.01), record('3')],
      apsis, new Map([['1', 0]]), 2,
    );
    expect(counts).toEqual({
      recordCount: 4,
      recordsInFirstChunk: 2,
      apsisSourcesUnpulled: 1,
      gspcSourcesUnpulled: 2,
      variableCount: 1,
      gaiaSourceIdResolved: 3,
      apsisMatched: 2,
      apsisTeffEither: 1,
    });
    expect(apsisCoverageSummary(counts)).toBe(
      'Gaia DR3 Apsis: 2 / 4 records matched (50.0%), Teff (gspphot OR gspspec) on 1 (25.0%)',
    );
  });
});
