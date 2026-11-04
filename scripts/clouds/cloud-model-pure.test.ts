import { describe, expect, it } from 'vitest';

import { AV_PER_NH_PC } from '../../src/astro-core/baker-constants';
import {
  AK_OVER_AV,
  MASS_CAP_FACTOR,
  MIN_AXIS_PC,
  MSUN_PER_NH_PC3,
  calibrate,
  cloudClass,
  columnIntegralPc,
  fnv1a32,
  GAL_TO_ICRS_ROWS,
  galToIcrs,
  profiledClouds,
  volumeIntegralPc3,
} from './cloud-model-pure';

describe('fnv1a32', () => {
  it('matches the seeds clouds.json has always carried', () => {
    expect(fnv1a32('Aquila_Rift')).toBe(2205295212);
    expect(fnv1a32('Aquila_S')).toBe(2340026984);
    expect(fnv1a32('')).toBe(0x811c9dc5);
  });
});

describe('cloudClass', () => {
  it('reads the curated table and defaults to dark', () => {
    expect(cloudClass('Oriona')).toBe('hii');
    expect(cloudClass('Ophiuchus')).toBe('sf');
    expect(cloudClass('Somewhere')).toBe('dark');
    expect(cloudClass('toString')).toBe('dark');
  });
});

describe('frames', () => {
  it('rotates galactic +X onto the galactic centre direction', () => {
    const icrs = galToIcrs([1, 0, 0]);
    const raDeg = (Math.atan2(icrs[1], icrs[0]) * 180) / Math.PI + 360;
    expect(raDeg).toBeCloseTo(266.4051, 4);
  });

  it('writes the rotation rows the matrix applies', () => {
    const v = [3, -2, 5] as const;
    const rows = GAL_TO_ICRS_ROWS.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
    expect(rows).toEqual(galToIcrs(v));
  });
});

describe('the integrals', () => {
  it('reduce to the chord length and ellipsoid volume for a flat profile with no taper reach', () => {
    const flat = { rflat: 1e9, p: 2 };
    expect(columnIntegralPc(flat.rflat, flat.p, 10, 1, 4001)).toBeCloseTo(2 * 10 * (0.85 + 0.15 * 0.5), 3);
    const unit = volumeIntegralPc3(flat.rflat, flat.p, [1, 1, 1], 1, 4001);
    expect(unit).toBeLessThan((4 / 3) * Math.PI);
    expect(unit).toBeGreaterThan((4 / 3) * Math.PI * 0.85 ** 3);
  });
});

describe('calibrate', () => {
  const fit = { n0: 0, rflat: 3, p: 2 };
  const axes = [20, 10, 5] as const;

  it('solves the column for the target at the full envelope when the mass budget holds', () => {
    const c = calibrate(fit, axes, 2, 1e9);
    expect(c.uEnv).toBe(1);
    expect(c.n0Cal * AV_PER_NH_PC * columnIntegralPc(fit.rflat, fit.p, 5)).toBeCloseTo(2, 12);
  });

  it('tightens the envelope until the mass sits at the cap', () => {
    const loose = calibrate(fit, axes, 2, 1e9);
    const massLeike = loose.massModel / (2 * MASS_CAP_FACTOR);
    const c = calibrate(fit, axes, 2, massLeike);
    expect(c.uEnv).toBeLessThan(1);
    expect(c.massModel).toBeLessThanOrEqual(MASS_CAP_FACTOR * massLeike);
    expect(c.massModel / (MASS_CAP_FACTOR * massLeike)).toBeCloseTo(1, 6);
    expect(MSUN_PER_NH_PC3).toBeGreaterThan(0);
  });
});

describe('profiledClouds', () => {
  it('keeps only boxes with both a fit and masses, floors the axes and targets peak A_K as A_V', () => {
    const extents = [
      { cloud: 'Musca', xmin: 0, xmax: 20, ymin: 0, ymax: 1, zmin: -4, zmax: 4 },
      { cloud: 'Coraus', xmin: 0, xmax: 1, ymin: 0, ymax: 1, zmin: 0, zmax: 1 },
    ];
    const fits = new Map([['Musca', { n0: 1, rflat: 1, p: 2 }]]);
    const masses = new Map([['Musca', { massNicest: 1, massLeike: 1e9, maxAkLeike: 0.19 }]]);
    const [musca, ...rest] = profiledClouds(extents, fits, masses);
    expect(rest).toEqual([]);
    expect(musca.rawName).toBe('Musca');
    expect(musca.axesGalPc).toEqual([10, MIN_AXIS_PC, 4]);
    expect(musca.avColumnTarget).toBe(0.19 / AK_OVER_AV);
  });
});
