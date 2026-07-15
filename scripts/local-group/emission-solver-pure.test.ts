// Cross-pins the numeric geometry-integral path against the analytic
// Sérsic closed forms and the untruncated-disc limit, and pins the
// solver's shape constants.

import { describe, expect, it } from 'vitest';
import {
  bnCoeff,
  bulgeInDiscGeometryIntegral,
  discGeometryIntegral,
  fluxNumber,
  integrateOverEllipsoid,
  lnGamma,
  pnCoeff,
  regularizedLowerGamma,
  sersicGeometryIntegral,
  sersicGeometryIntegralAnalytic,
  sersicNu,
  solveDensity0,
  u99,
} from './emission-solver-pure';

describe('Sérsic shape constants', () => {
  it('pins b_n (Ciotti & Bertin 1999)', () => {
    expect(bnCoeff(1)).toBe(1.6765432098765434);
    expect(bnCoeff(1.5)).toBe(2.6732510288065843);
    expect(bnCoeff(2.2)).toBe(4.071156004489339);
  });
  it('pins p_n (Prugniel–Simien deprojection)', () => {
    expect(pnCoeff(1)).toBe(0.44493);
    expect(pnCoeff(1.5)).toBe(0.6178133333333332);
    expect(pnCoeff(2.2)).toBe(0.734150826446281);
  });
  it('pins the 99%-light envelope radius per Sérsic index', () => {
    expect(u99(1)).toBe(4.55698214967272);
    expect(u99(1.5)).toBe(6.548953002548983);
    expect(u99(1.7)).toBe(7.446605103858023);
    expect(u99(2.2)).toBe(9.97475895605683);
  });
});

describe('gamma helpers', () => {
  it('lnGamma reproduces exact factorials', () => {
    expect(Math.exp(lnGamma(5))).toBeCloseTo(24, 10);
    expect(Math.exp(lnGamma(1))).toBeCloseTo(1, 12);
    expect(lnGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 12);
  });
  it('regularized lower gamma at reference points', () => {
    // P(1, x) = 1 − e^(−x) exactly.
    expect(regularizedLowerGamma(1, 2)).toBeCloseTo(1 - Math.exp(-2), 12);
    expect(regularizedLowerGamma(2.5, 2.5)).toBeCloseTo(0.584119813004491, 12);
    expect(regularizedLowerGamma(3, 0)).toBe(0);
  });
});

describe('numeric geometry integral vs analytic closed forms', () => {
  it('spheroid quadrature matches the incomplete-gamma form (n = 1, SMC geometry)', () => {
    const axes: [number, number, number] = [812.82, 1080.85, 1307.48];
    const num = sersicGeometryIntegral(axes, 1, 4.589);
    const ana = sersicGeometryIntegralAnalytic(axes, 1, 4.589);
    expect(Math.abs(num - ana) / ana).toBeLessThan(1e-8);
  });
  it('spheroid quadrature matches the incomplete-gamma form (n = 1.5, wide envelope, M32 geometry)', () => {
    const axes: [number, number, number] = [105.2, 78.9, 78.9];
    const num = sersicGeometryIntegral(axes, 1.5, 15.2091);
    const ana = sersicGeometryIntegralAnalytic(axes, 1.5, 15.2091);
    expect(Math.abs(num - ana) / ana).toBeLessThan(1e-6);
  });
  it('disc quadrature approaches 4π·R_d²·z_d with a loose envelope', () => {
    const rd = 1500;
    const zd = 1000 / 3;
    const gInf = 4 * Math.PI * rd * rd * zd;
    const g = discGeometryIntegral(rd, zd, 12 * rd, 12 * zd);
    // The 12-scale-length ellipsoid still clips ~1e-4 of the light;
    // the quadrature must land inside that physical residual.
    expect(Math.abs(g - gInf) / gInf).toBeLessThan(2e-4);
  });
  it('disc truncation at the LMC envelope clips real light the solver must compensate', () => {
    const g = discGeometryIntegral(1500, 1000 / 3, 6000, 4000 / 3);
    const gInf = 4 * Math.PI * 1500 * 1500 * (1000 / 3);
    expect(g / gInf).toBe(0.866974589138657);
  });
  it('bulge-in-disc-envelope integral is cut by both the mesh and uMax', () => {
    const uMax = u99(2.2);
    const inDisc = bulgeInDiscGeometryIntegral(1000, 2.2, uMax, 21200, 2000 / 3);
    // A near-spherical envelope enclosing the full uMax ball recovers
    // (almost) the untruncated spheroid integral — the disc envelope
    // must therefore be a strict subset.
    const full = sersicGeometryIntegralAnalytic([1000, 1000, 1000], 2.2, uMax);
    expect(inDisc).toBeLessThan(full);
    expect(inDisc).toBe(326473008.00574315);
  });
});

describe('solveDensity0', () => {
  it('round-trips the far-field flux: ρ₀·G / d² = 10^(−0.4·mV)', () => {
    const g = sersicGeometryIntegral([500, 400, 400], 1, 4.6);
    const d = 100_000;
    const rho0 = solveDensity0(d, fluxNumber(7.5), g);
    expect((rho0 * g) / (d * d)).toBeCloseTo(fluxNumber(7.5), 12);
  });
});

describe('integrateOverEllipsoid', () => {
  it('recovers the ellipsoid volume for f = 1', () => {
    const v = integrateOverEllipsoid(() => 1, [3, 4, 5]);
    expect(v).toBeCloseTo((4 / 3) * Math.PI * 3 * 4 * 5, 6);
  });
});

describe('sersicNu', () => {
  it('is monotone decreasing and singular-integrable at the centre', () => {
    expect(sersicNu(0.5, 1)).toBeGreaterThan(sersicNu(1, 1));
    expect(sersicNu(1, 1)).toBeGreaterThan(sersicNu(2, 1));
    expect(Number.isFinite(sersicNu(1e-6, 1))).toBe(true);
  });
});
