import { describe, expect, it } from 'vitest';
import {
  BV_MAX,
  BV_MIN,
  ballesterosBvFromTeff,
  ballesterosTeff,
} from './blackbody-lut-pure';

describe('ballesterosBvFromTeff', () => {
  it.each([
    ['Sol', 5778.42, 0.65],
    ['Sirius A (B-V ≈ 0)', 10125.24, 0.0],
    ['Antares (B-V ≈ 1.83)', ballesterosTeff(1.83), 1.83],
    ['Mintaka (B-V ≈ -0.17)', ballesterosTeff(-0.17), -0.17],
    ['LUT hot end', ballesterosTeff(BV_MIN), BV_MIN],
    ['LUT cool end', ballesterosTeff(BV_MAX), BV_MAX],
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
