// The orbit-plane normal both subsystems answer with, pinned against
// published inclinations, the ORB frame built from it, and the dispatcher
// that picks a subsystem per focused kind.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  ECLIPTIC_NORTH_POLE_ICRS,
  orbitPlaneNormalInto,
} from '../../solar-system/ephemerides/orbit-rings-layer';
import {
  solOrbitGeometryAt,
  SOL_BODIES,
} from '../../solar-system/planet-system';
import { PLANET_ORDER } from '../../solar-system/ephemerides/ephemeris';
import {
  orbitNormalSky,
  projectSkyToICRS,
  type OrbitalElements,
} from '../../binaries/binary-orbit-pure';
import { innermostRelationOf } from '../../binaries/focal-chain';
import { GALACTIC_NORTH_POLE_ICRS } from '../../galactic/galactic-coords';
import { starOrbitNormalIcrs } from '../../binaries/orbit-relation-cache';
import {
  makeBinaries,
  makeRelation,
} from '../../binaries/binary-relation-fixture';
import {
  FLAG_HAS_INCLINATION,
  FLAG_HAS_ORBIT,
  NO_PARENT,
  type BinariesData,
} from '../../binaries/binaries-loader';
import {
  captureOrbitFrame,
  emptyReferenceFrame,
  orbitFrameInto,
  orbitRideTurn,
  readAttitude,
  ridePoseAbout,
  type Attitude,
} from '../attitude-pure';
import { cadenceVisibleTurnRad } from '../../render-gate/cadence/clock-cadence-pure';
import {
  focusedOrbitFrom,
  focusedOrbitInto,
  resolveFocusedOrbit,
  type FocusedOrbit,
} from './orbit-plane';
import type { Stellata } from '../../stellata';

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
      const plane = starOrbitNormalIcrs(b, idx, system);
      expect(plane).not.toBeNull();
      const n = plane!.normal;
      return new THREE.Vector3(n.x, n.y, n.z).angleTo(los) / DEG;
    };
    expect(angleFor(INNER_SECONDARY)).toBeCloseTo(80, 6);
    expect(angleFor(OUTER_SECONDARY)).toBeCloseTo(20, 6);
  });

  // The pair the normal came from is handed back so a caller wanting the
  // other member cannot resolve a different one and pair a plane with a
  // longitude datum off some other orbit.
  it('hands back the pair the normal came from', () => {
    const b = algol();
    const system = { x: 0, y: 0, z: 30 };
    for (const idx of [OUTER_PRIMARY, OUTER_SECONDARY, INNER_SECONDARY]) {
      expect(starOrbitNormalIcrs(b, idx, system)!.relationIdx)
        .toBe(innermostRelationOf(b, idx));
    }
  });

  it('declines a star in no pair', () => {
    expect(starOrbitNormalIcrs(algol(), 999, { x: 0, y: 0, z: 30 })).toBeNull();
  });

  // Tier 2 has no published inclination, so the runtime draws its orbit in
  // the galactic plane — and this answers with that same plane. Gating ORB
  // on the tier instead would make the frame come and go on a distinction
  // nothing on screen exposes: both tiers draw a ring.
  it('answers a Tier-2 pair with the galactic plane it is drawn in', () => {
    const b = makeBinaries([
      makeRelation({ primaryIdx: 1, secondaryIdx: 2, flags: FLAG_HAS_ORBIT, iRad: NaN }),
    ]);
    for (const idx of [1, 2]) {
      const plane = starOrbitNormalIcrs(b, idx, { x: 12, y: -5, z: 8 });
      expect(plane, `star ${idx}`).not.toBeNull();
      expect(plane!.relationIdx).toBe(0);
      const n = new THREE.Vector3(plane!.normal.x, plane!.normal.y, plane!.normal.z);
      expect(n.angleTo(GALACTIC_NORTH_POLE_ICRS)).toBeCloseTo(0, 12);
      expect(n.length()).toBeCloseTo(1, 12);
    }
  });

  // The fallback plane is a property of the pair, not of where it is seen
  // from — unlike a Tier-1 normal, which projects through the system's own
  // sky tangent basis.
  it('gives the same Tier-2 plane from any vantage', () => {
    const b = makeBinaries([
      makeRelation({ primaryIdx: 1, secondaryIdx: 2, flags: FLAG_HAS_ORBIT, iRad: NaN }),
    ]);
    const a = starOrbitNormalIcrs(b, 2, { x: 100, y: 0, z: 0 })!.normal;
    const c = starOrbitNormalIcrs(b, 2, { x: 0, y: -40, z: 9 })!.normal;
    expect(a).toEqual(c);
  });

  // No elements at all means no orbit is evaluated and no ring is drawn, so
  // there is nothing to level on and the absence is visible on screen.
  it('declines a Tier-3 pair with no orbit', () => {
    const b = makeBinaries([
      makeRelation({ primaryIdx: 1, secondaryIdx: 2, flags: 0 }),
    ]);
    expect(starOrbitNormalIcrs(b, 2, { x: 0, y: 0, z: 30 })).toBeNull();
  });

  // Dabih's shape: a Tier-1 outer pair carrying a tight spectroscopic inner
  // one with no published inclination. Every member gets ORB — Aa on the
  // measured Aa-Ab plane, Ab and Ab2 on the plane their own inner pair is
  // drawn in. Numbers are beta Cap's, from data/binaries/multiples.tsv.
  const DABIH_AA = 20;
  const DABIH_AB = 21;   // = Ab1: shared node, secondary of the outer pair
  const DABIH_AB2 = 22;
  const OUTER_INC_DEG = 75.1;
  const dabih = () => makeBinaries([
    makeRelation({
      primaryIdx: DABIH_AA,
      secondaryIdx: DABIH_AB,
      flags: TIER_1,
      iRad: OUTER_INC_DEG * DEG,
      aAU: 5.799967,
    }),
    makeRelation({
      primaryIdx: DABIH_AB,
      secondaryIdx: DABIH_AB2,
      flags: FLAG_HAS_ORBIT,
      iRad: NaN,
      aAU: 0.132273,
      parentRelation: 0,
    }),
  ]);

  it('offers ORB to every member of a mixed-tier hierarchy', () => {
    const b = dabih();
    const system = { x: 0, y: 0, z: 30 };
    for (const idx of [DABIH_AA, DABIH_AB, DABIH_AB2]) {
      expect(starOrbitNormalIcrs(b, idx, system), `star ${idx}`).not.toBeNull();
    }
  });

  it('answers each member on the orbit it is itself on', () => {
    const b = dabih();
    const system = { x: 0, y: 0, z: 30 };
    const los = new THREE.Vector3(0, 0, 1);

    // Aa rides only the outer pair, whose plane is measured.
    const aa = starOrbitNormalIcrs(b, DABIH_AA, system)!;
    expect(aa.relationIdx).toBe(0);
    expect(new THREE.Vector3(aa.normal.x, aa.normal.y, aa.normal.z).angleTo(los) / DEG)
      .toBeCloseTo(OUTER_INC_DEG, 6);

    // Ab and Ab2 ride the inner pair — the orbit they are actually on, and
    // the one drawn around them, not the wider one their subsystem rides.
    for (const idx of [DABIH_AB, DABIH_AB2]) {
      const plane = starOrbitNormalIcrs(b, idx, system)!;
      expect(plane.relationIdx, `star ${idx}`).toBe(1);
      const n = new THREE.Vector3(plane.normal.x, plane.normal.y, plane.normal.z);
      expect(n.angleTo(GALACTIC_NORTH_POLE_ICRS)).toBeCloseTo(0, 12);
    }
  });
});

describe('ridePoseAbout — the orbit lock', () => {
  const normal = new THREE.Vector3(0, 1, 0).normalize();
  const pivot = new THREE.Vector3(4, -1, 2);

  const posed = (offset: THREE.Vector3, up: THREE.Vector3) => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.copy(pivot).add(offset);
    camera.up.copy(up);
    camera.lookAt(pivot);
    camera.updateMatrixWorld(true);
    return camera;
  };

  it('swings the pose about the pivot without changing its distance', () => {
    const position = pivot.clone().add(new THREE.Vector3(0, 0, 7));
    const up = new THREE.Vector3(0, 1, 0);
    const before = position.distanceTo(pivot);

    ridePoseAbout(position, up, pivot, normal, 0.9);

    expect(position.distanceTo(pivot)).toBeCloseTo(before, 9);
    expect(up.length()).toBeCloseTo(1, 12);
  });

  it('turns the offset and the up by the same angle', () => {
    const position = pivot.clone().add(new THREE.Vector3(0, 0, 7));
    const up = new THREE.Vector3(1, 0, 0);
    const offsetBefore = position.clone().sub(pivot);
    const upBefore = up.clone();

    ridePoseAbout(position, up, pivot, normal, 0.4);

    expect(position.clone().sub(pivot).angleTo(offsetBefore)).toBeCloseTo(0.4, 9);
    expect(up.angleTo(upBefore)).toBeCloseTo(0.4, 9);
  });

  // The promise the lock makes: the world turns under you and the instrument
  // does not move. Advance the orbit, rebuild ORB from it, ride the pose by
  // the same angle, and every axis of the reading has to come back identical.
  it('holds the whole attitude reading as the orbit advances', () => {
    const step = 0.37;
    const toCentre = new THREE.Vector3(3, 0, 0);
    const offset = new THREE.Vector3(1.5, 2, 6);
    const camera = posed(offset, new THREE.Vector3(0.2, 1, 0.1).normalize());

    const frame = emptyReferenceFrame();
    orbitFrameInto(frame, camera, normal, toCentre);
    const out: Attitude = { pitchRad: 0, bankRad: 0, lonRad: 0, sinFromPole: 1 };
    const before = { ...readAttitude(camera, frame, out) };

    // The object walks its orbit, so the datum turns by `step`...
    const later = toCentre.clone().applyAxisAngle(normal, step);
    orbitFrameInto(frame, camera, normal, later);
    // ...and the lock carries the camera with it.
    ridePoseAbout(camera.position, camera.up, pivot, normal, step);
    camera.lookAt(pivot);
    camera.updateMatrixWorld(true);

    const after = readAttitude(camera, frame, out);
    expect(after.pitchRad).toBeCloseTo(before.pitchRad, 9);
    expect(after.lonRad).toBeCloseTo(before.lonRad, 9);
    expect(after.bankRad).toBeCloseTo(before.bankRad, 9);
  });

  // The pose is position + up; every reader takes the QUATERNION, which is
  // derived from them. Riding without re-deriving it leaves the reading short
  // by exactly the step — the one-frame lag that shipped, and the reason the
  // test above calls `lookAt` after the ride rather than as scene-setting.
  it('leaves the reading a whole step short if the quaternion is not re-derived', () => {
    const step = 0.37;
    const toCentre = new THREE.Vector3(3, 0, 0);
    const camera = posed(new THREE.Vector3(1.5, 2, 6), new THREE.Vector3(0.2, 1, 0.1).normalize());

    const frame = emptyReferenceFrame();
    orbitFrameInto(frame, camera, normal, toCentre);
    const out: Attitude = { pitchRad: 0, bankRad: 0, lonRad: 0, sinFromPole: 1 };
    const before = { ...readAttitude(camera, frame, out) };

    orbitFrameInto(frame, camera, normal, toCentre.clone().applyAxisAngle(normal, step));
    ridePoseAbout(camera.position, camera.up, pivot, normal, step);
    // Deliberately no `camera.lookAt(pivot)` here.

    const after = readAttitude(camera, frame, out);
    expect(Math.abs(after.lonRad - before.lonRad)).toBeCloseTo(step, 9);
  });

  // Without the ride the same advance moves the reading, which is what makes
  // the assertion above a measurement rather than a tautology.
  it('is what holds it — the reading moves without the ride', () => {
    const step = 0.37;
    const toCentre = new THREE.Vector3(3, 0, 0);
    const camera = posed(new THREE.Vector3(1.5, 2, 6), new THREE.Vector3(0.2, 1, 0.1).normalize());

    const frame = emptyReferenceFrame();
    orbitFrameInto(frame, camera, normal, toCentre);
    const out: Attitude = { pitchRad: 0, bankRad: 0, lonRad: 0, sinFromPole: 1 };
    const before = { ...readAttitude(camera, frame, out) };

    orbitFrameInto(frame, camera, normal, toCentre.clone().applyAxisAngle(normal, step));
    const after = readAttitude(camera, frame, out);
    expect(Math.abs(after.lonRad - before.lonRad)).toBeCloseTo(step, 9);
  });
});

// The lock writes the camera BELOW the render gate, so the gate reads any
// write at all as a fresh camera move and renders the next tick. Declining a
// turn no display could show is the whole of what keeps it inside the cadence
// rather than pinning the gate open — `orbit-frame/README.md` § The lock.
describe('orbitRideTurn — the threshold that keeps the gate idling', () => {
  const pole = new THREE.Vector3(0, 1, 0);
  const datum = new THREE.Vector3(1, 0, 0);
  // The threshold at the cadence's own pinned vantage: 900 CSS px of viewport
  // height, 50° vertical FOV, device ratio 2.
  const PINNED_MIN_RAD = cadenceVisibleTurnRad(1031.32, 2);

  const turnedBy = (rad: number) => datum.clone().applyAxisAngle(pole, rad);

  it('is exactly zero for a datum that has not moved — a paused clock', () => {
    expect(orbitRideTurn(datum, datum.clone(), pole, PINNED_MIN_RAD)).toBe(0);
    // And with no threshold at all, so the zero is the datum's, not the band's.
    expect(orbitRideTurn(datum, datum.clone(), pole, 0)).toBe(0);
  });

  it('is exactly zero for a turn under the threshold', () => {
    const turn = orbitRideTurn(datum, turnedBy(PINNED_MIN_RAD * 0.9), pole, PINNED_MIN_RAD);
    expect(turn).toBe(0);
  });

  it('rides a turn past the threshold, signed', () => {
    const step = PINNED_MIN_RAD * 4;
    expect(orbitRideTurn(datum, turnedBy(step), pole, PINNED_MIN_RAD)).toBeCloseTo(step, 12);
    expect(orbitRideTurn(datum, turnedBy(-step), pole, PINNED_MIN_RAD)).toBeCloseTo(-step, 12);
  });

  // The reason a skipped turn must leave the datum un-advanced: measured from
  // where it was last RIDDEN from, sub-threshold steps add up into one ride
  // that carries the whole accumulated angle. Advancing it each frame would
  // drop every step and the lock would slip its grip.
  it('accumulates sub-threshold steps into one ride that carries them all', () => {
    const step = PINNED_MIN_RAD / 4;
    let ridden = 0;
    let frames = 0;
    for (let i = 1; i <= 4; i++) {
      const turn = orbitRideTurn(datum, turnedBy(step * i), pole, PINNED_MIN_RAD);
      if (turn !== 0) {
        ridden = turn;
        frames = i;
      }
    }
    expect(frames).toBe(4);
    expect(ridden).toBeCloseTo(step * 4, 12);
  });

  // A degenerate viewport rides every step. The safe failure for a scheduling
  // threshold is a frame too many, never an instrument that stops moving.
  it('rides any turn at all when the threshold is zero', () => {
    const tiny = 1e-9;
    expect(orbitRideTurn(datum, turnedBy(tiny), pole, 0)).toBeCloseTo(tiny, 15);
  });

  // What the threshold is worth in frames, which is the whole point of it:
  // Luna walks ~13.2°/day, so at live 1x it turns this little per 60 Hz tick.
  it('holds the gate for thousands of ticks at live 1x', () => {
    const lunaRadPerTick = ((13.2 * Math.PI) / 180 / 86400) / 60;
    expect(PINNED_MIN_RAD / lunaRadPerTick).toBeCloseTo(2727, 0);
  });
});

describe('orbitFrameInto — the live rebuild', () => {
  const cameraLookingAt = (dir: THREE.Vector3): THREE.Camera => {
    const c = new THREE.PerspectiveCamera();
    c.position.set(0, 0, 0);
    c.up.set(0, 0, 1);
    c.lookAt(dir);
    c.updateMatrixWorld(true);
    return c;
  };

  const normal = new THREE.Vector3(0, 1, 0);
  const camera = cameraLookingAt(new THREE.Vector3(1, 0, 0));

  it('answers exactly what the allocating builder does', () => {
    const toCentre = new THREE.Vector3(3, 0, 0);
    const allocated = captureOrbitFrame(camera, normal, toCentre);
    const written = orbitFrameInto(emptyReferenceFrame(), camera, normal, toCentre);
    expect(written.key).toBe(allocated.key);
    expect(written.label).toBe(allocated.label);
    for (const axis of ['pole', 'zeroLon', 'east'] as const) {
      expect(written[axis].angleTo(allocated[axis])).toBeCloseTo(0, 12);
    }
  });

  // The instrument runs this every rendered frame while ORB is up, so it has
  // to reuse the frame it was handed rather than hand back a fresh one.
  it('writes into the frame it is given and allocates no other', () => {
    const out = emptyReferenceFrame();
    const pole = out.pole;
    const returned = orbitFrameInto(out, camera, normal, new THREE.Vector3(3, 0, 0));
    expect(returned).toBe(out);
    expect(returned.pole).toBe(pole);
  });

  // Orbit rate: the datum is the direction to the orbit's centre, so as the
  // object walks its orbit the frame turns with it by the same angle. That is
  // the whole difference from a datum captured once.
  it('turns zero longitude with the object as the orbit advances', () => {
    const out = emptyReferenceFrame();
    orbitFrameInto(out, camera, normal, new THREE.Vector3(3, 0, 0));
    const before = out.zeroLon.clone();

    // A quarter turn about the orbit normal.
    const later = new THREE.Vector3(3, 0, 0)
      .applyAxisAngle(normal, Math.PI / 2);
    orbitFrameInto(out, camera, normal, later);

    expect(before.angleTo(out.zeroLon)).toBeCloseTo(Math.PI / 2, 9);
    // The plane it turns in is the orbit's own — the pole never moves.
    expect(out.pole.angleTo(normal)).toBeCloseTo(0, 12);
    expect(out.pole.dot(out.zeroLon)).toBeCloseTo(0, 12);
  });

  it('keeps the basis orthonormal through a full revolution', () => {
    const out = emptyReferenceFrame();
    for (let step = 0; step < 16; step++) {
      const toCentre = new THREE.Vector3(3, 0, 0)
        .applyAxisAngle(normal, (step / 16) * Math.PI * 2);
      orbitFrameInto(out, camera, normal, toCentre);
      for (const v of [out.pole, out.zeroLon, out.east]) {
        expect(v.length()).toBeCloseTo(1, 12);
      }
      expect(out.pole.dot(out.zeroLon)).toBeCloseTo(0, 12);
      expect(
        new THREE.Vector3().crossVectors(out.pole, out.zeroLon).angleTo(out.east),
      ).toBeCloseTo(0, 9);
    }
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
  const toCentre = new THREE.Vector3(3, 0, 0);

  it('plants the pole on the orbit normal', () => {
    const f = captureOrbitFrame(cameraLookingAt(new THREE.Vector3(1, 0, 0)), normal, toCentre);
    expect(f.key).toBe('orbit');
    expect(f.label).toBe('ORB');
    expect(f.pole.angleTo(normal)).toBeCloseTo(0, 12);
  });

  it('returns an orthonormal right-handed basis', () => {
    const f = captureOrbitFrame(cameraLookingAt(new THREE.Vector3(1, 0, 0)), normal, toCentre);
    expect(f.pole.dot(f.zeroLon)).toBeCloseTo(0, 12);
    expect(f.east.length()).toBeCloseTo(1, 12);
    expect(
      new THREE.Vector3().crossVectors(f.pole, f.zeroLon).angleTo(f.east),
    ).toBeCloseTo(0, 12);
  });

  // The datum is the orbit's own geometry, not the camera's: the same
  // object levelled from anywhere reads the same longitude.
  it('aims zero longitude at the centre of the orbit, whatever the camera faces', () => {
    for (const boresight of [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(-1, 0, -1),
    ]) {
      const f = captureOrbitFrame(cameraLookingAt(boresight), normal, toCentre);
      expect(f.zeroLon.angleTo(toCentre)).toBeCloseTo(0, 12);
    }
  });

  // A centre direction out of the plane (a normal read at a slightly
  // different t than the positions) still has to land IN it.
  it('projects an off-plane centre direction onto the orbital plane', () => {
    const f = captureOrbitFrame(
      cameraLookingAt(new THREE.Vector3(1, 0, 0)),
      normal,
      new THREE.Vector3(3, 7, 0),
    );
    expect(f.zeroLon.angleTo(new THREE.Vector3(1, 0, 0))).toBeCloseTo(0, 12);
    expect(f.pole.dot(f.zeroLon)).toBeCloseTo(0, 12);
  });

  // Sighting straight down the pole leaves the boresight with no
  // component in the plane, so seeding zero longitude off it would
  // normalise a zero vector into NaN and take the whole ball with it.
  it('survives a boresight down the pole with no centre direction', () => {
    const f = captureOrbitFrame(cameraLookingAt(normal), normal, new THREE.Vector3());
    for (const v of [f.pole, f.zeroLon, f.east]) {
      expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
      expect(v.length()).toBeCloseTo(1, 12);
    }
    expect(f.pole.dot(f.zeroLon)).toBeCloseTo(0, 12);
  });
});

describe('focusedOrbitInto', () => {
  const PRIMARY = 4;
  const SECONDARY = 7;
  const TIER_1 = FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION;

  const out = (): FocusedOrbit => ({
    normal: new THREE.Vector3(),
    toCentre: new THREE.Vector3(),
  });

  // Slots 4 and 7 sit 2 pc apart along +x; the rest of the buffer is far
  // enough away that a wrong slot cannot pass for the right one.
  const localPositions = () => {
    const a = new Float32Array(30).fill(100);
    a[PRIMARY * 3 + 0] = 1; a[PRIMARY * 3 + 1] = 0; a[PRIMARY * 3 + 2] = 0;
    a[SECONDARY * 3 + 0] = 3; a[SECONDARY * 3 + 1] = 0; a[SECONDARY * 3 + 2] = 0;
    return a;
  };

  const starHarness = (binaries: BinariesData | null) => {
    const positions = new Float32Array(30);
    for (const idx of [PRIMARY, SECONDARY]) positions[idx * 3 + 2] = 30;
    return {
      kinds: {},
      getT: () => 0,
      getBinaries: () => binaries,
      catalog: { positions },
      localPositions: localPositions(),
    } as unknown as Stellata;
  };

  const pair = () => makeBinaries([
    makeRelation({
      primaryIdx: PRIMARY,
      secondaryIdx: SECONDARY,
      flags: TIER_1,
      iRad: 40 * DEG,
    }),
  ]);

  it('declines when nothing is focused', () => {
    expect(focusedOrbitInto(out(), starHarness(pair()), null)).toBe(false);
  });

  // Probes, clouds and shells ride no orbit at all. The dispatcher must
  // fall through rather than reaching for a kind's index in the wrong table.
  it.each(['cloud', 'lg', 'shell', 'probe'] as const)('declines kind %s', (kind) => {
    expect(focusedOrbitInto(out(), starHarness(pair()), { kind, idx: PRIMARY }))
      .toBe(false);
  });

  it('declines a star before binaries.bin lands', () => {
    expect(focusedOrbitInto(out(), starHarness(null), { kind: 'star', idx: PRIMARY }))
      .toBe(false);
  });

  it('declines a star in no measured pair', () => {
    expect(focusedOrbitInto(out(), starHarness(pair()), { kind: 'star', idx: 9 }))
      .toBe(false);
  });

  // A catalog index past the position buffer means binaries.bin and
  // catalog.bin disagree; reading it would hand out whatever float sat
  // past the end.
  it('declines an index outside the position buffer', () => {
    const b = makeBinaries([
      makeRelation({ primaryIdx: 500, secondaryIdx: 501, flags: TIER_1 }),
    ]);
    expect(focusedOrbitInto(out(), starHarness(b), { kind: 'star', idx: 501 }))
      .toBe(false);
  });

  // Whichever member is focused, the barycentre lies between the two, so
  // the answer is the direction to the OTHER one — opposite for the pair.
  it('points each member at its partner', () => {
    const s = starHarness(pair());
    const fromSecondary = out();
    expect(focusedOrbitInto(fromSecondary, s, { kind: 'star', idx: SECONDARY })).toBe(true);
    const fromPrimary = out();
    expect(focusedOrbitInto(fromPrimary, s, { kind: 'star', idx: PRIMARY })).toBe(true);

    expect(fromSecondary.toCentre.clone().normalize().x).toBeCloseTo(-1, 6);
    expect(fromPrimary.toCentre.clone().normalize().x).toBeCloseTo(1, 6);
    expect(fromSecondary.normal.angleTo(fromPrimary.normal)).toBeCloseTo(0, 12);
  });

  it('returns a unit normal lying perpendicular to the centre direction', () => {
    const o = out();
    expect(focusedOrbitInto(o, starHarness(pair()), { kind: 'star', idx: SECONDARY }))
      .toBe(true);
    expect(o.normal.length()).toBeCloseTo(1, 12);
    // The two members' separation lies in the orbital plane by
    // construction, so the plane normal is square to it.
    expect(o.normal.dot(o.toCentre.clone().normalize())).toBeCloseTo(0, 6);
  });

  // A pair whose plane is the galactic fallback still fills both legs: the
  // orbit is drawn, so it can be levelled on. The centre direction is the
  // partner's, exactly as for a measured pair.
  it('fills both legs for a pair with no published inclination', () => {
    const b = makeBinaries([
      makeRelation({
        primaryIdx: PRIMARY, secondaryIdx: SECONDARY, flags: FLAG_HAS_ORBIT, iRad: NaN,
      }),
    ]);
    const s = starHarness(b);
    const fromSecondary = out();
    expect(focusedOrbitInto(fromSecondary, s, { kind: 'star', idx: SECONDARY })).toBe(true);
    const fromPrimary = out();
    expect(focusedOrbitInto(fromPrimary, s, { kind: 'star', idx: PRIMARY })).toBe(true);

    expect(fromSecondary.toCentre.clone().normalize().x).toBeCloseTo(-1, 6);
    expect(fromPrimary.toCentre.clone().normalize().x).toBeCloseTo(1, 6);
    for (const o of [fromSecondary, fromPrimary]) {
      expect(o.normal.angleTo(GALACTIC_NORTH_POLE_ICRS)).toBeCloseTo(0, 12);
    }
  });

  it('declines a planet before the planet kind attaches', () => {
    expect(focusedOrbitInto(out(), starHarness(pair()), { kind: 'planet', idx: 0 }))
      .toBe(false);
  });

  // The split the per-frame path depends on: a pair's plane is a static
  // function of frozen elements, so it is resolved once per focus and the
  // only thing a rendered frame re-reads is the direction to the partner.
  describe('resolveFocusedOrbit / focusedOrbitFrom', () => {
    it('carries a pair its plane normal, matching the one-shot exactly', () => {
      const s = starHarness(pair());
      const target = { kind: 'star', idx: PRIMARY } as const;
      const source = resolveFocusedOrbit(s, target)!;
      expect(source.kind).toBe('pair');
      const oneShot = out();
      focusedOrbitInto(oneShot, s, target);
      expect(source.kind === 'pair' && source.normal.angleTo(oneShot.normal))
        .toBeCloseTo(0, 12);
    });

    // The whole point of hoisting it: the members move every frame under the
    // clock and the plane does not, so re-deriving it per frame was work for
    // an answer that could not change.
    it('holds that normal while the members move', () => {
      const s = starHarness(pair());
      const source = resolveFocusedOrbit(s, { kind: 'star', idx: PRIMARY })!;
      expect(source.kind).toBe('pair');
      const before = out();
      expect(focusedOrbitFrom(before, source, s)).toBe(true);

      // Swing the partner a quarter of the way round in the local frame.
      const local = s.localPositions;
      local[SECONDARY * 3 + 0] = 1;
      local[SECONDARY * 3 + 1] = 2;
      const after = out();
      expect(focusedOrbitFrom(after, source, s)).toBe(true);

      expect(after.normal.angleTo(before.normal)).toBeCloseTo(0, 15);
      expect(after.toCentre.angleTo(before.toCentre)).toBeGreaterThan(0.5);
    });

    // A planet keeps no normal on the source: a precessing node genuinely
    // moves its plane, so `t` still has to reach it every frame.
    it('carries a planet nothing but its index', () => {
      const field = {
        orbitPlaneNormalOf: (_i: number, _t: number, n: THREE.Vector3) => {
          n.set(0, 0, 1);
          return true;
        },
        orbitCentreOffsetInto: (_i: number, c: THREE.Vector3) => {
          c.set(-2, 0, 0);
          return true;
        },
      };
      const s = { kinds: { planet: { field } }, getT: () => 0 } as unknown as Stellata;
      const source = resolveFocusedOrbit(s, { kind: 'planet', idx: 3 });
      expect(source).toEqual({ kind: 'planet', bodyIdx: 3 });
    });

    it('declines a source for a focus that rides no orbit', () => {
      expect(resolveFocusedOrbit(starHarness(pair()), null)).toBeNull();
      expect(resolveFocusedOrbit(starHarness(null), { kind: 'star', idx: PRIMARY }))
        .toBeNull();
      expect(resolveFocusedOrbit(starHarness(pair()), { kind: 'probe', idx: 0 }))
        .toBeNull();
    });
  });

  // Both legs must land: a normal with no centre direction would capture a
  // plane whose zero longitude fell back to the boresight, which is the
  // vantage-dependent datum ORB exists to replace.
  it('declines a planet whose centre offset is unavailable', () => {
    const field = {
      orbitPlaneNormalOf: (_i: number, _t: number, n: THREE.Vector3) => {
        n.set(0, 0, 1);
        return true;
      },
      orbitCentreOffsetInto: () => false,
    };
    const s = {
      kinds: { planet: { field } },
      getT: () => 0,
    } as unknown as Stellata;
    expect(focusedOrbitInto(out(), s, { kind: 'planet', idx: 0 })).toBe(false);
  });

  it('fills both legs for a planet whose host carries live elements', () => {
    const field = {
      orbitPlaneNormalOf: (_i: number, _t: number, n: THREE.Vector3) => {
        n.set(0, 0, 1);
        return true;
      },
      orbitCentreOffsetInto: (_i: number, c: THREE.Vector3) => {
        c.set(-2, 0, 0);
        return true;
      },
    };
    const s = {
      kinds: { planet: { field } },
      getT: () => 0,
    } as unknown as Stellata;
    const o = out();
    expect(focusedOrbitInto(o, s, { kind: 'planet', idx: 3 })).toBe(true);
    expect(o.normal.z).toBeCloseTo(1, 12);
    expect(o.toCentre.x).toBeCloseTo(-2, 12);
  });
});
