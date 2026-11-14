import { describe, expect, it } from 'vitest';

import { gaia5pRow } from '../load/load-fixture';
import { gaiaPhotometryAbsmagCi } from './gaia-photometry-pure';

describe('gaiaPhotometryAbsmagCi', () => {
  it('reads a solar-colour star at 10 pc near the Sun\'s M_V and B−V', () => {
    const d = gaiaPhotometryAbsmagCi(gaia5pRow({ parallaxMas: 100.0, gMag: 4.67, bpMag: 5.05, rpMag: 4.23 }))!;
    expect(d.absmag).toBeCloseTo(4.82, 1);
    expect(d.ci).toBeCloseTo(0.67, 1);
  });

  it('is M_G with no colour when BP or RP is missing', () => {
    expect(gaiaPhotometryAbsmagCi(gaia5pRow({ parallaxMas: 10.0, gMag: 10.0 }))).toEqual({ absmag: 5.0, ci: null });
  });

  it('is null without G or a positive parallax', () => {
    expect(gaiaPhotometryAbsmagCi(gaia5pRow({ parallaxMas: null, gMag: 10.0 }))).toBeNull();
    expect(gaiaPhotometryAbsmagCi(gaia5pRow({ parallaxMas: 10.0, gMag: null }))).toBeNull();
    expect(gaiaPhotometryAbsmagCi(gaia5pRow({ parallaxMas: -1.0, gMag: 10.0 }))).toBeNull();
  });

  it('keeps the absmag but no colour outside the Teff fit\'s range', () => {
    const d = gaiaPhotometryAbsmagCi(gaia5pRow({ parallaxMas: 10.0, gMag: 6.0, bpMag: 6.1, rpMag: 5.9 }))!;
    expect(d.absmag).not.toBeNull();
    expect(d.ci).toBeNull();
  });
});
