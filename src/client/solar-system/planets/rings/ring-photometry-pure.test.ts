import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  JUPITER_PHASE,
  SATURN_PHASE,
  empiricalPhaseFactor,
  phaseDV,
} from '../../phase-function';
import {
  RING_BACKLIT_TRANSMIT,
  SATURN_RING_PHOTOMETRY,
  effectiveRingTiltDeg,
  maxRingSystemFluxFactor,
  ringFluxRatio,
  ringPlaneElevationDeg,
  ringSystemFluxFactor,
} from './ring-photometry-pure';

const P = SATURN_RING_PHOTOMETRY;
const factorAt = (alphaDeg: number, betaDeg: number, backlit = false) =>
  1 + ringFluxRatio(P, alphaDeg, betaDeg, backlit, SATURN_PHASE);

describe('Saturn globe curve (Mallama & Hilton Eq. 12)', () => {
  it('is albedo-anchored and reaches the 150° spacecraft bound', () => {
    expect(SATURN_PHASE.c0).toBe(0);
    expect(SATURN_PHASE.alphaMaxDeg).toBe(150);
    expect(empiricalPhaseFactor(SATURN_PHASE, 0)).toBe(1);
  });

  it('tracks the α < 6.5° globe fit (Eq. 11) to 0.012 mag', () => {
    // Eq. 11 is the Jupiter polynomial against Saturn's own synthetic
    // V₁(0). Dropping Eq. 12's +0.01 zero-point splice is what costs the
    // agreement below — worst at the far end of Eq. 11's domain — and
    // buys 6.5° → 150° of real curve.
    let worst = 0;
    for (let aDeg = 0; aDeg <= 6.5; aDeg += 0.01) {
      worst = Math.max(
        worst, Math.abs(phaseDV(SATURN_PHASE, aDeg) - phaseDV(JUPITER_PHASE, aDeg)),
      );
    }
    expect(worst).toBeCloseTo(0.0111, 4);
  });

  it('dims monotonically all the way out', () => {
    let prev = Infinity;
    for (let aDeg = 0; aDeg <= 180; aDeg += 0.5) {
      const phi = empiricalPhaseFactor(SATURN_PHASE, (aDeg * Math.PI) / 180);
      expect(phi).toBeLessThanOrEqual(prev);
      prev = phi;
    }
    expect(-2.5 * Math.log10(empiricalPhaseFactor(SATURN_PHASE, (150 * Math.PI) / 180)))
      .toBeCloseTo(3.383, 3);
  });
});

describe('ring-plane elevation', () => {
  it('is ±90° along the pole and 0 in the plane', () => {
    expect(ringPlaneElevationDeg(0, 0, 2, 0, 0, 1)).toBe(90);
    expect(ringPlaneElevationDeg(0, 0, -2, 0, 0, 1)).toBe(-90);
    expect(ringPlaneElevationDeg(3, 4, 0, 0, 0, 1)).toBe(0);
  });

  it('reads the pole direction, not the axis', () => {
    expect(ringPlaneElevationDeg(0, 1, 1, 0, 0, 1)).toBeCloseTo(45, 10);
    expect(ringPlaneElevationDeg(0, 1, 1, 0, 0, -1)).toBeCloseTo(-45, 10);
  });

  it('is 0 for a degenerate leg rather than NaN', () => {
    expect(ringPlaneElevationDeg(0, 0, 0, 0, 0, 1)).toBe(0);
    expect(ringPlaneElevationDeg(0, 0, 1, 0, 0, 0)).toBe(0);
  });
});

describe('effective ring tilt β', () => {
  it('is the geometric mean of the two latitudes', () => {
    expect(effectiveRingTiltDeg(P, 4, 9).betaDeg).toBeCloseTo(6, 10);
    expect(effectiveRingTiltDeg(P, -4, -9).betaDeg).toBeCloseTo(6, 10);
  });

  it('flags contrary signs as backlit', () => {
    expect(effectiveRingTiltDeg(P, 20, 20).backlit).toBe(false);
    expect(effectiveRingTiltDeg(P, -20, 20).backlit).toBe(true);
    expect(effectiveRingTiltDeg(P, 0, 20).backlit).toBe(false);
  });

  it('clamps to the published 27° bound a stellata camera flies past', () => {
    // Pole-on viewer, Sun at Saturn's obliquity: √(90·26.7) ≈ 49°, well
    // outside anything an Earth-bound fit saw.
    expect(Math.sqrt(90 * 26.7)).toBeGreaterThan(P.betaMaxDeg);
    expect(effectiveRingTiltDeg(P, 90, 26.7).betaDeg).toBe(P.betaMaxDeg);
    expect(ringSystemFluxFactor(P, 0, 90, 26.7, SATURN_PHASE))
      .toBe(factorAt(0, P.betaMaxDeg));
  });
});

describe('ring flux against the globe', () => {
  it('adds nothing edge-on, at any phase angle', () => {
    for (const aDeg of [0, 1, 3, 6.5, 40, 120]) {
      expect(factorAt(aDeg, 0)).toBe(1);
    }
  });

  it('floors the two zero points\u2019 offset instead of dimming the globe', () => {
    // Below β ≈ 0.94° the 0.036 mag gap between the 2012 and 2017 zero
    // points outweighs the tilt term; a bare globe is the floor.
    expect(factorAt(0, 0.9)).toBe(1);
    expect(factorAt(0, 1)).toBeGreaterThan(1);
  });

  it('doubles-and-a-half the system at maximum opening and opposition', () => {
    expect(factorAt(0, P.betaMaxDeg)).toBeCloseTo(2.4303, 4);
    // The whole point of the bead: from a ring-plane crossing to rings
    // wide open, at opposition, Saturn swings just under a magnitude.
    expect(2.5 * Math.log10(factorAt(0, P.betaMaxDeg) / factorAt(0, 0)))
      .toBeCloseTo(0.964, 3);
  });

  it('lands where the retired static-β = 16° constant sat', () => {
    // c0 = −0.55 was this term averaged over the long run; agreeing with
    // it at β = 16° is what makes the joint form a refinement rather
    // than a recalibration of Saturn's brightness.
    expect(factorAt(0, 16)).toBeCloseTo(1.6924, 4);
    expect(Math.abs(2.5 * Math.log10(factorAt(0, 16) / 10 ** (0.55 / 2.5))))
      .toBeLessThan(0.03);
  });

  it('brightens with opening and fades with phase angle', () => {
    let prev = 0;
    for (let betaDeg = 0; betaDeg <= P.betaMaxDeg; betaDeg += 0.5) {
      const f = factorAt(0, betaDeg);
      expect(f).toBeGreaterThanOrEqual(prev);
      if (betaDeg > 1) expect(f).toBeGreaterThan(prev);
      prev = f;
    }
    prev = Infinity;
    for (let aDeg = 0; aDeg <= 180; aDeg += 0.5) {
      const f = factorAt(aDeg, 20);
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      prev = f;
    }
  });

  it('hands over to anchor-scaled Lambert continuously at 6.5°', () => {
    const atBound = factorAt(P.alphaMaxDeg, 20);
    expect(factorAt(P.alphaMaxDeg + 1e-6, 20)).toBeCloseTo(atBound, 6);
    expect(factorAt(90, 20)).toBeGreaterThan(1);
    expect(factorAt(180, 20)).toBeCloseTo(1, 6);
  });
});

describe('the backlit branch', () => {
  it('keeps the ring term at the annulus shader’s transmitted fraction', () => {
    const same = factorAt(0, 16, false) - 1;
    const back = factorAt(0, 16, true) - 1;
    expect(back / same).toBeCloseTo(RING_BACKLIT_TRANSMIT, 10);
    expect(back).toBeGreaterThan(0);
  });

  it('shares that fraction with planet-rings.frag.glsl', () => {
    // Resolved annulus and point-source magnitude must agree on which
    // side of the ring plane is lit — README.md § Ring photometry.
    const frag = readFileSync(
      fileURLToPath(new URL('./planet-rings.frag.glsl', import.meta.url)), 'utf8');
    const match = /const float TRANSMIT = ([0-9.]+);/.exec(frag);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(RING_BACKLIT_TRANSMIT);
  });
});

describe('the cull bound', () => {
  it('is the term’s own maximum, not a hand-copied literal', () => {
    expect(maxRingSystemFluxFactor(P, SATURN_PHASE)).toBe(factorAt(0, P.betaMaxDeg));
    for (const aDeg of [0, 0.5, 2, 6.5, 30, 90, 150]) {
      for (const betaDeg of [0, 5, 16, 27]) {
        expect(factorAt(aDeg, betaDeg))
          .toBeLessThanOrEqual(maxRingSystemFluxFactor(P, SATURN_PHASE));
      }
    }
  });

  it('is 1 for a body with no ring photometry, or none to subtract from', () => {
    expect(maxRingSystemFluxFactor(undefined, SATURN_PHASE)).toBe(1);
    expect(maxRingSystemFluxFactor(P, undefined)).toBe(1);
    expect(ringSystemFluxFactor(undefined, 0, 20, 20, SATURN_PHASE)).toBe(1);
    expect(ringSystemFluxFactor(P, 0, 20, 20, undefined)).toBe(1);
  });
});
