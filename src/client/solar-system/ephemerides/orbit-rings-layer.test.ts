import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  ECLIPTIC_NORTH_POLE_ICRS,
  RING_GEOMETRY_DRIFT_TOLERANCE,
  ringGeometryDrifted,
  RING_VISIBILITY_THRESHOLD_PX,
  OrbitRingsLayer,
  buildEllipsePoints,
  orbitalPlaneNormalFor,
  placeholderEccentricAnomaly,
  planetLocalPosition,
  refPlaneToEclipticQuat,
  ringVisibility,
  solidityForType,
  writeRingVerts,
} from './orbit-rings-layer';
import { LINE_ANCHOR_MAX_DRIFT_PC, ORBIT_LINE_SEGMENTS } from '../../util/orbit-line';
import { AU_KM, AU_PC, KM_PC } from '../../util/astronomy-constants';
import { GALACTIC_NORTH_POLE_ICRS } from '../../galactic/galactic-coords';
import { getPlanetPositions, PLANET_ORDER } from './ephemeris';
import { MOON_ELEMENTS, moonOffsetEcliptic } from './moon-ephemeris';
import {
  SOL_BODIES,
  solOrbitGeometryAt,
  type Planet,
  type PlanetSystem,
} from '../planet-system';

// J2000.0 in Unix-seconds — the model time every static-geometry test
// builds rings at.
const T0 = 946728000;

// Day offsets the moon parity pins sample. A secular element term is
// exactly zero at J2000 and grows from there, so samples clustered
// around T0 cannot see one: Triton's node drift put its ring 21 500 km
// off the body by 2026 while a 40-day sample still read 2 km. The outer
// pair is the model clock's own 3000 BC / 3000 AD clamp.
const MOON_SAMPLE_DAY_OFFSETS = [0, 3.1, 11.7, 40.4, 9700, -365250, 365250];

function makePlanet(overrides: Partial<Planet> = {}): Planet {
  return {
    name: 'Test',
    radiusKm: 1000,
    semiMajorAxisAu: 1,
    eccentricity: 0,
    type: 'rocky',
    colour: [1, 1, 1],
    albedo: 0.5,
    ...overrides,
  };
}

function makeCamera(distancePc: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, 1, 1e-7, 1000);
  cam.position.set(0, 0, distancePc);
  return cam;
}

describe('AU_PC', () => {
  it('matches IAU 2012 to 7 significant figures', () => {
    expect(AU_PC).toBeCloseTo(4.8481368e-6, 12);
  });
});

describe('ECLIPTIC_NORTH_POLE_ICRS', () => {
  // Independent anchors only — never assert against (±sinε, cosε)
  // expressions that share their derivation with the constant. A sign
  // flip in the constant once shipped because the test pinned the same
  // (wrong) formula.

  it('matches the published NEP sky position RA 18h / Dec +66.5607°', () => {
    const raRad = (270 * Math.PI) / 180; // 18h
    const decRad = ((90 - 23.4392911) * Math.PI) / 180;
    expect(ECLIPTIC_NORTH_POLE_ICRS.length()).toBeCloseTo(1, 6);
    expect(ECLIPTIC_NORTH_POLE_ICRS.x).toBeCloseTo(
      Math.cos(decRad) * Math.cos(raRad), 6);
    expect(ECLIPTIC_NORTH_POLE_ICRS.y).toBeCloseTo(
      Math.cos(decRad) * Math.sin(raRad), 6);
    expect(ECLIPTIC_NORTH_POLE_ICRS.z).toBeCloseTo(
      Math.sin(decRad), 6);
  });

  it('round-trips to RA 18h / Dec +66.5607° from Cartesian', () => {
    const raDeg =
      ((Math.atan2(ECLIPTIC_NORTH_POLE_ICRS.y, ECLIPTIC_NORTH_POLE_ICRS.x)
        * 180) / Math.PI + 360) % 360;
    const decDeg = (Math.asin(ECLIPTIC_NORTH_POLE_ICRS.z) * 180) / Math.PI;
    expect(raDeg).toBeCloseTo(270, 4);
    expect(decDeg).toBeCloseTo(66.5607089, 4);
  });

  it('June-solstice Sun lands at Dec +23.44° through the production quaternion path', () => {
    // The cheapest mirror detector: geocentric ecliptic (0, 1, 0) is the
    // Sun's direction at the June solstice (ecliptic longitude 90°).
    // Rotated ecliptic → ICRS it must sit at Dec +23.44° (northern
    // summer), RA 6h. The mirrored pole puts it at −23.44°.
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      ECLIPTIC_NORTH_POLE_ICRS.clone(),
    );
    const solsticeSun = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const decDeg = (Math.asin(solsticeSun.z) * 180) / Math.PI;
    const raDeg =
      ((Math.atan2(solsticeSun.y, solsticeSun.x) * 180) / Math.PI + 360) % 360;
    expect(decDeg).toBeCloseTo(23.4392911, 6);
    expect(raDeg).toBeCloseTo(90, 6);
  });

  it('the vernal equinox direction is invariant under the ecliptic→ICRS rotation', () => {
    // Both frames share +x (First Point of Aries). If the quaternion
    // moves it, the rotation axis is wrong.
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      ECLIPTIC_NORTH_POLE_ICRS.clone(),
    );
    const aries = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    expect(aries.x).toBeCloseTo(1, 6);
    expect(aries.y).toBeCloseTo(0, 6);
    expect(aries.z).toBeCloseTo(0, 6);
  });
});

describe('orbitalPlaneNormalFor', () => {
  it('returns the ecliptic normal for Sol', () => {
    const n = orbitalPlaneNormalFor(7, 7);
    expect(n.x).toBeCloseTo(ECLIPTIC_NORTH_POLE_ICRS.x, 12);
    expect(n.y).toBeCloseTo(ECLIPTIC_NORTH_POLE_ICRS.y, 12);
    expect(n.z).toBeCloseTo(ECLIPTIC_NORTH_POLE_ICRS.z, 12);
  });

  it('returns the galactic plane normal for any other host', () => {
    const n = orbitalPlaneNormalFor(42, 7);
    expect(n.x).toBeCloseTo(GALACTIC_NORTH_POLE_ICRS.x, 12);
    expect(n.y).toBeCloseTo(GALACTIC_NORTH_POLE_ICRS.y, 12);
    expect(n.z).toBeCloseTo(GALACTIC_NORTH_POLE_ICRS.z, 12);
  });

  it('returns a fresh vector — never the cached export', () => {
    // Mutating the return value must not corrupt the shared constant.
    const n = orbitalPlaneNormalFor(7, 7);
    n.set(0, 0, 0);
    expect(ECLIPTIC_NORTH_POLE_ICRS.length()).toBeCloseTo(1, 6);
    const m = orbitalPlaneNormalFor(99, 7);
    m.set(0, 0, 0);
    expect(GALACTIC_NORTH_POLE_ICRS.length()).toBeCloseTo(1, 6);
  });
});

describe('ringVisibility', () => {
  it('hides rings whose pixel gap to a neighbour is too small', () => {
    // Rings at 10, 14, 30, 32, 100 px. With threshold 6:
    //   i=0: gapNext = 4  → hidden
    //   i=1: gapPrev = 4  → hidden
    //   i=2: gapPrev=16, gapNext=2 → hidden
    //   i=3: gapPrev = 2  → hidden
    //   i=4: gapPrev = 68 → visible (no next neighbour)
    expect(ringVisibility([10, 14, 30, 32, 100], 6)).toEqual([
      false, false, false, false, true,
    ]);
  });

  it('renders the innermost / outermost rings using their single neighbour gap', () => {
    expect(ringVisibility([10, 50], 6)).toEqual([true, true]);
    expect(ringVisibility([10, 12], 6)).toEqual([false, false]);
  });

  it('renders an isolated single ring', () => {
    expect(ringVisibility([42], 6)).toEqual([true]);
  });

  it('renders nothing for an empty system', () => {
    expect(ringVisibility([], 6)).toEqual([]);
  });

  it('uses strict-greater-than against the threshold (gap == threshold hides)', () => {
    expect(ringVisibility([0, 6], 6)).toEqual([false, false]);
    // Gap 7 clears the threshold for both, but the inner ring's own
    // radius (0 px) fails the size floor.
    expect(ringVisibility([0, 7], 6)).toEqual([false, true]);
    expect(ringVisibility([7, 14], 6)).toEqual([true, true]);
  });

  it('suppresses a lone sub-pixel ring via the own-radius floor', () => {
    // A single-moon parent seen from across the system: no neighbour
    // gap exists to fail, so the ring's own size must gate it.
    expect(ringVisibility([2], 6)).toEqual([false]);
    expect(ringVisibility([42], 6)).toEqual([true]);
  });
});

describe('buildEllipsePoints', () => {
  it('emits a circle when eccentricity is zero', () => {
    const segments = 64;
    const verts = new Float32Array(segments * 3);
    buildEllipsePoints(1, 0, segments, verts);
    for (let i = 0; i < segments; i++) {
      const x = verts[i * 3];
      const y = verts[i * 3 + 1];
      const z = verts[i * 3 + 2];
      expect(z).toBe(0);
      expect(Math.hypot(x, y)).toBeCloseTo(1, 6);
    }
  });

  it('places the host (origin) at one focus, with perihelion on +x', () => {
    // Eccentricity 0.5: c = a·e = 0.5, b = a·√(1−e²) ≈ 0.866.
    // Perihelion at +x = a − c = 0.5 ; aphelion at −x = −a − c = −1.5.
    const segments = 4;
    const verts = new Float32Array(segments * 3);
    buildEllipsePoints(1, 0.5, segments, verts);
    // t = 0 → perihelion
    expect(verts[0]).toBeCloseTo(0.5, 6);
    expect(verts[1]).toBeCloseTo(0, 6);
    // t = π → aphelion
    expect(verts[2 * 3]).toBeCloseTo(-1.5, 6);
    expect(verts[2 * 3 + 1]).toBeCloseTo(0, 6);
  });

  it('every point satisfies the ellipse equation around its centre', () => {
    const a = 5;
    const e = 0.3;
    const c = a * e;
    const b = a * Math.sqrt(1 - e * e);
    const segments = 32;
    const verts = new Float32Array(segments * 3);
    buildEllipsePoints(a, e, segments, verts);
    for (let i = 0; i < segments; i++) {
      const x = verts[i * 3] + c; // shift so centre is at origin
      const y = verts[i * 3 + 1];
      // (x/a)² + (y/b)² = 1 to within float32 noise
      expect((x * x) / (a * a) + (y * y) / (b * b)).toBeCloseTo(1, 5);
    }
  });

  it('emits all-zero output if segments is zero', () => {
    const verts = new Float32Array(0);
    buildEllipsePoints(1, 0, 0, verts);
    expect(verts.length).toBe(0);
  });
});

describe('RING_VISIBILITY_THRESHOLD_PX', () => {
  it('is a small positive pixel count consistent with the bead recommendation', () => {
    expect(RING_VISIBILITY_THRESHOLD_PX).toBeGreaterThanOrEqual(4);
    expect(RING_VISIBILITY_THRESHOLD_PX).toBeLessThanOrEqual(8);
  });
});

describe('KM_PC', () => {
  it('relates to AU_PC via 1 AU = 149597870.7 km', () => {
    expect(KM_PC * AU_KM).toBeCloseTo(AU_PC, 12);
  });

  it('agrees with the published 1 km ≈ 3.241e-14 pc figure', () => {
    expect(KM_PC).toBeCloseTo(3.2407793e-14, 18);
  });
});

describe('placeholderEccentricAnomaly', () => {
  it('spreads N planets evenly around their orbits', () => {
    expect(placeholderEccentricAnomaly(0, 8)).toBe(0);
    expect(placeholderEccentricAnomaly(2, 8)).toBeCloseTo(Math.PI / 2, 12);
    expect(placeholderEccentricAnomaly(4, 8)).toBeCloseTo(Math.PI, 12);
    expect(placeholderEccentricAnomaly(7, 8)).toBeCloseTo((7 * Math.PI) / 4, 12);
  });

  it('returns zero on a degenerate (empty) system without dividing by zero', () => {
    expect(placeholderEccentricAnomaly(0, 0)).toBe(0);
    expect(placeholderEccentricAnomaly(3, 0)).toBe(0);
  });

  it('is deterministic — same (i, n) always returns the same angle', () => {
    expect(placeholderEccentricAnomaly(3, 8)).toBe(placeholderEccentricAnomaly(3, 8));
  });
});

describe('planetLocalPosition', () => {
  const identity = new THREE.Quaternion();
  const out = new THREE.Vector3();

  it('lands at perihelion for eccentricAnomaly = 0', () => {
    // a = 1 pc-equivalent, e = 0.5 ; perihelion at +x = a − c = 0.5.
    planetLocalPosition(1 / AU_PC, 0.5, 0, identity, out);
    expect(out.x).toBeCloseTo(0.5, 6);
    expect(out.y).toBeCloseTo(0, 6);
    expect(out.z).toBe(0);
  });

  it('lands at aphelion for eccentricAnomaly = π', () => {
    planetLocalPosition(1 / AU_PC, 0.5, Math.PI, identity, out);
    expect(out.x).toBeCloseTo(-1.5, 6);
    expect(out.y).toBeCloseTo(0, 6);
  });

  it('lies in the local xy plane before any orientation rotation', () => {
    for (let t = 0; t < 6; t++) {
      planetLocalPosition(1, 0.3, t, identity, out);
      expect(out.z).toBe(0);
    }
  });

  it('a circular orbit (e = 0) traces a true circle of radius a', () => {
    const aPc = 0.001;
    for (let t = 0; t < 8; t++) {
      const angle = (t / 8) * Math.PI * 2;
      planetLocalPosition(aPc / AU_PC, 0, angle, identity, out);
      expect(Math.hypot(out.x, out.y)).toBeCloseTo(aPc, 9);
    }
  });

  it('respects the orientation quaternion', () => {
    // Rotate +z onto +y; an in-plane perihelion (+x, 0, 0) should stay
    // on +x (rotation around +z by 0 in our case is identity, but a 90°
    // rotation around +x takes y to z).
    const q = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      Math.PI / 2,
    );
    // semiMajorAxisAu = 1/AU_PC means a = 1 pc internally; eccentricAnomaly
    // = π/2 with e=0 yields the in-plane (0, 1, 0) point.
    planetLocalPosition(1 / AU_PC, 0, Math.PI / 2, q, out);
    // Pre-rotation: (0, 1, 0). Post 90° around +x: (0, 0, 1).
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(0, 6);
    expect(out.z).toBeCloseTo(1, 6);
  });
});

describe('solidityForType', () => {
  it('rocky bodies have full solidity (hard disc edge)', () => {
    expect(solidityForType('rocky')).toBe(1);
  });

  it('gas giants have zero solidity (broad gradient)', () => {
    expect(solidityForType('gas_giant')).toBe(0);
  });

  it('ice giants sit between rocky and gas giants', () => {
    const v = solidityForType('ice_giant');
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
  });
});

describe('OrbitRingsLayer', () => {
  it('returns false with no planet system attached', () => {
    const ss = new OrbitRingsLayer();
    expect(ss.anyOrbitRingVisible()).toBe(false);
    ss.dispose();
  });

  it('returns true after a tick that lets at least one ring through the heuristic', () => {
    const ss = new OrbitRingsLayer();
    const ps: PlanetSystem = {
      hostStarIdx: 0,
      planets: [makePlanet({ name: 'Alpha', semiMajorAxisAu: 1 })],
    };
    ss.setPlanetSystem(ps, 0, T0);
    // Camera at 5 AU from the (origin) host. A lone ring has no
    // neighbours, so the gap heuristic always lets it render.
    ss.update(makeCamera(5 * AU_PC), 800, null, T0);
    expect(ss.anyOrbitRingVisible()).toBe(true);
    ss.dispose();
  });

  it('returns false after the planet system is cleared', () => {
    const ss = new OrbitRingsLayer();
    const ps: PlanetSystem = {
      hostStarIdx: 0,
      planets: [makePlanet()],
    };
    ss.setPlanetSystem(ps, 0, T0);
    ss.update(makeCamera(5 * AU_PC), 800, null, T0);
    ss.setPlanetSystem(null, 0, T0);
    expect(ss.anyOrbitRingVisible()).toBe(false);
    ss.dispose();
  });

  it('returns false when warp-hidden, even with rings still in the heuristic', () => {
    const ss = new OrbitRingsLayer();
    const ps: PlanetSystem = {
      hostStarIdx: 0,
      planets: [makePlanet()],
    };
    ss.setPlanetSystem(ps, 0, T0);
    ss.update(makeCamera(5 * AU_PC), 800, null, T0);
    ss.setHidden(true);
    expect(ss.anyOrbitRingVisible()).toBe(false);
    ss.dispose();
  });

  it('returns false in chart (mono) mode', () => {
    const ss = new OrbitRingsLayer();
    const ps: PlanetSystem = {
      hostStarIdx: 0,
      planets: [makePlanet()],
    };
    ss.setPlanetSystem(ps, 0, T0);
    ss.update(makeCamera(5 * AU_PC), 800, null, T0);
    ss.setMonochrome(true);
    expect(ss.anyOrbitRingVisible()).toBe(false);
    ss.dispose();
  });

  it('isOrbitRingVisible is per-planet and tracks per-ring visibility', () => {
    const ss = new OrbitRingsLayer();
    const ps: PlanetSystem = {
      hostStarIdx: 0,
      planets: [
        makePlanet({ name: 'A', semiMajorAxisAu: 1 }),
        makePlanet({ name: 'B', semiMajorAxisAu: 100 }),
      ],
    };
    ss.setPlanetSystem(ps, 0, T0);
    // Mid-range camera distance — the inner ring's pixel radius collapses
    // (pile-up against neighbour) while the outer ring remains spread.
    // The exact heuristic outcome is exercised in `ringVisibility` tests
    // above; here we just confirm the per-index API plumbs through.
    ss.update(makeCamera(50 * AU_PC), 800, null, T0);
    const a = ss.isOrbitRingVisible(0);
    const b = ss.isOrbitRingVisible(1);
    expect(typeof a).toBe('boolean');
    expect(typeof b).toBe('boolean');
    // Out-of-range index is always false.
    expect(ss.isOrbitRingVisible(2)).toBe(false);
    expect(ss.isOrbitRingVisible(-1)).toBe(false);
    // Hide layer → all rings report false.
    ss.setHidden(true);
    expect(ss.isOrbitRingVisible(0)).toBe(false);
    expect(ss.isOrbitRingVisible(1)).toBe(false);
    ss.dispose();
  });

  it('returns false when every ring is suppressed by the pixel-gap heuristic', () => {
    // Two rings with semi-major axes very close together, viewed from far
    // enough that the projected pixel gap collapses below the threshold.
    const ss = new OrbitRingsLayer();
    const ps: PlanetSystem = {
      hostStarIdx: 0,
      planets: [
        makePlanet({ name: 'A', semiMajorAxisAu: 1.000 }),
        makePlanet({ name: 'B', semiMajorAxisAu: 1.001 }),
      ],
    };
    ss.setPlanetSystem(ps, 0, T0);
    // 1e6 pc is absurdly far; both ring projections shrink to indistinguishable.
    ss.update(makeCamera(1e6), 800, null, T0);
    expect(ss.anyOrbitRingVisible()).toBe(false);
    ss.dispose();
  });
});

/** Renderer-local position of ring vertex `i`: line offset + baked f32
 *  vertex. The group itself stays at the origin under the anchored-line
 *  scheme. */
function ringVertexWorld(line: THREE.LineLoop, i: number): THREE.Vector3 {
  const v = (line.geometry.getAttribute('position') as THREE.BufferAttribute)
    .array as Float32Array;
  return new THREE.Vector3(v[i * 3], v[i * 3 + 1], v[i * 3 + 2])
    .add(line.position);
}

describe('OrbitRingsLayer host centring', () => {
  it('update() tracks ring vertices to the host local position', () => {
    const ss = new OrbitRingsLayer();
    const ps: PlanetSystem = {
      hostStarIdx: 0,
      planets: [makePlanet({ semiMajorAxisAu: 1, eccentricity: 0 })],
    };
    ss.setPlanetSystem(ps, 0, T0);
    const host = new THREE.Vector3(3, -2, 1).multiplyScalar(AU_PC);
    const cam = makeCamera(0);
    cam.position.copy(host);
    cam.position.z += 5 * AU_PC;
    ss.update(cam, 800, host, T0);
    // Circular ring (e = 0): every vertex sits exactly one semi-major
    // axis from the host, wherever the host is parked.
    const line = ss.group.children[0] as THREE.LineLoop;
    expect(ss.group.position.length()).toBe(0);
    for (const i of [0, 1000, 3000]) {
      expect(ringVertexWorld(line, i).distanceTo(host) / AU_PC)
        .toBeCloseTo(1, 6);
    }
    ss.dispose();
  });

  it('rebakes float32 verts about the live centre at planet-focus scale (the Pluto jitter)', () => {
    // Pluto regime: host 39.5 AU from the floating origin (which sits
    // on the focused planet), camera at close framing near the origin.
    // Centre-relative float32 verts carry a half-ULP quantum of
    // hundreds of km at this magnitude — the rebake must land the
    // near-camera vertex within metres instead.
    const aAu = 39.5;
    const ss = new OrbitRingsLayer();
    const ps: PlanetSystem = {
      hostStarIdx: 0,
      planets: [makePlanet({ semiMajorAxisAu: aAu, eccentricity: 0 })],
    };
    ss.setPlanetSystem(ps, 0, T0);

    const line = ss.group.children[0] as THREE.LineLoop;
    // Pre-rebase (centre-relative) float32 rounding at Pluto scale:
    // worst vertex component is off by > 30 km — the jitter amplitude
    // class the anchored rebase exists to kill.
    const aPc = aAu * AU_PC;
    let centreRelErr = 0;
    for (let i = 0; i < ORBIT_LINE_SEGMENTS; i++) {
      const t = (i / ORBIT_LINE_SEGMENTS) * Math.PI * 2;
      for (const exact of [aPc * Math.cos(t), aPc * Math.sin(t)]) {
        centreRelErr = Math.max(centreRelErr, Math.abs(Math.fround(exact) - exact));
      }
    }
    expect(centreRelErr / KM_PC).toBeGreaterThan(30);

    // Host parked so the ring's t=0 vertex lands exactly on the origin;
    // camera at a 3000-km framing of a body there.
    const host = new THREE.Vector3(-aPc, 0, 0);
    const cam = makeCamera(3000 * KM_PC);
    ss.update(cam, 800, host, T0);
    // Drift (39.5 AU) far exceeds LINE_ANCHOR_MAX_DRIFT_PC → verts must
    // have been rebaked about the live centre.
    expect(line.position.length()).toBe(0);
    // Float64 truth for vertex 0 is host + (aPc, 0, 0) = exactly 0; the
    // baked float32 value must land within metres, not the hundreds of
    // km the centre-relative buffer carried.
    expect(ringVertexWorld(line, 0).length() / KM_PC).toBeLessThan(0.05);
    ss.dispose();
  });

  it('sub-threshold centre drift moves line.position and leaves the buffer unbaked', () => {
    const ss = new OrbitRingsLayer();
    const ps: PlanetSystem = {
      hostStarIdx: 0,
      planets: [makePlanet({ semiMajorAxisAu: 1, eccentricity: 0 })],
    };
    ss.setPlanetSystem(ps, 0, T0);
    const line = ss.group.children[0] as THREE.LineLoop;
    const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;

    // Host drifting well under LINE_ANCHOR_MAX_DRIFT_PC from the baked
    // origin: no rebake — the line just rides the delta.
    const versionBefore = attr.version;
    const drift = LINE_ANCHOR_MAX_DRIFT_PC / 10;
    const host = new THREE.Vector3(drift, 0, 0);
    ss.update(makeCamera(5 * AU_PC), 800, host, T0);
    expect(line.position.x).toBeCloseTo(drift, 24);
    expect(attr.version).toBe(versionBefore);

    // A drift beyond the cap → rebake: position resets, buffer version
    // bumps, and the world-space ring is unchanged (circle still one
    // semi-major axis from the host).
    const far = new THREE.Vector3(0.1 * AU_PC, 0, 0);
    ss.update(makeCamera(5 * AU_PC), 800, far, T0);
    expect(line.position.length()).toBe(0);
    expect(attr.version).toBeGreaterThan(versionBefore);
    expect(ringVertexWorld(line, 512).distanceTo(far) / AU_PC).toBeCloseTo(1, 6);
    ss.dispose();
  });

  it('the pixel-gap heuristic measures camera-to-host distance, not camera-to-origin', () => {
    // Host 1e6 pc from the local origin, camera parked 5 AU from the
    // HOST. Origin-based distance would collapse both ring radii to
    // ~0 px (gap 0 → both suppressed); host-based distance resolves
    // them at hundreds of px apart.
    const ss = new OrbitRingsLayer();
    const ps: PlanetSystem = {
      hostStarIdx: 0,
      planets: [
        makePlanet({ name: 'A', semiMajorAxisAu: 1 }),
        makePlanet({ name: 'B', semiMajorAxisAu: 2 }),
      ],
    };
    ss.setPlanetSystem(ps, 0, T0);
    const host = new THREE.Vector3(1e6, 0, 0);
    const cam = makeCamera(0);
    cam.position.copy(host);
    cam.position.z += 5 * AU_PC;
    ss.update(cam, 800, host, T0);
    expect(ss.isOrbitRingVisible(0)).toBe(true);
    expect(ss.isOrbitRingVisible(1)).toBe(true);
    ss.dispose();
  });

  it('setPlanetSystem resets the centre to the origin until the next update feeds a host', () => {
    const ss = new OrbitRingsLayer();
    const ps: PlanetSystem = {
      hostStarIdx: 0,
      planets: [makePlanet({ eccentricity: 0 })],
    };
    ss.setPlanetSystem(ps, 0, T0);
    const host = new THREE.Vector3(0.5, 0.5, 0.5);
    ss.update(makeCamera(5 * AU_PC), 800, host, T0);
    ss.setPlanetSystem(ps, 0, T0);
    ss.update(makeCamera(5 * AU_PC), 800, null, T0);
    const line = ss.group.children[0] as THREE.LineLoop;
    expect(ringVertexWorld(line, 0).length() / AU_PC).toBeCloseTo(1, 6);
    ss.dispose();
  });
});

describe('OrbitRingsLayer orbit-ring orientation)', () => {
  it('a non-zero inclination tilts the ring out of the host plane', () => {
    // Inclination 30°, no node / argperi rotation. The ring should
    // sit on a plane tilted 30° from the host plane (which for a
    // non-Sol host is the galactic plane). The ring's z-extent in
    // the host plane frame should be a·sin(30°) = 0.5·a.
    const ss = new OrbitRingsLayer();
    const ps: PlanetSystem = {
      hostStarIdx: 1,
      planets: [makePlanet({ semiMajorAxisAu: 1, eccentricity: 0 })],
      orbitGeometryAt: () => [{
        aAu: 1,
        e: 0,
        orientation: {
          inclination: 30 * Math.PI / 180,
          longAscNode: 0,
          argPerihelion: 0,
        },
        parentIdx: null,
      }],
    };
    ss.setPlanetSystem(ps, 0, T0);
    // Rummage in the scene graph for the ring's position buffer.
    const ringLine = ss.group.children.find(
      (c) => (c as THREE.LineLoop).isLineLoop,
    ) as THREE.LineLoop | undefined;
    expect(ringLine).toBeDefined();
    const positions = (ringLine!.geometry as THREE.BufferGeometry)
      .getAttribute('position').array as Float32Array;
    // Compute max |z'| where z' is the host-plane-normal component.
    // For a galactic-pole-normal host plane the normal is the galactic
    // north pole; project each vertex onto it.
    const normal = GALACTIC_NORTH_POLE_ICRS.clone();
    let maxAbsZ = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const dot = positions[i] * normal.x
        + positions[i + 1] * normal.y
        + positions[i + 2] * normal.z;
      maxAbsZ = Math.max(maxAbsZ, Math.abs(dot));
    }
    // Expect ~0.5 × 1 AU. Tolerance loose enough to absorb the 128-
    // segment discretisation (≈cos error well below 1%).
    expect(maxAbsZ / AU_PC).toBeGreaterThan(0.49);
    expect(maxAbsZ / AU_PC).toBeLessThan(0.51);
    ss.dispose();
  });

  it('without orbitGeometryAt the fallback ring sits flat on the host plane', () => {
    // Same setup as above but no orbitGeometryAt field — the
    // defaultOrbitGeometry fallback lays the ring flat on the host
    // plane; the host-normal projection should be ~zero across all
    // vertices.
    const ss = new OrbitRingsLayer();
    const ps: PlanetSystem = {
      hostStarIdx: 1,
      planets: [makePlanet({ semiMajorAxisAu: 1, eccentricity: 0 })],
    };
    ss.setPlanetSystem(ps, 0, T0);
    const ringLine = ss.group.children.find(
      (c) => (c as THREE.LineLoop).isLineLoop,
    ) as THREE.LineLoop | undefined;
    expect(ringLine).toBeDefined();
    const positions = (ringLine!.geometry as THREE.BufferGeometry)
      .getAttribute('position').array as Float32Array;
    const normal = GALACTIC_NORTH_POLE_ICRS.clone();
    let maxAbsZ = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const dot = positions[i] * normal.x
        + positions[i + 1] * normal.y
        + positions[i + 2] * normal.z;
      maxAbsZ = Math.max(maxAbsZ, Math.abs(dot));
    }
    expect(maxAbsZ).toBeLessThan(1e-9);
    ss.dispose();
  });
});

/** Min distance from `p` to any vertex of the ring polyline. */
function minDistToRing(
  p: { x: number; y: number; z: number },
  verts: Float32Array | Float64Array,
): number {
  let min = Infinity;
  for (let i = 0; i < verts.length; i += 3) {
    const d = Math.hypot(p.x - verts[i], p.y - verts[i + 1], p.z - verts[i + 2]);
    if (d < min) min = d;
  }
  return min;
}

describe('ring geometry passes through the body (single element source)', () => {
  const IDENTITY = new THREE.Quaternion();

  it('every planet sits on its ring at arbitrary model times', () => {
    // The ring-desync defect in one assertion: the ring built from
    // solOrbitGeometryAt(t) must contain the body positioned by
    // getPlanetPositions(t) — same elements, same t, both ecliptic.
    // Nearest-vertex spacing on a 256-segment loop is ≈2πa/256, so
    // 0.02·a bounds the polyline discretisation with margin.
    const verts = new Float32Array(ORBIT_LINE_SEGMENTS * 3);
    for (const tYears of [0, 137.4, -880.2]) {
      const t = T0 + tYears * 365.25 * 86400;
      const geoms = solOrbitGeometryAt(t);
      const positions = getPlanetPositions(t);
      for (let i = 0; i < PLANET_ORDER.length; i++) {
        const aPc = writeRingVerts(verts, geoms[i], IDENTITY);
        expect(minDistToRing(positions[PLANET_ORDER[i]], verts))
          .toBeLessThan(0.02 * aPc);
      }
    }
  });

  it('anchors a vertex ON each body, not merely near the polyline', () => {
    // Distance to the nearest VERTEX, not to the drawn line. Unanchored,
    // a body floats up to half a vertex interval (π·a/N ≈ 2.2 million km
    // at Pluto) from the nearest one, and its offset from the drawn chord
    // cycles 0 → a·(π/N)²/2 → 0 as it crosses each — which reads as the
    // ring drifting while the planet is held in focus.
    //
    // Float64 buffer so this measures the geometry: the float32 GPU bake
    // quantises to ~2.3 km at Pluto on its own.
    const verts = new Float64Array(ORBIT_LINE_SEGMENTS * 3);
    for (const tYears of [0, 137.4, -880.2]) {
      const t = T0 + tYears * 365.25 * 86400;
      const geoms = solOrbitGeometryAt(t);
      const positions = getPlanetPositions(t);
      for (let i = 0; i < PLANET_ORDER.length; i++) {
        const aPc = writeRingVerts(verts, geoms[i], IDENTITY);
        expect(minDistToRing(positions[PLANET_ORDER[i]], verts), PLANET_ORDER[i])
          .toBeLessThan(1e-9 * aPc);
      }
    }
  });

  it('anchors a vertex on every moon too, the Moon included', () => {
    const verts = new Float64Array(ORBIT_LINE_SEGMENTS * 3);
    const planetCount = PLANET_ORDER.length;
    const offset = { x: 0, y: 0, z: 0 };
    for (const dayOffset of MOON_SAMPLE_DAY_OFFSETS) {
      const t = T0 + dayOffset * 86400;
      const geoms = solOrbitGeometryAt(t);
      for (let m = 0; m < MOON_ELEMENTS.length; m++) {
        const aPc = writeRingVerts(verts, geoms[planetCount + m], IDENTITY);
        moonOffsetEcliptic(MOON_ELEMENTS[m], t, offset);
        // One bound for all 18, the Moon included. Its ring is the
        // osculating ellipse inverted from the body's own state, so the
        // anchor is exact there too — not a fit that has to be given
        // room. Anything above π/N ≈ 3.8e-4 of `a` passes unanchored and
        // asserts nothing.
        expect(minDistToRing(offset, verts), MOON_ELEMENTS[m].name)
          .toBeLessThan(1e-9 * aPc);
      }
    }
  });

  it('every moon ring contains the moon resolver’s parent-relative track', () => {
    // Parity pin for refPlaneToEclipticQuat: the quaternion chain in
    // writeRingVerts must reproduce the scalar reference-plane →
    // ecliptic rotation moonOffsetEcliptic applies, for every tabulated
    // reference pole (Laplace planes, Uranus equator, Triton) and the
    // no-pole ecliptic case (the Moon).
    //
    // Geometry is re-derived at each sample rather than reused from T0:
    // the 17 Kepler moons return identical elements at every t, but the
    // Moon's ring is the osculating ellipse through the lunar theory's
    // own state and legitimately evolves within a single orbit.
    const verts = new Float32Array(ORBIT_LINE_SEGMENTS * 3);
    const planetCount = PLANET_ORDER.length;
    const offset = { x: 0, y: 0, z: 0 };
    for (const dayOffset of MOON_SAMPLE_DAY_OFFSETS) {
      const t = T0 + dayOffset * 86400;
      const geoms = solOrbitGeometryAt(t);
      for (let m = 0; m < MOON_ELEMENTS.length; m++) {
        const aPc = writeRingVerts(verts, geoms[planetCount + m], IDENTITY);
        moonOffsetEcliptic(MOON_ELEMENTS[m], t, offset);
        expect(minDistToRing(offset, verts)).toBeLessThan(0.02 * aPc);
      }
    }
  });

  // The test above re-derives geometry at each sample, so it proves the
  // element→vertex chain is right but CANNOT see whether the live layer
  // ever refreshes a moon ring. refreshGeometry used to skip every
  // parent-centred ring outright, which froze the Moon's at attach time —
  // 19 000 km, 5 % of its distance, off the body after a year of
  // scrubbing. These two go through OrbitRingsLayer itself.
  describe('the layer refreshes the Moon’s ring as the clock moves', () => {
    const MOON_IDX = PLANET_ORDER.length
      + MOON_ELEMENTS.findIndex((m) => m.name === 'Moon');

    /** Sol's system as the planet module attaches it. */
    const solSystem = (): PlanetSystem => ({
      hostStarIdx: 0,
      planets: SOL_BODIES,
      orbitGeometryAt: solOrbitGeometryAt,
    });

    /** Every ring centred on the local origin, so the baked GPU buffer is
     *  the master geometry unshifted. */
    const originCentres = (_idx: number, out: THREE.Vector3): boolean => {
      out.set(0, 0, 0);
      return true;
    };

    const MOON_A_PC = 384400 * KM_PC;
    // Close enough that the Moon's ring clears the pixel-legibility gate:
    // the layer refreshes only what it is drawing, so a 5 AU camera —
    // where the ring is sub-pixel — exercises nothing. `expectDrawn`
    // asserts that rather than trusting it, or this whole block goes
    // quietly vacuous the next time the gate moves.
    const NEAR_MOON = makeCamera(20 * MOON_A_PC);
    const expectDrawn = (ss: OrbitRingsLayer): void => {
      expect(ss.isOrbitRingVisible(MOON_IDX), 'Moon ring must be drawn').toBe(true);
    };

    const moonRingVerts = (ss: OrbitRingsLayer): Float32Array => {
      const line = ss.group.children[MOON_IDX] as THREE.LineLoop;
      const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      return (attr.array as Float32Array).slice();
    };

    it('rewrites the buffer — a frozen ring is byte-identical a month on', () => {
      const ss = new OrbitRingsLayer();
      ss.setPlanetSystem(solSystem(), 0, T0);
      ss.update(NEAR_MOON, 800, null, T0, originCentres);
      expectDrawn(ss);
      const atT0 = moonRingVerts(ss);
      ss.update(NEAR_MOON, 800, null, T0 + 30 * 86400, originCentres);
      const atT1 = moonRingVerts(ss);
      expect(atT1.some((v, i) => v !== atT0[i])).toBe(true);
      ss.dispose();
    });

    // Bounded at 1e-5·a ≈ 3.8 km. The anchored vertex lands on the body
    // exactly, so the only floor left is the float32 GPU bake this reads
    // through — ~60 m at the Moon's radius — and a stale ring sits
    // 1 500–19 000 km out depending on where in the cycle it froze. That
    // leaves 60x of headroom below and 40x of signal above the 147 km
    // half-vertex spacing.
    //
    // Several offsets because the error is cyclic, not monotonic: a
    // 30-day scrub happens to land near a minimum, and a single sample
    // there passes with the refresh disabled.
    it.each([7, 14, 90, 365])(
      'keeps the Moon on the rendered ring after scrubbing %i days',
      (days) => {
        const ss = new OrbitRingsLayer();
        ss.setPlanetSystem(solSystem(), 0, T0);
        const t = T0 + days * 86400;
        ss.update(NEAR_MOON, 800, null, t, originCentres);
        expectDrawn(ss);

        // The layer rotates its rings onto the host plane; the resolver
        // works in the ecliptic, so the expected point takes the same turn.
        const hostQuat = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          ECLIPTIC_NORTH_POLE_ICRS.clone(),
        );
        const offset = { x: 0, y: 0, z: 0 };
        moonOffsetEcliptic(MOON_ELEMENTS.find((m) => m.name === 'Moon')!, t, offset);
        const expected = new THREE.Vector3(offset.x, offset.y, offset.z)
          .applyQuaternion(hostQuat);

        expect(minDistToRing(expected, moonRingVerts(ss))).toBeLessThan(1e-5 * MOON_A_PC);
        ss.dispose();
      },
    );

    it('spends nothing on a ring it is not drawing', () => {
      // The other side of the same gate. The Moon's ring crosses the
      // drift tolerance in ~1 s of model time, so without this it would
      // rewrite 8192 vertices and re-upload the buffer every frame under
      // scrub while sub-pixel — and drag three lunar-theory evaluations
      // along per frame for a ring nothing can see.
      const ss = new OrbitRingsLayer();
      ss.setPlanetSystem(solSystem(), 0, T0);
      ss.update(makeCamera(5 * AU_PC), 800, null, T0, originCentres);
      expect(ss.isOrbitRingVisible(MOON_IDX)).toBe(false);
      const atT0 = moonRingVerts(ss);
      ss.update(makeCamera(5 * AU_PC), 800, null, T0 + 365 * 86400, originCentres);
      expect(moonRingVerts(ss)).toEqual(atT0);
      ss.dispose();
    });

    it('catches a ring up the frame it becomes visible again', () => {
      // Skipping while invisible is only safe because coming back is not
      // deferred: visibility is decided first, then the geometry pass
      // runs over what survived.
      const ss = new OrbitRingsLayer();
      ss.setPlanetSystem(solSystem(), 0, T0);
      const t = T0 + 365 * 86400;
      ss.update(makeCamera(5 * AU_PC), 800, null, t, originCentres);
      ss.update(NEAR_MOON, 800, null, t, originCentres);
      expectDrawn(ss);

      const hostQuat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        ECLIPTIC_NORTH_POLE_ICRS.clone(),
      );
      const offset = { x: 0, y: 0, z: 0 };
      moonOffsetEcliptic(MOON_ELEMENTS.find((m) => m.name === 'Moon')!, t, offset);
      const expected = new THREE.Vector3(offset.x, offset.y, offset.z)
        .applyQuaternion(hostQuat);
      expect(minDistToRing(expected, moonRingVerts(ss))).toBeLessThan(1e-5 * MOON_A_PC);
      ss.dispose();
    });
  });

  it('solOrbitGeometryAt covers SOL_BODIES with parentIdx pointing at each moon’s parent', () => {
    const geoms = solOrbitGeometryAt(T0);
    expect(geoms.length).toBe(SOL_BODIES.length);
    for (let i = 0; i < SOL_BODIES.length; i++) {
      const body = SOL_BODIES[i];
      if (body.parentName) {
        const parentIdx = geoms[i].parentIdx;
        expect(parentIdx).not.toBeNull();
        expect(SOL_BODIES[parentIdx!].name).toBe(body.parentName);
      } else {
        expect(geoms[i].parentIdx).toBeNull();
      }
    }
  });
});

describe('refPlaneToEclipticQuat', () => {
  it('maps the reference-plane pole (+z) onto the pole’s ecliptic direction', () => {
    // Uranus equator pole: ICRS RA 257.311°, Dec −15.175°. Rotate the
    // ICRS unit vector to ecliptic by Rx(−ε) and compare with the
    // quaternion image of +z.
    const ra = 257.311 * (Math.PI / 180);
    const dec = -15.175 * (Math.PI / 180);
    const eps = 23.4392911 * (Math.PI / 180);
    const icrs = new THREE.Vector3(
      Math.cos(dec) * Math.cos(ra),
      Math.cos(dec) * Math.sin(ra),
      Math.sin(dec),
    );
    const expected = new THREE.Vector3(
      icrs.x,
      Math.cos(eps) * icrs.y + Math.sin(eps) * icrs.z,
      -Math.sin(eps) * icrs.y + Math.cos(eps) * icrs.z,
    );
    const q = refPlaneToEclipticQuat(257.311, -15.175, new THREE.Quaternion());
    const pole = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    expect(pole.x).toBeCloseTo(expected.x, 10);
    expect(pole.y).toBeCloseTo(expected.y, 10);
    expect(pole.z).toBeCloseTo(expected.z, 10);
  });
});

describe('OrbitRingsLayer moon rings', () => {
  const zeroOrientation = { inclination: 0, longAscNode: 0, argPerihelion: 0 };

  function makeMoonSystem(): PlanetSystem {
    return {
      hostStarIdx: 1,
      planets: [
        makePlanet({ name: 'P', semiMajorAxisAu: 5 }),
        makePlanet({ name: 'M', parentName: 'P', semiMajorAxisAu: 0.003 }),
      ],
    };
  }

  it('a moon ring rides its parent’s live host-relative offset', () => {
    const ss = new OrbitRingsLayer();
    ss.setPlanetSystem(makeMoonSystem(), 0, T0);
    const parentRel = new THREE.Vector3(5 * AU_PC, 0, 0);
    const cam = makeCamera(0);
    cam.position.copy(parentRel);
    cam.position.x += 0.01 * AU_PC;
    ss.update(cam, 800, null, T0, (idx, out) => {
      expect(idx).toBe(0);
      out.copy(parentRel);
      return true;
    });
    const moonLine = ss.group.children[1] as THREE.LineLoop;
    // Circular 0.003 AU moon ring: every vertex sits one moon
    // semi-major axis from the parent's live offset.
    expect(ringVertexWorld(moonLine, 0).distanceTo(parentRel) / AU_PC)
      .toBeCloseTo(0.003, 6);
    // Camera parked 0.01 AU from the parent: the 0.003 AU moon ring is
    // enormous on screen and must draw.
    expect(ss.isOrbitRingVisible(1)).toBe(true);
    ss.dispose();
  });

  it('a moon ring hides when no parent offset is available', () => {
    const ss = new OrbitRingsLayer();
    ss.setPlanetSystem(makeMoonSystem(), 0, T0);
    const cam = makeCamera(5 * AU_PC);
    ss.update(cam, 800, null, T0);
    expect(ss.isOrbitRingVisible(1)).toBe(false);
    ss.dispose();
  });

  it('moon visibility measures camera→parent distance, not camera→host', () => {
    // Camera 5 AU from the HOST but right next to the parent: the moon
    // ring (0.003 AU) is sub-pixel from the host but hundreds of px
    // from the parent — it must draw.
    const ss = new OrbitRingsLayer();
    ss.setPlanetSystem(makeMoonSystem(), 0, T0);
    const parentRel = new THREE.Vector3(0, 0, 5 * AU_PC);
    const cam = makeCamera(5 * AU_PC + 0.01 * AU_PC);
    ss.update(cam, 800, null, T0, (_idx, out) => {
      out.copy(parentRel);
      return true;
    });
    expect(ss.isOrbitRingVisible(1)).toBe(true);
    ss.dispose();
  });

  it('re-derives host-centred geometry on resolvable element drift, not on elapsed t', () => {
    const ss = new OrbitRingsLayer();
    let aAu = 1;
    const ps: PlanetSystem = {
      hostStarIdx: 1,
      planets: [makePlanet({ semiMajorAxisAu: 1 })],
      orbitGeometryAt: () => [{
        aAu, e: 0, orientation: zeroOrientation, parentIdx: null,
      }],
    };
    ss.setPlanetSystem(ps, 0, T0);
    const line = ss.group.children[0] as THREE.LineLoop;
    const verts = line.geometry.getAttribute('position').array as Float32Array;
    const radiusAu = () => Math.hypot(verts[0], verts[1], verts[2]) / AU_PC;
    expect(radiusAu()).toBeCloseTo(1, 6);
    const cam = makeCamera(5 * AU_PC);

    // A century of sim time with the elements standing still costs nothing:
    // the old sim-time gate rebuilt here, which is what degenerated into a
    // per-frame 8192-vertex rewrite under fast-forward.
    ss.update(cam, 800, null, T0 + 100 * 365 * 86400);
    expect(radiusAu()).toBeCloseTo(1, 6);

    // Drift under the polyline's own resolution stays unwritten — rewriting
    // it would only redraw discretisation noise.
    aAu = 1 + RING_GEOMETRY_DRIFT_TOLERANCE * 0.5;
    ss.update(cam, 800, null, T0 + 1);
    expect(radiusAu()).toBeCloseTo(1, 6);

    // Past it, the geometry re-derives at the live elements.
    aAu = 2;
    ss.update(cam, 800, null, T0 + 2);
    expect(radiusAu()).toBeCloseTo(2, 6);
    ss.dispose();
  });
});

describe('ringGeometryDrifted', () => {
  const zeroOrientation = { inclination: 0, longAscNode: 0, argPerihelion: 0 };
  const base = { aAu: 10, e: 0.1, orientation: zeroOrientation, parentIdx: null };

  it('is false for identical elements', () => {
    expect(ringGeometryDrifted(base, { ...base })).toBe(false);
  });

  it('scales the semi-major-axis leg with the orbit, so one tolerance fits all rings', () => {
    // The same absolute drift is resolvable on Mercury's ring and not on
    // Pluto's; the test would pass either way under an absolute tolerance.
    const dAu = 10 * RING_GEOMETRY_DRIFT_TOLERANCE * 2;
    expect(ringGeometryDrifted(base, { ...base, aAu: 10 + dAu })).toBe(true);
    const wide = { ...base, aAu: 1000 };
    expect(ringGeometryDrifted(wide, { ...wide, aAu: 1000 + dAu })).toBe(false);
  });

  it('catches drift in each angle independently', () => {
    const past = RING_GEOMETRY_DRIFT_TOLERANCE * 2;
    for (const key of ['inclination', 'longAscNode', 'argPerihelion'] as const) {
      expect(ringGeometryDrifted(base, {
        ...base,
        orientation: { ...zeroOrientation, [key]: past },
      })).toBe(true);
    }
  });
});
