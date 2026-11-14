import { describe, expect, it } from 'vitest';

import {
  chordSqForTolerance, distancePc, positionsWithin, predictSecondaryPosition,
  polarToTangent, tangentOffset,
} from './sky-geometry-pure';

describe('polarToTangent', () => {
  it('puts θ = 0 due north and θ = 90° due east', () => {
    expect(polarToTangent(5, 0)).toEqual({ eastArcsec: 0, northArcsec: 5 });
    const east = polarToTangent(5, 90);
    expect(east.eastArcsec).toBe(5);
    expect(east.northArcsec).toBeCloseTo(0, 12);
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
