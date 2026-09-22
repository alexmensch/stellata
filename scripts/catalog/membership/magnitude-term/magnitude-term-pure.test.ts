import { describe, expect, it } from 'vitest';

import {
  MAGNITUDE_FLOOR_V,
  MAGNITUDE_PULL_G_BOUND,
  isMagnitudeTermRow,
  magnitudeTermNewcomers,
  magnitudeVerdict,
  selectMagnitudeTerm,
} from './magnitude-term-pure';

const HEADER = [
  'source_id', 'ra', 'dec', 'parallax', 'pmra', 'pmdec', 'ruwe',
  'phot_g_mean_mag', 'phot_bp_mean_mag', 'phot_rp_mean_mag',
].join('\t');

function row(sourceId: string, g: string, bp: string, rp: string): string {
  return [sourceId, '1.0', '2.0', '5.0', '1.0', '1.0', '1.0', g, bp, rp].join('\t');
}

// G 10 at BP−RP 0 transforms to V 10.027; G 10.9 at BP−RP 3 to V 12.44.
const BLUE = row('11', '10.0', '0.5', '0.5');
const RED = row('22', '10.9', '11.9', '8.9');
const SATURATED = row('33', '3.0', '3.5', '3.5');
const NO_BAND = row('44', '9.0', '', '8.5');

describe('magnitudeVerdict', () => {
  it('keeps a source at or below the floor and refuses one above it', () => {
    const blue = { gMag: 10, bpMag: 0.5, rpMag: 0.5 };
    expect(magnitudeVerdict(blue, 11)).toBe('kept');
    expect(magnitudeVerdict(blue, 10)).toBe('above_floor');
  });

  it('reads no_v for a source the Riello transform does not serve', () => {
    expect(magnitudeVerdict({ gMag: 3, bpMag: 3.5, rpMag: 3.5 }, 11)).toBe('no_v');
    expect(magnitudeVerdict({ gMag: 9, bpMag: null, rpMag: 8.5 }, 11)).toBe('no_v');
    expect(magnitudeVerdict(null, 11)).toBe('no_v');
  });

  it('refuses a colour outside the relation, however bright the G', () => {
    expect(magnitudeVerdict({ gMag: 6, bpMag: 12, rpMag: 6 }, 11)).toBe('no_v');
  });
});

describe('selectMagnitudeTerm', () => {
  it('partitions the pull over the three verdicts', () => {
    const { keptSourceIds, counts } = selectMagnitudeTerm(
      [HEADER, BLUE, RED, SATURATED, NO_BAND].join('\n'),
      11,
    );
    expect(counts).toEqual({ rows: 4, kept: 1, above_floor: 1, no_v: 2 });
    expect([...keptSourceIds]).toEqual(['11']);
  });

  it('counts every row exactly once', () => {
    const { counts } = selectMagnitudeTerm(
      [HEADER, BLUE, RED, SATURATED, NO_BAND].join('\n'),
      11,
    );
    expect(counts.kept + counts.above_floor + counts.no_v).toBe(counts.rows);
  });

  it('keeps source_id a string, so a 19-digit id survives the walk', () => {
    const id = '4472832130942575872';
    const { keptSourceIds } = selectMagnitudeTerm(
      [HEADER, row(id, '10.0', '0.5', '0.5')].join('\n'),
      11,
    );
    expect([...keptSourceIds]).toEqual([id]);
    expect(String(Number(id))).not.toBe(id);
  });

  it('throws on a header missing a band rather than zeroing the term', () => {
    expect(() => selectMagnitudeTerm('source_id\tphot_g_mean_mag\n', 11)).toThrow(
      /missing required columns/,
    );
  });

  it('throws on an empty file rather than reading it as a term of no rows', () => {
    expect(() => selectMagnitudeTerm('', 11)).toThrow(/missing required columns/);
  });

  it('yields no rows from a valid header alone', () => {
    expect(selectMagnitudeTerm(HEADER, 11).counts.rows).toBe(0);
  });

  it('refuses a non-finite floor', () => {
    expect(() => selectMagnitudeTerm(HEADER, Number.NaN)).toThrow(/finite/);
  });

  it('refuses a floor deeper than the pull on disk, rather than under-selecting', () => {
    expect(() => selectMagnitudeTerm(HEADER, MAGNITUDE_PULL_G_BOUND + 0.5)).toThrow(
      /exceeds the pull's G <= 11 bound/,
    );
    expect(() => selectMagnitudeTerm(HEADER, MAGNITUDE_PULL_G_BOUND)).not.toThrow();
  });
});

describe('magnitudeTermNewcomers', () => {
  it('drops the sources the primaries already bind', () => {
    expect(magnitudeTermNewcomers(new Set(['1', '2', '3']), new Set(['2']))).toEqual(['1', '3']);
  });

  it('yields nothing when the primaries bind the whole selection', () => {
    expect(magnitudeTermNewcomers(new Set(['1']), new Set(['1']))).toEqual([]);
  });
});

describe('isMagnitudeTermRow', () => {
  it('takes the magnitude rows and leaves the primaries alone', () => {
    expect(isMagnitudeTermRow({ term: 'magnitude', gaia_source_id: '2' })).toBe(true);
    expect(isMagnitudeTermRow({ term: 'primaries', gaia_source_id: '1' })).toBe(false);
  });

  it('refuses a magnitude row with no source_id, which could key nothing', () => {
    expect(isMagnitudeTermRow({ term: 'magnitude', gaia_source_id: '' })).toBe(false);
  });
});

describe('the shipped floor', () => {
  it('is V <= 11, the depth the committed pull is complete to', () => {
    expect(MAGNITUDE_FLOOR_V).toBe(11);
  });

  it('cannot exceed the bound the pull on disk holds', () => {
    expect(MAGNITUDE_FLOOR_V === null || MAGNITUDE_FLOOR_V <= MAGNITUDE_PULL_G_BOUND).toBe(true);
  });
});
