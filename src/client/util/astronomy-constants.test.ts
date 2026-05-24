import { describe, expect, it } from 'vitest';
import {
  ARCSEC_TO_RAD,
  AU_KM,
  AU_PC,
  AU_PER_PC,
  DAYS_PER_JULIAN_YEAR,
  J2000_JD,
  KM_PC,
  R_SUN_PC,
} from './astronomy-constants';

describe('astronomy-constants', () => {
  it('AU_PER_PC matches the IAU 2015 parsec definition', () => {
    expect(AU_PER_PC).toBe(206264.80624709636);
    // 1 pc = 648000/π AU. Verify against the first-principles definition.
    expect(AU_PER_PC).toBeCloseTo(648000 / Math.PI, 9);
  });

  it('AU_PC is the reciprocal of AU_PER_PC', () => {
    expect(AU_PC).toBe(1 / 206264.80624709636);
    expect(AU_PER_PC * AU_PC).toBeCloseTo(1, 15);
  });

  it('AU_KM is the IAU 2012 exact value', () => {
    expect(AU_KM).toBe(1.495978707e8);
  });

  it('KM_PC composes AU_PC and AU_KM', () => {
    expect(KM_PC).toBe(AU_PC / AU_KM);
  });

  it('R_SUN_PC is one solar radius in parsecs', () => {
    expect(R_SUN_PC).toBe(2.2543e-8);
  });

  it('ARCSEC_TO_RAD matches 1 / AU_PER_PC (1 AU subtends 1 arcsec at 1 pc)', () => {
    expect(ARCSEC_TO_RAD).toBe(Math.PI / (180.0 * 3600.0));
    expect(ARCSEC_TO_RAD).toBeCloseTo(AU_PC, 15);
  });

  it('J2000_JD is the IAU J2000.0 epoch', () => {
    expect(J2000_JD).toBe(2451545.0);
  });

  it('DAYS_PER_JULIAN_YEAR is 365.25', () => {
    expect(DAYS_PER_JULIAN_YEAR).toBe(365.25);
  });
});
