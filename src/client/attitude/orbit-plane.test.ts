// The orbit-plane normal both subsystems answer with, pinned against
// published inclinations, the ORB frame built from it, and the dispatcher
// that picks a subsystem per focused kind.

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
  type BinariesData,
} from '../binaries/binaries-loader';
import { captureOrbitFrame } from './attitude-pure';
import { focusedOrbitInto, type FocusedOrbit } from './orbit-plane';
import type { Stellata } from '../stellata';

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

  // Every member of a Tier-1 pair takes the OTHER one as its datum.
  it('hands back the pair’s other member as the longitude datum', () => {
    const b = algol();
    const system = { x: 0, y: 0, z: 30 };
    const partner = (idx: number) => starOrbitNormalIcrs(b, idx, system)!.partnerIdx;
    expect(partner(OUTER_SECONDARY)).toBe(OUTER_PRIMARY);
    expect(partner(INNER_SECONDARY)).toBe(OUTER_PRIMARY);
    expect(partner(OUTER_PRIMARY)).toBe(INNER_SECONDARY); // its innermost pair
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

  // Dabih's shape, and the bug it surfaced: a Tier-1 outer pair carrying a
  // tight spectroscopic inner one with no published inclination. Both
  // members of that inner pair ride the measured outer orbit, so refusing
  // at the innermost pair left them with no ORB frame while the outer
  // primary had one. Numbers are beta Cap's, from data/binaries/multiples.tsv.
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

  it('rides the measured ancestor when the innermost pair is Tier 2', () => {
    const b = dabih();
    const system = { x: 0, y: 0, z: 30 };
    const los = new THREE.Vector3(0, 0, 1);
    for (const idx of [DABIH_AB, DABIH_AB2]) {
      const plane = starOrbitNormalIcrs(b, idx, system);
      expect(plane, `star ${idx} must reach the outer pair`).not.toBeNull();
      expect(plane!.relationIdx).toBe(0);
      // The datum is the outer pair's OTHER side, never a star inside the
      // focused one's own subsystem.
      expect(plane!.partnerIdx).toBe(DABIH_AA);
      const n = plane!.normal;
      expect(new THREE.Vector3(n.x, n.y, n.z).angleTo(los) / DEG)
        .toBeCloseTo(OUTER_INC_DEG, 6);
    }
  });

  // The innermost pair still wins when it IS measured — walking outward is
  // a fallback, not a new preference for the wider orbit.
  it('still prefers the innermost pair when that one is Tier 1', () => {
    const b = algol();
    expect(starOrbitNormalIcrs(b, OUTER_PRIMARY, { x: 0, y: 0, z: 30 })!.relationIdx)
      .toBe(1);
  });

  it('walks out through a Tier-3 innermost pair too', () => {
    const b = makeBinaries([
      makeRelation({ primaryIdx: 1, secondaryIdx: 2, flags: TIER_1, iRad: 35 * DEG }),
      makeRelation({ primaryIdx: 2, secondaryIdx: 3, flags: 0, parentRelation: 0 }),
    ]);
    const plane = starOrbitNormalIcrs(b, 3, { x: 0, y: 0, z: 30 });
    expect(plane!.relationIdx).toBe(0);
    expect(plane!.partnerIdx).toBe(1);
  });

  // binaries.bin reaches two hops (14 stars); the walk must not stop at one.
  it('walks more than one hop to reach a measured pair', () => {
    const b = makeBinaries([
      makeRelation({ primaryIdx: 1, secondaryIdx: 2, flags: TIER_1, iRad: 50 * DEG }),
      makeRelation({ primaryIdx: 2, secondaryIdx: 3, flags: FLAG_HAS_ORBIT, iRad: NaN, parentRelation: 0 }),
      makeRelation({ primaryIdx: 3, secondaryIdx: 4, flags: FLAG_HAS_ORBIT, iRad: NaN, parentRelation: 1 }),
    ]);
    const plane = starOrbitNormalIcrs(b, 4, { x: 0, y: 0, z: 30 });
    expect(plane!.relationIdx).toBe(0);
    expect(plane!.partnerIdx).toBe(1);
  });

  // The whole chain unmeasured is still a silent no-op: the only plane on
  // offer would be the galactic fallback.
  it('declines when no pair on the chain carries a plane', () => {
    const b = makeBinaries([
      makeRelation({ primaryIdx: 1, secondaryIdx: 2, flags: FLAG_HAS_ORBIT, iRad: NaN }),
      makeRelation({ primaryIdx: 2, secondaryIdx: 3, flags: 0, parentRelation: 0 }),
    ]);
    expect(starOrbitNormalIcrs(b, 3, { x: 0, y: 0, z: 30 })).toBeNull();
  });

  // A parentRelation cycle is malformed data, not a reachable state — but
  // the walk must terminate rather than hang the frame that levels.
  it('terminates on a parentRelation cycle', () => {
    const b = makeBinaries([
      makeRelation({ primaryIdx: 1, secondaryIdx: 2, flags: FLAG_HAS_ORBIT, iRad: NaN, parentRelation: 1 }),
      makeRelation({ primaryIdx: 2, secondaryIdx: 3, flags: FLAG_HAS_ORBIT, iRad: NaN, parentRelation: 0 }),
    ]);
    expect(starOrbitNormalIcrs(b, 3, { x: 0, y: 0, z: 30 })).toBeNull();
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

  // The Dabih case end to end: focusing a member of an unmeasured inner
  // pair must still fill both legs off the measured outer orbit, and aim
  // the datum OUT of its own subsystem — at the far member, not at the
  // sibling sitting a fraction of the outer separation away.
  it('fills both legs for a member of an unmeasured inner pair', () => {
    const AA = 1;
    const AB = 4;   // shared node: outer secondary, inner primary
    const AB2 = 7;
    const b = makeBinaries([
      makeRelation({ primaryIdx: AA, secondaryIdx: AB, flags: TIER_1, iRad: 40 * DEG }),
      makeRelation({
        primaryIdx: AB, secondaryIdx: AB2, flags: FLAG_HAS_ORBIT, iRad: NaN, parentRelation: 0,
      }),
    ]);
    const positions = new Float32Array(30);
    for (const idx of [AA, AB, AB2]) positions[idx * 3 + 2] = 30;
    // AA at x=1, AB at x=3, AB2 a hair off AB — the inner pair is nested
    // well inside the outer separation, as a real hierarchy is.
    const local = new Float32Array(30).fill(100);
    local[AA * 3] = 1; local[AA * 3 + 1] = 0; local[AA * 3 + 2] = 0;
    local[AB * 3] = 3; local[AB * 3 + 1] = 0; local[AB * 3 + 2] = 0;
    local[AB2 * 3] = 3.01; local[AB2 * 3 + 1] = 0; local[AB2 * 3 + 2] = 0;
    const s = {
      kinds: {},
      getT: () => 0,
      getBinaries: () => b,
      catalog: { positions },
      localPositions: local,
    } as unknown as Stellata;

    for (const idx of [AB, AB2]) {
      const o = out();
      expect(focusedOrbitInto(o, s, { kind: 'star', idx }), `star ${idx}`).toBe(true);
      // Toward AA: -x from either member of the AB subsystem.
      expect(o.toCentre.clone().normalize().x).toBeCloseTo(-1, 6);
      expect(o.normal.length()).toBeCloseTo(1, 12);
    }
  });

  it('declines a planet before the planet kind attaches', () => {
    expect(focusedOrbitInto(out(), starHarness(pair()), { kind: 'planet', idx: 0 }))
      .toBe(false);
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
