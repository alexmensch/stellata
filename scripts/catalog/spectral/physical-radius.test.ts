import { describe, it, expect } from 'vitest';
import { SOLAR_BV_FALLBACK, type ApsisRow } from '../catalog-pure';
import {
  SPECTRAL_UNKNOWN,
  classifyFromSimbad,
  type SpectralInfo,
} from './spectral-classify';
import {
  absmagFromSpectral,
  boloCorr,
  physicalRadius,
  resolveApsisTeff,
  spectralClassCi,
  spectralClassColorIsDerivable,
  spectralFromAbsmag,
  tempKelvin,
} from './physical-radius';

describe('spectralClassCi', () => {
  it('derives a hot-blue B−V for an early-type class (tier 4)', () => {
    const ci = spectralClassCi(classifyFromSimbad('B2V')!);
    expect(ci).toBeLessThan(0); // blue
    expect(ci).not.toBe(SOLAR_BV_FALLBACK);
  });

  it('derives a cool-red B−V for a late-type class (tier 4)', () => {
    const ci = spectralClassCi(classifyFromSimbad('M2V')!);
    expect(ci).toBeGreaterThan(1); // red
  });

  it('routes a white dwarf through its Sion Teff (tier 5)', () => {
    const ci = spectralClassCi(classifyFromSimbad('DA2')!);
    // 50400/2 = 25200 K → deep blue, distinct from the solar fallback.
    expect(ci).toBeLessThan(0);
    expect(ci).not.toBe(SOLAR_BV_FALLBACK);
  });

  it('falls back to solar for an unparseable / unknown class (tier 6)', () => {
    expect(spectralClassCi(SPECTRAL_UNKNOWN)).toBe(SOLAR_BV_FALLBACK);
  });

  it('spectralClassColorIsDerivable gates the tier-4/5 bake from the fallback', () => {
    // The ciSpectralDerived counter reads this, not `ci !== 0.65` — a
    // parseable class landing exactly on the fallback value must still
    // count as derived.
    expect(spectralClassColorIsDerivable(classifyFromSimbad('G2V')!)).toBe(true);
    expect(spectralClassColorIsDerivable(classifyFromSimbad('DA2')!)).toBe(true);
    expect(spectralClassColorIsDerivable(SPECTRAL_UNKNOWN)).toBe(false);
  });
});

describe('tempKelvin', () => {
  function info(classIdx: number, subclass: number, lumClass = 2): SpectralInfo {
    return { classIdx, subclass, lumClass, isWhiteDwarf: false, wdSubclass: 0 };
  }

  it('returns Sun-like temperature for G2 (~5778 K target)', () => {
    // Sun is G2V — interpolated table value should be in the right neighbourhood.
    const T = tempKelvin(info(4, 2));
    expect(T).toBeGreaterThan(5500);
    expect(T).toBeLessThan(6000);
  });

  it('is hotter for O than for B than for A...', () => {
    // Spectral class O is the hottest, M the coolest. Monotone non-increasing
    // along the canonical OBAFGKM order (subclass=5 across the board).
    const Ts = [0, 1, 2, 3, 4, 5, 6].map(c => tempKelvin(info(c, 5)));
    for (let i = 1; i < Ts.length; i++) {
      expect(Ts[i]).toBeLessThan(Ts[i - 1]);
    }
  });

  it('white dwarf temperature scales as 50400 / wdSubclass', () => {
    const wd: SpectralInfo = { classIdx: 8, subclass: 5, lumClass: 0, isWhiteDwarf: true, wdSubclass: 2 };
    expect(tempKelvin(wd)).toBeCloseTo(25200, 1);

    const wd5: SpectralInfo = { ...wd, wdSubclass: 5 };
    expect(tempKelvin(wd5)).toBeCloseTo(10080, 1);
  });

  it('uses the unknown-class neutral table when classIdx is out of range', () => {
    // classIdx=999 → falls back to T_TABLE[8] (5000 K flat).
    expect(tempKelvin(info(999, 5))).toBe(5000);
  });

  it('routes Wolf-Rayets through the WR table, not the carbon-star row', () => {
    expect(tempKelvin(classifyFromSimbad('WN5')!)).toBe(75000);
    expect(tempKelvin(classifyFromSimbad('WN2-w')!)).toBe(114000);
    // Carbon stars keep the cool row.
    expect(tempKelvin(classifyFromSimbad('C5,2e')!)).toBe(3000);
  });
});

describe('physicalRadius', () => {
  function info(classIdx: number, subclass: number, lumClass = 2): SpectralInfo {
    return { classIdx, subclass, lumClass, isWhiteDwarf: false, wdSubclass: 0 };
  }

  it('returns ~1 R☉ for the Sun (G2V, absmag=4.83)', () => {
    // Sun is the calibration point of the whole magnitude system. Within
    // ~10% of 1.0 R☉ is the contract — the table-based BC introduces some
    // play but the answer must round-trip near unity.
    const R = physicalRadius(4.83, info(4, 2));
    expect(R).toBeGreaterThan(0.9);
    expect(R).toBeLessThan(1.2);
  });

  it('returns a tiny radius for white dwarfs (~0.013 R☉, hardcoded)', () => {
    const wd: SpectralInfo = { classIdx: 8, subclass: 5, lumClass: 0, isWhiteDwarf: true, wdSubclass: 2 };
    // WDs ignore absmag and return a fixed small radius — the catalog's
    // absmag for WDs doesn't translate reliably into physical radius via
    // Stefan-Boltzmann.
    expect(physicalRadius(11, wd)).toBeCloseTo(0.013, 5);
    expect(physicalRadius(0, wd)).toBeCloseTo(0.013, 5);
  });

  it('produces a much larger radius for a supergiant than for the Sun', () => {
    // Betelgeuse-ish: M2 supergiant, absmag ≈ -5.85. Stefan-Boltzmann gives
    // the very large radius the chart-mode disc relies on.
    const big = physicalRadius(-5.85, info(6, 2, 7));
    const sun = physicalRadius(4.83, info(4, 2));
    expect(big).toBeGreaterThan(sun * 100);
  });

  it('clamps absurdly bright catalog rows to the upper bound', () => {
    // absmag=-30 is unphysical (pre-cap luminosity ≈ 10^14 L☉). The clamp
    // should saturate at 2500 R☉ rather than letting the ratio explode.
    const R = physicalRadius(-30, info(0, 0));
    expect(R).toBeLessThanOrEqual(2500);
  });

  it('clamps absurdly dim catalog rows to the lower bound', () => {
    // absmag=+30 makes L tiny; without the floor, R would underflow toward 0.
    // Lower clamp keeps red-dwarf-ish minimum so renderable.
    const R = physicalRadius(30, info(6, 9));
    expect(R).toBeGreaterThanOrEqual(0.08);
  });

  it('sizes γ² Vel at combined-light order, not the 2077 R☉ carbon artefact', () => {
    // WC8+O7.5III-V at the corpus absmag −6.001 → the O giant's ~19 R☉
    // (published: WC8 ~6 R☉ + O7.5 ~17 R☉).
    const R = physicalRadius(-6.001, classifyFromSimbad('WC8+O7.5III-V')!);
    expect(R).toBeCloseTo(19.15, 2);
  });

  it('sizes a single WN5 as a compact hot star', () => {
    const R = physicalRadius(-4.0, classifyFromSimbad('WN5')!);
    expect(R).toBeCloseTo(2.1, 1);
  });

  it('sizes off a measured Apsis Teff when supplied (GSP-Spec-tier shape)', () => {
    // A real K0 star classified letter-only lands on subclass 5
    // (T_TABLE 4410 K); its measured Teff 5150 K must win. R ∝ T⁻² so
    // the ratio is exact for a fixed absmag + BC.
    const gspspecK = info(5, 5, 255);
    const tableR = physicalRadius(5.9, gspspecK);
    const apsisR = physicalRadius(5.9, gspspecK, 5150);
    expect(apsisR).toBeCloseTo(tableR * (4410 / 5150) ** 2, 6);
  });

  it('ignores the Teff override for white dwarfs and Wolf-Rayets', () => {
    const wd: SpectralInfo = { classIdx: 8, subclass: 5, lumClass: 0, isWhiteDwarf: true, wdSubclass: 2 };
    expect(physicalRadius(11, wd, 5000)).toBeCloseTo(0.013, 5);
    const wr = classifyFromSimbad('WN5')!;
    expect(physicalRadius(-4.0, wr, 5000)).toBeCloseTo(physicalRadius(-4.0, wr), 9);
  });
});

describe('resolveApsisTeff', () => {
  const APSIS_NONE: ApsisRow = {
    teffGspphot: null, loggGspphot: null, mhGspphot: null, azeroGspphot: null,
    teffGspspec: null, loggGspspec: null, mhGspspec: null, spectraltypeEsphs: null,
  };

  it('prefers gspphot, falls back to gspspec', () => {
    expect(resolveApsisTeff({ ...APSIS_NONE, teffGspphot: 5150, teffGspspec: 4900 })).toBe(5150);
    expect(resolveApsisTeff({ ...APSIS_NONE, teffGspspec: 4900 })).toBe(4900);
  });

  it('rejects out-of-window values per solution, absent rows, and null', () => {
    // gspphot outside the window falls through to a valid gspspec.
    expect(resolveApsisTeff({ ...APSIS_NONE, teffGspphot: 1500, teffGspspec: 3400 })).toBe(3400);
    expect(resolveApsisTeff({ ...APSIS_NONE, teffGspphot: 70000 })).toBeNull();
    expect(resolveApsisTeff(APSIS_NONE)).toBeNull();
    expect(resolveApsisTeff(null)).toBeNull();
    expect(resolveApsisTeff(undefined)).toBeNull();
  });
});

describe('boloCorr', () => {
  function info(classIdx: number, subclass: number, lumClass = 2): SpectralInfo {
    return { classIdx, subclass, lumClass, isWhiteDwarf: false, wdSubclass: 0 };
  }

  it('is near zero for solar-type stars', () => {
    // BC for G2V should be a few hundredths — the Sun is the reference.
    expect(Math.abs(boloCorr(info(4, 2)))).toBeLessThan(0.5);
  });

  it('is strongly negative for hot O-class stars (UV-rich)', () => {
    expect(boloCorr(info(0, 0))).toBeLessThan(-3);
  });

  it('is strongly negative for cool M-class stars (IR-rich)', () => {
    expect(boloCorr(info(6, 9))).toBeLessThan(-3);
  });
});

describe('absmagFromSpectral', () => {
  const mv = (spect: string) => absmagFromSpectral(classifyFromSimbad(spect)!);

  it('pins main-sequence anchors (Pecaut & Mamajek 2013)', () => {
    expect(mv('G2V')).toBeCloseTo(4.68, 2);
    expect(mv('K0V')).toBeCloseTo(5.9, 2);
    expect(mv('M1V')).toBeCloseTo(9.5, 2);
    expect(mv('B8V')).toBeCloseTo(0.0, 2);
  });

  it('subgiants sit at the V/III midpoint — Algol Aa2 (K0IV) lands near +2.9 published', () => {
    expect(mv('K0IV')).toBeCloseTo(3.3, 2);
  });

  it('giants read the III table', () => {
    expect(mv('K0III')).toBeCloseTo(0.7, 2);
    expect(mv('G5III')).toBeCloseTo(0.9, 2);
  });

  it('supergiants use per-luminosity-class constants', () => {
    expect(mv('K2II')).toBeCloseTo(-2.3, 2);
    expect(mv('B5Ib')).toBeCloseTo(-4.5, 2);
    expect(mv('M2Iab')).toBeCloseTo(-6.0, 2);
    expect(mv('A0Ia')).toBeCloseTo(-7.5, 2);
  });

  it('unknown luminosity class defaults to main sequence', () => {
    expect(absmagFromSpectral(
      { classIdx: 5, subclass: 0, lumClass: 255, isWhiteDwarf: false, wdSubclass: 0 },
    )).toBeCloseTo(5.9, 2);
  });

  it('returns null where a single calibration would be fiction', () => {
    expect(mv('DA1.9')).toBeNull();                      // white dwarf
    expect(mv('C5,2e')).toBeNull();                      // carbon
    expect(absmagFromSpectral(SPECTRAL_UNKNOWN)).toBeNull();
  });
});

describe('spectralFromAbsmag', () => {
  it('inverts the MS calibration at the table anchors', () => {
    expect(spectralFromAbsmag(0.65)).toMatchObject({ classIdx: 2, lumClass: 2 });
    expect(spectralFromAbsmag(0.65).subclass).toBeCloseTo(0, 5);   // A0
    expect(spectralFromAbsmag(1.9).subclass).toBeCloseTo(5, 5);    // A5
    const g5 = spectralFromAbsmag(5.1);
    expect(g5.classIdx).toBe(4);
    expect(g5.subclass).toBeCloseTo(5, 5);                          // G5
  });

  it('lands Algol Ab (own M_V ~2.2) in the A range, not the inherited B8', () => {
    const info = spectralFromAbsmag(2.225);
    expect(info.classIdx).toBe(2);
    expect(info.subclass).toBeCloseTo(7, 0);
  });

  it('clamps outside the [O0, M9] span', () => {
    expect(spectralFromAbsmag(-9)).toMatchObject({ classIdx: 0, subclass: 0 });
    expect(spectralFromAbsmag(20)).toMatchObject({ classIdx: 6, subclass: 9 });
  });

  it('round-trips through absmagFromSpectral inside every class span', () => {
    for (const mv of [-5.0, -2.0, 1.0, 3.1, 4.9, 6.6, 12.0]) {
      const back = absmagFromSpectral(spectralFromAbsmag(mv));
      expect(back).not.toBeNull();
      expect(back!).toBeCloseTo(mv, 6);
    }
  });
});
