import { describe, it, expect } from 'vitest';

import { gaiaAstrometryRow } from './astrometry-fixture';
import {
  gaiaHas5pSolution,
  gaiaRowIs2p,
  isGaiaCatalogueBibcode,
  gaiaRefusals,
  refusedBy,
} from './gaia-distrust';

describe('gaiaHas5pSolution', () => {
  it('turns on the parallax cell, not on the PM one', () => {
    expect(gaiaHas5pSolution(gaiaAstrometryRow({ parallaxMas: 50 }))).toBe(true);
    expect(gaiaHas5pSolution(
      gaiaAstrometryRow({ parallaxMas: null, pmraMasyr: 10, pmdecMasyr: -10 }),
    )).toBe(false);
  });

  it('reads a genuine zero parallax as a solved fit', () => {
    expect(gaiaHas5pSolution(gaiaAstrometryRow({ parallaxMas: 0 }))).toBe(true);
  });
});

describe('gaiaRowIs2p', () => {
  it('is the negation of the 5p condition where a Gaia row stands behind it', () => {
    expect(gaiaRowIs2p(gaiaAstrometryRow({ parallaxMas: null }))).toBe(true);
    expect(gaiaRowIs2p(gaiaAstrometryRow({ parallaxMas: 50 }))).toBe(false);
  });

  it('reads a record with no Gaia row as NOT 2p, so no skip rule fires on it', () => {
    // No Gaia fit stands behind the record, so there is no blend to distrust
    // and a Gaia bibcode reaching it is an ordinary citation. Inverting this
    // would strip the motion from every non-Gaia record citing a release.
    expect(gaiaRowIs2p(null)).toBe(false);
  });
});

describe('isGaiaCatalogueBibcode', () => {
  it('classes only the Gaia catalogue releases as Gaia bibcodes', () => {
    expect(isGaiaCatalogueBibcode('2018yCat.1345....0G')).toBe(true);
    expect(isGaiaCatalogueBibcode('2020yCat.1350....0G')).toBe(true);
    expect(isGaiaCatalogueBibcode('2022yCat.1355....0G')).toBe(true);
    // Gontcharov 2006 (/data/papers/index.md#gontcharov2006), the Pulkovo
    // compilation — a G-initialled author, not Gaia.
    expect(isGaiaCatalogueBibcode('2006AstL...32..759G')).toBe(false);
    expect(isGaiaCatalogueBibcode('2011yCat.3265....0S')).toBe(false);
    // Zacharias 2012 (/data/papers/index.md#zacharias2012), UCAC4, which supplies
    // most of the PM rescue's SIMBAD tier.
    expect(isGaiaCatalogueBibcode('2012yCat.1322....0Z')).toBe(false);
  });
});

describe('refusedBy', () => {
  const GAIA_DR2 = '2018yCat.1345....0G';
  const VAN_LEEUWEN_2007 = '2007A&A...474..653V';
  const LITERATURE = '2006AstL...32..759G';

  it('refuses a Gaia release only where the record\'s own fit is 2p', () => {
    expect(refusedBy(GAIA_DR2, gaiaRefusals(true))).toBe(true);
    expect(refusedBy(GAIA_DR2, gaiaRefusals(false))).toBe(false);
  });

  // HIP 37 is the shape: HIP2 states 2.62 ± 2.55 mas, the floor refuses it, and
  // a courier citing van Leeuwen 2007 would serve 2.62 back without the error.
  it('refuses van Leeuwen 2007 only once a tier above refused HIP2', () => {
    expect(refusedBy(VAN_LEEUWEN_2007, new Set(['hipparcos2']))).toBe(true);
    expect(refusedBy(VAN_LEEUWEN_2007, gaiaRefusals(true))).toBe(false);
  });

  it('never refuses the literature', () => {
    expect(refusedBy(LITERATURE, new Set(['gaia_release', 'hipparcos2']))).toBe(false);
  });
});
