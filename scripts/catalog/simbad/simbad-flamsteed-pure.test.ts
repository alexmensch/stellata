import { describe, expect, it } from 'vitest';

import type { CrossIndexRow } from '../classic-ids/classic-ids-parse';
import { classifySimbadFlamsteed, designationText, flamsteedFor, numberedDesignation, type SimbadIdentsObject } from './simbad-flamsteed-pure';

const IV27A: CrossIndexRow[] = [
  { hd: 100, hip: 10, bayer: null, flamsteed: 11, cst: 'Sgr' },
  { hd: 200, hip: 20, bayer: null, flamsteed: 40, cst: 'Sgr' },
  { hd: 300, hip: 30, bayer: 'alf', flamsteed: 3, cst: 'Lyr' },
];

const object = (oid: number, hips: number[], hds: number[], idents: string[]): SimbadIdentsObject => ({ oid, hips, hds, idents });

describe('numberedDesignation', () => {
  it('reads a `* NN Con` ident and ignores a Bayer letter', () => {
    expect(numberedDesignation('* 39 Psc')).toMatchObject({ number: 39, con: 'Psc' });
    expect(numberedDesignation('* pi.02 UMi')).toBeNull();
  });

  it('refuses a constellation outside the IAU 88', () => {
    expect(() => numberedDesignation('* 3 Zzz')).toThrow(/no IAU-88 constellation/);
  });
});

describe('classifySimbadFlamsteed', () => {
  const index = classifySimbadFlamsteed([
    object(1, [50], [500], ['* 12 Sgr', '* bet Sgr']),
    object(2, [51], [501], ['* 41 Sgr']),
    object(3, [52], [], ['* 4 Ara']),
    object(4, [53], [503], ['* 11 Sgr']),
    object(5, [10], [100], ['* 11 Sgr']),
  ], IV27A);

  it('accepts a number inside IV/27A\'s range that no other star holds, by HIP and HD', () => {
    expect(flamsteedFor(index, 500, null).map(designationText)).toEqual(['12 Sgr']);
    expect(flamsteedFor(index, null, 50).map(designationText)).toEqual(['12 Sgr']);
  });

  it('accepts the number IV/27A gives the same star', () => {
    expect(flamsteedFor(index, 100, 10).map(designationText)).toEqual(['11 Sgr']);
  });

  it('refuses past the range, in a constellation IV/27A numbers nothing in, and on another star\'s number', () => {
    expect(index.refused.map((r) => [r.object.oid, designationText(r.designation), r.reason, r.evidence])).toEqual([
      [2, '41 Sgr', 'beyond_iv27a_range', 'IV/27A\'s highest Sgr Flamsteed number is 40'],
      [3, '4 Ara', 'beyond_iv27a_range', 'IV/27A publishes no Flamsteed number in Ara'],
      [4, '11 Sgr', 'iv27a_names_another_star', 'IV/27A gives 11 Sgr to HD 100'],
    ]);
    expect(flamsteedFor(index, 503, 53)).toEqual([]);
  });
});
