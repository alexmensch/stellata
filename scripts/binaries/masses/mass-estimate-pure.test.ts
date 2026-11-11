import { describe, expect, it } from 'vitest';
import {
  CARBON_WR_MASS_DEFAULT, massFromSpectralClass, massRatioFromComponents, parseSpectralType, WD_MASS_DEFAULT,
} from './mass-estimate-pure';

const triple = (s: string) => {
  const p = parseSpectralType(s)!;
  return [p.classIdx, p.subclass, p.lumClass];
};

describe('parseSpectralType', () => {
  it('reads plain MK, truncating a fractional subclass', () => {
    expect(triple('G2V')).toEqual([4, 2, 2]);
    expect(parseSpectralType('G2V')!.isWhiteDwarf).toBe(false);
    expect(triple('M3.5V')).toEqual([6, 3, 2]);
  });

  it('flags white dwarfs, composite subtypes included', () => {
    expect(parseSpectralType('DA1.9')).toMatchObject({ isWhiteDwarf: true, lumClass: 0 });
    expect(parseSpectralType('DQZ')!.isWhiteDwarf).toBe(true);
  });

  it('takes the first Roman numeral of the post-subclass window: F5IV-V is a subgiant', () => {
    expect(triple('F5IV-V')).toEqual([3, 5, 3]);
  });

  it('reads giants and supergiants', () => {
    expect(triple('K0III')).toEqual([5, 0, 4]);
    expect(triple('B8Ia')).toEqual([1, 8, 8]);
    expect(parseSpectralType('M1Iab')!.lumClass).toBe(7);
    expect(parseSpectralType('A0Ia+')!.lumClass).toBe(9);
  });

  it('lets a Yerkes d / g prefix set the luminosity class', () => {
    expect(triple('dM4.0')).toEqual([6, 4, 2]);
    expect([parseSpectralType('gK0')!.classIdx, parseSpectralType('gK0')!.lumClass]).toEqual([5, 4]);
  });

  it('reads subdwarfs', () => {
    expect(triple('sdB5')).toEqual([1, 5, 1]);
  });

  it('lands Wolf-Rayet in the carbon bucket', () => {
    expect(parseSpectralType('WN5')!.classIdx).toBe(7);
  });

  it('takes the metallic-line body of a k/h/m composite, and the window after it', () => {
    expect(triple('kA5hA8mF1(III)')).toEqual([3, 1, 4]);
  });

  it('is null for an empty string and an unknown first letter', () => {
    for (const s of ['', null, '   ', 'XYZ']) expect(parseSpectralType(s)).toBeNull();
  });
});

describe('massFromSpectralClass', () => {
  it('reads the main-sequence row', () => {
    expect(massFromSpectralClass('G2V')).toBe(1.0);
    expect(massFromSpectralClass('A1V')).toBe(2.6);
    expect(massFromSpectralClass('K1V')).toBe(0.76);
  });

  it('gives every white dwarf the default mass', () => {
    expect(massFromSpectralClass('DA1.9')).toBe(WD_MASS_DEFAULT);
    expect(massFromSpectralClass('DQZ')).toBe(WD_MASS_DEFAULT);
  });

  it('reads the giant and supergiant rows', () => {
    expect(massFromSpectralClass('K0III')).toBe(1.5);
    expect(massFromSpectralClass('B0Ia')).toBe(25.0);
  });

  it('gives carbon / S / Wolf-Rayet one mass', () => {
    expect(massFromSpectralClass('C5,2e')).toBe(CARBON_WR_MASS_DEFAULT);
    expect(massFromSpectralClass('WN5')).toBe(CARBON_WR_MASS_DEFAULT);
  });

  it('weights a subgiant between the two rows: F5IV within 10% of Procyon A\'s 1.478', () => {
    const iv = massFromSpectralClass('G2IV')!;
    expect(iv).toBeGreaterThan(massFromSpectralClass('G2V')!);
    expect(iv).toBeLessThan(massFromSpectralClass('G2III')!);
    expect(massFromSpectralClass('F5IV')).toBeCloseTo(1.62, 12);
    expect(Math.abs(massFromSpectralClass('F5IV')! - 1.478)).toBeLessThan(0.148);
  });

  it('is null for an unparseable string', () => {
    for (const s of ['', null, '???']) expect(massFromSpectralClass(s)).toBeNull();
  });
});

describe('massRatioFromComponents', () => {
  it('reads Sirius (A1V + DA1.9) at 0.6 / (2.6 + 0.6)', () => {
    expect(massRatioFromComponents('A1V', 'DA1.9')).toBeCloseTo(0.1875, 3);
  });

  it('reads Procyon (F5IV-V + DQZ) with the subgiant weighting', () => {
    expect(massRatioFromComponents('F5IV-V', 'DQZ')).toBeCloseTo(0.2703, 4);
  });

  it('reads α Cen (G2V + K1V)', () => {
    expect(massRatioFromComponents('G2V', 'K1V')).toBeCloseTo(0.4318, 4);
  });

  it('is null when either type is unparseable', () => {
    expect(massRatioFromComponents('', 'K1V')).toBeNull();
    expect(massRatioFromComponents('G2V', '')).toBeNull();
  });
});
