import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  SNAP_TO_LEVEL_DEG,
  SNAP_TO_LEVEL_RAD,
  cameraLocalUpInto,
  levelUpInto,
  signedAngleAbout,
} from './roll-pure';

const deg = (d: number) => (d * Math.PI) / 180;

describe('the alignment-guide band', () => {
  it('pins its width, in both units', () => {
    expect(SNAP_TO_LEVEL_DEG).toBe(2);
    expect(SNAP_TO_LEVEL_RAD).toBeCloseTo(deg(2), 15);
  });
});

describe('levelUpInto', () => {
  it('returns sin θ and a unit up perpendicular to forward', () => {
    const reference = new THREE.Vector3(0, 1, 0);
    const forward = new THREE.Vector3(0, Math.sin(deg(30)), -Math.cos(deg(30)));
    const out = new THREE.Vector3();

    const sinTheta = levelUpInto(out, reference, forward);

    // forward sits 60° off the level axis (30° above the horizontal).
    expect(sinTheta).toBeCloseTo(Math.sin(deg(60)), 12);
    expect(out.length()).toBeCloseTo(1, 12);
    expect(out.dot(forward)).toBeCloseTo(0, 12);
    expect(out.y).toBeGreaterThan(0);
  });

  it('returns 0 when the view axis lies on the level axis', () => {
    const out = new THREE.Vector3();
    expect(levelUpInto(out, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0))).toBe(0);
  });
});

describe('signedAngleAbout', () => {
  it('is the rotation about the axis that maps from onto to', () => {
    const axis = new THREE.Vector3(0, 0, -1);
    const from = new THREE.Vector3(0, 1, 0);
    const to = from.clone().applyAxisAngle(axis, deg(37));

    const angle = signedAngleAbout(from, to, axis);

    expect(angle).toBeCloseTo(deg(37), 12);
    expect(from.clone().applyAxisAngle(axis, angle).angleTo(to)).toBeCloseTo(0, 9);
  });

  it('signs the two rotation directions oppositely', () => {
    const axis = new THREE.Vector3(0, 0, -1);
    const from = new THREE.Vector3(0, 1, 0);
    const cw = from.clone().applyAxisAngle(axis, deg(20));
    const ccw = from.clone().applyAxisAngle(axis, deg(-20));
    expect(signedAngleAbout(from, cw, axis)).toBeGreaterThan(0);
    expect(signedAngleAbout(from, ccw, axis)).toBeLessThan(0);
  });
});

describe('cameraLocalUpInto', () => {
  it('writes the camera-local +Y basis vector', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), deg(30));
    const out = new THREE.Vector3();

    cameraLocalUpInto(out, camera);

    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(Math.cos(deg(30)), 6);
    expect(out.z).toBeCloseTo(Math.sin(deg(30)), 6);
    expect(out.length()).toBeCloseTo(1, 12);
  });

  it('matches the +Y column of the camera world matrix', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(5, -2, 3);
    camera.quaternion.setFromEuler(new THREE.Euler(0.4, 0.9, -0.2, 'XYZ'));
    camera.updateMatrixWorld(true);
    const out = new THREE.Vector3();

    cameraLocalUpInto(out, camera);

    const m = camera.matrixWorld.elements;
    expect(out.x).toBeCloseTo(m[4], 12);
    expect(out.y).toBeCloseTo(m[5], 12);
    expect(out.z).toBeCloseTo(m[6], 12);
  });
});
