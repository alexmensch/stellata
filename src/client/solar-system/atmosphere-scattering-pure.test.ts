import { describe, expect, it } from 'vitest';
import {
  ATMO_N_LIGHT,
  ATMO_N_VIEW,
  type AtmosphereParams,
  SHADOW_SOFT,
  type Vec3,
  miePhase,
  rayleighPhase,
  scatterAlongRay,
  sunLit,
} from './atmosphere-scattering-pure';

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Both roots of |o + t·d| = radius (d unit, sphere at origin). */
function chord(o: Vec3, d: Vec3, radius: number): [number, number] {
  const b = dot(o, d);
  const c = dot(o, o) - radius * radius;
  const s = Math.sqrt(b * b - c);
  return [-b - s, -b + s];
}

// A limb ray on the +x side, travelling −z at impact parameter 1.02 (between
// the surface at 1 and the shell top at 1.05).
const RATMO = 1.05;
const O: Vec3 = [1.02, 0, 5];
const D: Vec3 = [0, 0, -1];
const [T0, T1] = chord(O, D, RATMO);
const SUN_DAY: Vec3 = [1, 0, 0]; // +x limb sunlit
const SUN_NIGHT: Vec3 = [-1, 0, 0]; // +x limb in shadow

const EARTH: AtmosphereParams = {
  rAtmo: RATMO,
  hR: 0.02,
  hM: 0.02,
  betaRs: [0.1, 0.25, 0.6], // 1/λ⁴ → blue-heavy
  betaMs: 0.05,
  betaA: [0, 0, 0],
  g: 0.76,
};

// Titan-flavoured: grey Mie scatter dominant, strong blue absorption.
const TITAN: AtmosphereParams = {
  rAtmo: 1.1,
  hR: 0.02,
  hM: 0.02,
  betaRs: [0.2, 0.4, 0.8],
  betaMs: 8,
  betaA: [0.5, 2, 5], // blue removed → orange
  g: 0.8,
};

describe('phase functions', () => {
  it('Rayleigh: 3/16π at right angles, double forward/back', () => {
    expect(rayleighPhase(0)).toBeCloseTo(3 / (16 * Math.PI), 10);
    expect(rayleighPhase(1)).toBeCloseTo(2 * rayleighPhase(0), 10);
    expect(rayleighPhase(-1)).toBeCloseTo(rayleighPhase(1), 10);
  });

  it('Mie is forward-peaked for g > 0', () => {
    expect(miePhase(1, 0.76)).toBeGreaterThan(miePhase(-1, 0.76));
    expect(miePhase(0.99, 0.8)).toBeGreaterThan(miePhase(0, 0.8));
  });
});

describe('scatterAlongRay', () => {
  it('empty span → no airlight, full transmittance', () => {
    const r = scatterAlongRay(O, D, 3, 3, SUN_DAY, EARTH);
    expect(r.inscatter).toEqual([0, 0, 0]);
    expect(r.transmittance).toEqual([1, 1, 1]);
  });

  it('Earth day-side limb: blue airlight dominates, all channels lit', () => {
    const r = scatterAlongRay(O, D, T0, T1, SUN_DAY, EARTH);
    expect(r.inscatter[0]).toBeGreaterThan(0);
    expect(r.inscatter[2]).toBeGreaterThan(r.inscatter[1]);
    expect(r.inscatter[1]).toBeGreaterThan(r.inscatter[0]); // B > G > R
  });

  it('Earth: transmittance below 1, blue attenuated most', () => {
    const r = scatterAlongRay(O, D, T0, T1, SUN_DAY, EARTH);
    expect(r.transmittance[0]).toBeLessThan(1);
    expect(r.transmittance[2]).toBeLessThan(r.transmittance[0]); // blue lost more
  });

  it('night side (sun behind the limb): airlight collapses to ~0', () => {
    const r = scatterAlongRay(O, D, T0, T1, SUN_NIGHT, EARTH);
    expect(r.inscatter[0]).toBeLessThan(1e-6);
    expect(r.inscatter[1]).toBeLessThan(1e-6);
    expect(r.inscatter[2]).toBeLessThan(1e-6);
  });

  it('Titan absorption: airlight and transmittance both redden (orange)', () => {
    const r = scatterAlongRay(O, D, chord(O, D, 1.1)[0], chord(O, D, 1.1)[1], SUN_DAY, TITAN);
    expect(r.inscatter[0]).toBeGreaterThan(r.inscatter[2]); // red > blue
    expect(r.transmittance[0]).toBeGreaterThan(r.transmittance[2]); // blue absorbed
  });

  it('thick haze lights up via the multiple-scattering fill (not black)', () => {
    // Single scatter self-extinguishes at this thickness; the isotropic MS
    // fill is what keeps a Venus-class disc bright rather than going dark.
    const venus: AtmosphereParams = {
      rAtmo: 1.05, hR: 0.02, hM: 0.02,
      betaRs: [0.01, 0.02, 0.05], betaMs: 40, betaA: [0.05, 0.1, 0.2], g: 0.7,
    };
    const r = scatterAlongRay(O, D, T0, T1, SUN_DAY, venus);
    expect(r.transmittance[0]).toBeLessThan(0.05); // surface behind is extinguished
    expect(Math.min(...r.inscatter)).toBeGreaterThan(0.1); // yet the disc is lit
  });

  it('jitter offsets the sample lattice (shader anti-banding) without breaking sign', () => {
    const a = scatterAlongRay(O, D, T0, T1, SUN_DAY, EARTH, 0.5);
    const b = scatterAlongRay(O, D, T0, T1, SUN_DAY, EARTH, 0.1);
    expect(a.inscatter[2]).toBeGreaterThan(0);
    expect(b.inscatter[2]).toBeGreaterThan(0);
    expect(a.inscatter[2]).not.toBe(b.inscatter[2]);
  });
});

describe('sunLit — soft planetary shadow terminator', () => {
  const SUN: Vec3 = [1, 0, 0];

  it('fully lit deep on the sunward hemisphere', () => {
    expect(sunLit(1, 0, 0, ...SUN)).toBe(1);
  });

  it('fully dark deep in the shadow cylinder (anti-sunward, inside radius)', () => {
    expect(sunLit(-1, 0, 0, ...SUN)).toBe(0);
  });

  it('half-lit at the terminator plane on the surface', () => {
    // sunT = 0, impact = 1 → axial term 0, radial smoothstep centred at 1 → 0.5.
    expect(sunLit(0, 1, 0, ...SUN)).toBeCloseTo(0.5, 12);
  });

  it('lit above the shadow cylinder even on the night side (twilight)', () => {
    // Anti-sunward but impact clears the cylinder by more than SHADOW_SOFT.
    expect(sunLit(-1, 1 + SHADOW_SOFT + 0.01, 0, ...SUN)).toBe(1);
  });

  it('varies continuously across the terminator (no quantised jump)', () => {
    let prev = sunLit(0, 1 - 0.3, 0, ...SUN);
    let maxStep = 0;
    for (let k = 1; k <= 60; k++) {
      const y = 1 - 0.3 + (0.6 * k) / 60; // sweep impact through the soft band
      const cur = sunLit(0, y, 0, ...SUN);
      maxStep = Math.max(maxStep, Math.abs(cur - prev));
      prev = cur;
    }
    // A hard 0/1 test would jump by 1.0 in a single step; the soft band caps it.
    expect(maxStep).toBeLessThan(0.1);
  });
});

describe('sample-count constants', () => {
  it('are positive integers (loop bounds shared with the shader defines)', () => {
    expect(Number.isInteger(ATMO_N_VIEW) && ATMO_N_VIEW > 0).toBe(true);
    expect(Number.isInteger(ATMO_N_LIGHT) && ATMO_N_LIGHT > 0).toBe(true);
  });
});
