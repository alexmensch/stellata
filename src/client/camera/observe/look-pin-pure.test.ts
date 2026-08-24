import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LOOK_PIN_DIST_PC, lookPinStale, writeLookPin } from './look-pin-pure';

const NAN_SEED = new THREE.Quaternion(Number.NaN, 0, 0, 0);

describe('observe look pin / lookPinStale', () => {
  it('a NaN seed is always stale, so the first frame derives', () => {
    expect(lookPinStale(NAN_SEED, new THREE.Quaternion(0, 0, 0, 1))).toBe(true);
  });

  it('an unchanged orientation is not stale, whatever the camera position did', () => {
    const q = new THREE.Quaternion(0.1, 0.2, 0.3, 0.927).normalize();
    expect(lookPinStale(q.clone(), q)).toBe(false);
  });

  it('any rotation is stale, down to one representable step', () => {
    const q = new THREE.Quaternion(0.1, 0.2, 0.3, 0.927).normalize();
    const nudged = q.clone();
    nudged.x = q.x + Math.abs(q.x) * Number.EPSILON;
    expect(lookPinStale(q, nudged)).toBe(true);
  });
});

describe('observe look pin / a focal ride leaves the pin exact', () => {
  // The bug this guard exists for. A ride translates camera and target by
  // ONE delta, which is exact. Re-deriving the pin from the translated
  // camera instead lands ULP away every frame and never converges, which
  // the render gate reads as a camera move.
  const DIR = new THREE.Vector3(0.3714, -0.5571, 0.7428);

  function ride(distPc: number, stepPc: number, ticks: number, rederive: boolean) {
    const cam = new THREE.PerspectiveCamera(10, 1.6, 1e-9, 1e6);
    cam.up.set(-0.685, -0.0307, 0.7279).normalize();
    cam.position.set(distPc * 0.3, -distPc * 0.8, distPc * 0.52);
    cam.lookAt(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const target = new THREE.Vector3();
    writeLookPin(cam.position, fwd, target);

    const step = new THREE.Vector3();
    const pinnedAt = cam.quaternion.clone();
    let wokeGate = 0;
    for (let i = 0; i < ticks; i++) {
      step.copy(DIR).multiplyScalar(stepPc);
      cam.position.add(step);
      target.add(step);                       // applyRideDelta: exact
      const before = target.clone();
      if (rederive || lookPinStale(pinnedAt, cam.quaternion)) {
        fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
        writeLookPin(cam.position, fwd, target);
      }
      if (!target.equals(before)) wokeGate++;
    }
    return wokeGate;
  }

  it('re-deriving every frame drifts the pin off the ride-written value', () => {
    // 1 pc is the worst geometry: position and forward*PIN nearly cancel.
    expect(ride(LOOK_PIN_DIST_PC, 1e-11, 500, true)).toBeGreaterThan(0);
  });

  it('guarding on the orientation holds it bit-exact across the whole ride', () => {
    for (const distPc of [1e-6, 1e-5, 1e-3, LOOK_PIN_DIST_PC, 100, 1e4]) {
      expect(ride(distPc, 1e-11, 500, false), `${distPc} pc`).toBe(0);
    }
  });

  it('a rotation still re-derives the pin', () => {
    const cam = new THREE.PerspectiveCamera(10, 1.6, 1e-9, 1e6);
    cam.position.set(0, 0, 1e-5);
    cam.lookAt(new THREE.Vector3());
    const pinnedAt = cam.quaternion.clone();
    cam.rotateY(1e-4);
    expect(lookPinStale(pinnedAt, cam.quaternion)).toBe(true);
  });
});
