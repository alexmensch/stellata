import { describe, expect, it } from 'vitest';
import {
  BASE_EPOCH_EXPOSURE,
  UNAIDED_EYE,
  epochExposure,
  exposureForMagLimit,
} from './exposure-epoch';
import { luminanceForMagnitude } from './emission-pure';
import { L_THRESH } from './tonemap-pure';
import { MAG_PRESETS, NAKED_EYE_LIMIT_MAG, type MagPresetName } from '../filters/filter-state';

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

describe('epochExposure', () => {
  it('is the plain magnitude-limit exposure for the unaided eye', () => {
    expect(UNAIDED_EYE).toEqual({ exposureMul: 1, angularMag: 1 });
    for (const mLim of [-2, 0, 6.5, 10.5, 15]) {
      expect(epochExposure(mLim)).toBe(exposureForMagLimit(mLim));
      expect(epochExposure(mLim, UNAIDED_EYE)).toBe(exposureForMagLimit(mLim));
    }
  });

  it('grounds the base epoch on the naked-eye limit', () => {
    expect(BASE_EPOCH_EXPOSURE).toBe(epochExposure(NAKED_EYE_LIMIT_MAG));
    expect(BASE_EPOCH_EXPOSURE).toBe(epochExposure(MAG_PRESETS['naked-eye'].maxAppMag));
  });

  it('multiplies the epoch by the instrument aperture gain', () => {
    // 50 mm binoculars over a 7 mm pupil: (50/7)² ≈ 51× ≈ 4.3 mag.
    const gain = (50 / 7) ** 2;
    expect(epochExposure(6.5, { exposureMul: gain, angularMag: 10 })).toBeCloseTo(
      BASE_EPOCH_EXPOSURE * gain,
      9,
    );
    expect(epochExposure(6.5, { exposureMul: gain, angularMag: 10 })).toBeCloseTo(
      exposureForMagLimit(6.5 + 2.5 * Math.log10(gain)),
      9,
    );
  });

  it('gives each magnitude preset a distinct, monotonically rising exposure', () => {
    const order: MagPresetName[] = ['naked-eye', 'binoculars', 'all'];
    const exposures = order.map((name) => epochExposure(MAG_PRESETS[name].maxAppMag));
    expect(exposures).toEqual([...exposures].sort((a, b) => a - b));
    expect(new Set(exposures).size).toBe(order.length);
    expect(exposures[0]).toBeCloseTo(7.9621, 4);
    expect(exposures[1]).toBeCloseTo(316.98, 2);
    expect(exposures[2]).toBeCloseTo(20000, 6);
  });
});
