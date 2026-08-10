import { describe, expect, it } from 'vitest';

import {
  GAIA_PHOTOMETRY_SATURATION_G,
  calibratedPhotometry,
  polynomial,
} from './gaia-photometry-pure';
import { photometry } from './photometry-fixture';

describe('polynomial', () => {
  // Both published relations are transcribed in ascending powers, so a
  // descending evaluation would silently return a different curve rather
  // than fail — this is the one place that ordering is asserted.
  it('evaluates in ascending powers of x', () => {
    expect(polynomial([1, 10, 100], 2)).toBe(1 + 10 * 2 + 100 * 4);
  });

  it('returns the constant term at zero', () => {
    expect(polynomial([7, -3, 2], 0)).toBe(7);
  });

  it('returns zero for an empty coefficient list', () => {
    expect(polynomial([], 3)).toBe(0);
  });
});

describe('calibratedPhotometry', () => {
  it('returns G and the colour together for a well-measured source', () => {
    const calibrated = calibratedPhotometry(photometry())!;
    expect(calibrated.gMag).toBe(10);
    expect(calibrated.bpMinusRp).toBeCloseTo(0.8, 12);
  });

  it('rejects a null row, a missing band and a non-finite band', () => {
    expect(calibratedPhotometry(null)).toBeNull();
    expect(calibratedPhotometry(photometry({ bpMag: null }))).toBeNull();
    expect(calibratedPhotometry(photometry({ rpMag: NaN }))).toBeNull();
  });

  it('rejects a saturated source, accepting exactly at the bound', () => {
    const atBound = GAIA_PHOTOMETRY_SATURATION_G;
    expect(calibratedPhotometry(photometry({ gMag: atBound }))).not.toBeNull();
    expect(calibratedPhotometry(photometry({ gMag: atBound - 0.001 }))).toBeNull();
  });
});
