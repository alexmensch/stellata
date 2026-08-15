import { describe, it, expect } from 'vitest';
import { eclipticToIcrs, icrsToEcliptic, type Vec3 } from './ecliptic-frame';
import { J2000_OBLIQUITY_RAD } from './astronomy-constants';

const SAMPLES: Vec3[] = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: -0.3, y: 2.7, z: -1.1 },
  { x: 384400, y: -120500, z: 33100 },
];

describe('ecliptic ↔ ICRS', () => {
  it('round-trips in both directions', () => {
    const mid: Vec3 = { x: 0, y: 0, z: 0 };
    const back: Vec3 = { x: 0, y: 0, z: 0 };
    for (const v of SAMPLES) {
      icrsToEcliptic(v, mid);
      eclipticToIcrs(mid, back);
      expect(back.x).toBe(v.x);
      expect(back.y).toBeCloseTo(v.y, 9);
      expect(back.z).toBeCloseTo(v.z, 9);

      eclipticToIcrs(v, mid);
      icrsToEcliptic(mid, back);
      expect(back.y).toBeCloseTo(v.y, 9);
      expect(back.z).toBeCloseTo(v.z, 9);
    }
  });

  it('is a rotation — it preserves length and leaves +x fixed', () => {
    const out: Vec3 = { x: 0, y: 0, z: 0 };
    for (const v of SAMPLES) {
      const before = Math.hypot(v.x, v.y, v.z);
      icrsToEcliptic(v, out);
      expect(Math.hypot(out.x, out.y, out.z) / before).toBeCloseTo(1, 12);
      expect(out.x).toBe(v.x);
    }
  });

  it('carries the ecliptic pole to RA 18h, Dec +66.56° — y NEGATIVE', () => {
    // The mirrored +sinε pole once shipped and flipped every planet's
    // declination by up to ~47°. This is the scalar sibling of
    // ECLIPTIC_NORTH_POLE_ICRS in the orbit-rings layer.
    const out: Vec3 = { x: 0, y: 0, z: 0 };
    eclipticToIcrs({ x: 0, y: 0, z: 1 }, out);
    expect(out.x).toBe(0);
    expect(out.y).toBeCloseTo(-Math.sin(J2000_OBLIQUITY_RAD), 15);
    expect(out.z).toBeCloseTo(Math.cos(J2000_OBLIQUITY_RAD), 15);
  });

  it('tilts the equatorial pole by exactly the obliquity', () => {
    const out: Vec3 = { x: 0, y: 0, z: 0 };
    icrsToEcliptic({ x: 0, y: 0, z: 1 }, out);
    expect(Math.acos(out.z)).toBeCloseTo(J2000_OBLIQUITY_RAD, 15);
  });

  it('is safe to alias out with v — the moon resolver does', () => {
    const aliased: Vec3 = { x: 3, y: -4, z: 5 };
    const separate: Vec3 = { x: 0, y: 0, z: 0 };
    icrsToEcliptic({ x: 3, y: -4, z: 5 }, separate);
    icrsToEcliptic(aliased, aliased);
    expect(aliased).toEqual(separate);
  });
});
