import { describe, expect, it } from 'vitest';

import { unitVectorFromRaDec } from '../../src/astro-core/equatorial-basis';
import {
  chordSqForTolerance, directionsWithin, distancePc, predictSecondaryPosition,
  polarToTangent, tangentOffset, tangentToPolar,
} from './sky-geometry-pure';

describe('polarToTangent', () => {
  it('puts θ = 0 due north and θ = 90° due east', () => {
    expect(polarToTangent(5, 0)).toEqual({ eastArcsec: 0, northArcsec: 5 });
    const east = polarToTangent(5, 90);
    expect(east.eastArcsec).toBe(5);
    expect(east.northArcsec).toBeCloseTo(0, 12);
  });
});

describe('tangentToPolar', () => {
  it('inverts polarToTangent', () => {
    const back = tangentToPolar(polarToTangent(42.1, 269));
    expect(back.sepArcsec).toBeCloseTo(42.1, 12);
    expect(back.paDeg).toBeCloseTo(269, 12);
  });

  it('reads a position angle a rounding unit west of north as 360, not 0', () => {
    expect(tangentToPolar({ eastArcsec: -1e-300, northArcsec: 1 }).paDeg).toBe(360);
    expect(tangentToPolar({ eastArcsec: 0, northArcsec: 1 }).paDeg).toBe(0);
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

describe('directionsWithin', () => {
  it('compares the chord against the tolerance\'s chord', () => {
    const at = unitVectorFromRaDec(100, 20);
    const east = (arcsec: number) => unitVectorFromRaDec(100 + arcsec / 3600 / Math.cos((20 * Math.PI) / 180), 20);
    expect(directionsWithin(at, east(1), 2)).toBe(true);
    expect(directionsWithin(at, east(5), 2)).toBe(false);
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
