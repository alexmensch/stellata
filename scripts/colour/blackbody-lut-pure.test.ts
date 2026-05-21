import { describe, expect, it } from 'vitest';
import {
  BV_MAX,
  BV_MIN,
  TEFF_AT_BV_MAX,
  TEFF_AT_BV_MIN,
  ballesterosBvFromTeff,
  ballesterosTeff,
  teffToLutT,
} from './blackbody-lut-pure';

// ---- Inverse Ballesteros round-trip -----------------------------------

describe('ballesterosBvFromTeff', () => {
  it.each([
    ['Sol', 5778.42, 0.65],
    ['Sirius A (B-V ≈ 0)', 10125.24, 0.0],
    ['Antares (B-V ≈ 1.83)', ballesterosTeff(1.83), 1.83],
    ['Mintaka (B-V ≈ -0.17)', ballesterosTeff(-0.17), -0.17],
    ['LUT hot end', TEFF_AT_BV_MIN, BV_MIN],
    ['LUT cool end', TEFF_AT_BV_MAX, BV_MAX],
  ])('%s: %f K → B-V = %f within 1e-3', (_name, teff, expectedBv) => {
    expect(ballesterosBvFromTeff(teff)).toBeCloseTo(expectedBv, 3);
  });

  it('round-trips a dense B-V sweep within 1e-6', () => {
    for (let bv = -0.4; bv <= 2.0; bv += 0.05) {
      const teff = ballesterosTeff(bv);
      const bvBack = ballesterosBvFromTeff(teff);
      expect(bvBack).toBeCloseTo(bv, 6);
    }
  });
});

// ---- teffToLutT clamps ------------------------------------------------

describe('teffToLutT', () => {
  it('Teff at LUT hot end (BV_MIN) → t = 0', () => {
    expect(teffToLutT(TEFF_AT_BV_MIN)).toBeCloseTo(0, 6);
  });

  it('Teff at LUT cool end (BV_MAX) → t = 1', () => {
    expect(teffToLutT(TEFF_AT_BV_MAX)).toBeCloseTo(1, 6);
  });

  it('Sol-Teff lands near t = (0.65 + 0.4) / 2.4', () => {
    // bv = 0.65 → t = 1.05 / 2.4 = 0.4375
    expect(teffToLutT(5778.42)).toBeCloseTo(0.4375, 3);
  });

  it('WD-hot Teff (60000 K, above LUT range) clamps to 0', () => {
    expect(teffToLutT(60000)).toBe(0);
  });

  it('cool brown-dwarf Teff (2000 K, below LUT range) clamps to 1', () => {
    expect(teffToLutT(2000)).toBe(1);
  });
});
