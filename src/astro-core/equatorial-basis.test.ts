import { describe, it, expect } from 'vitest';

import {
  equatorialTangentBasis,
  equatorialTangentBasisAt,
  equatorialTangentBasisRad,
  unitVectorFromRaDec,
  type UnitVector,
} from './equatorial-basis';

const DEG_TO_RAD = Math.PI / 180;

function dot(a: UnitVector, b: UnitVector): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function norm(a: UnitVector): number {
  return Math.hypot(a.x, a.y, a.z);
}

describe('equatorialTangentBasis', () => {
  const SAMPLES: [number, number][] = [
    [0, 0], [90, 0], [180, 45], [270, -45], [123.456, 78.9],
    [0, 89.999], [0, -89.999], [359.9, 0],
  ];

  it('is orthonormal and right-handed at every sample direction', () => {
    for (const [ra, dec] of SAMPLES) {
      const { u, east, north } = equatorialTangentBasis(ra, dec);
      for (const [name, v] of [['u', u], ['east', east], ['north', north]] as const) {
        expect(norm(v), `|${name}| at (${ra}, ${dec})`).toBeCloseTo(1, 12);
      }
      expect(dot(u, east), `u·east at (${ra}, ${dec})`).toBeCloseTo(0, 12);
      expect(dot(u, north), `u·north at (${ra}, ${dec})`).toBeCloseTo(0, 12);
      expect(dot(east, north), `east·north at (${ra}, ${dec})`).toBeCloseTo(0, 12);
      // north = u × east (right-handed).
      expect(u.y * east.z - u.z * east.y).toBeCloseTo(north.x, 12);
      expect(u.z * east.x - u.x * east.z).toBeCloseTo(north.y, 12);
      expect(u.x * east.y - u.y * east.x).toBeCloseTo(north.z, 12);
    }
  });

  it('points east toward increasing RA and north toward increasing Dec', () => {
    // Finite-difference the direction: +RA moves along east, +Dec along north.
    const { u, east, north } = equatorialTangentBasis(30, 20);
    const plusRa = unitVectorFromRaDec(30 + 1e-4, 20);
    const plusDec = unitVectorFromRaDec(30, 20 + 1e-4);
    expect(dot({ x: plusRa.x - u.x, y: plusRa.y - u.y, z: plusRa.z - u.z }, east))
      .toBeGreaterThan(0);
    expect(dot({ x: plusDec.x - u.x, y: plusDec.y - u.y, z: plusDec.z - u.z }, north))
      .toBeGreaterThan(0);
  });

  it('east stays a unit vector at the pole, where cos δ vanishes', () => {
    const { east } = equatorialTangentBasis(137, 90);
    expect(norm(east)).toBeCloseTo(1, 12);
  });

  it('degrees wrapper matches the radians core', () => {
    const deg = equatorialTangentBasis(200, -33);
    const rad = equatorialTangentBasisRad(200 * DEG_TO_RAD, -33 * DEG_TO_RAD);
    expect(deg).toEqual(rad);
  });
});

describe('unitVectorFromRaDec', () => {
  it('places the axes where the equatorial convention says', () => {
    expect(unitVectorFromRaDec(0, 0).x).toBeCloseTo(1, 12);
    expect(unitVectorFromRaDec(90, 0).y).toBeCloseTo(1, 12);
    expect(unitVectorFromRaDec(0, 90).z).toBeCloseTo(1, 12);
    expect(unitVectorFromRaDec(0, -90).z).toBeCloseTo(-1, 12);
  });

  it('wraps RA by 360°', () => {
    expect(unitVectorFromRaDec(360, 12).x).toBeCloseTo(unitVectorFromRaDec(0, 12).x, 12);
  });
});

describe('equatorialTangentBasisAt', () => {
  it('recovers the basis and distance of a Cartesian position', () => {
    const raDeg = 71.5;
    const decDeg = -19.25;
    const rPc = 42.75;
    const u = unitVectorFromRaDec(raDeg, decDeg);
    const at = equatorialTangentBasisAt(u.x * rPc, u.y * rPc, u.z * rPc);
    expect(at).not.toBeNull();
    expect(at!.rPc).toBeCloseTo(rPc, 10);
    const fromAngles = equatorialTangentBasis(raDeg, decDeg);
    for (const key of ['u', 'east', 'north'] as const) {
      expect(at!.basis[key].x).toBeCloseTo(fromAngles[key].x, 12);
      expect(at!.basis[key].y).toBeCloseTo(fromAngles[key].y, 12);
      expect(at!.basis[key].z).toBeCloseTo(fromAngles[key].z, 12);
    }
  });

  it('returns null at the origin, where no direction exists', () => {
    expect(equatorialTangentBasisAt(0, 0, 0)).toBeNull();
  });
});
