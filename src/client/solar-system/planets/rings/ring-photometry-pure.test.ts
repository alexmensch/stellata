import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { glslCallArgs } from '../../../util/glsl-call-args';

import {
  JUPITER_PHASE,
  SATURN_PHASE,
  empiricalPhaseFactor,
  lambertianPhaseFactor,
  phaseDV,
} from '../../phase-function';
import {
  RING_BACKLIT_TRANSMIT,
  RING_SHADOW_FLOOR,
  SATURN_RING_PHOTOMETRY,
  effectiveRingTiltDeg,
  maxRingSystemFluxFactor,
  ringFluxAt,
  ringFluxFor,
  ringPhaseFactor,
  ringPlaneElevationDeg,
} from './ring-photometry-pure';

const P = SATURN_RING_PHOTOMETRY;
const DEG = Math.PI / 180;
/** Ring flux in the globe's α=0 unit. */
const fluxAt = (alphaDeg: number, betaDeg: number, backlit = false) =>
  ringFluxAt(P, alphaDeg, betaDeg, backlit, SATURN_PHASE);
/** System φ(α) over the globe's own φ(α) — the pre-fix "boost" framing,
 *  kept for the numbers that were pinned against the published law. */
const factorAt = (alphaDeg: number, betaDeg: number, backlit = false) =>
  1 + fluxAt(alphaDeg, betaDeg, backlit)
    / empiricalPhaseFactor(SATURN_PHASE, alphaDeg * DEG);

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
    expect(ringFluxFor(P, 0, 90, 26.7, SATURN_PHASE)).toBe(fluxAt(0, P.betaMaxDeg));
  });
});

describe('ring flux against the globe', () => {
  it('adds nothing edge-on, at any phase angle', () => {
    for (const aDeg of [0, 1, 3, 6.5, 40, 120]) {
      expect(fluxAt(aDeg, 0)).toBe(0);
    }
  });

  it('floors the two zero points\u2019 offset instead of dimming the globe', () => {
    // Below β ≈ 0.94° the 0.036 mag gap between the 2012 and 2017 zero
    // points outweighs the tilt term; a bare globe is the floor.
    expect(fluxAt(0, 0.9)).toBe(0);
    expect(fluxAt(0, 1)).toBeGreaterThan(0);
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
      const f = fluxAt(aDeg, 20);
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      prev = f;
    }
  });

  it('hands the FLUX over to anchor-scaled Lambert continuously at 6.5°', () => {
    const atBound = fluxAt(P.alphaMaxDeg, 20);
    expect(fluxAt(P.alphaMaxDeg + 1e-6, 20)).toBeCloseTo(atBound, 8);
    expect(fluxAt(180, 20)).toBeCloseTo(0, 12);
    // Lambert alone past the bound — NOT Lambert compounded with the
    // globe's own curve, which buried the rings 3.4x too faint by 90°.
    expect(fluxAt(90, 20)).toBeCloseTo(
      atBound * lambertianPhaseFactor(90 * DEG) / lambertianPhaseFactor(6.5 * DEG),
      12,
    );
    expect(fluxAt(90, 20) / empiricalPhaseFactor(SATURN_PHASE, 90 * DEG))
      .toBeGreaterThan(3 * fluxAt(90, 20));
  });
});

describe('the backlit branch', () => {
  it('keeps the ring term at the annulus shader’s transmitted fraction', () => {
    expect(fluxAt(0, 16, true) / fluxAt(0, 16, false))
      .toBeCloseTo(RING_BACKLIT_TRANSMIT, 10);
    expect(fluxAt(0, 16, true)).toBeGreaterThan(0);
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

  it('shares the in-shadow floor with planet-rings.frag.glsl', () => {
    // The TSL annulus reads RING_SHADOW_FLOOR from here, so the two
    // backends' shadowed bands would drift apart silently without this.
    const frag = readFileSync(
      fileURLToPath(new URL('./planet-rings.frag.glsl', import.meta.url)), 'utf8');
    const match = /const float SHADOW_FLOOR = ([0-9.]+);/.exec(frag);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(RING_SHADOW_FLOOR);
  });
});

describe('the annulus phase scalar', () => {
  const scale = (alphaDeg: number) =>
    ringPhaseFactor(P, alphaDeg * DEG, SATURN_PHASE);

  it('is exactly 1 at opposition — the strip\u2019s own albedo anchor', () => {
    // data/textures/README.md § Ring strips anchors the strip RGB on a
    // ~0.05 particle GEOMETRIC albedo, which is the zero-phase value.
    expect(scale(0)).toBe(1);
  });

  it('carries the surge Cassini measured, at the width it measured', () => {
    // Déau et al. 2013 (Cassini/ISS) put the surge HWHM at 0.20° in the
    // A and B rings and 0.26–0.28° in the C ring and Cassini Division.
    // The Earth-based law's own exp(-2.25·α) has HWHM ln2/2.25 = 0.308°,
    // so the two independent measurements describe one feature — which is
    // why the annulus can ride the law the billboard already uses instead
    // of a second parametrisation. Pin the surge's half-fall inside the
    // measured spread.
    expect(Math.LN2 / -P.surgeDecayPerDeg).toBeCloseTo(0.308, 3);
    const surgeOnly = (alphaDeg: number) => {
      const sinB = Math.sin(20 * DEG);
      const withSurge = P.surgeMag * sinB * Math.exp(P.surgeDecayPerDeg * alphaDeg);
      return withSurge / (P.surgeMag * sinB);
    };
    expect(surgeOnly(Math.LN2 / -P.surgeDecayPerDeg)).toBeCloseTo(0.5, 12);
    // And the drop is front-loaded: most of it inside the first degree.
    expect(scale(0.3)).toBeLessThan(0.95);
    expect(scale(1)).toBeLessThan(0.8);
  });

  it('dims monotonically to zero at α = 180°', () => {
    let prev = Infinity;
    for (let aDeg = 0; aDeg <= 180; aDeg += 0.25) {
      const v = scale(aDeg);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      expect(v).toBeGreaterThanOrEqual(0);
      prev = v;
    }
    expect(scale(180)).toBeCloseTo(0, 12);
  });

  it('never reaches zero short of α = 180°, at any tilt', () => {
    // The shader multiplies `light` by this and leaves alpha at the strip's
    // own opacity, so a zero scalar paints an OPAQUE BLACK annulus over the
    // globe and the Milky Way rather than fading it out. Evaluating the
    // shape at the fit's reference tilt is what keeps it positive: a
    // per-tilt quotient of globe-differenced fluxes hit exactly 0 for every
    // β ≤ 6.06° (README.md § One shape, scaled by one amplitude).
    for (let aDeg = 0; aDeg < 180; aDeg += 0.25) {
      expect(scale(aDeg)).toBeGreaterThan(0);
    }
    // The tilts that used to black out, at phase angles reachable from
    // anywhere off the Sun–Saturn line.
    for (const betaDeg of [1, 2, 4.5, 6]) {
      for (const aDeg of [6.5, 20, 90]) {
        expect(fluxAt(aDeg, betaDeg)).toBeGreaterThan(0);
      }
    }
  });

  it('is one shape at every tilt, so the handoff cannot step', () => {
    // Inside the resolvedness band the annulus and the billboard both
    // draw. The billboard's α-response is the annulus scalar exactly — the
    // flux is this shape scaled by the opposition amplitude — so the ratio
    // is identical whichever surface reports it, and identical across
    // tilts.
    for (const betaDeg of [1, 4.5, 10, 16, 20, P.betaMaxDeg, 49]) {
      const atOpposition = fluxAt(0, betaDeg);
      expect(atOpposition).toBeGreaterThan(0);
      for (const aDeg of [0.2, 1, 4, 6.5, 30, 90]) {
        expect(fluxAt(aDeg, betaDeg) / atOpposition).toBeCloseTo(scale(aDeg), 12);
      }
    }
  });

  it('ignores the backlit split the shader owns itself', () => {
    // TRANSMIT is a constant multiplier on the flux, so it cancels out of
    // the shape — applying it here would dim the far face twice.
    expect(fluxAt(30, 20, true) / fluxAt(0, 20, true)).toBeCloseTo(scale(30), 12);
  });

  it('falls back to the Lambertian shape when the reference tilt degenerates', () => {
    // Unreachable for Saturn (the reference amplitude at β = 27° is 1.43),
    // so pin the guard against a photometry whose tilt term cannot beat its
    // own zero-point offset.
    const flat = { ...P, tiltMag: 0, surgeMag: 0 };
    expect(ringPhaseFactor(flat, 30 * DEG, SATURN_PHASE))
      .toBeCloseTo(lambertianPhaseFactor(30 * DEG), 12);
  });
});

describe('the annulus shader spends the phase factor on flux only', () => {
  const frag = readFileSync(
    fileURLToPath(new URL('./planet-rings.frag.glsl', import.meta.url)), 'utf8');

  it('scales `light`, never `lit`', () => {
    // `lit` is the coverage mask's gate as well as the shadow term
    // (README.md). Folding the phase factor into it would let the
    // opposition surge vote on how much lit ring surface the exposure pin
    // divides its masked mean by — brightness masquerading as area.
    const litDecl = /\n\s*float lit = ([^;]*);/.exec(frag);
    const lightDecl = /\n\s*float light = ([^;]*);/.exec(frag);
    expect(litDecl).not.toBeNull();
    expect(lightDecl).not.toBeNull();
    expect(litDecl![1]).not.toMatch(/uRingPhaseScale/);
    expect(lightDecl![1]).toMatch(/uRingPhaseScale/);
  });

  it('keeps the coverage argument off it', () => {
    expect(glslCallArgs(frag, 'stellataStatisticTexel')[1])
      .not.toMatch(/uRingPhaseScale/);
  });
});

describe('the cull bound', () => {
  it('is the term’s own maximum, not a hand-copied literal', () => {
    expect(maxRingSystemFluxFactor(P, SATURN_PHASE)).toBe(1 + fluxAt(0, P.betaMaxDeg));
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
    expect(ringFluxFor(undefined, 0, 20, 20, SATURN_PHASE)).toBe(0);
    expect(ringFluxFor(P, 0, 20, 20, undefined)).toBe(0);
    expect(ringPhaseFactor(undefined, 0, SATURN_PHASE)).toBe(1);
    expect(ringPhaseFactor(P, 0, undefined)).toBe(1);
  });
});
