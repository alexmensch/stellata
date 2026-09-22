import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FrameFrustum } from './frame-frustum';

function cameraAtOriginLookingMinusZ(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  cam.position.set(0, 0, 0);
  cam.lookAt(0, 0, -1);
  return cam;
}

describe('FrameFrustum', () => {
  it('refuses a read before the first refresh — the sentinel fails first-read', () => {
    const f = new FrameFrustum();
    expect(f.isValid).toBe(false);
    expect(() => f.intersectsSphere(new THREE.Sphere(new THREE.Vector3(), 1)))
      .toThrow(/below the orbit lock/);
  });

  it('after refresh, a sphere ahead is inside and one behind is outside', () => {
    const f = new FrameFrustum();
    f.refresh(cameraAtOriginLookingMinusZ());
    expect(f.intersectsSphere(new THREE.Sphere(new THREE.Vector3(0, 0, -10), 1))).toBe(true);
    expect(f.intersectsSphere(new THREE.Sphere(new THREE.Vector3(0, 0, 10), 1))).toBe(false);
  });

  it('a sphere straddling a plane counts as inside — the bound only ever admits', () => {
    const f = new FrameFrustum();
    f.refresh(cameraAtOriginLookingMinusZ());
    // Centre well outside the 50° cone, radius large enough to cross back in.
    expect(f.intersectsSphere(new THREE.Sphere(new THREE.Vector3(0, 20, -10), 15))).toBe(true);
  });

  it('reads the camera pose at refresh time, not at construction', () => {
    const f = new FrameFrustum();
    const cam = cameraAtOriginLookingMinusZ();
    f.refresh(cam);
    cam.lookAt(0, 0, 1);
    expect(f.intersectsSphere(new THREE.Sphere(new THREE.Vector3(0, 0, -10), 1))).toBe(true);
    f.refresh(cam);
    expect(f.intersectsSphere(new THREE.Sphere(new THREE.Vector3(0, 0, -10), 1))).toBe(false);
  });

  it('invalidate makes the next read throw again', () => {
    const f = new FrameFrustum();
    f.refresh(cameraAtOriginLookingMinusZ());
    f.invalidate();
    expect(f.isValid).toBe(false);
    expect(() => f.intersectsSphere(new THREE.Sphere(new THREE.Vector3(), 1))).toThrow();
  });
});
