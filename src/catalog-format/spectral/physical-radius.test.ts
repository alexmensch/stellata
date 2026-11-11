import { describe, it, expect } from 'vitest';
import { SOLAR_BV_FALLBACK, type ApsisRow } from '../record/catalog-pure';
import {
  SPECTRAL_UNKNOWN,
  classifyFromGspspec,
  classifyFromSimbad,
  type MkLumClass,
  type MkLetter,
  type SpectralInfo,
} from './spectral-classify';
import {
  NON_FINITE_LUMINOSITY_RADIUS_R_SUN,
  RADIUS_CEILING_R_SUN,
  RADIUS_FLOOR_R_SUN,
  WHITE_DWARF_RADIUS_R_SUN,
  absmagFromSpectral,
  boloCorr,
  physicalRadius,
  resolveApsisTeff,
  spectralClassCi,
  spectralClassColorIsDerivable,
  spectralFromAbsmag,
  tempKelvin,
} from './physical-radius';

function info(letter: MkLetter, subclass: number, lumClass: MkLumClass | null = 2): SpectralInfo {
  return { kind: 'mk', letter, subclass, lumClass };
}

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

  it('returns Sun-like temperature for G2 (~5778 K target)', () => {
    // Sun is G2V — interpolated table value should be in the right neighbourhood.
    const T = tempKelvin(info(4, 2));
    expect(T).toBeGreaterThan(5500);
    expect(T).toBeLessThan(6000);
  });

  it('is hotter for O than for B than for A...', () => {
    // Spectral class O is the hottest, M the coolest. Monotone non-increasing
    // along the canonical OBAFGKM order (subclass=5 across the board).
    const Ts = ([0, 1, 2, 3, 4, 5, 6] as const).map(c => tempKelvin(info(c, 5)));
    for (let i = 1; i < Ts.length; i++) {
      expect(Ts[i]).toBeLessThan(Ts[i - 1]);
    }
  });

  it('white dwarf temperature scales as 50400 / wdSubclass', () => {
    expect(tempKelvin({ kind: 'white-dwarf', wdSubclass: 2 })).toBeCloseTo(25200, 1);
    expect(tempKelvin({ kind: 'white-dwarf', wdSubclass: 5 })).toBeCloseTo(10080, 1);
  });

  it('reads the neutral 5000 K default for an unknown class', () => {
    expect(tempKelvin(SPECTRAL_UNKNOWN)).toBe(5000);
    expect(boloCorr(SPECTRAL_UNKNOWN)).toBe(0);
  });

  it('reads a class with no stated subclass at DEFAULT_SUBCLASS', () => {
    expect(tempKelvin(classifyFromGspspec('K')!)).toBe(4410);
    expect(tempKelvin(classifyFromGspspec('CSTAR')!)).toBe(3000);
  });

  it('routes Wolf-Rayets through the WR table, not the carbon-star row', () => {
    expect(tempKelvin(classifyFromSimbad('WN5')!)).toBe(75000);
    expect(tempKelvin(classifyFromSimbad('WN2-w')!)).toBe(114000);
    // Carbon stars keep the cool row.
    expect(tempKelvin(classifyFromSimbad('C5,2e')!)).toBe(3000);
  });
});

const rSun = (...args: Parameters<typeof physicalRadius>): number => physicalRadius(...args).rSun;

describe('physicalRadius', () => {

  it('returns ~1 R☉ for the Sun (G2V, absmag=4.83)', () => {
    // Sun is the calibration point of the whole magnitude system. Within
    // ~10% of 1.0 R☉ is the contract — the table-based BC introduces some
    // play but the answer must round-trip near unity.
    const R = rSun(4.83, info(4, 2));
    expect(R).toBeGreaterThan(0.9);
    expect(R).toBeLessThan(1.2);
  });

  it('sizes a white dwarf at the fixed typical radius, whatever its absmag', () => {
    const wd: SpectralInfo = { kind: 'white-dwarf', wdSubclass: 2 };
    expect(physicalRadius(11, wd)).toEqual({ route: 'white-dwarf', rSun: WHITE_DWARF_RADIUS_R_SUN, refusedTeff: null });
    expect(rSun(0, wd)).toBe(WHITE_DWARF_RADIUS_R_SUN);
  });

  it('produces a much larger radius for a supergiant than for the Sun', () => {
    // Betelgeuse-ish: M2 supergiant, absmag ≈ -5.85. Stefan-Boltzmann gives
    // the very large radius the chart-mode disc relies on.
    const big = rSun(-5.85, info(6, 2, 7));
    const sun = rSun(4.83, info(4, 2));
    expect(big).toBeGreaterThan(sun * 100);
  });

  it('clamps absurdly bright catalog rows to the ceiling and says so', () => {
    // absmag=-30 is unphysical (pre-cap luminosity ≈ 10^14 L☉).
    const r = physicalRadius(-30, info(0, 0));
    expect(r).toMatchObject({ route: 'class-teff', rSun: RADIUS_CEILING_R_SUN, clamp: 'ceiling' });
  });

  it('clamps absurdly dim catalog rows to the floor and says so', () => {
    const r = physicalRadius(30, info(6, 9));
    expect(r).toMatchObject({ route: 'class-teff', rSun: RADIUS_FLOOR_R_SUN, clamp: 'floor' });
  });

  it('names a luminosity no float can hold, and ships the 1 R☉ stand-in', () => {
    expect(physicalRadius(-2000, info(4, 2))).toEqual({
      route: 'non-finite-luminosity', rSun: NON_FINITE_LUMINOSITY_RADIUS_R_SUN, absmag: -2000,
    });
  });

  it('reports how the tables read the class index', () => {
    const route = (i: SpectralInfo) => physicalRadius(4.83, i);
    expect(route(info(4, 2))).toMatchObject({ route: 'class-teff', classIndex: 'stated', clamp: null, absmag: 4.83 });
    expect(route(classifyFromGspspec('K')!)).toMatchObject({ classIndex: 'default', teffK: 4410 });
    expect(route(SPECTRAL_UNKNOWN)).toMatchObject({ classIndex: 'unknown-class', teffK: 5000 });
  });

  it('sizes γ² Vel at combined-light order, not the 2077 R☉ carbon artefact', () => {
    // WC8+O7.5III-V at the corpus absmag −6.001 → the O giant's ~19 R☉
    // (published: WC8 ~6 R☉ + O7.5 ~17 R☉).
    const R = rSun(-6.001, classifyFromSimbad('WC8+O7.5III-V')!);
    expect(R).toBeCloseTo(19.15, 2);
  });

  it('sizes a single WN5 as a compact hot star', () => {
    const R = rSun(-4.0, classifyFromSimbad('WN5')!);
    expect(R).toBeCloseTo(2.1, 1);
  });

  it('sizes off a measured Apsis Teff when supplied (GSP-Spec-tier shape)', () => {
    // A real K0 star classified letter-only lands on subclass 5
    // (T_TABLE 4410 K); its measured Teff 5150 K must win. R ∝ T⁻² so
    // the ratio is exact for a fixed absmag + BC.
    const gspspecK = classifyFromGspspec('K')!;
    const tableR = rSun(5.9, gspspecK);
    const teff = { kelvin: 5150, solution: 'gspphot' } as const;
    const apsis = physicalRadius(5.9, gspspecK, teff);
    expect(apsis).toMatchObject({ route: 'apsis-teff', teff, classIndex: 'default' });
    expect(apsis.rSun).toBeCloseTo(tableR * (4410 / 5150) ** 2, 6);
  });

  it('refuses the measured Teff for white dwarfs and Wolf-Rayets, carrying it on the route', () => {
    const teff = { kelvin: 5000, solution: 'gspspec' } as const;
    const wd: SpectralInfo = { kind: 'white-dwarf', wdSubclass: 2 };
    expect(physicalRadius(11, wd, teff)).toEqual({ route: 'white-dwarf', rSun: WHITE_DWARF_RADIUS_R_SUN, refusedTeff: teff });
    const wr = classifyFromSimbad('WN5')!;
    const refused = physicalRadius(-4.0, wr, teff);
    expect(refused).toMatchObject({ route: 'class-teff', refusedTeff: teff });
    expect(refused.rSun).toBeCloseTo(rSun(-4.0, wr), 9);
  });
});

describe('resolveApsisTeff', () => {
  const APSIS_NONE: ApsisRow = {
    teffGspphot: null, loggGspphot: null, mhGspphot: null, azeroGspphot: null,
    teffGspspec: null, loggGspspec: null, mhGspspec: null, spectraltypeEsphs: null,
  };

  it('prefers gspphot, falls back to gspspec', () => {
    expect(resolveApsisTeff({ ...APSIS_NONE, teffGspphot: 5150, teffGspspec: 4900 }))
      .toEqual({ teff: { kelvin: 5150, solution: 'gspphot' }, outOfWindow: [] });
    expect(resolveApsisTeff({ ...APSIS_NONE, teffGspspec: 4900 }))
      .toEqual({ teff: { kelvin: 4900, solution: 'gspspec' }, outOfWindow: [] });
  });

  it('names each solution it refused as out of window, and absent rows', () => {
    expect(resolveApsisTeff({ ...APSIS_NONE, teffGspphot: 1500, teffGspspec: 3400 }))
      .toEqual({ teff: { kelvin: 3400, solution: 'gspspec' }, outOfWindow: ['gspphot'] });
    expect(resolveApsisTeff({ ...APSIS_NONE, teffGspphot: 70000 })).toEqual({ teff: null, outOfWindow: ['gspphot'] });
    expect(resolveApsisTeff(APSIS_NONE)).toEqual({ teff: null, outOfWindow: [] });
    expect(resolveApsisTeff(null)).toEqual({ teff: null, outOfWindow: [] });
    expect(resolveApsisTeff(undefined)).toEqual({ teff: null, outOfWindow: [] });
  });
});

describe('boloCorr', () => {

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

  // Cox 2000 (/data/papers/index.md#cox2000) Sect. 15.3.
  it('pins main-sequence anchors (Cox 2000)', () => {
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
    expect(absmagFromSpectral(info(5, 0, null))).toBeCloseTo(5.9, 2);
    expect(absmagFromSpectral(classifyFromGspspec('K')!)).toBeCloseTo(7.4, 2);
  });

  it('returns null where a single calibration would be fiction', () => {
    expect(mv('DA1.9')).toBeNull();                      // white dwarf
    expect(mv('C5,2e')).toBeNull();                      // carbon
    expect(mv('WN5')).toBeNull();                        // Wolf-Rayet
    expect(absmagFromSpectral(classifyFromGspspec('CSTAR')!)).toBeNull();
    expect(absmagFromSpectral(SPECTRAL_UNKNOWN)).toBeNull();
  });
});

describe('spectralFromAbsmag', () => {
  it('inverts the MS calibration at the table anchors', () => {
    expect(spectralFromAbsmag(0.65)).toMatchObject({ kind: 'mk', letter: 2, lumClass: 2 });
    expect(spectralFromAbsmag(0.65).subclass).toBeCloseTo(0, 5);   // A0
    expect(spectralFromAbsmag(1.9).subclass).toBeCloseTo(5, 5);    // A5
    const g5 = spectralFromAbsmag(5.1);
    expect(g5.letter).toBe(4);
    expect(g5.subclass).toBeCloseTo(5, 5);                          // G5
  });

  it('lands Algol Ab (own M_V ~2.2) in the A range, not the inherited B8', () => {
    const info = spectralFromAbsmag(2.225);
    expect(info.letter).toBe(2);
    expect(info.subclass).toBeCloseTo(7, 0);
  });

  it('clamps outside the [O0, M9] span', () => {
    expect(spectralFromAbsmag(-9)).toMatchObject({ letter: 0, subclass: 0 });
    expect(spectralFromAbsmag(20)).toMatchObject({ letter: 6, subclass: 9 });
  });

  it('round-trips through absmagFromSpectral inside every class span', () => {
    for (const mv of [-5.0, -2.0, 1.0, 3.1, 4.9, 6.6, 12.0]) {
      const back = absmagFromSpectral(spectralFromAbsmag(mv));
      expect(back).not.toBeNull();
      expect(back!).toBeCloseTo(mv, 6);
    }
  });
});
