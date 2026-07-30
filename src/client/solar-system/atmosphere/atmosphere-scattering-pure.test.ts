import { describe, expect, it } from 'vitest';
import {
  ATMO_N_LIGHT,
  ATMO_N_VIEW,
  type AtmosphereParams,
  MS_STRENGTH,
  TWILIGHT_TAIL_AMP,
  TWILIGHT_TAIL_REACH,
  type Vec3,
  litFraction,
  miePhase,
  rayleighPhase,
  scalePolarComponent,
  scatterAlongRay,
  shadowSpan,
  skyIrradianceDiscMeanLuma,
  skyIrradianceFrac,
  verticalAbsorptionOpticalDepth,
  verticalScatterOpticalDepth,
} from './atmosphere-scattering-pure';
import { SOL_BODIES } from '../planet-system';

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
    // Opacity and sunlit-fraction are both ~1 here and single scatter has
    // self-extinguished, so the fill IS the airlight — keyed to MS_STRENGTH
    // rather than a literal, since retuning the weight must not fail this.
    expect(Math.min(...r.inscatter)).toBeGreaterThan(0.8 * MS_STRENGTH);
  });

  it('jitter offsets the sample lattice (shader anti-banding) without breaking sign', () => {
    const a = scatterAlongRay(O, D, T0, T1, SUN_DAY, EARTH, 0.5);
    const b = scatterAlongRay(O, D, T0, T1, SUN_DAY, EARTH, 0.1);
    expect(a.inscatter[2]).toBeGreaterThan(0);
    expect(b.inscatter[2]).toBeGreaterThan(0);
    expect(a.inscatter[2]).not.toBe(b.inscatter[2]);
  });
});

describe('scalePolarComponent — the oblate body → unit sphere frame', () => {
  const POLE: Vec3 = [0, 0, 1];
  const EARTH_POLAR = 1 - 0.00335;

  it('leaves the equatorial plane alone', () => {
    expect(scalePolarComponent([1, 0, 0], POLE, 1 / EARTH_POLAR)).toEqual([1, 0, 0]);
  });

  it('lifts the body’s pole onto the unit sphere', () => {
    // A point at the spheroid's pole sits at 1 − f; the deflattened frame is
    // where the march's rPlanet = 1 is true of the body actually drawn.
    const p = scalePolarComponent([0, 0, EARTH_POLAR], POLE, 1 / EARTH_POLAR);
    expect(p[2]).toBeCloseTo(1, 12);
  });

  it('round-trips through its own inverse', () => {
    const v: Vec3 = [0.3, -0.5, 0.81];
    const there = scalePolarComponent(v, POLE, 1 / EARTH_POLAR);
    const back = scalePolarComponent(there, POLE, EARTH_POLAR);
    for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(v[i], 12);
  });

  it('maps an ellipsoid normal to the surface point it belongs to', () => {
    // Normals scale by the inverse transpose, which for this diagonal map is
    // the inverse: squash, renormalise, and you have the unit-sphere point.
    // Reading uRadiusPc·normal as the point instead is what put the mesh's
    // airlight chord up to f·R off at the limb.
    const a = 1;
    const c = EARTH_POLAR;
    const th = 0.7;
    // Surface point of x²/a² + z²/c² = 1, and its outward normal.
    const p: Vec3 = [a * Math.cos(th), 0, c * Math.sin(th)];
    const nLen = Math.hypot(p[0] / (a * a), p[2] / (c * c));
    const n: Vec3 = [p[0] / (a * a) / nLen, 0, p[2] / (c * c) / nLen];

    const squashed = scalePolarComponent(n, POLE, c);
    const len = Math.hypot(...squashed);
    const unitPoint: Vec3 = [squashed[0] / len, squashed[1] / len, squashed[2] / len];
    // Deflattening the true surface point must land on the same place.
    const viaPoint = scalePolarComponent(p, POLE, 1 / c);
    for (let i = 0; i < 3; i++) expect(unitPoint[i]).toBeCloseTo(viaPoint[i], 12);
    // And the naive reading is off by ~f at this latitude — the defect's size.
    expect(Math.abs(n[2] - viaPoint[2])).toBeGreaterThan(0.001);
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

  it('is exactly 0 deep in shadow, at any camera distance, in float32', () => {
    // The anti-solar face. t is the ray parameter from the CAMERA, so t ± h
    // are large and nearly equal; differencing them before clamping loses
    // float32 bits that 1/(2h) then amplifies ~1/h — full-strength sunlight
    // speckling the dark side, patterned by the march jitter because the
    // jitter is what varies t between neighbouring fragments.
    const f = Math.fround;
    const h = 4.9e-4; // half a nadir march step through Earth's 100 km
    const span: readonly [number, number] = [-1e20, 60];
    let worstNaive = 0;
    for (let k = 0; k < 64; k++) {
      const t = 50 + (k / 64) * h * 8; // the jitter sliding the lattice
      const naive = 1 - (f(f(t) + f(h)) - f(f(t) - f(h))) / (2 * h);
      worstNaive = Math.max(worstNaive, Math.abs(naive));
      expect(litFraction(t, h, span)).toBe(0);
    }
    expect(worstNaive).toBeGreaterThan(1e-3);
  });

  it('is exactly 1 where the ray never enters the shadow at all', () => {
    // The empty-span sentinel has to read as empty against ANY ray parameter,
    // not just ones outside it.
    expect(litFraction(0, 1e-3, shadowSpan([0, 5, 0], [0, 0, 1], [1, 0, 0]))).toBe(1);
    expect(litFraction(1e4, 1e-3, shadowSpan([0, 5, 0], [0, 0, 1], [1, 0, 0]))).toBe(1);
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

describe('skylight on the surface — derived, anchored to measured Earth twilight', () => {
  // Measured Earth horizontal illuminance (lx) against ~100 klx full sun,
  // by solar depression angle (Allen's Astrophysical Quantities): the
  // geometric terminator, then civil / nautical / astronomical twilight.
  const MEASURED_LX: Record<number, number> = { 0: 400, 6: 3.4, 12: 0.008, 18: 0.0006 };
  const FULL_SUN_LX = 100000;

  const rowOf = (name: string) => {
    const body = SOL_BODIES.find((b) => b.name === name)!;
    const atmo = body.atmosphere!;
    const hR = atmo.rayleighHeightKm / body.radiusKm;
    const hM = atmo.mieHeightKm / body.radiusKm;
    const params: AtmosphereParams = {
      rAtmo: (body.radiusKm + atmo.heightKm) / body.radiusKm,
      hR,
      hM,
      betaRs: [atmo.rayleighCoeff[0] / hR, atmo.rayleighCoeff[1] / hR, atmo.rayleighCoeff[2] / hR],
      betaMs: atmo.mieCoeff / hM,
      betaA: [atmo.absorbCoeff[0] / hM, atmo.absorbCoeff[1] / hM, atmo.absorbCoeff[2] / hM],
      g: 0.76,
    };
    return { atmo, hR, tauS: verticalScatterOpticalDepth(params), tauA: verticalAbsorptionOpticalDepth(params) };
  };

  const LUMA: Vec3 = [0.2126, 0.7152, 0.0722];
  const earth = rowOf('Earth');
  const { hR, tauS, tauA } = earth;
  const frac = (deltaDeg: number) =>
    dot(LUMA, skyIrradianceFrac(-Math.sin((deltaDeg * Math.PI) / 180), hR, tauS, tauA));

  it('recovers the vertical scattering optical depth from the per-body row', () => {
    // βRs·hR undoes the /hR the mesh layer applies, so the table's authored
    // vertical optical depths come straight back out.
    expect(tauS[2]).toBeCloseTo(earth.atmo.rayleighCoeff[2] + earth.atmo.mieCoeff, 12);
  });

  it('re-derives the tail constants from the measured illuminance table', () => {
    // The second exponential runs through the 12° and 18° points exactly;
    // the constants are that closed-form fit, nothing judged.
    const h = (d: number) => 1 / Math.cos((d * Math.PI) / 180) - 1;
    const r12 = MEASURED_LX[12] / MEASURED_LX[0];
    const r18 = MEASURED_LX[18] / MEASURED_LX[0];
    const reach = (h(18) - h(12)) / Math.log(r12 / r18) / hR;
    const amp = r12 * Math.exp(h(12) / (reach * hR));
    expect(TWILIGHT_TAIL_REACH).toBeCloseTo(reach, 1);
    expect(TWILIGHT_TAIL_AMP / amp).toBeCloseTo(1, 2);
  });

  it('holds the measured terminator anchor within a factor of 2', () => {
    // ¼·τ_s·T̄(τ_ext·Ch): the ¼ is the hemispheric down-flux of an isotropic
    // in-scatter over the half-dome the horizon sun still lights; T̄ is the
    // column-mean transmission of a horizon sun through Chapman airmass —
    // README.md § Twilight. Residual +75 % is the un-modelled ozone Chappuis
    // absorption and up-scatter loss, both of which only push down.
    const measured = MEASURED_LX[0] / FULL_SUN_LX;
    expect(frac(0)).toBeCloseTo(7.0e-3, 4);
    expect(frac(0) / measured).toBeGreaterThan(1);
    expect(frac(0) / measured).toBeLessThan(2);
  });

  it('holds civil twilight (6°) within a factor of 1.5', () => {
    const measured = MEASURED_LX[6] / MEASURED_LX[0];
    expect(frac(6) / frac(0) / measured).toBeGreaterThan(1 / 1.5);
    expect(frac(6) / frac(0) / measured).toBeLessThan(1.5);
  });

  it('follows the measured tail through nautical (12°) and astronomical (18°) twilight', () => {
    // The old single exponential sat 1000x dark at 12° and ~1e12x at 18°.
    expect(frac(12) / frac(0) / (MEASURED_LX[12] / MEASURED_LX[0])).toBeCloseTo(1.0, 1);
    expect(frac(18) / frac(0) / (MEASURED_LX[18] / MEASURED_LX[0])).toBeCloseTo(1.0, 1);
  });

  it('is blue on Earth — the twilight carries the air\'s own hue', () => {
    const t = skyIrradianceFrac(0, hR, tauS, tauA);
    expect(t[2]).toBeGreaterThan(t[0]);
  });

  it('day-side skylight rises with solar elevation to the measured noon share', () => {
    // Noon diffuse-to-direct on clear Earth measures ~10-15 %; the beam-
    // interception term (single scatter, no ground bounce) lands just under.
    const noon = dot(LUMA, skyIrradianceFrac(1, hR, tauS, tauA));
    const directHoriz = dot(LUMA, [
      Math.exp(-(tauS[0] + tauA[0])), Math.exp(-(tauS[1] + tauA[1])), Math.exp(-(tauS[2] + tauA[2])),
    ] as Vec3);
    expect(noon).toBeCloseTo(0.0745, 3);
    expect(noon / directHoriz).toBeGreaterThan(0.05);
    expect(noon / directHoriz).toBeLessThan(0.15);
    const at = (mu: number) => dot(LUMA, skyIrradianceFrac(mu, hR, tauS, tauA));
    expect(at(1)).toBeGreaterThan(at(0.5));
    expect(at(0.5)).toBeGreaterThan(at(0.1));
    expect(at(0.1)).toBeGreaterThan(at(0));
  });

  it('is continuous across the terminator', () => {
    expect(dot(LUMA, skyIrradianceFrac(1e-7, hR, tauS, tauA)))
      .toBeCloseTo(dot(LUMA, skyIrradianceFrac(-1e-7, hR, tauS, tauA)), 6);
  });

  it('scales with the scattering optical depth, so thick air means bright dusk', () => {
    // Titan — the thickest row — outshines Earth at its own terminator even
    // through its blue-absorbing haze.
    const titan = rowOf('Titan');
    const titanDusk = dot(LUMA, skyIrradianceFrac(0, titan.hR, titan.tauS, titan.tauA));
    expect(titanDusk).toBeGreaterThan(frac(0));
  });

  it('pins the full-phase disc mean the flux divisor folds in', () => {
    // ~7 % of host irradiance on Earth — the size of the overshoot the
    // meshSurfaceLuminance divisor now cancels (emission/mesh-surface-pure.ts).
    expect(skyIrradianceDiscMeanLuma(hR, tauS, tauA)).toBeCloseTo(0.0705, 3);
    const titan = rowOf('Titan');
    expect(skyIrradianceDiscMeanLuma(titan.hR, titan.tauS, titan.tauA)).toBeCloseTo(0.157, 2);
  });

  it('reaches further past the terminator on Titan — the scale height sets the band', () => {
    const titan = rowOf('Titan');
    const titanTail = (d: number) =>
      dot(LUMA, skyIrradianceFrac(-Math.sin((d * Math.PI) / 180), titan.hR, titan.tauS, titan.tauA))
      / dot(LUMA, skyIrradianceFrac(0, titan.hR, titan.tauS, titan.tauA));
    expect(titanTail(12)).toBeGreaterThan(100 * (frac(12) / frac(0)));
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
