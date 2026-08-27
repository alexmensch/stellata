import { describe, it, expect } from 'vitest';

import { gaiaAstrometryRow } from './astrometry-fixture';
import { gaiaHas5pSolution, isGaiaCatalogueBibcode } from './gaia-distrust';

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

describe('isGaiaCatalogueBibcode', () => {
  it('classes only the Gaia catalogue releases as Gaia bibcodes', () => {
    expect(isGaiaCatalogueBibcode('2018yCat.1345....0G')).toBe(true);
    expect(isGaiaCatalogueBibcode('2020yCat.1350....0G')).toBe(true);
    expect(isGaiaCatalogueBibcode('2022yCat.1355....0G')).toBe(true);
    // Gontcharov's Pulkovo compilation — a G-initialled author, not Gaia.
    expect(isGaiaCatalogueBibcode('2006AstL...32..759G')).toBe(false);
    expect(isGaiaCatalogueBibcode('2011yCat.3265....0S')).toBe(false);
    // Zacharias's UCAC4, which supplies most of the PM rescue's SIMBAD tier.
    expect(isGaiaCatalogueBibcode('2012yCat.1322....0Z')).toBe(false);
  });

  it('reads an absent bibcode as not-Gaia, so a skip rule cannot fire on it', () => {
    expect(isGaiaCatalogueBibcode(null)).toBe(false);
  });
});
