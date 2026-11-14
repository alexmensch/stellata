import { describe, expect, it } from 'vitest';

import { DAYS_PER_JULIAN_YEAR } from '../../../src/astro-core/astronomy-constants';
import { jdOfJulianYear } from '../../../src/astro-core/precession';
import { orb6Entry, wdsPair } from '../../wds/wds-fixture';
import type { Orb6Entry } from '../../wds/wds-pure';
import { UNRESOLVED_ASTROMETRY, type ComponentAstrometry, type PairAstrometry } from '../astrometry/routes-pure';
import type { NssOrbitRow } from '../load/gaia-pure';
import { mscOrbit } from '../load/load-fixture';
import type { MscOrbitRow } from '../load/msc-pure';
import { decomposed, type Side } from '../resolve/resolve-fixture';
import { nssOrbitalRow } from './nss-fixture';
import { keplerSemimajorAxisAu, nssSeparationConsistent, selectOrbit, type PairOrbit } from './select-orbit-pure';

const ast = (parallaxMas: number | null = 10): ComponentAstrometry => ({
  astrometryVia: 'gaia_5p', raDeg: 0, decDeg: 0, parallaxMas, parallaxErrorMas: 0.05, pmraMasyr: 0, pmdecMasyr: 0, refEpoch: 2016,
});

interface Case {
  primary?: Side;
  secondary?: Side;
  components?: string;
  rho?: number | null;
  plx?: number | null;
  nss?: readonly NssOrbitRow[];
  orb6?: readonly Orb6Entry[];
  msc?: readonly MscOrbitRow[];
  systemParallaxMas?: number | null;
}

function select(c: Case): PairOrbit {
  const p = decomposed(wdsPair({ components: c.components ?? 'AB', rhoLast: c.rho ?? null }), {
    primary: { gaiaSourceId: '42', ...c.primary },
    secondary: { gaiaSourceId: null, ...c.secondary },
  });
  const a = ast(c.plx === undefined ? 10 : c.plx);
  const astrometry: PairAstrometry = { primary: a, secondary: a };
  const srcToNss = new Map((c.nss ?? []).map((r) => [r.sourceId, r]));
  return selectOrbit(p, astrometry, { orb6: c.orb6 ?? [], msc: c.msc ?? [], systemParallaxMas: c.systemParallaxMas ?? null }, srcToNss);
}

const nss = (over: Parameters<typeof nssOrbitalRow>[0] = {}): NssOrbitRow => nssOrbitalRow({ sourceId: '42', periodDays: 200, ...over });
const via = (o: PairOrbit): string => o.orbitVia;
const elementsOf = (o: PairOrbit) => (o.orbitVia === 'none' ? null : o.elements);

describe('selectOrbit', () => {
  it('ranks an ORB6 visual orbit over an in-regime NSS orbit, keeping ORB6\'s a', () => {
    const o = select({ nss: [nss()], orb6: [orb6Entry({ grade: 1, ref: 'Hei2020' })] });
    expect(via(o)).toBe('orb6');
    expect(elementsOf(o)!.aAu).not.toBeNull();
  });

  it('lets NSS claim a pair without a visual orbit, with no a', () => {
    const o = select({ nss: [nss()] });
    expect(via(o)).toBe('gaia_nss');
    expect(elementsOf(o)!.aAu).toBeNull();
  });

  it('keeps an NSS orbit outside both regime gates off the pair, and admits a long period with a sub-arcsec a0', () => {
    expect(select({ nss: [nss({ periodDays: 10 * DAYS_PER_JULIAN_YEAR, aMas: 5000 })] })).toEqual({ orbitVia: 'none' });
    expect(via(select({ nss: [nss({ periodDays: 10 * DAYS_PER_JULIAN_YEAR, aMas: 500 })] }))).toBe('gaia_nss');
  });

  it('reads the secondary\'s NSS row when the primary has no source', () => {
    expect(via(select({ primary: { gaiaSourceId: null }, secondary: { gaiaSourceId: '99' }, nss: [nss({ sourceId: '99', periodDays: 100 })] })))
      .toBe('gaia_nss');
  });

  it('refuses an NSS orbit whose partner is a different source, and attaches it when both sides share the blended source (Castor CIA 29)', () => {
    expect(via(select({ secondary: { gaiaSourceId: '99' }, nss: [nss({ sourceId: '99', periodDays: 100 })] }))).toBe('none');
    expect(via(select({ components: 'Aa,Ab', secondary: { gaiaSourceId: '42' }, nss: [nss({ periodDays: 100 })] }))).toBe('gaia_nss');
  });

  it('refuses a sub-day NSS orbit on a 5.5″ pair at 18.5 mas (υ⁴ Eri), and keeps it at ρ = 0 or a consistent 0.05″', () => {
    const subDay = [nss({ periodDays: 0.9702 })];
    expect(select({ nss: subDay, rho: 5.5, plx: 18.5 })).toEqual({ orbitVia: 'none' });
    expect(via(select({ components: 'Aa,Ab', secondary: { gaiaSourceId: '42' }, nss: subDay, rho: 0, plx: 18.5 }))).toBe('gaia_nss');
    expect(via(select({ nss: [nss()], rho: 0.05, plx: 10 }))).toBe('gaia_nss');
  });

  it('gates on the system parallax when neither side measured one (ε Cep)', () => {
    const c: Case = { nss: [nss({ periodDays: 0.9702 })], rho: 5.5, plx: null };
    expect(via(select(c))).toBe('gaia_nss');
    expect(via(select({ ...c, systemParallaxMas: 18.5 }))).toBe('none');
  });

  it('takes the lowest visual grade', () => {
    const o = select({ orb6: [
      orb6Entry({ grade: 4, ref: 'Old1990', t0Val: 1990 }),
      orb6Entry({ grade: 2, ref: 'Old1985', t0Val: 1985 }),
      orb6Entry({ grade: 3, ref: 'New2025', t0Val: 2025 }),
    ] });
    expect([via(o), elementsOf(o)!.tJd]).toEqual(['orb6', jdOfJulianYear(1985)]);
  });

  it('routes grades 7, 8 and 9 as orb6_spectroscopic, below a visual orbit', () => {
    for (const grade of [7, 8, 9]) expect(via(select({ orb6: [orb6Entry({ grade })] }))).toBe('orb6_spectroscopic');
    expect(via(select({ orb6: [orb6Entry({ grade: 4, ref: 'Vis1990' }), orb6Entry({ grade: 9, ref: 'Spc2025' })] }))).toBe('orb6');
  });

  it('falls to the next route when the visual band\'s best row has no readable period', () => {
    expect(via(select({ orb6: [orb6Entry({ grade: 1, pUnit: '0' })], nss: [nss()] }))).toBe('gaia_nss');
  });

  it('throws on an epoch a reading takes as stated outside the window: an ORB6 d row, an NSS t_periastron', () => {
    expect(() => select({ orb6: [orb6Entry({ t0Val: 900000, t0Unit: 'd' })] })).toThrow(/WDS-1\/AB via orb6: T_jd=3300000/);
    expect(() => select({ nss: [nss({ tPeriastronRelDays: 1e7 })] })).toThrow(/via gaia_nss/);
  });

  it('routes a pair with nothing on file to none', () => {
    expect(select({})).toEqual({ orbitVia: 'none' });
  });

  describe('the MSC route', () => {
    const msc = (rho: number | null, orb6: readonly Orb6Entry[] = []) =>
      select({ components: 'Aa,Ab', primary: { gaiaSourceId: null }, rho, msc: [mscOrbit()], orb6 });

    it('attaches on a sub-resolution or unmeasured pair', () => {
      const o = msc(0);
      expect([via(o), elementsOf(o)!.pDays]).toEqual(['msc', 6.0663]);
      expect(via(msc(null))).toBe('msc');
    });

    it('never on a measured pair', () => {
      expect(msc(1.4)).toEqual({ orbitVia: 'none' });
    });

    it('ranks below both ORB6 routes', () => {
      expect(via(msc(0, [orb6Entry({ components: 'Aa,Ab', grade: 2 })]))).toBe('orb6');
      expect(via(msc(0, [orb6Entry({ components: 'Aa,Ab', grade: 9 })]))).toBe('orb6_spectroscopic');
    });
  });

  it('reads the parallax from the secondary when the primary is unresolved', () => {
    const p = decomposed(wdsPair({ rhoLast: null }), { primary: { gaiaSourceId: '42' } });
    const o = selectOrbit(p, { primary: UNRESOLVED_ASTROMETRY, secondary: ast(4) }, { orb6: [orb6Entry()], msc: [], systemParallaxMas: 99 }, new Map());
    expect(elementsOf(o)!.distancePc).toBe(250);
  });
});

describe('nssSeparationConsistent', () => {
  const subDay = nss({ periodDays: 0.9702 });

  it('is inconsistent for a sub-day orbit on a 5.5″ pair at 18.5 mas', () => {
    expect(nssSeparationConsistent(subDay, 5.5, 18.5)).toBe(false);
  });

  it('is consistent whenever ρ, the parallax or the period is missing', () => {
    expect(nssSeparationConsistent(subDay, null, 18.5)).toBe(true);
    expect(nssSeparationConsistent(subDay, 0, 18.5)).toBe(true);
    expect(nssSeparationConsistent(subDay, 5.5, null)).toBe(true);
    expect(nssSeparationConsistent({ ...subDay, period: null }, 5.5, 18.5)).toBe(true);
  });
});

describe('keplerSemimajorAxisAu', () => {
  it('gives 1 AU for a Julian year around a solar mass, and YY Gem\'s 0.017 AU', () => {
    expect(keplerSemimajorAxisAu(DAYS_PER_JULIAN_YEAR, 1)).toBeCloseTo(1, 12);
    expect(keplerSemimajorAxisAu(0.814282, 1)).toBeCloseTo(0.017066, 6);
  });

  it('is null for a non-positive period or mass', () => {
    expect(keplerSemimajorAxisAu(0, 1)).toBeNull();
    expect(keplerSemimajorAxisAu(10, 0)).toBeNull();
  });
});
