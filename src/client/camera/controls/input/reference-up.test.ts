import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GALACTIC_NORTH_POLE_ICRS } from '../../../galactic/galactic-coords';
import { ReferenceUpController } from './reference-up';

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
 *  roll. `correctEachFrame` mirrors the animate-loop step. */
function circuit(
  refUp: ReferenceUpController,
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  correctEachFrame: boolean,
): void {
  const leg: Array<[number, number]> = [[0.05, 0], [0, 0.05], [-0.05, 0], [0, -0.05]];
  for (let lap = 0; lap < 4; lap++) {
    for (const [dx, dy] of leg) {
      for (let step = 0; step < 6; step++) {
        if (correctEachFrame) refUp.correct(camera);
        orbitDrag(camera, target, dx, dy);
      }
    }
  }
  // Idle frames after the drag: the correction is a fixed-point iteration
  // reading the previous frame's view axis, so a continuous drag leaves a
  // sub-degree residual that settles once the pointer stops.
  if (correctEachFrame) {
    for (let i = 0; i < 8; i++) {
      refUp.correct(camera);
      camera.lookAt(target);
    }
  }
}

describe('ReferenceUpController', () => {
  it('defaults the reference axis to galactic north', () => {
    const refUp = new ReferenceUpController();
    expect(refUp.get().angleTo(GALACTIC_NORTH_POLE_ICRS)).toBe(0);
  });

  it('a closed orbit circuit accumulates roll when uncorrected', () => {
    const refUp = new ReferenceUpController();
    const { camera, target } = makeCamera();
    refUp.correct(camera);
    camera.lookAt(target);

    circuit(refUp, camera, target, false);

    // The regression this feature exists for: parallel transport around a
    // loop returns the camera to its starting pose with a net roll.
    expect(Math.abs(refUp.renderedRollError(camera, GALACTIC_NORTH_POLE_ICRS))).toBeGreaterThan(0.01);
  });

  it('holds the view level across the same circuit when corrected per frame', () => {
    const refUp = new ReferenceUpController();
    const { camera, target } = makeCamera();
    refUp.correct(camera);
    camera.lookAt(target);

    circuit(refUp, camera, target, true);

    expect(refUp.renderedRollError(camera, GALACTIC_NORTH_POLE_ICRS)).toBeCloseTo(0, 6);
    expect(refUp.get().angleTo(GALACTIC_NORTH_POLE_ICRS)).toBe(0);
  });

  it('preserves an explicit roll as state through subsequent orbiting', () => {
    const refUp = new ReferenceUpController();
    const { camera, target } = makeCamera();
    refUp.correct(camera);
    camera.lookAt(target);

    refUp.roll(camera, 0.3);
    camera.lookAt(target);
    expect(refUp.renderedRollError(camera, GALACTIC_NORTH_POLE_ICRS)).toBeCloseTo(-0.3, 6);
    const tilted = refUp.get().clone();

    circuit(refUp, camera, target, true);

    // The tilt is an axis, not a screen-space roll angle: orbiting leaves
    // the axis untouched and the correction converges on IT, not on north.
    // The rendered angle against galactic level is a function of the view
    // direction — it only reads 0.3 from where the roll was applied.
    expect(refUp.get().angleTo(tilted)).toBeCloseTo(0, 9);
    expect(refUp.correct(camera)).toBeCloseTo(0, 9);
    expect(Math.abs(refUp.renderedRollError(camera, GALACTIC_NORTH_POLE_ICRS))).toBeGreaterThan(0.01);
  });

  it('snaps the reference exactly back onto galactic north', () => {
    const refUp = new ReferenceUpController();
    const { camera, target } = makeCamera();
    refUp.correct(camera);
    camera.lookAt(target);

    refUp.roll(camera, 0.01);
    expect(refUp.get().angleTo(GALACTIC_NORTH_POLE_ICRS)).toBeGreaterThan(0);
    expect(refUp.referenceRollError(camera, GALACTIC_NORTH_POLE_ICRS)).toBeCloseTo(-0.01, 6);

    refUp.snapReferenceTo(camera, GALACTIC_NORTH_POLE_ICRS);

    expect(refUp.get().angleTo(GALACTIC_NORTH_POLE_ICRS)).toBe(0);
    expect(refUp.referenceRollError(camera, GALACTIC_NORTH_POLE_ICRS)).toBeCloseTo(0, 9);
  });

  it('adopts the rendered roll into the reference on the observe seam', () => {
    const refUp = new ReferenceUpController();
    const { camera, target } = makeCamera();
    refUp.correct(camera);
    camera.lookAt(target);

    // Observe-style roll: the quaternion carries it, the reference does not.
    refUp.rollQuaternion(camera, 0.4);

    // adoptFromCamera ran inside rollQuaternion, so the reference now IS the
    // rendered screen-up — the handover back to navigate is a no-op.
    expect(refUp.renderedRollError(camera, GALACTIC_NORTH_POLE_ICRS)).toBeCloseTo(-0.4, 6);
    const upBefore = camera.up.clone();
    refUp.correct(camera);
    expect(camera.up.angleTo(upBefore)).toBeCloseTo(0, 9);
  });

  it('normalizes a restored reference axis and ignores a zero vector', () => {
    const refUp = new ReferenceUpController();

    refUp.set(0, 3, 4);
    expect(refUp.get().length()).toBeCloseTo(1, 12);
    expect(refUp.get().y).toBeCloseTo(0.6, 12);

    refUp.set(0, 0, 0);
    expect(refUp.get().y).toBeCloseTo(0.6, 12);
  });
});
