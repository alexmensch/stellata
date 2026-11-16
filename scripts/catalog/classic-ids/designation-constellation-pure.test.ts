import { describe, expect, it } from 'vitest';

import { designationConstellation, inheritedDesignationCon, NO_DESIGNATION_CON } from './designation-constellation-pure';

describe('designationConstellation', () => {
  it('answers IV/27A\'s constellation sourced to IV/27A, by HD then HIP, and none for a record it does not reach', () => {
    const index = { byHd: new Map([[216956, 5]]), byHip: new Map([[113368, 7]]) };
    expect(designationConstellation(index, { hd: 216956, hip: null })).toEqual({ via: 'iv27a', index: 5 });
    expect(designationConstellation(index, { hd: null, hip: 113368 })).toEqual({ via: 'iv27a', index: 7 });
    expect(designationConstellation(index, { hd: 1, hip: null })).toEqual(NO_DESIGNATION_CON);
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
