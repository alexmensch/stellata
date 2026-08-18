import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  EARTH_PHASE,
  JUPITER_PHASE,
  MARS_PHASE,
  MERCURY_PHASE,
  MOON_PHASE,
  SATURN_PHASE,
  VENUS_PHASE,
  type PhaseCoefficients,
  lambertianPhaseFactor,
  empiricalPhaseFactor,
  alphaZeroPhaseFactor,
  phaseAngleFor,
  phaseFactorFor,
  phaseRatioToLambert,
  illuminatedFraction,
  PHASE_RATIO_MAX,
  PHASE_RATIO_MIN,
} from './phase-function';

const DEG = Math.PI / 180;

describe('lambertianPhaseFactor', () => {
  it('returns 1 at full phase (α = 0)', () => {
    expect(lambertianPhaseFactor(0)).toBeCloseTo(1, 12);
  });

  it('returns 0 at new phase (α = π)', () => {
    expect(lambertianPhaseFactor(Math.PI)).toBeCloseTo(0, 12);
  });

  it('returns 1/π at half phase (α = π/2)', () => {
    expect(lambertianPhaseFactor(Math.PI / 2)).toBeCloseTo(1 / Math.PI, 12);
  });

  it('is monotone decreasing in α over [0, π]', () => {
    let prev = Infinity;
    for (let a = 0; a <= Math.PI; a += 0.05) {
      const v = lambertianPhaseFactor(a);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });

  it('clamps α defensively outside [0, π]', () => {
    expect(lambertianPhaseFactor(-1)).toBeCloseTo(1, 12);
    expect(lambertianPhaseFactor(Math.PI + 1)).toBeCloseTo(0, 12);
  });
});

describe('empiricalPhaseFactor', () => {
  it('returns Lambertian when alphaMaxDeg sentinel = 0', () => {
    const empty: PhaseCoefficients = {
      c0: 0, c1: 0, c2: 0, c3: 0, c4: 0, c5: 0, c6: 0, c7: 0, alphaMaxDeg: 0,
    };
    for (const aDeg of [0, 30, 90, 150]) {
      expect(empiricalPhaseFactor(empty, aDeg * DEG))
        .toBeCloseTo(lambertianPhaseFactor(aDeg * DEG), 12);
    }
  });

  it('beyond αmax: anchor-scaled Lambert (continuous at the boundary)', () => {
    // Mars: alphaMaxDeg = 50°. At 60° we want
    //   Lambert(60°) × poly(50°) / Lambert(50°)
    // — anchor-scaled, NOT pure Lambert (which would step) and NOT
    // the extrapolated polynomial (which would over-brighten).
    const aMax = MARS_PHASE.alphaMaxDeg * DEG;
    const polyAtBoundary = empiricalPhaseFactor(MARS_PHASE, aMax);
    const lambertAtBoundary = lambertianPhaseFactor(aMax);
    const k = polyAtBoundary / lambertAtBoundary;
    const a60 = 60 * DEG;
    expect(empiricalPhaseFactor(MARS_PHASE, a60))
      .toBeCloseTo(lambertianPhaseFactor(a60) * k, 10);
    // Mars darkens faster than a Lambertian sphere at moderate α:
    // k < 1, so the anchor-scaled Lambert past 50° stays dimmer than
    // pure Lambert.
    expect(k).toBeLessThan(1);
  });

  it('Saturn continuity: no brightness step across α = αmax', () => {
    // Saturn's c0 = −0.55 lifts polynomial flux to ~1.42 just inside
    // αmax = 6.5°; pure Lambert at 6.5° is ~0.99, so the prior
    // implementation showed a ~30% brightness drop at the boundary.
    // Anchor-scaled Lambert past αmax eliminates the step by
    // construction (right-limit ≡ left-limit).
    const eps = 1e-6;
    const aMax = SATURN_PHASE.alphaMaxDeg * DEG;
    const lhs = empiricalPhaseFactor(SATURN_PHASE, aMax - eps);
    const rhs = empiricalPhaseFactor(SATURN_PHASE, aMax + eps);
    expect(rhs).toBeCloseTo(lhs, 5);
    // Sanity: the anchor preserves Saturn's ring boost past αmax —
    // anchored Lambert sits well above 1, not the ~0.99 a naive
    // Lambert would give.
    expect(rhs).toBeGreaterThan(1.4);
  });

  it('Mars continuity: no brightness step across α = αmax', () => {
    // Same continuity check for Mars (smaller jump, opposite
    // direction — polynomial dimmer than Lambert at 50°).
    const eps = 1e-6;
    const aMax = MARS_PHASE.alphaMaxDeg * DEG;
    const lhs = empiricalPhaseFactor(MARS_PHASE, aMax - eps);
    const rhs = empiricalPhaseFactor(MARS_PHASE, aMax + eps);
    expect(rhs).toBeCloseTo(lhs, 5);
  });

  it('clamps α defensively outside [0, π] (sibling-symmetric with Lambert)', () => {
    // Negative α → clamped to 0. For c0 = 0 planets, the polynomial
    // value at α = 0 is exactly 1.
    expect(empiricalPhaseFactor(MARS_PHASE, -1)).toBeCloseTo(1, 12);
    // α > π → clamped to π. π in degrees = 180°, beyond every
    // published αmax, so this lands on the anchor-Lambert path with
    // Lambert(π) = 0 ⇒ φ = 0 regardless of the anchor multiplier.
    expect(empiricalPhaseFactor(MARS_PHASE, Math.PI + 1)).toBeCloseTo(0, 12);
    // Saturn at negative α → clamped to 0 → polynomial gives the c0
    // ring boost (≈ 1.66×). Defensive symmetry: a misuse with
    // out-of-range α can't trigger Horner extrapolation.
    expect(empiricalPhaseFactor(SATURN_PHASE, -1)).toBeCloseTo(
      10 ** (0.55 / 2.5),
      6,
    );
  });

  it('returns 1 at α = 0 for every planet with c0 = 0', () => {
    // Saturn opts out — see the Saturn-specific test below.
    const planets: [string, PhaseCoefficients][] = [
      ['Mercury', MERCURY_PHASE],
      ['Venus', VENUS_PHASE],
      ['Earth', EARTH_PHASE],
      ['Mars', MARS_PHASE],
      ['Jupiter', JUPITER_PHASE],
    ];
    for (const [name, p] of planets) {
      const v = empiricalPhaseFactor(p, 0);
      expect(v, `${name} α=0`).toBeCloseTo(1, 12);
    }
  });

  it('Saturn at α = 0 is brighter than 1× (ring boost)', () => {
    // c0 = -0.55 mag → 10^(0.55/2.5) ≈ 1.660.
    const v = empiricalPhaseFactor(SATURN_PHASE, 0);
    expect(v).toBeCloseTo(10 ** (0.55 / 2.5), 6);
    expect(v).toBeGreaterThan(1.6);
    expect(v).toBeLessThan(1.7);
  });

  it('Mercury matches the published 7th-order Mallama fit across 0°–170°', () => {
    // Mallama 2018 Table A-1.2 publishes Mercury as a degree-7
    // polynomial. c7 = 6.592e-15 now ships (third per-instance vec4),
    // so the rendered curve IS the published fit across the full 170°
    // validity range — the degree-6 truncation era capped αmax at 87°
    // and fell back to anchor-Lambert (sub-0.5 mag error); with c7
    // stored the budget collapses to float noise.
    const fullDV = (aDeg: number): number =>
      MERCURY_PHASE.c0 +
      MERCURY_PHASE.c1 * aDeg +
      MERCURY_PHASE.c2 * aDeg ** 2 +
      MERCURY_PHASE.c3 * aDeg ** 3 +
      MERCURY_PHASE.c4 * aDeg ** 4 +
      MERCURY_PHASE.c5 * aDeg ** 5 +
      MERCURY_PHASE.c6 * aDeg ** 6 +
      MERCURY_PHASE.c7 * aDeg ** 7;
    const renderedDV = (aDeg: number): number => {
      const factor = empiricalPhaseFactor(MERCURY_PHASE, aDeg * DEG);
      return (-Math.log(factor) * 2.5) / Math.log(10);
    };
    expect(MERCURY_PHASE.alphaMaxDeg).toBe(170);
    for (let aDeg = 0; aDeg <= 170; aDeg += 2) {
      const err = Math.abs(renderedDV(aDeg) - fullDV(aDeg));
      expect(err, `α=${aDeg}°`).toBeLessThan(0.01);
    }
    // Physical sanity at the far bound: ΔV(170°) ≈ +9.16 mag of phase
    // dimming — with the truncated degree-6 polynomial let run to
    // 170° this read ≈ −17.9 (27 mag too bright, apparent V ≈ −18
    // instead of the real ≈ +8). Pin the published value.
    expect(renderedDV(170)).toBeCloseTo(fullDV(170), 6);
    expect(fullDV(170)).toBeCloseTo(9.161, 3);
  });

  it('Mercury brightness is monotone decreasing in α over 0°–170°', () => {
    // A thin crescent gets dimmer, not brighter, as α grows — the
    // physical sanity check Alex flagged when the truncated
    // polynomial's runaway first shipped. ΔV grows ⇒ flux falls.
    let prev = -Infinity;
    for (let aDeg = 2; aDeg <= 170; aDeg += 2) {
      const factor = empiricalPhaseFactor(MERCURY_PHASE, aDeg * DEG);
      const dV = (-Math.log(factor) * 2.5) / Math.log(10);
      expect(dV, `α=${aDeg}°`).toBeGreaterThan(prev);
      prev = dV;
    }
  });

  it('Mercury polynomial reproduces published ΔV at α = 30°', () => {
    // Mallama 2018 Table A-1.2 V-band coefficients evaluated at 30°.
    // Hand-checked to land near 1.15 mag. This is a sanity bound,
    // not a hard pin.
    const a = 30 * DEG;
    const factor = empiricalPhaseFactor(MERCURY_PHASE, a);
    const dV = -Math.log(factor) * 2.5 / Math.log(10);
    expect(dV).toBeGreaterThan(1.0);
    expect(dV).toBeLessThan(1.3);
  });

  it('Earth polynomial passes through the Mallama 2018 Table A-3.1 anchor points', () => {
    // The fit was constructed to pass exactly through (45°, 1.123),
    // (90°, 2.069), (135°, 3.801) — the published table values.
    for (const [aDeg, expectedDV] of [
      [45, 1.123],
      [90, 2.069],
      [135, 3.801],
    ] as const) {
      const factor = empiricalPhaseFactor(EARTH_PHASE, aDeg * DEG);
      const dV = -Math.log(factor) * 2.5 / Math.log(10);
      expect(dV, `Earth α=${aDeg}°`).toBeCloseTo(expectedDV, 2);
    }
  });

  it('Venus is brighter than Lambert at large α (atmospheric forward-scattering)', () => {
    // The defining win for Venus from the bead description: at large
    // phase angle Venus's atmosphere forward-scatters, leaving the
    // crescent meaningfully brighter than a perfectly diffuse sphere
    // would predict. The asymmetry grows with α — at 130° Mallama
    // is ~1.6× Lambert; by 160° it's nearly an order of magnitude.
    const a130 = 130 * DEG;
    expect(empiricalPhaseFactor(VENUS_PHASE, a130))
      .toBeGreaterThan(lambertianPhaseFactor(a130) * 1.4);
    const a160 = 160 * DEG;
    expect(empiricalPhaseFactor(VENUS_PHASE, a160))
      .toBeGreaterThan(lambertianPhaseFactor(a160) * 5);
  });

  it('Moon reproduces the measured full-to-quarter brightness ratio (~11×)', () => {
    // The empirical anchor for the whole lunar phase law: a quarter
    // Moon is ~11× fainter than a full one, not the 3.1× Lambert
    // predicts. If this drifts, the coefficients are wrong.
    const ratio = empiricalPhaseFactor(MOON_PHASE, 0) / empiricalPhaseFactor(MOON_PHASE, 90 * DEG);
    expect(ratio).toBeCloseTo(10.989, 3);
    const lambertRatio = lambertianPhaseFactor(0) / lambertianPhaseFactor(90 * DEG);
    expect(lambertRatio).toBeCloseTo(3.142, 3);
  });

  it('Moon over-brightness under Lambert matches the published deficit', () => {
    // How much too bright the Moon rendered before it carried a curve,
    // in magnitudes. Full phase is exactly right (the −12.74 anchor);
    // the gap opens across the phases a user parks at.
    const expected: ReadonlyArray<readonly [number, number]> = [
      [0, 0], [10, 0.24404], [30, 0.64549], [60, 1.07338],
      [90, 1.35957], [120, 1.54298], [150, 1.35193],
    ];
    for (const [aDeg, overMag] of expected) {
      const a = aDeg * DEG;
      const measured = 2.5 * Math.log10(
        lambertianPhaseFactor(a) / empiricalPhaseFactor(MOON_PHASE, a),
      );
      expect(measured).toBeCloseTo(overMag, 5);
    }
  });

  it('all curves return positive, finite factors over their validity range', () => {
    const all = [
      MERCURY_PHASE, VENUS_PHASE, EARTH_PHASE, MARS_PHASE,
      JUPITER_PHASE, SATURN_PHASE, MOON_PHASE,
    ];
    for (const p of all) {
      for (let aDeg = 0; aDeg <= p.alphaMaxDeg; aDeg += 0.5) {
        const v = empiricalPhaseFactor(p, aDeg * DEG);
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThan(0);
      }
    }
  });
});

describe('alphaZeroPhaseFactor', () => {
  it('returns 1 for undefined coefficients (Lambertian fallback)', () => {
    expect(alphaZeroPhaseFactor(undefined)).toBe(1);
  });

  it('returns 1 for any zeroed-out planet (c0 = 0)', () => {
    expect(alphaZeroPhaseFactor(EARTH_PHASE)).toBeCloseTo(1, 12);
    expect(alphaZeroPhaseFactor(JUPITER_PHASE)).toBeCloseTo(1, 12);
  });

  it('returns the c0-boost flux multiplier for Saturn', () => {
    expect(alphaZeroPhaseFactor(SATURN_PHASE)).toBeCloseTo(10 ** (0.55 / 2.5), 6);
  });

  it('returns 1 when alphaMaxDeg = 0 (sentinel — polynomial disabled)', () => {
    const sentinel: PhaseCoefficients = {
      c0: -1, c1: 0, c2: 0, c3: 0, c4: 0, c5: 0, c6: 0, c7: 0, alphaMaxDeg: 0,
    };
    expect(alphaZeroPhaseFactor(sentinel)).toBe(1);
  });
});

describe('phaseFactorFor', () => {
  it('Lambertian fallback when coefs are undefined (Pluto / exoplanets)', () => {
    // Planet at (1, 0, 0), host at (1, 1, 0), viewer at origin.
    // dv = viewer→planet = (1, 0, 0); dh = viewer→host = (1, 1, 0).
    // planet→viewer = (-1, 0, 0); planet→host = (0, 1, 0); cos α = 0
    // → α = 90°, Lambert(π/2) = 1/π.
    const dvx = 1, dvy = 0, dvz = 0;
    const dhx = 1, dhy = 1, dhz = 0;
    expect(phaseFactorFor(dvx, dvy, dvz, dhx, dhy, dhz, undefined))
      .toBeCloseTo(1 / Math.PI, 6);
  });

  it('polynomial branch matches a direct empiricalPhaseFactor call at known α', () => {
    // Construct a geometry where the angle at the planet between the
    // viewer and host directions is exactly α = 30°. Planet at the
    // origin (relative to viewer), viewer along -x, host at α relative
    // to the viewer ray seen from the planet. dv = viewer→planet =
    // (1, 0, 0) ⇒ planet→viewer = (-1, 0, 0). For planet→host to make
    // 30° with that, dh - dv must be (-cos α, sin α, 0), giving
    // dh = (1 - cos α, sin α, 0).
    const a = 30 * DEG;
    const dvx = 1, dvy = 0, dvz = 0;
    const dhx = 1 - Math.cos(a), dhy = Math.sin(a), dhz = 0;
    const phi = phaseFactorFor(dvx, dvy, dvz, dhx, dhy, dhz, MARS_PHASE);
    expect(phi).toBeCloseTo(empiricalPhaseFactor(MARS_PHASE, a), 6);
  });

  it('returns 1 when the viewer→planet leg is degenerate (lenV = 0)', () => {
    // Viewer sits on top of the planet — α is undefined; the safe
    // floor returns full-phase brightness rather than NaN.
    expect(phaseFactorFor(0, 0, 0, 1, 0, 0, MARS_PHASE)).toBe(1);
  });

  it('returns 1 when the planet→host leg is degenerate (lenHp = 0)', () => {
    // Host sits on top of the planet (dh == dv).
    expect(phaseFactorFor(1, 0, 0, 1, 0, 0, MARS_PHASE)).toBe(1);
  });

  it('α = 0 matches alphaZeroPhaseFactor exactly (viewer behind host)', () => {
    // Viewer behind the host, looking through the host toward the
    // planet — planet→viewer and planet→host both point along -x →
    // α = 0. Planet at (2, 0, 0); host at (1, 0, 0); viewer at origin
    // ⇒ dv = (2, 0, 0); dh = (1, 0, 0); planet→viewer = (-1, 0, 0);
    // planet→host = (-1, 0, 0); cos α = 1.
    const dvx = 2, dvy = 0, dvz = 0;
    const dhx = 1, dhy = 0, dhz = 0;
    for (const coefs of [MARS_PHASE, SATURN_PHASE, JUPITER_PHASE, undefined]) {
      const phi = phaseFactorFor(dvx, dvy, dvz, dhx, dhy, dhz, coefs);
      expect(phi).toBeCloseTo(alphaZeroPhaseFactor(coefs), 6);
    }
  });
});

describe('phaseRatioToLambert', () => {
  it('is exactly 1 for bodies without coefficients (sentinel path)', () => {
    expect(phaseRatioToLambert(undefined, 1.2)).toBe(1);
    const sentinel = { ...MARS_PHASE, alphaMaxDeg: 0 };
    expect(phaseRatioToLambert(sentinel, 1.2)).toBe(1);
  });

  it('is 1 at α = 0 for c0 = 0 bodies (both curves normalise to full phase)', () => {
    for (const coefs of [MERCURY_PHASE, VENUS_PHASE, MARS_PHASE, JUPITER_PHASE]) {
      expect(phaseRatioToLambert(coefs, 0)).toBeCloseTo(1, 9);
    }
  });

  it("Saturn's ring-boost c0 lifts the α = 0 ratio above 1", () => {
    expect(phaseRatioToLambert(SATURN_PHASE, 0)).toBeCloseTo(
      alphaZeroPhaseFactor(SATURN_PHASE), 9);
  });

  it("Venus's forward scattering exceeds Lambert at high α", () => {
    // The measured crescent is brighter than a diffuse sphere's — the
    // visible payoff of the ratio scalar.
    expect(phaseRatioToLambert(VENUS_PHASE, (150 * Math.PI) / 180))
      .toBeGreaterThan(1.5);
  });

  it('matches the raw curve ratio inside the validity bound', () => {
    const a = (30 * Math.PI) / 180;
    const raw = empiricalPhaseFactor(MARS_PHASE, a) / lambertianPhaseFactor(a);
    expect(phaseRatioToLambert(MARS_PHASE, a)).toBeCloseTo(raw, 12);
  });

  it('is constant past αmax (anchor-scaled Lambert over Lambert) and finite at α = π', () => {
    const atMax = phaseRatioToLambert(MARS_PHASE, (50 * Math.PI) / 180);
    expect(phaseRatioToLambert(MARS_PHASE, (120 * Math.PI) / 180)).toBeCloseTo(atMax, 12);
    expect(Number.isFinite(phaseRatioToLambert(MERCURY_PHASE, Math.PI))).toBe(true);
  });

  it('Moon: the mesh scalar the shader reads, clamp included', () => {
    const expected: ReadonlyArray<readonly [number, number]> = [
      [0, 1], [30, 0.551830], [90, 0.285873],
      // 120° sits inside the clamp band pinned below, so the raw
      // ratio is floored rather than reported.
      [120, PHASE_RATIO_MIN], [150, 0.287891],
    ];
    for (const [aDeg, scalar] of expected) {
      expect(phaseRatioToLambert(MOON_PHASE, aDeg * DEG)).toBeCloseTo(scalar, 6);
    }
  });

  it("Moon's curve dips under PHASE_RATIO_MIN over a bounded crescent band", () => {
    // The floor bites where the lunar curve is steepest. Both band
    // edges are pinned, not just "it happens somewhere": widening the
    // truncated span is the regression to catch, and a bound would
    // pass a band twice this size.
    const rawRatio = (deg: number): number => {
      const a = deg * DEG;
      return empiricalPhaseFactor(MOON_PHASE, a) / lambertianPhaseFactor(a);
    };
    let minRaw = Infinity;
    let argMinDeg = NaN;
    let loDeg = NaN;
    let hiDeg = NaN;
    for (let deg = 0; deg <= 150; deg += 0.01) {
      const raw = rawRatio(deg);
      if (raw < minRaw) { minRaw = raw; argMinDeg = deg; }
      if (raw < PHASE_RATIO_MIN) { if (Number.isNaN(loDeg)) loDeg = deg; hiDeg = deg; }
    }
    expect(minRaw).toBeCloseTo(0.23772, 5);
    expect(argMinDeg).toBeCloseTo(128.87, 2);
    expect(loDeg).toBeCloseTo(111.57, 2);
    expect(hiDeg).toBeCloseTo(141.25, 2);
    expect(2.5 * Math.log10(PHASE_RATIO_MIN / minRaw)).toBeCloseTo(0.05470, 5);

    // Mercury already loses an order of magnitude more to the same
    // floor, which is what makes the shared bound defensible — so its
    // worst case is pinned too rather than compared loosely.
    let mercuryMin = Infinity;
    let mercuryArgMinDeg = NaN;
    for (let deg = 0; deg <= MERCURY_PHASE.alphaMaxDeg; deg += 0.01) {
      const a = deg * DEG;
      const raw = empiricalPhaseFactor(MERCURY_PHASE, a) / lambertianPhaseFactor(a);
      if (raw < mercuryMin) { mercuryMin = raw; mercuryArgMinDeg = deg; }
    }
    expect(mercuryMin).toBeCloseTo(0.17308, 5);
    expect(mercuryArgMinDeg).toBeCloseTo(151.86, 2);
    expect(2.5 * Math.log10(PHASE_RATIO_MIN / mercuryMin)).toBeCloseTo(0.39922, 5);
  });

  it('clamps to [PHASE_RATIO_MIN, PHASE_RATIO_MAX]', () => {
    for (const coefs of [MERCURY_PHASE, VENUS_PHASE, EARTH_PHASE, SATURN_PHASE, MOON_PHASE]) {
      for (let deg = 0; deg <= 180; deg += 5) {
        const r = phaseRatioToLambert(coefs, (deg * Math.PI) / 180);
        expect(r).toBeGreaterThanOrEqual(PHASE_RATIO_MIN);
        expect(r).toBeLessThanOrEqual(PHASE_RATIO_MAX);
      }
    }
  });
});

describe('phaseAngleFor', () => {
  it('feeds phaseFactorFor: same α as the reference geometry', () => {
    const a = (73 * Math.PI) / 180;
    const dvx = 1, dvy = 0, dvz = 0;
    const dhx = 1 - Math.cos(a), dhy = Math.sin(a), dhz = 0;
    expect(phaseAngleFor(dvx, dvy, dvz, dhx, dhy, dhz)).toBeCloseTo(a, 9);
  });

  it('returns 0 on degenerate legs', () => {
    expect(phaseAngleFor(0, 0, 0, 1, 0, 0)).toBe(0);
    expect(phaseAngleFor(1, 0, 0, 1, 0, 0)).toBe(0);
  });
});

// No TS caller reads this — the shader computes illumFrac itself — so the
// mirror IS the contract, and only a pin keeps the two in step.
describe('illuminatedFraction mirrors the shader', () => {
  it('runs full to new over [0, π]', () => {
    expect(illuminatedFraction(0)).toBe(1);
    expect(illuminatedFraction(90 * DEG)).toBeCloseTo(0.5, 12);
    expect(illuminatedFraction(180 * DEG)).toBeCloseTo(0, 12);
  });

  it('clamps α rather than running past the endpoints', () => {
    expect(illuminatedFraction(-1)).toBe(1);
    expect(illuminatedFraction(Math.PI + 1)).toBeCloseTo(0, 12);
  });

  it('carries the shader expression that drives the photocentre shift', () => {
    const glareVert = readFileSync(
      fileURLToPath(new URL('./planets/glare/planet.vert.glsl', import.meta.url)),
      'utf8',
    );
    expect(glareVert).toContain('float illumFrac = (1.0 + cosA) * 0.5;');
    expect(glareVert).toContain('(1.0 - illumFrac)');
  });
});
