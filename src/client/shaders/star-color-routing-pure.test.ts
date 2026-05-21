import { describe, expect, it } from 'vitest';
import {
  bestApsisTeff,
  NO_APSIS_TEFF,
  pickTeffSource,
  SOLAR_BV_FALLBACK,
  type ColorRoutingRecord,
} from './star-color-routing-pure';
import { ballesterosTeff } from '../../../scripts/colour/blackbody-lut-pure';
import { parseSpectral } from '../../../scripts/catalog/catalog-pure';

// ---- Per-tier coverage ------------------------------------------------

const SPECTRAL_G5V = parseSpectral('G5V');
const SPECTRAL_WD_DA2 = parseSpectral('DA2');
const SPECTRAL_UNPARSEABLE = parseSpectral('???');

function record(over: Partial<ColorRoutingRecord> = {}): ColorRoutingRecord {
  return {
    teffGspphot: null,
    teffGspspec: null,
    bv: null,
    spectralInfo: null,
    ...over,
  };
}

describe('pickTeffSource — six-tier priority', () => {
  it('tier 1: Apsis gspphot wins when present', () => {
    const pick = pickTeffSource(record({
      teffGspphot: 5800,
      teffGspspec: 5500,
      bv: 0.65,
      spectralInfo: SPECTRAL_G5V,
    }));
    expect(pick.source).toBe('apsis-phot');
    expect(pick.teff).toBe(5800);
  });

  it('tier 2: Apsis gspspec when gspphot is absent', () => {
    const pick = pickTeffSource(record({
      teffGspphot: null,
      teffGspspec: 5500,
      bv: 0.65,
      spectralInfo: SPECTRAL_G5V,
    }));
    expect(pick.source).toBe('apsis-spec');
    expect(pick.teff).toBe(5500);
  });

  it('tier 3: Ballesteros(B-V) when no Apsis', () => {
    const pick = pickTeffSource(record({ bv: 0.65, spectralInfo: SPECTRAL_G5V }));
    expect(pick.source).toBe('ballesteros');
    expect(pick.teff).toBeCloseTo(5778.42, 2);
  });

  it('tier 4: spectral T_TABLE when no Apsis and no B-V', () => {
    const pick = pickTeffSource(record({ spectralInfo: SPECTRAL_G5V }));
    expect(pick.source).toBe('spectral');
    expect(pick.teff).toBe(5560);
  });

  it('tier 5: WD Sion Teff when WD spectral class and no Apsis/B-V', () => {
    const pick = pickTeffSource(record({ spectralInfo: SPECTRAL_WD_DA2 }));
    expect(pick.source).toBe('wd');
    expect(pick.teff).toBe(50400 / 2);
  });

  it('tier 6: solar fallback when no Apsis, no B-V, no spectral info', () => {
    const pick = pickTeffSource(record());
    expect(pick.source).toBe('solar');
    expect(pick.teff).toBeCloseTo(ballesterosTeff(SOLAR_BV_FALLBACK), 6);
  });

  it('tier 6: solar fallback when spectral info parses to unknown class', () => {
    const pick = pickTeffSource(record({ spectralInfo: SPECTRAL_UNPARSEABLE }));
    expect(pick.source).toBe('solar');
  });
});

// ---- Priority semantics ------------------------------------------------

describe('pickTeffSource — priority asserts', () => {
  it('Apsis-phot beats Ballesteros even when B-V also present', () => {
    const pick = pickTeffSource(record({ teffGspphot: 4500, bv: 0.65 }));
    expect(pick.source).toBe('apsis-phot');
  });

  it('Apsis-spec beats Ballesteros even when B-V also present', () => {
    const pick = pickTeffSource(record({ teffGspspec: 4500, bv: 0.65 }));
    expect(pick.source).toBe('apsis-spec');
  });

  it('Ballesteros beats spectral fallback when B-V present alongside spectral info', () => {
    const pick = pickTeffSource(record({ bv: 0.65, spectralInfo: SPECTRAL_G5V }));
    expect(pick.source).toBe('ballesteros');
  });

  it('WD spectral info beats solar fallback when no B-V', () => {
    const pick = pickTeffSource(record({ spectralInfo: SPECTRAL_WD_DA2 }));
    expect(pick.source).toBe('wd');
  });

  it('Apsis Teff <= 0 is treated as missing — falls through to next tier', () => {
    const pick = pickTeffSource(record({
      teffGspphot: 0,
      teffGspspec: -1,
      bv: 0.65,
    }));
    expect(pick.source).toBe('ballesteros');
  });
});

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
