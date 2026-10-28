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
      .toThrow(/gaia_source_id "12a" is not a source_id/);
  });
});
