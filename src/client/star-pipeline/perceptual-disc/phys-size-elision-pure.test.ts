import { describe, expect, it } from 'vitest';
import {
  POINT_SOURCE_FLAT_PEAK_DIAMETER_PX, pointSourcePeakLuminance,
} from '../../hdr/emission/emission-pure';
import { PHYS_RATIO_THRESHOLD } from '../local-pass/star-local-cluster-pure';
import { perceptualAppSizePx, perceptualDiscExponent, perceptualDmEff } from './perceptual-disc-pure';
import { DISC_EXPONENT_TOLERANCE, physSizeElisionBoundPx } from './phys-size-elision-pure';

const SIZE_MIN = 2.592;
const SIZE_MAX = 9.9448;
const SPAN = 8;
const KNEE = 16;
const DIST_N_MIN = 2.2;
const DIST_N_MAX = 10;
const LUM_BIAS = 1;

const shippedBound = () => physSizeElisionBoundPx(SIZE_MIN, DIST_N_MIN, DIST_N_MAX);

describe('physSizeElisionBoundPx', () => {
  it('is the exponent term at the shipped uniforms, far inside the other two', () => {
    const bound = shippedBound();
    expect(bound).toBeCloseTo(0.019869, 6);
    expect(bound).toBeLessThan(SIZE_MIN * PHYS_RATIO_THRESHOLD);
    expect(bound).toBeLessThan(POINT_SOURCE_FLAT_PEAK_DIAMETER_PX);
  });

  it('leaves the peak bit-identical when physSize is pinned to zero', () => {
    const bound = shippedBound();
    for (const m of [-5, 0, 6, 11]) {
      expect(pointSourcePeakLuminance(1, m, bound / 2))
        .toBe(pointSourcePeakLuminance(1, m, 0));
    }
  });

  it('leaves pxSize and the tier exact, since appSize never falls below uSizeMin', () => {
    const bound = shippedBound();
    for (const appMag of [-5, 0, 4, 7.8]) {
      const appSize = perceptualAppSizePx(
        perceptualDmEff(appMag, 7.8, SPAN, KNEE), SIZE_MIN, SIZE_MAX, SPAN);
      expect(Math.max(appSize, bound)).toBe(appSize);
      expect(bound / Math.max(appSize, bound)).toBeLessThan(PHYS_RATIO_THRESHOLD);
    }
  });

  it('holds the exponent inside the tolerance at the bound', () => {
    const bound = shippedBound();
    const physRatio = bound / SIZE_MIN;
    const gated = perceptualDiscExponent(0, 0, DIST_N_MIN, DIST_N_MAX, LUM_BIAS, LUM_BIAS);
    const truth = perceptualDiscExponent(
      0, physRatio, DIST_N_MIN, DIST_N_MAX, LUM_BIAS, LUM_BIAS);
    expect(Math.abs(truth / gated - 1)).toBeLessThanOrEqual(DISC_EXPONENT_TOLERANCE);
  });

  it('tracks uSizeMin, so a floored exaggeration K widens it proportionally', () => {
    expect(physSizeElisionBoundPx(SIZE_MIN * 4, DIST_N_MIN, DIST_N_MAX))
      .toBeCloseTo(shippedBound() * 4, 10);
  });

  it('disables the elision rather than widening it on a degenerate distN', () => {
    expect(physSizeElisionBoundPx(SIZE_MIN, 0, DIST_N_MAX)).toBe(0);
    expect(physSizeElisionBoundPx(SIZE_MIN, 5, 1)).toBeGreaterThan(0);
  });

  it('falls back to the peak and tiering terms when distN cannot move', () => {
    expect(physSizeElisionBoundPx(SIZE_MIN, 4, 4))
      .toBe(POINT_SOURCE_FLAT_PEAK_DIAMETER_PX);
  });
});
