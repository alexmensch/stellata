import { describe, expect, it } from 'vitest';

import { DAYS_PER_JULIAN_YEAR, DEG_TO_RAD, jdOfJulianYear } from '../../../src/astro-core/astronomy-constants';
import { orb6Entry } from '../../wds/wds-fixture';
import { mscOrbit } from '../load/load-fixture';
import { TRUNCATED_JD_TO_JD_OFFSET } from '../load/msc-pure';
import {
  MJD_TO_JD_OFFSET, mscToCanonicalElements, orb6ToCanonicalElements, pickBestMsc, pickBestOrb6,
} from './catalog-elements-pure';

describe('orb6ToCanonicalElements', () => {
  it('reads years, arcseconds and a Julian-year T0 (α Cen: a = 23.17 AU at 755 mas)', () => {
    const o = orb6ToCanonicalElements(orb6Entry({
      pVal: 79.762, pUnit: 'y', aVal: 17.493, aUnit: 'a', iDeg: 79, nodeDeg: 204, periastronDeg: 232,
      e: 0.5179, t0Val: 1875.66, t0Unit: 'y',
    }), 755)!;
    expect(o.pDays).toBeCloseTo(79.762 * DAYS_PER_JULIAN_YEAR, 9);
    expect(o.aAu).toBeCloseTo((17.493 * 1000) / 755, 12);
    expect(o.iRad).toBeCloseTo(79 * DEG_TO_RAD, 12);
    expect(o.tJd).toBeCloseTo(jdOfJulianYear(1875.66), 6);
    expect(o.distancePc).toBeCloseTo(1000 / 755, 12);
  });

  it('reads days, milliarcseconds and a truncated JD (Algol Aa1,Aa2 stores 41771.353 for HJD 2441771.353)', () => {
    const o = orb6ToCanonicalElements(orb6Entry({ pVal: 10, pUnit: 'd', aVal: 500, aUnit: 'm', t0Val: 51545, t0Unit: 'd' }), 100)!;
    expect([o.pDays, o.aAu, o.tJd]).toEqual([10, 5, 51545 + TRUNCATED_JD_TO_JD_OFFSET]);
  });

  it('reads an MJD T0, and a century or hour period', () => {
    expect(orb6ToCanonicalElements(orb6Entry({ t0Val: 51544.5, t0Unit: 'm' }), 10)!.tJd).toBe(51544.5 + MJD_TO_JD_OFFSET);
    expect(orb6ToCanonicalElements(orb6Entry({ pVal: 15, pUnit: 'c' }), 10)!.pDays).toBe(15 * 100 * DAYS_PER_JULIAN_YEAR);
    expect(orb6ToCanonicalElements(orb6Entry({ pVal: 48, pUnit: 'h' }), 10)!.pDays).toBe(2);
  });

  it('recovers a truncated JD mislabelled y (04227+1503 Aa,Ab: 59501.496 for a 4-day pair), and keeps a genuine year', () => {
    expect(orb6ToCanonicalElements(orb6Entry({ pVal: 4, pUnit: 'd', t0Val: 59501.496, t0Unit: 'y' }), 10)!.tJd)
      .toBe(59501.496 + TRUNCATED_JD_TO_JD_OFFSET);
    expect(orb6ToCanonicalElements(orb6Entry({ t0Val: 1990, t0Unit: 'y' }), 10)!.tJd).toBe(jdOfJulianYear(1990));
  });

  it('keeps the orbit without an epoch for a stray flag, or a y value plausible under neither reading', () => {
    for (const [t0Val, t0Unit] of [[111111111111, '1'], [300000, 'y'], [1990, 'c'], [1990, '']] as const) {
      const o = orb6ToCanonicalElements(orb6Entry({ t0Val, t0Unit }), 10)!;
      expect([o.tJd, o.pDays]).toEqual([null, 50 * DAYS_PER_JULIAN_YEAR]);
    }
  });

  it('mints nothing for an unknown period unit or a non-positive period', () => {
    expect(orb6ToCanonicalElements(orb6Entry({ pUnit: '0' }), 10)).toBeNull();
    expect(orb6ToCanonicalElements(orb6Entry({ pVal: 0, pUnit: 'd' }), 10)).toBeNull();
    expect(orb6ToCanonicalElements(orb6Entry({ pVal: null }), 10)).toBeNull();
  });

  it('drops a and the distance without a parallax, or a for an unknown a unit, keeping the angles', () => {
    const o = orb6ToCanonicalElements(orb6Entry(), null)!;
    expect([o.aAu, o.distancePc]).toEqual([null, null]);
    expect([o.iRad, o.nodeRad, o.periastronRad]).toEqual([90 * DEG_TO_RAD, 45 * DEG_TO_RAD, 30 * DEG_TO_RAD]);
    expect(orb6ToCanonicalElements(orb6Entry({ aUnit: '5' }), 10)!.aAu).toBeNull();
    expect(orb6ToCanonicalElements(orb6Entry({ aVal: 2, aUnit: 'M' }), 10)!.aAu).toBe(0.2);
  });
});

describe('pickBestOrb6', () => {
  it('takes the lowest grade', () => {
    const best = orb6Entry({ grade: 2, ref: 'Old1995' });
    expect(pickBestOrb6([orb6Entry({ grade: 4, ref: 'Old2010' }), best, orb6Entry({ grade: 3, ref: 'New2024' })])).toBe(best);
  });

  it('breaks a grade tie to the most recent ref, a ref without a year last, the first of equals', () => {
    const recent = orb6Entry({ ref: 'Kpt2025' });
    expect(pickBestOrb6([orb6Entry({ ref: 'Ake2021' }), orb6Entry({ ref: 'Hei1995' }), recent])).toBe(recent);
    const dated = orb6Entry({ ref: 'Hei1995' });
    expect(pickBestOrb6([orb6Entry({ ref: 'OldRef' }), dated])).toBe(dated);
    const first = orb6Entry({ ref: 'Hei1995' });
    expect(pickBestOrb6([first, orb6Entry({ ref: 'Ake1995' })])).toBe(first);
  });
});

describe('mscToCanonicalElements', () => {
  it('converts a spectroscopic row without geometry', () => {
    const o = mscToCanonicalElements(mscOrbit(), null)!;
    expect(o).toMatchObject({ pDays: 6.0663, e: 0.25, iRad: null, nodeRad: null, aAu: null, q: null, distancePc: null });
    expect(o.tJd).toBeCloseTo(2440087.19, 6);
    expect(o.periastronRad).toBe(31.4 * DEG_TO_RAD);
  });

  it('scales a visual row\'s a by the parallax, and leaves it null without one', () => {
    const row = mscOrbit({ per: 500, perUnit: 'y', t0: 1672, e: 0.5, aArcsec: 1.126, nodeDeg: 0.9, longpDeg: 125, inclDeg: 91.2 });
    const o = mscToCanonicalElements(row, 10)!;
    expect(o.aAu).toBeCloseTo(112.6, 12);
    expect([o.iRad, o.nodeRad]).toEqual([91.2 * DEG_TO_RAD, 0.9 * DEG_TO_RAD]);
    expect(mscToCanonicalElements(row, null)!.aAu).toBeNull();
  });

  it('mints nothing for a period no unit reads', () => {
    expect(mscToCanonicalElements(mscOrbit({ perUnit: '' }), 10)).toBeNull();
  });
});

describe('pickBestMsc', () => {
  it('takes the most complete row, the later edition of equals', () => {
    const sparse = mscOrbit({ aArcsec: null, inclDeg: null });
    const fullOld = mscOrbit({ aArcsec: 0.07, nodeDeg: 346.4, inclDeg: 89.7 });
    const fullNew = mscOrbit({ aArcsec: 0.1, nodeDeg: 344.9, inclDeg: 90.1 });
    expect(pickBestMsc([sparse, fullOld])).toBe(fullOld);
    expect(pickBestMsc([fullOld, fullNew])).toBe(fullNew);
    expect(pickBestMsc([fullNew, sparse])).toBe(fullNew);
  });
});
