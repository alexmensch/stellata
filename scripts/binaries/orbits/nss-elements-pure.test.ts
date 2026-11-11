import { describe, expect, it } from 'vitest';

import { DAYS_PER_JULIAN_YEAR, DEG_TO_RAD } from '../../../src/astro-core/astronomy-constants';
import {
  GAIA_DR3_REF_EPOCH_JD, NSS_PERIOD_THRESHOLD_DAYS, nssInRegime, nssToCanonicalElements, thieleInnesToCampbell,
} from './nss-elements-pure';
import { nssOrbitalRow, nssRow, tiFromCampbell } from './nss-fixture';

describe('thieleInnesToCampbell', () => {
  it('round-trips a Campbell orbit away from every boundary', () => {
    const [A, B, F, G] = tiFromCampbell(12.5, 57.3 * DEG_TO_RAD, 110 * DEG_TO_RAD, 45 * DEG_TO_RAD);
    const c = thieleInnesToCampbell(A, B, F, G)!;
    expect(c.aMas).toBeCloseTo(12.5, 9);
    expect(c.iRad).toBeCloseTo(57.3 * DEG_TO_RAD, 9);
    expect(c.nodeRad).toBeCloseTo(110 * DEG_TO_RAD, 9);
    expect(c.periastronRad).toBeCloseTo(45 * DEG_TO_RAD, 9);
  });

  it('folds a node past π into [0, π) and turns ω by π, the same physical orbit', () => {
    const [A, B, F, G] = tiFromCampbell(10, 45 * DEG_TO_RAD, 220 * DEG_TO_RAD, 60 * DEG_TO_RAD);
    const c = thieleInnesToCampbell(A, B, F, G)!;
    expect(c.aMas).toBeCloseTo(10, 9);
    expect(c.iRad).toBeCloseTo(45 * DEG_TO_RAD, 9);
    expect(c.nodeRad).toBeGreaterThanOrEqual(0);
    expect(c.nodeRad).toBeLessThan(Math.PI);
    expect(c.nodeRad).toBeCloseTo(220 * DEG_TO_RAD - Math.PI, 9);
    expect(c.periastronRad).toBeCloseTo((60 * DEG_TO_RAD + Math.PI) % (2 * Math.PI), 9);
  });

  it('recovers a retrograde inclination from the sign of AG − BF', () => {
    const [A, B, F, G] = tiFromCampbell(8, 130 * DEG_TO_RAD, 40 * DEG_TO_RAD, 300 * DEG_TO_RAD);
    const c = thieleInnesToCampbell(A, B, F, G)!;
    expect(c.iRad).toBeCloseTo(130 * DEG_TO_RAD, 9);
    expect(c.periastronRad).toBeCloseTo(300 * DEG_TO_RAD, 9);
  });

  it('returns null for a degenerate quartet', () => {
    expect(thieleInnesToCampbell(0, 0, 0, 0)).toBeNull();
  });
});

describe('nssToCanonicalElements', () => {
  it('recovers the angles of an Orbital solution, withholding its photocentre a0', () => {
    const o = nssToCanonicalElements(nssOrbitalRow({
      aMas: 20, iDeg: 60, nodeDeg: 30, periastronDeg: 120, periodDays: 730.5, tPeriastronRelDays: 200, eccentricity: 0.3,
    }), 10)!;
    expect(o.pDays).toBe(730.5);
    expect(o.tJd).toBe(200 + GAIA_DR3_REF_EPOCH_JD);
    expect(o.e).toBe(0.3);
    expect(o.aAu).toBeNull();
    expect(o.iRad).toBeCloseTo(60 * DEG_TO_RAD, 9);
    expect(o.nodeRad).toBeCloseTo(30 * DEG_TO_RAD, 9);
    expect(o.periastronRad).toBeCloseTo(120 * DEG_TO_RAD, 9);
    expect(o.q).toBeNull();
    expect(o.distancePc).toBeCloseTo(100, 9);
  });

  it('counts t_periastron from J2016.0', () => {
    expect(GAIA_DR3_REF_EPOCH_JD).toBe(2457389);
  });

  it('keeps the angles and drops the distance without a parallax', () => {
    const o = nssToCanonicalElements(nssOrbitalRow({ aMas: 20 }), null)!;
    expect(o.aAu).toBeNull();
    expect(o.distancePc).toBeNull();
    expect(o.iRad).not.toBeNull();
    expect(o.nodeRad).not.toBeNull();
    expect(o.periastronRad).not.toBeNull();
  });

  it('never scales the photocentre a0 to a relative a_AU', () => {
    const [aRelAu, q, beta, plx] = [10, 0.4, 0.1, 10];
    const a0Mas = (q - beta) * aRelAu * plx;
    const row = nssOrbitalRow({ aMas: a0Mas, iDeg: 45 });
    const c = thieleInnesToCampbell(row.aThieleInnes!, row.bThieleInnes!, row.fThieleInnes!, row.gThieleInnes!)!;
    expect(c.aMas).toBeCloseTo(a0Mas, 9);
    expect(nssToCanonicalElements(row, plx)!.aAu).toBeNull();
  });

  it('reads an eclipsing solution\'s stored inclination and ω, leaving a and Ω unconstrained', () => {
    const o = nssToCanonicalElements(nssRow({
      solutionType: 'EclipsingBinary', period: 1.5, tPeriastron: 0, eccentricity: 0, inclination: 89.5, argPeriastron: 45,
    }), 5)!;
    expect(o.pDays).toBe(1.5);
    expect(o.iRad).toBe(89.5 * DEG_TO_RAD);
    expect(o.periastronRad).toBe(45 * DEG_TO_RAD);
    expect(o.aAu).toBeNull();
    expect(o.nodeRad).toBeNull();
  });

  it('turns Gaia\'s M_S/M_P into the M₂/(M₁+M₂) fraction, a ratio above one included', () => {
    const q = (massRatio: number): number | null => nssToCanonicalElements(nssRow({
      solutionType: 'EclipsingSpectro', period: 2, tPeriastron: 1, eccentricity: 0, inclination: 88, argPeriastron: 10, massRatio,
    }), 5)!.q;
    expect(q(0.6)).toBeCloseTo(0.6 / 1.6, 12);
    expect(q(2)).toBeCloseTo(2 / 3, 12);
  });

  it('gives an SB1 its ω alone', () => {
    const o = nssToCanonicalElements(nssRow({ period: 100, tPeriastron: 10, eccentricity: 0.2, argPeriastron: 75 }), 8)!;
    expect(o.periastronRad).toBe(75 * DEG_TO_RAD);
    expect(o.iRad).toBeNull();
    expect(o.nodeRad).toBeNull();
    expect(o.aAu).toBeNull();
  });

  it('gives a compact SB1C nothing past P, T and e', () => {
    const o = nssToCanonicalElements(nssRow({ solutionType: 'SB1C', period: 12, tPeriastron: 3, eccentricity: 0.05 }), 5)!;
    expect(o.pDays).toBe(12);
    expect([o.periastronRad, o.iRad, o.nodeRad, o.aAu]).toEqual([null, null, null, null]);
  });

  it('returns null for a solution type it does not name', () => {
    expect(nssToCanonicalElements(nssRow({ solutionType: 'FutureNewType', period: 1 }), 5)).toBeNull();
  });
});

describe('nssInRegime', () => {
  it('admits a period under 3 yr, whatever the solution type', () => {
    expect(nssInRegime(nssRow({ period: NSS_PERIOD_THRESHOLD_DAYS - 1 }))).toBe(true);
    expect(nssInRegime(nssRow({ period: NSS_PERIOD_THRESHOLD_DAYS }))).toBe(false);
  });

  it('admits a longer period whose photocentre orbit is under 1″', () => {
    expect(nssInRegime(nssOrbitalRow({ periodDays: 10 * DAYS_PER_JULIAN_YEAR, aMas: 999 }))).toBe(true);
    expect(nssInRegime(nssOrbitalRow({ periodDays: 10 * DAYS_PER_JULIAN_YEAR, aMas: 5000 }))).toBe(false);
  });

  it('refuses a row stating neither', () => {
    expect(nssInRegime(nssRow({ solutionType: 'EclipsingBinary' }))).toBe(false);
    expect(nssInRegime(nssRow({ solutionType: 'Orbital' }))).toBe(false);
  });
});
