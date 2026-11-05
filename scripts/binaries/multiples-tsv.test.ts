import { describe, expect, it } from 'vitest';

import { describeCommittedRoundTrip } from '../util/tsv/committed-round-trip';
import { MULTIPLES_COLUMNS, MULTIPLES_TSV } from './multiples-tsv';

describeCommittedRoundTrip(MULTIPLES_TSV);

describe('multiples.tsv codec', () => {
  const header = MULTIPLES_COLUMNS.join('\t');
  const cells = (over: Record<string, string>) => MULTIPLES_COLUMNS.map((c) => over[c] ?? ({
    source: 'wds', regime: '0', resolve_via: 'unresolved', astrometry_via: 'gaia_5p', orbit_via: 'none',
    spect_via: 'none', photometry_via: 'none', a_via: 'none', orbit_role: 'primary',
  } as Record<string, string>)[c] ?? '').join('\t');

  it('keeps a negative zero the writer printed', () => {
    const text = `${header}\n${cells({ x_pc: '-0.000000' })}\n`;
    expect(MULTIPLES_TSV.serialize(MULTIPLES_TSV.parse(text))).toBe(text);
  });

  it('rejects a value outside a closed column', () => {
    expect(() => MULTIPLES_TSV.parse(`${header}\n${cells({ photometry_via: 'athyg' })}\n`))
      .toThrow(/photometry_via: "athyg" is not one of/);
  });

  it('rejects a source_id that is not digits', () => {
    expect(() => MULTIPLES_TSV.parse(`${header}\n${cells({ gaia_source_id: '12a' })}\n`))
      .toThrow(/multiples\.tsv:2: gaia_source_id: "12a" is not a source_id/);
  });

  it('rejects orbital elements no bound orbit has', () => {
    for (const [over, message] of [
      [{ P_days: '0.000000' }, /P_days 0 is not positive/],
      [{ a_AU: '-1.000000' }, /a_AU -1 is not positive/],
      [{ e: '1.000000' }, /e 1 is not a bound orbit/],
      [{ e: '-0.100000' }, /e -0.1 is not a bound orbit/],
    ] as const) {
      expect(() => MULTIPLES_TSV.parse(`${header}\n${cells(over)}\n`)).toThrow(message);
    }
    expect(MULTIPLES_TSV.parse(`${header}\n${cells({ P_days: '2.867000', a_AU: '0.060000', e: '0.000000' })}\n`)[0])
      .toMatchObject({ pDays: 2.867, aAU: 0.06, e: 0 });
  });
});
