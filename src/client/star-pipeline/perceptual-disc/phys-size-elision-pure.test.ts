import { describe, expect, it } from 'vitest';
import {
  POINT_SOURCE_FLAT_PEAK_DIAMETER_PX, pointSourcePeakLuminance,
} from '../../hdr/emission/emission-pure';
import {
  DEFAULT_INSTRUMENT, INSTRUMENTS, STAR_RENDER_DEFAULTS, starPxSizes,
} from '../../filters/filter-state';
import { PHYS_RATIO_THRESHOLD } from '../local-pass/star-local-cluster-pure';
import { perceptualAppSizePx, perceptualDiscExponent, perceptualDmEff } from './perceptual-disc-pure';
import { DISC_EXPONENT_TOLERANCE, physSizeElisionBoundPx } from './phys-size-elision-pure';

// The vantage README.md § Eliding the physical-size branch quotes its
// measured figures at.
const FOV_DEG = 50;
const VIEWPORT_H = 1000;
const { sizeMinPx: SIZE_MIN, sizeMaxPx: SIZE_MAX } =
  starPxSizes(DEFAULT_INSTRUMENT, FOV_DEG, VIEWPORT_H, 1);
const SPAN = INSTRUMENTS[DEFAULT_INSTRUMENT].sizeSpan;
const { distNMin: DIST_N_MIN, distNMax: DIST_N_MAX, sizeKnee: KNEE } = STAR_RENDER_DEFAULTS;

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
    const gated = perceptualDiscExponent(0, 0, DIST_N_MIN, DIST_N_MAX, 1, 1);
    const truth = perceptualDiscExponent(
      0, physRatio, DIST_N_MIN, DIST_N_MAX, 1, 1);
    expect(truth / gated - 1).toBeCloseTo(0.0024744, 7);
    expect(Math.abs(truth / gated - 1)).toBeLessThanOrEqual(DISC_EXPONENT_TOLERANCE);
  });

  it('measures that movement independently of the luminosity-class bias', () => {
    // perceptualDiscExponent returns distN · lumBias, so the bias cancels
    // in the ratio — which is what lets every case here pass 1, 1.
    const physRatio = shippedBound() / SIZE_MIN;
    const ratioAt = (lo: number, hi: number) => perceptualDiscExponent(
      0.7, physRatio, DIST_N_MIN, DIST_N_MAX, lo, hi)
      / perceptualDiscExponent(0.7, 0, DIST_N_MIN, DIST_N_MAX, lo, hi);
    expect(ratioAt(STAR_RENDER_DEFAULTS.lumBiasMin, STAR_RENDER_DEFAULTS.lumBiasMax))
      .toBeCloseTo(ratioAt(1, 1), 12);
  });

  it('needs no tiering term: the exponent term never exceeds it', () => {
    for (const sizeMin of [0.5, SIZE_MIN, 12, 80]) {
      for (const lo of [0, 1, 4, 9]) {
        for (const hi of [0, 1, 4, 9, 30]) {
          expect(physSizeElisionBoundPx(sizeMin, lo, hi))
            .toBeLessThanOrEqual(sizeMin * PHYS_RATIO_THRESHOLD);
        }
      }
    }
  });

  it('tracks uSizeMin, so a floored exaggeration K widens it proportionally', () => {
    expect(physSizeElisionBoundPx(SIZE_MIN * 4, DIST_N_MIN, DIST_N_MAX))
      .toBeCloseTo(shippedBound() * 4, 10);
  });

  it('disables the elision rather than widening it on a degenerate distN', () => {
    expect(physSizeElisionBoundPx(SIZE_MIN, 0, DIST_N_MAX)).toBe(0);
    expect(physSizeElisionBoundPx(SIZE_MIN, 5, 1)).toBeGreaterThan(0);
  });

  it('falls back to the peak term alone when distN cannot move', () => {
    expect(physSizeElisionBoundPx(SIZE_MIN, 4, 4))
      .toBe(POINT_SOURCE_FLAT_PEAK_DIAMETER_PX);
  });
});
