import { describe, expect, it } from 'vitest';

import { CON_INDEX, CONSTELLATIONS } from '../parse/constellations/constellations';
import { makeStar } from '../parse/star-fixture';
import { applyStarNames, starNamingSummary } from './apply-star-names';
import type { DesignationRow } from './wgsn-tables-pure';

const con = (code: string): number => CON_INDEX.get(code.toLowerCase())!;

const row = (over: Partial<DesignationRow>): DesignationRow => ({
  kind: 'bayer', letter: null, sup: null, num: null, dc: '', half: null,
  component: null, hip: null, hr: null, hd: null, source: 'nec', ...over,
});

const apply = (stars: ReturnType<typeof makeStar>[], designations: DesignationRow[]) =>
  applyStarNames(stars, { names: [], designations, dispositions: new Map() }, CONSTELLATIONS);

describe('applyStarNames: the designation constellation', () => {
  it('records the IV/27A constellation the authority\'s Bayer designation displaced (16 Lyn is ψ¹⁰ Aur)', () => {
    const star = makeStar({ hd: 49878, flam: 16, desigCon: { via: 'iv27a', index: con('Lyn') } });
    apply([star], [row({ letter: 'ψ', sup: 10, dc: 'Aur', hd: 49878 })]);
    expect(star.desigCon).toEqual({ via: 'wgsn-bayer', index: con('Aur'), displaced: con('Lyn') });
    expect(star.aliases).toContain('16 Lyn');
  });

  it('displaces nothing where the authority agrees with IV/27A', () => {
    const star = makeStar({ hd: 1, desigCon: { via: 'iv27a', index: con('Dra') } });
    apply([star], [row({ letter: 'μ', dc: 'Dra', hd: 1 })]);
    expect(star.desigCon).toEqual({ via: 'wgsn-bayer', index: con('Dra'), displaced: null });
    expect(star.aliases).toEqual([]);
  });

  it('takes the Gould designation\'s constellation where the authority states no Bayer', () => {
    const star = makeStar({ hd: 2 });
    apply([star], [row({ kind: 'gould', num: 268, dc: 'Cet', hd: 2 })]);
    expect(star.desigCon).toEqual({ via: 'wgsn-gould', index: con('Cet'), displaced: null });
  });
});

describe('starNamingSummary', () => {
  it('logs the authority pass\'s names, designations and aliases', () => {
    expect(starNamingSummary({
      namingIauNamed: 450, namingIauNamedByProper: 3, namingIauUnreached: 61, namingEponym: 27,
      namingBayer: 2039, namingBayerAdded: 519, namingBayerComponent: 68, namingBayerDropped: 2,
      namingGould: 937, namingAliases: 24, namingAliasRecords: 24,
    })).toBe(
      '  450 IAU names (3 via the record\'s own spelling, 61 approved names unreached), 27 string designations\n'
        + '  2039 Bayer designations (519 added, 2 spine cells the authority does not reach), 937 Gould, 24 aliases on 24 records',
    );
  });
});
