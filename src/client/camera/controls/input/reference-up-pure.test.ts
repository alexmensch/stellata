import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  POLE_CONE_DEG,
  SNAP_TO_LEVEL_DEG,
  SNAP_TO_LEVEL_RAD,
  cameraLocalUpInto,
  correctUpTowardReference,
  levelUpInto,
  UP_CORRECTION_DEADBAND_RAD,
  poleConeWeight,
  signedAngleAbout,
} from './reference-up-pure';

const deg = (d: number) => (d * Math.PI) / 180;

describe('poleConeWeight', () => {
  it('pins the cone half-width and the guide band', () => {
    expect(POLE_CONE_DEG).toBe(15);
    expect(SNAP_TO_LEVEL_DEG).toBe(2);
    expect(SNAP_TO_LEVEL_RAD).toBeCloseTo((2 * Math.PI) / 180, 15);
  });

  it('is 0 on the reference axis and 1 outside the cone', () => {
    expect(poleConeWeight(0)).toBe(0);
    expect(poleConeWeight(Math.sin(deg(POLE_CONE_DEG)))).toBe(1);
    expect(poleConeWeight(1)).toBe(1);
  });

  it('rises monotonically across the cone', () => {
    const samples = [0, 0.25, 0.5, 0.75, 1].map(
      (f) => poleConeWeight(f * Math.sin(deg(POLE_CONE_DEG))),
    );
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
  });
});

describe('levelUpInto', () => {
  it('returns sin θ and a unit up perpendicular to forward', () => {
    const reference = new THREE.Vector3(0, 1, 0);
    const forward = new THREE.Vector3(0, Math.sin(deg(30)), -Math.cos(deg(30)));
    const out = new THREE.Vector3();

    const sinTheta = levelUpInto(out, reference, forward);

    // forward sits 60° off the reference axis (30° above the horizontal).
    expect(sinTheta).toBeCloseTo(Math.sin(deg(60)), 12);
    expect(out.length()).toBeCloseTo(1, 12);
    expect(out.dot(forward)).toBeCloseTo(0, 12);
    expect(out.y).toBeGreaterThan(0);
  });

  it('returns 0 when the view axis lies on the reference axis', () => {
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

describe('correctUpTowardReference', () => {
  const reference = new THREE.Vector3(0, 1, 0);
  const forward = new THREE.Vector3(0, 0, -1); // 90° off the reference axis
  const scratch = new THREE.Vector3();

  it('removes an injected roll in a single step outside the pole cone', () => {
    const up = new THREE.Vector3(0, 1, 0).applyAxisAngle(forward, deg(12));

    const applied = correctUpTowardReference(up, forward, reference, scratch);

    expect(applied).toBeCloseTo(-deg(12), 9);
    expect(up.angleTo(new THREE.Vector3(0, 1, 0))).toBeCloseTo(0, 9);
  });

  it('is a fixed point once level — the property slerp endpoints rely on', () => {
    const up = new THREE.Vector3(0, 1, 0);
    expect(correctUpTowardReference(up, forward, reference, scratch)).toBeCloseTo(0, 12);
    expect(up.angleTo(new THREE.Vector3(0, 1, 0))).toBeCloseTo(0, 12);
  });

  it('is BIT-STABLE at the fixed point, not merely close to one', () => {
    // The 2-cycle this deadband exists for. `toBeCloseTo(0)` passed happily
    // while `up` alternated between two adjacent doubles every frame, which
    // reached camera.quaternion through the lookAt and held the render gate
    // open at every vantage. Exact equality is the only assertion that sees
    // it — the gate's pose snapshot compares the same way.
    const up = new THREE.Vector3(-0.5507687330245972, -0.040100980550050735, 0.8336940407752991);
    const fwd = new THREE.Vector3(0.7, -0.19, 0.688).normalize();
    const ref = up.clone();
    correctUpTowardReference(up, fwd, ref, scratch);
    const settled = up.clone();
    for (let frame = 0; frame < 500; frame++) {
      expect(correctUpTowardReference(up, fwd, ref, scratch)).toBe(0);
      expect(up.x).toBe(settled.x);
      expect(up.y).toBe(settled.y);
      expect(up.z).toBe(settled.z);
    }
  });

  it('writes nothing at all inside the deadband', () => {
    // Not even the re-projection: that is a rounding step of its own and
    // cycled independently of the rotation.
    const up = new THREE.Vector3(0, 1, 0).applyAxisAngle(forward, 0.9 * UP_CORRECTION_DEADBAND_RAD);
    const before = up.clone();
    expect(correctUpTowardReference(up, forward, reference, scratch)).toBe(0);
    expect(up.equals(before)).toBe(true);
  });

  it('still corrects just outside the deadband', () => {
    const err = 1.1 * UP_CORRECTION_DEADBAND_RAD;
    const up = new THREE.Vector3(0, 1, 0).applyAxisAngle(forward, err);
    expect(correctUpTowardReference(up, forward, reference, scratch)).toBeCloseTo(-err, 12);
  });

  it('the deadband is invisible: sub-pixel roll at any realistic screen radius', () => {
    // A roll displaces a feature by radius * angle. 1500 px is past the
    // half-diagonal of a 2560x1440 window, and the cadence calls 0.25 device
    // px the scheduling threshold.
    expect(UP_CORRECTION_DEADBAND_RAD).toBe(1e-4);
    expect(1500 * UP_CORRECTION_DEADBAND_RAD).toBeCloseTo(0.15, 10);
  });

  it('a residual under the band still accumulates into a correction', () => {
    // The error is measured against the reference every frame rather than
    // integrated, so holonomy drift smaller than the band is not discarded —
    // it crosses the band and gets corrected. A deadband that swallowed drift
    // permanently would trade a render-gate bug for a levelling bug.
    const up = new THREE.Vector3(0, 1, 0);
    const drift = 0.3 * UP_CORRECTION_DEADBAND_RAD;
    let corrections = 0;
    for (let frame = 0; frame < 12; frame++) {
      up.applyAxisAngle(forward, drift);
      if (correctUpTowardReference(up, forward, reference, scratch) !== 0) corrections++;
    }
    expect(corrections).toBeGreaterThan(0);
    expect(up.angleTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(UP_CORRECTION_DEADBAND_RAD);
  });

  it('corrects only partially inside the cone, and never overshoots', () => {
    // 5° off the reference axis — well inside the 15° cone.
    const nearPole = new THREE.Vector3(0, Math.cos(deg(5)), -Math.sin(deg(5))).normalize();
    const err = deg(20);
    const up = new THREE.Vector3();
    levelUpInto(up, reference, nearPole);
    up.applyAxisAngle(nearPole, err);

    const applied = correctUpTowardReference(up, nearPole, reference, scratch);

    expect(Math.abs(applied)).toBeGreaterThan(0);
    expect(Math.abs(applied)).toBeLessThan(err);
  });

  it('leaves the transported up untouched exactly on the reference axis', () => {
    const onAxis = new THREE.Vector3(0, 1, 0);
    const up = new THREE.Vector3(0, 0, -1);

    expect(correctUpTowardReference(up, onAxis, reference, scratch)).toBe(0);
    expect(up.z).toBe(-1);
  });

  it('adopts the level up when the current up is parallel to forward', () => {
    const up = forward.clone();
    correctUpTowardReference(up, forward, reference, scratch);
    expect(up.angleTo(new THREE.Vector3(0, 1, 0))).toBeCloseTo(0, 9);
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
