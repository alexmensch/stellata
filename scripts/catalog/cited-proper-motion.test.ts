import { describe, it, expect } from 'vitest';

import { citedProperMotion } from './cited-proper-motion';
import { SIMBAD_VALUES } from './simbad/simbad-values-source';
import { sourceRowRef } from '../util/sources/row-ref-pure';

const UCAC4 = '2012yCat.1322....0Z';
const REF = sourceRowRef(SIMBAD_VALUES, 1);

describe('citedProperMotion', () => {
  it('admits a complete cited motion', () => {
    expect(citedProperMotion(2314.8, 2295.3, UCAC4, REF))
      .toEqual({ pmRaMasyr: 2314.8, pmDecMasyr: 2295.3, bibcode: UCAC4, ref: REF });
  });

  it('drops a motion missing its citation, rather than admitting it uncited', () => {
    // The hole this type closes: a null bibcode reads as "not a Gaia release"
    // to every bibcode predicate, so an uncited motion would pass the skip
    // rule instead of being refused by it.
    expect(citedProperMotion(2314.8, 2295.3, null, REF)).toBeNull();
  });

  it('drops a half-stated motion whole — one component is not a motion', () => {
    expect(citedProperMotion(2314.8, null, UCAC4, REF)).toBeNull();
    expect(citedProperMotion(null, 2295.3, UCAC4, REF)).toBeNull();
    expect(citedProperMotion(null, null, UCAC4, REF)).toBeNull();
  });

  it('admits a genuine zero — no measured motion is a motion, not an absence', () => {
    expect(citedProperMotion(0, 0, UCAC4, REF))
      .toEqual({ pmRaMasyr: 0, pmDecMasyr: 0, bibcode: UCAC4, ref: REF });
  });
});
