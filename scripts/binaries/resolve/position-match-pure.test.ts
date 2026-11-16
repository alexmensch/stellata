import { describe, expect, it } from 'vitest';

import { unitVectorFromRaDec } from '../../../src/astro-core/equatorial-basis';
import { buildStarGrid, findNearestStar, pairPositionMatches, type MatchStar } from './position-match-pure';
import { decomposed, pairAt } from './resolve-fixture';
import { OWN, inheritedFrom } from '../multiples-record-pure';

const star = (raDeg: number, decDeg: number, ...later: readonly (readonly [number, number])[]): MatchStar => ({
  raDeg, decDeg, hip: null,
  readings: [unitVectorFromRaDec(raDeg, decDeg), ...later.map(([ra, dec]) => unitVectorFromRaDec(ra, dec))],
});

describe('findNearestStar', () => {
  const east = (arcsec: number, decDeg: number) => 100 + arcsec / 3600 / Math.cos((decDeg * Math.PI) / 180);

  it('matches inside the tolerance and misses outside it', () => {
    const stars = [star(100, 20)];
    const grid = buildStarGrid(stars);
    expect(findNearestStar({ raDeg: east(1, 20), decDeg: 20 }, grid, stars, 2, null, 0)).toBe(0);
    expect(findNearestStar({ raDeg: east(5, 20), decDeg: 20 }, grid, stars, 2, null, 0)).toBeNull();
  });

  it('skips the excluded star', () => {
    const stars = [star(100, 0), star(100.0002, 0)];
    expect(findNearestStar({ raDeg: 100, decDeg: 0 }, buildStarGrid(stars), stars, 2, 0, 0)).toBe(1);
  });

  it('skips a star with no reading at that index', () => {
    const stars = [star(100, 0)];
    expect(findNearestStar({ raDeg: 100, decDeg: 0 }, buildStarGrid(stars), stars, 2, null, 1)).toBeNull();
  });
});

describe('pairPositionMatches', () => {
  const pairs = [decomposed(pairAt({ components: 'AB', ra: 100, dec: 0, rhoLast: 0.0, thetaLast: 0 }), { primary: {}, secondary: {} })];

  it('gives a ρ = 0 secondary its primary\'s star, inherited as a blend', () => {
    expect(pairPositionMatches(pairs, [star(100, 0)], { skip: () => false }).matches).toEqual([
      { componentIdx: 0, starIdx: 0, origin: OWN },
      { componentIdx: 1, starIdx: 0, origin: inheritedFrom('A', 'blend') },
    ]);
  });

  it('gives a measured secondary whose prediction misses its primary\'s star as a partner, not a blend', () => {
    const measured = [decomposed(pairAt({ components: 'AB', ra: 100, dec: 0, rhoLast: 360, thetaLast: 0 }), { primary: {}, secondary: {} })];
    expect(pairPositionMatches(measured, [star(100, 0)], { skip: () => false }).matches).toEqual([
      { componentIdx: 0, starIdx: 0, origin: OWN },
      { componentIdx: 1, starIdx: 0, origin: inheritedFrom('A', 'partner') },
    ]);
  });

  it('tries every star\'s first reading before any star\'s second', () => {
    const stars = [star(50, 0, [100, 0]), star(100.0004, 0)];
    expect(pairPositionMatches(pairs, stars, { skip: (_i, c) => !c.isPrimary }).matches)
      .toEqual([{ componentIdx: 0, starIdx: 1, origin: OWN }]);
  });
});
