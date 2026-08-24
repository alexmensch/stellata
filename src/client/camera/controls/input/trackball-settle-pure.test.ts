import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  ORIENTATION_SETTLE_ULP,
  POSITION_SETTLE_ULP,
  TRACKBALL_SETTLE_PX,
  eyeSwingRad,
  orientationHeldStill,
  positionHeldStill,
  quatDriftUlps,
  trackballMotionPx,
  vec3DriftUlps,
} from './trackball-settle-pure';

/** The tuned viewport this file's pixel claims are quoted at. */
const FOV_Y_RAD = (50 * Math.PI) / 180;
const VIEWPORT_H = 1000;
const PX_PER_RAD = VIEWPORT_H / FOV_Y_RAD;

/** `_lastAngle *= sqrt(1 - dynamicDampingFactor)` once per frame,
 *  at the tuned `dynamicDampingFactor = 0.15`. */
const ROTATE_DECAY = Math.sqrt(1 - 0.15);

const eye = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('eyeSwingRad', () => {
  it('recovers a sub-milliradian rotation the acos form would lose', () => {
    const a = eye(3, 0, 4);
    const b = a.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 1e-7);
    expect(eyeSwingRad(a, b)).toBeCloseTo(1e-7, 12);
  });

  it('is invariant to eye length — a dolly is not a swing', () => {
    expect(eyeSwingRad(eye(0, 0, 1), eye(0, 0, 1e6))).toBe(0);
  });

  it('a degenerate eye reads no swing rather than NaN', () => {
    expect(eyeSwingRad(eye(0, 0, 0), eye(0, 0, 1))).toBe(0);
  });
});

describe('trackballMotionPx', () => {
  it('a still camera reads zero', () => {
    expect(trackballMotionPx(eye(1, 2, 3), eye(1, 2, 3), PX_PER_RAD, FOV_Y_RAD)).toBe(0);
  });

  it('one pixel of swing reads one pixel', () => {
    const a = eye(0, 0, 5);
    const b = a.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 1 / PX_PER_RAD);
    expect(trackballMotionPx(a, b, PX_PER_RAD, FOV_Y_RAD)).toBeCloseTo(1, 9);
  });

  it('a dolly moves the frame edge, so it counts as half the viewport', () => {
    // 1% closer moves a feature at the top of the frame by 1% of the
    // half-height.
    expect(trackballMotionPx(eye(0, 0, 100), eye(0, 0, 99), PX_PER_RAD, FOV_Y_RAD))
      .toBeCloseTo(0.01 * VIEWPORT_H / 2, 9);
  });
});

describe('the settle floor', () => {
  it('is pinned', () => {
    expect(TRACKBALL_SETTLE_PX).toBe(0.1);
  });

  it('discards under 1.3 px of travel, so the snap cannot be seen', () => {
    // A geometric tail still owes Σ step·rⁿ = step / (1 − r) when it is
    // cut. THIS is what makes stopping at a per-frame threshold safe:
    // the whole remaining journey is ~13 steps, not an unbounded one.
    const discarded = TRACKBALL_SETTLE_PX / (1 - ROTATE_DECAY);
    expect(discarded).toBeCloseTo(1.28, 2);
    expect(discarded).toBeLessThan(1.5);
  });

  it('leaves the visible part of the settle untouched', () => {
    // From a brisk release to the floor is ~1 s of decay at 60 fps; the
    // floor only ever truncates what comes after that.
    const releasePx = 10;
    let px = releasePx;
    let frames = 0;
    while (px >= TRACKBALL_SETTLE_PX) {
      px *= ROTATE_DECAY;
      frames++;
    }
    expect(frames).toBeGreaterThan(50);
    expect(frames).toBeLessThan(70);
  });
});

describe('derived-pose settle floor', () => {
  // A pure focal ride: camera and target take the SAME step, so no rotation
  // and no eye-vector change happens at all. Both of TrackballControls'
  // per-frame round-trips are nonetheless inexact on the translated values,
  // which is what the floors exist to absorb. Pinned BOTH ways — the drift
  // is real without the floor, and held with it.
  const DIR = new THREE.Vector3(0.3714, -0.5571, 0.7428);
  const UP = new THREE.Vector3(-0.685, -0.0307, 0.7279).normalize();

  function rideWalk(distPc: number, stepPc: number, ticks: number) {
    const cam = new THREE.PerspectiveCamera(10, 1.6, 1e-9, 1e6);
    cam.up.copy(UP);
    cam.position.set(distPc * 0.3, -distPc * 0.8, distPc * 0.52);
    const target = new THREE.Vector3();
    cam.lookAt(target);
    const eye = new THREE.Vector3();
    const step = new THREE.Vector3();
    let posDrift = 0;
    let quatDrift = 0;
    for (let i = 0; i < ticks; i++) {
      step.copy(DIR).multiplyScalar(stepPc);
      cam.position.add(step);
      target.add(step);
      const prePos = cam.position.clone();
      const preQuat = cam.quaternion.clone();
      // TrackballControls.update(), the two inexact round-trips.
      eye.subVectors(cam.position, target);
      cam.position.addVectors(target, eye);
      cam.lookAt(target);
      posDrift = Math.max(posDrift, vec3DriftUlps(prePos, cam.position));
      quatDrift = Math.max(quatDrift, quatDriftUlps(preQuat, cam.quaternion));
      if (positionHeldStill(prePos, cam.position)) cam.position.copy(prePos);
      if (orientationHeldStill(preQuat, cam.quaternion)) cam.quaternion.copy(preQuat);
    }
    return { posDrift, quatDrift };
  }

  it('a pure ride drifts the re-derived pose, and both floors absorb it', () => {
    // The reported vantage: ~2 AU from the local origin, fov 10.
    const { posDrift, quatDrift } = rideWalk(1e-5, 1e-11, 2000);
    // Without a floor these are non-zero every few ticks and never converge,
    // which is what the render gate reads as a camera move.
    expect(quatDrift).toBeGreaterThan(0);
    // ...and both sit inside their floor, so the restore holds the pose.
    expect(quatDrift).toBeLessThanOrEqual(ORIENTATION_SETTLE_ULP);
    expect(posDrift).toBeLessThanOrEqual(POSITION_SETTLE_ULP);
  });

  it('holds across every vantage the camera can reach', () => {
    for (const distPc of [1e-6, 1e-5, 1e-3, 1, 100, 1e4]) {
      const { posDrift, quatDrift } = rideWalk(distPc, 1e-11, 500);
      expect(quatDrift, `quat @ ${distPc} pc`).toBeLessThanOrEqual(ORIENTATION_SETTLE_ULP);
      expect(posDrift, `pos @ ${distPc} pc`).toBeLessThanOrEqual(POSITION_SETTLE_ULP);
    }
  });

  it('a real rotation is orders of magnitude past the floor', () => {
    // One hundredth of a pixel at ~1000 px/rad — far below anything a
    // viewer resolves, and still ~1e15x the orientation floor.
    const cam = new THREE.PerspectiveCamera(10, 1.6, 1e-9, 1e6);
    cam.up.copy(UP);
    cam.position.set(0, 0, 1e-5);
    cam.lookAt(new THREE.Vector3());
    const before = cam.quaternion.clone();
    const tiny = 1e-5;
    cam.lookAt(new THREE.Vector3(Math.sin(tiny) * 1e-5, 0, -Math.cos(tiny) * 1e-5));
    expect(orientationHeldStill(before, cam.quaternion)).toBe(false);
    expect(quatDriftUlps(before, cam.quaternion)).toBeGreaterThan(1e15);
  });

  it('a non-finite component reads as a move, never as held', () => {
    const a = new THREE.Quaternion(0, 0, 0, 1);
    const b = new THREE.Quaternion(Number.NaN, 0, 0, 1);
    expect(orientationHeldStill(a, b)).toBe(false);
    expect(positionHeldStill(
      new THREE.Vector3(1, 2, 3), new THREE.Vector3(Number.NaN, 2, 3))).toBe(false);
  });
});
