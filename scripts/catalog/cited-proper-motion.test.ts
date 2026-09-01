import { describe, it, expect } from 'vitest';

import { citedProperMotion } from './cited-proper-motion';

const UCAC4 = '2012yCat.1322....0Z';

describe('citedProperMotion', () => {
  it('admits a complete cited motion', () => {
    expect(citedProperMotion(2314.8, 2295.3, UCAC4))
      .toEqual({ pmRaMasyr: 2314.8, pmDecMasyr: 2295.3, bibcode: UCAC4 });
  });

  it('drops a motion missing its citation, rather than admitting it uncited', () => {
    // The hole this type closes: a null bibcode reads as "not a Gaia release"
    // to every bibcode predicate, so an uncited motion would pass the skip
    // rule instead of being refused by it.
    expect(citedProperMotion(2314.8, 2295.3, null)).toBeNull();
  });

  it('drops a half-stated motion whole — one component is not a motion', () => {
    expect(citedProperMotion(2314.8, null, UCAC4)).toBeNull();
    expect(citedProperMotion(null, 2295.3, UCAC4)).toBeNull();
    expect(citedProperMotion(null, null, UCAC4)).toBeNull();
  });

  it('admits a genuine zero — no measured motion is a motion, not an absence', () => {
    expect(citedProperMotion(0, 0, UCAC4))
      .toEqual({ pmRaMasyr: 0, pmDecMasyr: 0, bibcode: UCAC4 });
  });
});
