import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GALACTIC_NORTH_POLE_ICRS } from '../../../galactic/galactic-coords';
import { RollController } from './roll-controller';

// TrackballControls' rotate step, reproduced: a drag maps to an axis
// perpendicular to the eye vector, and BOTH the eye and camera.up rotate by
// it (TrackballControls.js rotateCamera). Each step injects no roll of its
// own — the drift is the holonomy of a closed path, so only a loop shows it.
function orbitDrag(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  dx: number,
  dy: number,
): void {
  const eye = new THREE.Vector3().subVectors(camera.position, target);
  const eyeDir = eye.clone().normalize();
  const upDir = camera.up.clone().normalize();
  const sideways = new THREE.Vector3().crossVectors(upDir, eyeDir).normalize();
  const move = upDir.multiplyScalar(dy).add(sideways.multiplyScalar(dx));
  const axis = new THREE.Vector3().crossVectors(move, eye).normalize();
  const q = new THREE.Quaternion().setFromAxisAngle(axis, move.length());
  eye.applyQuaternion(q);
  camera.up.applyQuaternion(q);
  camera.position.copy(target).add(eye);
  camera.lookAt(target);
}

function makeCamera(): { camera: THREE.PerspectiveCamera; target: THREE.Vector3 } {
  const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 1000);
  const target = new THREE.Vector3(0, 0, 0);
  camera.position.set(0, 0, 30);
  camera.lookAt(target);
  return { camera, target };
}

/** One closed circuit of the orbit sphere — the drag path that accumulates
 *  roll. Nothing runs between steps: navigate has no per-frame roll step. */
function circuit(camera: THREE.PerspectiveCamera, target: THREE.Vector3): void {
  const leg: Array<[number, number]> = [[0.05, 0], [0, 0.05], [-0.05, 0], [0, -0.05]];
  for (let lap = 0; lap < 4; lap++) {
    for (const [dx, dy] of leg) {
      for (let step = 0; step < 6; step++) orbitDrag(camera, target, dx, dy);
    }
  }
}

/** The screen-up a `lookAt` would render, which is what the user sees. */
function renderedUp(camera: THREE.PerspectiveCamera): THREE.Vector3 {
  return new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
}

describe('RollController', () => {
  it('levels the view exactly on a pole, and leaves up perpendicular', () => {
    const roll = new RollController();
    const { camera, target } = makeCamera();

    roll.levelTo(camera, GALACTIC_NORTH_POLE_ICRS);
    camera.lookAt(target);

    expect(roll.upRollError(camera, GALACTIC_NORTH_POLE_ICRS)).toBeCloseTo(0, 12);
    expect(roll.renderedRollError(camera, GALACTIC_NORTH_POLE_ICRS)).toBeCloseTo(0, 9);
    // Perpendicular is the invariant that keeps the projection well
    // conditioned as TrackballControls carries `up` around the sphere.
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    expect(camera.up.dot(forward)).toBeCloseTo(0, 12);
    expect(camera.up.length()).toBeCloseTo(1, 12);
  });

  // The bead's headline acceptance, and the whole point of retiring the
  // per-frame correction: parallel transport around a closed loop returns
  // the camera to its starting direction carrying a net roll, and nothing
  // now takes it away.
  it('retains the roll a closed orbit circuit accumulates', () => {
    const roll = new RollController();
    const { camera, target } = makeCamera();
    roll.levelTo(camera, GALACTIC_NORTH_POLE_ICRS);
    camera.lookAt(target);
    const startForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);

    circuit(camera, target);

    // The loop all but closes — the view direction comes back within a few
    // degrees — while the roll it came back with is several times that, so
    // the residual is holonomy and not just an unclosed path.
    const endForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const drift = endForward.angleTo(startForward);
    const netRoll = Math.abs(roll.renderedRollError(camera, GALACTIC_NORTH_POLE_ICRS));
    expect(drift).toBeLessThan(0.1);
    expect(netRoll).toBeGreaterThan(drift * 3);
  });

  it('rolls the rendered image by exactly the angle asked for', () => {
    const roll = new RollController();
    const { camera, target } = makeCamera();
    roll.levelTo(camera, GALACTIC_NORTH_POLE_ICRS);
    camera.lookAt(target);
    const before = renderedUp(camera);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);

    roll.roll(camera, 0.3);
    camera.lookAt(target);

    const after = renderedUp(camera);
    expect(after.angleTo(before)).toBeCloseTo(0.3, 9);
    // Sense, not just magnitude: a lost sign passes an angle check.
    expect(new THREE.Vector3().crossVectors(before, after).dot(forward))
      .toBeGreaterThan(0);
    expect(roll.upRollError(camera, GALACTIC_NORTH_POLE_ICRS)).toBeCloseTo(-0.3, 9);
  });

  it('keeps an explicit roll through subsequent orbiting', () => {
    const roll = new RollController();
    const { camera, target } = makeCamera();
    roll.levelTo(camera, GALACTIC_NORTH_POLE_ICRS);
    camera.lookAt(target);
    roll.roll(camera, 0.3);
    camera.lookAt(target);

    // Orbit away and back. The roll is carried by camera.up itself now, so
    // it survives — where the old reference axis survived instead and the
    // correction re-derived up from it.
    circuit(camera, target);

    expect(Math.abs(roll.renderedRollError(camera, GALACTIC_NORTH_POLE_ICRS)))
      .toBeGreaterThan(0.01);
    expect(camera.up.length()).toBeCloseTo(1, 9);
  });

  // Navigate must write camera.up on NO frame of its own: the up → lookAt →
  // quaternion → up round-trip 2-cycles at 1 ULP, and the quaternion is in
  // the render gate's exact-equality pose snapshot, so a per-frame write
  // there is a view that can never idle. This is the regression guard for
  // the deadband the correction needed and this design removes.
  it('leaves a settled navigate pose bit-identical over many frames', () => {
    const roll = new RollController();
    const { camera, target } = makeCamera();
    roll.levelTo(camera, GALACTIC_NORTH_POLE_ICRS);
    camera.lookAt(target);
    const up = camera.up.clone();
    const quat = camera.quaternion.clone();

    for (let i = 0; i < 200; i++) camera.lookAt(target);

    expect(camera.up.x).toBe(up.x);
    expect(camera.up.y).toBe(up.y);
    expect(camera.up.z).toBe(up.z);
    expect(camera.quaternion.x).toBe(quat.x);
    expect(camera.quaternion.y).toBe(quat.y);
    expect(camera.quaternion.z).toBe(quat.z);
    expect(camera.quaternion.w).toBe(quat.w);
  });

  it('adopts the rendered roll into up on the observe seam', () => {
    const roll = new RollController();
    const { camera, target } = makeCamera();
    roll.levelTo(camera, GALACTIC_NORTH_POLE_ICRS);
    camera.lookAt(target);

    // Observe-style roll: the quaternion carries it, and adoptFromCamera
    // runs inside rollQuaternion so up follows.
    roll.rollQuaternion(camera, 0.4);

    expect(roll.renderedRollError(camera, GALACTIC_NORTH_POLE_ICRS)).toBeCloseTo(-0.4, 6);
    // The handover back to navigate is a no-op: a lookAt reproduces the
    // quaternion the observe drag left, rather than rolling off it.
    const quatBefore = camera.quaternion.clone();
    camera.lookAt(target);
    expect(camera.quaternion.angleTo(quatBefore)).toBeCloseTo(0, 12);
  });

  // The restore lands the axis raw, because it runs before the position
  // and target it would have to be perpendicular to. The lookAt that
  // follows projects it, and the caller's adopt puts up back on the
  // perpendicular invariant.
  it('restores a URL up axis, projecting it through the following lookAt', () => {
    const roll = new RollController();
    const { camera, target } = makeCamera();
    roll.levelTo(camera, GALACTIC_NORTH_POLE_ICRS);
    camera.lookAt(target);

    // An axis that is NOT already perpendicular to the view — what a link
    // carrying a persistent reference axis looks like.
    const axis = new THREE.Vector3(0.2, 0.9, 0.4).normalize();
    roll.restore(camera, 0.2, 0.9, 0.4);
    expect(camera.up.angleTo(axis)).toBeCloseTo(0, 12);

    camera.lookAt(target);
    roll.adoptFromCamera(camera);

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    expect(camera.up.length()).toBeCloseTo(1, 12);
    expect(camera.up.dot(forward)).toBeCloseTo(0, 12);
    // The rendered roll is the one the axis asked for.
    expect(roll.upRollError(camera, axis)).toBeCloseTo(0, 9);

    const kept = camera.up.clone();
    roll.restore(camera, 0, 0, 0);
    expect(camera.up.angleTo(kept)).toBe(0);
  });

  // Why a link that OMITS `up` still has to write one. `camera.up` is the
  // pole's image-plane projection, so it is specific to the view axis it was
  // projected against: carrying one vantage's value to another reproduces
  // level at neither. The URL layer restores the pole itself and lets the
  // lookAt re-project it (`../../../util/url-state/README.md`).
  it('reproduces level from the pole, never from another vantage’s up', () => {
    const roll = new RollController();
    const { camera, target } = makeCamera();

    // Boot: level at the default pose. This is the value a receiver holds
    // before a link moves its camera.
    roll.levelTo(camera, GALACTIC_NORTH_POLE_ICRS);
    camera.lookAt(target);
    const bootUp = camera.up.clone();
    expect(roll.upRollError(camera, GALACTIC_NORTH_POLE_ICRS)).toBeCloseTo(0, 12);
    // It is NOT the pole — it is the pole flattened into the default image
    // plane, and the two differ by the pole's own declination.
    expect(bootUp.angleTo(GALACTIC_NORTH_POLE_ICRS)).toBeGreaterThan(0.4);

    // The pose a level share from +X restores.
    camera.position.set(30, 0, 0);

    // Keeping the boot value rolls the view hard.
    camera.up.copy(bootUp);
    camera.lookAt(target);
    roll.adoptFromCamera(camera);
    expect(Math.abs(roll.upRollError(camera, GALACTIC_NORTH_POLE_ICRS)))
      .toBeGreaterThan(1);

    // Restoring the pole raw, then projecting, lands exactly level.
    roll.restore(
      camera,
      GALACTIC_NORTH_POLE_ICRS.x,
      GALACTIC_NORTH_POLE_ICRS.y,
      GALACTIC_NORTH_POLE_ICRS.z,
    );
    camera.lookAt(target);
    roll.adoptFromCamera(camera);
    expect(roll.upRollError(camera, GALACTIC_NORTH_POLE_ICRS)).toBeCloseTo(0, 9);
  });
});
