import { describe, it, expect } from 'vitest';
import {
  CLEAR_DEPTH_EPS,
  COVERAGE_TAPS,
  coverageBracket,
  coverageTap,
  depthFromViewDistance,
  ringTransmission,
  SELF_OCCLUSION_SLACK,
  tapOccluded,
  viewDistanceFromDepth,
  visibleFraction,
} from './coverage-pure';
import { NEAR_FRACTION, NEAR_MIN_PC } from '../../../local-depth/slice-pure';
import { AU_PC, KM_PC } from '../../../util/astronomy-constants';

const SATURN_R_PC = 60268 * KM_PC;

describe('viewDistanceFromDepth', () => {
  it('maps the bracket endpoints exactly', () => {
    expect(viewDistanceFromDepth(0, 2e-8, 5e-6) / 2e-8).toBeCloseTo(1, 12);
    expect(viewDistanceFromDepth(1, 2e-8, 5e-6) / 5e-6).toBeCloseTo(1, 12);
  });

  it('round-trips against depthFromViewDistance', () => {
    const near = 3e-10;
    const far = 5.1e-6;
    for (const z of [4e-10, 1e-8, 4.85e-8, 1e-6, 4.85e-6, 5e-6]) {
      const d = depthFromViewDistance(z, near, far);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
      expect(viewDistanceFromDepth(d, near, far) / z).toBeCloseTo(1, 9);
    }
  });
});

describe('tapOccluded', () => {
  // The reported case: Saturn ~20 body radii away, Sol at 1 AU behind it.
  const near = NEAR_FRACTION * 19 * SATURN_R_PC;
  const far = 1.05 * (AU_PC + SATURN_R_PC);
  const saturnDist = 20 * SATURN_R_PC;
  const solDist = AU_PC;

  it('reads a body in front of Sol as an occluder', () => {
    const d = depthFromViewDistance(saturnDist, near, far);
    expect(tapOccluded(d, solDist, near, far)).toBe(true);
  });

  it('reads a cleared texel as no occluder, even for a source past the far plane', () => {
    // A background star well beyond the bracket: the cleared texel decodes
    // to the far plane, which IS nearer than the star, so the clear guard
    // is the only thing standing between it and a bogus full occlusion.
    expect(tapOccluded(1, 10 * far, near, far)).toBe(false);
    expect(tapOccluded(1 - 0.5 * CLEAR_DEPTH_EPS, 10 * far, near, far)).toBe(false);
  });

  it('does not let a source occlude itself with its own depth stamp', () => {
    const d = depthFromViewDistance(solDist, near, far);
    expect(tapOccluded(d, solDist, near, far)).toBe(false);
  });

  it('takes a surface just inside the slack as an occluder', () => {
    const d = depthFromViewDistance(solDist * (1 - 2 * SELF_OCCLUSION_SLACK), near, far);
    expect(tapOccluded(d, solDist, near, far)).toBe(true);
  });

  it('resolves Saturn against Sol with ~6 orders of depth margin', () => {
    // The precision claim the single coarse bracket rests on: the two are
    // nowhere near the same depth quantum.
    const dSaturn = depthFromViewDistance(saturnDist, near, far);
    const dSol = depthFromViewDistance(solDist, near, far);
    expect(dSol - dSaturn).toBeGreaterThan(2 ** -24);
  });
});

describe('ringTransmission', () => {
  it('passes everything through a zero-alpha strip texel at any angle', () => {
    expect(ringTransmission(0, 1)).toBe(1);
    expect(ringTransmission(0, 1e-9)).toBe(1);
  });

  it('blocks everything at full alpha', () => {
    expect(ringTransmission(1, 1)).toBe(0);
  });

  it('reduces to 1 - alpha face-on', () => {
    // sin B = 1 is one normal optical depth, which is what the strip's
    // alpha was authored at.
    expect(ringTransmission(0.5, 1)).toBeCloseTo(0.5, 12);
    expect(ringTransmission(167 / 255, 1)).toBeCloseTo(1 - 167 / 255, 12);
  });

  it('goes opaque edge-on for the same texel', () => {
    // Uranus's epsilon ring peaks at 167/255. Face-on it passes 35% of the
    // light; at a 5-degree opening angle the slant path is 11.5 normal
    // depths and it is effectively opaque. One scalar opacity cannot say
    // both, which is why the angle is in the formula.
    const alpha = 167 / 255;
    expect(ringTransmission(alpha, 1)).toBeCloseTo(0.345, 3);
    expect(ringTransmission(alpha, Math.sin((5 * Math.PI) / 180))).toBeLessThan(1e-5);
  });

  it('barely touches the tenuous strips at any angle', () => {
    // Neptune's Adams ships at alpha 4/255, Le Verrier at 2/255. Even
    // edge-on at 1 degree these must not read as occluders.
    const sin1 = Math.sin(Math.PI / 180);
    expect(ringTransmission(4 / 255, sin1)).toBeGreaterThan(0.3);
    expect(ringTransmission(2 / 255, sin1)).toBeGreaterThan(0.5);
  });
});

describe('coverageTap', () => {
  it('produces COVERAGE_TAPS points inside the unit disc', () => {
    const out: [number, number] = [0, 0];
    for (let i = 0; i < COVERAGE_TAPS; i++) {
      coverageTap(i, COVERAGE_TAPS, out);
      expect(Math.hypot(out[0], out[1])).toBeLessThanOrEqual(1);
    }
  });

  it('is equal-area: half the taps fall inside radius 1/sqrt(2)', () => {
    const out: [number, number] = [0, 0];
    let inner = 0;
    for (let i = 0; i < COVERAGE_TAPS; i++) {
      coverageTap(i, COVERAGE_TAPS, out);
      if (Math.hypot(out[0], out[1]) <= Math.SQRT1_2) inner++;
    }
    expect(inner).toBe(COVERAGE_TAPS / 2);
  });

  it('is deterministic', () => {
    const a: [number, number] = [0, 0];
    const b: [number, number] = [0, 0];
    coverageTap(7, COVERAGE_TAPS, a);
    coverageTap(7, COVERAGE_TAPS, b);
    expect(a).toEqual(b);
  });
});

describe('coverageBracket', () => {
  it('is null with no members, so the pass skips the frame', () => {
    expect(coverageBracket([])).toBeNull();
  });

  it('floors near at NEAR_MIN_PC when a bound contains the camera', () => {
    const b = coverageBracket([{ distPc: 1e-9, radiusPc: 1e-8 }])!;
    expect(b.nearPc).toBe(NEAR_MIN_PC);
  });

  it('spans the surface of the nearest member to past the farthest extent', () => {
    const b = coverageBracket([
      { distPc: 20 * SATURN_R_PC, radiusPc: SATURN_R_PC },
      { distPc: AU_PC, radiusPc: 2.2543e-8 },
    ])!;
    expect(b.nearPc / (NEAR_FRACTION * 19 * SATURN_R_PC)).toBeCloseTo(1, 12);
    expect(b.farPc).toBeGreaterThan(AU_PC);
  });
});

describe('visibleFraction', () => {
  it('multiplies clipping by transmission', () => {
    expect(visibleFraction(0.5, 0.5)).toBe(0.25);
    expect(visibleFraction(1, 1)).toBe(1);
  });

  it('a fully occluded source is invisible however much is in frame', () => {
    expect(visibleFraction(1, 0)).toBe(0);
  });

  it('clamps both inputs', () => {
    expect(visibleFraction(2, 2)).toBe(1);
    expect(visibleFraction(-1, 0.5)).toBe(0);
  });
});
