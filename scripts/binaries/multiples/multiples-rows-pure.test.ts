import { describe, expect, it } from 'vitest';

import { AU_PER_PC, DEG_TO_RAD } from '../../../src/astro-core/astronomy-constants';
import { unitVectorFromRaDec } from '../../../src/astro-core/equatorial-basis';
import { CATALOG_SCENE_EPOCH } from '../../../src/catalog-format/record/catalog-pure';
import { UNRESOLVED_ASTROMETRY } from '../astrometry/routes-pure';
import { componentKey } from '../component-tokens-pure';
import type { OrbitViaOnFile } from '../multiples-record-pure';
import { indices, xid } from '../resolve/resolve-fixture';
import {
  CIRCULAR_ORBIT_OMEGA_RAD, UNKNOWN_COMPANION_MASS_RATIO_Q, orbitFields, positionPc, standaloneRow, wdsYearToJd,
} from './multiples-rows-pure';
import { elements, measured } from './stage6-fixture';

describe('positionPc', () => {
  it('reads 10 mas at (0, 0) as 100 pc down the x axis', () => {
    const p = positionPc(measured({ raDeg: 0, decDeg: 0 }))!;
    for (const [v, want] of [[p.distPc, 100], [p.xPc, 100], [p.yPc, 0], [p.zPc, 0]]) expect(v).toBeCloseTo(want, 6);
  });

  it('is null unresolved, and for a non-positive or missing parallax', () => {
    expect(positionPc(UNRESOLVED_ASTROMETRY)).toBeNull();
    expect(positionPc(measured({ parallaxMas: 0 }))).toBeNull();
    expect(positionPc(measured({ parallaxMas: null }))).toBeNull();
  });

  it('puts a mixed-epoch pair at one scene epoch, so its separation is the true J2016 one', () => {
    const distPc = 100.0;
    const [pmraMasyr, pmdecMasyr] = [3600.0, 0.0];
    const [raP, decP] = [150.0, 10.0];
    const cosd = Math.cos(decP * DEG_TO_RAD);
    const dt = CATALOG_SCENE_EPOCH - 1991.25;
    const primary = measured({
      astrometryVia: 'hip2_long_baseline', raDeg: raP - (pmraMasyr * dt) / (3600.0 * 1000.0 * cosd), decDeg: decP,
      parallaxMas: 1000 / distPc, pmraMasyr, pmdecMasyr, refEpoch: 1991.25,
    });
    const secondary = measured({ raDeg: raP + 5.0 / (3600.0 * cosd), decDeg: decP, parallaxMas: 1000 / distPc, pmraMasyr, pmdecMasyr });
    const p = positionPc(primary)!;
    const s = positionPc(secondary)!;
    expect(Math.abs(Math.hypot(s.xPc - p.xPc, s.yPc - p.yPc, s.zPc - p.zPc) * AU_PER_PC - 500)).toBeLessThan(1);
    const stale = unitVectorFromRaDec(primary.raDeg, primary.decDeg);
    expect(Math.hypot(s.xPc - stale.x * distPc, s.yPc - stale.y * distPc, s.zPc - stale.z * distPc) * AU_PER_PC).toBeGreaterThan(8000);
  });
});

describe('wdsYearToJd', () => {
  it('reads a year as the Julian-year JD it starts on', () => {
    expect(wdsYearToJd(2000)).toBe(2451545.0);
    expect(wdsYearToJd(2020)).toBe(2458850.0);
    expect(wdsYearToJd(1980)).toBe(2444240.0);
    expect(wdsYearToJd(null)).toBeNull();
  });
});

describe('orbitFields — the estimated-element backstops', () => {
  const nss = (over: Parameters<typeof elements>[0] = {}) => ({ orbitVia: 'gaia_nss' as const, elements: elements(over) });

  it('derives a Kepler a at the default q', () => {
    const f = orbitFields(nss(), 'G2V', '');
    expect(f.q).toBe(UNKNOWN_COMPANION_MASS_RATIO_Q);
    expect(f.aAU).toBeCloseTo(1.5 ** (1 / 3), 9);
    expect(f.aVia).toBe('kepler_mass_estimate');
  });

  it('leaves a catalogue a and q alone', () => {
    const f = orbitFields(nss({ aAu: 23.0, q: 0.4 }), 'G2V', '');
    expect([f.aAU, f.aVia, f.q]).toEqual([23.0, 'catalog', 0.4]);
  });

  it('backfills a circular orbit\'s ω, never an eccentric one\'s', () => {
    expect(orbitFields(nss({ e: 0.0, periastronRad: null }), 'G2V', '').omegaRad).toBe(CIRCULAR_ORBIT_OMEGA_RAD);
    expect(orbitFields(nss({ e: 0.3, periastronRad: null }), 'G2V', '').omegaRad).toBeNull();
  });

  it('takes the default primary mass for an unparseable type', () => {
    expect(orbitFields(nss(), '', '').aAU).toBeCloseTo(1.5 ** (1 / 3), 9);
  });

  it('backstops nothing without an orbit, or on a visual orbit', () => {
    expect(orbitFields({ orbitVia: 'none' }, 'G2V', '')).toMatchObject({ q: null, aAU: null, aVia: 'none' });
    const visual = orbitFields({ orbitVia: 'orb6' satisfies OrbitViaOnFile, elements: elements({ e: 0.0, periastronRad: null }) }, 'G2V', '');
    expect([visual.q, visual.aAU, visual.omegaRad]).toEqual([null, null, null]);
  });
});

describe('standaloneRow', () => {
  it('carries its system\'s anchor letter and its offset from it', () => {
    const W = '99999+9999';
    const r = standaloneRow(xid(W, 'X', null), null, indices(), {
      anchorBySystem: new Map([[W, 'Aa']]), offsets: new Map([[componentKey(W, 'X'), { sepArcsec: 12.0, paDeg: 30.0 }]]),
    });
    expect([r.anchorComp, r.anchorSepArcsec, r.anchorPaDeg]).toEqual(['Aa', 12.0, 30.0]);
  });
});
