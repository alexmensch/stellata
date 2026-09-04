import { describe, expect, it } from 'vitest';
import type { PriceFrameRow } from '../../src/client/debug/frame-cost/frame-cost-pure';
import { PRICE_ROW_COLUMNS, formatPriceTable } from './table-pure';

const row: PriceFrameRow = {
  pass: 'localDepth',
  method: 'timer-query',
  baselineMs: 41.4,
  disabledMs: 30.1,
  savedMs: 11.3,
  savedPct: 27.3,
  samples: 120,
  iqrMs: 2.1,
  noiseMs: 0.4,
  bracketMs: 0.9,
  baselineLag1: -0.12,
  disabledLag1: 0.03,
  baselineReadback: 0.25,
  disabledReadback: 0.25,
  baselineLimitMag: 1.511,
  disabledLimitMag: 1.511,
  bufferMpx: 4.096,
};

describe('formatPriceTable', () => {
  it('keeps the in-app console.table column order', () => {
    expect(PRICE_ROW_COLUMNS).toEqual([
      'pass', 'method', 'baselineMs', 'disabledMs', 'savedMs', 'savedPct', 'samples',
      'iqrMs', 'noiseMs', 'bracketMs', 'baselineLag1', 'disabledLag1',
      'baselineReadback', 'disabledReadback', 'baselineLimitMag', 'disabledLimitMag', 'bufferMpx',
    ]);
  });

  it('right-aligns every column to its widest cell and blanks a missing bracket', () => {
    const { bracketMs: _dropped, ...single } = row;
    const text = formatPriceTable([row, { ...single, pass: 'mwBand' }]);
    expect(text).toBe([
      '      pass       method  baselineMs  disabledMs  savedMs  savedPct  samples  iqrMs  noiseMs  bracketMs  baselineLag1  disabledLag1  baselineReadback  disabledReadback  baselineLimitMag  disabledLimitMag  bufferMpx',
      'localDepth  timer-query        41.4        30.1     11.3      27.3      120    2.1      0.4        0.9         -0.12          0.03              0.25              0.25             1.511             1.511      4.096',
      '    mwBand  timer-query        41.4        30.1     11.3      27.3      120    2.1      0.4                    -0.12          0.03              0.25              0.25             1.511             1.511      4.096',
    ].join('\n'));
  });

  it('prints the header alone for no rows', () => {
    expect(formatPriceTable([]).split('\n')).toHaveLength(1);
  });
});
