import { describe, expect, it } from 'vitest';

import { inheritedDesignationCon, NO_DESIGNATION_CON } from './designation-constellation-pure';

describe('inheritedDesignationCon', () => {
  it('takes the anchor\'s constellation, sourced to the anchor', () => {
    expect(inheritedDesignationCon({ via: 'iv27a', index: 3 })).toEqual({ via: 'anchor', index: 3 });
    expect(inheritedDesignationCon({ via: 'wgsn-bayer', index: 5, displaced: 3 })).toEqual({ via: 'anchor', index: 5 });
  });

  it('inherits nothing from an anchor with none', () => {
    expect(inheritedDesignationCon(NO_DESIGNATION_CON)).toEqual(NO_DESIGNATION_CON);
  });
});
