import { describe, expect, it } from 'vitest';
import { ulpsBetween } from './ulp';

describe('ulpsBetween', () => {
  it('identical values are zero steps apart, including across signed zero', () => {
    expect(ulpsBetween(1.5, 1.5)).toBe(0);
    expect(ulpsBetween(0, -0)).toBe(0);
  });

  it('adjacent representables are one step apart at any magnitude', () => {
    expect(ulpsBetween(1, 1 + Number.EPSILON)).toBe(1);
    expect(ulpsBetween(-1 - Number.EPSILON, -1)).toBe(1);
    // Scale-free, which is the property that makes the unit usable across
    // a pose holding both parsec coordinates and unit quaternions.
    for (const v of [1e-6, 4.2, 1e13]) {
      const next = v + Math.abs(v) * Number.EPSILON;
      expect(ulpsBetween(v, next)).toBe(1);
    }
  });

  it('counts steps across zero rather than exploding', () => {
    expect(ulpsBetween(Number.MIN_VALUE, -Number.MIN_VALUE)).toBe(2);
  });

  it('a NaN-seeded snapshot is a sentinel, not a drift', () => {
    expect(ulpsBetween(Number.NaN, 1)).toBeNaN();
    expect(ulpsBetween(1, Number.POSITIVE_INFINITY)).toBeNaN();
  });

  it('separates float non-convergence from real motion', () => {
    // The distinction the readout exists to draw. A quaternion component
    // re-derived each frame lands a few steps away; a body actually moving
    // across the screen is many orders more.
    const q = 0.8336940407752991;
    expect(ulpsBetween(q, q + 2 * Number.EPSILON * q)).toBeLessThan(16);
    expect(ulpsBetween(q, q + 1e-9)).toBeGreaterThan(1e6);
  });
});
