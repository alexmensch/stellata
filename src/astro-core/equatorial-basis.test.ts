import { describe, it, expect } from 'vitest';

import {
  angularSeparationArcsec,
  directionAtEpoch,
  equatorialTangentBasis,
  equatorialTangentBasisAt,
  equatorialTangentBasisRad,
  raDecFromUnitVector,
  skyPositionAtEpoch,
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

  it('pins the canonical (0,0) basis and is RA-wrap invariant at 360', () => {
    const b = equatorialTangentBasis(0, 0);
    expect(b.u).toEqual({ x: 1, y: 0, z: 0 });
    expect(b.east.x).toBeCloseTo(0, 12);
    expect(b.east.y).toBeCloseTo(1, 12);
    expect(b.north.z).toBeCloseTo(1, 12);
    const wrap = equatorialTangentBasis(360, 0);
    expect(wrap.east.y).toBeCloseTo(b.east.y, 12);
    expect(wrap.north.z).toBeCloseTo(b.north.z, 12);
  });

  it('degrees wrapper matches the radians core', () => {
    const deg = equatorialTangentBasis(200, -33);
    const rad = equatorialTangentBasisRad(200 * DEG_TO_RAD, -33 * DEG_TO_RAD);
    expect(deg).toEqual(rad);
  });
});

describe('unitVectorFromRaDec', () => {
  it('places the axes where the equatorial convention says', () => {
    const axes: [number, number, UnitVector][] = [
      [0, 0, { x: 1, y: 0, z: 0 }],
      [90, 0, { x: 0, y: 1, z: 0 }],
      [0, 90, { x: 0, y: 0, z: 1 }],
      [123, -90, { x: 0, y: 0, z: -1 }],
    ];
    for (const [ra, dec, want] of axes) {
      const v = unitVectorFromRaDec(ra, dec);
      expect(v.x, `x at (${ra}, ${dec})`).toBeCloseTo(want.x, 12);
      expect(v.y, `y at (${ra}, ${dec})`).toBeCloseTo(want.y, 12);
      expect(v.z, `z at (${ra}, ${dec})`).toBeCloseTo(want.z, 12);
    }
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

describe('directionAtEpoch', () => {
  it('returns the measured direction unchanged when either PM is missing', () => {
    const u = directionAtEpoch({ raDeg: 100, decDeg: 20 }, { pmRaMasyr: null, pmDecMasyr: -10 }, 2016, 2000);
    const v = directionAtEpoch({ raDeg: 100, decDeg: 20 }, { pmRaMasyr: 10, pmDecMasyr: null }, 2016, 2000);
    const raw = unitVectorFromRaDec(100, 20);
    expect(angularSeparationArcsec(u, raw)).toBe(0);
    expect(angularSeparationArcsec(v, raw)).toBe(0);
  });

  it('positive pmra moves east (+RA), positive pmdec moves north (+Dec)', () => {
    // 1000 mas/yr over +10 yr = 10″. At (0, 0) east is +y, north is +z.
    const east = directionAtEpoch({ raDeg: 0, decDeg: 0 }, { pmRaMasyr: 1000, pmDecMasyr: 0 }, 2000, 2010);
    expect(east.y).toBeGreaterThan(0);
    expect(east.z).toBeCloseTo(0, 12);
    expect(angularSeparationArcsec(east, unitVectorFromRaDec(0, 0))).toBeCloseTo(10, 6);

    const north = directionAtEpoch({ raDeg: 0, decDeg: 0 }, { pmRaMasyr: 0, pmDecMasyr: 1000 }, 2000, 2010);
    expect(north.z).toBeGreaterThan(0);
    expect(north.y).toBeCloseTo(0, 12);
    expect(angularSeparationArcsec(north, unitVectorFromRaDec(0, 0))).toBeCloseTo(10, 6);
  });

  it('backwards propagation (toEpoch < fromEpoch) flips the displacement sign', () => {
    const fwd = directionAtEpoch({ raDeg: 0, decDeg: 0 }, { pmRaMasyr: 1000, pmDecMasyr: 0 }, 2000, 2016);
    const back = directionAtEpoch({ raDeg: 0, decDeg: 0 }, { pmRaMasyr: 1000, pmDecMasyr: 0 }, 2016, 2000);
    expect(fwd.y).toBeGreaterThan(0);
    expect(back.y).toBeLessThan(0);
  });

  it('pmra is the cos δ-applied on-sky rate: displacement is dec-independent', () => {
    // If the implementation wrongly divided (or multiplied) by cos δ,
    // the on-sky displacement at dec 60° would be 2× (or ½×) the
    // equatorial one.
    const atEquator = angularSeparationArcsec(
      directionAtEpoch({ raDeg: 0, decDeg: 0 }, { pmRaMasyr: 500, pmDecMasyr: 0 }, 2000, 2010),
      unitVectorFromRaDec(0, 0),
    );
    const atDec60 = angularSeparationArcsec(
      directionAtEpoch({ raDeg: 0, decDeg: 60 }, { pmRaMasyr: 500, pmDecMasyr: 0 }, 2000, 2010),
      unitVectorFromRaDec(0, 60),
    );
    expect(atDec60).toBeCloseTo(atEquator, 5);
  });

  it('round-trips through an epoch and back', () => {
    const there = directionAtEpoch({ raDeg: 269.45, decDeg: 4.74 }, { pmRaMasyr: -801.551, pmDecMasyr: 10362.394 }, 2016, 2000);
    // Convert back to (ra, dec) and re-propagate with the same PM.
    const home = directionAtEpoch(raDecFromUnitVector(there), { pmRaMasyr: -801.551, pmDecMasyr: 10362.394 }, 2000, 2016);
    expect(angularSeparationArcsec(home, unitVectorFromRaDec(269.45, 4.74))).toBeCloseTo(0.000853, 6);
  });

  it('stays finite and unit-length near the celestial pole', () => {
    const u = directionAtEpoch({ raDeg: 10, decDeg: 89.95 }, { pmRaMasyr: 5000, pmDecMasyr: 2000 }, 2000, 2016);
    const norm = Math.hypot(u.x, u.y, u.z);
    expect(norm).toBeCloseTo(1, 12);
  });
});

describe('angularSeparationArcsec', () => {
  it('resolves a micro-arcsecond separation that acos would round to zero', () => {
    const a = unitVectorFromRaDec(30, 10);
    const b = directionAtEpoch({ raDeg: 30, decDeg: 10 }, { pmRaMasyr: 0, pmDecMasyr: 1e-3 }, 2000, 2001);
    expect(angularSeparationArcsec(a, b)).toBeCloseTo(1e-6, 12);
  });
});

describe('skyPositionAtEpoch', () => {
  it('returns the position object itself when either PM component is missing', () => {
    const pos = { raDeg: 100, decDeg: 20 };
    expect(skyPositionAtEpoch(pos, { pmRaMasyr: null, pmDecMasyr: 5 }, 2016, 2000)).toBe(pos);
    expect(skyPositionAtEpoch(pos, { pmRaMasyr: 5, pmDecMasyr: null }, 2016, 2000)).toBe(pos);
  });

  it('is directionAtEpoch read back as (ra, dec), RA wrapped into [0, 360)', () => {
    const pos = { raDeg: 0.001, decDeg: 0 };
    const pm = { pmRaMasyr: 7200, pmDecMasyr: 0 };
    const back = skyPositionAtEpoch(pos, pm, 2000, 1999);
    expect(back).toEqual(raDecFromUnitVector(directionAtEpoch(pos, pm, 2000, 1999)));
    expect(back.raDeg).toBeCloseTo(359.999, 9);
  });

  it('moves a source at the pole by its on-sky rate', () => {
    const pole = { raDeg: 10, decDeg: 90 };
    const moved = skyPositionAtEpoch(pole, { pmRaMasyr: 3600, pmDecMasyr: 0 }, 2000, 2001);
    expect(90 - moved.decDeg).toBeCloseTo(3.6 / 3600, 9);
  });
});

describe('raDecFromUnitVector', () => {
  it('keeps RA in [0, 360): a tiny negative angle and −0 both read 0', () => {
    expect(raDecFromUnitVector({ x: 1, y: -1e-17, z: 0 }).raDeg).toBe(0);
    expect(Object.is(raDecFromUnitVector({ x: 1, y: -0, z: 0 }).raDeg, 0)).toBe(true);
    expect(raDecFromUnitVector({ x: 1, y: -1e-3, z: 0 }).raDeg).toBeCloseTo(360 - Math.atan(1e-3) * 180 / Math.PI, 9);
  });
});
