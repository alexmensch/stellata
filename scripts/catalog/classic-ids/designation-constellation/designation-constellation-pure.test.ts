import { describe, expect, it } from 'vitest';

import { CON_INDEX } from '../../parse/constellations/constellations';
import { classifySimbadFlamsteed } from '../../simbad/simbad-flamsteed-pure';
import { designationConstellation, inheritedDesignationCon, NO_DESIGNATION_CON } from './designation-constellation-pure';

describe('designationConstellation', () => {
  const index = { byHd: new Map([[216956, 5]]), byHip: new Map([[113368, 7]]) };
  const simbad = classifySimbadFlamsteed(
    [{ oid: 1, hips: [1427], hds: [1352], sourceIds: [], idents: ['* 39 Psc'] }],
    [{ hd: 9, hip: null, bayer: null, flamsteed: 113, cst: 'Psc' }],
  );
  const star = (hd: number | null, hip: number | null, flam: number | null = null) => ({ hd, hip, flam });

  it('answers IV/27A\'s constellation sourced to IV/27A, by HD then HIP, and none for a record it does not reach', () => {
    expect(designationConstellation(index, simbad, star(216956, null))).toEqual({ via: 'iv27a', index: 5 });
    expect(designationConstellation(index, simbad, star(null, 113368))).toEqual({ via: 'iv27a', index: 7 });
    expect(designationConstellation(index, simbad, star(1, null))).toEqual(NO_DESIGNATION_CON);
  });

  it('falls to SIMBAD\'s constellation for the record\'s own Flamsteed number only', () => {
    expect(designationConstellation(index, simbad, star(1352, 1427, 39))).toEqual({ via: 'simbad', index: CON_INDEX.get('psc') });
    expect(designationConstellation(index, simbad, star(1352, 1427, 40))).toEqual(NO_DESIGNATION_CON);
    expect(designationConstellation(index, simbad, star(1352, 1427))).toEqual(NO_DESIGNATION_CON);
  });
});

describe('inheritedDesignationCon', () => {
  it('takes the anchor\'s constellation, sourced to the anchor', () => {
    expect(inheritedDesignationCon({ via: 'iv27a', index: 3 })).toEqual({ via: 'anchor', index: 3 });
    expect(inheritedDesignationCon({ via: 'wgsn-bayer', index: 5, displaced: 3 })).toEqual({ via: 'anchor', index: 5 });
  });

  it('inherits nothing from an anchor with none', () => {
    expect(inheritedDesignationCon(NO_DESIGNATION_CON)).toEqual(NO_DESIGNATION_CON);
  });
});
