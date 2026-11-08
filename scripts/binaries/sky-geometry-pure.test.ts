import { describe, expect, it } from 'vitest';

import {
  WDS_PRECISE_COORD_EPOCH, chordSqForTolerance, distancePc, positionsWithin, predictSecondaryPosition, propagatePosition,
  tangentOffset,
} from './sky-geometry-pure';

describe('propagatePosition', () => {
  it('steps J2016 back to J2000 against the motion', () => {
    const { raDeg, decDeg } = propagatePosition(
      { raDeg: 100, decDeg: 0 }, { pmRaMasyr: 3600, pmDecMasyr: 0 }, 2016, WDS_PRECISE_COORD_EPOCH,
    );
    expect(raDeg).toBeCloseTo(99.984, 6);
    expect(decDeg).toBeCloseTo(0, 9);
  });

  it('returns the position unmoved when either PM component is missing', () => {
    const pos = { raDeg: 100, decDeg: 20 };
    expect(propagatePosition(pos, { pmRaMasyr: null, pmDecMasyr: 5 }, 2016, 2000)).toEqual(pos);
    expect(propagatePosition(pos, { pmRaMasyr: 5, pmDecMasyr: null }, 2016, 2000)).toEqual(pos);
  });

  it('wraps RA into [0, 360) the way Python does, a tiny negative landing on 360', () => {
    const back = propagatePosition({ raDeg: 0.001, decDeg: 0 }, { pmRaMasyr: 7200, pmDecMasyr: 0 }, 2000, 1999);
    expect(back.raDeg).toBeCloseTo(359.999, 9);
    const tiny = propagatePosition({ raDeg: 0, decDeg: 0 }, { pmRaMasyr: -1e-14, pmDecMasyr: 0 }, 2000, 2001);
    expect(tiny.raDeg).toBe(360);
  });

  it('floors cos δ at the pole so RA motion stays finite', () => {
    const { raDeg } = propagatePosition({ raDeg: 10, decDeg: 90 }, { pmRaMasyr: 3.6, pmDecMasyr: 0 }, 2000, 2001);
    expect(raDeg).toBeCloseTo(10 + 3.6 / (3600 * 1000 * 1e-3), 12);
  });
});

describe('tangentOffset', () => {
  it('is east = ΔRA·cos δ₀ and north = ΔDec, in arcsec', () => {
    const off = tangentOffset({ raDeg: 10.001, decDeg: 60.002 }, { raDeg: 10, decDeg: 60 });
    expect(off.eastArcsec).toBeCloseTo(0.001 * Math.cos(Math.PI / 3) * 3600, 9);
    expect(off.northArcsec).toBeCloseTo(7.2, 9);
  });

  it('takes the short way across RA 0h', () => {
    expect(tangentOffset({ raDeg: 359.999, decDeg: 0 }, { raDeg: 0.001, decDeg: 0 }).eastArcsec)
      .toBeCloseTo(-7.2, 6);
  });
});

describe('predictSecondaryPosition', () => {
  it('puts θ = 0 due north', () => {
    const { raDeg, decDeg } = predictSecondaryPosition({ raDeg: 100, decDeg: 0 }, { rhoArcsec: 3600, thetaDeg: 0 });
    expect(raDeg).toBeCloseTo(100, 6);
    expect(decDeg).toBeCloseTo(1, 6);
  });

  it('widens an eastward offset by 1 / cos δ', () => {
    const { raDeg, decDeg } = predictSecondaryPosition({ raDeg: 100, decDeg: 60 }, { rhoArcsec: 3600, thetaDeg: 90 });
    expect(raDeg).toBeCloseTo(102, 3);
    expect(decDeg).toBeCloseTo(60, 6);
  });
});

describe('positionsWithin', () => {
  it('compares the chord against the tolerance\'s chord', () => {
    const at = { raDeg: 100, decDeg: 20 };
    const east = (arcsec: number) => ({ raDeg: 100 + arcsec / 3600 / Math.cos((20 * Math.PI) / 180), decDeg: 20 });
    expect(positionsWithin(at, east(1), 2)).toBe(true);
    expect(positionsWithin(at, east(5), 2)).toBe(false);
    expect(chordSqForTolerance(0)).toBe(0);
  });
});

describe('distancePc', () => {
  it('inverts a positive parallax and refuses the rest', () => {
    expect(distancePc(100)).toBe(10);
    expect(distancePc(0)).toBeNull();
    expect(distancePc(-1)).toBeNull();
    expect(distancePc(null)).toBeNull();
  });
});
