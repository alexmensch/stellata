import { describe, it, expect } from 'vitest';
import {
  axialFromRadial,
  CLEAR_DEPTH_EPS,
  COVERAGE_TAPS,
  coverageBracket,
  coverageTap,
  depthFromViewDistance,
  meanTapThroughput,
  radialFromAxial,
  ringRayTransmission,
  ringTransmission,
  SELF_OCCLUSION_SLACK,
  selfOcclusionSlackPc,
  tapOccluded,
  viewDistanceFromDepth,
  viewRayLength,
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

describe('view-ray geometry', () => {
  const TAN_HALF_Y = Math.tan((25 * Math.PI) / 180);
  const TAN_HALF_X = TAN_HALF_Y * (16 / 9);

  it('is 1 on the view axis and grows toward the corner', () => {
    expect(viewRayLength(0, 0, TAN_HALF_X, TAN_HALF_Y)).toBe(1);
    expect(viewRayLength(1, 1, TAN_HALF_X, TAN_HALF_Y)).toBeCloseTo(1.3801, 4);
  });

  it('round-trips radial against axial', () => {
    const len = viewRayLength(1, 1, TAN_HALF_X, TAN_HALF_Y);
    expect(radialFromAxial(axialFromRadial(AU_PC, len), len)).toBeCloseTo(AU_PC, 20);
  });

  it('separates the two conventions by orders more than the slack', () => {
    // The trap: the depth buffer stores axis distance, every sample carries
    // a radial one. At the corner of a 16:9 frame with a 50deg vertical FOV
    // the two differ by 28%, against a 0.1% slack — comparing them directly
    // makes every off-centre source occlude itself.
    const len = viewRayLength(1, 1, TAN_HALF_X, TAN_HALF_Y);
    expect(1 - axialFromRadial(1, len)).toBeGreaterThan(100 * SELF_OCCLUSION_SLACK);
  });
});

describe('selfOcclusionSlackPc', () => {
  // 1080 px over a 50deg frame, the reference viewport.
  const PX_PER_RAD = 1080 / ((50 * Math.PI) / 180);

  it('is the body\'s own radius once it resolves', () => {
    // Saturn 20 radii out: the slack has to clear its own near surface,
    // which sits a full radius in front of the centre.
    const depth = 20 * SATURN_R_PC;
    const radiusPx = SATURN_R_PC / depth * PX_PER_RAD;
    expect(selfOcclusionSlackPc(radiusPx, PX_PER_RAD, depth) / SATURN_R_PC)
      .toBeCloseTo(1, 6);
  });

  it('falls back to the relative floor for a sub-pixel source', () => {
    expect(selfOcclusionSlackPc(0.1, PX_PER_RAD, AU_PC) / AU_PC)
      .toBeCloseTo(SELF_OCCLUSION_SLACK, 12);
  });
});

describe('tapOccluded', () => {
  // The reported case: Saturn ~20 body radii away, Sol at 1 AU behind it.
  const near = NEAR_FRACTION * 19 * SATURN_R_PC;
  const far = 1.05 * (AU_PC + SATURN_R_PC);
  const saturnDist = 20 * SATURN_R_PC;
  const solDist = AU_PC;
  const SOL_R_PC = 2.2543e-8;
  const solSlack = SELF_OCCLUSION_SLACK * solDist;

  it('reads a body in front of Sol as an occluder', () => {
    const d = depthFromViewDistance(saturnDist, near, far);
    expect(tapOccluded(d, solDist, solSlack, near, far)).toBe(true);
  });

  it('reads a cleared texel as no occluder, even for a source past the far plane', () => {
    // A background star well beyond the bracket: the cleared texel decodes
    // to the far plane, which IS nearer than the star, so the clear guard
    // is the only thing standing between it and a bogus full occlusion.
    expect(tapOccluded(1, 10 * far, SELF_OCCLUSION_SLACK * 10 * far, near, far)).toBe(false);
    expect(tapOccluded(
      1 - 0.5 * CLEAR_DEPTH_EPS, 10 * far, SELF_OCCLUSION_SLACK * 10 * far, near, far,
    )).toBe(false);
  });

  it('does not let a source occlude itself with its own depth stamp', () => {
    const d = depthFromViewDistance(solDist, near, far);
    expect(tapOccluded(d, solDist, solSlack, near, far)).toBe(false);
  });

  it('does not let a resolved body occlude itself with its own near surface', () => {
    // A fixed relative slack cannot do this: at a 5-radius framing the near
    // surface is 20% of the distance in front of the centre, so the frame's
    // dominant source would drop out of the mean entirely.
    const depth = 5 * SATURN_R_PC;
    const surface = depthFromViewDistance(depth - SATURN_R_PC, near, far);
    expect(tapOccluded(surface, depth, SELF_OCCLUSION_SLACK * depth, near, far)).toBe(true);
    expect(tapOccluded(surface, depth, SATURN_R_PC, near, far)).toBe(false);
  });

  it('takes a surface just inside the slack as an occluder', () => {
    const d = depthFromViewDistance(solDist - 2 * SOL_R_PC, near, far);
    expect(tapOccluded(d, solDist, SOL_R_PC, near, far)).toBe(true);
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

describe('ringRayTransmission', () => {
  // View space: camera at the origin looking down -Z, a ring annulus D away
  // whose hit radius is mid-strip, and a source behind it.
  const D = 20 * SATURN_R_PC;
  const OUTER = 140390 * KM_PC;
  const INNER_RATIO = 74510 / 140390;
  const R_MID = 0.8 * OUTER;
  const SOURCE = AU_PC;
  const ALPHA = 167 / 255;
  const strip = () => ALPHA;
  // Same annulus, same hit radius, two openings: face-on (pole along the
  // ray) and 5 degrees off edge-on.
  const faceOn = (sourceRadialPc = SOURCE) => ringRayTransmission(
    0, 0, -1, R_MID, 0, -D, 0, 0, 1, OUTER, INNER_RATIO, sourceRadialPc, strip);
  const sin5 = Math.sin((5 * Math.PI) / 180);
  const cos5 = Math.cos((5 * Math.PI) / 180);
  const grazing = ringRayTransmission(
    0, 0, -1, 0, R_MID, -D, cos5, 0, sin5, OUTER, INNER_RATIO, SOURCE, strip);

  it('passes 1 - alpha face-on and goes opaque near edge-on', () => {
    expect(faceOn()).toBeCloseTo(1 - ALPHA, 12);
    expect(grazing).toBeLessThan(1e-5);
  });

  it('samples the strip at the hit radius', () => {
    const seen: number[] = [];
    ringRayTransmission(
      0, 0, -1, R_MID, 0, -D, 0, 0, 1, OUTER, INNER_RATIO, SOURCE,
      (u) => { seen.push(u); return 0; });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeCloseTo((0.8 - INNER_RATIO) / (1 - INNER_RATIO), 12);
  });

  it('lets a ray through the annulus hole and past the outer edge', () => {
    const at = (rPc: number) => ringRayTransmission(
      0, 0, -1, rPc, 0, -D, 0, 0, 1, OUTER, INNER_RATIO, SOURCE, strip);
    expect(at(0.5 * INNER_RATIO * OUTER)).toBe(1);
    expect(at(1.5 * OUTER)).toBe(1);
  });

  it('cannot dim a source in front of the ring', () => {
    // The crossing is at D, so a source nearer than that is unaffected —
    // a ring behind a body does not extinguish it.
    expect(faceOn(0.5 * D)).toBe(1);
    expect(faceOn(2 * D)).toBeCloseTo(1 - ALPHA, 12);
  });

  it('leaves a ray in the ring plane alone — the annulus has no thickness', () => {
    expect(ringRayTransmission(
      0, 0, -1, R_MID, 0, -D, 1, 0, 0, OUTER, INNER_RATIO, SOURCE, strip)).toBe(1);
  });
});

describe('meanTapThroughput', () => {
  it('averages over the taps, counting an occluded one as zero', () => {
    expect(meanTapThroughput(COVERAGE_TAPS, () => 1)).toBe(1);
    expect(meanTapThroughput(COVERAGE_TAPS, (i) => (i < COVERAGE_TAPS / 2 ? 0 : 1)))
      .toBeCloseTo(0.5, 12);
  });

  it('leaves an out-of-frame tap out of both sides of the mean', () => {
    // The clipping term already owns those taps; counting them here would
    // charge the same loss twice.
    expect(meanTapThroughput(COVERAGE_TAPS, (i) => (i < COVERAGE_TAPS / 2 ? null : 0.5)))
      .toBeCloseTo(0.5, 12);
  });

  it('reads 1 when no tap is in frame, leaving clipping to zero the product', () => {
    expect(meanTapThroughput(COVERAGE_TAPS, () => null)).toBe(1);
  });

  it('walks the same deterministic tap set coverageTap produces', () => {
    const seen: Array<[number, number]> = [];
    meanTapThroughput(COVERAGE_TAPS, (_i, x, y) => { seen.push([x, y]); return 1; });
    const out: [number, number] = [0, 0];
    expect(seen[7]).toEqual([...coverageTap(7, COVERAGE_TAPS, out)]);
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
