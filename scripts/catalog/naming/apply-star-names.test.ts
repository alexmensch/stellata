import { describe, expect, it } from 'vitest';

import { CON_INDEX, CONSTELLATIONS } from '../parse/constellations/constellations';
import { makeStar } from '../parse/star-fixture';
import { applyStarNames, starNamingSummary } from './apply-star-names';
import type { DesignationRow } from './wgsn-tables-pure';
import { enterPhase } from '../record/record-phase';
import { classifySimbadFlamsteed } from '../simbad/simbad-flamsteed-pure';

const con = (code: string): number => CON_INDEX.get(code.toLowerCase())!;

const row = (over: Partial<DesignationRow>): DesignationRow => ({
  kind: 'bayer', letter: null, sup: null, num: null, dc: '', half: null,
  component: null, hip: null, hr: null, hd: null, source: 'nec', ...over,
});

const apply = (
  stars: ReturnType<typeof makeStar>[], designations: DesignationRow[], iv27aByHd: [number, string][] = [],
) => applyStarNames(enterPhase('walked', stars), {
  names: [], designations, dispositions: new Map(),
  designationCons: { byHd: new Map(iv27aByHd.map(([hd, code]) => [hd, con(code)])), byHip: new Map() },
  simbadFlamsteed: classifySimbadFlamsteed([], []),
}, CONSTELLATIONS);

describe('applyStarNames: the designation constellation', () => {
  it('records the IV/27A constellation the authority\'s Bayer designation displaced (16 Lyn is ψ¹⁰ Aur)', () => {
    const star = makeStar({ hd: 49878, flam: 16 });
    apply([star], [row({ letter: 'ψ', sup: 10, dc: 'Aur', hd: 49878 })], [[49878, 'Lyn']]);
    expect(star.desigCon).toEqual({ via: 'wgsn-bayer', index: con('Aur'), displaced: con('Lyn') });
    expect(star.aliases).toContain('16 Lyn');
  });

  it('displaces nothing where the authority agrees with IV/27A', () => {
    const star = makeStar({ hd: 1 });
    apply([star], [row({ letter: 'μ', dc: 'Dra', hd: 1 })], [[1, 'Dra']]);
    expect(star.desigCon).toEqual({ via: 'wgsn-bayer', index: con('Dra'), displaced: null });
    expect(star.aliases).toEqual([]);
  });

  it('starts from IV/27A\'s constellation where the authority states none', () => {
    const star = makeStar({ hd: 3 });
    apply([star], [], [[3, 'Lyr']]);
    expect(star.desigCon).toEqual({ via: 'iv27a', index: con('Lyr') });
  });

  it('takes the Gould designation\'s constellation where the authority states no Bayer', () => {
    const star = makeStar({ hd: 2 });
    apply([star], [row({ kind: 'gould', num: 268, dc: 'Cet', hd: 2 })]);
    expect(star.desigCon).toEqual({ via: 'wgsn-gould', index: con('Cet'), displaced: null });
  });
});

describe('applyStarNames: Bayer designations', () => {
  it('gives a letter only to a record the authority reaches', () => {
    const reached = makeStar({ hd: 1 });
    const bare = makeStar({ hd: 2 });
    const { counts } = apply([reached, bare], [row({ letter: 'μ', dc: 'Dra', hd: 1 })]);
    expect(counts.namingBayer).toBe(1);
    expect([reached.bayer, bare.bayer]).toEqual(['μ', null]);
  });
});

describe('starNamingSummary', () => {
  it('logs the authority pass\'s names, designations and aliases', () => {
    expect(starNamingSummary({
      namingIauNamed: 450, namingIauNamedByProper: 3, namingIauUnreached: 61, namingEponym: 27,
      namingBayer: 2039, namingBayerComponent: 68,
      namingGould: 937, namingAliases: 24, namingAliasRecords: 24,
    })).toBe(
      '  450 IAU names (3 via the record\'s own spelling, 61 approved names unreached), 27 string designations\n'
        + '  2039 Bayer designations, 937 Gould, 24 aliases on 24 records',
    );
  });
});
