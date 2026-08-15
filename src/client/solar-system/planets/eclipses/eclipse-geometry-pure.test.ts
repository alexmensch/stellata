import { describe, it, expect } from 'vitest';
import {
  argMin,
  planetodeticLatRad,
  shadowAxisDirection,
  shadowAxisMiss,
  shadowAxisSurfaceHit,
  umbralMagnitude,
} from './eclipse-geometry-pure';

const SOURCE = { x: -1000, y: 0, z: 0 };
const CASTER = { x: 0, y: 0, z: 0 };

describe('shadowAxisDirection', () => {
  it('points from source to caster and is unit length', () => {
    const out = { x: 0, y: 0, z: 0 };
    shadowAxisDirection(SOURCE, CASTER, out);
    expect(out.x).toBeCloseTo(1, 12);
    expect(out.y).toBeCloseTo(0, 12);
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1, 12);
  });
});

describe('shadowAxisMiss', () => {
  it('is zero for a target dead on the axis, behind the caster', () => {
    expect(shadowAxisMiss(SOURCE, CASTER, { x: 50, y: 0, z: 0 })).toBeCloseTo(0, 12);
  });

  it('is the perpendicular offset, not the distance to the caster', () => {
    expect(shadowAxisMiss(SOURCE, CASTER, { x: 50, y: 3, z: 4 })).toBeCloseTo(5, 12);
  });

  it('measures the same for a target in front of the caster', () => {
    // The axis is a line, not a ray: the miss is defined either side.
    // Whether the shadow actually falls there is the surface hit's job.
    expect(shadowAxisMiss(SOURCE, CASTER, { x: -50, y: 3, z: 4 })).toBeCloseTo(5, 12);
  });
});

describe('shadowAxisSurfaceHit', () => {
  const out = { x: 0, y: 0, z: 0 };

  it('takes the sunward intersection, not the far side', () => {
    // Target centred 50 downrange with radius 10: the shadow lands on the
    // face toward the caster, at x = −10 relative to the centre.
    expect(shadowAxisSurfaceHit(SOURCE, CASTER, { x: 50, y: 0, z: 0 }, 10, out)).toBe(true);
    expect(out.x).toBeCloseTo(-10, 9);
    expect(out.y).toBeCloseTo(0, 9);
  });

  it('returns false when the axis clears the target', () => {
    expect(shadowAxisSurfaceHit(SOURCE, CASTER, { x: 50, y: 30, z: 0 }, 10, out)).toBe(false);
  });

  it('grazes at exactly one radius of miss', () => {
    expect(shadowAxisSurfaceHit(SOURCE, CASTER, { x: 50, y: 10, z: 0 }, 10, out)).toBe(true);
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(10, 6);
  });
});

describe('umbralMagnitude', () => {
  // A converging cone: source much larger than the occulter.
  const args = [100, 0, 1, 10, 100, 10000] as const;

  it('is 1 when the body is exactly inscribed in the umbra', () => {
    // umbra radius at 100 behind a radius-10 occulter with a radius-100
    // source at 10000: 10 − 100·(100−10)/10000 = 9.1. A radius-1 body
    // centred 8.1 off-axis is exactly tangent inside.
    expect(umbralMagnitude(100, 8.1, 1, 10, 100, 10000)).toBeCloseTo(1, 9);
  });

  it('exceeds 1 dead centre and falls below 0 well outside', () => {
    expect(umbralMagnitude(...args)).toBeGreaterThan(1);
    expect(umbralMagnitude(100, 50, 1, 10, 100, 10000)).toBeLessThan(0);
  });

  it('deepens with the shadow enlargement', () => {
    const plain = umbralMagnitude(100, 8.1, 1, 10, 100, 10000);
    const enlarged = umbralMagnitude(100, 8.1, 1, 10, 100, 10000, 1.02);
    expect(enlarged).toBeGreaterThan(plain);
  });

  it('shrinks the umbra with distance behind the occulter', () => {
    const near = umbralMagnitude(50, 8.1, 1, 10, 100, 10000);
    const far = umbralMagnitude(200, 8.1, 1, 10, 100, 10000);
    expect(near).toBeGreaterThan(far);
  });
});

describe('planetodeticLatRad', () => {
  const EARTH_F = 0.00335;

  it('is unchanged at the equator and the poles', () => {
    expect(planetodeticLatRad(0, EARTH_F)).toBeCloseTo(0, 12);
    expect(planetodeticLatRad(Math.PI / 2, EARTH_F)).toBeCloseTo(Math.PI / 2, 9);
  });

  it('peaks near 45°, at about 11.5 arcminutes for Earth', () => {
    const centric = Math.PI / 4;
    const deltaArcmin = ((planetodeticLatRad(centric, EARTH_F) - centric) * 180 * 60) / Math.PI;
    expect(deltaArcmin).toBeGreaterThan(11);
    expect(deltaArcmin).toBeLessThan(12);
  });

  it('keeps the sign in the southern hemisphere', () => {
    expect(planetodeticLatRad(-Math.PI / 4, EARTH_F)).toBeLessThan(-Math.PI / 4);
  });

  it('is the identity for a sphere', () => {
    expect(planetodeticLatRad(0.7, 0)).toBeCloseTo(0.7, 12);
  });
});

describe('argMin', () => {
  it('finds a parabolic minimum between coarse samples', () => {
    const f = (t: number) => (t - 3.14159) ** 2 + 1;
    expect(argMin(f, -10, 10, 1, 1e-6)).toBeCloseTo(3.14159, 5);
  });

  it('finds a sharp V minimum, the shape a central eclipse makes', () => {
    const f = (t: number) => Math.hypot(0.01, t - 2.5);
    expect(argMin(f, -10, 10, 1, 1e-6)).toBeCloseTo(2.5, 4);
  });

  it('stays inside the bracket when the minimum is at an end', () => {
    const t = argMin((x) => x, 0, 5, 1, 1e-6);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThan(0.001);
  });
});
