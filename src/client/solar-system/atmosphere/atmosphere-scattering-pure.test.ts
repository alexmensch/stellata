import { describe, expect, it } from 'vitest';
import {
  ATMO_N_LIGHT,
  ATMO_N_VIEW,
  type AtmosphereParams,
  type Vec3,
  litFraction,
  miePhase,
  rayleighPhase,
  scatterAlongRay,
  shadowSpan,
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

describe('shadowSpan', () => {
  const SUN: Vec3 = [1, 0, 0];

  it('is unbounded behind the terminator for a ray down the shadow axis', () => {
    // Impact parameter never changes on this ray, so the cylinder never ends;
    // the terminator plane is the only boundary it has.
    const [s0, s1] = shadowSpan([-5, 0, 0], [-1, 0, 0], SUN);
    expect(s0).toBe(-5);
    expect(s1).toBeGreaterThan(1e6);
  });

  it('is empty for a ray that misses the cylinder', () => {
    const [s0, s1] = shadowSpan([0, 5, 0], [0, 0, 1], SUN);
    expect(s0).toBeGreaterThan(s1);
  });

  it('is empty for a ray wholly sunward of the terminator plane', () => {
    // Inside the cylinder by impact parameter, but in FRONT of the body — the
    // half-space is what stops the cylinder shadowing the lit hemisphere.
    const [s0, s1] = shadowSpan([2, -5, 0], [0, 1, 0], SUN);
    expect(s0).toBeGreaterThan(s1);
  });

  it('brackets the cylinder crossing exactly', () => {
    // Crossing the axis 2 radii behind the body: enters and leaves where the
    // impact parameter is 1, so the chord is the cylinder's full diameter.
    const [s0, s1] = shadowSpan([-2, -5, 0], [0, 1, 0], SUN);
    expect(s0).toBeCloseTo(4, 12);
    expect(s1).toBeCloseTo(6, 12);
  });
});

describe('litFraction', () => {
  it('is 0 for a segment inside the shadow and 1 for one outside', () => {
    expect(litFraction(5, 0.5, [4, 6])).toBe(0);
    expect(litFraction(2, 0.5, [4, 6])).toBe(1);
  });

  it('splits a segment straddling the shadow edge by exact coverage', () => {
    expect(litFraction(4, 0.5, [4, 6])).toBeCloseTo(0.5, 12);
    expect(litFraction(3.9, 0.5, [4, 6])).toBeCloseTo(0.6, 12);
  });
});

describe('how far past the terminator sunlight reaches', () => {
  const SUN: Vec3 = [1, 0, 0];
  const EARTH_RATMO = (6371 + 100) / 6371;

  /** Is a point lit? Any ray through it answers — the span is the interval
   *  the point's own t = 0 either falls in or does not. */
  function pointLit(radius: number, deltaDeg: number): number {
    const a = (deltaDeg * Math.PI) / 180;
    const p: Vec3 = [-radius * Math.sin(a), radius * Math.cos(a), 0];
    return litFraction(0, 1e-9, shadowSpan(p, [0, 0, 1], SUN));
  }

  it('never reaches the ground past the terminator', () => {
    // The defect this replaces: a fixed 0.15-radius soft band admitted
    // full-density samples out to acos(0.85) = 31.8°, and the airglow arc it
    // painted was that wide.
    expect(pointLit(1, -1)).toBe(1);
    expect(pointLit(1, 1)).toBe(0);
    expect(pointLit(1, 20)).toBe(0);
    expect(Math.acos(1 - 0.15) * (180 / Math.PI)).toBeCloseTo(31.79, 2);
  });

  it('reaches as far past it as a sample\'s own altitude lifts it clear', () => {
    // Earth's shell top clears the cylinder to acos(1/1.0157) = 10.1°, and
    // that arc is faint because it is 100 km up — 12 scale heights of density
    // gone. Altitude sets the reach; density sets what you can see of it.
    expect(Math.acos(1 / EARTH_RATMO) * (180 / Math.PI)).toBeCloseTo(10.09, 2);
    expect(pointLit(EARTH_RATMO, 9)).toBe(1);
    expect(pointLit(EARTH_RATMO, 11)).toBe(0);
  });

  it('resolves the terminator crossing without quantising the lit count', () => {
    // A limb chord under a rotating sun. Coverage weights make the summed lit
    // count continuous in the geometry, so refining the sweep 10× shrinks the
    // largest step ~10×. A point-per-sample test steps by exactly 1 whatever
    // the sweep — those steps ARE the terminator contours.
    const [t0, t1] = chord(O, D, RATMO);
    const segLen = (t1 - t0) / ATMO_N_VIEW;
    const litCount = (phiDeg: number) => {
      const phi = (phiDeg * Math.PI) / 180;
      const sun: Vec3 = [Math.cos(phi), 0, Math.sin(phi)];
      const span = shadowSpan(O, D, sun);
      let sum = 0;
      for (let i = 0; i < ATMO_N_VIEW; i++) {
        sum += litFraction(t0 + (i + 0.5) * segLen, 0.5 * segLen, span);
      }
      return sum;
    };
    const maxStep = (stepDeg: number) => {
      let prev = litCount(60);
      let worst = 0;
      for (let phi = 60 + stepDeg; phi <= 170; phi += stepDeg) {
        const cur = litCount(phi);
        worst = Math.max(worst, Math.abs(cur - prev));
        prev = cur;
      }
      return worst;
    };
    const coarse = maxStep(0.2);
    const fine = maxStep(0.02);
    expect(coarse).toBeGreaterThan(0);
    expect(fine).toBeLessThan(coarse / 5);
    expect(fine).toBeLessThan(0.1);
  });
});

describe('sample-count constants', () => {
  it('are pinned integers (loop bounds shared with the shader defines)', () => {
    // Headline march budget: a change is a deliberate perf/quality retune, so
    // it should trip this pin (the #defines are seeded from these constants).
    expect(ATMO_N_VIEW).toBe(16);
    expect(ATMO_N_LIGHT).toBe(10);
  });
});
