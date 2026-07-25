import { describe, it, expect } from 'vitest';
import {
  DUST_STEPS,
  R_V,
  decodeDensity,
  dustRaymarchAv,
  ebvFromAv,
  reddenedBv,
  type DustDecodeParams,
} from './dust-raymarch-pure';

// Manifest-matching decode window (public/dust/manifest.json): the full
// ±1250 pc cube, the pure-log density window [1e-7, 0.2] E_ZGR/pc, and
// the 2.742 A_V-per-density factor. World coordinate of a volume sample
// is (uvw − 0.5) × 2·boundsPc.
const P: DustDecodeParams = {
  boundsPc: 1250,
  densityMin: 1e-7,
  logRatio: Math.log(0.2 / 1e-7),
  avPerDensityPc: 2.742,
};
const worldFromU = (u: number) => (u - 0.5) * 2 * P.boundsPc;

describe('dust decode', () => {
  it('inverts the u8 log-window encoding at the endpoints', () => {
    expect(decodeDensity(0, P)).toBeCloseTo(1e-7, 12);
    expect(decodeDensity(1, P)).toBeCloseTo(0.2, 9);
  });
});

describe('dustRaymarchAv — synthetic single-cloud fixtures', () => {
  it('collapses to the closed form for a uniform field', () => {
    // Constant density → the 48-tap midpoint sum is exact: every step
    // samples the same decoded density, so A_V = ρ · pathLength · rate.
    const av = dustRaymarchAv([0, 0, 0], [100, 0, 0], () => 0.85, P);
    const closed = decodeDensity(0.85, P) * 100 * P.avPerDensityPc;
    expect(Math.abs(av - closed)).toBeLessThan(1e-9);
    expect(av).toBeCloseTo(6.222185389989775, 9);
  });

  it('integrates a Gaussian core through its centre', () => {
    // A single cloud: peak encoded 0.9, ~15 pc Gaussian falloff, marched
    // straight through the centre along x (y = z = 0 → v = w = 0.5).
    const core = (u: number, v: number, w: number) => {
      void v;
      void w;
      const x = worldFromU(u);
      return 0.9 * Math.exp(-((x / 15) ** 2));
    };
    const av = dustRaymarchAv([-100, 0, 0], [100, 0, 0], core, P);
    expect(av).toBeCloseTo(0.975938779837472, 9);

    // B−V shift is E(B−V) = A_V / R_V on top of the intrinsic colour.
    expect(ebvFromAv(av)).toBeCloseTo(0.3148189612378942, 9);
    // An intrinsically blue O star (B−V ≈ −0.30) reddens toward neutral.
    expect(reddenedBv(-0.3, av)).toBeCloseTo(0.014818961237894224, 9);
  });

  it('clamps samples outside the voxel cube (bbox skip)', () => {
    // Marches ±2000 pc — the ends lie beyond ±1250; 18 of 48 midpoints
    // fall outside [0,1] and contribute nothing.
    const av = dustRaymarchAv([-2000, 0, 0], [2000, 0, 0], () => 0.85, P);
    expect(av).toBeCloseTo(155.55463474974437, 8);
  });

  it('returns zero for a fully out-of-cube path', () => {
    const av = dustRaymarchAv([2000, 2000, 2000], [3000, 3000, 3000], () => 1, P);
    expect(av).toBe(0);
  });

  it('returns zero for a degenerate zero-length path', () => {
    const av = dustRaymarchAv([10, 10, 10], [10, 10, 10], () => 1, P);
    expect(av).toBe(0);
  });
});

describe('reddening constants', () => {
  it('pins the step count and global R_V', () => {
    expect(DUST_STEPS).toBe(48);
    expect(R_V).toBe(3.1);
  });

  it('E(B−V) = A_V / R_V', () => {
    expect(ebvFromAv(2.742)).toBeCloseTo(0.8845161290322581, 12);
    expect(reddenedBv(-0.3, 2.742)).toBeCloseTo(0.584516129032258, 12);
  });
});
