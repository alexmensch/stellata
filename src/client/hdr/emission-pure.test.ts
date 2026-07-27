import { describe, expect, it } from 'vitest';
import {
  BASE_EPOCH_EXPOSURE,
  LUMA_CEIL,
  exposureForMagLimit,
  luminanceForMagnitude,
  pointSourcePeakLuminance,
} from './emission-pure';
import { L_THRESH, reinhardExtended, tonemapWhitePoint } from './tonemap-pure';

describe('exposureForMagLimit', () => {
  it('lands the base epoch on the design gate value', () => {
    expect(BASE_EPOCH_EXPOSURE).toBeCloseTo(7.9621, 4);
  });

  it('puts a source at the limit exactly on L_THRESH', () => {
    for (const mLim of [6.5, 10.5, 15]) {
      expect(luminanceForMagnitude(exposureForMagLimit(mLim), mLim)).toBeCloseTo(
        L_THRESH,
        12,
      );
    }
  });

  it('matches the preset table in docs/science-hdr-pipeline.md § 3', () => {
    expect(exposureForMagLimit(10.5)).toBeCloseTo(316.98, 2);
    expect(exposureForMagLimit(15)).toBeCloseTo(20000, 6);
  });

  it('is one magnitude per 10^0.4 of exposure', () => {
    expect(exposureForMagLimit(7.5) / exposureForMagLimit(6.5)).toBeCloseTo(
      10 ** 0.4,
      12,
    );
  });
});

// The § 1 range budget, at the naked-eye epoch. These are the numbers
// H7 validates the star field against, so they are pinned rather than
// bounded.
describe('luminanceForMagnitude at the base epoch', () => {
  const cases: ReadonlyArray<[string, number, number]> = [
    ['threshold star', 6.5, 0.02],
    ['Vega', 0.0, 7.9621],
    ['Sirius', -1.46, 30.55],
  ];

  it.each(cases)('%s (m=%f) → L=%f', (_name, m, expected) => {
    expect(luminanceForMagnitude(BASE_EPOCH_EXPOSURE, m)).toBeCloseTo(expected, 2);
  });

  it('sends a source DR_MAG brighter than the limit to full white', () => {
    const white = luminanceForMagnitude(BASE_EPOCH_EXPOSURE, 6.5 - 7.5);
    expect(white).toBeCloseTo(tonemapWhitePoint(), 10);
    expect(reinhardExtended(white, tonemapWhitePoint())).toBeCloseTo(1, 12);
  });
});

describe('pointSourcePeakLuminance', () => {
  it('gives an unresolved source its whole flux at the peak', () => {
    for (const r of [0, 0.1, 0.5, 1 / Math.sqrt(Math.PI)]) {
      expect(pointSourcePeakLuminance(BASE_EPOCH_EXPOSURE, 3, r)).toBeCloseTo(
        luminanceForMagnitude(BASE_EPOCH_EXPOSURE, 3),
        12,
      );
    }
  });

  it('falls to surface brightness once the disc resolves', () => {
    const flux = luminanceForMagnitude(BASE_EPOCH_EXPOSURE, -1);
    expect(pointSourcePeakLuminance(BASE_EPOCH_EXPOSURE, -1, 10)).toBeCloseTo(
      flux / (Math.PI * 100),
      12,
    );
  });

  it('is continuous across the unresolved/resolved crossover', () => {
    const rCrossover = 1 / Math.sqrt(Math.PI);
    const below = pointSourcePeakLuminance(BASE_EPOCH_EXPOSURE, 2, rCrossover - 1e-9);
    const above = pointSourcePeakLuminance(BASE_EPOCH_EXPOSURE, 2, rCrossover + 1e-9);
    expect(above).toBeCloseTo(below, 7);
  });

  it('dims as the inverse square of the resolved radius', () => {
    const near = pointSourcePeakLuminance(BASE_EPOCH_EXPOSURE, -5, 20);
    const far = pointSourcePeakLuminance(BASE_EPOCH_EXPOSURE, -5, 40);
    expect(near / far).toBeCloseTo(4, 9);
  });

  it('clamps at LUMA_CEIL — Sol at 1 AU pins to white', () => {
    expect(pointSourcePeakLuminance(BASE_EPOCH_EXPOSURE, -26.7, 0)).toBe(LUMA_CEIL);
  });

  it('leaves fp16 headroom above the ceiling for additive accumulation', () => {
    const FP16_MAX = 65504;
    expect(FP16_MAX / LUMA_CEIL).toBeGreaterThan(15);
  });
});
