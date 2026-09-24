import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ObserveLookPin } from './observe-look-pin';
import { LOOK_PIN_DIST_PC } from './look-pin-pure';

function harness() {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(3, -2, 5);
  const target = new THREE.Vector3();
  return { camera, target, pin: new ObserveLookPin(camera, target) };
}

const expectedPin = (camera: THREE.Camera) =>
  new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    .multiplyScalar(LOOK_PIN_DIST_PC).add(camera.position);

describe('ObserveLookPin', () => {
  it('derives the pin on the first update', () => {
    const { camera, target, pin } = harness();
    camera.rotateY(0.4);
    pin.update();
    expect(target.toArray()).toEqual(expectedPin(camera).toArray());
  });

  it('leaves a translated pin alone while the camera has not rotated', () => {
    const { camera, target, pin } = harness();
    pin.update();
    const delta = new THREE.Vector3(1e-3, 2e-3, -3e-3);
    camera.position.add(delta);
    target.add(delta);
    const ridden = target.clone();
    pin.update();
    expect(target.toArray()).toEqual(ridden.toArray());
  });

  it('re-derives after a rotation', () => {
    const { camera, target, pin } = harness();
    pin.update();
    camera.rotateX(0.2);
    pin.update();
    expect(target.toArray()).toEqual(expectedPin(camera).toArray());
  });

  it('re-derives after invalidate, with no rotation', () => {
    const { camera, target, pin } = harness();
    pin.update();
    target.set(9, 9, 9);
    pin.invalidate();
    pin.update();
    expect(target.toArray()).toEqual(expectedPin(camera).toArray());
  });
});
