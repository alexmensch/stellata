import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  TRACKBALL_SETTLE_PX,
  eyeSwingRad,
  trackballMotionPx,
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
