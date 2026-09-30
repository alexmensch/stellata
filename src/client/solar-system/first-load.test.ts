import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FIRST_LOAD_VIEW } from './first-load';
import { encodeBlob, decodeBlob } from '../util/url-state';
import { poseOutOfFrame } from '../util/url-state/orbit-pose/orbit-pose-pure';
import { captureOrbitFrame } from '../attitude/attitude-pure';
import {
  ECLIPTIC_NORTH_POLE_ICRS,
  orbitPlaneNormalInto,
} from './ephemerides/orbit-rings-layer';
import { SOL_BODIES, getPlanetSystem, solOrbitGeometryAt } from './planet-system';
import { SOL_OBJECT_SIDS } from './sol-object-sids';
import { KM_PC } from '../util/astronomy-constants';

const DEG = Math.PI / 180;

/** The view this pose was chosen from, shared before bit 29 existed: its cam
 *  and up are ICRS, measured at `CAPTURED_AT`. */
const CHOSEN_LINK = 'BIXAgcABB-kUFDT_dEk0ndYxNAckT-C-k7vIvpsVTz8C-v8T';
const CAPTURED_AT = Date.UTC(2026, 8, 30, 10, 13) / 1000;

/** Earth's ORB at `t` as the planet field builds it: Sol's host quaternion
 *  over the ecliptic ephemeris, zero longitude on the Sun. */
async function earthOrbitFrame(t: number) {
  const earth = SOL_BODIES.findIndex((b) => b.name === 'Earth');
  const hostQuat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1), ECLIPTIC_NORTH_POLE_ICRS,
  );
  const normal = orbitPlaneNormalInto(new THREE.Vector3(), solOrbitGeometryAt(t)[earth], hostQuat);
  const sol = (await getPlanetSystem(0, 0))!;
  const positions = new Float64Array(SOL_BODIES.length * 3);
  sol.positionsAt!(t, positions);
  const toSun = new THREE.Vector3(
    -positions[earth * 3], -positions[earth * 3 + 1], -positions[earth * 3 + 2],
  ).applyQuaternion(hostQuat);
  return captureOrbitFrame(new THREE.PerspectiveCamera(), normal, toSun);
}

describe('first-load', () => {
  describe('FIRST_LOAD_VIEW', () => {
    it('focuses Earth', () => {
      expect(FIRST_LOAD_VIEW.focus).toEqual({ kind: 'sid', id: SOL_OBJECT_SIDS.earth });
    });

    it('arms ORB with the lock and holds the pose against the orbit', () => {
      expect(FIRST_LOAD_VIEW).toMatchObject({ orb: true, orbLock: true, orbitPose: true });
    });

    it('sits 8.82 million km out, 127 deg round from the Sun and 15.7 deg above the plane', () => {
      const [x, y, z] = FIRST_LOAD_VIEW.cam!;
      const r = Math.hypot(x, y, z);
      expect(Math.round(r / KM_PC / 1e4) / 100).toBe(8.82);
      expect(Math.atan2(y, x) / DEG).toBeCloseTo(-126.99, 2);
      expect(Math.asin(z / r) / DEG).toBeCloseTo(15.7, 2);
    });

    it('keeps the full declutter level and the HUD, with no constellation', () => {
      expect(FIRST_LOAD_VIEW.detailLevel).toBeUndefined();
      expect(FIRST_LOAD_VIEW.showHud).toBe(true);
      expect(FIRST_LOAD_VIEW.con).toBeUndefined();
    });

    it('round-trips through the wire format', () => {
      const view = decodeBlob(encodeBlob(FIRST_LOAD_VIEW));
      expect(view).toMatchObject({
        focus: FIRST_LOAD_VIEW.focus, showHud: true, orb: true, orbLock: true, orbitPose: true,
      });
      for (let i = 0; i < 3; i++) {
        expect(view.cam![i]).toBeCloseTo(FIRST_LOAD_VIEW.cam![i], 13);
        expect(view.up![i]).toBeCloseTo(FIRST_LOAD_VIEW.up![i], 6);
      }
    });

    // see README.md#first-load-default-and-mindistance-relaxation
    it('reproduces the chosen link at the instant it was shared', async () => {
      const frame = await earthOrbitFrame(CAPTURED_AT);
      const cam = new THREE.Vector3(...FIRST_LOAD_VIEW.cam!);
      const up = new THREE.Vector3(...FIRST_LOAD_VIEW.up!);
      poseOutOfFrame(cam, { x: 0, y: 0, z: 0 }, up, frame);

      const chosen = decodeBlob(CHOSEN_LINK);
      const chosenCam = new THREE.Vector3(...chosen.cam!);
      const chosenUp = new THREE.Vector3(...chosen.up!);
      expect(cam.angleTo(chosenCam) / DEG).toBeLessThan(0.01);
      expect(cam.length() / chosenCam.length()).toBeCloseTo(1, 5);
      // `up` is re-projected against the view axis on seating, so it is the
      // roll about that axis that has to agree.
      const axis = chosenCam.clone().normalize();
      const roll = up.clone().projectOnPlane(axis)
        .angleTo(chosenUp.clone().projectOnPlane(axis));
      expect(roll / DEG).toBeLessThan(0.01);
    });
  });
});
