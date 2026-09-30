import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { captureOrbitFrame } from '../../../attitude/attitude-pure';
import { poseIntoFrame, poseOutOfFrame } from './orbit-pose-pure';

const camera = new THREE.PerspectiveCamera();

// An inclined orbit, so no component of the basis lines up with an ICRS axis.
const frame = captureOrbitFrame(
  camera,
  new THREE.Vector3(0.3, -0.2, 0.93).normalize(),
  new THREE.Vector3(-4, 1, 0.5),
);

const vec = (x: number, y: number, z: number) => ({ x, y, z });

describe('orbit-relative pose', () => {
  it('writes the offset from the pivot, and up, as frame components', () => {
    const tgt = vec(0, 0, 0);
    const cam = vec(frame.zeroLon.x * 2, frame.zeroLon.y * 2, frame.zeroLon.z * 2);
    const up = vec(frame.pole.x, frame.pole.y, frame.pole.z);
    poseIntoFrame(cam, tgt, up, frame);
    expect(cam.x).toBeCloseTo(2, 12);
    expect(cam.y).toBeCloseTo(0, 12);
    expect(cam.z).toBeCloseTo(0, 12);
    expect(up.x).toBeCloseTo(0, 12);
    expect(up.y).toBeCloseTo(0, 12);
    expect(up.z).toBeCloseTo(1, 12);
  });

  it('leaves the pivot in ICRS and keeps the orbit radius', () => {
    const tgt = vec(5, -3, 2);
    const cam = vec(6, -1, 4);
    const up = vec(0, 0, 1);
    const radius = Math.hypot(cam.x - tgt.x, cam.y - tgt.y, cam.z - tgt.z);
    poseIntoFrame(cam, tgt, up, frame);
    expect(Math.hypot(cam.x - tgt.x, cam.y - tgt.y, cam.z - tgt.z)).toBeCloseTo(radius, 12);
    expect(tgt).toEqual(vec(5, -3, 2));
  });

  it('round-trips through the frame', () => {
    const tgt = vec(1e-7, -2e-7, 3e-7);
    const cam = vec(-1.6e-7, 2.2e-7, 7.7e-8);
    const up = vec(0.44, -0.015, 0.898);
    const before = { cam: { ...cam }, up: { ...up } };
    poseIntoFrame(cam, tgt, up, frame);
    poseOutOfFrame(cam, tgt, up, frame);
    expect(cam.x).toBeCloseTo(before.cam.x, 20);
    expect(cam.y).toBeCloseTo(before.cam.y, 20);
    expect(cam.z).toBeCloseTo(before.cam.z, 20);
    expect(up.x).toBeCloseTo(before.up.x, 14);
    expect(up.y).toBeCloseTo(before.up.y, 14);
    expect(up.z).toBeCloseTo(before.up.z, 14);
  });
});
