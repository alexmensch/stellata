// The orbit-plane normal both subsystems answer with, against published
// inclinations. See ../solar-system/ephemerides/README.md § Orbit rings
// and ../binaries/README.md § Tier mapping.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  ECLIPTIC_NORTH_POLE_ICRS,
  orbitPlaneNormalInto,
} from '../solar-system/ephemerides/orbit-rings-layer';
import {
  solOrbitGeometryAt,
  SOL_BODIES,
} from '../solar-system/planet-system';
import { PLANET_ORDER } from '../solar-system/ephemerides/ephemeris';
import {
  orbitNormalSky,
  projectSkyToICRS,
  type OrbitalElements,
} from '../binaries/binary-orbit-pure';
import { innermostRelationOf } from '../binaries/focal-chain';
import { starOrbitNormalIcrs } from '../binaries/orbit-relation-cache';
import {
  makeBinaries,
  makeRelation,
} from '../binaries/binary-relation-fixture';
import {
  FLAG_HAS_INCLINATION,
  FLAG_HAS_ORBIT,
  NO_PARENT,
} from '../binaries/binaries-loader';
import { captureOrbitFrame } from './attitude-pure';

const DEG = Math.PI / 180;
const J2000_T = 0;

/** Sol's host quaternion — +z onto the ecliptic pole, exactly what
 *  `PlanetBodyField.attachHost` composes for Sol. */
const solHostQuat = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(0, 0, 1),
  ECLIPTIC_NORTH_POLE_ICRS,
);

function bodyIndex(name: string): number {
  const i = SOL_BODIES.findIndex((b) => b.name === name);
  expect(i, `${name} must be in SOL_BODIES`).toBeGreaterThanOrEqual(0);
  return i;
}

function solBodyNormal(name: string, t = J2000_T): THREE.Vector3 {
  const g = solOrbitGeometryAt(t)[bodyIndex(name)];
  return orbitPlaneNormalInto(new THREE.Vector3(), g, solHostQuat);
}

/** Tilt of a body's orbit plane off the ecliptic, degrees. */
function tiltFromEclipticDeg(normal: THREE.Vector3): number {
  return normal.angleTo(ECLIPTIC_NORTH_POLE_ICRS) / DEG;
}

describe('solar-system orbit normals', () => {
  it('is a unit vector', () => {
    expect(solBodyNormal('Earth').length()).toBeCloseTo(1, 12);
    expect(solBodyNormal('Moon').length()).toBeCloseTo(1, 12);
  });

  // Earth defines the ecliptic, so its own inclination to it is ~1e-4 deg
  // (README § Equinoctial elements — the value whose sign flip forces the
  // non-singular element set). Anything above a hundredth of a degree here
  // means the host quaternion or the Rz·Rx·Rz composition is wrong.
  it('puts Earth on the ecliptic', () => {
    expect(tiltFromEclipticDeg(solBodyNormal('Earth'))).toBeLessThan(0.01);
  });

  // The Moon's orbit is inclined 5.145 deg to the ecliptic on the MEAN
  // element, and the osculating one this reads librates either side of it
  // as the Sun perturbs the orbit — published range roughly 5.0-5.3 deg.
  // So the claim is a band, checked at both ends of the clock's span, and
  // both bounds are asserted: a one-sided test would pass on a normal that
  // had collapsed onto the ecliptic.
  const MOON_INC_MIN_DEG = 4.9;
  const MOON_INC_MAX_DEG = 5.3;
  it.each([
    ['J2000', 0],
    ['3000 BC', -1_826_000],
    ['3000 AD', 1_100_000],
  ])('holds the Moon inside its libration band off the ecliptic (%s)', (_l, t) => {
    const tilt = tiltFromEclipticDeg(solBodyNormal('Moon', t));
    expect(tilt).toBeGreaterThan(MOON_INC_MIN_DEG);
    expect(tilt).toBeLessThan(MOON_INC_MAX_DEG);
  });

  // A moon's normal must come from its OWN orbit about its parent, never
  // its parent's about the host: those two differ by the whole band above,
  // and answering with the host plane is the failure the per-host
  // `orbitalPlaneNormalFor` would have shipped.
  it('answers a moon on its own orbit, not its parent’s', () => {
    const separation = solBodyNormal('Moon').angleTo(solBodyNormal('Earth')) / DEG;
    expect(separation).toBeGreaterThan(MOON_INC_MIN_DEG);
    expect(separation).toBeLessThan(MOON_INC_MAX_DEG);
  });

  // Triton orbits Neptune retrograde, so its angular-momentum normal lands
  // in the southern ecliptic hemisphere while a prograde moon's stays
  // north. Levelling on it genuinely inverts the view — that is the plane's
  // real sense, and both directions are pinned so a lost sign shows up.
  it('keeps each orbit’s prograde / retrograde sense', () => {
    expect(tiltFromEclipticDeg(solBodyNormal('Triton'))).toBeGreaterThan(90);
    expect(tiltFromEclipticDeg(solBodyNormal('Io'))).toBeLessThan(90);
  });

  it('is planet-count-agnostic about the index it is handed', () => {
    const geoms = solOrbitGeometryAt(J2000_T);
    expect(geoms.length).toBe(SOL_BODIES.length);
    expect(geoms.length).toBeGreaterThan(PLANET_ORDER.length);
  });
});

describe('binary orbit normals', () => {
  const elements = (over: Partial<OrbitalElements> = {}): OrbitalElements => ({
    P: 1000, T: 2451545, e: 0.3, a: 5,
    i: 60 * DEG, omega: 40 * DEG, Omega: 110 * DEG, q: 0.4,
    ...over,
  });

  it('is a unit vector', () => {
    const n = orbitNormalSky(elements());
    expect(Math.hypot(n.north, n.east, n.radial)).toBeCloseTo(1, 12);
  });

  // The normal is the cross product of the Thiele-Innes periastron and
  // quadrature vectors. Pinning it against that product rather than
  // restating the closed form is what would catch a sign slip in either.
  it('matches the Thiele-Innes P x Q product', () => {
    const el = elements();
    const { i, omega: w, Omega: O } = el;
    const cosI = Math.cos(i);
    const P = new THREE.Vector3(
      Math.cos(w) * Math.cos(O) - Math.sin(w) * Math.sin(O) * cosI,
      Math.cos(w) * Math.sin(O) + Math.sin(w) * Math.cos(O) * cosI,
      Math.sin(i) * Math.sin(w),
    );
    const Q = new THREE.Vector3(
      -Math.sin(w) * Math.cos(O) - Math.cos(w) * Math.sin(O) * cosI,
      -Math.sin(w) * Math.sin(O) + Math.cos(w) * Math.cos(O) * cosI,
      Math.sin(i) * Math.cos(w),
    );
    const cross = new THREE.Vector3().crossVectors(P, Q).normalize();
    const n = orbitNormalSky(el);
    expect(n.north).toBeCloseTo(cross.x, 12);
    expect(n.east).toBeCloseTo(cross.y, 12);
    expect(n.radial).toBeCloseTo(cross.z, 12);
  });

  // The acceptance check, and the one that ties the normal to a PUBLISHED
  // number: the angle between the orbit normal and the line of sight IS
  // the inclination, by definition — face-on (i = 0) points straight at
  // Sol, edge-on (i = 90) is perpendicular to it.
  it.each([0, 30, 60, 90, 157])(
    'stands i = %s deg off the line of sight',
    (iDeg) => {
      const system = { x: 12, y: -5, z: 8 };
      const n = orbitNormalSky(elements({ i: iDeg * DEG }));
      const icrs = projectSkyToICRS(system, n.north, n.east, n.radial);
      const los = new THREE.Vector3(system.x, system.y, system.z).normalize();
      const normal = new THREE.Vector3(icrs.x, icrs.y, icrs.z);
      expect(normal.length()).toBeCloseTo(1, 10);
      expect(normal.angleTo(los) / DEG).toBeCloseTo(iDeg, 6);
    },
  );

  // Algol's shape: a tight inner pair nested inside a wide outer one.
  // Relations are stored outer-before-inner, so index 1 is the inner.
  const OUTER_PRIMARY = 10;
  const OUTER_SECONDARY = 11;
  const INNER_SECONDARY = 12;
  const TIER_1 = FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION;
  const algol = () => makeBinaries([
    makeRelation({
      primaryIdx: OUTER_PRIMARY,
      secondaryIdx: OUTER_SECONDARY,
      flags: TIER_1,
      iRad: 20 * DEG,
    }),
    makeRelation({
      primaryIdx: OUTER_PRIMARY,
      secondaryIdx: INNER_SECONDARY,
      flags: TIER_1,
      iRad: 80 * DEG,
      parentRelation: 0,
    }),
  ]);

  it('picks the innermost pair a star belongs to', () => {
    const b = algol();
    // The shared primary sits in both pairs; the tight one is what it rides.
    expect(innermostRelationOf(b, OUTER_PRIMARY)).toBe(1);
    // The outer secondary is in the wide pair only — the inner pair's own
    // plane says nothing about where it orbits.
    expect(innermostRelationOf(b, OUTER_SECONDARY)).toBe(0);
    expect(innermostRelationOf(b, INNER_SECONDARY)).toBe(1);
    expect(innermostRelationOf(b, 999)).toBe(NO_PARENT);
  });

  it('resolves a star’s normal from its innermost pair', () => {
    const b = algol();
    const system = { x: 0, y: 0, z: 30 };
    const los = new THREE.Vector3(0, 0, 1);
    const angleFor = (idx: number) => {
      const n = starOrbitNormalIcrs(b, idx, system);
      expect(n).not.toBeNull();
      return new THREE.Vector3(n!.x, n!.y, n!.z).angleTo(los) / DEG;
    };
    expect(angleFor(INNER_SECONDARY)).toBeCloseTo(80, 6);
    expect(angleFor(OUTER_SECONDARY)).toBeCloseTo(20, 6);
  });

  it('declines a star in no pair', () => {
    expect(starOrbitNormalIcrs(algol(), 999, { x: 0, y: 0, z: 30 })).toBeNull();
  });

  // Tier 2's plane is the galactic-plane fallback, not a measurement, so
  // it must not surface as an orbit normal at all — offering it would let
  // a level-on-orbit gesture pass a convention off as an observation.
  it('declines a Tier-2 pair with no published inclination', () => {
    const b = makeBinaries([
      makeRelation({ primaryIdx: 1, secondaryIdx: 2, flags: FLAG_HAS_ORBIT, iRad: NaN }),
    ]);
    expect(starOrbitNormalIcrs(b, 2, { x: 0, y: 0, z: 30 })).toBeNull();
  });

  it('declines a Tier-3 pair with no orbit', () => {
    const b = makeBinaries([
      makeRelation({ primaryIdx: 1, secondaryIdx: 2, flags: 0 }),
    ]);
    expect(starOrbitNormalIcrs(b, 2, { x: 0, y: 0, z: 30 })).toBeNull();
  });
});

describe('captureOrbitFrame', () => {
  const cameraLookingAt = (dir: THREE.Vector3): THREE.Camera => {
    const c = new THREE.PerspectiveCamera();
    c.position.set(0, 0, 0);
    c.up.set(0, 0, 1);
    c.lookAt(dir);
    c.updateMatrixWorld(true);
    return c;
  };

  const normal = new THREE.Vector3(0, 1, 0);

  it('plants the pole on the orbit normal', () => {
    const f = captureOrbitFrame(cameraLookingAt(new THREE.Vector3(1, 0, 0)), normal);
    expect(f.key).toBe('orbit');
    expect(f.label).toBe('ORB');
    expect(f.pole.angleTo(normal)).toBeCloseTo(0, 12);
  });

  it('returns an orthonormal right-handed basis', () => {
    const f = captureOrbitFrame(cameraLookingAt(new THREE.Vector3(1, 0, 0)), normal);
    expect(f.pole.dot(f.zeroLon)).toBeCloseTo(0, 12);
    expect(f.east.length()).toBeCloseTo(1, 12);
    expect(
      new THREE.Vector3().crossVectors(f.pole, f.zeroLon).angleTo(f.east),
    ).toBeCloseTo(0, 12);
  });

  // Sighting straight down the pole leaves the boresight with no
  // component in the plane, so seeding zero longitude off it would
  // normalise a zero vector into NaN and take the whole ball with it.
  it('survives a boresight down the pole', () => {
    const f = captureOrbitFrame(cameraLookingAt(normal), normal);
    for (const v of [f.pole, f.zeroLon, f.east]) {
      expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
      expect(v.length()).toBeCloseTo(1, 12);
    }
    expect(f.pole.dot(f.zeroLon)).toBeCloseTo(0, 12);
  });
});
