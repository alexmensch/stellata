import { describe, expect, it } from 'vitest';

import { WDS_PRECISE_COORD_EPOCH } from '../sky-geometry-pure';
import { athygPositionAtEpoch, buildAthygGrid, findNearestAthyg, pairAthygMatches } from './athyg-match-pure';
import { athygAt, pairAt, resolved } from './resolve-fixture';

describe('findNearestAthyg', () => {
  const east = (arcsec: number, decDeg: number) => 100 + arcsec / 3600 / Math.cos((decDeg * Math.PI) / 180);

  it('matches inside the tolerance and misses outside it', () => {
    const athyg = [athygAt({ ra: 100, dec: 20, gaia: '42' })];
    const grid = buildAthygGrid(athyg);
    expect(findNearestAthyg({ raDeg: east(1, 20), decDeg: 20 }, grid, athyg, 2, null, null)).toBe(0);
    expect(findNearestAthyg({ raDeg: east(5, 20), decDeg: 20 }, grid, athyg, 2, null, null)).toBeNull();
  });

  it('skips the excluded row', () => {
    const athyg = [athygAt({ ra: 100, dec: 0, gaia: '10' }), athygAt({ ra: 100.0002, dec: 0, gaia: '20' })];
    expect(findNearestAthyg({ raDeg: 100, decDeg: 0 }, buildAthygGrid(athyg), athyg, 2, 0, null)).toBe(1);
  });
});

describe('athygPositionAtEpoch', () => {
  it('carries α Cen A\'s J1991.25 row to the WDS J2000 coord', () => {
    const row = athygAt({ ra: 219.92041, dec: -60.83515, hip: 71683, pmRaMasyr: -3678.19, pmDecMasyr: 481.84 });
    const { raDeg, decDeg } = athygPositionAtEpoch(row, WDS_PRECISE_COORD_EPOCH);
    expect(raDeg).toBeCloseTo(219.9021, 3);
    expect(decDeg).toBeCloseTo(-60.834, 3);
  });

  it('leaves a row with no PM where it is', () => {
    expect(athygPositionAtEpoch(athygAt({ ra: 100, dec: 20 }), 2000)).toEqual({ raDeg: 100, decDeg: 20 });
  });

  it('moves a low-PM row far less than the match tolerance', () => {
    const { raDeg, decDeg } = athygPositionAtEpoch(athygAt({ ra: 100, dec: 0, pmRaMasyr: 10, pmDecMasyr: 10 }), 2000);
    expect(Math.abs(raDeg - 100) * 3600).toBeLessThan(0.5);
    expect(Math.abs(decDeg) * 3600).toBeLessThan(0.5);
  });
});

describe('pairAthygMatches', () => {
  const pair = pairAt({ components: 'AB', ra: 100, dec: 0, rhoLast: 0.0, thetaLast: 0 });
  const comps = [
    resolved({ wdsId: pair.wdsId, discoverer: pair.discoverer }),
    resolved({ wdsId: pair.wdsId, discoverer: pair.discoverer, component: 'B', isPrimary: false }),
  ];
  const athyg = [athygAt({ ra: 100, dec: 0, gaia: '111' })];

  it('gives a ρ = 0 secondary its primary\'s row only when blend inheritance is allowed', () => {
    const allowed = pairAthygMatches(comps, [pair], athyg, { skip: () => false, allowBlendInherit: true });
    expect(allowed.matches).toEqual([
      { componentIdx: 0, athygIdx: 0, blendInherit: false },
      { componentIdx: 1, athygIdx: 0, blendInherit: true },
    ]);
    const refused = pairAthygMatches(comps, [pair], athyg, { skip: () => false, allowBlendInherit: false });
    expect(refused.matches).toEqual([{ componentIdx: 0, athygIdx: 0, blendInherit: false }]);
  });
});
