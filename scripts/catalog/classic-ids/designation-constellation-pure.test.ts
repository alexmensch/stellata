import { describe, expect, it } from 'vitest';

import { NO_CONSTELLATION_INDEX } from '../../../src/catalog-format/record/catalog-pure';
import {
  inheritedDesignationCon,
  NO_DESIGNATION_CON,
  setDesignationCon,
  type DesignationConTarget,
} from './designation-constellation-pure';

const blank = (): DesignationConTarget => ({
  desigConIndex: NO_CONSTELLATION_INDEX, desigConSource: NO_DESIGNATION_CON,
});

describe('setDesignationCon', () => {
  it('writes the index and the tier that wrote it together', () => {
    const star = blank();
    setDesignationCon(star, 7, { via: 'iv27a' });
    setDesignationCon(star, 9, { via: 'wgsn-bayer', displaced: 7 });
    expect(star).toEqual({ desigConIndex: 9, desigConSource: { via: 'wgsn-bayer', displaced: 7 } });
  });

  it('refuses a write of no constellation', () => {
    expect(() => setDesignationCon(blank(), NO_CONSTELLATION_INDEX, { via: 'gcvs' })).toThrow(/gcvs/);
  });
});

describe('inheritedDesignationCon', () => {
  it('takes the anchor\'s constellation, sourced to the anchor', () => {
    const anchor = blank();
    setDesignationCon(anchor, 3, { via: 'iv27a' });
    expect(inheritedDesignationCon(anchor)).toEqual({ desigConIndex: 3, desigConSource: { via: 'anchor' } });
  });

  it('inherits nothing from no anchor, or from one with none', () => {
    expect(inheritedDesignationCon(null)).toEqual(blank());
    expect(inheritedDesignationCon(blank())).toEqual(blank());
  });
});
