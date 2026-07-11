import { describe, expect, it } from 'vitest';
import { bestApsisTeff, NO_APSIS_TEFF } from './star-color-routing-pure';

// ---- bestApsisTeff (the shader-side per-instance picker) --------------

describe('bestApsisTeff', () => {
  it('prefers gspphot over gspspec when both finite', () => {
    expect(bestApsisTeff(5800, 5500)).toBe(5800);
  });

  it('falls back to gspspec when gspphot is the NaN sentinel', () => {
    expect(bestApsisTeff(NaN, 5500)).toBe(5500);
  });

  it('returns NO_APSIS_TEFF when neither solution is finite', () => {
    expect(bestApsisTeff(NaN, NaN)).toBe(NO_APSIS_TEFF);
  });

  it('rejects non-positive Teff values (corrupt data guard)', () => {
    expect(bestApsisTeff(0, 0)).toBe(NO_APSIS_TEFF);
    expect(bestApsisTeff(-1, 0)).toBe(NO_APSIS_TEFF);
  });
});
