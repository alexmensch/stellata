import { describe, expect, it } from 'vitest';

import { angularSeparationArcsec, raDecFromUnitVector, unitVectorFromRaDec } from '../../../src/astro-core/equatorial-basis';
import { WDS_PRECISE_COORD_EPOCH } from '../sky-geometry-pure';
import { athygDirectionAtEpoch, athygMatchStars, buildStarGrid, findNearestStar, pairPositionMatches } from './position-match-pure';
import { athygAt, decomposed, pairAt } from './resolve-fixture';
import { OWN, inheritedFrom } from '../multiples-record-pure';

describe('findNearestStar', () => {
  const east = (arcsec: number, decDeg: number) => 100 + arcsec / 3600 / Math.cos((decDeg * Math.PI) / 180);

  it('matches inside the tolerance and misses outside it', () => {
    const stars = athygMatchStars([athygAt({ ra: 100, dec: 20, gaia: '42' })]);
    const grid = buildStarGrid(stars);
    expect(findNearestStar({ raDeg: east(1, 20), decDeg: 20 }, grid, stars, 2, null, 1)).toBe(0);
    expect(findNearestStar({ raDeg: east(5, 20), decDeg: 20 }, grid, stars, 2, null, 1)).toBeNull();
  });

  it('skips the excluded row', () => {
    const stars = athygMatchStars([athygAt({ ra: 100, dec: 0, gaia: '10' }), athygAt({ ra: 100.0002, dec: 0, gaia: '20' })]);
    expect(findNearestStar({ raDeg: 100, decDeg: 0 }, buildStarGrid(stars), stars, 2, 0, 1)).toBe(1);
  });
});

describe('athygDirectionAtEpoch', () => {
  it('carries α Cen A\'s J1991.25 row to the WDS J2000 coord', () => {
    const row = athygAt({ ra: 219.92041, dec: -60.83515, hip: 71683, pmRaMasyr: -3678.19, pmDecMasyr: 481.84 });
    const { raDeg, decDeg } = raDecFromUnitVector(athygDirectionAtEpoch(row, WDS_PRECISE_COORD_EPOCH));
    expect(raDeg).toBeCloseTo(219.9021, 3);
    expect(decDeg).toBeCloseTo(-60.834, 3);
  });

  it('leaves a row with no PM where it is', () => {
    expect(athygDirectionAtEpoch(athygAt({ ra: 100, dec: 20 }), 2000)).toEqual(unitVectorFromRaDec(100, 20));
  });

  it('moves a low-PM row far less than the match tolerance', () => {
    const moved = athygDirectionAtEpoch(athygAt({ ra: 100, dec: 0, pmRaMasyr: 10, pmDecMasyr: 10 }), 2000);
    expect(angularSeparationArcsec(moved, unitVectorFromRaDec(100, 0))).toBeLessThan(0.5);
  });
});

describe('pairPositionMatches', () => {
  const pairs = [decomposed(pairAt({ components: 'AB', ra: 100, dec: 0, rhoLast: 0.0, thetaLast: 0 }), { primary: {}, secondary: {} })];
  const stars = athygMatchStars([athygAt({ ra: 100, dec: 0, gaia: '111' })]);

  it('gives a ρ = 0 secondary its primary\'s row, inherited as a blend', () => {
    expect(pairPositionMatches(pairs, stars, { skip: () => false }).matches).toEqual([
      { componentIdx: 0, starIdx: 0, origin: OWN },
      { componentIdx: 1, starIdx: 0, origin: inheritedFrom('A', 'blend') },
    ]);
  });

  it('gives a measured secondary whose prediction misses its primary\'s row as a partner, not a blend', () => {
    const measured = [decomposed(pairAt({ components: 'AB', ra: 100, dec: 0, rhoLast: 360, thetaLast: 0 }), { primary: {}, secondary: {} })];
    expect(pairPositionMatches(measured, stars, { skip: () => false }).matches).toEqual([
      { componentIdx: 0, starIdx: 0, origin: OWN },
      { componentIdx: 1, starIdx: 0, origin: inheritedFrom('A', 'partner') },
    ]);
  });
});
